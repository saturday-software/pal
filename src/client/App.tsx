import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { MessageCircleIcon } from "lucide-react";

export function App() {
  const agent = useAgent({ agent: "chat" });
  const { messages, sendMessage, status } = useAgentChat({ agent });

  const handleSubmit = (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text) return;
    sendMessage({ text });
  };

  return (
    <main className="mx-auto flex h-screen w-full max-w-3xl flex-col p-4 gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Pal</h1>
      </header>

      <Conversation className="flex-1 rounded-xl border bg-card">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<MessageCircleIcon className="size-12" />}
              title="Say hello"
              description="Start a conversation with your Pal."
            />
          ) : (
            messages.map((m) => (
              <Message from={m.role} key={m.id}>
                <MessageContent>
                  {m.parts.map((p, i) => {
                    if (p.type === "text") {
                      return <MessageResponse key={i}>{p.text}</MessageResponse>;
                    }
                    if (p.type === "reasoning") {
                      const streaming =
                        status === "streaming" && m === messages.at(-1);
                      return (
                        <Reasoning key={i} isStreaming={streaming}>
                          <ReasoningTrigger />
                          <ReasoningContent>{p.text}</ReasoningContent>
                        </Reasoning>
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea placeholder="Message Pal…" />
          <PromptInputFooter>
            <span />
            <PromptInputSubmit status={status} />
          </PromptInputFooter>
        </PromptInputBody>
      </PromptInput>
    </main>
  );
}
