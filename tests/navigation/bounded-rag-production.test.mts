import assert from "node:assert/strict";
import test from "node:test";

import {
  orchestrateNavigatorResponse,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  ConversationActDecisionValidationError,
  routeConversationAct,
  validateConversationActDecision,
} from "../../src/lib/navigation/conversation-act-router.ts";
import {
  COURSE_IDENTITY_SCOPE,
  getCourseIdentityScope,
} from "../../src/lib/academy/course-identity-scope.ts";
import {
  CourseEvidenceSelectionError,
  selectCourseEvidence,
} from "../../src/lib/knowledge/retrieval/evidence-selector.ts";
import {
  composeCourseFollowUpAnswer,
} from "../../src/lib/navigation/conversation-response.ts";
import {
  createNavigatorGroundingLog,
  NAVIGATOR_GROUNDING_STAGES,
  type NavigatorGroundingDetails,
} from "../../src/lib/navigation/navigator-observability.ts";
import { FollowUpGroundingAuditError } from "../../src/lib/navigation/follow-up-grounding.ts";
import { getAcademyCourse } from "../../src/lib/academy/course-catalog.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";
import type { ConversationMessage } from "../../src/lib/chat-contract.ts";

/* ---------------------------------------------------------------------------
 * NAVIGATOR-BOUNDED-REASONING-RAG-1.PRODUCTION-IMPLEMENTATION-1
 *
 * Deterministic coverage for the five ported production changes and the bounded
 * hybrid grounding guardrail. Every provider call is injected, so nothing here
 * reaches DeepSeek, Cohere or Supabase.
 * ------------------------------------------------------------------------- */

const CONTENT_QUESTION = "Что такое замещение эмоций и как оно работает?";

const contentMessages: ConversationMessage[] = [
  { role: "user", content: CONTENT_QUESTION },
];

const MASLOW_CHUNK =
  "Замещение эмоций — это процесс, при котором исходная эмоция не находит " +
  "прямого выражения и подменяется другой, социально допустимой формой " +
  "активности. Сублимация описывается как частный случай такого замещения, " +
  "при котором энергия исходного побуждения переносится на культурно " +
  "приемлемую цель. Принцип удовольствия и принцип реальности задают рамку, " +
  "внутри которой это замещение становится наблюдаемым в поведении субъекта.";

function maslowEvidence(): ResolvedCourseEvidence[] {
  return [
    {
      chunkId: 10,
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
      content: MASLOW_CHUNK,
      contentSha256: "a".repeat(64),
      headingPath: [],
      locator: {},
      chunkMetadata: {},
      similarity: 0.94,
      controllingAuthorityEntries: [],
      evidenceRole: "FOUNDATIONAL",
    },
  ];
}

const SUPPORTED_QUOTE =
  "Замещение эмоций — это процесс, при котором исходная эмоция не находит " +
  "прямого выражения и подменяется другой, социально допустимой формой " +
  "активности";

/* =========================================================================
 * ROUTING
 * ====================================================================== */

test("R1: a first-turn course-content question reaches COURSE_CONTENT and the unchanged RAG stack", async () => {
  let retrievedCourseId = "";
  let retrievedMatchCount: number | undefined;
  let selectorCalls = 0;

  const result = await orchestrateNavigatorResponse(contentMessages, {
    dependencies: {
      classifyAct: async () => ({
        state: "COURSE_CONTENT",
        courseId: "maslow",
        evidenceRequested: false,
        contentIntentEvidence: "замещение эмоций",
      }),
      retrieve: async (courseId, _query, options) => {
        retrievedCourseId = courseId;
        retrievedMatchCount = options?.matchCount;
        return { hasActiveSources: true, bindings: [], matches: [] };
      },
      resolve: () => maslowEvidence(),
      selectEvidence: async () => {
        selectorCalls += 1;
        return {
          status: "SUPPORTED",
          evidence: [{ chunkId: 10, quote: SUPPORTED_QUOTE }],
        };
      },
      composeFollowUp: async (_messages, act, options) => {
        assert.equal(act.state, "COURSE_FOLLOW_UP");
        assert.equal(act.courseId, "maslow");
        options.onOutcome?.({ answerOrigin: "RAG_EVIDENCE", fallback: "NONE" });
        return "Ответ по материалам курса.";
      },
    },
  });

  assert.equal(result.conversationAct.state, "COURSE_CONTENT");
  assert.equal(retrievedCourseId, "maslow");
  assert.equal(retrievedMatchCount, 12);
  assert.equal(selectorCalls, 1);
  assert.equal(result.observability?.ragInvoked, true);
  assert.equal(result.observability?.courseId, "maslow");
  assert.equal(result.observability?.answerOrigin, "RAG_EVIDENCE");
  assert.equal(result.evidenceSelectionStatus, "SUPPORTED");
});

