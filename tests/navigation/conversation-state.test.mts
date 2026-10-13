import assert from "node:assert/strict";
import test from "node:test";

import {
  CLARIFICATION_BUDGET,
  ConversationStateValidationError,
  applyOrchestratedTurn,
  applySessionFreshness,
  createInitialConversationState,
  normalizeConversationStatePayload,
  toSessionTimestamp,
  withClarification,
  withCourseBinding,
  withCourseReferents,
  SESSION_CONTEXT_TTL_MS,
} from "../../src/lib/navigation/conversation-state.ts";
import { paymentMultipleIssueKey } from "../../src/lib/academy/payment-policy.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

function rawState(nowMs: number = T0): Record<string, unknown> {
  return {
    lifecycle: "OPEN",
    activeFlow: null,
    suspendedFlow: null,
    courseMatch: "UNKNOWN",
    selectedCourseId: null,
    clarification: null,
    pendingConfirmation: null,
    deferredRequest: null,
    lastAssistant: null,
    lastActivityAt: toSessionTimestamp(nowMs),
    staleReference: null,
  };
}

function rejects(value: unknown): void {
  assert.throws(
    () => normalizeConversationStatePayload(value, T0),
    ConversationStateValidationError,
  );
}

test("A09: an absent payload normalizes to a fresh OPEN state", () => {
  const state = normalizeConversationStatePayload(undefined, T0);

  assert.deepEqual(state, createInitialConversationState(T0));
  assert.equal(state.lifecycle, "OPEN");
  assert.equal(state.courseMatch, "UNKNOWN");
  assert.equal(state.selectedCourseId, null);
});

test("A09: a well-formed payload round-trips unchanged", () => {
  const state = normalizeConversationStatePayload(rawState(), T0);
  assert.deepEqual(state, createInitialConversationState(T0));
});

test("A09: unknown keys are rejected", () => {
  rejects({ ...rawState(), unexpected: 1 });
  rejects({ ...rawState(), messages: [] });
});

test("A09: invalid enum values are rejected", () => {
  rejects({ ...rawState(), lifecycle: "PAUSED" });
  rejects({ ...rawState(), courseMatch: "MAYBE" });
  rejects({
    ...rawState(),
    activeFlow: { id: "MADE_UP_FLOW", pendingQuestion: null },
  });
});

test("A09: impossible state combinations are rejected", () => {
  rejects({
    ...rawState(),
    lifecycle: "CLOSED",
    activeFlow: { id: "COURSE_SELECTION", pendingQuestion: null },
  });

  rejects({ ...rawState(), courseMatch: "MATCHED", selectedCourseId: null });

  rejects({
    ...rawState(),
    courseMatch: "UNKNOWN",
    selectedCourseId: "maslow",
  });

  rejects({
    ...rawState(),
    activeFlow: { id: "COURSE_SELECTION", pendingQuestion: null },
    suspendedFlow: { id: "COURSE_SELECTION", pendingQuestion: null },
  });
});

test("A09: malformed timestamps are rejected", () => {
  rejects({ ...rawState(), lastActivityAt: "2026-09-19" });
  rejects({ ...rawState(), lastActivityAt: "not-a-timestamp" });
  rejects({ ...rawState(), lastActivityAt: 1_790_000_000_000 });

  // A timestamp far beyond the TTL is not a plausible client value.
  rejects({
    ...rawState(),
    lastActivityAt: toSessionTimestamp(T0 + SESSION_CONTEXT_TTL_MS * 2),
  });
});

test("A09: a non-routable course identifier is rejected where one is required", () => {
  rejects({
    ...rawState(),
    courseMatch: "MATCHED",
    selectedCourseId: "not-a-course",
  });

  rejects({
    ...rawState(),
    courseMatch: "MATCHED",
    selectedCourseId: "professional-development-stages",
  });

  const accepted = normalizeConversationStatePayload(
    { ...rawState(), courseMatch: "MATCHED", selectedCourseId: "maslow" },
    T0,
  );
  assert.equal(accepted.selectedCourseId, "maslow");
});

