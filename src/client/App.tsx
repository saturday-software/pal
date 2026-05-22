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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  GitBranchIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import type { ChatRpc, ChatState } from "../shared";

export function App() {
  const agent = useAgent<ChatRpc, ChatState>({ agent: "chat" });
  const { messages, sendMessage, status } = useAgentChat({ agent });

  const state = agent.state;
  const sessions = state?.sessions ?? [];
  const activeId = state?.activeSessionId ?? "";
  const activeSession = sessions.find((s) => s.id === activeId);

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
      <aside className="flex w-64 shrink-0 flex-col gap-2 rounded-xl border bg-card p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Sessions</h2>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={newSession}
            aria-label="New session"
            title="New session"
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No sessions yet.
            </p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                  s.id === activeId
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => switchSession(s.id)}
                  className="flex-1 truncate text-left"
                  title={s.name}
                >
                  {s.name}
                  {s.parent_session_id ? (
                    <GitBranchIcon className="ml-1 inline size-3 align-text-bottom opacity-60" />
                  ) : null}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                      aria-label="Session actions"
                    >
                      <MoreHorizontalIcon className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => renameSession(s.id, s.name)}
                    >
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => deleteSession(s.id, s.name)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          )}
        </div>
      </aside>

      <section className="flex flex-1 flex-col gap-4">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">
            {activeSession?.name ?? "Pal"}
          </h1>
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
                      onClick={() => forkAt(m.id)}
                      className="size-6 text-muted-foreground hover:text-foreground"
                    >
                      <GitBranchIcon className="size-3.5" />
                    </MessageAction>
                  </MessageActions>
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
      </section>
    </main>
  );
}