test("R2: a malformed router decision degrades safely and binds no course, evidence or retrieval", async () => {
  let retrievalCalls = 0;
  let selectorCalls = 0;

  const result = await orchestrateNavigatorResponse(contentMessages, {
    dependencies: {
      classifyAct: async () => {
        throw new ConversationActDecisionValidationError(
          "Unsupported conversation act: WAT.",
        );
      },
      retrieve: async () => {
        retrievalCalls += 1;
        throw new Error("degraded router must not retrieve");
      },
      selectEvidence: async () => {
        selectorCalls += 1;
        throw new Error("degraded router must not select evidence");
      },
    },
  });

  assert.equal(result.conversationAct.state, "ROUTER_DEGRADED");
  assert.equal(retrievalCalls, 0);
  assert.equal(selectorCalls, 0);
  assert.equal(result.observability?.courseId, null);
  assert.equal(result.observability?.ragInvoked, false);
  assert.equal(result.observability?.authorityResolved, false);
  assert.equal(result.courseEvidenceCount, 0);
  assert.equal(result.evidenceSelectionStatus, "NOT_RUN");
  assert.equal(result.observability?.answerOrigin, "DETERMINISTIC_CONTROL");
});

test("R3: a malformed router decision produces a usable turn, not an uncontrolled 503", async () => {
  const result = await orchestrateNavigatorResponse(contentMessages, {
    dependencies: {
      classifyAct: async () => {
        throw new ConversationActDecisionValidationError(
          "COURSE_CONTENT contains unsupported fields.",
        );
      },
    },
  });

  assert.equal(typeof result.message, "string");
  assert.ok(result.message.length > 0);
  assert.ok(/технический сбой/iu.test(result.message));
});

test("R3b: a transport failure keeps the technical-error lane and does not degrade", async () => {
  class UpstreamError extends Error {
    readonly code = "UPSTREAM_ERROR";
    readonly status = 502;
  }

  await assert.rejects(
    orchestrateNavigatorResponse(contentMessages, {
      dependencies: {
        classifyAct: async () => {
          throw new UpstreamError("upstream is down");
        },
      },
    }),
  );
});

test("R4: PDS remains unroutable through COURSE_CONTENT", () => {
  assert.throws(
    () =>
      validateConversationActDecision(
        {
          state: "COURSE_CONTENT",
          courseId: "professional-development-stages",
          evidenceRequested: false,
          contentIntentEvidence: "замещение эмоций",
        },
        contentMessages,
      ),
    ConversationActDecisionValidationError,
  );
});

test("R4b: COURSE_CONTENT requires a bounded verbatim fragment of the latest user message", () => {
  assert.throws(
    () =>
      validateConversationActDecision(
        {
          state: "COURSE_CONTENT",
          courseId: "maslow",
          evidenceRequested: false,
          contentIntentEvidence: "то, чего пользователь не писал",
        },
        contentMessages,
      ),
    ConversationActDecisionValidationError,
  );

  const decision = validateConversationActDecision(
    {
      state: "COURSE_CONTENT",
      courseId: "maslow",
      evidenceRequested: false,
      contentIntentEvidence: "замещение эмоций",
    },
    contentMessages,
  );
  assert.equal(decision.state, "COURSE_CONTENT");
});

/* ---------------------------------------------------------------------------
 * CORR1 F-1 — the COURSE_CONTENT boundary.
 *
 * COURSE_CONTENT is only available while no catalog course has been named. Once a
 * course is present in the conversation, the stricter COURSE_FOLLOW_UP binding
 * semantics govern and COURSE_CONTENT must not be able to bypass them.
 * ------------------------------------------------------------------------- */

// Read from the catalog rather than hardcoded: the boundary is defined by the
// catalog's own title/URL presence semantics, so the fixture must use them.
const MASLOW_TITLE = getAcademyCourse("maslow")?.title ?? "";

test("F-1: COURSE_CONTENT is rejected when a catalog course is already named (adversarial rebinding)", () => {
  // Codex's adversarial case: the conversation names one catalog course, and the
  // model then proposes COURSE_CONTENT for a *different* routable course.
  const named: ConversationMessage[] = [
    { role: "user", content: `Расскажи про курс «${MASLOW_TITLE}»` },
    { role: "assistant", content: "Это курс о мотивации." },
    { role: "user", content: "А что такое архетип Тени и как он проявляется?" },
  ];

  assert.throws(
    () =>
      validateConversationActDecision(
        {
          state: "COURSE_CONTENT",
          courseId: "structural-typology",
          evidenceRequested: false,
          contentIntentEvidence: "архетип Тени",
        },
        named,
      ),
    ConversationActDecisionValidationError,
  );
});

test("F-1: COURSE_CONTENT is rejected even when it rebinds to the already-named course", () => {
  const named: ConversationMessage[] = [
    { role: "assistant", content: `Рекомендую курс «${MASLOW_TITLE}».` },
    { role: "user", content: "Что такое замещение эмоций?" },
  ];

  assert.throws(
    () =>
      validateConversationActDecision(
        {
          state: "COURSE_CONTENT",
          courseId: "maslow",
          evidenceRequested: false,
          contentIntentEvidence: "замещение эмоций",
        },
        named,
      ),
    ConversationActDecisionValidationError,
  );
});

test("F-1: a named course URL also closes the COURSE_CONTENT boundary", () => {
  const course = getAcademyCourse("maslow");
  assert.ok(course);
  assert.ok(course.url, "fixture requires a catalog URL");

  const named: ConversationMessage[] = [
    { role: "assistant", content: `Страница курса: ${course.url}` },
    { role: "user", content: "Что такое замещение эмоций?" },
  ];

  assert.throws(
    () =>
      validateConversationActDecision(
        {
          state: "COURSE_CONTENT",
          courseId: "maslow",
          evidenceRequested: false,
          contentIntentEvidence: "замещение эмоций",
        },
        named,
      ),
    ConversationActDecisionValidationError,
  );
});

