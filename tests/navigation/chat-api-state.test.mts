/**
 * Package-A API-boundary contract (A09 / A28).
 *
 * Verifies that the structured conversation state is strictly validated at the
 * API boundary like ConversationProfile already is, that it is returned on both
 * the kernel-handled and the routed path, and that no control act can be
 * produced by payloads the boundary should reject.
 *
 * These tests exercise only deterministic lanes: no model/provider call is
 * made, because every asserted turn is resolved by the control kernel before
 * routing.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { POST, handleChatRequest } from "../../src/app/api/chat/route.ts";
import {
  SESSION_CONTEXT_TTL_MS,
  createInitialConversationState,
  toSessionTimestamp,
  withClarification,
  withCourseBinding,
  withCourseReferents,
  withLastAssistant,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import type {
  ChatSuccessResponse,
  ConversationProfile,
} from "../../src/lib/chat-contract.ts";
import { orchestrateNavigatorResponse } from "../../src/lib/navigation/orchestrate-navigation.ts";
import { routeConversationAct } from "../../src/lib/navigation/conversation-act-router.ts";
import { routeEducationalNavigation } from "../../src/lib/navigation/router.ts";
import {
  composeContentReferenceClarification,
  composeFollowUpReferenceClarification,
  composePaymentAmbiguityAnswer,
  composeReferenceClarificationExhausted,
} from "../../src/lib/navigation/conversation-response.ts";
import { paymentMultipleIssueKey } from "../../src/lib/academy/payment-policy.ts";
import { ACADEMY_COURSES } from "../../src/lib/academy/course-catalog.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

const COMPLETE_PROFILE: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

function request(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function respond(body: unknown): Promise<ChatSuccessResponse> {
  const response = await request(body);
  assert.equal(response.status, 200);
  return (await response.json()) as ChatSuccessResponse;
}

test("A09: the response carries the canonical structured state", async () => {
  const payload = await respond({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: createInitialConversationState(T0),
  });

  assert.equal(payload.conversationState.lifecycle, "CLOSED");
  assert.equal(payload.conversationState.activeFlow, null);
  assert.match(payload.conversationState.lastActivityAt, /Z$/u);
});

test("A09: an absent state is accepted and initialised server-side", async () => {
  const payload = await respond({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
  });

  assert.equal(payload.conversationState.lifecycle, "CLOSED");
});

test("A09: an unknown key in the state payload is rejected", async () => {
  const response = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      injected: "value",
    },
  });

  assert.equal(response.status, 400);

  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_REQUEST");
});

test("A09: an unknown request key is still rejected", async () => {
  const response = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    unexpected: true,
  });

  assert.equal(response.status, 400);
});

test("A09: a malformed timestamp in the state payload is rejected", async () => {
  const response = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      lastActivityAt: "вчера",
    },
  });

  assert.equal(response.status, 400);
});

test("A09: an invalid course identifier in the state payload is rejected", async () => {
  const response = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      courseMatch: "MATCHED",
      selectedCourseId: "invented-course",
    },
  });

  assert.equal(response.status, 400);
});

test("A28: a stale session is answered without the expired referent on the wire", async () => {
  const payload = await respond({
    messages: [{ role: "user", content: "этот курс мне подойдёт?" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      courseMatch: "MATCHED",
      selectedCourseId: "maslow",
      lastActivityAt: toSessionTimestamp(T0 - SESSION_CONTEXT_TTL_MS - 1),
    },
  });

  assert.equal(payload.conversationState.selectedCourseId, null);
  assert.equal(payload.conversationState.courseMatch, "UNKNOWN");
  assert.equal(
    payload.conversationState.pendingConfirmation?.candidateCourseId,
    "maslow",
  );
  assert.match(payload.message, /Ранее мы обсуждали/u);
});

test("A17: full reset returns a fresh state and the initial prompt", async () => {
  const payload = await respond({
    messages: [{ role: "user", content: "давай сначала" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      courseMatch: "MATCHED",
      selectedCourseId: "maslow",
    },
  });

  assert.equal(payload.resetConversation, true);
  // Owner-adjudicated Block-A T32 successor: TURN_LEVEL_PROFILE_SURVIVAL —
  // the working state is fresh/reset and the complete preserved profile
  // survives deep-equal; a complete profile does not receive the first-time
  // address prompt, it receives the CORR3 restart acknowledgment.
  assert.deepEqual(payload.profile, COMPLETE_PROFILE);
  assert.equal(payload.message, "Хорошо, начнём сначала.");
  assert.doesNotMatch(payload.message, /как к вам обращаться/u);
  assert.equal(payload.conversationState.courseMatch, "UNKNOWN");
});

test("A04: a control act never reaches the routed path", async () => {
  const payload = await respond({
    messages: [{ role: "user", content: "не хочу больше общаться" }],
    profile: COMPLETE_PROFILE,
    conversationState: createInitialConversationState(T0),
  });

  // The routed path would need model credentials; reaching it would fail here.
  assert.equal(payload.conversationState.lifecycle, "CLOSED");
  assert.equal(payload.contactCard, null);
});

/* ---------------------------------------------------------------------------
 * NAVIGATOR-ACT-ROUTER-ALIAS-CORRECTION-1 — the CORR4 API sequences (S1–S16)
 * through the real request validation, control kernel, state normalisation,
 * orchestration and response mapping. Only the provider-backed dependencies
 * are injected (act decision per turn, retrieval and composition stubs), so no
 * network is touched.
 * ------------------------------------------------------------------------ */

