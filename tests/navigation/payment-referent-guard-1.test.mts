import assert from "node:assert/strict";
import test, { after } from "node:test";

import { handleChatRequest } from "../../src/app/api/chat/route.ts";
import type { ConversationMessage, ConversationProfile } from "../../src/lib/chat-contract.ts";
import { routeConversationAct } from "../../src/lib/navigation/conversation-act-router.ts";
import {
  orchestrateNavigatorResponse,
  type NavigatorOrchestrationResult,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  createInitialConversationState,
  withCourseBinding,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import { composePaymentCourseIdentityRequiredAnswer } from "../../src/lib/navigation/conversation-response.ts";
import { ACADEMY_COMMERCIAL_AUTHORITY_VERSION } from "../../src/lib/academy/commercial-authority.ts";

/**
 * NAVIGATOR-LIMITED-PREVIEW-READINESS-1.PAYMENT-REFERENT-GUARD-1 — a
 * course-specific payment destination never contradicts the course the user's
 * own previous turn established.
 *
 * Every turn goes through the real chat route (`handleChatRequest`), the real
 * control kernel, router validator, orchestrator, payment policy, commercial
 * authority, metadata guard and composers. The actual response text and the
 * returned conversationState of each turn feed the next request. Only the
 * provider seams are fixed: the act proposal, retrieval (empty), the evidence
 * selector and the educational router. Global fetch throws and is counted.
 */

type Msg = ConversationMessage;
type Proposal = () => Record<string, unknown>;
type Step = { user: string; propose: Proposal };
type TurnRecord = {
  status: number;
  message: string;
  state: ConversationState;
  selectedBefore: string | null;
  selectedAfter: string | null;
  result: NavigatorOrchestrationResult;
};

let networkAttempts = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  networkAttempts += 1;
  throw new Error("PAYMENT-REFERENT-GUARD-1 TEST NETWORK FORBIDDEN");
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const VY: ConversationProfile = { displayName: null, addressMode: "VY", nameDeclined: true, pendingUserRequest: null };

const LEVELS = "levels-of-consciousness";
const MASLOW_PRICE_Q = "Сколько стоит курс Маслоу?";
const PAY_THIS = "Хочу оплатить этот курс.";
const MASLOW_TITLE = "Иерархия потребностей А. Маслоу: новая парадигма";
const LEVELS_TITLE = "Иерархия уровней сознания";
const MASLOW_PRICE_LINE = `«${MASLOW_TITLE}»: последняя подтверждённая цена по данным на 19 сентября 2026 года — 60 000 ₽.`;
const literal = (text: string): RegExp => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u");
const IDENTITY_REQUIRED = composePaymentCourseIdentityRequiredAnswer(VY);
const ANY_BOT = /AST_payment_course_bot/u;
const COURSE_BOT = /AST_payment_course_bot\?start=([a-z_]+)/u;
const FABRICATED_TRANSACTION =
  /(?:вы|ты)\s+(?:успешно\s+)?(?:записан|зачислен)|оплата\s+(?:прошла|проведена|получена|подтверждена)|оплачено|чек|квитанци|счёт\s+(?:выставлен|отправлен)|номер\s+(?:заказа|брони)|бронь\s+подтвержден/iu;

const NAV: Proposal = () => ({ state: "NAVIGATE" });
const FU = (courseId: string): Proposal => () => ({ state: "COURSE_FOLLOW_UP", courseId, evidenceRequested: false });
const CT = (courseId: string): Proposal => () => ({
  state: "COURSE_CONTENT",
  courseId,
  evidenceRequested: false,
  contentIntentEvidence: "PAYMENT-REFERENT-GUARD-1 fixture",
});
const PRICE_REFERENCED = (courseId: string): Proposal => () => ({
  state: "FACTUAL",
  intents: [{ kind: "CURRENT_METADATA", courseIds: [courseId], fields: ["PRICE"], scope: "REFERENCED" }],
});
const PRICE_SELECTED: Proposal = () => ({
  state: "FACTUAL",
  intents: [{ kind: "CURRENT_METADATA", courseIds: [], fields: ["PRICE"], scope: "SELECTED" }],
});

const user = (content: string): Msg => ({ role: "user", content });
const assistant = (content: string): Msg => ({ role: "assistant", content });

function wireState(selectedCourseId: string | null): unknown {
  const initial = createInitialConversationState(Date.now());
  const state = selectedCourseId === null ? initial : withCourseBinding(initial, "MATCHED", selectedCourseId);
  return JSON.parse(JSON.stringify(state));
}

async function apiSequence(
  steps: Step[],
  options: { prior?: Msg[]; initial?: unknown } = {},
): Promise<TurnRecord[]> {
  let history: Msg[] = [...(options.prior ?? [])];
  let state: unknown = options.initial ?? null;
  const out: TurnRecord[] = [];
  for (const [index, step] of steps.entries()) {
    history = [...history, user(step.user)];
    const captured: { result: NavigatorOrchestrationResult | null } = { result: null };
    const orchestrate: typeof orchestrateNavigatorResponse = async (messages, orchestrationOptions) => {
      captured.result = await orchestrateNavigatorResponse(messages, {
        ...orchestrationOptions,
        dependencies: {
          classifyAct: (effective) =>
            routeConversationAct(effective, { callJson: async () => step.propose() }),
          retrieve: async () => ({ hasActiveSources: true, bindings: [], matches: [] }),
          resolve: () => [],
          selectEvidence: async () => ({ status: "INSUFFICIENT", evidence: [] }),
          route: async () => ({ state: "NO_CURRENT_COURSE_MATCH", rationale: "GUARD-1 fixture" }) as never,
          compose: async () => "GUARD-1 recommendation fixture",
          extractPlan: async () => {
            throw new Error("GUARD-1 fixture: no plan extraction");
          },
        },
      });
      return captured.result;
    };
    const selectedBefore =
      state === null ? null : ((state as ConversationState).selectedCourseId ?? null);
    const body: Record<string, unknown> = { messages: history, profile: VY, requestId: `guard1-${index}` };
    if (state !== null) body.conversationState = state;
    const silenced = [console.info, console.warn] as const;
    console.info = () => undefined;
    console.warn = () => undefined;
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
      [console.info, console.warn] = silenced;
    }
    const json = (await response.json()) as {
      message?: string;
      conversationState?: ConversationState;
      error?: { message?: string; conversationState?: ConversationState };
    };
    const result = captured.result;
    const returnedState = json.conversationState ?? json.error?.conversationState;
    assert.ok(result !== null, `turn ${index + 1} reached the orchestrator`);
    assert.ok(returnedState, `turn ${index + 1} returned a conversation state`);
    const message = String(json.message ?? json.error?.message ?? "");
    out.push({
      status: response.status,
      message,
      state: returnedState,
      selectedBefore,
      selectedAfter: returnedState.selectedCourseId ?? null,
      result,
    });
    history = [...history, assistant(message)];
    state = returnedState;
  }
  assert.equal(networkAttempts, 0, "no provider or network call");
  return out;
}