test("F-1: naming the unroutable PDS course does not open a COURSE_CONTENT rebinding path", () => {
  const pds = getAcademyCourse("professional-development-stages");
  assert.ok(pds);

  const named: ConversationMessage[] = [
    { role: "user", content: `Интересует курс «${pds.title}»` },
    { role: "user", content: "Что такое замещение эмоций?" },
  ];

  assert.throws(
    () =>
      validateConversationActDecision(
        {
          state: "COURSE_CONTENT",
          courseId: "maslow",
          evidenceRequested: false,
          contentIntentEvidence: "замещение эмоций",
        },
        named,
      ),
    ConversationActDecisionValidationError,
  );
});

test("F-1: COURSE_CONTENT stays valid while no catalog course has been named", () => {
  const decision = validateConversationActDecision(
    {
      state: "COURSE_CONTENT",
      courseId: "maslow",
      evidenceRequested: false,
      contentIntentEvidence: "замещение эмоций",
    },
    contentMessages,
  );

  assert.equal(decision.state, "COURSE_CONTENT");
  assert.equal(
    decision.state === "COURSE_CONTENT" ? decision.courseId : null,
    "maslow",
  );
});

test("F-1: COURSE_FOLLOW_UP still binds normally once a course is named", () => {
  const named: ConversationMessage[] = [
    { role: "assistant", content: `Рекомендую курс «${MASLOW_TITLE}».` },
    { role: "user", content: "Что такое замещение эмоций?" },
  ];

  const decision = validateConversationActDecision(
    {
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: false,
    },
    named,
  );

  assert.equal(decision.state, "COURSE_FOLLOW_UP");
});

test("R4c: the model can never select the ROUTER_DEGRADED lane", () => {
  assert.throws(
    () => validateConversationActDecision({ state: "ROUTER_DEGRADED" }, contentMessages),
    ConversationActDecisionValidationError,
  );
});

/* =========================================================================
 * COURSE IDENTITY
 * ====================================================================== */

test("C5: every catalog course has a bounded, governed scope entry", () => {
  const entries = Object.entries(COURSE_IDENTITY_SCOPE);
  assert.ok(entries.length > 0);

  for (const [courseId, scope] of entries) {
    if (scope === null) continue;
    assert.equal(typeof scope, "string");
    assert.ok(scope.trim().length > 40, `${courseId} scope is too thin`);
    assert.ok(scope.length < 700, `${courseId} scope is not bounded`);
  }
});

test("C6: the router sees the Maslow identity surface that disambiguates the corpus", async () => {
  let routerPayload = "";

  await routeConversationAct(contentMessages, {
    callJson: async (messages) => {
      routerPayload = messages.at(-1)?.content ?? "";
      return {
        state: "COURSE_CONTENT",
        courseId: "maslow",
        evidenceRequested: false,
        contentIntentEvidence: "замещение эмоций",
      };
    },
  });

  const parsed = JSON.parse(
    routerPayload.slice(routerPayload.indexOf("{")),
  ) as { courses: Array<{ id: string; scope: string | null }> };

  const maslow = parsed.courses.find((course) => course.id === "maslow");
  assert.ok(maslow, "maslow must be offered to the router");
  assert.equal(maslow.scope, getCourseIdentityScope("maslow"));
  // The failure mode the descriptor exists for: the title advertises the
  // hierarchy of needs while the corpus is largely about emotions.
  assert.ok(/эмоц/iu.test(maslow.scope ?? ""));
});

test("C7: no course descriptor is a catch-all, and PDS carries none at all", () => {
  assert.equal(COURSE_IDENTITY_SCOPE["professional-development-stages"], null);
  assert.equal(getCourseIdentityScope("professional-development-stages"), null);
  assert.equal(getCourseIdentityScope("not-a-course"), null);

  const descriptors = Object.values(COURSE_IDENTITY_SCOPE).filter(
    (scope): scope is string => scope !== null,
  );

  assert.equal(new Set(descriptors).size, descriptors.length);
  for (const scope of descriptors) {
    assert.ok(
      !/люб(ой|ые)\s+вопрос|все\s+темы|универсальн/iu.test(scope),
      "a descriptor must not claim catch-all coverage",
    );
  }
});

/* =========================================================================
 * SELECTOR QUOTE CONTRACT
 * ====================================================================== */

const LONG_CHUNK_CONTENT = `${MASLOW_CHUNK} ${MASLOW_CHUNK}`;

function longChunk(): ResolvedCourseEvidence[] {
  const [base] = maslowEvidence();
  return [{ ...base, content: LONG_CHUNK_CONTENT }];
}

test("S8: an exact quote longer than 320 characters is accepted", async () => {
  const longQuote = LONG_CHUNK_CONTENT.slice(0, 400);
  assert.ok(longQuote.length > 320);

  const selected = await selectCourseEvidence("замещение", longChunk(), {
    callJson: async () => ({
      status: "SUPPORTED",
      evidence: [{ chunkId: 10, quote: longQuote }],
    }),
  });

  assert.equal(selected.status, "SUPPORTED");
  assert.equal(selected.evidence[0].quote.length > 320, true);
});

