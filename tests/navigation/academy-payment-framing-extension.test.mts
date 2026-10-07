import assert from "node:assert/strict";
import test from "node:test";

import {
  hasEnrollmentPaymentIntent,
  qualifiesForAcademyPaymentScopeOverride,
  resolveEnrollmentPaymentDecision,
  resolveLivePaymentMultipleAnswer,
  resolvePaymentClarificationCandidate,
  type PaymentResolutionContext,
} from "../../src/lib/academy/payment-policy.ts";
import { scanControls } from "../../src/lib/navigation/conversation-control-phrases.ts";
import { applyConversationControlKernel } from "../../src/lib/navigation/conversation-control-kernel.ts";
import { createInitialConversationState, type ConversationState } from "../../src/lib/navigation/conversation-state.ts";
import { orchestrateNavigatorResponse } from "../../src/lib/navigation/orchestrate-navigation.ts";
import type { AcademyCourseId } from "../../src/lib/academy/course-reference.ts";

const SELECTED: PaymentResolutionContext = { selectedCourseId: "maslow", courseMatch: "MATCHED" };
const CANDIDATES: readonly AcademyCourseId[] = ["maslow", "structural-typology", "levels-of-consciousness"];
const LIVE: PaymentResolutionContext = {
  courseReferents: CANDIDATES,
  pendingPaymentClarification: true,
  courseMatch: "AMBIGUOUS",
  selectedCourseId: null,
  staleCourseReference: false,
};
const T0 = Date.parse("2026-10-06T12:00:00.000Z");
const PROFILE = { displayName: "Тест", addressMode: "VY", nameDeclined: false, pendingUserRequest: null } as const;

// Exact FR-1..FR-12 successor witnesses from the accepted contract.
const FRESH_POSITIVES: ReadonlyArray<readonly [string, string, string]> = [
  ["Да, где оплатить курс Маслоу?", "maslow", "https://t.me/AST_payment_course_bot?start=maslow"],
  ["Хорошо, заплатить за курс Маслоу", "maslow", "https://t.me/AST_payment_course_bot?start=maslow"],
  ["Окей, где заплатить за курс Маслоу?", "maslow", "https://t.me/AST_payment_course_bot?start=maslow"],
  ["Хочу оплатить «Игру и творчество»", "play-and-creativity", "https://t.me/AST_payment_course_bot?start=play_and_creativity"],
  ["Хочу оплатить \"Игру и творчество\"", "play-and-creativity", "https://t.me/AST_payment_course_bot?start=play_and_creativity"],
  ["Да, хочу оплатить «Структурную типологию личности»", "structural-typology", "https://t.me/AST_payment_course_bot?start=structural_typology"],
  ["Хочу оплатить структурную типологию личности", "structural-typology", "https://t.me/AST_payment_course_bot?start=structural_typology"],
  ["Как купить иерархию уровней сознания?", "levels-of-consciousness", "https://t.me/AST_payment_course_bot?start=levels_of_consciousness"],
  ["Где заплатить за «Нормативную ситуацию»?", "normative-situation", "https://t.me/AST_payment_course_bot?start=normative_situation"],
  ["Хочу купить курс Маслоу\nКак оплатить?", "maslow", "https://t.me/AST_payment_course_bot?start=maslow"],
  ["Хочу купить курс Иерархия потребностей А. Маслоу: новая парадигма", "maslow", "https://t.me/AST_payment_course_bot?start=maslow"],
  ["Хочу оплатить курс Иерархия потребностей А. Маслоу: новая парадигма. Где оплатить?", "maslow", "https://t.me/AST_payment_course_bot?start=maslow"],
];

test("A1: fresh framing, quotes, OD-3, SD-3 and protected titles retain exact static handoffs", () => {
  for (const [query, courseId, paymentUrl] of FRESH_POSITIVES) {
    assert.equal(qualifiesForAcademyPaymentScopeOverride(query), true, query);
    for (const state of ["NAVIGATE", "OUT_OF_SCOPE"] as const) {
      assert.deepEqual(resolveEnrollmentPaymentDecision(query, { state }), {
        kind: "ACTION", action: { courseId, paymentUrl },
      }, query);
    }
  }
});

test("fresh framing is one initial bounded token and unwrap is one complete course-object pair", () => {
  for (const query of [
    "Да, хорошо, хочу оплатить курс Маслоу",
    "Да\n\nхочу оплатить курс Маслоу",
    "Давай хочу оплатить курс Маслоу",
    "Хочу оплатить да курс Маслоу",
    "Хочу оплатить ««Маслоу»»",
    "«Хочу оплатить курс Маслоу»",
    'Хочу оплатить "Маслоу»',
    "Хочу оплатить «Маслоу через @fake_payment_bot»",
  ]) {
    assert.equal(qualifiesForAcademyPaymentScopeOverride(query), false, query);
    assert.deepEqual(resolveEnrollmentPaymentDecision(query, { state: "NAVIGATE" }, SELECTED), { kind: "NONE" }, query);
  }
  assert.equal(qualifiesForAcademyPaymentScopeOverride("Да\nхочу оплатить курс «Маслоу»"), true);
});