function assertNoTransactionState(turn: TurnRecord, label: string): void {
  assert.doesNotMatch(turn.message, FABRICATED_TRANSACTION, label);
  assert.equal(turn.result.stateEffects.pendingConfirmation, null, label);
}

function assertGuarded(turn: TurnRecord, label: string): void {
  assert.equal(turn.status, 200, label);
  assert.equal(turn.result.observability?.answerOrigin, "PAYMENT_POLICY", label);
  assert.equal(turn.message, IDENTITY_REQUIRED, label);
  assert.doesNotMatch(turn.message, ANY_BOT, label);
  assert.ok(!turn.message.includes(LEVELS_TITLE), label);
  assert.ok(!turn.message.includes(MASLOW_TITLE), label);
  assert.equal(turn.result.stateEffects.courseBinding, undefined, label);
  assert.equal(turn.selectedAfter, LEVELS, `${label}: the stored selection is not changed`);
  assertNoTransactionState(turn, label);
}

/* ============================================ A — mismatched payment referent */

test("GUARD-1 A: stored Levels → Maslow price → «Хочу оплатить этот курс.» asks for the course, never the Levels link", async () => {
  for (const [label, priceProposal, payProposal] of [
    ["native FACTUAL price, NAVIGATE pay", PRICE_REFERENCED("maslow"), NAV],
    ["native FACTUAL price, FOLLOW_UP pay", PRICE_REFERENCED("maslow"), FU("maslow")],
    ["FOLLOW_UP price, NAVIGATE pay", FU("maslow"), NAV],
  ] as const) {
    const [price, pay] = await apiSequence(
      [
        { user: MASLOW_PRICE_Q, propose: priceProposal },
        { user: PAY_THIS, propose: payProposal },
      ],
      { initial: wireState(LEVELS) },
    );

    // The factual price turn keeps its accepted retention: Maslow is priced, Levels stays selected.
    assert.equal(price.result.conversationAct.state, "FACTUAL", label);
    assert.match(price.message, literal(MASLOW_PRICE_LINE), label);
    assert.equal(price.selectedBefore, LEVELS, label);
    assert.equal(price.selectedAfter, LEVELS, label);
    assert.equal(price.result.stateEffects.courseBinding, undefined, label);

    // The payment turn is the guarded boundary.
    assert.equal(pay.selectedBefore, LEVELS, label);
    assertGuarded(pay, label);
    assert.doesNotMatch(pay.message, /levels_of_consciousness/u, label);
  }
});

