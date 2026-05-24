import { readFileSync } from "node:fs";
import {
  propagateAttributes,
  setLangfuseTracerProvider,
  startObservation,
} from "@langfuse/tracing";
import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { streamText } from "ai";
import {
  convertArrayToReadableStream,
  MockLanguageModelV3,
} from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";

// Guard against silent breakage of the OTel parent/child link between our
// per-turn span and the AI SDK's spans. Pal overrides Think's private
// `_runInferenceLoop` so it can bind an OTel context around the internal
// `streamText()` call (see src/Pal.ts). Two failure modes must produce a
// red test:
//
// 1. Our wrap pattern itself stops nesting AI SDK spans under the parent
//    span. The "wrap pattern" suite exercises the exact wrapping shape
//    used in `Chat._runInferenceLoop` against real AI SDK telemetry.
//
// 2. Think's internals move the `streamText()` call out of the synchronous
//    body of `_runInferenceLoop` (e.g. renamed, extracted to a helper
//    that's called after `_runInferenceLoop` returns). The "think
//    internals" suite catches that by reading Think's compiled JS and
//    asserting `streamText(` still appears in the body of the method we
//    override.
//
// Running the live Chat DO end-to-end with an in-memory exporter would be
// the strongest guard, but vitest-pool-workers currently fails to load
// the OTel module graph (extensionless ESM relative imports + node:process
// detection in @opentelemetry/resources). Until that resolves, the
// two-part guard above is the best replacement for pinning @cloudflare/think.

let provider: NodeTracerProvider;
let exporter: InMemorySpanExporter;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
  setLangfuseTracerProvider(provider);
});

describe("wrap pattern: ai SDK spans nest under pal-turn", () => {
  it("streamText spans become children of the pal-turn span", async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "0" },
          { type: "text-delta", id: "0", delta: "hello" },
          { type: "text-end", id: "0" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                total: 0,
                noCache: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ]),
      }),
    });

    // Mirror the exact wrap performed in `Chat._runInferenceLoop`.
    await propagateAttributes({ sessionId: "test-session" }, async () => {
      const turnSpan = startObservation("pal-turn", { input: "ping" });
      try {
        await context.with(
          trace.setSpan(context.active(), turnSpan.otelSpan),
          async () => {
            const result = streamText({
              model: mockModel,
              prompt: "ping",
              experimental_telemetry: { isEnabled: true, functionId: "test" },
            });
            // Drain the stream so the AI SDK actually emits spans.
            // biome-ignore lint/correctness/noUnusedVariables: drain
            for await (const _chunk of result.textStream) {
              // discard
            }
          },
        );
      } finally {
        turnSpan.update({ output: "hello" }).end();
        await provider.forceFlush();
      }
    });

    const spans = exporter.getFinishedSpans();
    const palTurn = spans.find((s) => s.name === "pal-turn");
    expect(palTurn, "pal-turn span must exist").toBeDefined();

    const aiSpans = spans.filter(
      (s) => s.instrumentationScope.name === "ai",
    );
    expect(
      aiSpans.length,
      "AI SDK should emit at least one span",
    ).toBeGreaterThan(0);

    const aiSpanIds = new Set(aiSpans.map((s) => s.spanContext().spanId));
    const aiRoots = aiSpans.filter(
      (s) =>
        !s.parentSpanContext || !aiSpanIds.has(s.parentSpanContext.spanId),
    );
    expect(aiRoots.length, "AI SDK should emit exactly one root span").toBe(1);

    const aiRoot = aiRoots[0]!;
    expect(
      aiRoot.parentSpanContext?.spanId,
      "AI SDK root must parent to pal-turn",
    ).toBe(palTurn!.spanContext().spanId);
    expect(
      aiRoot.spanContext().traceId,
      "AI SDK root must share the pal-turn trace",
    ).toBe(palTurn!.spanContext().traceId);
  });
});

// Extract a method body by brace-balanced scan from `methodName(`.
// Robust against indent-style changes (tabs vs spaces vs minification)
// and nested `{ }` blocks within the body — a regex anchor like `\n\t\}`
// would tie us to Think's current bundler formatting, and `\n\s*\}`
// would false-match the first nested closing brace.
function extractMethodBody(source: string, methodName: string): string | null {
  const start = source.indexOf(`${methodName}(`);
  if (start === -1) return null;
  const openBrace = source.indexOf("{", start);
  if (openBrace === -1) return null;
  let depth = 1;
  let i = openBrace + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return depth === 0 ? source.slice(openBrace + 1, i - 1) : null;
}

describe("think internals: streamText still lives inside _runInferenceLoop", () => {
  it("_runInferenceLoop's compiled body still calls streamText synchronously", async () => {
    // Resolve the compiled Think module via Node so this test follows
    // package.json `exports`/`main` resolution, not a hardcoded path.
    // We intentionally read the source rather than importing it —
    // `@cloudflare/think` has top-level `cloudflare:workers` imports that
    // can't load in plain Node.
    const thinkUrl = import.meta.resolve("@cloudflare/think");
    const path = new URL(thinkUrl).pathname;
    const source = readFileSync(path, "utf8");

    // If Think renames the method or extracts the `streamText` call into a
    // helper invoked after `_runInferenceLoop` returns — the failure mode
    // that breaks our OTel context wrap — this assertion stops matching.
    // If it suddenly starts failing after a Think bump, first check
    // whether Think's compiled output formatting changed (the extractor
    // is brace-balanced, but a top-level rename is the most likely cause).
    const body = extractMethodBody(source, "_runInferenceLoop");
    expect(body, "must find _runInferenceLoop method body").not.toBeNull();
    expect(
      body!,
      "_runInferenceLoop body must contain a streamText() call — if Think refactored this call out, the OTel context wrap in src/Pal.ts no longer covers it",
    ).toMatch(/streamText\s*\(/);
  });
});
