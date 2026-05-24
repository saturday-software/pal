import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import type { UIMessage } from "ai";
import { useState } from "react";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ChatThread } from "@/components/chat-thread";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { SessionSidebar } from "@/components/session-sidebar";
import type { ChatRpc, ChatState } from "../shared";

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
        onOpenChange={(open) => {
          if (!open) setFeedbackMessage(null);
        }}
      />
    </main>
  );
}