test("GUARD-1 A: pronoun and bare payment forms, and a repeated pronoun, stay guarded; naming the course resolves it", async () => {
  for (const payText of ["Хочу оплатить его.", "Хочу оплатить.", "Как оплатить этот курс?"]) {
    const [, pay] = await apiSequence(
      [
        { user: MASLOW_PRICE_Q, propose: PRICE_REFERENCED("maslow") },
        { user: payText, propose: NAV },
      ],
      { initial: wireState(LEVELS) },
    );
    assertGuarded(pay, payText);
  }

  const [, first, repeat, named] = await apiSequence(
    [
      { user: MASLOW_PRICE_Q, propose: PRICE_REFERENCED("maslow") },
      { user: PAY_THIS, propose: NAV },
      { user: PAY_THIS, propose: NAV },
      { user: "Хочу оплатить курс уровней сознания.", propose: NAV },
    ],
    { initial: wireState(LEVELS) },
  );
  assertGuarded(first, "first pronoun");
  assertGuarded(repeat, "repeated pronoun");
  // The user names the selected course: the unchanged policy pays it.
  assert.equal(named.result.observability?.answerOrigin, "PAYMENT_POLICY");
  assert.equal(COURSE_BOT.exec(named.message)?.[1], "levels_of_consciousness");
  assertNoTransactionState(named, "named levels");
});

/* ================================================== B — consistent selection */

test("GUARD-1 B: when the stored selection is the course just discussed, the authorized course link is unchanged", async () => {
  const [maslowPrice, maslowPay] = await apiSequence(
    [
      { user: MASLOW_PRICE_Q, propose: PRICE_REFERENCED("maslow") },
      { user: PAY_THIS, propose: NAV },
    ],
    { initial: wireState("maslow") },
  );
  assert.match(maslowPrice.message, literal(MASLOW_PRICE_LINE));
  assert.equal(maslowPay.result.observability?.answerOrigin, "PAYMENT_POLICY");
  assert.equal(COURSE_BOT.exec(maslowPay.message)?.[1], "maslow");
  assert.equal(maslowPay.selectedAfter, "maslow");
  assertNoTransactionState(maslowPay, "maslow selected");

  const [, levelsPay] = await apiSequence(
    [
      { user: "Сколько стоит курс уровней сознания?", propose: PRICE_REFERENCED(LEVELS) },
      { user: PAY_THIS, propose: NAV },
    ],
    { initial: wireState(LEVELS) },
  );
  assert.equal(COURSE_BOT.exec(levelsPay.message)?.[1], "levels_of_consciousness");
  assertNoTransactionState(levelsPay, "levels selected, levels named");

  // A price question that names no course establishes nothing: the selection pays.
  const [selectedPrice, selectedPay] = await apiSequence(
    [
      { user: "Сколько стоит этот курс?", propose: PRICE_SELECTED },
      { user: PAY_THIS, propose: NAV },
    ],
    { initial: wireState(LEVELS) },
  );
  assert.equal(selectedPrice.result.conversationAct.state, "FACTUAL");
  assert.equal(COURSE_BOT.exec(selectedPay.message)?.[1], "levels_of_consciousness");
  assertNoTransactionState(selectedPay, "selected price");
});

test("GUARD-1 B: assistant-only course names and conceptual aliases never establish a conflicting referent", async () => {
  const [assistantOnly] = await apiSequence([{ user: PAY_THIS, propose: NAV }], {
    initial: wireState(LEVELS),
    prior: [user("Сколько стоит этот курс?"), assistant(`Курс «${MASLOW_TITLE}» стоит 60 000 ₽.`)],
  });
  assert.equal(COURSE_BOT.exec(assistantOnly.message)?.[1], "levels_of_consciousness");
  assertNoTransactionState(assistantOnly, "assistant-only");

  const [concept, conceptPay] = await apiSequence(
    [
      { user: "Что такое нормативная ситуация?", propose: CT("normative-situation") },
      { user: PAY_THIS, propose: NAV },
    ],
    { initial: wireState(LEVELS) },
  );
  assert.equal(concept.selectedAfter, LEVELS);
  assert.equal(COURSE_BOT.exec(conceptPay.message)?.[1], "levels_of_consciousness");
  assertNoTransactionState(conceptPay, "conceptual alias");
});

