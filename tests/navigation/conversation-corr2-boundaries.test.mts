/**
 * CORR2 boundary corrections for the deferred-request lifecycle.
 *
 * Three related boundary defects in the A19 deferred-request lifecycle are
 * closed here, and nothing else:
 *
 *   CORR2-A  an unresolved pending confirmation must outrank ordinary routing,
 *            so ordinary substantive text is preserved rather than routed and a
 *            queued remainder is never promoted while the gate is open;
 *   CORR2-B  the synthetic request handed to normal routing has one explicit,
 *            centralized bound, enforced without truncating user content;
 *   CORR2-C  a capture that does not fit alongside an already acknowledged
 *            remainder is rejected with a deterministic status instead of
 *            silently deleting the earlier text.
 *
 * These tests assert externally observable semantics only: whether a turn
 * reaches normal routing, what the effective user request is, and how the
 * resulting conversation state changes. They do not assume an implementation
 * shape.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CHAT_MESSAGE_LENGTH,
  type ChatSuccessResponse,
  type ConversationProfile,
} from "../../src/lib/chat-contract.ts";
import { POST } from "../../src/app/api/chat/route.ts";
import {
  prepareConversationTurn,
} from "../../src/lib/navigation/conversation-turn-control.ts";
import {
  ConversationStateValidationError,
  MAX_EFFECTIVE_ROUTE_REQUEST_LENGTH,
  appendDeferredRequest,
  applyOrchestratedTurn,
  composeEffectiveRouteRequest,
  createInitialConversationState,
  normalizeConversationStatePayload,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

const COMPLETE_PROFILE: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

const PRIOR_ANSWER =
  "Курс Маслоу описывает иерархию потребностей. Он не является медицинской классификацией.";

const PENDING_PROMPT =
  "Ранее мы обсуждали курс «Маслоу». Ты имеешь в виду его?";

/** Deterministic Cyrillic filler: no control language, no punctuation. */
function filler(length: number): string {
  return "мотивациякоманды".repeat(Math.ceil(length / 16)).slice(0, length);
}

const NEW_REMAINDER = "расскажи про мышление";
/** A control turn whose substantive tail is exactly NEW_REMAINDER. */
const NEW_REMAINDER_TURN = `повтори, а потом ${NEW_REMAINDER}`;

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

/** A state whose unresolved stale-course confirmation is still open (A18/A28). */
function pendingState(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return stateWith({
    staleReference: { previousCourseId: "maslow", previousFlowId: null },
    pendingConfirmation: {
      confirmationKey: "stale-course:maslow",
      kind: "STALE_COURSE_REFERENCE",
      prompt: PENDING_PROMPT,
      candidateCourseId: "maslow",
    },
    ...overrides,
  });
}