test("A09: oversized free-form strings are rejected", () => {
  rejects({ ...rawState(), deferredRequest: "я".repeat(4_001) });
  rejects({
    ...rawState(),
    lastAssistant: {
      act: "NAVIGATE",
      content: "я".repeat(4_001),
      courseId: null,
    },
  });
});

test("A09: the clarification counter cannot exceed the configured budget", () => {
  rejects({
    ...rawState(),
    clarification: {
      issueKey: "ask-more:generic",
      attempts: CLARIFICATION_BUDGET + 1,
      strategyKey: null,
    },
  });

  const accepted = normalizeConversationStatePayload(
    {
      ...rawState(),
      clarification: {
        issueKey: "ask-more:generic",
        attempts: CLARIFICATION_BUDGET,
        strategyKey: null,
      },
    },
    T0,
  );
  assert.equal(accepted.clarification?.attempts, CLARIFICATION_BUDGET);
});

test("A28: activity within the 24h window is not stale", () => {
  const state = createInitialConversationState(T0);
  const justInside = applySessionFreshness(
    state,
    T0 + SESSION_CONTEXT_TTL_MS - 1,
  );

  assert.equal(justInside.expired, false);
  assert.deepEqual(justInside.state, state);
});

test("A28: the 24h boundary expires working navigation context", () => {
  const active = normalizeConversationStatePayload(
    {
      ...rawState(),
      activeFlow: { id: "COURSE_SELECTION", pendingQuestion: "team-or-self" },
      courseMatch: "MATCHED",
      selectedCourseId: "maslow",
      clarification: {
        issueKey: "ask-more:maslow",
        attempts: 1,
        strategyKey: "ask-more-1",
      },
      lastAssistant: {
        act: "NAVIGATE",
        content: "Ранее рекомендованный ответ.",
        courseId: "maslow",
      },
    },
    T0,
  );

  const expired = applySessionFreshness(
    active,
    T0 + SESSION_CONTEXT_TTL_MS,
  );

  assert.equal(expired.expired, true);
  assert.equal(expired.state.activeFlow, null);
  assert.equal(expired.state.suspendedFlow, null);
  assert.equal(expired.state.courseMatch, "UNKNOWN");
  assert.equal(expired.state.selectedCourseId, null);
  assert.equal(expired.state.clarification, null);
  assert.equal(expired.state.pendingConfirmation, null);
  assert.equal(expired.state.lastAssistant, null);
  assert.equal(expired.state.deferredRequest, null);

  // The expired referent survives only as a bounded confirmation candidate.
  assert.deepEqual(expired.state.staleReference, {
    previousCourseId: "maslow",
    previousFlowId: "COURSE_SELECTION",
  });
});

test("A28: expiry with nothing to remember still marks the session stale", () => {
  const expired = applySessionFreshness(
    createInitialConversationState(T0),
    T0 + SESSION_CONTEXT_TTL_MS,
  );

  assert.equal(expired.expired, true);
  // The marker carries no referent, but it records that the boundary was
  // crossed so a referential phrase can still be recognised as stale.
  assert.deepEqual(expired.state.staleReference, {
    previousCourseId: null,
    previousFlowId: null,
  });
});

test("A28: a stale candidate is metadata, never an active binding", () => {
  const active = normalizeConversationStatePayload(
    { ...rawState(), courseMatch: "MATCHED", selectedCourseId: "maslow" },
    T0,
  );

  const later = applySessionFreshness(
    active,
    T0 + SESSION_CONTEXT_TTL_MS + 60_000,
  );

  assert.equal(later.state.courseMatch, "UNKNOWN");
  assert.equal(later.state.selectedCourseId, null);
  assert.equal(later.state.staleReference?.previousCourseId, "maslow");

  // Feeding the expired state straight back in is valid and stays inactive.
  const roundTripped = normalizeConversationStatePayload(
    later.state,
    T0 + SESSION_CONTEXT_TTL_MS + 60_000,
  );
  assert.equal(roundTripped.courseMatch, "UNKNOWN");
  assert.equal(roundTripped.selectedCourseId, null);
});