type Msg = { role: "user" | "assistant"; content: string };
type DecideFn = (effectiveLatest: string) => Record<string, unknown>;
/** Provider JSON for the selection router; the real router validator still runs on it. */
type RouteFn = (messages: readonly Msg[]) => Record<string, unknown>;
type TurnOut = {
  status: number;
  message: string;
  act: string | null;
  flowId: string | null;
  selected: string | null;
  courseMatch: string | null;
  clarification: unknown;
  referents: unknown;
  retrieved: string[];
  classifierCalls: number;
  paymentCourse: string | null;
  paymentBot: boolean;
  pendingQuestion: string | null;
  routerCalls: number;
  routerPrompts: string[];
  handoff: string | null;
  uncertainty: boolean;
  keys: string[];
};

const VY_PROFILE: ConversationProfile = {
  displayName: "Иван",
  addressMode: "VY",
  nameDeclined: false,
  pendingUserRequest: null,
};
const UNCERTAINTY_TEXTS = new Set([
  composeFollowUpReferenceClarification(VY_PROFILE),
  composeContentReferenceClarification(VY_PROFILE),
  composeReferenceClarificationExhausted(),
]);
const titleOf = (id: string) => ACADEMY_COURSES.find((course) => course.id === id)?.title ?? id;
const FU = (courseId: string): DecideFn => () => ({ state: "COURSE_FOLLOW_UP", courseId, evidenceRequested: false });
const CT = (courseId: string): DecideFn => (latest) => ({
  state: "COURSE_CONTENT",
  courseId,
  evidenceRequested: false,
  contentIntentEvidence: latest.slice(0, 240),
});
const CT_PART = (courseId: string, part: string): DecideFn => (latest) => ({
  state: "COURSE_CONTENT",
  courseId,
  evidenceRequested: false,
  contentIntentEvidence: latest.includes(part) ? part : part.replace(/[?!.]+$/u, ""),
});
const NAV: DecideFn = () => ({ state: "NAVIGATE" });
const OOS: DecideFn = () => ({ state: "OUT_OF_SCOPE" });
const PRICE: DecideFn = () => ({
  state: "FACTUAL",
  intents: [{ kind: "CURRENT_METADATA", courseIds: [], fields: ["PRICE"], scope: "SELECTED" }],
});

function wireState(build: (state: ConversationState) => ConversationState): unknown {
  return JSON.parse(JSON.stringify(build(createInitialConversationState(Date.now()))));
}

