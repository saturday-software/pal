import type { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "ai";
import { GitBranchIcon, MessageCircleIcon, ThumbsDownIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
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
import { cn } from "@/lib/utils";

type ChatHook = ReturnType<typeof useAgentChat>;
type ChatStatus = ChatHook["status"];

export type ChatThreadProps = {
  title: string;
  messages: UIMessage[];
  status: ChatStatus;
  onSubmit: (message: PromptInputMessage) => void;
  onFork: (messageId: string) => void;
  onFeedback: (message: UIMessage) => void;
};

export function ChatThread({
  title,
  messages,
  status,
  onSubmit,
  onFork,
  onFeedback,
}: ChatThreadProps) {
  return (
    <section className="flex flex-1 flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
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
              <Message from={m.role} key={m.id} className="relative">
                <MessageContent>
                  {m.parts.map((p, i) => {
                    if (p.type === "text") {
                      return (
                        <MessageResponse key={i}>{p.text}</MessageResponse>
                      );
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
                <MessageActions
                  className={cn(
                    "absolute -bottom-8 left-0 right-0 flex h-8 items-end px-1 opacity-0 transition-opacity group-hover:opacity-100",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <MessageAction
                    tooltip="Fork from here"
                    onClick={() => onFork(m.id)}
                    className="size-6 text-muted-foreground hover:text-foreground"
                  >
                    <GitBranchIcon className="size-3.5" />
                  </MessageAction>
                  {m.role === "assistant" ? (
                    <MessageAction
                      tooltip="Bad response"
                      onClick={() => onFeedback(m)}
                      className="size-6 text-muted-foreground hover:text-foreground"
                    >
                      <ThumbsDownIcon className="size-3.5" />
                    </MessageAction>
                  ) : null}
                </MessageActions>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput onSubmit={onSubmit}>
        <PromptInputBody>
          <PromptInputTextarea placeholder="Message Pal…" />
          <PromptInputFooter>
            <span />
            <PromptInputSubmit status={status} />
          </PromptInputFooter>
        </PromptInputBody>
      </PromptInput>
    </section>
  );
}
