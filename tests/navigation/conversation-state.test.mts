import assert from "node:assert/strict";
import test from "node:test";

import {
  CLARIFICATION_BUDGET,
  ConversationStateValidationError,
  applySessionFreshness,
  createInitialConversationState,
  normalizeConversationStatePayload,
  toSessionTimestamp,
  SESSION_CONTEXT_TTL_MS,
} from "../../src/lib/navigation/conversation-state.ts";

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
