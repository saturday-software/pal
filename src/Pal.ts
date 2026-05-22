import { Session, Think } from "@cloudflare/think";
import { callable, routeAgentRequest } from "agents";
import {
  AgentSearchProvider,
  SessionManager,
  type SessionInfo,
} from "agents/experimental/memory/session";
import { tool } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import type { ChatRpc, ChatState } from "./shared";

export class Chat extends Think<Env, ChatState> implements ChatRpc {
  override initialState: ChatState = { activeSessionId: "", sessions: [] };

  private _manager?: SessionManager;

  private get manager(): SessionManager {
    if (!this._manager) {
      this._manager = SessionManager.create(this)
        .withContext("soul", {
          provider: { get: async () => "You are Pal, a helpful assistant." },
        })
        .withContext("memory", {
          description:
            "Short-term working memory for the current conversation. Use for active tasks, recent decisions, and facts only relevant right now. Persist anything worth remembering across sessions to `knowledge`.",
          maxTokens: 2000,
        })
        .withContext("knowledge", {
          description:
            "Long-term memory across all conversations. Use `set_context` to save durable facts (preferences, identities, recurring topics) and `search_context` to recall them. Prefer concise, self-contained entries keyed by topic.",
          provider: new AgentSearchProvider(this),
        })
        .withCachedPrompt();
    }
    return this._manager;
  }

  override getModel() {
    return createWorkersAI({ binding: this.env.AI })(
      "@cf/moonshotai/kimi-k2.6",
    );
  }

  override async configureSession(_session: Session): Promise<Session> {
    const manager = this.manager;
    let activeId = this.state?.activeSessionId;

    if (!activeId || !manager.get(activeId)) {
      const existing = manager.list();
      activeId =
        existing[0]?.id ?? manager.create("New chat").id;
    }

    this._syncState(activeId);
    return manager.getSession(activeId);
  }

  override getTools() {
    return {
      getCurrentTime: tool({
        description: "Get the current server time as an ISO 8601 string.",
        inputSchema: z.object({}),
        execute: async () => new Date().toISOString(),
      }),
    };
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