async function runSequence(
  turns: Array<{ user: string; decide: DecideFn; route?: RouteFn }>,
  options: { initial?: unknown; prior?: Msg[] } = {},
): Promise<TurnOut[]> {
  let history: Msg[] = [...(options.prior ?? [])];
  let state: unknown = options.initial ?? null;
  const outs: TurnOut[] = [];
  for (const [index, turn] of turns.entries()) {
    history = [...history, { role: "user", content: turn.user }];
    const retrieved: string[] = [];
    let classifierCalls = 0;
    let routerCalls = 0;
    const routerPrompts: string[] = [];
    const orchestrate: typeof orchestrateNavigatorResponse = (messages, orchestrationOptions) =>
      orchestrateNavigatorResponse(messages, {
        ...orchestrationOptions,
        dependencies: {
          classifyAct: async (effective) => {
            classifierCalls += 1;
            return routeConversationAct(effective, {
              callJson: async () => turn.decide(effective.at(-1)?.content ?? ""),
            });
          },
          retrieve: async (courseId) => {
            retrieved.push(courseId);
            return { hasActiveSources: true, bindings: [], matches: [] };
          },
          resolve: () => [],
          route: async (routeMessages, routeOptions) => {
            routerCalls += 1;
            const decideRoute = turn.route;
            if (!decideRoute) return { state: "NO_CURRENT_COURSE_MATCH", rationale: "STUB" } as never;
            return routeEducationalNavigation(routeMessages, {
              ...routeOptions,
              callJson: async (requestMessages) => {
                routerPrompts.push(requestMessages[0]?.content ?? "");
                return decideRoute(routeMessages as Msg[]);
              },
            });
          },
          compose: async () => "STUB COMPOSE",
          composeFollowUp: async (_messages, _act, composeOptions) => {
            composeOptions.onOutcome?.({ answerOrigin: "RAG_EVIDENCE", fallback: "NONE" });
            return "STUB FOLLOW-UP";
          },
        },
      });
    const body: Record<string, unknown> = { messages: history, profile: VY_PROFILE, requestId: `seq-${index}` };
    if (state !== null) body.conversationState = state;
    const info = console.info;
    console.info = () => undefined;
    let response: Response;
    try {
      response = await handleChatRequest(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { orchestrate },
      );
    } finally {
      console.info = info;
    }
    const json = (await response.json()) as Record<string, unknown> & {
      conversationState?: ConversationState;
      message?: string;
    };
    const cs = json.conversationState ?? null;
    const message = String(json.message ?? "");
    const pay = /AST_payment_course_bot\?start=([a-z_]+)/u.exec(message);
    outs.push({
      status: response.status,
      message,
      act: cs?.lastAssistant?.act ?? null,
      flowId: cs?.activeFlow?.id ?? null,
      selected: cs?.selectedCourseId ?? null,
      courseMatch: cs?.courseMatch ?? null,
      clarification: cs?.clarification ?? null,
      referents: cs?.courseReferents ?? null,
      retrieved,
      classifierCalls,
      paymentCourse: pay?.[1] ?? null,
      paymentBot: message.includes("AST_payment_course_bot"),
      pendingQuestion: cs?.activeFlow?.pendingQuestion ?? null,
      routerCalls,
      routerPrompts,
      handoff: cs?.handoff?.status ?? null,
      uncertainty: UNCERTAINTY_TEXTS.has(message),
      keys: Object.keys(json).sort(),
    });
    history = [...history, { role: "assistant", content: message }];
    state = cs;
  }
  return outs;
}

const COURSERA = "Прохожу курс про Маслоу на Coursera. Что там разбирается?";
// MAJOR-REMEDIATION-1.CORR1 (OD-1=A1): a single explicit course reference (COURSERA
// included — OWNER-ACCEPTED RESIDUAL) now resolves; the uncertainty mechanics are kept
// on an input that A1 still leaves unresolved (an unknown program beside the course).
const A1_UNRESOLVED = "Прохожу курс алхимии и курс Маслоу. Что там разбирается?";
const selectedLoc = () =>
  wireState((s) => withCourseBinding(s, "MATCHED", "levels-of-consciousness"));
const p03 = (attempts: number) =>
  wireState((s) => {
    let next = withCourseBinding(s, "AMBIGUOUS", null);
    next = withCourseReferents(next, ["levels-of-consciousness", "maslow"]);
    next = withClarification(next, {
      issueKey: paymentMultipleIssueKey(["levels-of-consciousness", "maslow"]),
      attempts,
      strategyKey: attempts >= 3 ? null : `ask-more-${attempts}`,
    });
    return withLastAssistant(next, {
      act: "CLARIFICATION",
      content: composePaymentAmbiguityAnswer(VY_PROFILE),
      courseId: null,
    });
  });
const INCIDENT: Msg[] = [
  { role: "assistant", content: "Здравствуйте. Прежде чем начнём, скажите, пожалуйста, как к вам обращаться? Напишите имя и выберите: на «ты» или на «вы»." },
  { role: "user", content: "меня зовут Николай, можно на ты, так как я тебя сделал" },
  { role: "assistant", content: "Спасибо, Николай, можно , так как я тебя сделал. Буду обращаться на «ты». Расскажи, с чем хочешь разобраться — я помогу сориентироваться в курсах и материалах Академии." },
];
const INCIDENT_Q =
  "Когда команда попадает под давление дедлайна, люди начинают говорить друг с другом как будто на разных языках. Как это объясняется на курсе про уровни сознания?";

