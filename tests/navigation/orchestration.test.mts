import assert from "node:assert/strict";
import test from "node:test";

import {
  orchestrateNavigatorResponse,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";
import {
  CourseEvidenceSelectionError,
} from "../../src/lib/knowledge/retrieval/evidence-selector.ts";

const messages = [{ role: "user" as const, content: "Тест" }];

test("ASK_MORE never calls deep course retrieval or evidence selection", async () => {
  let retrievalCalls = 0;
  let selectorCalls = 0;

  const result = await orchestrateNavigatorResponse(messages, {
    dependencies: {
      route: async () => ({
        state: "ASK_MORE",
        candidateCourseIds: ["maslow", "normative-situation"],
        questions: ["Что именно происходит?"],
        rationale: "Ambiguous.",
      }),
      retrieve: async () => {
        retrievalCalls += 1;
        throw new Error("should not retrieve");
      },
      selectEvidence: async () => {
        selectorCalls += 1;
        throw new Error("should not select evidence");
      },
      compose: async () => "Уточняющий вопрос",
    },
  });

  assert.equal(result.decision.state, "ASK_MORE");
  assert.equal(retrievalCalls, 0);
  assert.equal(selectorCalls, 0);
  assert.equal(result.evidenceSelectionStatus, "NOT_RUN");
});

test("NO_CURRENT_COURSE_MATCH never calls deep course retrieval or evidence selection", async () => {
  let retrievalCalls = 0;
  let selectorCalls = 0;

  const result = await orchestrateNavigatorResponse(messages, {
    dependencies: {
      route: async () => ({
        state: "NO_CURRENT_COURSE_MATCH",
        rationale: "Outside catalog.",
      }),
      retrieve: async () => {
        retrievalCalls += 1;
        throw new Error("should not retrieve");
      },
      selectEvidence: async () => {
        selectorCalls += 1;
        throw new Error("should not select evidence");
      },
      compose: async () => "Нет текущего курса",
    },
  });

  assert.equal(result.decision.state, "NO_CURRENT_COURSE_MATCH");
  assert.equal(retrievalCalls, 0);
  assert.equal(selectorCalls, 0);
  assert.equal(result.evidenceSelectionStatus, "NOT_RUN");
});

test("routable course with zero deep sources remains recommendable and selector does not run", async () => {
  let requestedCourseId = "";
  let selectorCalls = 0;

  const result = await orchestrateNavigatorResponse(messages, {
    dependencies: {
      route: async () => ({
        state: "RECOMMEND_COURSE",
        primaryCourseId: "normative-situation",
        secondaryCourseIds: [],
        learningNeed: "Понять нормы, ответственность и ручное управление.",
        evidence: [{ messageIndex: 0, quote: "Тест" }],
        confidence: "strong",
      }),
      retrieve: async (courseId) => {
        requestedCourseId = courseId;
        return {
          hasActiveSources: false,
          bindings: [],
          matches: [],
        };
      },
      selectEvidence: async () => {
        selectorCalls += 1;
        throw new Error("selector should not run");
      },
      compose: async (_messages, decision, options) => {
        assert.equal(decision.state, "RECOMMEND_COURSE");
        assert.equal(options.hasActiveCourseSources, false);
        assert.equal(options.evidenceSelection, undefined);
        return "Нормативная ситуация";
      },
    },
  });

  assert.equal(requestedCourseId, "normative-situation");
  assert.equal(selectorCalls, 0);
  assert.equal(result.courseHadActiveSources, false);
  assert.equal(result.evidenceSelectionStatus, "NOT_RUN");
});

test("Maslow uses the same generic retrieval path and selected RAG evidence reaches composer", async () => {
  let requestedCourseId = "";
  let selectorCalls = 0;

  const resolved: ResolvedCourseEvidence[] = [
    {
      chunkId: 1,
      documentId: "doc",
      sourceId: "source",
      courseId: "maslow",
      sourceSlug: "maslow-new-paradigm",
      sourceTitle: "Manuscript",
      sourceKind: "manuscript",
      authorityRelation: "FOUNDATIONAL",
      courseSourceMetadata: {},
      sourceMetadata: {},
      documentMetadata: {},
      content: "Мотивация меняется под влиянием контекста.",
      contentSha256: "a".repeat(64),
      headingPath: [],
      locator: {},
      chunkMetadata: {},
      similarity: 0.9,
      controllingAuthorityEntries: [],
      evidenceRole: "FOUNDATIONAL",
    },
  ];

  const result = await orchestrateNavigatorResponse(messages, {
    dependencies: {
      route: async () => ({
        state: "RECOMMEND_COURSE",
        primaryCourseId: "maslow",
        secondaryCourseIds: [],
        learningNeed: "Понять изменение мотивации под влиянием контекста.",
        evidence: [{ messageIndex: 0, quote: "Тест" }],
        confidence: "sufficient",
      }),
      retrieve: async (courseId) => {
        requestedCourseId = courseId;
        return {
          hasActiveSources: true,
          bindings: [],
          matches: [],
        };
      },
      resolve: () => resolved,
      selectEvidence: async (_learningNeed, evidence) => {
        selectorCalls += 1;
        assert.equal(evidence[0].chunkId, 1);
        return {
          status: "SUPPORTED",
          evidence: [
            {
              chunkId: 1,
              quote: "Мотивация меняется под влиянием контекста",
            },
          ],
        };
      },
      compose: async (_messages, _decision, options) => {
        assert.equal(options.evidenceSelection?.status, "SUPPORTED");
        assert.equal(options.courseEvidence?.[0].chunkId, 1);
        return "Маслоу";
      },
    },
  });

  assert.equal(requestedCourseId, "maslow");
  assert.equal(selectorCalls, 1);
  assert.equal(result.courseHadActiveSources, true);
  assert.equal(result.evidenceSelectionStatus, "SUPPORTED");
});


test("invalid evidence selection degrades to INSUFFICIENT without discarding the routed course", async () => {
  const resolved: ResolvedCourseEvidence[] = [
    {
      chunkId: 7,
      documentId: "doc",
      sourceId: "source",
      courseId: "maslow",
      sourceSlug: "maslow-new-paradigm",
      sourceTitle: "Manuscript",
      sourceKind: "manuscript",
      authorityRelation: "FOUNDATIONAL",
      courseSourceMetadata: {},
      sourceMetadata: {},
      documentMetadata: {},
      content: "Мотивация зависит от актуальной потребности.",
      contentSha256: "b".repeat(64),
      headingPath: [],
      locator: {},
      chunkMetadata: {},
      similarity: 0.92,
      controllingAuthorityEntries: [],
      evidenceRole: "FOUNDATIONAL",
    },
  ];

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...values: unknown[]) => {
    warnings.push(values.map(String).join(" "));
  };

  try {
    const result = await orchestrateNavigatorResponse(messages, {
      requestId: "request-evidence-degraded",
      dependencies: {
        route: async () => ({
          state: "RECOMMEND_COURSE",
          primaryCourseId: "maslow",
          secondaryCourseIds: [],
          learningNeed: "Понять индивидуальную мотивацию.",
          evidence: [{ messageIndex: 0, quote: "Тест" }],
          confidence: "sufficient",
        }),
        retrieve: async () => ({
          hasActiveSources: true,
          bindings: [],
          matches: [],
        }),
        resolve: () => resolved,
        selectEvidence: async () => {
          throw new CourseEvidenceSelectionError(
            "Evidence quote is not verbatim grounded.",
          );
        },
        compose: async (_messages, decision, options) => {
          assert.equal(decision.state, "RECOMMEND_COURSE");
          assert.equal(decision.primaryCourseId, "maslow");
          assert.deepEqual(options.evidenceSelection, {
            status: "INSUFFICIENT",
            evidence: [],
          });
          assert.equal(options.courseEvidence?.[0].chunkId, 7);
          return "Маслоу без неподтверждённой RAG-цитаты";
        },
      },
    });

    assert.equal(result.message, "Маслоу без неподтверждённой RAG-цитаты");
    assert.equal(result.decision.state, "RECOMMEND_COURSE");
    assert.equal(result.courseHadActiveSources, true);
    assert.equal(result.evidenceSelectionStatus, "INSUFFICIENT");

    assert.equal(warnings.length, 1);
    const event = JSON.parse(warnings[0]) as Record<string, unknown>;
    assert.deepEqual(event, {
      event: "NAVIGATOR_DEGRADATION",
      requestId: "request-evidence-degraded",
      stage: "EVIDENCE_LLM",
      provider: "DEEPSEEK",
      fallback: "INSUFFICIENT",
      errorName: "CourseEvidenceSelectionError",
      errorCode: "INVALID_COURSE_EVIDENCE_SELECTION",
      status: null,
    });
  } finally {
    console.warn = originalWarn;
  }
});
