import type { SessionInfo } from "agents/experimental/memory/session";

export type { SessionInfo };

export type ChatState = {
  activeSessionId: string;
  sessions: SessionInfo[];
};

/**
 * Public RPC surface exposed by the Chat agent. Mirrors the `@callable`
 * methods on the server so the client can get typed stubs without
 * importing the full server module (which would drag in worker globals).
 */
export interface ChatRpc {
  get state(): ChatState;
  listSessions(): Promise<SessionInfo[]>;
  createSession(name?: string): Promise<SessionInfo>;
  switchSession(sessionId: string): Promise<SessionInfo>;
  forkSession(
    sessionId: string,
    atMessageId: string,
    name?: string,
  ): Promise<SessionInfo>;
  renameSession(sessionId: string, name: string): Promise<SessionInfo>;
  deleteSession(sessionId: string): Promise<{ activeSessionId: string }>;
}