test("S1/P4-B: an uncertainty turn invalidates the stored selection, so «этот курс» no longer pays the stale course", async () => {
  const [t1, t2] = await runSequence(
    [{ user: A1_UNRESOLVED, decide: FU("maslow") }, { user: "Хочу оплатить этот курс.", decide: NAV }],
    { initial: selectedLoc() },
  );
  assert.equal(t1.status, 200);
  assert.ok(t1.uncertainty);
  assert.deepEqual(t1.retrieved, []);
  assert.equal(t1.selected, null);
  assert.equal(t1.courseMatch, "UNKNOWN");
  assert.equal(t2.paymentCourse, null);

  // OD-1=A1: the resolved COURSERA turn (residual) still invalidates the stale
  // selection (CORR1 P4-B safety), so «этот курс» never pays the stale course.
  const [r1, r2] = await runSequence(
    [{ user: COURSERA, decide: FU("maslow") }, { user: "Хочу оплатить этот курс.", decide: NAV }],
    { initial: selectedLoc() },
  );
  assert.equal(r1.status, 200);
  assert.ok(!r1.uncertainty);
  assert.deepEqual(r1.retrieved, ["maslow"]);
  assert.equal(r1.selected, null);
  assert.equal(r1.courseMatch, "UNKNOWN");
  assert.equal(r2.paymentCourse, null);
});

test("API mapping: the uncertainty turn is NAVIGATE / COURSE_SELECTION, never OUT_OF_SCOPE or TECHNICAL_ERROR, with the unchanged wire shape", async () => {
  // MAJOR-REMEDIATION-1.CORR1 (OD-1=A1): the mapping is kept on an A1-unresolved turn.
  const [incident] = await runSequence([{ user: A1_UNRESOLVED, decide: FU("maslow") }], { prior: INCIDENT });
  assert.equal(incident.status, 200);
  assert.ok(incident.uncertainty);
  assert.equal(incident.act, "NAVIGATE");
  assert.equal(incident.flowId, "COURSE_SELECTION");
  assert.deepEqual(incident.keys, ["contactCard", "conversationState", "message", "profile", "resetConversation"]);

  // The incident question names one course explicitly; under A1 it is answered.
  const [resolved] = await runSequence([{ user: INCIDENT_Q, decide: FU("levels-of-consciousness") }], { prior: INCIDENT });
  assert.equal(resolved.status, 200);
  assert.ok(!resolved.uncertainty);
  assert.notEqual(resolved.act, "OUT_OF_SCOPE");
  assert.notEqual(resolved.act, "TECHNICAL_ERROR");
  assert.deepEqual(resolved.retrieved, ["levels-of-consciousness"]);
  assert.deepEqual(resolved.keys, ["contactCard", "conversationState", "message", "profile", "resetConversation"]);
});

test("S2: a foreign course mention never becomes a payment destination", async () => {
  const [turn] = await runSequence([{ user: "Хочу оплатить этот курс.", decide: FU("maslow") }], {
    prior: [
      { role: "user", content: "Школа феникс запустила курс про Маслоу." },
      { role: "assistant", content: "Понятно." },
    ],
  });
  assert.equal(turn.paymentCourse, null);
  // MAJOR-REMEDIATION-1.CORR2 (F-01): the HEAD assertion is restored. A1 content
  // identity does not ground Academy commercial authority for a reported foreign
  // course, so the payment request keeps the controlled uncertainty: no Academy
  // price, no general or course-specific payment handoff, no RAG.
  assert.ok(turn.uncertainty);
  assert.deepEqual(turn.retrieved, []);
  assert.doesNotMatch(turn.message, /AST_payment_course_bot\?start=/u);
  assert.equal(turn.paymentBot, false);
  assert.doesNotMatch(turn.message, /₽/u);
});

test("S3/S16 (P3-A, P7-A): the inherited literal and stored-selection commercial paths are unchanged", async () => {
  const [literal] = await runSequence([{ user: "Хочу оплатить этот курс.", decide: FU("maslow") }], {
    prior: [{ role: "assistant", content: `Рекомендую «${titleOf("maslow")}».` }],
  });
  assert.equal(literal.paymentCourse, "maslow");
  const [stored] = await runSequence([{ user: "Хочу оплатить этот курс.", decide: NAV }], {
    initial: wireState((s) => withCourseBinding(s, "MATCHED", "maslow")),
  });
  assert.equal(stored.paymentCourse, "maslow");
});

