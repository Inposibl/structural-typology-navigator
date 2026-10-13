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
  turns: Array<{ user: string; decide: DecideFn }>,
  options: { initial?: unknown; prior?: Msg[] } = {},
): Promise<TurnOut[]> {
  let history: Msg[] = [...(options.prior ?? [])];
  let state: unknown = options.initial ?? null;
  const outs: TurnOut[] = [];
  for (const [index, turn] of turns.entries()) {
    history = [...history, { role: "user", content: turn.user }];
    const retrieved: string[] = [];
    let classifierCalls = 0;
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
          route: async () => ({ state: "NO_CURRENT_COURSE_MATCH", rationale: "STUB" }) as never,
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
    [{ user: COURSERA, decide: FU("maslow") }, { user: "Хочу оплатить этот курс.", decide: NAV }],
    { initial: selectedLoc() },
  );
  assert.equal(t1.status, 200);
  assert.ok(t1.uncertainty);
  assert.deepEqual(t1.retrieved, []);
  assert.equal(t1.selected, null);
  assert.equal(t1.courseMatch, "UNKNOWN");
  assert.equal(t2.paymentCourse, null);
});

test("API mapping: the uncertainty turn is NAVIGATE / COURSE_SELECTION, never OUT_OF_SCOPE or TECHNICAL_ERROR, with the unchanged wire shape", async () => {
  const [incident] = await runSequence([{ user: INCIDENT_Q, decide: FU("levels-of-consciousness") }], { prior: INCIDENT });
  assert.equal(incident.status, 200);
  assert.ok(incident.uncertainty);
  assert.equal(incident.act, "NAVIGATE");
  assert.equal(incident.flowId, "COURSE_SELECTION");
  assert.deepEqual(incident.keys, ["contactCard", "conversationState", "message", "profile", "resetConversation"]);
});

test("S2: a foreign course mention never becomes a payment destination", async () => {
  const [turn] = await runSequence([{ user: "Хочу оплатить этот курс.", decide: FU("maslow") }], {
    prior: [
      { role: "user", content: "Школа феникс запустила курс про Маслоу." },
      { role: "assistant", content: "Понятно." },
    ],
  });
  assert.equal(turn.paymentCourse, null);
  assert.ok(turn.uncertainty);
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
  const turns = await runSequence([1, 2, 3, 4, 5].map(() => ({ user: COURSERA, decide: FU("maslow") })));
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

  const [c, answered, oos] = await runSequence([
    { user: COURSERA, decide: FU("maslow") },
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
  const [r1] = await runSequence([{ user: INCIDENT_Q, decide: FU("levels-of-consciousness") }], { prior: INCIDENT });
  assert.ok(r1.uncertainty);
  assert.notEqual(r1.act, "TECHNICAL_ERROR");
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
