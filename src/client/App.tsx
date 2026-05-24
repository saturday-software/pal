import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ChatThread } from "@/components/chat-thread";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { SessionSidebar } from "@/components/session-sidebar";
import type {
  ChatRpc,
  ChatState,
  PalMessageTraceBroadcast,
  SubmitFeedbackResult,
} from "../shared";

export function App() {
  const agent = useAgent<ChatRpc, ChatState>({ agent: "chat" });
  const { messages, sendMessage, status } = useAgentChat({ agent });

  const state = agent.state;
  const sessions = state?.sessions ?? [];
  const activeId = state?.activeSessionId ?? "";
  const activeSession = sessions.find((s) => s.id === activeId);

  const [feedbackMessage, setFeedbackMessage] = useState<UIMessage | null>(
    null,
  );

  // Per-message Langfuse trace IDs broadcast by Pal._closeTurnAndBroadcast.
  // Stored in a ref so the listener doesn't re-register on every update.
  // Grows across the page lifetime (not pruned on session switch); for
  // realistic usage the per-entry cost is tiny and v1 doesn't need
  // eviction — revisit if long-lived tabs become a memory issue.
  const traceIdsRef = useRef<Map<string, string>>(new Map());
  const [traceIdsVersion, setTraceIdsVersion] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as { type?: unknown }).type !== "pal_message_trace"
      ) {
        return;
      }
      const { messageId, traceId } = parsed as PalMessageTraceBroadcast;
      if (typeof messageId !== "string" || typeof traceId !== "string") {
        return;
      }
      // OTel trace IDs are 32 lowercase hex chars. Cheap defense-in-depth
      // against a malformed or hostile payload remapping a real message
      // to an attacker-controlled trace.
      if (!/^[0-9a-f]{32}$/.test(traceId)) return;
      traceIdsRef.current.set(messageId, traceId);
      setTraceIdsVersion((v) => v + 1);
    };
    agent.addEventListener("message", onMessage);
    return () => agent.removeEventListener("message", onMessage);
  }, [agent]);

  const getTraceId = useCallback(
    (messageId: string): string | undefined =>
      traceIdsRef.current.get(messageId),
    // traceIdsVersion bump keeps consumers re-evaluating when new
    // mappings arrive after first render.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see comment
    [traceIdsVersion],
  );

  const submitFeedback = useCallback(
    async (args: {
      messageId: string;
      traceId: string;
      expected: string;
      justification: string;
    }): Promise<SubmitFeedbackResult> => {
      return agent.stub.submitFeedback({
        messageId: args.messageId,
        traceId: args.traceId,
        expected: args.expected,
        justification: args.justification,
      });
    },
    [agent],
  );

  const handleSubmit = (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text) return;
    sendMessage({ text });
  };

  const newSession = async () => {
    await agent.stub.createSession();
  };

  const switchSession = async (id: string) => {
    if (id === activeId) return;
    await agent.stub.switchSession(id);
  };

  const renameSession = async (id: string, currentName: string) => {
    const next = window.prompt("Rename session", currentName);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentName) return;
    await agent.stub.renameSession(id, trimmed);
  };

  const deleteSession = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    await agent.stub.deleteSession(id);
  };

  const forkAt = async (messageId: string) => {
    if (!activeId) return;
    await agent.stub.forkSession(activeId, messageId);
  };

  return (
    <main className="mx-auto flex h-screen w-full max-w-6xl gap-4 p-4">
      <SessionSidebar
        sessions={sessions}
        activeId={activeId}
        onCreate={newSession}
        onSwitch={switchSession}
        onRename={renameSession}
        onDelete={deleteSession}
      />

      <ChatThread
        title={activeSession?.name ?? "Pal"}
        messages={messages}
        status={status}
        onSubmit={handleSubmit}
        onFork={forkAt}
        onFeedback={setFeedbackMessage}
      />

      <FeedbackDialog
        message={feedbackMessage}
        traceId={
          feedbackMessage ? getTraceId(feedbackMessage.id) : undefined
        }
        onSubmit={submitFeedback}
        onOpenChange={(open) => {
          if (!open) setFeedbackMessage(null);
        }}
      />
    </main>
  );
}