test("S9: a canonical-whitespace quote is accepted when the chunk is re-flowed", async () => {
  const [base] = maslowEvidence();
  const reflowed: ResolvedCourseEvidence[] = [
    {
      ...base,
      content: MASLOW_CHUNK.replace("подменяется", "подменяется\r\n  "),
    },
  ];

  const selected = await selectCourseEvidence("замещение", reflowed, {
    callJson: async () => ({
      status: "SUPPORTED",
      evidence: [{ chunkId: 10, quote: SUPPORTED_QUOTE }],
    }),
  });

  assert.equal(selected.status, "SUPPORTED");
});

test("S10: a substantive paraphrase is still rejected", async () => {
  await assert.rejects(
    selectCourseEvidence("замещение", maslowEvidence(), {
      callJson: async () => ({
        status: "SUPPORTED",
        evidence: [
          {
            chunkId: 10,
            quote:
              "Замещение эмоций — это когда чувство не выражается напрямую и заменяется другим поведением",
          },
        ],
      }),
    }),
    CourseEvidenceSelectionError,
  );
});

test("S11: a fabricated quote and a stitched quote are rejected", async () => {
  await assert.rejects(
    selectCourseEvidence("замещение", maslowEvidence(), {
      callJson: async () => ({
        status: "SUPPORTED",
        evidence: [
          { chunkId: 10, quote: "Курс гарантирует снятие тревоги за месяц" },
        ],
      }),
    }),
    CourseEvidenceSelectionError,
  );

  // Stitched: both fragments exist in the chunk, the concatenation does not.
  await assert.rejects(
    selectCourseEvidence("замещение", maslowEvidence(), {
      callJson: async () => ({
        status: "SUPPORTED",
        evidence: [
          {
            chunkId: 10,
            quote:
              "Замещение эмоций — это процесс Принцип удовольствия и принцип реальности",
          },
        ],
      }),
    }),
    CourseEvidenceSelectionError,
  );
});

test("S12: an unknown chunk id is rejected", async () => {
  await assert.rejects(
    selectCourseEvidence("замещение", maslowEvidence(), {
      callJson: async () => ({
        status: "SUPPORTED",
        evidence: [{ chunkId: 999, quote: SUPPORTED_QUOTE }],
      }),
    }),
    CourseEvidenceSelectionError,
  );
});

/**
 * CORR1 F-2: structural invalidity takes the controlled ceiling. Grounding events
 * are read back off the production log sink so the assertions prove that no audit
 * and no repair ran, not merely that the composer was not called.
 */
async function captureGroundingStages<T>(
  run: () => Promise<T>,
): Promise<{ value: T; stages: string[] }> {
  const originalInfo = console.info;
  const stages: string[] = [];

  console.info = (value?: unknown) => {
    try {
      const parsed = JSON.parse(String(value)) as {
        event?: string;
        stage?: string;
      };
      if (
        parsed.event === "NAVIGATOR_GROUNDING" &&
        typeof parsed.stage === "string"
      ) {
        stages.push(parsed.stage);
      }
    } catch {
      // Not a grounding log line.
    }
  };

  try {
    return { value: await run(), stages };
  } finally {
    console.info = originalInfo;
  }
}

test("S13/F-2: cross-course evidence takes the controlled structural ceiling with zero composition, audit and repair", async () => {
  const [base] = maslowEvidence();
  const foreign: ResolvedCourseEvidence[] = [
    { ...base, courseId: "structural-typology" },
  ];

  let compositionCalls = 0;

  const { value: result, stages } = await captureGroundingStages(() =>
    orchestrateNavigatorResponse(contentMessages, {
      requestId: "corr1-f2-cross-course",
      dependencies: {
        classifyAct: async () => ({
          state: "COURSE_CONTENT",
          courseId: "maslow",
          evidenceRequested: false,
          contentIntentEvidence: "замещение эмоций",
        }),
        retrieve: async () => ({
          hasActiveSources: true,
          bindings: [],
          matches: [],
        }),
        resolve: () => foreign,
        selectEvidence: async () => ({
          status: "SUPPORTED",
          evidence: [{ chunkId: 10, quote: SUPPORTED_QUOTE }],
        }),
        composeFollowUp: async () => {
          compositionCalls += 1;
          return "must not compose";
        },
      },
    }),
  );

  // Controlled ceiling, not a rejected promise and not a technical error.
  assert.ok(result.message.includes(CEILING_MARKER));
  assert.equal(result.observability?.answerOrigin, "FACTUAL_CEILING");
  assert.equal(result.observability?.fallback, "FACTUAL_CEILING");

  assert.equal(compositionCalls, 0, "zero composition");
  assert.deepEqual(stages, ["FACTUAL_CEILING_STRUCTURAL"]);
  assert.ok(!stages.some((stage) => stage.includes("AUDIT")), "zero audit");
  assert.ok(!stages.some((stage) => stage.includes("REPAIR")), "zero repair");

  // The structurally invalid evidence is discarded, never reported as a success.
  assert.equal(result.courseEvidenceCount, 0);
  assert.equal(result.observability?.resolvedEvidenceCount, 0);
  assert.deepEqual(result.observability?.selectedEvidence, []);
  assert.equal(result.observability?.crossCourseLeakageDetected, false);
});

