import type { SessionInfo } from "agents/experimental/memory/session";

export type { SessionInfo };

export type ChatState = {
  activeSessionId: string;
  sessions: SessionInfo[];
};

/**
 * Broadcast sent by the Chat DO after each assistant turn completes,
 * mapping the assistant message ID to its Langfuse trace ID.
 *
 * No client consumes this yet — the FeedbackDialog wiring in the
 * follow-up PR will stash these per-message and include the trace ID
 * when submitting feedback so the annotation lands on the right trace.
 */
export type PalMessageTraceBroadcast = {
  type: "pal_message_trace";
  messageId: string;
  traceId: string;
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