test("S4: bounded exit through the API — clarify, clarify, exhausted, then the cycle restarts", async () => {
  // MAJOR-REMEDIATION-1.CORR1 (OD-1=A1): the A1-unresolved input keeps the exit cycle.
  const turns = await runSequence([1, 2, 3, 4, 5].map(() => ({ user: A1_UNRESOLVED, decide: FU("maslow") })));
  const kinds = turns.map((t) => (t.message === composeReferenceClarificationExhausted() ? "X" : t.uncertainty ? "C" : "?"));
  assert.equal(kinds.join(""), "CCXCC");
  assert.ok(turns.every((t) => t.retrieved.length === 0 && t.paymentCourse === null));
});

test("S5/S6/S12: recovery — independent questions, topic switches and literal titles proceed normally", async () => {
  const repeated = await runSequence(
    [1, 2, 3].map(() => ({
      user: "На курсе английского обсуждали уровни сознания. А что такое архетип Тени?",
      decide: CT_PART("structural-typology", "А что такое архетип Тени?"),
    })),
  );
  assert.ok(repeated.every((t) => t.retrieved.join() === "structural-typology"));

  // MAJOR-REMEDIATION-1.CORR1 (OD-1=A1): recovery after an A1-unresolved turn.
  const [c, answered, oos] = await runSequence([
    { user: A1_UNRESOLVED, decide: FU("maslow") },
    { user: "Что такое архетип Тени?", decide: CT("structural-typology") },
    { user: "Какая погода в Лондоне?", decide: OOS },
  ]);
  assert.ok(c.uncertainty);
  assert.deepEqual(answered.retrieved, ["structural-typology"]);
  assert.equal(oos.act, "OUT_OF_SCOPE");

  const [, literal] = await runSequence([
    { user: COURSERA, decide: FU("maslow") },
    { user: `Расскажите про ${titleOf("maslow")}.`, decide: FU("maslow") },
  ]);
  assert.deepEqual(literal.retrieved, ["maslow"]);
});

test("S7/S8: the P03 payment clarification budget and the kernel's exhaustion precedence are preserved", async () => {
  const [, second] = await runSequence(
    [
      { user: COURSERA, decide: FU("maslow") },
      { user: "Курс про Маслоу на Coursera — что там?", decide: FU("maslow") },
    ],
    { initial: p03(2) },
  );
  const clarification = second.clarification as { issueKey?: string; attempts?: number } | null;
  assert.equal(clarification?.attempts, 2);
  assert.match(String(clarification?.issueKey), /^payment-multiple/u);
  assert.deepEqual(second.referents, ["levels-of-consciousness", "maslow"]);

  const [exhausted] = await runSequence([{ user: COURSERA, decide: FU("maslow") }], { initial: p03(3) });
  assert.equal(exhausted.classifierCalls, 0);
  assert.equal(exhausted.handoff, "OFFERED");
});

test("S10/S11: explicit payment and selection retention across an independent question are unchanged", async () => {
  const [explicit] = await runSequence([{ user: "Хочу оплатить курс Маслоу", decide: CT("normative-situation") }]);
  assert.equal(explicit.paymentCourse, "maslow");

  const [independent, pay] = await runSequence(
    [
      { user: "Что такое архетип Тени?", decide: CT("structural-typology") },
      { user: "Хочу оплатить этот курс.", decide: NAV },
    ],
    { initial: selectedLoc() },
  );
  assert.deepEqual(independent.retrieved, ["structural-typology"]);
  assert.equal(pay.paymentCourse, "levels_of_consciousness");
});

test("S13/S14: the incident — R1 is a non-technical clarification, R2 is answered", async () => {
  // MAJOR-REMEDIATION-1.CORR1 (OD-1=A1): R1 names exactly one course in the user's own
  // words, so it is now answered (the same lane as R2) instead of clarified.
  const [r1] = await runSequence([{ user: INCIDENT_Q, decide: FU("levels-of-consciousness") }], { prior: INCIDENT });
  assert.ok(!r1.uncertainty);
  assert.notEqual(r1.act, "TECHNICAL_ERROR");
  assert.deepEqual(r1.retrieved, ["levels-of-consciousness"]);
  const [r2] = await runSequence(
    [{ user: INCIDENT_Q, decide: CT_PART("levels-of-consciousness", "Как это объясняется на курсе про уровни сознания?") }],
    { prior: INCIDENT },
  );
  assert.deepEqual(r2.retrieved, ["levels-of-consciousness"]);
});

test("S15: after an uncertainty turn a price question no longer prices the stale selection", async () => {
  const [, price] = await runSequence(
    [{ user: COURSERA, decide: FU("maslow") }, { user: "Сколько стоит этот курс?", decide: PRICE }],
    { initial: selectedLoc() },
  );
  assert.ok(!price.message.includes(titleOf("levels-of-consciousness")));
});

