import type {
  CreateCommentRequest,
  CreateCommentResponse,
  CreateDatasetItemRequest,
  CreateDatasetRequest,
  Dataset,
  DatasetItem,
  ScoreBody,
} from "@langfuse/core";
import type { SubmitFeedbackInput, SubmitFeedbackResult } from "./shared";

/**
 * Name of the Langfuse dataset that collects user-reported expected
 * outputs. Each thumbs-down with a non-empty `expected` field appends
 * one DatasetItem so future eval runs (PR-4) can score new model
 * outputs against the rationale the user originally supplied.
 */
export const FEEDBACK_DATASET_NAME = "pal-user-feedback";

// Structural type for `LangfuseClient` covering only the surface this
// helper uses, so tests can pass a minimal mock without satisfying
// ScoreManager / LangfuseAPIClient's many private fields.
export interface FeedbackClient {
  score: { create(body: ScoreBody): void };
  api: {
    projects: { get(): Promise<{ data: { id: string }[] }> };
    comments: {
      create(req: CreateCommentRequest): Promise<CreateCommentResponse>;
    };
    datasets: { create(req: CreateDatasetRequest): Promise<Dataset> };
    datasetItems: {
      create(req: CreateDatasetItemRequest): Promise<DatasetItem>;
    };
  };
  flush(): Promise<void>;
}

// Per-field cap on user-supplied feedback text. The Langfuse Comments
// API caps `content` at 5000 chars (see CreateCommentRequest types).
// 2000 per field keeps both the trace Comment and the dataset item
// well within that and any plausible score-side limit, with no
// per-surface asymmetry that would surprise reviewers.
const FEEDBACK_FIELD_MAX = 2000;

function clampField(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.slice(0, FEEDBACK_FIELD_MAX);
}

// Module-level cache for the project ID associated with the configured
// API key. Same singleton-per-isolate reasoning as the LangfuseClient
// itself — costs one extra API call on the first submit per isolate,
// cached for the lifetime of the isolate after that.
let projectIdCache: string | undefined;

// Cache of dataset names we've already ensured exist this isolate.
// Langfuse's POST /v2/datasets is idempotent by name (returns the
// existing row on name collision), so calling create on every submit
// is correct — the Set just avoids the round-trip after the first.
const datasetEnsured = new Set<string>();

async function getProjectId(client: FeedbackClient): Promise<string> {
  if (projectIdCache) return projectIdCache;
  const projects = await client.api.projects.get();
  const id = projects.data[0]?.id;
  if (!id) throw new Error("Langfuse projects.get() returned no projects");
  projectIdCache = id;
  return id;
}

async function ensureDataset(
  client: FeedbackClient,
  name: string,
): Promise<void> {
  if (datasetEnsured.has(name)) return;
  await client.api.datasets.create({ name });
  // Only cache after a successful create — a transient failure should
  // be retried on the next submit, not silently skipped forever.
  datasetEnsured.add(name);
}

/**
 * Test-only: clear the module-level caches between test runs so that
 * "fetched/created once across submits" assertions aren't
 * order-dependent.
 */
export function __resetFeedbackCachesForTesting(): void {
  projectIdCache = undefined;
  datasetEnsured.clear();
}

export type FeedbackContext = {
  /**
   * The text of the user message immediately preceding the rated
   * assistant message. Used as `DatasetItem.input` when the user
   * provided an `expected` value. If absent, the dataset write is
   * skipped (and a warning is logged) — the score and trace Comment
   * still land.
   */
  originalInput?: string;
};

// Writes feedback to Langfuse using three primitives, each carrying
// the slice of feedback it was designed for:
//
//   1. Score (`user_feedback = -1`, load-bearing) — the numeric signal
//      future dataset/eval work pivots on. No comment field; the
//      structured text has dedicated homes below.
//   2. Trace Comment (best-effort, only when `justification` is set) —
//      the human-readable "why this was bad" rationale, visible on
//      the trace's Comments tab.
//   3. DatasetItem in `pal-user-feedback` (best-effort, only when
//      `expected` and `originalInput` are both available) — puts the
//      expected output in the canonical slot eval runs compare against.
//
// Score failure fails the whole submit; the other two fail open so
// the user isn't told "submission failed" when their programmatic
// signal landed fine. All errors are logged for operator visibility.
export async function submitFeedbackImpl(
  client: FeedbackClient,
  input: SubmitFeedbackInput,
  context: FeedbackContext = {},
): Promise<SubmitFeedbackResult> {
  const messageId =
    typeof input?.messageId === "string" ? input.messageId.trim() : "";
  const traceId =
    typeof input?.traceId === "string" ? input.traceId.trim() : "";
  const expected = clampField(input?.expected);
  const justification = clampField(input?.justification);

  if (!messageId) return { ok: false, error: "Missing message id." };
  if (!traceId) return { ok: false, error: "Missing trace id." };
  if (!expected && !justification) {
    return {
      ok: false,
      error: "Tell Pal what you expected or why this response was bad.",
    };
  }

  try {
    client.score.create({
      traceId,
      name: "user_feedback",
      value: -1,
      dataType: "NUMERIC",
      metadata: { messageId },
    });
    await client.flush();
  } catch (err) {
    console.error("[pal] score.create failed", err);
    return {
      ok: false,
      error: "Failed to submit feedback. Please try again.",
    };
  }

  // Score landed. The next two are best-effort from here.

  if (justification) {
    try {
      const projectId = await getProjectId(client);
      await client.api.comments.create({
        projectId,
        objectType: "TRACE",
        objectId: traceId,
        content: justification,
      });
    } catch (err) {
      console.error("[pal] comment write failed (score still landed)", err);
    }
  }

  if (expected) {
    if (!context.originalInput) {
      console.warn(
        "[pal] dataset item skipped: no originalInput resolved for messageId",
        messageId,
      );
    } else {
      try {
        await ensureDataset(client, FEEDBACK_DATASET_NAME);
        await client.api.datasetItems.create({
          datasetName: FEEDBACK_DATASET_NAME,
          input: context.originalInput,
          expectedOutput: expected,
          metadata: { messageId, traceId, justification },
          sourceTraceId: traceId,
        });
      } catch (err) {
        console.error(
          "[pal] dataset item write failed (score still landed)",
          err,
        );
      }
    }
  }

  return { ok: true };
}