test("F-2: a missing selected chunk takes the controlled structural ceiling with zero composition, audit and repair", async () => {
  let compositionCalls = 0;

  const { value: result, stages } = await captureGroundingStages(() =>
    orchestrateNavigatorResponse(contentMessages, {
      requestId: "corr1-f2-missing-chunk",
      dependencies: {
        classifyAct: async () => ({
          state: "COURSE_CONTENT",
          courseId: "maslow",
          evidenceRequested: false,
          contentIntentEvidence: "замещение эмоций",
        }),
        retrieve: async () => ({
          hasActiveSources: true,
          bindings: [],
          matches: [],
        }),
        resolve: () => maslowEvidence(),
        // chunk 4242 was never resolved: the selection references a chunk that
        // does not exist in the authority survivors.
        selectEvidence: async () => ({
          status: "SUPPORTED",
          evidence: [{ chunkId: 4242, quote: SUPPORTED_QUOTE }],
        }),
        composeFollowUp: async () => {
          compositionCalls += 1;
          return "must not compose";
        },
      },
    }),
  );

  assert.ok(result.message.includes(CEILING_MARKER));
  assert.equal(result.observability?.answerOrigin, "FACTUAL_CEILING");
  assert.equal(result.observability?.fallback, "FACTUAL_CEILING");
  assert.equal(compositionCalls, 0, "zero composition");
  assert.deepEqual(stages, ["FACTUAL_CEILING_STRUCTURAL"]);
  assert.equal(result.courseEvidenceCount, 0);
  assert.deepEqual(result.observability?.selectedEvidence, []);
});

test("F-2: the COURSE_FOLLOW_UP lane takes the same controlled structural ceiling", async () => {
  const [base] = maslowEvidence();
  let compositionCalls = 0;

  const namedMessages: ConversationMessage[] = [
    { role: "user", content: "Расскажи про курс «Иерархия потребностей Маслоу»" },
  ];

  const { value: result, stages } = await captureGroundingStages(() =>
    orchestrateNavigatorResponse(namedMessages, {
      requestId: "corr1-f2-follow-up",
      dependencies: {
        classifyAct: async () => ({
          state: "COURSE_FOLLOW_UP",
          courseId: "maslow",
          evidenceRequested: false,
        }),
        retrieve: async () => ({
          hasActiveSources: true,
          bindings: [],
          matches: [],
        }),
        resolve: () => [{ ...base, courseId: "normative-situation" }],
        selectEvidence: async () => ({
          status: "SUPPORTED",
          evidence: [{ chunkId: 10, quote: SUPPORTED_QUOTE }],
        }),
        composeFollowUp: async () => {
          compositionCalls += 1;
          return "must not compose";
        },
      },
    }),
  );

  assert.ok(result.message.includes(CEILING_MARKER));
  assert.equal(compositionCalls, 0, "zero composition");
  assert.deepEqual(stages, ["FACTUAL_CEILING_STRUCTURAL"]);
  assert.equal(result.observability?.answerOrigin, "FACTUAL_CEILING");
});

test("S13b: the bounded evidence count is preserved", async () => {
  const [base] = maslowEvidence();
  const many = [10, 11, 12, 13].map((chunkId) => ({ ...base, chunkId }));

  await assert.rejects(
    selectCourseEvidence("замещение", many, {
      callJson: async () => ({
        status: "SUPPORTED",
        evidence: many.map((item) => ({
          chunkId: item.chunkId,
          quote: SUPPORTED_QUOTE,
        })),
      }),
    }),
    CourseEvidenceSelectionError,
  );
});

test("S13c: duplicate identity is decided on chunkId plus canonical quote", async () => {
  await assert.rejects(
    selectCourseEvidence("замещение", maslowEvidence(), {
      callJson: async () => ({
        status: "SUPPORTED",
        evidence: [
          { chunkId: 10, quote: SUPPORTED_QUOTE },
          { chunkId: 10, quote: SUPPORTED_QUOTE.replace(/ /gu, "  ") },
        ],
      }),
    }),
    CourseEvidenceSelectionError,
  );
});

/* =========================================================================
 * COMPOSER AUTHORITY
 * ====================================================================== */

async function captureComposerPrompt(): Promise<string> {
  let systemPrompt = "";

  await composeCourseFollowUpAnswer(
    contentMessages,
    { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false },
    {
      courseEvidence: maslowEvidence(),
      evidenceSelection: {
        status: "SUPPORTED",
        evidence: [{ chunkId: 10, quote: SUPPORTED_QUOTE }],
      },
      callText: async (messages) => {
        systemPrompt = messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n");
        return "Ответ";
      },
      callJson: async () => ({ status: "PASS" }),
    },
  );

  return systemPrompt;
}

test("A14: the controlling Experiment-7 authority reinforcement is present verbatim", async () => {
  const prompt = await captureComposerPrompt();

  for (const clause of [
    "ЗАПРЕЩЁННЫЕ ПАТТЕРНЫ ВЫХОДА ЗА ГРАНИЦУ АВТОРИТЕТА:",
    'НЕ строй отрицательные сравнения вида "это X, а не Y", если Y отсутствует в evidence',
    "НЕ делай утверждений о структуре, составе или полноте материалов курса",
    "НЕ вводи терминологию или категории, которых нет в evidence",
    "НЕ делай педагогических рекомендаций, предложений к действию или мета-комментариев",
    "НЕ утверждай количество источников, подтверждений или мест в материалах.",
    "ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ФОРМУЛИРОВКИ:",
    "сохраняй контринтуитивные утверждения источника в точности",
    "сохраняй оговорки и ограничения, присутствующие в evidence;",
    "если evidence не поддерживает запрошенное утверждение — скажи это прямо",
    "чётко отличай прямые утверждения источника от своих выводов.",
  ]) {
    assert.ok(prompt.includes(clause), `missing reinforcement clause: ${clause}`);
  }
});