/* ---------------------------------------------------------------------------
 * NAVIGATOR-PRODUCTION-SMOKE-1.C1C2-IMPLEMENTATION-1 — stubbed full sequences.
 *
 * Provider JSON is injected per turn for the act classifier and, where the
 * turn reaches it, for the selection router; the real validators, kernel,
 * reducer, payment policy and API mapping run unchanged. These are L0 locks of
 * the deterministic mechanics for FIXED proposals, never a provider-accuracy
 * claim.
 * ------------------------------------------------------------------------ */

const SMOKE_SETUP: Msg[] = [
  { role: "user", content: "Меня зовут Тест. На «вы»." },
  { role: "assistant", content: "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии." },
];
const T04_Q = "Что даёт курс по структурной типологии личности для работы с типологией Майерс-Бриггс?";
const T09_Q = "Что на курсе Маслоу говорят о нормативной ситуации";
const MASLOW_PICK = "Хочу пройти курс Маслоу.";
const SECOND_COURSE = "А ещё я рассматриваю курс «Нормативная ситуация».";
const TASK_QUESTION =
  "Расскажите, пожалуйста, какую задачу вы хотите решить с помощью обучения: что именно важно понять или изменить в работе с людьми?";
const C2_CLAUSE = "ДВА КУРСА КАК ТЕКУЩИЕ АЛЬТЕРНАТИВЫ";

function lastUserIndexWith(messages: readonly Msg[], quote: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user" && messages[index].content.includes(quote)) return index;
  }
  throw new Error(`quote not found in user messages: ${quote}`);
}
const RECOMMEND = (courseId: string, quote: string): RouteFn => (messages) => ({
  state: "RECOMMEND_COURSE",
  primaryCourseId: courseId,
  secondaryCourseIds: [],
  learningNeed: "Учебная задача пользователя.",
  evidence: [{ messageIndex: lastUserIndexWith(messages, quote), quote }],
  confidence: "sufficient",
});
const ASK_PAIR: RouteFn = () => ({
  state: "ASK_MORE",
  candidateCourseIds: ["maslow", "normative-situation"],
  questions: [TASK_QUESTION],
  rationale: "Пользователь рассматривает два курса; ответ о задаче решает выбор.",
});
const PICK_MASLOW = { user: MASLOW_PICK, decide: NAV, route: RECOMMEND("maslow", "Хочу пройти курс Маслоу") };
const CONSIDER_SECOND = { user: SECOND_COURSE, decide: NAV, route: ASK_PAIR };

test("C1 T04/T09: the exact smoke histories answer CONTENT for the explicitly requested course only, with no selection or payment", async () => {
  for (const [question, courseId] of [[T04_Q, "structural-typology"], [T09_Q, "maslow"]] as const) {
    const [turn] = await runSequence([{ user: question, decide: CT(courseId) }], { prior: SMOKE_SETUP });
    assert.equal(turn.status, 200, question);
    assert.deepEqual(turn.retrieved, [courseId], question);
    assert.equal(turn.routerCalls, 0, question);
    assert.equal(turn.uncertainty, false, question);
    assert.notEqual(turn.act, "TECHNICAL_ERROR", question);
    assert.equal(turn.selected, null, question);
    assert.equal(turn.paymentBot, false, question);
  }
  // HI (B2): a proposal of the topic course is the controlled clarification with zero retrieval.
  const [topic] = await runSequence([{ user: T09_Q, decide: CT("normative-situation") }], { prior: SMOKE_SETUP });
  assert.ok(topic.uncertainty);
  assert.deepEqual(topic.retrieved, []);
  assert.equal(topic.paymentBot, false);
});

test("C1 negatives: C11 antecedent, selection and price turns never retrieve another course", async () => {
  // B1 — C11: a container reference over a resolved earlier course stays unresolved.
  const [c11] = await runSequence(
    [{ user: "Что там говорят о Маслоу", decide: CT("maslow") }],
    { prior: [{ role: "user", content: "Прохожу курс уровней сознания" }, { role: "assistant", content: "Понятно." }] },
  );
  assert.ok(c11.uncertainty);
  assert.deepEqual(c11.retrieved, []);
  // B10 — a short-name selection statement stays NAVIGATE → MATCHED, no CONTENT retrieval.
  const [pick] = await runSequence([PICK_MASLOW], { prior: SMOKE_SETUP });
  assert.equal(pick.selected, "maslow");
  assert.equal(pick.courseMatch, "MATCHED");
  assert.deepEqual(pick.retrieved, ["maslow"]);
  assert.equal(pick.routerCalls, 1);
  // B11 — a short-name price question is FACTUAL: no retrieval, no router.
  const [price] = await runSequence(
    [{
      user: "Сколько стоит курс Маслоу?",
      decide: () => ({
        state: "FACTUAL",
        intents: [{ kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: ["PRICE"], scope: "REFERENCED" }],
      }),
    }],
    { prior: SMOKE_SETUP },
  );
  assert.deepEqual(price.retrieved, []);
  assert.equal(price.routerCalls, 0);
  assert.equal(price.selected, null);
});

