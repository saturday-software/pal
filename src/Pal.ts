import { Session, Think } from "@cloudflare/think";
import { routeAgentRequest } from "agents";
import { AgentSearchProvider } from "agents/experimental/memory/session";
import { tool } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

export class Chat extends Think<Env> {
  override getModel() {
    return createWorkersAI({ binding: this.env.AI })(
      "@cf/moonshotai/kimi-k2.6",
    );
  }

  override configureSession(session: Session) {
    return session
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

  override getTools() {
    return {
      getCurrentTime: tool({
        description: "Get the current server time as an ISO 8601 string.",
        inputSchema: z.object({}),
        execute: async () => new Date().toISOString(),
      }),
    };
  }
}

export default {
  async fetch(request, env) {
    const agentResp = await routeAgentRequest(request, env);
    if (agentResp) return agentResp;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