test("A15: the composer is never granted permission to use world knowledge", async () => {
  const prompt = await captureComposerPrompt();

  assert.ok(prompt.includes("используй только authorityPayload;"));
  assert.ok(prompt.includes("НЕ используй общие знания модели;"));
  assert.ok(
    !/можно использовать общие знания|используй общие знания модели(?!;)/iu.test(
      prompt,
    ),
  );
});

/* =========================================================================
 * HYBRID GROUNDING GUARDRAIL
 * ====================================================================== */

type GuardrailRun = {
  message: string;
  composeCalls: number;
  auditCalls: number;
  stages: string[];
  outcomes: string[];
};

async function runGuardrail(options: {
  compose: (call: number) => Promise<string>;
  audit: (call: number) => Promise<unknown>;
  supported?: boolean;
}): Promise<GuardrailRun> {
  let composeCalls = 0;
  let auditCalls = 0;
  const stages: string[] = [];
  const outcomes: string[] = [];

  const supported = options.supported ?? true;

  const message = await composeCourseFollowUpAnswer(
    contentMessages,
    { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false },
    {
      courseEvidence: maslowEvidence(),
      evidenceSelection: supported
        ? {
            status: "SUPPORTED",
            evidence: [{ chunkId: 10, quote: SUPPORTED_QUOTE }],
          }
        : { status: "INSUFFICIENT", evidence: [] },
      callText: async () => {
        composeCalls += 1;
        return options.compose(composeCalls);
      },
      callJson: async () => {
        auditCalls += 1;
        return options.audit(auditCalls);
      },
      onGroundingEvent: (details) => {
        stages.push(details.stage);
      },
      onOutcome: (outcome) => {
        outcomes.push(outcome.answerOrigin);
      },
    },
  );

  return { message, composeCalls, auditCalls, stages, outcomes };
}

const CEILING_MARKER = "нет достаточного основания";

test("H16: a structural failure ends at the factual ceiling with zero composition and zero repair", async () => {
  const run = await runGuardrail({
    supported: false,
    compose: async () => {
      throw new Error("composer must not run without authority");
    },
    audit: async () => {
      throw new Error("auditor must not run without authority");
    },
  });

  assert.ok(run.message.includes(CEILING_MARKER));
  assert.equal(run.composeCalls, 0);
  assert.equal(run.auditCalls, 0);
  assert.deepEqual(run.stages, ["FACTUAL_CEILING_STRUCTURAL"]);
  assert.deepEqual(run.outcomes, ["FACTUAL_CEILING"]);
});

test("H17: a primary audit PASS delivers the original candidate as RAG evidence", async () => {
  const run = await runGuardrail({
    compose: async () => "Исходный обоснованный ответ.",
    audit: async () => ({ status: "PASS" }),
  });

  assert.equal(run.message, "Исходный обоснованный ответ.");
  assert.equal(run.composeCalls, 1);
  assert.equal(run.auditCalls, 1);
  assert.deepEqual(run.stages, ["PRIMARY_AUDIT_PASS"]);
  assert.deepEqual(run.outcomes, ["RAG_EVIDENCE"]);
});

test("H18/H19: a primary FAIL triggers exactly one repair, and a repair PASS is delivered", async () => {
  const run = await runGuardrail({
    compose: async (call) =>
      call === 1 ? "Кандидат с лишним утверждением." : "Исправленный ответ.",
    audit: async (call) =>
      call === 1
        ? { status: "FAIL", reasonCode: "UNSUPPORTED_CLAIM" }
        : { status: "PASS" },
  });

  assert.equal(run.message, "Исправленный ответ.");
  assert.equal(run.composeCalls, 2);
  assert.equal(run.auditCalls, 2);
  assert.deepEqual(run.stages, [
    "PRIMARY_AUDIT_FAIL",
    "REPAIR_ATTEMPTED",
    "REPAIR_AUDIT_PASS",
  ]);
  assert.deepEqual(run.outcomes, ["RAG_EVIDENCE"]);
});

test("H20/H25/H26: FAIL then repair then FAIL ends at the ceiling with no third cycle", async () => {
  const run = await runGuardrail({
    compose: async (call) =>
      call === 1 ? "Первый кандидат." : "Второй кандидат.",
    audit: async () => ({ status: "FAIL", reasonCode: "AUTHORITY_SCOPE" }),
  });

  assert.ok(run.message.includes(CEILING_MARKER));
  assert.equal(run.composeCalls, 2, "exactly one repair composition");
  assert.equal(run.auditCalls, 2, "exactly two audits");
  assert.deepEqual(run.stages, [
    "PRIMARY_AUDIT_FAIL",
    "REPAIR_ATTEMPTED",
    "REPAIR_AUDIT_FAIL",
    "FACTUAL_CEILING_AUDIT",
  ]);
  assert.deepEqual(run.outcomes, ["FACTUAL_CEILING"]);
});