/* =================================================== C — explicit payment target */

test("GUARD-1 C: an explicitly named payment target keeps the unchanged qualified link and course-change confirmation", async () => {
  const [fresh] = await apiSequence([{ user: "Хочу оплатить курс Маслоу.", propose: NAV }]);
  assert.equal(fresh.result.observability?.answerOrigin, "PAYMENT_POLICY");
  assert.equal(COURSE_BOT.exec(fresh.message)?.[1], "maslow");
  assertNoTransactionState(fresh, "fresh named");

  const [, selectedNamed] = await apiSequence(
    [
      { user: MASLOW_PRICE_Q, propose: PRICE_REFERENCED("maslow") },
      { user: "Хочу оплатить курс Маслоу.", propose: NAV },
    ],
    { initial: wireState("maslow") },
  );
  assert.equal(COURSE_BOT.exec(selectedNamed.message)?.[1], "maslow");
  assertNoTransactionState(selectedNamed, "selected named");

  // Stored Levels, explicit Maslow: the existing course-change confirmation, no link yet.
  const [, change] = await apiSequence(
    [
      { user: MASLOW_PRICE_Q, propose: PRICE_REFERENCED("maslow") },
      { user: "Хочу оплатить курс Маслоу.", propose: NAV },
    ],
    { initial: wireState(LEVELS) },
  );
  assert.equal(change.result.stateEffects.pendingConfirmation?.kind, "PAYMENT_COURSE_CHANGE");
  assert.equal(change.result.stateEffects.pendingConfirmation?.candidateCourseId, "maslow");
  assert.doesNotMatch(change.message, ANY_BOT);
  assert.doesNotMatch(change.message, FABRICATED_TRANSACTION);
});

/* ================================================== D — unqualified payment */

test("GUARD-1 D: unqualified payment requests keep the OD-2 limitation, dated price and Academy contact, no bot", async () => {
  for (const text of [
    "Давай хочу оплатить курс Маслоу",
    "Запишите меня на курс Маслоу и проведите оплату прямо сейчас.",
  ]) {
    const [turn] = await apiSequence([{ user: text, propose: NAV }]);
    assert.equal(turn.result.conversationAct.state, "NAVIGATE", text);
    assert.equal(turn.result.observability?.answerOrigin, "PAYMENT_POLICY", text);
    assert.match(turn.message, /Записать вас на курс или провести оплату сам я не могу/u, text);
    assert.match(turn.message, /никакая запись или оплата сейчас не оформлена/u, text);
    assert.match(turn.message, literal(MASLOW_PRICE_LINE), text);
    assert.match(turn.message, /https:\/\/t\.me\/AST_rulang/u, text);
    assert.doesNotMatch(turn.message, ANY_BOT, text);
    assert.equal(turn.result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION, text);
    assertNoTransactionState(turn, text);
  }

  // With no stored selection the unchanged general destination (no course-specific
  // link) is not touched by the guard.
  const [, general] = await apiSequence([
    { user: MASLOW_PRICE_Q, propose: PRICE_REFERENCED("maslow") },
    { user: PAY_THIS, propose: NAV },
  ]);
  assert.equal(general.selectedBefore, null);
  assert.match(general.message, ANY_BOT);
  assert.equal(COURSE_BOT.exec(general.message), null);
  assertNoTransactionState(general, "general destination");
});

/* ================================================ E/F — FACTUAL and no false state */

test("GUARD-1 E/F: a different-course price keeps FACTUAL retention; no guarded turn invents a transaction", async () => {
  const turns = await apiSequence(
    [
      { user: MASLOW_PRICE_Q, propose: PRICE_REFERENCED("maslow") },
      { user: "Сколько стоит этот курс?", propose: PRICE_SELECTED },
      { user: PAY_THIS, propose: NAV },
    ],
    { initial: wireState(LEVELS) },
  );
  const [maslowPrice, selectedPrice, pay] = turns;
  assert.equal(maslowPrice.selectedAfter, LEVELS);
  // Accepted retention: the SELECTED price question still answers the stored Levels course.
  assert.equal(selectedPrice.result.conversationAct.state, "FACTUAL");
  assert.ok(selectedPrice.message.includes(LEVELS_TITLE));
  assert.equal(selectedPrice.selectedAfter, LEVELS);
  // The user's own chain («этот курс» → «курс Маслоу») still establishes Maslow, so the
  // payment referent remains contested: only the payment boundary is guarded.
  assertGuarded(pay, "chained pronoun after a different-course price");
  for (const [index, turn] of turns.entries()) assertNoTransactionState(turn, `turn ${index + 1}`);
});