function turn(
  content: string,
  conversationState: ConversationState,
  profile: ConversationProfile = COMPLETE_PROFILE,
) {
  return prepareConversationTurn([{ role: "user", content }], profile, {
    conversationState,
    nowMs: T0,
  });
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

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// A. PENDING CONFIRMATION PRECEDENCE (CORR2-A)
// ---------------------------------------------------------------------------

test("P1: an open confirmation blocks routing and keeps both remainders", () => {
  const stored = "расскажи про мотивацию команды";
  const state = pendingState({ deferredRequest: stored });

  const result = turn("а ещё расскажи про мышление", state);

  // Nothing reaches normal routing while the confirmation is unresolved, and
  // the queued remainder is not promoted.
  assert.equal(result.state, "RESPOND");
  assert.equal(effectiveRequest(result), null);

  // The confirmation stays the outstanding gate.
  assert.notEqual(result.conversationState.pendingConfirmation, null);
  assert.equal(
    result.conversationState.pendingConfirmation?.prompt,
    PENDING_PROMPT,
  );

  // The stored remainder is untouched and the new text is queued behind it.
  assert.equal(
    result.conversationState.deferredRequest,
    `${stored}\nа ещё расскажи про мышление`,
  );

  // No business state moved.
  assert.equal(result.conversationState.selectedCourseId, null);
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");
});

test("P2: an open confirmation captures substantive text instead of routing it", () => {
  const result = turn("а ещё расскажи про мотивацию команды", pendingState());

  assert.equal(result.state, "RESPOND");
  assert.equal(effectiveRequest(result), null);
  assert.equal(
    result.conversationState.deferredRequest,
    "а ещё расскажи про мотивацию команды",
  );
  assert.notEqual(result.conversationState.pendingConfirmation, null);

  if (result.state !== "RESPOND") return;
  // The confirmation prompt is restated, and the capture is acknowledged.
  assert.ok(result.message.startsWith(PENDING_PROMPT));
  assert.match(result.message, /я сохранил/u);
});

test("P2: an open confirmation and a pure control stay control-shaped", () => {
  const result = turn("повтори", pendingState());

  assert.equal(result.state, "RESPOND");
  assert.equal(effectiveRequest(result), null);
  assert.equal(result.conversationState.deferredRequest, null);
  assert.notEqual(result.conversationState.pendingConfirmation, null);
});

test("P3: YES resolves the confirmation and leaves the stored remainder queued", () => {
  const stored = "расскажи про мотивацию команды";
  const result = turn("да", pendingState({ deferredRequest: stored }));

  assert.equal(result.state, "RESPOND");
  assert.equal(effectiveRequest(result), null);
  assert.equal(result.conversationState.pendingConfirmation, null);
  assert.equal(result.conversationState.selectedCourseId, "maslow");
  assert.equal(result.conversationState.deferredRequest, stored);
});

test("P4: NO resolves the confirmation and does not cancel the remainder", () => {
  const stored = "расскажи про мотивацию команды";
  const result = turn("нет", pendingState({ deferredRequest: stored }));

  assert.equal(result.state, "RESPOND");
  assert.equal(effectiveRequest(result), null);
  assert.equal(result.conversationState.pendingConfirmation, null);
  assert.equal(result.conversationState.selectedCourseId, null);
  assert.equal(result.conversationState.deferredRequest, stored);
});

test("P5: text preserved by the confirmation gate routes exactly once", () => {
  const captured = turn(
    "а ещё расскажи про мотивацию команды",
    pendingState(),
  );
  assert.equal(captured.state, "RESPOND");

  const resolved = turn("да", captured.conversationState);
  assert.equal(resolved.state, "RESPOND");
  assert.equal(resolved.conversationState.pendingConfirmation, null);
  assert.equal(
    resolved.conversationState.deferredRequest,
    "а ещё расскажи про мотивацию команды",
  );

  const routed = turn("и что дальше", resolved.conversationState);
  assert.equal(routed.state, "ROUTE");
  const request = effectiveRequest(routed) ?? "";
  assert.equal(occurrences(request, "мотивацию команды"), 1);
  assert.ok(request.startsWith("а ещё расскажи про мотивацию команды"));

  const after = afterSuccessfulRouting(routed.conversationState, "Ответ.");
  assert.equal(after.deferredRequest, null);

  const next = turn("а теперь другое", after);
  assert.doesNotMatch(effectiveRequest(next) ?? "", /мотивацию команды/u);
});

test("P6: close outranks an open confirmation and clears the context", () => {
  const result = turn(
    "пока",
    pendingState({ deferredRequest: "расскажи про мотивацию команды" }),
  );

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.lifecycle, "CLOSED");
  assert.equal(result.conversationState.pendingConfirmation, null);
  assert.equal(result.conversationState.deferredRequest, null);
  assert.equal(effectiveRequest(result), null);
});