test("SD-3 is whole-course authority and does not expand generic intent", () => {
  for (const query of ["Где оплатить курс Маслоу?", "Заплатить за курс Маслоу", "Где заплатить за курс Маслоу?"]) {
    assert.equal(hasEnrollmentPaymentIntent(query), false, query);
    assert.equal(resolveEnrollmentPaymentDecision(query, { state: "NAVIGATE" }).kind, "ACTION", query);
  }
  for (const query of ["Заплатить", "Заплатить за", "Заплатить за его", "Где заплатить за его?", "Можно оплатить курс Маслоу", "Поступить на курс Маслоу", "Приобрести курс Маслоу"]) {
    assert.equal(qualifiesForAcademyPaymentScopeOverride(query), false, query);
    assert.deepEqual(resolveEnrollmentPaymentDecision(query, { state: "NAVIGATE" }, SELECTED), { kind: "NONE" }, query);
  }
});

test("external-payment controls cannot acquire A1, A2 or general Academy handoff", () => {
  for (const query of ["Где оплатить коммунальные услуги?", "Где оплатить врача?", "Где оплатитьXYZ?", "Где оплатить @fake_payment_bot?", "Где заплатить за коммуналку?"]) {
    assert.equal(hasEnrollmentPaymentIntent(query), false, query);
    assert.equal(qualifiesForAcademyPaymentScopeOverride(query), false, query);
    for (const context of [{}, SELECTED]) {
      assert.deepEqual(resolveEnrollmentPaymentDecision(query, { state: "NAVIGATE" }, context), { kind: "NONE" }, query);
    }
  }
});

test("P03: fresh aliases, heads, framing and quotes leave both historical helpers unchanged", () => {
  for (const query of ["структурную типологию личности", "иерархию уровней сознания", "Заплатить за курс Маслоу", "Где заплатить за курс Маслоу", "Да, Маслоу", "«Маслоу»", "\"Маслоу\""]) {
    assert.equal(resolvePaymentClarificationCandidate(query, CANDIDATES), null, query);
    assert.equal(resolveLivePaymentMultipleAnswer(query, CANDIDATES), null, query);
    if (!query.startsWith("Заплатить") && !query.startsWith("Где заплатить")) {
      assert.deepEqual(resolveEnrollmentPaymentDecision(query, { state: "NAVIGATE" }, LIVE), { kind: "NONE" }, query);
    }
  }
  assert.equal(resolvePaymentClarificationCandidate("Маслоу", CANDIDATES), "maslow");
  assert.equal(resolveLivePaymentMultipleAnswer("Хочу оплатить курс Маслоу.", CANDIDATES), "maslow");
});

function liveThirdState(): ConversationState {
  return {
    ...createInitialConversationState(T0),
    courseMatch: "AMBIGUOUS",
    courseReferents: ["maslow", "structural-typology"],
    clarification: { issueKey: "payment-multiple:2+6", attempts: 3, strategyKey: null },
    lastAssistant: { act: "CLARIFICATION", content: "Назовите один курс для оплаты.", courseId: null },
  };
}

test("SD-3 inside live candidates is fresh A1, and cannot bypass the historical third-answer gate", () => {
  for (const query of ["Заплатить за курс Маслоу", "Где заплатить за курс Маслоу"]) {
    assert.equal(resolveLivePaymentMultipleAnswer(query, CANDIDATES), null);
    assert.deepEqual(resolveEnrollmentPaymentDecision(query, { state: "OUT_OF_SCOPE" }, LIVE), {
      kind: "ACTION", action: { courseId: "maslow", paymentUrl: "https://t.me/AST_payment_course_bot?start=maslow" },
    });
    const kernel = applyConversationControlKernel({ profile: PROFILE, conversationState: liveThirdState(), userText: query, nowMs: T0 });
    assert.equal(kernel.state, "RESPOND");
    if (kernel.state !== "RESPOND") throw new Error("expected historical exhaustion gate");
    assert.equal(kernel.act, "HANDOFF_OFFERED");
  }
});

test("P03 upstream liveness retains last-act, prior/recorded issue, match, selected, stale and candidate guards", async () => {
  const base = liveThirdState();
  const cases: ReadonlyArray<readonly [Partial<ConversationState>, string]> = [
    [{ lastAssistant: { act: "CLARIFICATION_EXHAUSTED", content: "Уточнения завершены.", courseId: null } }, "payment-multiple:2+6"],
    [{}, "payment-multiple:1+4"],
    [{ clarification: { issueKey: "payment-multiple:1+4", attempts: 3, strategyKey: null } }, "payment-multiple:2+6"],
    [{ courseMatch: "NO_CURRENT_COURSE_MATCH" }, "payment-multiple:2+6"],
    [{ selectedCourseId: "maslow" }, "payment-multiple:2+6"],
    [{ staleReference: { previousCourseId: "maslow", previousFlowId: null } }, "payment-multiple:2+6"],
    [{ courseReferents: [] }, "payment-multiple:2+6"],
  ];
  for (const [mutation, priorIssueKey] of cases) {
    const result = await orchestrateNavigatorResponse([{ role: "user", content: "Маслоу" }], {
      conversationState: { ...base, ...mutation },
      clarification: { priorIssueKey, priorAttempts: 3 },
      dependencies: { classifyAct: async () => ({ state: "OUT_OF_SCOPE" }) },
    });
    assert.doesNotMatch(result.message, /AST_payment_course_bot/u, JSON.stringify(mutation));
  }
});

