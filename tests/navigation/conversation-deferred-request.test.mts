/**
 * A19 deferred substantive remainder lifecycle.
 *
 * A user turn may combine a Package-A conversational control with a
 * substantive remainder that cannot be executed inside the same control
 * response. The remainder must have exactly one deterministic lifecycle:
 *
 *   CAPTURE → PRESERVE → CONSUME EXACTLY ONCE through normal routing → CLEAR
 *
 * or be cleared without execution by an explicit cancel / restart / close /
 * TTL expiry.
 *
 * These tests assert externally observable semantics only: the effective user
 * request that is handed to normal routing, and the resulting conversation
 * state. They do not assume an implementation shape.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareConversationTurn,
} from "../../src/lib/navigation/conversation-turn-control.ts";
import {
  SESSION_CONTEXT_TTL_MS,
  applyOrchestratedTurn,
  createInitialConversationState,
  normalizeConversationStatePayload,
  toSessionTimestamp,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import type { ConversationProfile } from "../../src/lib/chat-contract.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

const COMPLETE_PROFILE: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

const PRIOR_ANSWER =
  "Курс Маслоу описывает иерархию потребностей. Он не является медицинской классификацией.";

function stateWith(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return normalizeConversationStatePayload(
    {
      ...createInitialConversationState(T0),
      lastAssistant: {
        act: "NAVIGATE",
        content: PRIOR_ANSWER,
        courseId: null,
      },
      ...overrides,
    },
    T0,
  );
}

function turn(
  content: string,
  conversationState: ConversationState,
  nowMs: number = T0,
) {
  return prepareConversationTurn(
    [{ role: "user", content }],
    COMPLETE_PROFILE,
    { conversationState, nowMs },
  );
}

/** The effective user request that normal routing would receive. */
function effectiveRequest(result: ReturnType<typeof turn>): string | null {
  if (result.state !== "ROUTE") return null;
  return result.messages.at(-1)?.content ?? null;
}