test("P7: full restart outranks an open confirmation and replays nothing", () => {
  const result = turn(
    "давай сначала",
    pendingState({ deferredRequest: "расскажи про мотивацию команды" }),
  );

  assert.equal(result.state, "RESPOND");
  assert.equal(result.resetConversation, true);
  assert.equal(result.conversationState.pendingConfirmation, null);
  assert.equal(result.conversationState.deferredRequest, null);
  assert.equal(result.profile.displayName, null);
});

test("P8: cancel outranks an open confirmation and clears it without routing", () => {
  const result = turn(
    "отмени это",
    pendingState({ deferredRequest: "расскажи про мотивацию команды" }),
  );

  assert.equal(result.state, "RESPOND");
  assert.equal(effectiveRequest(result), null);
  assert.equal(result.conversationState.pendingConfirmation, null);
  assert.equal(result.conversationState.deferredRequest, null);
});

test("P9: an incomplete address setup cannot route past an open confirmation", () => {
  const partial: ConversationProfile = {
    displayName: null,
    addressMode: null,
    nameDeclined: false,
    pendingUserRequest: null,
  };

  // The message completes the address setup and carries a substantive request,
  // so the setup lane would otherwise hand that request straight to routing.
  const result = turn(
    "Иван, на ты. Хочу разобраться с мотивацией команды",
    pendingState(),
    partial,
  );

  assert.equal(result.state, "RESPOND");
  assert.equal(effectiveRequest(result), null);
  assert.notEqual(result.conversationState.pendingConfirmation, null);
  assert.equal(
    result.conversationState.deferredRequest,
    "Хочу разобраться с мотивацией команды",
  );
});

test("P10: a skip-shaped reply to an open confirmation is preserved, not decided", () => {
  const result = turn("не знаю", pendingState());

  assert.equal(result.state, "RESPOND");
  assert.equal(effectiveRequest(result), null);

  // "не знаю" is not a YES/NO answer, so the confirmation stays outstanding and
  // the reply is neither acted on as a skip decision nor discarded.
  assert.equal(result.conversationState.deferredRequest, "не знаю");
  assert.notEqual(result.conversationState.pendingConfirmation, null);
});

// ---------------------------------------------------------------------------
// B. EFFECTIVE ROUTE REQUEST BOUND (CORR2-B)
// ---------------------------------------------------------------------------

test("L1: an effective request one character below the bound is routed intact", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH);
  const request = filler(MAX_CHAT_MESSAGE_LENGTH - 1);
  const state = stateWith({ deferredRequest: stored });

  const result = turn(request, state);

  assert.equal(result.state, "ROUTE");
  const effective = effectiveRequest(result) ?? "";
  assert.equal(effective.length, 2 * MAX_CHAT_MESSAGE_LENGTH);
  assert.equal(effective, `${stored}\n${request}`);
});

test("L2: an effective request at the bound is routed intact", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH);
  const request = filler(MAX_CHAT_MESSAGE_LENGTH);
  const state = stateWith({ deferredRequest: stored });

  const result = turn(request, state);

  assert.equal(result.state, "ROUTE");
  const effective = effectiveRequest(result) ?? "";
  assert.equal(effective.length, 2 * MAX_CHAT_MESSAGE_LENGTH + 1);
  assert.equal(effective, `${stored}\n${request}`);
});

test("L3: a combination past the bound is neither routed nor truncated", () => {
  // One character past the storage cap, which the API boundary rejects (E5) and
  // the router bound must therefore only ever meet by failing closed.
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH + 1);
  const request = filler(MAX_CHAT_MESSAGE_LENGTH);
  const state: ConversationState = { ...stateWith(), deferredRequest: stored };

  assert.equal(
    `${stored}\n${request}`.length,
    MAX_EFFECTIVE_ROUTE_REQUEST_LENGTH + 1,
  );

  const result = turn(request, state);

  assert.equal(result.state, "RESPOND");
  assert.equal(effectiveRequest(result), null);
  // The stored remainder is untouched, byte for byte: no truncation, and no
  // silent replacement by the newer text.
  assert.equal(result.conversationState.deferredRequest, stored);

  if (result.state !== "RESPOND") return;
  // Nothing was routed, so no silently shortened request was produced, and the
  // new text is not reported as saved.
  assert.doesNotMatch(result.message, /я сохранил/u);
});

