import {
  aiSdkHarness,
  aiSdkJudgeHarness,
  type AiSdkToolset,
} from "@vitest-evals/harness-ai-sdk";
import { env } from "cloudflare:workers";
import { generateText, stepCountIs } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import {
  PAL_KNOWLEDGE_DESCRIPTION,
  PAL_MEMORY_DESCRIPTION,
  PAL_MODEL_ID,
  PAL_SOUL,
} from "../src/agent-config";

const workersai = createWorkersAI({ binding: env.AI });

// In-memory mirror of the knowledge AgentSearchProvider used by the real
// Chat agent. Module-level so harness invocations share storage across
// `run()` calls (simulating durable storage that survives session
// switches). Reset between tests via `resetEvalKnowledge()`.
export const evalKnowledgeStore = new Map<string, string>();

export function resetEvalKnowledge(): void {
  evalKnowledgeStore.clear();
}

export function seedEvalKnowledge(entries: Record<string, string>): void {
  for (const [key, content] of Object.entries(entries)) {
    evalKnowledgeStore.set(key, content);
  }
}

function knowledgeListing(): string {
  if (evalKnowledgeStore.size === 0) return "";
  const recent = [...evalKnowledgeStore.keys()]
    .slice(0, 20)
    .map((k) => `- ${k}`)
    .join("\n");
  return `${evalKnowledgeStore.size} entries indexed. Recent:\n${recent}`;
}

function searchKnowledge(query: string): string {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  if (terms.length === 0) return "No results found.";

  const scored: Array<{ key: string; content: string; score: number }> = [];
  for (const [key, content] of evalKnowledgeStore) {
    const haystack = `${key}\n${content}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (haystack.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ key, content, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return "No results found.";
  return scored
    .slice(0, 10)
    .map((r) => `[${r.key}]\n${r.content}`)
    .join("\n\n");
}

// Builds the system prompt the same shape `Session.captureSnapshot()` would
// produce for our `SessionManager.create(this).withContext("soul")
// .withContext("memory").withContext("knowledge", { provider: new
// AgentSearchProvider(this) })` setup. The knowledge listing reflects what
// is currently in `evalKnowledgeStore`, so it updates between `run()` calls.
function buildPalSystem(): string {
  const sep = "═".repeat(46);
  const parts: string[] = [];

  parts.push(`${sep}\nSOUL\n${sep}\n${PAL_SOUL}`);

  // memory: writable, not searchable. captureSnapshot skips blocks with
  // empty content unless they're searchable — so an unwritten memory
  // block is omitted from the prompt in production. Mirror that here.

  const knowledge = knowledgeListing();
  parts.push(
    `${sep}\nKNOWLEDGE (${PAL_KNOWLEDGE_DESCRIPTION} — use search_context to search)\n${sep}\n${knowledge}`,
  );

  return parts.join("\n\n");
}

// Mirror of `createPalTools()` plus the `set_context` / `search_context`
// tools that SessionManager auto-wires when a knowledge context provider
// is present. Re-declared as a plain object (no `tool()` wrapper) so the
// harness can infer concrete arg types — `tool()` narrows zero-arg
// schemas to `never`, which trips the harness generics.
const palEvalTools = {
  getCurrentTime: {
    description: "Get the current server time as an ISO 8601 string.",
    inputSchema: z.object({}),
    execute: async () => new Date().toISOString(),
  },
  set_context: {
    description:
      `Write to a context block. Available blocks:\n` +
      `- "knowledge": searchable (requires key)\n\n` +
      `Writes are durable and persist across sessions.`,
    inputSchema: z.object({
      label: z.enum(["knowledge"]),
      content: z.string(),
      key: z.string(),
      action: z.enum(["replace", "append"]).optional(),
    }),
    execute: async ({ key, content }) => {
      evalKnowledgeStore.set(key, content);
      return `Indexed "${key}" in knowledge.`;
    },
  },
  search_context: {
    description:
      `Search for information in a searchable context block. ` +
      `Available searchable blocks: "knowledge".`,
    inputSchema: z.object({
      label: z.enum(["knowledge"]),
      query: z.string(),
    }),
    execute: async ({ query }) => searchKnowledge(query),
  },
} satisfies AiSdkToolset;

export const palHarness = aiSdkHarness({
  tools: palEvalTools,
  run: async ({ input, runtime }) =>
    generateText({
      model: workersai(PAL_MODEL_ID),
      system: buildPalSystem(),
      prompt: input,
      tools: runtime.tools,
      stopWhen: stepCountIs(5),
      temperature: 0,
    }),
  output: ({ result }) => result.text,
});

// Suppress unused-var lint for PAL_MEMORY_DESCRIPTION — kept exported so
// production/eval parity is obvious, but the memory block doesn't appear
// in the rendered prompt when empty (matches captureSnapshot behavior).
void PAL_MEMORY_DESCRIPTION;

// FactualityJudge uses structured output. Workers AI's Kimi endpoint
// intermittently returns HTML error pages under load, which crashes the
// judge. Llama 3.3 70B is the most reliable JSON-schema follower available
// on Workers AI for this workload.
const JUDGE_MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

export const palJudgeHarness = aiSdkJudgeHarness({
  model: workersai(JUDGE_MODEL_ID),
  temperature: 0,
});