test("H21: a primary audit validator throw becomes a controlled factual ceiling with no repair", async () => {
  // The measured defect: the model emits a malformed PASS and the frozen
  // validator correctly rejects it. That rejection must never become a PASS.
  const run = await runGuardrail({
    compose: async () => "Кандидат.",
    audit: async () => ({ status: "PASS", reasonCode: null }),
  });

  assert.ok(run.message.includes(CEILING_MARKER));
  assert.equal(run.composeCalls, 1);
  assert.equal(run.auditCalls, 1);
  assert.deepEqual(run.stages, ["PRIMARY_AUDIT_ERROR", "FACTUAL_CEILING_AUDIT"]);
  assert.deepEqual(run.outcomes, ["FACTUAL_CEILING"]);
});

test("H22: a primary audit transport or parser error becomes a controlled factual ceiling", async () => {
  const run = await runGuardrail({
    compose: async () => "Кандидат.",
    audit: async () => {
      throw new Error("socket hang up");
    },
  });

  assert.ok(run.message.includes(CEILING_MARKER));
  assert.equal(run.composeCalls, 1);
  assert.equal(run.auditCalls, 1);
  assert.deepEqual(run.stages, ["PRIMARY_AUDIT_ERROR", "FACTUAL_CEILING_AUDIT"]);
});

test("H23: a repair composer error becomes a controlled factual ceiling", async () => {
  const run = await runGuardrail({
    compose: async (call) => {
      if (call === 1) return "Первый кандидат.";
      throw new Error("repair composer failed");
    },
    audit: async () => ({ status: "FAIL", reasonCode: "UNMARKED_INFERENCE" }),
  });

  assert.ok(run.message.includes(CEILING_MARKER));
  assert.equal(run.composeCalls, 2);
  assert.equal(run.auditCalls, 1);
  assert.deepEqual(run.stages, [
    "PRIMARY_AUDIT_FAIL",
    "REPAIR_ATTEMPTED",
    "FACTUAL_CEILING_AUDIT",
  ]);
  assert.deepEqual(run.outcomes, ["FACTUAL_CEILING"]);
});

test("H24: a second audit error becomes a controlled factual ceiling", async () => {
  const run = await runGuardrail({
    compose: async (call) =>
      call === 1 ? "Первый кандидат." : "Второй кандидат.",
    audit: async (call) => {
      if (call === 1) return { status: "FAIL", reasonCode: "UNSUPPORTED_CLAIM" };
      throw new FollowUpGroundingAuditError("FAIL requires a valid reasonCode.");
    },
  });

  assert.ok(run.message.includes(CEILING_MARKER));
  assert.equal(run.composeCalls, 2);
  assert.equal(run.auditCalls, 2);
  assert.deepEqual(run.stages, [
    "PRIMARY_AUDIT_FAIL",
    "REPAIR_ATTEMPTED",
    "REPAIR_AUDIT_ERROR",
    "FACTUAL_CEILING_AUDIT",
  ]);
});

test("H27: a rejected candidate is never exposed to the user on any failing branch", async () => {
  const rejected = "СЕКРЕТНЫЙ ОТКЛОНЁННЫЙ КАНДИДАТ";

  const failThenFail = await runGuardrail({
    compose: async () => rejected,
    audit: async () => ({ status: "FAIL", reasonCode: "UNSUPPORTED_CLAIM" }),
  });
  assert.ok(!failThenFail.message.includes(rejected));

  const auditError = await runGuardrail({
    compose: async () => rejected,
    audit: async () => {
      throw new Error("boom");
    },
  });
  assert.ok(!auditError.message.includes(rejected));
});

test("H-repair: the repair receives identical authority and never re-runs retrieval or selection", async () => {
  const repairPayloads: string[] = [];

  await composeCourseFollowUpAnswer(
    contentMessages,
    { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false },
    {
      courseEvidence: maslowEvidence(),
      evidenceSelection: {
        status: "SUPPORTED",
        evidence: [{ chunkId: 10, quote: SUPPORTED_QUOTE }],
      },
      callText: async (messages) => {
        repairPayloads.push(messages.at(-1)?.content ?? "");
        return "Кандидат.";
      },
      callJson: async () => ({
        status: "FAIL",
        reasonCode: "UNSUPPORTED_CLAIM",
      }),
    },
  );

  assert.equal(repairPayloads.length, 2);
  const first = JSON.parse(repairPayloads[0]) as Record<string, unknown>;
  const second = JSON.parse(repairPayloads[1]) as Record<string, unknown>;

  assert.deepEqual(second.authorityPayload, first.authorityPayload);
  assert.equal(second.rejectedAnswer, "Кандидат.");
  assert.equal(second.auditReasonCode, "UNSUPPORTED_CLAIM");
});

/* =========================================================================
 * OBSERVABILITY
 * ====================================================================== */