test("L4: the bound is exactly two maximum pieces plus one separator", () => {
  assert.equal(
    MAX_EFFECTIVE_ROUTE_REQUEST_LENGTH,
    2 * MAX_CHAT_MESSAGE_LENGTH + 1,
  );
});

test("L4: a legal maximum from both sides lands exactly on the bound", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH);
  const request = filler(MAX_CHAT_MESSAGE_LENGTH);

  const accepted = composeEffectiveRouteRequest(stored, request);

  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(
    accepted.status === "ACCEPTED" ? accepted.request.length : 0,
    MAX_EFFECTIVE_ROUTE_REQUEST_LENGTH,
  );

  // One character more is reported, not shortened: the rejected outcome
  // carries no request at all, so no truncated text can escape.
  const rejected = composeEffectiveRouteRequest(
    filler(MAX_CHAT_MESSAGE_LENGTH + 1),
    request,
  );

  assert.equal(rejected.status, "REJECTED_CAPACITY");
  assert.equal("request" in rejected, false);
});

test("L4: an over-long message cannot inject a third piece past the bound", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH);
  const state = stateWith({ deferredRequest: stored });

  // The scanner bounds a substantive remainder to the public message length, so
  // the promoted request is bounded by the two legal pieces alone.
  const result = turn(filler(4 * MAX_CHAT_MESSAGE_LENGTH), state);

  assert.equal(result.state, "ROUTE");
  const effective = effectiveRequest(result) ?? "";
  assert.ok(effective.length <= MAX_EFFECTIVE_ROUTE_REQUEST_LENGTH);
  assert.ok(effective.startsWith(stored));
});

test("L4: a profile-completion request cannot add a third piece past the bound", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH);
  const pendingRequest = filler(MAX_CHAT_MESSAGE_LENGTH);
  const partial: ConversationProfile = {
    displayName: null,
    addressMode: null,
    nameDeclined: false,
    pendingUserRequest: pendingRequest,
  };

  const result = turn(
    "Иван, на ты",
    stateWith({ deferredRequest: stored }),
    partial,
  );

  assert.equal(result.state, "ROUTE");
  const effective = effectiveRequest(result) ?? "";
  assert.equal(effective, `${stored}\n${pendingRequest}`);
  assert.equal(effective.length, 2 * MAX_CHAT_MESSAGE_LENGTH + 1);
});

test("L5: a short remainder and a short request are unchanged", () => {
  const stored = "расскажи про мотивацию команды";
  const result = turn("и ещё про мышление", stateWith({ deferredRequest: stored }));

  assert.equal(result.state, "ROUTE");
  assert.equal(
    effectiveRequest(result),
    `${stored}\nи ещё про мышление`,
  );
});

// ---------------------------------------------------------------------------
// C. DEFERRED OVERFLOW WITHOUT SILENT LOSS (CORR2-C)
// ---------------------------------------------------------------------------

test("O1: a capture that fits keeps both remainders in arrival order", () => {
  const stored = "расскажи про мотивацию команды";
  const result = turn(NEW_REMAINDER_TURN, stateWith({ deferredRequest: stored }));

  assert.equal(result.state, "RESPOND");
  assert.equal(
    result.conversationState.deferredRequest,
    `${stored}\n${NEW_REMAINDER}`,
  );

  if (result.state !== "RESPOND") return;
  assert.match(result.message, /я сохранил/u);
});

