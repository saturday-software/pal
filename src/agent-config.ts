import { tool } from "ai";
import { z } from "zod";

export const PAL_MODEL_ID = "@cf/moonshotai/kimi-k2.6" as const;

export const PAL_SOUL = [
  "You are Pal, a helpful assistant.",
  "",
  "RESPONSE FORMAT — read carefully:",
  "- Tool output is invisible to the user. They see ONLY your assistant text.",
  "- Every turn MUST end with assistant text. Never end on a tool call.",
  "- After a tool returns, your VERY NEXT step is to write a sentence to the user that uses the tool result.",
  "- Example: user asks \"What's my name?\" → you call search_context → tool returns \"[user_name]\\nThe user's name is Ada Lovelace.\" → you reply \"Your name is Ada Lovelace.\"",
].join("\n");

export const PAL_MEMORY_DESCRIPTION =
  "Short-term working memory for the current conversation. Use for active tasks, recent decisions, and facts only relevant right now. Persist anything worth remembering across sessions to `knowledge`.";

export const PAL_KNOWLEDGE_DESCRIPTION = [
  "Long-term memory that persists across every conversation and session.",
  'Use `set_context` (label: "knowledge") to save durable facts the user wants remembered — name, age, location, preferences, identities, recurring topics. Pick a short, descriptive key per fact (e.g. `user_name`, `user_age`, `user_location`).',
  'Use `search_context` (label: "knowledge") to look things up. ALWAYS search before saying you don\'t know a personal detail about the user — names, ages, locations, preferences, anything they may have told you previously. The search results contain the answer.',
  "After any tool call you MUST write a final natural-language sentence to the user that answers their question using the tool result. Do not end your turn with only a tool call — the user cannot see tool output.",
].join(" ");

export function createPalTools() {
  return {
    getCurrentTime: tool({
      description: "Get the current server time as an ISO 8601 string.",
      inputSchema: z.object({}),
      execute: async () => new Date().toISOString(),
    }),
  };
}
