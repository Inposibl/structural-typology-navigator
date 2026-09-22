import assert from "node:assert/strict";
import test from "node:test";

import { resolveCourseReferences } from "../../src/lib/academy/course-reference.ts";
import {
  ACADEMY_PAYMENT_POLICY,
  composeEnrollmentPaymentAnswer,
  hasEnrollmentPaymentIntent,
  paymentActionForCourse,
  resolveEnrollmentPaymentDecision,
} from "../../src/lib/academy/payment-policy.ts";
import {
  createInitialConversationState,
  applyOrchestratedTurn,
  normalizeConversationStatePayload,
  SESSION_CONTEXT_TTL_MS,
} from "../../src/lib/navigation/conversation-state.ts";
import { prepareConversationTurn } from "../../src/lib/navigation/conversation-turn-control.ts";
import { composeNavigatorAnswer } from "../../src/lib/navigation/answer-composer.ts";
import {
  composeCatalogListAnswer,
  composeCourseComparisonAnswer,
  composeCurrentMetadataAnswer,
} from "../../src/lib/navigation/conversation-response.ts";
import { orchestrateNavigatorResponse } from "../../src/lib/navigation/orchestrate-navigation.ts";
import { handleChatRequest } from "../../src/app/api/chat/route.ts";
import type { ConversationProfile } from "../../src/lib/chat-contract.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");
const PROFILE: ConversationProfile = {
  displayName: "Анна",
  addressMode: "VY",
  nameDeclined: false,
  pendingUserRequest: null,
};

test("A11: canonical reference resolution distinguishes zero, one and multiple", () => {
  assert.equal(resolveCourseReferences("как записаться?").kind, "ZERO");
  assert.deepEqual(resolveCourseReferences("хочу курс Маслоу"), {
    kind: "ONE",
    courseIds: ["maslow"],
  });
  assert.deepEqual(
    resolveCourseReferences("сравните Маслоу и уровни сознания"),
    {
      kind: "MULTIPLE",
      courseIds: ["levels-of-consciousness", "maslow"],
    },
  );
});

test("A11: payment matrix blocks conflict, ambiguity, stale and no-match paths", () => {
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Хочу оплатить курс уровней сознания",
      { state: "NAVIGATE" },
      { selectedCourseId: "maslow", courseMatch: "MATCHED" },
    ).kind,
    "CONFIRM_COURSE_CHANGE",
  );
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Хочу оплатить Маслоу и уровни сознания",
      { state: "NAVIGATE" },
    ).kind,
    "CLARIFY_MULTIPLE",
  );
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Хочу оплатить этот курс",
      { state: "NAVIGATE" },
      { staleCourseReference: true },
    ).kind,
    "REESTABLISH_COURSE",
  );
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Хочу оплатить курс",
      { state: "NAVIGATE" },
      { courseMatch: "NO_CURRENT_COURSE_MATCH" },
    ).kind,
    "PRESERVE_NO_MATCH",
  );
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Как оплатить курс Маслоу?",
      { state: "OUT_OF_SCOPE" },
    ).kind,
    "NONE",
  );
});

test("A11: explicit, selected, equal and generic payment cases resolve deterministically", () => {
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Хочу оплатить курс Маслоу",
      { state: "NAVIGATE" },
    ).kind,
    "ACTION",
  );
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Хочу оплатить этот курс",
      { state: "NAVIGATE" },
      { selectedCourseId: "maslow", courseMatch: "MATCHED" },
    ).kind,
    "ACTION",
  );
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Хочу оплатить курс Маслоу",
      { state: "NAVIGATE" },
      { selectedCourseId: "maslow", courseMatch: "MATCHED" },
    ).kind,
    "ACTION",
  );
  const generic = resolveEnrollmentPaymentDecision(
    "Как записаться?",
    { state: "NAVIGATE" },
  );
  assert.equal(generic.kind, "ACTION");
  if (generic.kind !== "ACTION") throw new Error("expected action");
  assert.equal(generic.action.courseId, null);
});

test("A06: ASK_MORE and NO_MATCH omit prohibited wording and retain factual ceilings", async () => {
  const ask = await composeNavigatorAnswer(
    [{ role: "user", content: "Помогите выбрать курс" }],
    {
      state: "ASK_MORE",
      candidateCourseIds: ["maslow"],
      questions: ["Что важно понять?"],
      rationale: "Нужно уточнение.",
    },
  );
  const noMatch = await composeNavigatorAnswer(
    [{ role: "user", content: "Нужен курс по мобильной разработке" }],
    { state: "NO_CURRENT_COURSE_MATCH", rationale: "Нет совпадения." },
  );
  assert.doesNotMatch(ask, /без натяжки/iu);
  assert.doesNotMatch(noMatch, /без натяжки/iu);
  assert.match(ask, /подтверждённых основаниях/u);
  assert.match(noMatch, /достаточно подтверждённых оснований/u);
});