test("O2/O3: an overflow keeps the stored remainder and never claims the new one was saved", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH);
  const result = turn(NEW_REMAINDER_TURN, stateWith({ deferredRequest: stored }));

  assert.equal(result.state, "RESPOND");

  // The earlier, already acknowledged remainder survives byte for byte.
  assert.equal(result.conversationState.deferredRequest, stored);

  if (result.state !== "RESPOND") return;
  // The new remainder is not reported as saved, and no internal limit leaks.
  assert.doesNotMatch(result.message, /я сохранил/u);
  assert.doesNotMatch(result.message, new RegExp(NEW_REMAINDER, "u"));
  assert.doesNotMatch(result.message, /\d/u);
});

test("O4: an overflowing capture is never routed implicitly", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH);
  const result = turn(NEW_REMAINDER_TURN, stateWith({ deferredRequest: stored }));

  assert.equal(result.state, "RESPOND");
  assert.equal(effectiveRequest(result), null);
});

test("O5: the stored remainder is consumed once and never replayed", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH);
  const captured = turn(NEW_REMAINDER_TURN, stateWith({ deferredRequest: stored }));
  assert.equal(captured.conversationState.deferredRequest, stored);

  const promoted = turn("и что дальше", captured.conversationState);
  assert.equal(promoted.state, "ROUTE");
  assert.ok((effectiveRequest(promoted) ?? "").startsWith(stored));

  const after = afterSuccessfulRouting(promoted.conversationState, "Ответ.");
  assert.equal(after.deferredRequest, null);

  const next = turn("а теперь другое", after);
  assert.equal(next.state, "ROUTE");
  assert.ok(!(effectiveRequest(next) ?? "").includes(stored));
});

test("O6: a rejected remainder still routes when the user sends it again", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH);
  const rejected = turn(NEW_REMAINDER_TURN, stateWith({ deferredRequest: stored }));
  assert.equal(rejected.conversationState.deferredRequest, stored);

  const resent = turn(NEW_REMAINDER, rejected.conversationState);

  assert.equal(resent.state, "ROUTE");
  const request = effectiveRequest(resent) ?? "";
  assert.ok(request.startsWith(stored));
  assert.ok(request.endsWith(NEW_REMAINDER));
  assert.equal(occurrences(request, NEW_REMAINDER), 1);
});

test("O7: an exact fit is accepted without a false rejection", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH - 1 - NEW_REMAINDER.length);
  assert.equal(`${stored}\n${NEW_REMAINDER}`.length, MAX_CHAT_MESSAGE_LENGTH);

  const result = turn(NEW_REMAINDER_TURN, stateWith({ deferredRequest: stored }));

  assert.equal(result.state, "RESPOND");
  assert.equal(
    result.conversationState.deferredRequest,
    `${stored}\n${NEW_REMAINDER}`,
  );

  if (result.state !== "RESPOND") return;
  assert.match(result.message, /я сохранил/u);
});

test("O8: one character over is rejected deterministically without truncation", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH - NEW_REMAINDER.length);
  assert.equal(
    `${stored}\n${NEW_REMAINDER}`.length,
    MAX_CHAT_MESSAGE_LENGTH + 1,
  );

  const result = turn(NEW_REMAINDER_TURN, stateWith({ deferredRequest: stored }));

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.deferredRequest, stored);

  if (result.state !== "RESPOND") return;
  assert.doesNotMatch(result.message, /я сохранил/u);
});

test("O9: the capture outcome is structured at the exact fit and one over", () => {
  const base = stateWith();
  const exact = filler(MAX_CHAT_MESSAGE_LENGTH - 1 - NEW_REMAINDER.length);

  const accepted = appendDeferredRequest(
    { ...base, deferredRequest: exact },
    NEW_REMAINDER,
  );

  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(
    accepted.state.deferredRequest,
    `${exact}\n${NEW_REMAINDER}`,
  );

  const over = filler(MAX_CHAT_MESSAGE_LENGTH - NEW_REMAINDER.length);
  const rejected = appendDeferredRequest(
    { ...base, deferredRequest: over },
    NEW_REMAINDER,
  );

  assert.equal(rejected.status, "REJECTED_CAPACITY");
  assert.equal(rejected.state.deferredRequest, over);
});

