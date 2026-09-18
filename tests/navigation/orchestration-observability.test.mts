import assert from "node:assert/strict";
import test from "node:test";

import {
  NavigatorStageError,
} from "../../src/lib/navigation/navigator-observability.ts";
import {
  orchestrateNavigatorResponse,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";

const messages = [{ role: "user" as const, content: "Тест" }];

function recommendMaslow() {
  return {
    state: "RECOMMEND_COURSE" as const,
    primaryCourseId: "maslow",
    secondaryCourseIds: [],
    learningNeed: "Понять индивидуальную мотивацию.",
    evidence: [{ messageIndex: 0, quote: "Тест" }],
    confidence: "sufficient" as const,
  };
}

function resolvedEvidence(): ResolvedCourseEvidence[] {
  return [
    {
      chunkId: 1,
      documentId: "doc",
      sourceId: "source",
      courseId: "maslow",
      sourceSlug: "source-slug",
      sourceTitle: "Source",
      sourceKind: "manuscript",
      authorityRelation: "FOUNDATIONAL",
      courseSourceMetadata: {},
      sourceMetadata: {},
      documentMetadata: {},
      content: "Индивидуальная мотивация зависит от актуальной потребности.",
      contentSha256: "a".repeat(64),
      headingPath: [],
      locator: {},
      chunkMetadata: {},
      similarity: 0.9,
      controllingAuthorityEntries: [],
      evidenceRole: "FOUNDATIONAL",
    },
  ];
}

async function expectStage(
  expectedStage:
    | "ACT_ROUTER"
    | "ROUTER"
    | "COURSE_RPC"
    | "AUTHORITY"
    | "EVIDENCE_LLM"
    | "COMPOSER",
  operation: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof NavigatorStageError);
    assert.equal(error.stage, expectedStage);
    return true;
  });
}

test("orchestrator classifies router failures as ROUTER", async () => {
  await expectStage("ROUTER", () =>
    orchestrateNavigatorResponse(messages, {
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
        route: async () => {
          throw new Error("router failure");
        },
      },
    }),
  );
});

test("orchestrator provides COURSE_RPC fallback for unclassified retrieval failures", async () => {
  await expectStage("COURSE_RPC", () =>
    orchestrateNavigatorResponse(messages, {
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
        route: async () => recommendMaslow(),
        retrieve: async () => {
          throw new Error("retrieval failure");
        },
      },
    }),
  );
});

test("orchestrator classifies authority resolution failures as AUTHORITY", async () => {
  await expectStage("AUTHORITY", () =>
    orchestrateNavigatorResponse(messages, {
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
        route: async () => recommendMaslow(),
        retrieve: async () => ({
          hasActiveSources: true,
          bindings: [],
          matches: [],
        }),
        resolve: () => {
          throw new Error("authority failure");
        },
      },
    }),
  );
});

test("orchestrator classifies evidence selector failures as EVIDENCE_LLM", async () => {
  await expectStage("EVIDENCE_LLM", () =>
    orchestrateNavigatorResponse(messages, {
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
        route: async () => recommendMaslow(),
        retrieve: async () => ({
          hasActiveSources: true,
          bindings: [],
          matches: [],
        }),
        resolve: () => resolvedEvidence(),
        selectEvidence: async () => {
          throw new Error("selector failure");
        },
      },
    }),
  );
});

test("orchestrator classifies composer failures as COMPOSER", async () => {
  await expectStage("COMPOSER", () =>
    orchestrateNavigatorResponse(messages, {
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
        route: async () => ({
          state: "ASK_MORE",
          candidateCourseIds: ["maslow"],
          questions: ["Что именно важно?"],
          rationale: "Need more.",
        }),
        compose: async () => {
          throw new Error("composer failure");
        },
      },
    }),
  );
});


test("orchestrator classifies conversation-act failures as ACT_ROUTER", async () => {
  await expectStage("ACT_ROUTER", () =>
    orchestrateNavigatorResponse(messages, {
      dependencies: {
        classifyAct: async () => {
          throw new Error("conversation-act failure");
        },
      },
    }),
  );
});