test("R40: catalog includes the listed-unroutable course with its limitation", () => {
  const answer = composeCatalogListAnswer();
  assert.match(answer, /Стадии профессионального развития взрослого человека/u);
  assert.match(answer, /только указан в каталоге/u);
  assert.match(answer, /достаточным описанием/u);
});

test("R39-R43/R48: factual Academy, catalog and dated price answers bypass routing and RAG", async () => {
  let routeCalls = 0;
  let retrievalCalls = 0;
  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Расскажите об Академии и сколько стоит курс Маслоу?" }],
    {
      conversationState: createInitialConversationState(T0),
      dependencies: {
        classifyAct: async () => ({
          state: "FACTUAL",
          intents: [
            { kind: "ACADEMY_OVERVIEW" },
            {
              kind: "CURRENT_METADATA",
              courseIds: ["maslow"],
              fields: ["PRICE"],
              scope: "REFERENCED",
            },
          ],
        }),
        route: async () => {
          routeCalls += 1;
          throw new Error("educational routing must be bypassed");
        },
        retrieve: async () => {
          retrievalCalls += 1;
          throw new Error("RAG must be bypassed");
        },
      },
    },
  );
  assert.equal(routeCalls, 0);
  assert.equal(retrievalCalls, 0);
  assert.match(result.message, /образовательный проект/u);
  assert.match(result.message, /19 сентября 2026 года/u);
  assert.match(result.message, /60[\s\u00a0]000 ₽/u);
  assert.doesNotMatch(result.message, /сейчас курс стоит/iu);
  assert.ok(result.stateEffects.transactionalAuthorityVersion);
});

test("A30: selected-course metadata is dated and missing fields stay unsupported", () => {
  const answer = composeCurrentMetadataAnswer(
    {
      kind: "CURRENT_METADATA",
      courseIds: [],
      fields: ["PRICE", "SCHEDULE", "COHORT", "ENROLLMENT_WINDOW"],
      scope: "SELECTED",
    },
    "maslow",
  );
  assert.match(answer, /19 сентября 2026 года/u);
  assert.match(answer, /60[\s\u00a0]000 ₽/u);
  assert.match(answer, /расписание: авторитетного значения нет/u);
  assert.match(answer, /текущий поток: авторитетного значения нет/u);
  assert.match(answer, /окно набора: авторитетного значения нет/u);
});

for (const pressure of [
  "ну порекомендуй что-нибудь",
  "выбери любой",
  "хоть что-нибудь",
]) {
  test(`R45: stored no-match remains controlling for «${pressure}»`, async () => {
    let routeCalls = 0;
    const state = {
      ...createInitialConversationState(T0),
      courseMatch: "NO_CURRENT_COURSE_MATCH" as const,
      catalogAuthorityVersion: "2026-09-18",
    };
    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: pressure }],
      {
        conversationState: state,
        dependencies: {
          classifyAct: async () => ({ state: "NAVIGATE" }),
          route: async () => {
            routeCalls += 1;
            throw new Error("stable no-match must bypass routing");
          },
        },
      },
    );
    assert.equal(routeCalls, 0);
    assert.match(result.message, /нет курса/u);
  });
}

test("R46: verbatim new evidence reopens a stored no-match", async () => {
  let routeCalls = 0;
  const evidence = "потребности определяют поведение сотрудников";
  await orchestrateNavigatorResponse(
    [{ role: "user", content: `Мне важно понять, как ${evidence}.` }],
    {
      conversationState: {
        ...createInitialConversationState(T0),
        courseMatch: "NO_CURRENT_COURSE_MATCH",
        catalogAuthorityVersion: "2026-09-18",
      },
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE", newTaskEvidence: evidence }),
        route: async () => {
          routeCalls += 1;
          return { state: "NO_CURRENT_COURSE_MATCH", rationale: "Нет совпадения." };
        },
        compose: async () => "Подтверждённого совпадения нет.",
      },
    },
  );
  assert.equal(routeCalls, 1);
});