test("C1 literal history (F-1/P8-A unchanged): CONTENT stays unavailable; the clarification lane is non-technical and the inherited degrade lane never retrieves or pays", async () => {
  const literalHistories: Array<[string, Msg[], string, string]> = [
    ["B4 user literal title", [{ role: "user", content: titleOf("levels-of-consciousness") }, { role: "assistant", content: "Понятно." }], "Что на курсе Маслоу говорят о мотивации?", "maslow"],
    ["B6 user literal URL", [{ role: "user", content: "https://structural-typology.academy/courses/maslow" }, { role: "assistant", content: "Понятно." }], T04_Q, "structural-typology"],
    ["B7 unroutable title", [{ role: "user", content: titleOf("professional-development-stages") }, { role: "assistant", content: "Понятно." }], T04_Q, "structural-typology"],
  ];
  for (const [label, prior, question, courseId] of literalHistories) {
    // The FOLLOW_UP alternative for a short-named course is the controlled clarification.
    const [followUp] = await runSequence([{ user: question, decide: FU(courseId) }], { prior });
    assert.ok(followUp.uncertainty, label);
    assert.notEqual(followUp.act, "TECHNICAL_ERROR", label);
    assert.deepEqual(followUp.retrieved, [], label);
    // A forbidden CONTENT proposal is still rejected by the unchanged F-1 guard: the
    // pre-existing degrade lane binds nothing, retrieves nothing and pays nothing.
    const [content] = await runSequence([{ user: question, decide: CT(courseId) }], { prior });
    assert.deepEqual(content.retrieved, [], label);
    assert.equal(content.selected, null, label);
    assert.equal(content.paymentBot, false, label);
  }
  // P1-0 unchanged: the course whose own literal URL is present keeps literal FOLLOW_UP authority.
  const [literal] = await runSequence([{ user: "Что на этом курсе говорят о мотивации?", decide: FU("maslow") }], {
    prior: literalHistories[1][1],
  });
  assert.equal(literal.uncertainty, false);
  assert.deepEqual(literal.retrieved, ["maslow"]);
});

test("C2 T10: a second considered course yields the task clarification — AMBIGUOUS/null, both candidates, no referents, no retrieval", async () => {
  const [first, second] = await runSequence([PICK_MASLOW, CONSIDER_SECOND]);
  assert.equal(first.selected, "maslow");
  assert.equal(first.courseMatch, "MATCHED");

  assert.equal(second.status, 200);
  assert.equal(second.routerCalls, 1);
  assert.ok(second.routerPrompts[0]?.includes(C2_CLAUSE));
  assert.equal(second.selected, null);
  assert.equal(second.courseMatch, "AMBIGUOUS");
  assert.deepEqual(second.clarification, {
    issueKey: "ask-more:maslow+normative-situation",
    attempts: 1,
    strategyKey: "ask-more-1",
  });
  assert.deepEqual(second.referents, []);
  assert.equal(second.pendingQuestion, TASK_QUESTION);
  assert.deepEqual(second.retrieved, []);
  assert.equal(second.paymentBot, false);
});

test("C2 payment after a second-course reference: no course-specific link for the previously selected course", async () => {
  for (const payTurn of [
    { user: "Как оплатить?", decide: NAV },
    { user: "Хочу оплатить этот курс.", decide: NAV },
    { user: "Сколько стоит оплата?", decide: PRICE },
  ]) {
    const [, , pay] = await runSequence([PICK_MASLOW, CONSIDER_SECOND, payTurn]);
    assert.equal(pay.paymentCourse, null, payTurn.user);
    assert.equal(pay.routerCalls, 0, payTurn.user);
    assert.equal(pay.selected, null, payTurn.user);
  }
  const [, , generic] = await runSequence([PICK_MASLOW, CONSIDER_SECOND, { user: "Как оплатить?", decide: NAV }]);
  assert.equal(generic.message, composePaymentAmbiguityAnswer(VY_PROFILE));
});