test("O10: a standalone capture that cannot be stored is reported, not stored", () => {
  const over = filler(MAX_CHAT_MESSAGE_LENGTH + 1);
  const outcome = appendDeferredRequest(stateWith(), over);

  assert.equal(outcome.status, "REJECTED_CAPACITY");
  assert.equal(outcome.state.deferredRequest, null);
});

// ---------------------------------------------------------------------------
// D. CROSS-INVARIANT SEQUENCE
// ---------------------------------------------------------------------------
test("X1: confirmation + stored remainder + new text route exactly once", () => {
  const stored = "расскажи про мотивацию команды";
  const added = "а ещё расскажи про мышление";

  // 1-3: a stored remainder, an open confirmation, and new substantive text.
  const captured = turn(added, pendingState({ deferredRequest: stored }));

  // 4-5: nothing routes, the confirmation is re-asked, both texts are kept.
  assert.equal(captured.state, "RESPOND");
  assert.equal(effectiveRequest(captured), null);
  assert.equal(captured.conversationState.deferredRequest, `${stored}\n${added}`);
  assert.notEqual(captured.conversationState.pendingConfirmation, null);

  // 6-7: the confirmation resolves and still nothing routes.
  const resolved = turn("да", captured.conversationState);
  assert.equal(resolved.state, "RESPOND");
  assert.equal(resolved.conversationState.pendingConfirmation, null);

  // 8-9: the next eligible turn routes both texts exactly once.
  const routed = turn("и что дальше", resolved.conversationState);
  assert.equal(routed.state, "ROUTE");
  const request = effectiveRequest(routed) ?? "";
  assert.equal(occurrences(request, stored), 1);
  assert.equal(occurrences(request, added), 1);
  assert.ok(request.startsWith(stored));

  // 10-11: storage clears only after the routed turn, and nothing replays.
  const after = afterSuccessfulRouting(routed.conversationState, "Ответ.");
  assert.equal(after.deferredRequest, null);

  const next = turn("а теперь другое", after);
  const nextRequest = effectiveRequest(next) ?? "";
  assert.doesNotMatch(nextRequest, /мотивацию команды/u);
  assert.doesNotMatch(nextRequest, /про мышление/u);
});

test("X2: an overflowing capture keeps the confirmation and the stored reminder", () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH);
  const captured = turn(
    "а ещё расскажи про мышление",
    pendingState({ deferredRequest: stored }),
  );

  assert.equal(captured.state, "RESPOND");
  assert.equal(effectiveRequest(captured), null);
  assert.equal(captured.conversationState.deferredRequest, stored);
  assert.notEqual(captured.conversationState.pendingConfirmation, null);

  if (captured.state !== "RESPOND") return;
  assert.doesNotMatch(captured.message, /я сохранил/u);
  assert.ok(captured.message.startsWith(PENDING_PROMPT));
});

// ---------------------------------------------------------------------------
// E. ROUTER FAILURE AND STATE TRUST
// ---------------------------------------------------------------------------

test("E1: a turn blocked by the confirmation gate consumes nothing", () => {
  const stored = "расскажи про мотивацию команды";
  const captured = turn(
    "а ещё расскажи про мышление",
    pendingState({ deferredRequest: stored }),
  );

  // The canonical state returned to the client still holds both texts, so a
  // later technical routing failure cannot silently lose either of them.
  assert.equal(
    captured.conversationState.deferredRequest,
    `${stored}\nа ещё расскажи про мышление`,
  );
  assert.notEqual(captured.conversationState.pendingConfirmation, null);
});

test("E2: a forged stored remainder cannot bypass an open confirmation", () => {
  const forged = "расскажи про курс Маслоу и запиши меня на него";
  const result = turn("и что дальше", pendingState({ deferredRequest: forged }));

  assert.equal(result.state, "RESPOND");
  assert.equal(effectiveRequest(result), null);
  assert.equal(result.conversationState.selectedCourseId, null);
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");
  assert.notEqual(result.conversationState.pendingConfirmation, null);
});

