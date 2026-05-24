import type {
  ChatResponseResult,
  TurnConfig,
  TurnContext,
} from "@cloudflare/think";
import { Session, Think } from "@cloudflare/think";
import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  type LangfuseSpan,
  propagateAttributes,
  setLangfuseTracerProvider,
  startObservation,
} from "@langfuse/tracing";
import { context, trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { callable, routeAgentRequest } from "agents";
import {
  AgentSearchProvider,
  SessionManager,
  type SessionInfo,
} from "agents/experimental/memory/session";
import type { UIMessage } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import {
  createPalTools,
  PAL_KNOWLEDGE_DESCRIPTION,
  PAL_MEMORY_DESCRIPTION,
  PAL_MODEL_ID,
  PAL_SOUL,
} from "./agent-config";
import { submitFeedbackImpl } from "./feedback";
import type {
  ChatRpc,
  ChatState,
  PalMessageTraceBroadcast,
  SubmitFeedbackInput,
  SubmitFeedbackResult,
} from "./shared";

// TODO(ai-v7): Vercel AI SDK v7 replaces `experimental_telemetry`'s
// OpenTelemetry emission with a Telemetry callback interface. When Pal
// upgrades past ai@^6, the AI SDK side of this integration needs to be
// rewritten against the new interface.

function extractText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

function isEmptyAssistantMessage(message: UIMessage): boolean {
  if (message.role !== "assistant") return false;
  return !message.parts.some(
    (p) =>
      p.type === "text" &&
      typeof p.text === "string" &&
      p.text.trim().length > 0,
  );
}

// `provider.register()` and `setLangfuseTracerProvider()` mutate
// globalThis. Multiple Chat DO instances can share an isolate, so we keep
// one provider per isolate rather than per instance — otherwise the
// second instance's lazy init would replace the global tracer in use by
// the first, and AI SDK child spans would flow through the wrong
// processor. Env values are constant across instances within an isolate,
// so a singleton is safe.
let providerSingleton: NodeTracerProvider | undefined;

// Singleton for the same reason as `providerSingleton` — LangfuseClient
// holds an internal score queue + flush timer; recreating it per call
// would drop queued events and leak timers. Env values are stable per
// isolate, so one client per isolate is safe.
let langfuseClientSingleton: LangfuseClient | undefined;

function getLangfuseClient(env: Env): LangfuseClient {
  if (langfuseClientSingleton) return langfuseClientSingleton;
  langfuseClientSingleton = new LangfuseClient({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
  });
  return langfuseClientSingleton;
}

function getTracerProvider(env: Env): NodeTracerProvider {
  if (providerSingleton) return providerSingleton;
  // `exportMode: "immediate"` uses SimpleSpanProcessor semantics. Batched
  // flushing relies on timers that don't survive a Worker request, so
  // immediate export is required to avoid losing spans.
  const processor = new LangfuseSpanProcessor({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
    exportMode: "immediate",
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  // `register()` installs an AsyncLocalStorage-backed context manager
  // (so `context.with(...)` works) and sets the global tracer provider
  // (so `trace.getTracer("ai")` inside the AI SDK resolves to ours).
  // `setLangfuseTracerProvider` additionally aligns `@langfuse/tracing`'s
  // internal tracer with the same provider so its spans flow through
  // our processor.
  provider.register();
  setLangfuseTracerProvider(provider);
  providerSingleton = provider;
  return provider;
}

// `_runInferenceLoop` is declared `private` in Think. Subclass declarations
// of a private member trip TypeScript's class-compatibility check, so we
// install the override at runtime in the constructor instead — the
// instance property shadows the prototype method for `this._runInferenceLoop(...)`
// calls Think makes internally. Typed via this interface so the cast is
// scoped instead of needing a class-level `@ts-expect-error`.
type ThinkPrivateLoop = {
  _runInferenceLoop: (input: unknown) => Promise<unknown>;
};

export class Chat extends Think<Env, ChatState> implements ChatRpc {
  override initialState: ChatState = { activeSessionId: "", sessions: [] };

  private _manager?: SessionManager;

  private _currentTurnSpan?: LangfuseSpan;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Think calls `streamText()` inside its private `_runInferenceLoop`
    // and offers no public hook around that call. To bind an
    // OpenTelemetry parent context (the per-turn span) so AI SDK spans
    // nest as children — a generic OTel requirement, not Langfuse-specific
    // — we wrap that method here. `tests/span-structure.test.ts` guards
    // both the wrapping shape and Think's internal use of `streamText()`,
    // so a refactor that shifts the call out of our wrap fails loudly.
    // TODO(upstream-hook): replace with `TurnConfig.telemetryContext` once
    // accepted upstream — issue to be filed.
    const self = this as unknown as ThinkPrivateLoop;
    const baseRunInferenceLoop = self._runInferenceLoop.bind(this);
    self._runInferenceLoop = (input: unknown) =>
      this._wrappedInferenceLoop(input, baseRunInferenceLoop);
  }

  private get manager(): SessionManager {
    if (!this._manager) {
      this._manager = SessionManager.create(this)
        .withContext("soul", {
          provider: { get: async () => PAL_SOUL },
        })
        .withContext("memory", {
          description: PAL_MEMORY_DESCRIPTION,
          maxTokens: 2000,
        })
        .withContext("knowledge", {
          description: PAL_KNOWLEDGE_DESCRIPTION,
          provider: new AgentSearchProvider(this),
        })
        .withCachedPrompt();
    }
    return this._manager;
  }

  override getModel() {
    return createWorkersAI({ binding: this.env.AI })(PAL_MODEL_ID);
  }

  override async configureSession(_session: Session): Promise<Session> {
    const manager = this.manager;
    let activeId = this.state?.activeSessionId;

    if (!activeId || !manager.get(activeId)) {
      const existing = manager.list();
      activeId = existing[0]?.id ?? manager.create("New chat").id;
    }

    this._syncState(activeId);
    return manager.getSession(activeId);
  }

  override getTools() {
    return createPalTools();
  }

  override beforeTurn(_ctx: TurnContext): TurnConfig {
    const turnSpan = this._currentTurnSpan;
    if (!turnSpan) return {};
    const sessionId = this.state?.activeSessionId ?? "";
    const metadata: Record<string, string> = {
      langfuseTraceId: turnSpan.otelSpan.spanContext().traceId,
    };
    // Skip the session attribute entirely when unset, so empty-string
    // sessions don't all collapse into one phantom Langfuse session.
    if (sessionId) metadata.langfuseSessionId = sessionId;
    return {
      experimental_telemetry: {
        isEnabled: true,
        functionId: "pal-chat",
        metadata,
      },
    };
  }

  private async _wrappedInferenceLoop(
    input: unknown,
    base: (input: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    const provider = getTracerProvider(this.env);
    const sessionId = this.state?.activeSessionId ?? "";
    const userMessage = this.messages.at(-1);
    const inputText =
      userMessage?.role === "user" ? extractText(userMessage) : undefined;

    return propagateAttributes(
      sessionId ? { sessionId } : {},
      async () => {
        const turnSpan = startObservation("pal-turn", {
          input: inputText,
          ...(sessionId ? { metadata: { activeSessionId: sessionId } } : {}),
        });
        this._currentTurnSpan = turnSpan;
        try {
          return await context.with(
            trace.setSpan(context.active(), turnSpan.otelSpan),
            () => base(input),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          turnSpan.update({ level: "ERROR", statusMessage: message }).end();
          this._currentTurnSpan = undefined;
          flushTraces(this.ctx, provider);
          throw err;
        }
      },
    );
  }

  // Workers AI's Kimi endpoint occasionally returns an assistant turn with
  // no text — typically tool calls followed by no synthesis. That surfaces
  // as a blank bubble after Pal "thinks" but never answers. Discard the
  // empty message and re-run inference once so the user sees a real reply.
  override async onChatResponse(result: ChatResponseResult): Promise<void> {
    const turnSpan = this._currentTurnSpan;
    this._currentTurnSpan = undefined;

    if (result.status !== "completed") {
      turnSpan?.update({ level: "ERROR", statusMessage: result.status }).end();
      flushTraces(this.ctx);
      return;
    }

    const message = result.message;
    const empty = isEmptyAssistantMessage(message);

    if (!empty) {
      this._closeTurnAndBroadcast(turnSpan, message);
      return;
    }

    // First empty response: close the original turn span with ERROR, then
    // trigger the retry by deleting the empty assistant message and calling
    // saveMessages([]). The retry runs through our `_wrappedInferenceLoop`
    // and opens a second pal-turn span. Think's `_insideResponseHook`
    // guard (think.js:2647) suppresses the retry's `onChatResponse` while
    // we're still on the stack here — so we close the retry's span
    // ourselves once `saveMessages` returns.
    turnSpan
      ?.update({
        level: "ERROR",
        statusMessage: "empty assistant response — retrying",
      })
      .end();
    flushTraces(this.ctx);

    this.session.deleteMessages([message.id]);
    this.broadcast(
      JSON.stringify({
        type: "cf_agent_chat_messages",
        messages: this.messages,
      }),
    );
    await this.saveMessages([]);

    // Close the retry's span (opened by `_wrappedInferenceLoop` during
    // the saveMessages turn). Reads the latest message to decide
    // success vs. another empty response — we do not retry twice.
    const retrySpan = this._currentTurnSpan;
    this._currentTurnSpan = undefined;
    const latest = this.messages.at(-1);
    if (latest?.role === "assistant") {
      this._closeTurnAndBroadcast(retrySpan, latest);
    } else if (retrySpan) {
      const span: LangfuseSpan = retrySpan;
      span
        .update({
          level: "ERROR",
          statusMessage: "retry produced no assistant message",
        })
        .end();
      flushTraces(this.ctx);
    }
  }

  private _closeTurnAndBroadcast(
    turnSpan: LangfuseSpan | undefined,
    message: UIMessage,
  ) {
    if (!turnSpan) {
      flushTraces(this.ctx);
      return;
    }
    // Capture the trace ID *before* `.end()` — the OTel JS contract does
    // not guarantee SpanContext access after end across minor versions.
    const traceId = turnSpan.otelSpan.spanContext().traceId;
    const empty = isEmptyAssistantMessage(message);
    if (empty) {
      turnSpan
        .update({
          level: "ERROR",
          statusMessage: "empty assistant response (retry)",
        })
        .end();
    } else {
      turnSpan.update({ output: extractText(message) }).end();
    }
    flushTraces(this.ctx);
    if (message.role === "assistant") {
      const payload: PalMessageTraceBroadcast = {
        type: "pal_message_trace",
        messageId: message.id,
        traceId,
      };
      this.broadcast(JSON.stringify(payload));
    }
  }

  private _syncState(activeSessionId: string) {
    this.setState({
      activeSessionId,
      sessions: this.manager.list(),
    });
  }

  private _activate(sessionId: string) {
    this.session = this.manager.getSession(sessionId);
    this._syncState(sessionId);
    this.broadcast(
      JSON.stringify({
        type: "cf_agent_chat_messages",
        messages: this.messages,
      }),
    );
  }

  @callable()
  async listSessions(): Promise<SessionInfo[]> {
    return this.manager.list();
  }

  @callable()
  async createSession(name?: string): Promise<SessionInfo> {
    const info = this.manager.create(name?.trim() || "New chat");
    this._activate(info.id);
    return info;
  }

  @callable()
  async switchSession(sessionId: string): Promise<SessionInfo> {
    const info = this.manager.get(sessionId);
    if (!info) throw new Error(`Unknown session: ${sessionId}`);
    this._activate(sessionId);
    return info;
  }

  @callable()
  async forkSession(
    sessionId: string,
    atMessageId: string,
    name?: string,
  ): Promise<SessionInfo> {
    const source = this.manager.get(sessionId);
    if (!source) throw new Error(`Unknown session: ${sessionId}`);
    const forkName = name?.trim() || `${source.name} (fork)`;
    const info = await this.manager.fork(sessionId, atMessageId, forkName);
    this._activate(info.id);
    return info;
  }

  @callable()
  async renameSession(sessionId: string, name: string): Promise<SessionInfo> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name cannot be empty");
    this.manager.rename(sessionId, trimmed);
    const info = this.manager.get(sessionId);
    if (!info) throw new Error(`Unknown session: ${sessionId}`);
    this._syncState(this.state?.activeSessionId ?? sessionId);
    return info;
  }

  @callable()
  async deleteSession(sessionId: string): Promise<{ activeSessionId: string }> {
    const remaining = this.manager.list().filter((s) => s.id !== sessionId);
    this.manager.delete(sessionId);

    const wasActive = this.state?.activeSessionId === sessionId;
    let activeId = this.state?.activeSessionId ?? "";
    if (wasActive) {
      activeId = remaining[0]?.id ?? this.manager.create("New chat").id;
      this._activate(activeId);
    } else {
      this._syncState(activeId);
    }
    return { activeSessionId: activeId };
  }

  @callable()
  async submitFeedback(
    input: SubmitFeedbackInput,
  ): Promise<SubmitFeedbackResult> {
    // Same trust boundary as the session callables: we accept
    // `traceId` straight from the client without re-deriving it from
    // server-side state. Persisting message→trace mappings in DO
    // storage would be more authoritative but adds a write per turn
    // for no real safety win — see PR description.
    const originalInput = this._findOriginalUserInputFor(input?.messageId);
    return submitFeedbackImpl(getLangfuseClient(this.env), input, {
      originalInput,
    });
  }

  // Looks up the user message immediately preceding the rated assistant
  // message so `submitFeedbackImpl` can write it as `DatasetItem.input`.
  // Returns undefined when the assistant message isn't found, or when
  // there's no preceding message, or when the preceding message isn't
  // from the user — `submitFeedbackImpl` will then skip the dataset
  // write and log a warning, which is the right failure mode (score +
  // trace Comment still land).
  private _findOriginalUserInputFor(
    messageId: string | undefined,
  ): string | undefined {
    if (!messageId) return undefined;
    const msgs = this.messages;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx <= 0) return undefined;
    const prev = msgs[idx - 1];
    if (!prev || prev.role !== "user") return undefined;
    const text = extractText(prev).trim();
    return text || undefined;
  }
}

// Drain pending spans on whichever execution context is active. Swallowing
// the rejection here keeps a Langfuse outage or auth failure from
// surfacing as a DO-level unhandled rejection that fails the turn whose
// user-visible response already streamed.
function flushTraces(
  ctx: DurableObjectState | ExecutionContext,
  provider: NodeTracerProvider | undefined = providerSingleton,
): void {
  if (!provider) return;
  ctx.waitUntil(
    provider
      .forceFlush()
      .catch((err) => console.error("[pal] langfuse flush failed", err)),
  );
}

export default {
  async fetch(request, env) {
    const agentResp = await routeAgentRequest(request, env);
    if (agentResp) return agentResp;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
