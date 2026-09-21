import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationProfile } from "../../src/lib/chat-contract.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";
import type { RetrieveCourseKnowledgeResult } from "../../src/lib/knowledge/retrieval/retrieve-course-knowledge.ts";
import { composeCourseFollowUpAnswer } from "../../src/lib/navigation/conversation-response.ts";
import { createInitialConversationState } from "../../src/lib/navigation/conversation-state.ts";
import {
  orchestrateNavigatorResponse,
  type NavigatorOrchestrationResult,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  handleChatRequest,
  type ChatRouteDependencies,
} from "../../src/app/api/chat/route.ts";

const PROFILE: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

function resolvedEvidence(courseId = "maslow"): ResolvedCourseEvidence {
  return {
    chunkId: 17,
    documentId: "document-1",
    sourceId: "source-1",
    courseId,
    sourceSlug: "maslow-foundational",
    sourceTitle: "Synthetic source",
    sourceKind: "manuscript",
    authorityRelation: "FOUNDATIONAL",
    courseSourceMetadata: {},
    sourceMetadata: {},
    documentMetadata: {},
    content: "synthetic-private-chunk-content-never-log",
    contentSha256: "a".repeat(64),
    headingPath: [],
    locator: {},
    chunkMetadata: {},
    similarity: 0.9,
    controllingAuthorityEntries: [],
    evidenceRole: "FOUNDATIONAL",
  };
}

function courseKnowledge(courseId = "maslow"): RetrieveCourseKnowledgeResult {
  const evidence = resolvedEvidence(courseId);
  return {
    hasActiveSources: true,
    bindings: [{
      courseId,
      sourceId: "source-1",
      sourceSlug: evidence.sourceSlug,
      sourceTitle: evidence.sourceTitle,
      authorityRelation: "FOUNDATIONAL",
      metadata: {},
    }],
    matches: [evidence],
  };
}

function followUpDependencies(overrides: Record<string, unknown> = {}) {
  const evidence = resolvedEvidence();
  return {
    classifyAct: async () => ({
      state: "COURSE_FOLLOW_UP" as const,
      courseId: "maslow",
      evidenceRequested: false,
    }),
    retrieve: async () => courseKnowledge(),
    resolve: () => [evidence],
    selectEvidence: async () => ({
      status: "SUPPORTED" as const,
      evidence: [{ chunkId: evidence.chunkId, quote: "synthetic quote" }],
    }),
    composeFollowUp: async (
      _messages: unknown,
      _act: unknown,
      options: { onOutcome?: (outcome: {
        answerOrigin: "RAG_EVIDENCE";
        fallback: "NONE";
      }) => void },
    ) => {
      options.onOutcome?.({ answerOrigin: "RAG_EVIDENCE", fallback: "NONE" });
      return "Grounded answer";
    },
    ...overrides,
  };
}

test("Package E: supported follow-up reports exact bounded RAG evidence", async () => {
  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Как устроены переходы?" }],
    { dependencies: followUpDependencies() },
  );

  assert.deepEqual(result.observability, {
    lane: "ORCHESTRATION",
    conversationAct: "COURSE_FOLLOW_UP",
    decision: null,
    courseId: "maslow",
    ragInvoked: true,
    authorityResolved: true,
    activeBindingCount: 1,
    bindingSourceSlugs: ["maslow-foundational"],
    retrievedMatchCount: 1,
    resolvedEvidenceCount: 1,
    selectedEvidence: [{
      chunkId: 17,
      sourceSlug: "maslow-foundational",
      authorityRelation: "FOUNDATIONAL",
    }],
    evidenceSelectionStatus: "SUPPORTED",
    answerOrigin: "RAG_EVIDENCE",
    fallback: "NONE",
    crossCourseLeakageDetected: false,
  });
  const serialized = JSON.stringify(result.observability);
  assert.equal(serialized.includes("synthetic quote"), false);
  assert.equal(serialized.includes("synthetic-private-chunk-content-never-log"), false);
});

test("Package E: insufficient follow-ups distinguish factual ceiling and catalog fallback", async () => {
  const insufficient = {
    classifyAct: async () => ({
      state: "COURSE_FOLLOW_UP" as const,
      courseId: "maslow",
      evidenceRequested: false,
    }),
    retrieve: async () => ({
      ...courseKnowledge(),
      matches: [],
    }),
    resolve: () => [],
  };

  const ceiling = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Какой у автора любимый сорт кофе?" }],
    { dependencies: insufficient },
  );
  assert.equal(ceiling.observability?.answerOrigin, "FACTUAL_CEILING");
  assert.equal(ceiling.observability?.fallback, "FACTUAL_CEILING");

  const catalog = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Сколько встреч в курсе?" }],
    { dependencies: insufficient },
  );
  assert.equal(catalog.observability?.answerOrigin, "CATALOG_AUTHORITY");
  assert.equal(catalog.observability?.fallback, "CATALOG_FOLLOW_UP");
});

