import type { ChatResponseResult } from "@cloudflare/think";
import { Session, Think } from "@cloudflare/think";
import { callable, routeAgentRequest } from "agents";
import {
  AgentSearchProvider,
  SessionManager,
  type SessionInfo,
} from "agents/experimental/memory/session";
import { createWorkersAI } from "workers-ai-provider";
import {
  createPalTools,
  PAL_KNOWLEDGE_DESCRIPTION,
  PAL_MEMORY_DESCRIPTION,
  PAL_MODEL_ID,
  PAL_SOUL,
} from "./agent-config";
import type { ChatRpc, ChatState } from "./shared";

export class Chat extends Think<Env, ChatState> implements ChatRpc {
  override initialState: ChatState = { activeSessionId: "", sessions: [] };

  private _retryingEmptyResponse = false;

  private _manager?: SessionManager;

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

  // Workers AI's Kimi endpoint occasionally returns an assistant turn with
  // no text — typically tool calls followed by no synthesis. That surfaces
  // as a blank bubble after Pal "thinks" but never answers. Discard the
  // empty message and re-run inference once so the user sees a real reply.
  override async onChatResponse(result: ChatResponseResult): Promise<void> {
    if (result.status !== "completed") return;
    if (this._retryingEmptyResponse) return;

    const message = result.message;
    if (message.role !== "assistant") return;

    const hasUsableText = message.parts.some(
      (p) =>
        p.type === "text" &&
        typeof p.text === "string" &&
        p.text.trim().length > 0,
    );
    if (hasUsableText) return;

    this._retryingEmptyResponse = true;
    try {
      this.session.deleteMessages([message.id]);
      this.broadcast(
        JSON.stringify({
          type: "cf_agent_chat_messages",
          messages: this.messages,
        }),
      );
      await this.saveMessages([]);
    } finally {
      this._retryingEmptyResponse = false;
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
}

export default {
  async fetch(request, env) {
    const agentResp = await routeAgentRequest(request, env);
    if (agentResp) return agentResp;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