test("C2 distinctions: historical mention and confirmation keep the selection; explicit replacement rebinds; none asks", async () => {
  for (const [label, text, quote] of [
    ["historical", "Раньше я уже прошёл курс «Нормативная ситуация».", "Хочу пройти курс Маслоу"],
    ["confirmation", "Да, курс Маслоу мне подходит.", "курс Маслоу мне подходит"],
  ] as const) {
    const [, turn] = await runSequence([PICK_MASLOW, { user: text, decide: NAV, route: RECOMMEND("maslow", quote) }]);
    assert.equal(turn.selected, "maslow", label);
    assert.equal(turn.courseMatch, "MATCHED", label);
    assert.equal(turn.clarification, null, label);
    assert.equal(turn.pendingQuestion, null, label);
  }

  const [, replaced, pay] = await runSequence([
    PICK_MASLOW,
    {
      user: "Нет, передумал: лучше курс «Нормативная ситуация».",
      decide: NAV,
      route: RECOMMEND("normative-situation", "лучше курс «Нормативная ситуация»"),
    },
    { user: "Хочу оплатить этот курс.", decide: NAV },
  ]);
  assert.equal(replaced.selected, "normative-situation");
  assert.equal(replaced.courseMatch, "MATCHED");
  assert.equal(replaced.clarification, null);
  assert.equal(pay.paymentCourse, "normative_situation");
});

test("C2 resolution: a deciding task answer recommends one course, and the next content turn does not restart selection", async () => {
  const [, , resolved, content, pay] = await runSequence([
    PICK_MASLOW,
    CONSIDER_SECOND,
    {
      user: "Мне важнее разобраться, почему в команде не работают правила.",
      decide: NAV,
      route: RECOMMEND("normative-situation", "почему в команде не работают правила"),
    },
    { user: "А что именно разбирают на этом курсе?", decide: FU("normative-situation") },
    { user: "Хочу оплатить этот курс.", decide: NAV },
  ]);
  assert.equal(resolved.routerCalls, 1);
  assert.equal(resolved.selected, "normative-situation");
  assert.equal(resolved.courseMatch, "MATCHED");
  assert.equal(resolved.clarification, null);

  assert.equal(content.routerCalls, 0);
  assert.deepEqual(content.retrieved, ["normative-situation"]);
  assert.equal(content.selected, "normative-situation");
  assert.equal(content.clarification, null);
  assert.equal(content.uncertainty, false);

  assert.equal(pay.paymentCourse, "normative_situation");
});

test("payment K1/K2/K3 for fixed act/state inputs and foreign-platform payment are unchanged by C1/C2", async () => {
  // K1 — explicit course in the payment request; general bot without a course.
  const [k1] = await runSequence([{ user: "Хочу оплатить курс Маслоу", decide: NAV }]);
  assert.equal(k1.paymentCourse, "maslow");
  const [general] = await runSequence([{ user: "Как записаться?", decide: NAV }]);
  assert.equal(general.paymentCourse, null);
  // K2 — stored MATCHED selection.
  const [k2] = await runSequence([{ user: "Хочу оплатить", decide: NAV }], {
    initial: wireState((s) => withCourseBinding(s, "MATCHED", "maslow")),
  });
  assert.equal(k2.paymentCourse, "maslow");
  // K3 — literal FOLLOW_UP after a recommendation.
  const [k3] = await runSequence([{ user: "Хочу на этот курс.", decide: FU("maslow") }], {
    prior: [{ role: "assistant", content: `Рекомендую «${titleOf("maslow")}».` }],
  });
  assert.equal(k3.paymentCourse, "maslow");
  // E6 — a different explicit course over a stored selection is a confirmation, never a link.
  const [change] = await runSequence([{ user: `Хочу оплатить курс «${titleOf("normative-situation")}»`, decide: NAV }], {
    initial: wireState((s) => withCourseBinding(s, "MATCHED", "maslow")),
  });
  assert.equal(change.paymentCourse, null);
  // Foreign platform: no course-specific payment authority under any act or context.
  for (const initial of [undefined, wireState((s) => withCourseBinding(s, "MATCHED", "maslow"))]) {
    for (const decide of [NAV, OOS, CT("maslow")]) {
      const [foreign] = await runSequence([{ user: "Как оплатить курс Маслоу на Coursera?", decide }], { initial });
      assert.equal(foreign.paymentCourse, null);
    }
  }
});