test("A08: a changed catalog version permits reevaluation", async () => {
  let routeCalls = 0;
  await orchestrateNavigatorResponse(
    [{ role: "user", content: "ну порекомендуй что-нибудь" }],
    {
      conversationState: {
        ...createInitialConversationState(T0),
        courseMatch: "NO_CURRENT_COURSE_MATCH",
        catalogAuthorityVersion: "older-catalog",
      },
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
        route: async () => {
          routeCalls += 1;
          return { state: "NO_CURRENT_COURSE_MATCH", rationale: "Нет совпадения." };
        },
        compose: async () => "Подтверждённого совпадения нет.",
      },
    },
  );
  assert.equal(routeCalls, 1);
});

test("R47: factual comparison uses established fields and makes no recommendation mutation", () => {
  const intent = {
    kind: "COURSE_COMPARISON" as const,
    courseIds: ["maslow", "levels-of-consciousness"] as const,
    hasUnknownCourse: false,
  };
  const answer = composeCourseComparisonAnswer({
    ...intent,
    courseIds: [...intent.courseIds],
  });
  assert.match(answer, /без выбора победителя/u);
  assert.match(answer, /Иерархия потребностей/u);
  assert.match(answer, /Иерархия уровней сознания/u);
  assert.doesNotMatch(answer, /лучше для вас|рекомендую/iu);

  const before = {
    ...createInitialConversationState(T0),
    courseMatch: "MATCHED" as const,
    selectedCourseId: "maslow",
  };
  const after = applyOrchestratedTurn(
    before,
    {
      act: "FACTUAL",
      flowId: null,
      message: answer,
      decision: { kind: "NONE" },
      clarification: {
        status: "NOT_APPLICABLE",
        issueKey: null,
        attempts: 0,
        question: null,
      },
    },
    T0,
  );
  assert.equal(after.selectedCourseId, "maslow");
  assert.equal(after.courseMatch, "MATCHED");
});

test("A29: unknown and listed-unroutable comparisons fail or limit honestly", () => {
  const unknown = composeCourseComparisonAnswer({
    kind: "COURSE_COMPARISON",
    courseIds: ["maslow"],
    hasUnknownCourse: true,
  });
  assert.match(unknown, /не найден/u);

  const listed = composeCourseComparisonAnswer({
    kind: "COURSE_COMPARISON",
    courseIds: ["maslow", "professional-development-stages"],
    hasUnknownCourse: false,
  });
  assert.match(listed, /только указан в каталоге/u);
  assert.match(listed, /Публичные результаты: не указаны/u);
});

test("R49: payment course-change YES emits approved target URL; NO preserves binding", () => {
  const pending = {
    ...createInitialConversationState(T0),
    courseMatch: "MATCHED" as const,
    selectedCourseId: "maslow",
    pendingConfirmation: {
      confirmationKey: "payment-course-change:maslow:levels-of-consciousness",
      kind: "PAYMENT_COURSE_CHANGE" as const,
      prompt: "Переключиться?",
      candidateCourseId: "levels-of-consciousness",
    },
  };
  const yes = prepareConversationTurn(
    [{ role: "user", content: "да" }],
    PROFILE,
    { conversationState: pending, nowMs: T0 },
  );
  assert.equal(yes.state, "RESPOND");
  if (yes.state !== "RESPOND") throw new Error("expected response");
  assert.match(yes.message, /start=levels_of_consciousness/u);
  assert.equal(yes.conversationState.selectedCourseId, "levels-of-consciousness");

  const no = prepareConversationTurn(
    [{ role: "user", content: "нет" }],
    PROFILE,
    { conversationState: pending, nowMs: T0 },
  );
  assert.equal(no.state, "RESPOND");
  if (no.state !== "RESPOND") throw new Error("expected response");
  assert.doesNotMatch(no.message, /start=levels_of_consciousness/u);
  assert.equal(no.conversationState.selectedCourseId, "maslow");
  assert.equal(no.conversationState.pendingConfirmation, null);
});

test("R30: duplicate payment request ID does not execute orchestration twice", async () => {
  let orchestrationCalls = 0;
  const requestBody = {
    messages: [{ role: "user", content: "Хочу оплатить курс Маслоу" }],
    profile: PROFILE,
    conversationState: createInitialConversationState(T0),
    requestId: "dup-001",
  };
  const orchestrate = async () => {
    orchestrationCalls += 1;
    return {
      message: "Оплата: https://t.me/AST_payment_course_bot?start=maslow",
      contactCard: null,
      conversationAct: { state: "NAVIGATE" as const },
      decision: null,
      courseEvidenceCount: 0,
      courseHadActiveSources: false,
      evidenceSelectionStatus: "NOT_RUN" as const,
      clarification: {
        status: "NOT_APPLICABLE" as const,
        issueKey: null,
        attempts: 0,
        question: null,
      },
      stateEffects: {
        catalogAuthorityVersion: null,
        transactionalAuthorityVersion:
          "OWNER-COMMERCIAL-AUTHORITY-2026-09-19@2026-09-19",
        pendingConfirmation: null,
      },
    };
  };
  const first = await handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    }),
    { orchestrate },
  );
  const firstBody = await first.json();
  const second = await handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        conversationState: firstBody.conversationState,
      }),
    }),
    { orchestrate },
  );
  assert.equal(second.status, 200);
  assert.equal(orchestrationCalls, 1);
});

