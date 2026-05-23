# evals

[vitest-evals](https://github.com/getsentry/vitest-evals) suite for tuning Pal's
prompt, model, and tool surface.

Evals run inside the real Workers runtime via
[`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/),
so the `AI` binding is the same one production uses — no API tokens needed,
auth comes from your `wrangler` login.

## Run

```sh
bun run evals          # one-off
bun run evals:watch    # iterate on prompts/tools
bun run evals:verbose  # extra tool detail in the reporter
```

If you aren't logged in yet: `bun x wrangler login`.

## Layout

- `shared.ts` — eval harness wiring. Pulls the system prompt fragments and
  model id from [`src/agent-config.ts`](../src/agent-config.ts) so edits there
  flow into both production and evals. Uses `createWorkersAI({ binding: env.AI })`
  exactly like the agent does.
- `*.eval.ts` — eval suites. Each binds `palHarness` and combines direct
  `expect(...)` assertions on `result.output` / `toolCalls(result.session)`
  with a `FactualityJudge` rubric scored against `metadata.expected`.

## Tuning loop

1. Edit `src/agent-config.ts` (prompt fragments, tool descriptions, model id).
2. `bun run evals:watch` to see scores recompute.
3. Add cases with new `it(...)` blocks or `it.for([...])` tables.
