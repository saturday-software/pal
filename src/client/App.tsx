import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { useState } from "react";

export function App() {
  const agent = useAgent({ agent: "chat" });
  const { messages, sendMessage, status, isStreaming } = useAgentChat({
    agent,
  });
  const [input, setInput] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <main className="chat">
      <header>
        <h1>Pal</h1>
      </header>
      <ul className="messages">
        {messages.map((m) => (
          <li key={m.id} data-role={m.role}>
            <strong>{m.role}</strong>
            <div>
              {m.parts.map((p, i) =>
                p.type === "text" ? <span key={i}>{p.text}</span> : null,
              )}
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="composer">
        <input
          value={input}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setInput(e.target.value)
          }
          placeholder={isStreaming ? "Thinking…" : "Say something"}
          disabled={status === "submitted" || isStreaming}
        />
        <button type="submit" disabled={!input.trim()}>
          Send
        </button>
      </form>
    </main>
  );
}
