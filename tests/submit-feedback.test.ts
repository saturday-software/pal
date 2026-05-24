import type {
  CreateCommentRequest,
  CreateCommentResponse,
  CreateDatasetItemRequest,
  CreateDatasetRequest,
  Dataset,
  DatasetItem,
  ScoreBody,
} from "@langfuse/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  __resetFeedbackCachesForTesting,
  FEEDBACK_DATASET_NAME,
  type FeedbackClient,
  submitFeedbackImpl,
} from "../src/feedback";

// `submitFeedbackImpl` is the testable extract of the @callable
// `submitFeedback` method on Chat. We exercise it against a mocked
// LangfuseClient surface to assert:
//   - input validation rejects missing trace/message/content cleanly
//   - the score is the load-bearing primitive (no comment field)
//   - the trace Comment is written with just the justification text
//   - the DatasetItem lands in the right dataset with input/expected/
//     metadata/sourceTraceId
//   - the projectId fetch and dataset.create are each cached
//   - score failure fails the submit; comment / dataset failures don't
//   - missing originalInput silently skips the dataset write

type MockClient = FeedbackClient & {
  score: { create: Mock<(body: ScoreBody) => void> };
  api: {
    projects: { get: Mock<() => Promise<{ data: { id: string }[] }>> };
    comments: {
      create: Mock<
        (req: CreateCommentRequest) => Promise<CreateCommentResponse>
      >;
    };
    datasets: { create: Mock<(req: CreateDatasetRequest) => Promise<Dataset>> };
    datasetItems: {
      create: Mock<(req: CreateDatasetItemRequest) => Promise<DatasetItem>>;
    };
  };
  flush: Mock<() => Promise<void>>;
};

function makeClient(overrides?: {
  flush?: Mock<() => Promise<void>>;
  projectsGet?: Mock<() => Promise<{ data: { id: string }[] }>>;
  commentsCreate?: Mock<
    (req: CreateCommentRequest) => Promise<CreateCommentResponse>
  >;
  datasetsCreate?: Mock<(req: CreateDatasetRequest) => Promise<Dataset>>;
  datasetItemsCreate?: Mock<
    (req: CreateDatasetItemRequest) => Promise<DatasetItem>
  >;
}): MockClient {
  return {
    score: { create: vi.fn<(body: ScoreBody) => void>() },
    api: {
      projects: {
        get:
          overrides?.projectsGet ??
          vi
            .fn<() => Promise<{ data: { id: string }[] }>>()
            .mockResolvedValue({ data: [{ id: "test-project-id" }] }),
      },
      comments: {
        create:
          overrides?.commentsCreate ??
          vi
            .fn<(req: CreateCommentRequest) => Promise<CreateCommentResponse>>()
            .mockResolvedValue({ id: "comment-id" }),
      },
      datasets: {
        create:
          overrides?.datasetsCreate ??
          vi
            .fn<(req: CreateDatasetRequest) => Promise<Dataset>>()
            .mockResolvedValue({ id: "ds-id" } as Dataset),
      },
      datasetItems: {
        create:
          overrides?.datasetItemsCreate ??
          vi
            .fn<(req: CreateDatasetItemRequest) => Promise<DatasetItem>>()
            .mockResolvedValue({ id: "ds-item-id" } as DatasetItem),
      },
    },
    flush:
      overrides?.flush ??
      vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  // Module-level projectId + dataset caches would otherwise leak
  // across tests and make the "cached across submits" assertions
  // order-dependent.
  __resetFeedbackCachesForTesting();
});