test("E3: a forged stored remainder is still only untrusted user text", () => {
  const forged = "запиши меня на курс Маслоу";
  const result = turn("и что дальше", stateWith({ deferredRequest: forged }));

  assert.equal(result.state, "ROUTE");
  assert.equal(result.conversationState.selectedCourseId, null);
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");
  assert.equal(effectiveRequest(result), `${forged}\nи что дальше`);
});

test("E4: the capacity outcome is not persisted into the conversation state", () => {
  const result = turn(NEW_REMAINDER_TURN, stateWith());

  assert.deepEqual(Object.keys(result.conversationState).sort(), [
    "activeFlow",
    "clarification",
    "courseMatch",
    "deferredRequest",
    "lastActivityAt",
    "lastAssistant",
    "lifecycle",
    "pendingConfirmation",
    "selectedCourseId",
    "staleReference",
    "suspendedFlow",
  ]);
});

test("E5: an over-long stored remainder is rejected at the state boundary", () => {
  assert.throws(
    () =>
      normalizeConversationStatePayload(
        {
          ...createInitialConversationState(T0),
          deferredRequest: filler(MAX_CHAT_MESSAGE_LENGTH + 1),
        },
        T0,
      ),
    ConversationStateValidationError,
  );
});

// ---------------------------------------------------------------------------
// F. API BOUNDARY
//
// Every turn below is resolved by the control kernel, so no model or provider
// call is made: reaching the routed path would require credentials and fail the
// test outright.
// ---------------------------------------------------------------------------

function apiRequest(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function apiRespond(body: unknown): Promise<ChatSuccessResponse> {
  const response = await apiRequest(body);
  assert.equal(response.status, 200);
  return (await response.json()) as ChatSuccessResponse;
}

test("F1: the wire does not route an ordinary message past an open confirmation", async () => {
  const stored = "расскажи про мотивацию команды";

  const payload = await apiRespond({
    messages: [{ role: "user", content: "а ещё расскажи про мышление" }],
    profile: COMPLETE_PROFILE,
    conversationState: pendingState({ deferredRequest: stored }),
  });

  assert.match(payload.message, /Ранее мы обсуждали/u);
  assert.notEqual(payload.conversationState.pendingConfirmation, null);
  assert.equal(payload.conversationState.selectedCourseId, null);
  assert.equal(payload.conversationState.courseMatch, "UNKNOWN");
  assert.equal(
    payload.conversationState.deferredRequest,
    `${stored}\nа ещё расскажи про мышление`,
  );
  assert.equal(payload.contactCard, null);
});

test("F2: an over-long stored remainder is refused at the wire", async () => {
  const response = await apiRequest({
    messages: [{ role: "user", content: "и что дальше" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      deferredRequest: filler(MAX_CHAT_MESSAGE_LENGTH + 1),
    },
  });

  assert.equal(response.status, 400);

  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_REQUEST");
});

test("F3: an overflow at the wire keeps the stored remainder and a valid state", async () => {
  const stored = filler(MAX_CHAT_MESSAGE_LENGTH);

  const payload = await apiRespond({
    messages: [{ role: "user", content: NEW_REMAINDER_TURN }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      lastAssistant: {
        act: "NAVIGATE",
        content: PRIOR_ANSWER,
        courseId: null,
      },
      deferredRequest: stored,
    },
  });

  assert.equal(payload.conversationState.deferredRequest, stored);
  assert.doesNotMatch(payload.message, /я сохранил/u);

  // The canonical state the client keeps is still acceptable to the boundary.
  const again = await apiRespond({
    messages: [{ role: "user", content: "повтори" }],
    profile: COMPLETE_PROFILE,
    conversationState: payload.conversationState,
  });

  assert.equal(again.conversationState.deferredRequest, stored);
});
