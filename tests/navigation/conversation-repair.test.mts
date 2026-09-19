/**
 * Package-B A05 conversational repair (B-R1..B-R6).
 *
 * Repair operates on the structured prior-assistant record
 * (`conversationState.lastAssistant`), never on a semantic re-reading of
 * assistant prose, and it never reaches the conversation-act router. Every
 * asserted turn below is resolved by the deterministic control kernel, so
 * reaching the routed path would require provider credentials and fail here.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationProfile } from "../../src/lib/chat-contract.ts";
import {
  prepareConversationTurn,
} from "../../src/lib/navigation/conversation-turn-control.ts";
import {
  REPAIR_FAILURE_THRESHOLD,
  applyOrchestratedTurn,
  createInitialConversationState,
  type ConversationState,
  type LastAssistantAction,
} from "../../src/lib/navigation/conversation-state.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

const COMPLETE_PROFILE: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

const PRIOR_ANSWER: LastAssistantAction = {
  act: "NAVIGATE",
  content:
    "По подтверждённым данным я не могу уверенно отнести запрос к одному текущему курсу.",
  courseId: null,
};

const PRIOR_COURSE_ANSWER: LastAssistantAction = {
  act: "COURSE_FOLLOW_UP",
  content:
    "Курс помогает анализировать мотивацию в контексте управленческих задач.",
  courseId: "maslow",
};

function stateWith(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return { ...createInitialConversationState(T0), ...overrides };
}

function turn(
  content: string,
  conversationState: ConversationState = createInitialConversationState(T0),
  profile: ConversationProfile = COMPLETE_PROFILE,
) {
  return prepareConversationTurn([{ role: "user", content }], profile, {
    conversationState,
    nowMs: T0,
  });
}

test("B-R1: 'ответь нормально' repairs the recorded answer and never routes", () => {
  const before = stateWith({ lastAssistant: PRIOR_ANSWER });
  const result = turn("ответь нормально", before);

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.act, "REPAIR_RESTATE");
  // The recorded prior public content is the substance of the repair.
  assert.ok(result.message.includes(PRIOR_ANSWER.content));
  // Business authority is untouched by a repair.
  assert.equal(result.conversationState.selectedCourseId, before.selectedCourseId);
  assert.equal(result.conversationState.courseMatch, before.courseMatch);
  assert.deepEqual(
    result.conversationState.pendingConfirmation,
    before.pendingConfirmation,
  );
  assert.equal(result.conversationState.repair?.attempts, 1);
});

test("B-R1b: 'ответь по-человечески' is the same repair class", () => {
  const result = turn(
    "ответь по-человечески",
    stateWith({ lastAssistant: PRIOR_ANSWER }),
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;
  assert.equal(result.act, "REPAIR_RESTATE");
});

test("B-R1c: a substantive sentence containing the same words keeps routing", () => {
  // "нормально" inside ordinary prose is not a repair signal: recognition is
  // clause-head anchored exactly like the Package-A control phrases.
  const result = turn(
    "Расскажи нормально про курс Маслоу",
    stateWith({ lastAssistant: PRIOR_ANSWER }),
  );

  assert.equal(result.state, "ROUTE");
});

test("B-R2: 'что ты имел в виду?' clarifies the recorded prior statement", () => {
  const before = stateWith({
    lastAssistant: PRIOR_COURSE_ANSWER,
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
    activeFlow: { id: "COURSE_FOLLOW_UP", pendingQuestion: null },
  });
  const result = turn("что ты имел в виду?", before);

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.act, "REPAIR_CLARIFY");
  // The prior action/content identity is the source of the clarification.
  assert.ok(result.message.includes(PRIOR_COURSE_ANSWER.content));
  // Selected course and flow survive a repair untouched.
  assert.equal(result.conversationState.selectedCourseId, "maslow");
  assert.equal(result.conversationState.courseMatch, "MATCHED");
  assert.equal(result.conversationState.activeFlow?.id, "COURSE_FOLLOW_UP");
});

test("B-R3: 'ты сам сказал, что...' is a challenge against the record, not a new route", () => {
  const before = stateWith({ lastAssistant: PRIOR_ANSWER });
  const result = turn(
    "ты сам сказал, что курс Маслоу про мотивацию. Почему теперь говоришь иначе?",
    before,
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.act, "REPAIR_CHALLENGE");
  // No out-of-scope fallback and no new recommendation.
  assert.equal(result.conversationState.selectedCourseId, before.selectedCourseId);
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");
  assert.ok(result.message.includes(PRIOR_ANSWER.content));
});

test("B-R3b: 'это противоречит твоему прошлому ответу' is the same challenge class", () => {
  const result = turn(
    "это противоречит твоему прошлому ответу",
    stateWith({ lastAssistant: PRIOR_ANSWER }),
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;
  assert.equal(result.act, "REPAIR_CHALLENGE");
});

test("B-R4: repair with no usable prior answer stays honest and offers help", () => {
  const result = turn("ответь нормально", stateWith());

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.act, "REPAIR_UNAVAILABLE");
  assert.equal(result.conversationState.handoff.status, "OFFERED");
  assert.equal(
    result.conversationState.handoff.reason,
    "REPAIR_CONTEXT_UNAVAILABLE",
  );
  // Nothing was fabricated: no prior answer is restated because none is
  // recorded, and no handoff summary claims established context.
  assert.equal(result.conversationState.handoff.context, null);
});

test("B-R5: a completed turn re-keys the repair issue and resets the attempts", () => {
  const first = turn("ответь нормально", stateWith({ lastAssistant: PRIOR_ANSWER }));
  assert.equal(first.state, "RESPOND");
  if (first.state !== "RESPOND") return;
  assert.equal(first.conversationState.repair?.attempts, 1);

  // The user moves on and the next turn completes normally.
  const resolved = applyOrchestratedTurn(
    first.conversationState,
    {
      act: "NAVIGATE",
      flowId: "COURSE_SELECTION",
      message: "Вот курс.",
      decision: { kind: "MATCHED", courseId: "maslow" },
      clarification: {
        status: "NOT_APPLICABLE",
        issueKey: null,
        attempts: 0,
        question: null,
      },
    },
    T0,
  );

  assert.equal(resolved.repair, null);

  const again = turn("ответь нормально", resolved);
  assert.equal(again.state, "RESPOND");
  if (again.state !== "RESPOND") return;
  assert.equal(again.conversationState.repair?.attempts, 1);
});

test("B-R5b: a materially new repair subject starts a new repair issue", () => {
  const sameSubject = stateWith({
    lastAssistant: PRIOR_ANSWER,
    repair: { issueKey: "repair:general", attempts: 1 },
  });
  const advanced = turn("ответь нормально", sameSubject);

  assert.equal(advanced.state, "RESPOND");
  if (advanced.state !== "RESPOND") return;
  // Same subject, so the counter advances rather than restarting.
  assert.equal(advanced.conversationState.repair?.attempts, 2);

  const otherSubject = stateWith({
    lastAssistant: PRIOR_COURSE_ANSWER,
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
    repair: { issueKey: "repair:general", attempts: 1 },
  });
  const rekeyed = turn("ответь нормально", otherSubject);

  assert.equal(rekeyed.state, "RESPOND");
  if (rekeyed.state !== "RESPOND") return;
  assert.equal(rekeyed.conversationState.repair?.issueKey, "repair:course:maslow");
  assert.equal(rekeyed.conversationState.repair?.attempts, 1);
});

test("B-R7: every required A05 signal class is recognised", () => {
  const required: readonly (readonly [string, string])[] = [
    ["ответь нормально", "REPAIR_RESTATE"],
    ["ответь по-человечески", "REPAIR_RESTATE"],
    ["что ты имел в виду?", "REPAIR_CLARIFY"],
    ["что это значит?", "REPAIR_CLARIFY"],
    ["ты сам сказал, что курс Маслоу про мотивацию", "REPAIR_CHALLENGE"],
    ["но ты только что сказал, что курс подходит", "REPAIR_CHALLENGE"],
    ["это противоречит твоему прошлому ответу", "REPAIR_CHALLENGE"],
  ];

  for (const [text, act] of required) {
    const result = turn(text, stateWith({ lastAssistant: PRIOR_COURSE_ANSWER }));
    assert.equal(result.state, "RESPOND", text);
    if (result.state !== "RESPOND") return;
    assert.equal(result.act, act, text);
  }
});

test("B-R8: every required frustration class offers handoff, never a repair", () => {
  const required = [
    "это не помогает",
    "ты опять не ответил",
    "я уже второй раз прошу",
    "ты вообще меня не понимаешь",
    "не помогло",
    "Не помогло.",
    "это бесполезно",
  ];

  for (const text of required) {
    const before = stateWith({ lastAssistant: PRIOR_ANSWER });
    const result = turn(text, before);

    assert.equal(result.state, "RESPOND", text);
    if (result.state !== "RESPOND") return;
    assert.equal(result.act, "HANDOFF_OFFERED", text);
    assert.equal(result.conversationState.handoff.reason, "FRUSTRATION", text);
    assert.equal(
      result.conversationState.qualitySignals.length,
      1,
      `${text} must record one quality signal`,
    );
  }
});

test("B-R9: signals are clause-head anchored, so ordinary prose is not hijacked", () => {
  const ordinary = [
    "Расскажи нормально про курс Маслоу",
    "не помогает мне выбрать курс, подбери другой",
    "что значит нормативная ситуация?",
    "Мне нужен курс про работу с человеком",
  ];

  for (const text of ordinary) {
    const result = turn(text, stateWith({ lastAssistant: PRIOR_ANSWER }));
    assert.equal(result.state, "ROUTE", text);
  }
});

test("B-R6: the second repair signal for one issue reaches the handoff threshold", () => {
  const first = turn("ответь нормально", stateWith({ lastAssistant: PRIOR_ANSWER }));
  assert.equal(first.state, "RESPOND");
  if (first.state !== "RESPOND") return;

  const second = turn("ответь нормально", first.conversationState);

  assert.equal(second.state, "RESPOND");
  if (second.state !== "RESPOND") return;

  assert.equal(second.act, "HANDOFF_OFFERED");
  assert.equal(second.conversationState.handoff.status, "OFFERED");
  assert.equal(
    second.conversationState.handoff.reason,
    "REPEATED_REPAIR_FAILURE",
  );
  assert.equal(
    second.conversationState.repair?.attempts,
    REPAIR_FAILURE_THRESHOLD,
  );
  // The threshold is one central constant, not a scattered literal.
  assert.equal(REPAIR_FAILURE_THRESHOLD, 2);
});
