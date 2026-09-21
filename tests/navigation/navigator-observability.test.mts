import assert from "node:assert/strict";
import test from "node:test";

import {
  createNavigatorDegradationLog,
  createNavigatorFailureLog,
  createNavigatorTurnLog,
  isRecoverableEvidenceSelectionFailure,
  NavigatorStageError,
  withNavigatorStage,
} from "../../src/lib/navigation/navigator-observability.ts";
import {
  CourseEvidenceSelectionError,
} from "../../src/lib/knowledge/retrieval/evidence-selector.ts";

test("navigator success log is closed, bounded, and privacy safe", () => {
  const secretMarker = "synthetic-secret-marker-never-log";
  const input = {
    lane: "ORCHESTRATION" as const,
    conversationAct: "COURSE_FOLLOW_UP" as const,
    decision: null,
    courseId: "maslow",
    ragInvoked: true,
    authorityResolved: true,
    activeBindingCount: 1,
    bindingSourceSlugs: ["maslow-foundational"],
    retrievedMatchCount: 4,
    resolvedEvidenceCount: 2,
    selectedEvidence: [
      {
        chunkId: 17,
        sourceSlug: "maslow-foundational",
        authorityRelation: "FOUNDATIONAL",
      },
    ],
    evidenceSelectionStatus: "SUPPORTED" as const,
    answerOrigin: "RAG_EVIDENCE" as const,
    fallback: "NONE" as const,
    crossCourseLeakageDetected: false,
    rawMessage: secretMarker,
    prompt: secretMarker,
    quote: secretMarker,
    chunkContent: secretMarker,
    providerBody: secretMarker,
  };

  const log = createNavigatorTurnLog("trace-123", input);
  assert.deepEqual(Object.keys(log).sort(), [
    "activeBindingCount",
    "answerOrigin",
    "authorityResolved",
    "bindingSourceSlugs",
    "conversationAct",
    "courseId",
    "crossCourseLeakageDetected",
    "decision",
    "event",
    "evidenceSelectionStatus",
    "fallback",
    "lane",
    "ragInvoked",
    "requestId",
    "resolvedEvidenceCount",
    "retrievedMatchCount",
    "selectedEvidence",
  ].sort());
  assert.equal(JSON.stringify(log).includes(secretMarker), false);
});

test("navigator success log rejects leakage and selector overflow", () => {
  const base = {
    lane: "ORCHESTRATION" as const,
    conversationAct: "COURSE_FOLLOW_UP" as const,
    decision: null,
    courseId: "maslow",
    ragInvoked: true,
    authorityResolved: true,
    activeBindingCount: 1,
    bindingSourceSlugs: ["source"],
    retrievedMatchCount: 1,
    resolvedEvidenceCount: 1,
    selectedEvidence: [],
    evidenceSelectionStatus: "SUPPORTED" as const,
    answerOrigin: "RAG_EVIDENCE" as const,
    fallback: "NONE" as const,
    crossCourseLeakageDetected: false,
  };

  assert.throws(
    () => createNavigatorTurnLog("trace", {
      ...base,
      crossCourseLeakageDetected: true,
    }),
    /Cross-course evidence/u,
  );
  assert.throws(
    () => createNavigatorTurnLog("trace", {
      ...base,
      selectedEvidence: Array.from({ length: 4 }, (_, index) => ({
        chunkId: index,
        sourceSlug: "source",
        authorityRelation: "FOUNDATIONAL",
      })),
    }),
    /selector ceiling/u,
  );
});

test("navigator failure log contains only bounded safe metadata", async () => {
  const secretMarker = "synthetic-sensitive-marker-never-log";
  const upstream = Object.assign(
    new Error(`provider response contained ${secretMarker}`),
    {
      code: "UPSTREAM_ERROR",
      status: 401,
      responseBody: secretMarker,
    },
  );

  let captured: unknown;
  try {
    await withNavigatorStage("COHERE", async () => {
      throw upstream;
    });
  } catch (error) {
    captured = error;
  }

  assert.ok(captured instanceof NavigatorStageError);

  const log = createNavigatorFailureLog(captured, "request-123");
  assert.deepEqual(log, {
    event: "NAVIGATOR_FAILURE",
    requestId: "request-123",
    stage: "COHERE",
    provider: "COHERE",
    errorName: "Error",
    errorCode: "UPSTREAM_ERROR",
    status: 401,
  });

  const serialized = JSON.stringify(log);
  assert.equal(serialized.includes(secretMarker), false);
  assert.equal(serialized.includes("provider response contained"), false);
  assert.equal(serialized.includes("responseBody"), false);
});

test("unsafe error code text is discarded instead of logged", () => {
  const log = createNavigatorFailureLog(
    {
      name: "ProviderError",
      code: "secret value should never become a code",
      status: 502,
      message: "sensitive provider body",
    },
    "request-456",
  );

  assert.deepEqual(log, {
    event: "NAVIGATOR_FAILURE",
    requestId: "request-456",
    stage: "UNKNOWN",
    provider: "UNKNOWN",
    errorName: "ProviderError",
    errorCode: null,
    status: 502,
  });
});

test("outer stage wrapper preserves an already-classified inner stage", async () => {
  await assert.rejects(
    () =>
      withNavigatorStage("COURSE_RPC", () =>
        withNavigatorStage("BINDINGS", async () => {
          throw Object.assign(new Error("hidden"), {
            code: "UPSTREAM_ERROR",
            status: 503,
          });
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof NavigatorStageError);
      assert.equal(error.stage, "BINDINGS");
      assert.equal(error.errorCode, "UPSTREAM_ERROR");
      assert.equal(error.status, 503);
      return true;
    },
  );
});


test("only strict evidence-selection validation failures may degrade to INSUFFICIENT", () => {
  const invalidSelection = new NavigatorStageError(
    "EVIDENCE_LLM",
    new CourseEvidenceSelectionError("invented quote"),
  );

  assert.equal(
    isRecoverableEvidenceSelectionFailure(invalidSelection),
    true,
  );

  const log = createNavigatorDegradationLog(
    invalidSelection,
    "request-degraded-1",
  );

  assert.deepEqual(log, {
    event: "NAVIGATOR_DEGRADATION",
    requestId: "request-degraded-1",
    stage: "EVIDENCE_LLM",
    provider: "DEEPSEEK",
    fallback: "INSUFFICIENT",
    errorName: "CourseEvidenceSelectionError",
    errorCode: "INVALID_COURSE_EVIDENCE_SELECTION",
    status: null,
  });

  assert.equal(JSON.stringify(log).includes("invented quote"), false);

  const upstreamFailure = new NavigatorStageError(
    "EVIDENCE_LLM",
    Object.assign(new Error("provider failed"), {
      code: "UPSTREAM_ERROR",
      status: 503,
    }),
  );

  assert.equal(
    isRecoverableEvidenceSelectionFailure(upstreamFailure),
    false,
  );

  assert.throws(
    () =>
      createNavigatorDegradationLog(
        upstreamFailure,
        "request-must-fail",
      ),
    /Only invalid course evidence selections/u,
  );
});