test("O28: every bounded grounding outcome has a safe classification", () => {
  assert.deepEqual(
    [...NAVIGATOR_GROUNDING_STAGES],
    [
      "PRIMARY_AUDIT_PASS",
      "PRIMARY_AUDIT_FAIL",
      "PRIMARY_AUDIT_ERROR",
      "REPAIR_ATTEMPTED",
      "REPAIR_AUDIT_PASS",
      "REPAIR_AUDIT_FAIL",
      "REPAIR_AUDIT_ERROR",
      "FACTUAL_CEILING_STRUCTURAL",
      "FACTUAL_CEILING_AUDIT",
    ],
  );

  const log = createNavigatorGroundingLog("req-1", {
    stage: "REPAIR_AUDIT_PASS",
    courseId: "maslow",
    reasonCode: "UNSUPPORTED_CLAIM",
    errorName: null,
    selectedEvidenceCount: 2,
    repairAttempted: true,
  });

  assert.equal(log.event, "NAVIGATOR_GROUNDING");
  assert.equal(log.requestId, "req-1");
  assert.equal(log.stage, "REPAIR_AUDIT_PASS");
  assert.equal(log.courseId, "maslow");
  assert.equal(log.reasonCode, "UNSUPPORTED_CLAIM");
  assert.equal(log.selectedEvidenceCount, 2);
  assert.equal(log.repairAttempted, true);
});

test("O29: raw answer, evidence or user text cannot reach a grounding log line", () => {
  const unsafe = {
    stage: "PRIMARY_AUDIT_FAIL",
    courseId: "Замещение эмоций — это процесс, при котором исходная эмоция",
    reasonCode: "НЕ КОД ИЗ ENUM",
    errorName: "socket hang up while posting candidateAnswer",
    selectedEvidenceCount: -5,
    repairAttempted: "да",
    candidateAnswer: "СЕКРЕТНЫЙ ОТВЕТ",
    authorityPayload: { evidence: [{ quote: "СЕКРЕТНАЯ ЦИТАТА" }] },
    latestUserMessage: "ПОЛНОЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ",
  } as unknown as NavigatorGroundingDetails;

  const log = createNavigatorGroundingLog("req-2", unsafe);
  const serialized = JSON.stringify(log);

  assert.deepEqual(Object.keys(log).sort(), [
    "courseId",
    "errorName",
    "event",
    "reasonCode",
    "repairAttempted",
    "requestId",
    "selectedEvidenceCount",
    "stage",
  ]);

  assert.equal(log.courseId, "UNKNOWN");
  assert.equal(log.reasonCode, null);
  assert.equal(log.errorName, null);
  assert.equal(log.selectedEvidenceCount, 0);
  assert.equal(log.repairAttempted, false);

  for (const secret of [
    "СЕКРЕТНЫЙ ОТВЕТ",
    "СЕКРЕТНАЯ ЦИТАТА",
    "ПОЛНОЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ",
    "Замещение эмоций",
    "candidateAnswer",
  ]) {
    assert.ok(!serialized.includes(secret), `leaked: ${secret}`);
  }
});

test("O29b: an unsupported grounding stage is rejected outright", () => {
  assert.throws(
    () =>
      createNavigatorGroundingLog("req-3", {
        stage: "TOTALLY_MADE_UP",
        courseId: "maslow",
        reasonCode: null,
        errorName: null,
        selectedEvidenceCount: 0,
        repairAttempted: false,
      } as unknown as NavigatorGroundingDetails),
    /Unsupported navigator grounding stage/u,
  );
});

/* =========================================================================
 * REGRESSION
 * ====================================================================== */

test("G30: COURSE_CONTENT uses the unchanged retrieval configuration", async () => {
  const seen: Array<Record<string, unknown>> = [];

  await orchestrateNavigatorResponse(contentMessages, {
    dependencies: {
      classifyAct: async () => ({
        state: "COURSE_CONTENT",
        courseId: "maslow",
        evidenceRequested: false,
        contentIntentEvidence: "замещение эмоций",
      }),
      retrieve: async (_courseId, _query, options) => {
        seen.push({ ...options });
        return { hasActiveSources: false, bindings: [], matches: [] };
      },
      composeFollowUp: async (_messages, _act, options) => {
        options.onOutcome?.({
          answerOrigin: "FACTUAL_CEILING",
          fallback: "FACTUAL_CEILING",
        });
        return "Потолок";
      },
    },
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].matchCount, 12);
  // The threshold is never overridden at the call site: it stays the module default.
  assert.equal(seen[0].matchThreshold, undefined);
});

test("G31: PDS performs zero retrieval, authority or selector operations on the degraded lane", async () => {
  let retrievalCalls = 0;
  let resolveCalls = 0;
  let selectorCalls = 0;

  const result = await orchestrateNavigatorResponse(contentMessages, {
    dependencies: {
      classifyAct: async () => {
        // The router tried to bind PDS; the validator rejected it.
        throw new ConversationActDecisionValidationError(
          "COURSE_CONTENT courseId must be a current routable course.",
        );
      },
      retrieve: async () => {
        retrievalCalls += 1;
        throw new Error("PDS must never retrieve");
      },
      resolve: () => {
        resolveCalls += 1;
        throw new Error("PDS must never resolve authority");
      },
      selectEvidence: async () => {
        selectorCalls += 1;
        throw new Error("PDS must never select evidence");
      },
    },
  });

  assert.equal(result.conversationAct.state, "ROUTER_DEGRADED");
  assert.equal(retrievalCalls, 0);
  assert.equal(resolveCalls, 0);
  assert.equal(selectorCalls, 0);
  assert.equal(result.observability?.courseId, null);
});