test("Package E: follow-up audit rejection reports factual ceiling", async () => {
  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Как устроены переходы?" }],
    {
      dependencies: followUpDependencies({
        composeFollowUp: (messages: Parameters<typeof composeCourseFollowUpAnswer>[0], act: Parameters<typeof composeCourseFollowUpAnswer>[1], options: Parameters<typeof composeCourseFollowUpAnswer>[2]) =>
          composeCourseFollowUpAnswer(messages, act, {
            ...options,
            callText: async () => "Unsupported generated claim",
            callJson: async () => ({
              status: "FAIL" as const,
              reasonCode: "UNSUPPORTED_CLAIM" as const,
            }),
          }),
      }),
    },
  );

  assert.equal(result.observability?.answerOrigin, "FACTUAL_CEILING");
  assert.equal(result.observability?.fallback, "FACTUAL_CEILING");
});

test("Package E: recommendation reports routing separately from catalog origin", async () => {
  const evidence = resolvedEvidence();
  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Хочу понять мотивацию" }],
    {
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
        route: async () => ({
          state: "RECOMMEND_COURSE",
          primaryCourseId: "maslow",
          secondaryCourseIds: [],
          learningNeed: "Понять мотивацию",
          evidence: [{ messageIndex: 0, quote: "мотивацию" }],
          confidence: "sufficient",
        }),
        retrieve: async () => courseKnowledge(),
        resolve: () => [evidence],
        selectEvidence: async () => ({
          status: "SUPPORTED",
          evidence: [{ chunkId: 17, quote: "synthetic quote" }],
        }),
        compose: async () => "Catalog recommendation",
      },
    },
  );

  assert.equal(result.observability?.conversationAct, "NAVIGATE");
  assert.equal(result.observability?.decision, "RECOMMEND_COURSE");
  assert.equal(result.observability?.ragInvoked, true);
  assert.equal(result.observability?.answerOrigin, "CATALOG_AUTHORITY");
});

test("Package E: cross-course resolved evidence fails instead of logging clean success", async () => {
  let composerCalled = false;
  await assert.rejects(
    () => orchestrateNavigatorResponse(
      [{ role: "user", content: "Как устроены переходы?" }],
      {
        dependencies: followUpDependencies({
          resolve: () => [resolvedEvidence("levels-of-consciousness")],
          composeFollowUp: async () => {
            composerCalled = true;
            return "must not compose";
          },
        }),
      },
    ),
    /Cross-course evidence/u,
  );
  assert.equal(composerCalled, false);
});

async function chatRequest(
  body: unknown,
  dependencies?: ChatRouteDependencies,
): Promise<Response> {
  return handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    dependencies,
  );
}

function body(content: string) {
  return {
    messages: [{ role: "user", content }],
    profile: PROFILE,
    conversationState: createInitialConversationState(Date.now()),
  };
}

test("Package E: control success emits a trace/header without invoking orchestration", async () => {
  const logs: string[] = [];
  const originalInfo = console.info;
  console.info = (value?: unknown) => logs.push(String(value));
  let orchestrationCalls = 0;
  try {
    const response = await chatRequest(body("меня зовут Петр"), {
      orchestrate: async () => {
        orchestrationCalls += 1;
        throw new Error("must not execute");
      },
    });
    assert.equal(response.status, 200);
    assert.equal(orchestrationCalls, 0);
    const requestId = response.headers.get("X-Navigator-Request-Id");
    assert.ok(requestId);
    const log = JSON.parse(logs.at(-1) ?? "null") as Record<string, unknown>;
    assert.equal(log.event, "NAVIGATOR_TURN");
    assert.equal(log.requestId, requestId);
    assert.equal(log.lane, "CONTROL");
    assert.equal(log.ragInvoked, false);
  } finally {
    console.info = originalInfo;
  }
});

test("Package E: orchestration success and technical failure expose the internal trace header", async () => {
  const successResult: NavigatorOrchestrationResult = {
    message: "No current match",
    contactCard: null,
    conversationAct: { state: "NAVIGATE" },
    decision: {
      state: "NO_CURRENT_COURSE_MATCH",
      rationale: "No match",
    },
    courseEvidenceCount: 0,
    courseHadActiveSources: false,
    evidenceSelectionStatus: "NOT_RUN",
    clarification: {
      status: "NOT_APPLICABLE",
      issueKey: null,
      attempts: 0,
      question: null,
    },
    stateEffects: {
      catalogAuthorityVersion: null,
      transactionalAuthorityVersion: null,
      pendingConfirmation: null,
    },
  };
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = () => undefined;
  console.error = () => undefined;
  try {
    const success = await chatRequest(body("Мне нужен неизвестный курс"), {
      orchestrate: async () => successResult,
    });
    assert.ok(success.headers.get("X-Navigator-Request-Id"));

    const failure = await chatRequest(body("Мне нужен неизвестный курс"), {
      orchestrate: async () => {
        throw new Error("synthetic-provider-body-never-public");
      },
    });
    assert.notEqual(failure.status, 200);
    assert.ok(failure.headers.get("X-Navigator-Request-Id"));
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
});