test("A30: authority provenance round-trips and TTL/reset clears working provenance", () => {
  const raw = {
    ...createInitialConversationState(T0),
    catalogAuthorityVersion: "2026-09-18",
    transactionalAuthorityVersion:
      "OWNER-COMMERCIAL-AUTHORITY-2026-09-19@2026-09-19",
  };
  const roundTrip = normalizeConversationStatePayload(raw, T0);
  assert.equal(roundTrip.catalogAuthorityVersion, "2026-09-18");
  assert.match(roundTrip.transactionalAuthorityVersion ?? "", /OWNER-COMMERCIAL/u);

  const expired = prepareConversationTurn(
    [{ role: "user", content: "продолжим" }],
    PROFILE,
    {
      conversationState: {
        ...roundTrip,
        lastActivityAt: new Date(T0 - SESSION_CONTEXT_TTL_MS - 1).toISOString(),
      },
      nowMs: T0,
    },
  );
  assert.equal(expired.conversationState.catalogAuthorityVersion ?? null, null);
  assert.equal(expired.conversationState.transactionalAuthorityVersion ?? null, null);
});

test("CORR2 A11: English canonical and slug references map to existing catalog courses", () => {
  const singles: ReadonlyArray<readonly [string, string]> = [
    ["Хочу оплатить structural typology", "structural-typology"],
    ["Хочу оплатить structural-typology", "structural-typology"],
    ["Хочу оплатить maslow", "maslow"],
    ["Хочу оплатить levels of consciousness", "levels-of-consciousness"],
    ["Хочу оплатить levels-of-consciousness", "levels-of-consciousness"],
    ["Хочу оплатить normative situation", "normative-situation"],
    ["Хочу оплатить normative-situation", "normative-situation"],
    ["Хочу оплатить play and creativity", "play-and-creativity"],
    ["Хочу оплатить play-and-creativity", "play-and-creativity"],
    [
      "Хочу оплатить professional development stages",
      "professional-development-stages",
    ],
    [
      "Хочу оплатить professional-development-stages",
      "professional-development-stages",
    ],
  ];

  for (const [query, courseId] of singles) {
    assert.deepEqual(
      resolveCourseReferences(query),
      { kind: "ONE", courseIds: [courseId] },
      query,
    );
  }

  assert.deepEqual(
    resolveCourseReferences("Хочу оплатить Structural Typology и Maslow"),
    { kind: "MULTIPLE", courseIds: ["structural-typology", "maslow"] },
  );
});

test("CORR2 A11: a single English reference keeps the course-specific payment action", () => {
  const decision = resolveEnrollmentPaymentDecision(
    "Хочу оплатить structural typology",
    { state: "NAVIGATE" },
  );
  assert.equal(decision.kind, "ACTION");
  if (decision.kind !== "ACTION") throw new Error("expected action");
  assert.equal(decision.action.courseId, "structural-typology");
  assert.equal(
    decision.action.paymentUrl,
    "https://t.me/AST_payment_course_bot?start=structural_typology",
  );
});

test("CORR2 A11: multi-course payment requests in mixed formats clarify and emit no deep link", async () => {
  const clarifying = [
    "Хочу оплатить structural typology и Маслоу",
    "Хочу оплатить structural-typology и maslow",
    "Хочу оплатить normative-situation и play and creativity",
  ];

  for (const query of clarifying) {
    const resolution = resolveCourseReferences(query);
    assert.equal(resolution.kind, "MULTIPLE", query);
    assert.ok(resolution.courseIds.length >= 2, query);

    const decision = resolveEnrollmentPaymentDecision(
      query,
      { state: "NAVIGATE" },
    );
    assert.equal(decision.kind, "CLARIFY_MULTIPLE", query);

    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      {
        conversationState: createInitialConversationState(T0),
        dependencies: {
          classifyAct: async () => ({ state: "NAVIGATE" }),
        },
      },
    );
    assert.doesNotMatch(result.message, /t\.me\//u, query);
    assert.doesNotMatch(result.message, /start=/u, query);
    assert.match(result.message, /несколько курсов/u, query);
    assert.equal(
      result.stateEffects.transactionalAuthorityVersion,
      null,
      query,
    );
  }

  // A bare imperative form also resolves MULTIPLE identities and can never
  // produce a course-specific deep link.
  const bare = "Оплатить levels of consciousness или Маслоу";
  assert.equal(resolveCourseReferences(bare).kind, "MULTIPLE");
  const bareDecision = resolveEnrollmentPaymentDecision(
    bare,
    { state: "NAVIGATE" },
  );
  assert.notEqual(bareDecision.kind, "ACTION");
  assert.notEqual(bareDecision.kind, "CONFIRM_COURSE_CHANGE");
});