describe("submitFeedbackImpl validation", () => {
  it("rejects missing messageId without touching Langfuse", async () => {
    const client = makeClient();
    const result = await submitFeedbackImpl(client, {
      messageId: "",
      traceId: "trace-1",
      justification: "bad",
    });
    expect(result).toEqual({ ok: false, error: "Missing message id." });
    expect(client.score.create).not.toHaveBeenCalled();
    expect(client.flush).not.toHaveBeenCalled();
    expect(client.api.comments.create).not.toHaveBeenCalled();
    expect(client.api.datasetItems.create).not.toHaveBeenCalled();
  });

  it("rejects missing traceId without touching Langfuse", async () => {
    const client = makeClient();
    const result = await submitFeedbackImpl(client, {
      messageId: "msg-1",
      traceId: "",
      justification: "bad",
    });
    expect(result).toEqual({ ok: false, error: "Missing trace id." });
    expect(client.score.create).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only messageId and traceId", async () => {
    const client = makeClient();
    const result = await submitFeedbackImpl(client, {
      messageId: "   ",
      traceId: "trace-1",
      justification: "bad",
    });
    expect(result.ok).toBe(false);
    expect(client.score.create).not.toHaveBeenCalled();
  });

  it("rejects empty content (both expected and justification blank)", async () => {
    const client = makeClient();
    const result = await submitFeedbackImpl(client, {
      messageId: "msg-1",
      traceId: "trace-1",
      expected: "",
      justification: "   ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/what you expected|why/i);
    }
    expect(client.score.create).not.toHaveBeenCalled();
  });
});

describe("submitFeedbackImpl score primitive", () => {
  it("writes user_feedback score with no comment field", async () => {
    const client = makeClient();
    const result = await submitFeedbackImpl(
      client,
      {
        messageId: "msg-1",
        traceId: "trace-abc",
        justification: "It hallucinated",
      },
      { originalInput: "ignored here" },
    );

    expect(result).toEqual({ ok: true });
    expect(client.score.create).toHaveBeenCalledTimes(1);
    const arg = client.score.create.mock.calls[0]![0];
    expect(arg).toEqual({
      traceId: "trace-abc",
      name: "user_feedback",
      value: -1,
      dataType: "NUMERIC",
      metadata: { messageId: "msg-1" },
    });
    expect(arg.comment).toBeUndefined();
    expect(client.flush).toHaveBeenCalledTimes(1);
  });
});

describe("submitFeedbackImpl trace Comment primitive", () => {
  it("writes the justification text as the comment content (no header)", async () => {
    const client = makeClient();
    const result = await submitFeedbackImpl(client, {
      messageId: "msg-1",
      traceId: "trace-abc",
      justification: "It hallucinated the price",
    });

    expect(result).toEqual({ ok: true });
    expect(client.api.comments.create).toHaveBeenCalledTimes(1);
    const commentArg = client.api.comments.create.mock.calls[0]![0];
    expect(commentArg).toEqual({
      projectId: "test-project-id",
      objectType: "TRACE",
      objectId: "trace-abc",
      content: "It hallucinated the price",
    });
  });

  it("does not write a Comment when justification is empty", async () => {
    const client = makeClient();
    const result = await submitFeedbackImpl(
      client,
      {
        messageId: "msg-1",
        traceId: "trace-abc",
        expected: "the right answer",
        justification: "",
      },
      { originalInput: "original q" },
    );

    expect(result).toEqual({ ok: true });
    expect(client.api.comments.create).not.toHaveBeenCalled();
  });

  it("caches projectId across multiple submits", async () => {
    const client = makeClient();
    for (let i = 0; i < 3; i++) {
      const result = await submitFeedbackImpl(client, {
        messageId: `msg-${i}`,
        traceId: `trace-${i}`,
        justification: `submission ${i}`,
      });
      expect(result).toEqual({ ok: true });
    }
    expect(client.api.projects.get).toHaveBeenCalledTimes(1);
    expect(client.api.comments.create).toHaveBeenCalledTimes(3);
  });
});

describe("submitFeedbackImpl DatasetItem primitive", () => {
  it("creates a DatasetItem with expected/input/metadata/sourceTraceId", async () => {
    const client = makeClient();
    const result = await submitFeedbackImpl(
      client,
      {
        messageId: "msg-1",
        traceId: "trace-abc",
        expected: "Should have refused to answer.",
        justification: "It hallucinated.",
      },
      { originalInput: "What's the price?" },
    );

    expect(result).toEqual({ ok: true });
    expect(client.api.datasetItems.create).toHaveBeenCalledTimes(1);
    const itemArg = client.api.datasetItems.create.mock.calls[0]![0];
    expect(itemArg).toEqual({
      datasetName: FEEDBACK_DATASET_NAME,
      input: "What's the price?",
      expectedOutput: "Should have refused to answer.",
      metadata: {
        messageId: "msg-1",
        traceId: "trace-abc",
        justification: "It hallucinated.",
      },
      sourceTraceId: "trace-abc",
    });
  });

  it("skips the DatasetItem write when expected is empty", async () => {
    const client = makeClient();
    const result = await submitFeedbackImpl(
      client,
      {
        messageId: "msg-1",
        traceId: "trace-abc",
        justification: "It was bad",
      },
      { originalInput: "original q" },
    );

    expect(result).toEqual({ ok: true });
    expect(client.api.datasets.create).not.toHaveBeenCalled();
    expect(client.api.datasetItems.create).not.toHaveBeenCalled();
  });

  it("skips the DatasetItem write when originalInput is missing, with warning", async () => {
    const client = makeClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await submitFeedbackImpl(client, {
      messageId: "msg-1",
      traceId: "trace-abc",
      expected: "a better answer",
    });

    expect(result).toEqual({ ok: true });
    expect(client.api.datasetItems.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("calls datasets.create once across multiple submits (cached)", async () => {
    const client = makeClient();
    for (let i = 0; i < 3; i++) {
      const result = await submitFeedbackImpl(
        client,
        {
          messageId: `msg-${i}`,
          traceId: `trace-${i}`,
          expected: `expected-${i}`,
        },
        { originalInput: `input-${i}` },
      );
      expect(result).toEqual({ ok: true });
    }
    expect(client.api.datasets.create).toHaveBeenCalledTimes(1);
    expect(client.api.datasets.create).toHaveBeenCalledWith({
      name: FEEDBACK_DATASET_NAME,
    });
    expect(client.api.datasetItems.create).toHaveBeenCalledTimes(3);
  });

  it("retries datasets.create on next submit after a transient failure", async () => {
    const datasetsCreate = vi
      .fn<(req: CreateDatasetRequest) => Promise<Dataset>>()
      .mockRejectedValueOnce(new Error("flaky"))
      .mockResolvedValue({ id: "ds-id" } as Dataset);
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const client = makeClient({ datasetsCreate });

    const first = await submitFeedbackImpl(
      client,
      {
        messageId: "msg-1",
        traceId: "trace-1",
        expected: "exp",
      },
      { originalInput: "in" },
    );
    expect(first).toEqual({ ok: true });
    // First attempt failed → item create skipped, but cache was not
    // populated, so the next submit retries.
    expect(client.api.datasetItems.create).not.toHaveBeenCalled();

    const second = await submitFeedbackImpl(
      client,
      {
        messageId: "msg-2",
        traceId: "trace-2",
        expected: "exp",
      },
      { originalInput: "in" },
    );
    expect(second).toEqual({ ok: true });
    expect(datasetsCreate).toHaveBeenCalledTimes(2);
    expect(client.api.datasetItems.create).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});

describe("submitFeedbackImpl field clamping", () => {
  it("clamps oversized fields to fit Langfuse Comments content limit", async () => {
    const client = makeClient();
    const huge = "x".repeat(10_000);
    const result = await submitFeedbackImpl(
      client,
      {
        messageId: "msg-1",
        traceId: "trace-abc",
        expected: huge,
        justification: huge,
      },
      { originalInput: "in" },
    );

    expect(result).toEqual({ ok: true });
    const commentArg = client.api.comments.create.mock.calls[0]![0];
    expect(commentArg.content.length).toBeLessThan(5000);
    expect(commentArg.content.length).toBeLessThan(huge.length);

    const itemArg = client.api.datasetItems.create.mock.calls[0]![0];
    expect((itemArg.expectedOutput as string).length).toBeLessThan(5000);
  });
});

describe("submitFeedbackImpl failure handling", () => {
  it("returns a generic error when the score write fails", async () => {
    const flush = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("network exploded"));
    const client = makeClient({ flush });
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await submitFeedbackImpl(client, {
      messageId: "msg-1",
      traceId: "trace-abc",
      justification: "x",
    });

    expect(result).toEqual({
      ok: false,
      error: "Failed to submit feedback. Please try again.",
    });
    expect(consoleSpy).toHaveBeenCalled();
    // Best-effort writes must not be attempted when the score write failed.
    expect(client.api.comments.create).not.toHaveBeenCalled();
    expect(client.api.datasetItems.create).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("reports success when the trace Comment fails after the score landed", async () => {
    const commentsCreate = vi
      .fn<(req: CreateCommentRequest) => Promise<CreateCommentResponse>>()
      .mockRejectedValue(new Error("comments endpoint down"));
    const client = makeClient({ commentsCreate });
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await submitFeedbackImpl(client, {
      messageId: "msg-1",
      traceId: "trace-abc",
      justification: "x",
    });

    expect(result).toEqual({ ok: true });
    expect(client.score.create).toHaveBeenCalledTimes(1);
    expect(client.api.comments.create).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("reports success when projectId resolution fails (Comment skipped, score still landed)", async () => {
    const projectsGet = vi
      .fn<() => Promise<{ data: { id: string }[] }>>()
      .mockRejectedValue(new Error("projects endpoint down"));
    const client = makeClient({ projectsGet });
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await submitFeedbackImpl(client, {
      messageId: "msg-1",
      traceId: "trace-abc",
      justification: "x",
    });

    expect(result).toEqual({ ok: true });
    expect(client.score.create).toHaveBeenCalledTimes(1);
    expect(client.api.comments.create).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("reports success when the DatasetItem write fails after the score landed", async () => {
    const datasetItemsCreate = vi
      .fn<(req: CreateDatasetItemRequest) => Promise<DatasetItem>>()
      .mockRejectedValue(new Error("dataset items endpoint down"));
    const client = makeClient({ datasetItemsCreate });
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await submitFeedbackImpl(
      client,
      {
        messageId: "msg-1",
        traceId: "trace-abc",
        expected: "a better answer",
      },
      { originalInput: "the original question" },
    );

    expect(result).toEqual({ ok: true });
    expect(client.score.create).toHaveBeenCalledTimes(1);
    expect(client.api.datasets.create).toHaveBeenCalledTimes(1);
    expect(client.api.datasetItems.create).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