/** Simulates the successful-routing state transition of the transport layer. */
function afterSuccessfulRouting(
  state: ConversationState,
  message: string,
): ConversationState {
  return applyOrchestratedTurn(
    state,
    {
      act: "NAVIGATE",
      flowId: "COURSE_SELECTION",
      message,
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
}

// ---------------------------------------------------------------------------
// A. CONTROL + SUBSTANTIVE REMAINDER
// ---------------------------------------------------------------------------

test("A: a repeat control captures a substantive remainder without losing it", () => {
  const captured = turn(
    "повтори, а потом расскажи про курс Маслоу",
    stateWith(),
  );

  assert.equal(captured.state, "RESPOND");
  assert.equal(
    captured.conversationState.deferredRequest,
    "расскажи про курс Маслоу",
  );

  // The control response is the repeat plus the bounded preservation note; it
  // is not an answer to the remainder.
  if (captured.state !== "RESPOND") return;
  assert.ok(captured.message.startsWith(PRIOR_ANSWER));
  assert.match(captured.message, /Твой запрос я сохранил/u);
  assert.doesNotMatch(captured.message, /иерархию потребностей[\s\S]*иерархию/u);

  // The next eligible routing opportunity must carry the preserved remainder
  // into normal routing.
  const promoted = turn("и ещё мне интересно", captured.conversationState);
  const request = effectiveRequest(promoted);

  assert.notEqual(request, null);
  assert.match(request ?? "", /расскажи про курс Маслоу/u);
});

test("A: the preserved remainder is not treated as already answered", () => {
  const captured = turn("повтори, а потом расскажи про курс Маслоу", stateWith());
  const promoted = turn("и ещё мне интересно", captured.conversationState);

  // Normal routing receives it as a request to be handled, i.e. it is present
  // in the effective request rather than consumed by the control response.
  assert.match(effectiveRequest(promoted) ?? "", /расскажи про курс Маслоу/u);
});

// ---------------------------------------------------------------------------
// B. SIMPLIFY + SUBSTANTIVE REMAINDER
// ---------------------------------------------------------------------------

test("B: a simplify control preserves its substantive tail for routing", () => {
  const captured = turn(
    "скажи проще, а потом помоги выбрать курс",
    stateWith(),
  );

  assert.equal(captured.state, "RESPOND");
  assert.equal(
    captured.conversationState.deferredRequest,
    "помоги выбрать курс",
  );

  const promoted = turn("хорошо", captured.conversationState);
  assert.match(effectiveRequest(promoted) ?? "", /помоги выбрать курс/u);

  // No duplicate route: the promoted request appears once.
  const request = effectiveRequest(promoted) ?? "";
  assert.equal(request.split("помоги выбрать курс").length - 1, 1);
});

// ---------------------------------------------------------------------------
// C. MULTI-CONTROL + SUBSTANTIVE REMAINDER
// ---------------------------------------------------------------------------

test("C: combined controls with a substantive tail lose nothing and do not replay", () => {
  const state = stateWith({
    suspendedFlow: {
      id: "COURSE_SELECTION",
      pendingQuestion: "Что для тебя важнее: мотивация людей или мышление?",
    },
  });

  const captured = turn(
    "повтори короче, а потом продолжим и расскажи про Маслоу",
    state,
  );

  assert.equal(captured.state, "RESPOND");
  // Both compatible controls were resolved in this turn.
  assert.equal(captured.conversationState.activeFlow?.id, "COURSE_SELECTION");
  assert.equal(captured.conversationState.suspendedFlow, null);
  assert.equal(
    captured.conversationState.deferredRequest,
    "расскажи про Маслоу",
  );

  const promoted = turn("спасибо", captured.conversationState);
  assert.match(effectiveRequest(promoted) ?? "", /расскажи про Маслоу/u);

  // Exactly once: after successful routing the remainder is gone, and the
  // following turn cannot replay it.
  const routed = afterSuccessfulRouting(
    promoted.conversationState,
    "Ответ про курс Маслоу.",
  );
  assert.equal(routed.deferredRequest, null);

  const next = turn("а что ещё", routed);
  assert.doesNotMatch(effectiveRequest(next) ?? "", /расскажи про Маслоу/u);
});

// ---------------------------------------------------------------------------
// D. DEFERRED + CANCEL
// ---------------------------------------------------------------------------

test("D: cancellation clears a preserved remainder and never routes it", () => {
  const captured = turn("повтори, а потом расскажи про курс Маслоу", stateWith());

  const withFlow = normalizeConversationStatePayload(
    {
      ...captured.conversationState,
      activeFlow: { id: "COURSE_SELECTION", pendingQuestion: null },
      courseMatch: "AMBIGUOUS",
    },
    T0,
  );

  const cancelled = turn("отмени это", withFlow);

  assert.equal(cancelled.state, "RESPOND");
  assert.equal(cancelled.conversationState.deferredRequest, null);

  const next = turn("и что дальше", cancelled.conversationState);
  assert.doesNotMatch(effectiveRequest(next) ?? "", /расскажи про курс Маслоу/u);
});

// ---------------------------------------------------------------------------
// E. DEFERRED + FULL RESTART
// ---------------------------------------------------------------------------

test("E: a full restart clears a preserved remainder and resets as accepted", () => {
  const captured = turn("повтори, а потом расскажи про курс Маслоу", stateWith());

  const restarted = turn("давай сначала", captured.conversationState);

  assert.equal(restarted.state, "RESPOND");
  assert.equal(restarted.resetConversation, true);
  assert.equal(restarted.conversationState.deferredRequest, null);
  assert.equal(restarted.profile.displayName, null);

  const next = turn("привет", restarted.conversationState);
  assert.doesNotMatch(effectiveRequest(next) ?? "", /расскажи про курс Маслоу/u);
});

// ---------------------------------------------------------------------------
// F. DEFERRED + CLOSE
// ---------------------------------------------------------------------------

test("F: closing clears a preserved remainder and runs no business route", () => {
  const captured = turn("повтори, а потом расскажи про курс Маслоу", stateWith());

  const closed = turn("пока", captured.conversationState);

  assert.equal(closed.state, "RESPOND");
  assert.equal(closed.conversationState.lifecycle, "CLOSED");
  assert.equal(closed.conversationState.deferredRequest, null);

  // Reopening after the close does not resurrect the reminder.
  const reopened = turn("а теперь расскажи", closed.conversationState);
  assert.doesNotMatch(effectiveRequest(reopened) ?? "", /расскажи про курс Маслоу/u);
});

// ---------------------------------------------------------------------------
// G. DEFERRED + TTL EXPIRY
// ---------------------------------------------------------------------------

test("G: a preserved remainder expires with the working context", () => {
  const captured = turn("повтори, а потом расскажи про курс Маслоу", stateWith());
  assert.equal(
    captured.conversationState.deferredRequest,
    "расскажи про курс Маслоу",
  );

  const stale = normalizeConversationStatePayload(
    {
      ...captured.conversationState,
      lastActivityAt: toSessionTimestamp(T0 - SESSION_CONTEXT_TTL_MS - 1),
    },
    T0,
  );

  const afterExpiry = turn("расскажи что-нибудь полезное", stale);

  assert.equal(afterExpiry.conversationState.deferredRequest, null);
  assert.notEqual(afterExpiry.conversationState.staleReference, null);
  assert.doesNotMatch(
    effectiveRequest(afterExpiry) ?? "",
    /расскажи про курс Маслоу/u,
  );
});

// ---------------------------------------------------------------------------
// H. EXACTLY-ONCE CONSUMPTION
// ---------------------------------------------------------------------------

test("H: a promoted remainder is consumed exactly once", () => {
  const captured = turn("повтори, а потом расскажи про курс Маслоу", stateWith());
  const promoted = turn("и ещё мне интересно", captured.conversationState);

  assert.match(effectiveRequest(promoted) ?? "", /расскажи про курс Маслоу/u);

  const routed = afterSuccessfulRouting(
    promoted.conversationState,
    "Ответ по запросу.",
  );
  assert.equal(routed.deferredRequest, null);

  const second = turn("а теперь другое", routed);
  assert.doesNotMatch(
    effectiveRequest(second) ?? "",
    /расскажи про курс Маслоу/u,
  );

  const third = turn("и ещё одно", second.conversationState);
  assert.doesNotMatch(
    effectiveRequest(third) ?? "",
    /расскажи про курс Маслоу/u,
  );
});

test("H: a second control turn does not silently drop an existing remainder", () => {
  const first = turn("повтори, а потом расскажи про курс Маслоу", stateWith());

  // The tail here is deliberately not itself a control phrase, so the turn
  // captures two genuine substantive remainders in sequence.
  const second = turn(
    "короче, а потом добавь про второй курс",
    first.conversationState,
  );

  assert.equal(second.state, "RESPOND");

  const preserved = second.conversationState.deferredRequest ?? "";
  assert.match(preserved, /расскажи про курс Маслоу/u);
  assert.match(preserved, /добавь про второй курс/u);

  const promoted = turn("хорошо", second.conversationState);
  const request = effectiveRequest(promoted) ?? "";
  assert.match(request, /расскажи про курс Маслоу/u);
  assert.match(request, /добавь про второй курс/u);
});

// ---------------------------------------------------------------------------
// I. ROUTER FAILURE
// ---------------------------------------------------------------------------

test("I: the remainder is not marked consumed before routing accepts it", () => {
  const captured = turn("повтори, а потом расскажи про курс Маслоу", stateWith());
  const promoted = turn("и ещё мне интересно", captured.conversationState);

  // Preparing the turn promotes the remainder into the effective request but
  // must NOT claim it was consumed: only a turn that actually reached normal
  // routing may clear it. A technical failure returns before that transition,
  // so the client keeps a state that still holds the reminder.
  assert.equal(promoted.state, "ROUTE");
  assert.equal(
    promoted.conversationState.deferredRequest,
    "расскажи про курс Маслоу",
  );

  // The state transition that clears it belongs to a successful routed turn.
  const routed = afterSuccessfulRouting(promoted.conversationState, "Ответ.");
  assert.equal(routed.deferredRequest, null);
});

// ---------------------------------------------------------------------------
// J. NO DEFERRED REQUEST
// ---------------------------------------------------------------------------

test("J: an ordinary turn is unchanged when nothing was deferred", () => {
  const state = stateWith();
  const result = turn("мне нужен курс про мотивацию команды", state);

  assert.equal(result.state, "ROUTE");
  assert.equal(
    effectiveRequest(result),
    "мне нужен курс про мотивацию команды",
  );
  assert.equal(result.conversationState.deferredRequest, null);
});

test("J: a control turn without a remainder defers nothing", () => {
  const result = turn("повтори", stateWith());

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.deferredRequest, null);
});