/* ---------------------------------------------------------------------------
 * NAVIGATOR-ACT-ROUTER-ALIAS-CORRECTION-1 P4-B — INVALIDATE_SELECTION.
 * ------------------------------------------------------------------------ */

const UNCERTAINTY_OUTCOME = {
  act: "NAVIGATE",
  flowId: "COURSE_SELECTION",
  message: "Не могу надёжно определить, что речь идёт о курсе Академии.",
  decision: { kind: "INVALIDATE_SELECTION" },
  clarification: { status: "NOT_APPLICABLE", issueKey: null, attempts: 0, question: null },
  catalogAuthorityVersion: null,
  transactionalAuthorityVersion: null,
  pendingConfirmation: null,
} as const;

test("P4-B: an uncertainty turn invalidates a stored MATCHED selection and lastAssistant reflects it", () => {
  const matched = withCourseBinding(createInitialConversationState(T0), "MATCHED", "levels-of-consciousness");
  const next = applyOrchestratedTurn(matched, UNCERTAINTY_OUTCOME, T0 + 1_000);

  assert.equal(next.courseMatch, "UNKNOWN");
  assert.equal(next.selectedCourseId, null);
  assert.equal(next.lastAssistant?.act, "NAVIGATE");
  assert.equal(next.lastAssistant?.courseId, null);
  assert.equal(next.activeFlow?.id, "COURSE_SELECTION");
  // The result is a valid canonical wire state.
  assert.deepEqual(normalizeConversationStatePayload(JSON.parse(JSON.stringify(next)), T0 + 1_000), next);
});

test("P4-B: P03 candidates, the payment clarification record and other bindings are preserved", () => {
  const issueKey = paymentMultipleIssueKey(["levels-of-consciousness", "maslow"]);
  let ambiguous = withCourseBinding(createInitialConversationState(T0), "AMBIGUOUS", null);
  ambiguous = withCourseReferents(ambiguous, ["levels-of-consciousness", "maslow"]);
  ambiguous = withClarification(ambiguous, { issueKey, attempts: 2, strategyKey: "ask-more-2" });
  const next = applyOrchestratedTurn(ambiguous, UNCERTAINTY_OUTCOME, T0 + 1_000);

  assert.equal(next.courseMatch, "AMBIGUOUS");
  assert.deepEqual(next.courseReferents, ["levels-of-consciousness", "maslow"]);
  assert.deepEqual(next.clarification, { issueKey, attempts: 2, strategyKey: "ask-more-2" });
  assert.deepEqual(normalizeConversationStatePayload(JSON.parse(JSON.stringify(next)), T0 + 1_000), next);

  const noMatch = withCourseBinding(createInitialConversationState(T0), "NO_CURRENT_COURSE_MATCH", null);
  assert.equal(applyOrchestratedTurn(noMatch, UNCERTAINTY_OUTCOME, T0 + 1_000).courseMatch, "NO_CURRENT_COURSE_MATCH");

  const unknown = createInitialConversationState(T0);
  const after = applyOrchestratedTurn(unknown, UNCERTAINTY_OUTCOME, T0 + 1_000);
  assert.equal(after.courseMatch, "UNKNOWN");
  assert.equal(after.selectedCourseId, null);
});

test("P4-B: invalidation does not reset an open clarification record (unlike a resolved decision)", () => {
  const record = { issueKey: "ask-more:maslow+normative-situation", attempts: 1, strategyKey: "ask-more-1" };
  const matched = withClarification(
    withCourseBinding(createInitialConversationState(T0), "MATCHED", "maslow"),
    record,
  );
  assert.deepEqual(applyOrchestratedTurn(matched, UNCERTAINTY_OUTCOME, T0 + 1_000).clarification, record);
  // Control: an ordinary resolved decision still resets it.
  const resolved = applyOrchestratedTurn(
    matched,
    { ...UNCERTAINTY_OUTCOME, decision: { kind: "NO_MATCH" } },
    T0 + 1_000,
  );
  assert.equal(resolved.clarification, null);
});