test("CORR2 F-2: payment wording implies no current cohort, stream, schedule or enrollment window", () => {
  const answers = [
    composeEnrollmentPaymentAnswer(paymentActionForCourse("maslow")),
    composeEnrollmentPaymentAnswer({
      courseId: null,
      paymentUrl: ACADEMY_PAYMENT_POLICY.generalUrl,
    }),
  ];

  for (const answer of answers) {
    assert.match(answer, /Тихон[а-яё]*|AI-секретар[а-яё]*/u, answer);
    assert.doesNotMatch(answer, /Помощник[а-яё]* по оплате курсов/u, answer);
    assert.doesNotMatch(
      answer,
      /поток|расписан|набор|старт|групп|окно/iu,
      answer,
    );
  }

  assert.match(answers[0], /start=maslow/u);
});

test("CORR2.CORR1: start-anchored bare imperatives enter the existing payment path", async () => {
  const multi = "Оплатить levels of consciousness или Маслоу";
  assert.equal(resolveCourseReferences(multi).kind, "MULTIPLE");
  assert.equal(
    resolveEnrollmentPaymentDecision(multi, { state: "NAVIGATE" }).kind,
    "CLARIFY_MULTIPLE",
  );

  const multiTurn = await orchestrateNavigatorResponse(
    [{ role: "user", content: multi }],
    {
      conversationState: createInitialConversationState(T0),
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
      },
    },
  );
  assert.match(multiTurn.message, /несколько курсов/u);
  assert.doesNotMatch(multiTurn.message, /t\.me\//u);

  const single = resolveEnrollmentPaymentDecision(
    "Оплатить Маслоу",
    { state: "NAVIGATE" },
  );
  assert.equal(single.kind, "ACTION");
  if (single.kind !== "ACTION") throw new Error("expected action");
  assert.equal(single.action.courseId, "maslow");
  assert.equal(
    single.action.paymentUrl,
    "https://t.me/AST_payment_course_bot?start=maslow",
  );

  const english = resolveEnrollmentPaymentDecision(
    "Оплатить structural typology",
    { state: "NAVIGATE" },
  );
  assert.equal(english.kind, "ACTION");
  if (english.kind !== "ACTION") throw new Error("expected action");
  assert.equal(english.action.courseId, "structural-typology");

  const multiRu = "Оплатить Маслоу или Уровни сознания";
  assert.equal(resolveCourseReferences(multiRu).kind, "MULTIPLE");
  assert.equal(
    resolveEnrollmentPaymentDecision(multiRu, { state: "NAVIGATE" }).kind,
    "CLARIFY_MULTIPLE",
  );
});

test("CORR2.CORR1: narrative payment mentions and protected lanes stay non-transactional", () => {
  const narrative = "Я вчера хотел оплатить Маслоу, но сейчас расскажи про Академию";
  assert.equal(hasEnrollmentPaymentIntent(narrative), false);
  assert.equal(
    resolveEnrollmentPaymentDecision(narrative, { state: "NAVIGATE" }).kind,
    "NONE",
  );
  assert.equal(
    hasEnrollmentPaymentIntent("Расскажи, стоит ли оплатить курс Маслоу"),
    false,
  );

  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Оплатить Маслоу и Уровни сознания",
      { state: "OUT_OF_SCOPE" },
    ).kind,
    "NONE",
  );
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Оплатить этот курс",
      { state: "NAVIGATE" },
      { courseMatch: "NO_CURRENT_COURSE_MATCH" },
    ).kind,
    "PRESERVE_NO_MATCH",
  );
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Оплатить уровни сознания",
      { state: "NAVIGATE" },
      { selectedCourseId: "maslow", courseMatch: "MATCHED" },
    ).kind,
    "CONFIRM_COURSE_CHANGE",
  );
});


