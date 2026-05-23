import { beforeEach, expect } from "vitest";
import { describeEval, FactualityJudge, toolCalls } from "vitest-evals";
import {
  evalKnowledgeStore,
  palHarness,
  palJudgeHarness,
  resetEvalKnowledge,
  seedEvalKnowledge,
} from "./shared";

const factualityJudge = FactualityJudge({ judgeHarness: palJudgeHarness });

describeEval(
  "pal — knowledge save",
  {
    harness: palHarness,
    judges: [factualityJudge],
    judgeThreshold: 0.6,
  },
  (it) => {
    beforeEach(() => {
      resetEvalKnowledge();
    });

    it("saves the user's name to knowledge", async ({ run }) => {
      const result = await run(
        "Please remember this for later: my name is Ada Lovelace.",
        {
          metadata: {
            expected:
              "Confirms that the user's name (Ada Lovelace) has been saved for future reference.",
          },
        },
      );

      const names = toolCalls(result.session).map((c) => c.name);
      expect(names).toContain("set_context");

      const entries = [...evalKnowledgeStore.values()].join("\n").toLowerCase();
      expect(entries).toContain("ada");
    });

    it("saves multiple personal facts to knowledge", async ({ run }) => {
      const result = await run(
        "Please remember these about me: my name is Ada Lovelace, I am 30 years old, and I live in Anytown, USA.",
        {
          metadata: {
            expected:
              "Confirms that the user's name (Ada Lovelace), age (30), and location (Anytown, USA) have been saved for future reference.",
          },
        },
      );

      const names = toolCalls(result.session).map((c) => c.name);
      expect(names).toContain("set_context");

      const entries = [...evalKnowledgeStore.values()].join("\n").toLowerCase();
      expect(entries).toContain("ada");
      expect(entries).toContain("30");
      expect(entries).toContain("anytown");
    });
  },
);

describeEval(
  "pal — knowledge recall",
  {
    harness: palHarness,
    judges: [factualityJudge],
    judgeThreshold: 0.6,
  },
  (it) => {
    beforeEach(() => {
      resetEvalKnowledge();
      seedEvalKnowledge({
        user_name: "The user's name is Ada Lovelace.",
        user_age: "The user is 30 years old.",
        user_location: "The user lives in Anytown, USA.",
      });
    });

    it("recalls the user's name from a fresh session", async ({ run }) => {
      const result = await run("What is my name?", {
        metadata: {
          expected: "The user's name is Ada Lovelace.",
        },
      });

      const names = toolCalls(result.session).map((c) => c.name);
      expect(names).toContain("search_context");
      expect(result.output?.toLowerCase()).toContain("ada");
    });

    it("recalls the user's age from a fresh session", async ({ run }) => {
      const result = await run("How old am I?", {
        metadata: {
          expected: "The user is 30 years old.",
        },
      });

      const names = toolCalls(result.session).map((c) => c.name);
      expect(names).toContain("search_context");
      expect(result.output).toContain("30");
    });

    it("recalls the user's location from a fresh session", async ({ run }) => {
      const result = await run("Where do I live?", {
        metadata: {
          expected: "The user lives in Anytown, USA.",
        },
      });

      const names = toolCalls(result.session).map((c) => c.name);
      expect(names).toContain("search_context");
      expect(result.output?.toLowerCase()).toContain("anytown");
    });
  },
);
