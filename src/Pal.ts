import { createAnthropic } from "@ai-sdk/anthropic";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { convertToModelMessages, streamText, tool } from "ai";
import { z } from "zod";

export interface Env {
  ANTHROPIC_API_TOKEN: string;
  ASSETS: Fetcher;
  Chat: DurableObjectNamespace<Chat>;
}

export class Chat extends AIChatAgent<Env> {
  override async onChatMessage(
    onFinish: Parameters<AIChatAgent<Env>["onChatMessage"]>[0],
  ) {
    const anthropic = createAnthropic({
      authToken: this.env.ANTHROPIC_API_TOKEN,
      headers: {
        "anthropic-beta": "oauth-2025-04-20,claude-code-20250219",
        "User-Agent": "claude-cli/1.0.119 (external, cli)",
        "x-app": "cli",
      },
    });
    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      maxOutputTokens: 4096,
      system:
        "You are Claude Code, Anthropic's official CLI for Claude.",
      messages: await convertToModelMessages(this.messages),
      tools: {
        getCurrentTime: tool({
          description: "Get the current server time as an ISO 8601 string.",
          inputSchema: z.object({}),
          execute: async () => new Date().toISOString(),
        }),
      },
      onFinish,
    });
    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request, env) {
    const agentResp = await routeAgentRequest(request, env);
    if (agentResp) return agentResp;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