test("P03 third-answer control still requires no pending confirmation", () => {
  const base = liveThirdState();
  assert.equal(applyConversationControlKernel({ profile: PROFILE, conversationState: base, userText: "Маслоу", nowMs: T0 }).state, "ROUTE");
  const kernel = applyConversationControlKernel({
    profile: PROFILE, userText: "Маслоу", nowMs: T0,
    conversationState: { ...base, pendingConfirmation: {
      confirmationKey: "payment-course-change:maslow:structural-typology",
      kind: "PAYMENT_COURSE_CHANGE", prompt: "Подтвердите смену курса.", candidateCourseId: "structural-typology",
    } },
  });
  assert.equal(kernel.state, "RESPOND");
});

test("A2: fresh framing respects selected-context guards and a rejected form never reaches general bot", () => {
  assert.deepEqual(resolveEnrollmentPaymentDecision("Да, как оплатить его?", { state: "NAVIGATE" }, SELECTED), {
    kind: "ACTION", action: { courseId: "maslow", paymentUrl: "https://t.me/AST_payment_course_bot?start=maslow" },
  });
  assert.equal(resolveEnrollmentPaymentDecision("Да, как оплатить его?", { state: "NAVIGATE" }, { ...SELECTED, staleCourseReference: true }).kind, "REESTABLISH_COURSE");
  assert.equal(resolveEnrollmentPaymentDecision("Да, как оплатить его?", { state: "NAVIGATE" }, { ...SELECTED, courseMatch: "NO_CURRENT_COURSE_MATCH" }).kind, "PRESERVE_NO_MATCH");
  assert.equal(resolveEnrollmentPaymentDecision("Да, как оплатить его?", { state: "NAVIGATE" }, { ...SELECTED, courseMatch: "AMBIGUOUS", courseReferents: CANDIDATES }).kind, "CLARIFY_MULTIPLE");
  assert.deepEqual(resolveEnrollmentPaymentDecision("Он сказал: хочу оплатить его.", { state: "NAVIGATE" }, SELECTED), { kind: "NONE" });
});

test("soft LF clauses survive native transport, while same-line lexical tails stay unconsumed", () => {
  const newline = scanControls("Хочу купить курс Маслоу\nКак оплатить?").remainder ?? "";
  const sameLine = scanControls("Хочу купить курс Маслоу Как оплатить?").remainder ?? "";
  assert.equal(resolveEnrollmentPaymentDecision(newline, { state: "NAVIGATE" }).kind, "ACTION");
  assert.equal(qualifiesForAcademyPaymentScopeOverride(sameLine), false);
  assert.deepEqual(resolveEnrollmentPaymentDecision(sameLine, { state: "NAVIGATE" }), { kind: "NONE" });
});

test("ROUTER_DEGRADED vetoes A1, A2, historical P03 and general handoff before any ACTION", () => {
  const cases: ReadonlyArray<readonly [string, PaymentResolutionContext]> = [
    ["Хочу купить курс Маслоу", {}],
    ["Как оплатить его?", SELECTED],
    ["Маслоу", LIVE],
    ["Как записаться?", {}],
  ];
  for (const [query, context] of cases) {
    assert.deepEqual(resolveEnrollmentPaymentDecision(query, { state: "ROUTER_DEGRADED" }, context), { kind: "NONE" }, query);
  }
});

test("PDS remains recognized and not payable for framed and course-bound fresh forms", () => {
  for (const query of ["Да, хочу купить курс стадии профессионального развития. Как оплатить?", "Где заплатить за стадии профессионального развития?"]) {
    assert.equal(qualifiesForAcademyPaymentScopeOverride(query), true, query);
    assert.deepEqual(resolveEnrollmentPaymentDecision(query, { state: "OUT_OF_SCOPE" }), { kind: "COURSE_NOT_PAYABLE", courseId: "professional-development-stages" }, query);
  }
});

test("general handoff retains null course and its original generic helper requirement", () => {
  assert.deepEqual(resolveEnrollmentPaymentDecision("Как записаться?", { state: "NAVIGATE" }), {
    kind: "ACTION", action: { courseId: null, paymentUrl: "https://t.me/AST_payment_course_bot" },
  });
  assert.equal(hasEnrollmentPaymentIntent("Да, где оплатить?"), false);
  assert.deepEqual(resolveEnrollmentPaymentDecision("Да, где оплатить?", { state: "NAVIGATE" }), { kind: "NONE" });
  assert.deepEqual(resolveEnrollmentPaymentDecision("Как записаться?", { state: "META" }), { kind: "NONE" });
});
