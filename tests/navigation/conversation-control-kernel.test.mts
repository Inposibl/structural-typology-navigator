import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareConversationTurn,
} from "../../src/lib/navigation/conversation-turn-control.ts";
import {
  CLARIFICATION_BUDGET,
  SESSION_CONTEXT_TTL_MS,
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

function turn(
  text: string,
  conversationState: ConversationState = createInitialConversationState(T0),
  profile: ConversationProfile = COMPLETE_PROFILE,
  nowMs: number = T0,
) {
  return prepareConversationTurn(
    [{ role: "user", content: text }],
    profile,
    { conversationState, nowMs },
  );
}

function selectionState(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return {
    ...createInitialConversationState(T0),
    activeFlow: { id: "COURSE_SELECTION", pendingQuestion: "team-or-self" },
    courseMatch: "AMBIGUOUS",
    ...overrides,
  };
}

function suspendedState(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return {
    ...createInitialConversationState(T0),
    suspendedFlow: {
      id: "COURSE_SELECTION",
      pendingQuestion:
        "Что для тебя важнее: мотивация людей или изменение мышления?",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A04 — CONVERSATION_CLOSE
// ---------------------------------------------------------------------------

test("A04: exit semantics close the conversation without routing", () => {
  for (const phrase of [
    "пока",
    "всё, пока",
    "спасибо, пока",
    "понятно, ухожу",
    "понятно все. пошел на хуй",
    "не хочу больше общаться",
  ]) {
    const result = turn(phrase);

    assert.equal(result.state, "RESPOND", phrase);
    assert.equal(result.conversationState.lifecycle, "CLOSED", phrase);
  }
});

test("A04: profanity alone is not exit semantics", () => {
  for (const phrase of ["блять", "ну и хуйня", "это пиздец"]) {
    const result = turn(phrase);
    assert.equal(result.state, "ROUTE", phrase);
  }
});

test("A04: 'пока' inside a substantive request does not close", () => {
  const result = turn("пока не знаю, подбери мне курс");

  assert.equal(result.state, "ROUTE");
  assert.equal(result.conversationState.lifecycle, "OPEN");
});

test("A04: a closed conversation reopens rather than trapping the user", () => {
  const closed = turn("пока");
  assert.equal(closed.state, "RESPOND");

  const reopened = turn("а вообще я хочу курс про мотивацию", closed.conversationState);
  assert.equal(reopened.state, "ROUTE");
  assert.equal(reopened.conversationState.lifecycle, "OPEN");
});

// ---------------------------------------------------------------------------
// A17 — cancel current flow, distinct from restart and close
// ---------------------------------------------------------------------------

test("A17: cancellation clears the flow but keeps session and addressing", () => {
  for (const phrase of [
    "отмени это",
    "отмени подбор",
    "не хочу этот курс",
    "не будем про это",
    "вернемся к выбору",
    "покажи другие",
  ]) {
    const result = turn(phrase, selectionState());

    assert.equal(result.state, "RESPOND", phrase);
    assert.equal(result.conversationState.activeFlow, null, phrase);
    assert.equal(result.conversationState.suspendedFlow, null, phrase);
    assert.equal(result.conversationState.courseMatch, "UNKNOWN", phrase);
    assert.equal(result.conversationState.selectedCourseId, null, phrase);
    assert.equal(result.conversationState.lifecycle, "OPEN", phrase);
    assert.equal(result.profile.addressMode, "TY", phrase);
    assert.equal(result.profile.displayName, "Иван", phrase);
  }
});

test("A17: cancellation without context is not a control", () => {
  const result = turn("отмени это", createInitialConversationState(T0));
  assert.equal(result.state, "ROUTE");
});

test("A17: restart is distinct from cancellation", () => {
  const result = turn("ну ладно ладно. давай сначала", selectionState());

  assert.equal(result.state, "RESPOND");
  assert.equal(result.resetConversation, true);
  assert.equal(result.profile.displayName, null);
  assert.equal(result.profile.addressMode, null);
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");
});

// ---------------------------------------------------------------------------
// A20 — repeat / rephrase / simplify
// ---------------------------------------------------------------------------

test("A20: restatement acts on prior content and never re-routes or re-binds", () => {
  const binding = normalizeConversationStatePayload(
    {
      ...createInitialConversationState(T0),
      activeFlow: { id: "COURSE_FOLLOW_UP", pendingQuestion: null },
      courseMatch: "MATCHED",
      selectedCourseId: "maslow",
      lastAssistant: {
        act: "COURSE_FOLLOW_UP",
        content:
          "Курс описывает динамическую модель переходов мотивации. Он не является медицинской рекомендацией.",
        courseId: "maslow",
      },
    },
    T0,
  );

  for (const phrase of [
    "повтори",
    "скажи ещё раз",
    "перефразируй",
    "скажи проще",
    "проще",
    "короче",
  ]) {
    const result = turn(phrase, binding);

    assert.equal(result.state, "RESPOND", phrase);
    assert.equal(result.conversationState.selectedCourseId, "maslow", phrase);
    assert.equal(result.conversationState.courseMatch, "MATCHED", phrase);
    // The restated answer is the last assistant content, so REPEAT is stable.
    assert.equal(
      result.conversationState.lastAssistant?.act,
      phrase === "повтори" || phrase === "скажи ещё раз"
        ? "REPEAT"
        : phrase === "перефразируй"
          ? "REPHRASE"
          : "SIMPLIFY",
      phrase,
    );
  }
});

test("A20: repeat returns the prior answer verbatim", () => {
  const content =
    "Курс описывает динамическую модель переходов мотивации. Он не является медицинской рекомендацией.";
  const binding = normalizeConversationStatePayload(
    {
      ...createInitialConversationState(T0),
      lastAssistant: { act: "COURSE_FOLLOW_UP", content, courseId: null },
    },
    T0,
  );

  const result = turn("повтори", binding);
  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;
  assert.equal(result.message, content);
});

test("A20: simplify keeps the factual ceiling sentence", () => {
  const binding = normalizeConversationStatePayload(
    {
      ...createInitialConversationState(T0),
      lastAssistant: {
        act: "COURSE_FOLLOW_UP",
        content:
          "У курса есть вводная часть. Есть и практическая часть. Материал не подтверждён внешними исследованиями.",
        courseId: null,
      },
    },
    T0,
  );

  const result = turn("короче", binding);
  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.match(result.message, /Материал не подтверждён/u);
  assert.ok(result.message.length < 140);
});

// ---------------------------------------------------------------------------
// A15 — interrupt / suspend / resume
// ---------------------------------------------------------------------------

test("A15: resume restores the suspended flow with its pending question", () => {
  const result = turn("вернёмся к курсу", suspendedState());

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.activeFlow?.id, "COURSE_SELECTION");
  assert.equal(result.conversationState.suspendedFlow, null);

  if (result.state !== "RESPOND") return;
  assert.match(result.message, /мотивация людей или изменение мышления/u);
});

test("A15: a stale suspended flow is not silently resumed", () => {
  const staleSuspended = suspendedState({
    lastActivityAt: toSessionTimestamp(T0 - SESSION_CONTEXT_TTL_MS - 1),
  });

  const result = turn("продолжим", staleSuspended);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.activeFlow, null);
  assert.equal(result.conversationState.suspendedFlow, null);
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");
});

test("A15: a digression suspends rather than erases an active flow", async () => {
  const { applyOrchestratedTurn } = await import(
    "../../src/lib/navigation/conversation-state.ts"
  );

  const active = selectionState();
  const afterDigression = applyOrchestratedTurn(
    active,
    {
      act: "ACADEMY_CONTACT",
      flowId: "ACADEMY_CONTACT",
      message: "Контакт Алексея.",
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

  assert.equal(afterDigression.activeFlow?.id, "ACADEMY_CONTACT");
  assert.equal(afterDigression.suspendedFlow?.id, "COURSE_SELECTION");
  assert.equal(afterDigression.suspendedFlow?.pendingQuestion, "team-or-self");

  const resumed = applyOrchestratedTurn(
    afterDigression,
    {
      act: "NAVIGATE",
      flowId: "COURSE_SELECTION",
      message: "Продолжаем подбор.",
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

  assert.equal(resumed.activeFlow?.id, "COURSE_SELECTION");
  assert.equal(resumed.suspendedFlow, null);
});

// ---------------------------------------------------------------------------
// A16 — skip / decline
// ---------------------------------------------------------------------------

test("A16: decline stops forcing the same question", () => {
  for (const phrase of [
    "не хочу отвечать на этот вопрос",
    "пропустим",
    "это личное",
    "не знаю",
  ]) {
    const result = turn(phrase, selectionState());

    assert.equal(result.state, "RESPOND", phrase);
    assert.equal(
      result.conversationState.activeFlow?.pendingQuestion,
      null,
      phrase,
    );
  }
});

test("A16: a bare 'не знаю' with no outstanding question is not a skip", () => {
  const result = turn("не знаю", createInitialConversationState(T0));
  assert.equal(result.state, "ROUTE");
});

// ---------------------------------------------------------------------------
// A18 — pending confirmation primitive
// ---------------------------------------------------------------------------

test("A18: a pending confirmation is resolved by YES/NO only", () => {
  const pending = normalizeConversationStatePayload(
    {
      ...createInitialConversationState(T0),
      staleReference: { previousCourseId: "maslow", previousFlowId: null },
      pendingConfirmation: {
        confirmationKey: "stale-course:maslow",
        kind: "STALE_COURSE_REFERENCE",
        prompt: "Ранее мы обсуждали курс «Маслоу». Вы имеете в виду его?",
        candidateCourseId: "maslow",
      },
    },
    T0,
  );

  // An unrelated message neither confirms nor applies the change, and while the
  // confirmation is still open it does not reach normal routing either
  // (CORR2-A): the question stays outstanding and the text is preserved.
  const unrelated = turn("а какие вообще бывают курсы", pending);
  assert.equal(unrelated.state, "RESPOND");
  assert.equal(unrelated.conversationState.pendingConfirmation !== null, true);
  assert.equal(unrelated.conversationState.selectedCourseId, null);
  assert.equal(
    unrelated.conversationState.deferredRequest,
    "а какие вообще бывают курсы",
  );

  const decline = turn("нет", pending);
  assert.equal(decline.state, "RESPOND");
  assert.equal(decline.conversationState.pendingConfirmation, null);
  assert.equal(decline.conversationState.selectedCourseId, null);
  assert.equal(decline.conversationState.staleReference, null);

  const accept = turn("да", pending);
  assert.equal(accept.state, "RESPOND");
  assert.equal(accept.conversationState.pendingConfirmation, null);
  assert.equal(accept.conversationState.selectedCourseId, "maslow");
  assert.equal(accept.conversationState.courseMatch, "MATCHED");
});

test("A18: a bare yes/no with nothing pending is not a control", () => {
  assert.equal(turn("да", createInitialConversationState(T0)).state, "ROUTE");
  assert.equal(turn("нет", createInitialConversationState(T0)).state, "ROUTE");
});

// ---------------------------------------------------------------------------
// A19 — multi-intent control preservation
// ---------------------------------------------------------------------------

test("A19: combined compatible controls are both resolved", () => {
  const state = suspendedState({
    lastAssistant: {
      act: "CLARIFICATION",
      content:
        "Первый вопрос был про мотивацию команды. Второй — про личную мотивацию. Отвечать можно в любом порядке.",
      courseId: null,
    },
  });

  const result = turn("повтори коротко, а потом продолжим", state);

  assert.equal(result.state, "RESPOND");
  // Both the restatement and the resume happened in one turn.
  assert.equal(result.conversationState.activeFlow?.id, "COURSE_SELECTION");
  assert.equal(result.conversationState.suspendedFlow, null);

  if (result.state !== "RESPOND") return;
  assert.match(result.message, /Возвращаюсь к подбору/u);
});

test("A19: substantive text after a control is preserved, not discarded", () => {
  const result = turn("отмени подбор, а потом подбери мне курс про команду", selectionState());

  assert.equal(result.state, "RESPOND");
  assert.equal(
    result.conversationState.deferredRequest,
    "подбери мне курс про команду",
  );

  if (result.state !== "RESPOND") return;
  assert.match(result.message, /подбери мне курс про команду/u);
});

// ---------------------------------------------------------------------------
// A02 — unsupported addressing variants
// ---------------------------------------------------------------------------

test("A02: unsupported addressing variants stay in ADDRESS_SETUP and do not loop", () => {
  const partial: ConversationProfile = {
    displayName: "микадо",
    addressMode: null,
    nameDeclined: false,
    pendingUserRequest: null,
  };

  const seen: string[] = [];
  let state = createInitialConversationState(T0);

  for (const phrase of ["на они", "на они", "на они", "мы они"]) {
    const result = turn(phrase, state, partial);

    assert.equal(result.state, "RESPOND", phrase);
    assert.equal(result.profile.addressMode, null, phrase);
    assert.equal(result.conversationState.courseMatch, "UNKNOWN", phrase);

    if (result.state !== "RESPOND") continue;
    seen.push(result.message);
    state = result.conversationState;
  }

  assert.match(seen[0]!, /только два варианта обращения/u);
  assert.notEqual(seen[0], seen[1]);
  assert.notEqual(seen[1], seen[2]);
  assert.equal(seen[2], seen[3]);

  // The initial prompt is never re-emitted by an invalid variant.
  for (const message of seen) {
    assert.doesNotMatch(message, /Прежде чем начнём/u);
  }

  assert.equal(
    state.clarification?.attempts,
    CLARIFICATION_BUDGET,
  );
});

test("A02: unsupported identity language is not educational evidence", () => {
  const partial: ConversationProfile = {
    displayName: "микадо",
    addressMode: null,
    nameDeclined: false,
    pendingUserRequest: null,
  };

  const result = turn("мы они. мы небинарное животное", createInitialConversationState(T0), partial);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.profile.pendingUserRequest, null);

  if (result.state !== "RESPOND") return;
  assert.doesNotMatch(result.message, /курс/iu);
});

// ---------------------------------------------------------------------------
// A28 — stale context
// ---------------------------------------------------------------------------

test("A28: a stale reference is confirmed, never silently restored", () => {
  const stale = normalizeConversationStatePayload(
    {
      ...createInitialConversationState(T0),
      courseMatch: "MATCHED",
      selectedCourseId: "maslow",
      activeFlow: { id: "COURSE_SELECTION", pendingQuestion: "team-or-self" },
      lastActivityAt: toSessionTimestamp(T0 - SESSION_CONTEXT_TTL_MS - 1),
    },
    T0,
  );

  const result = turn("этот курс мне подойдёт?", stale);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");
  assert.equal(result.conversationState.selectedCourseId, null);
  assert.equal(result.conversationState.activeFlow, null);
  assert.equal(
    result.conversationState.pendingConfirmation?.candidateCourseId,
    "maslow",
  );

  if (result.state !== "RESPOND") return;
  assert.match(result.message, /Ранее мы обсуждали/u);
  assert.match(result.message, /имеешь в виду/u);
});

test("A28: expiry preserves displayName, nameDeclined and TY/VY", () => {
  const stale = createInitialConversationState(
    T0 - SESSION_CONTEXT_TTL_MS - 1,
  );

  const result = turn("этот курс", stale);

  assert.equal(result.profile.displayName, "Иван");
  assert.equal(result.profile.addressMode, "TY");

  const declined = turn(
    "этот курс",
    stale,
    { ...COMPLETE_PROFILE, displayName: null, nameDeclined: true, addressMode: "VY" },
  );

  assert.equal(declined.profile.nameDeclined, true);
  assert.equal(declined.profile.addressMode, "VY");
});

test("A28: an explicit course name after expiry needs no confirmation", () => {
  const stale = createInitialConversationState(T0 - SESSION_CONTEXT_TTL_MS - 1);
  const result = turn("расскажи про курс Маслоу", stale);

  assert.equal(result.state, "ROUTE");
  assert.equal(result.conversationState.pendingConfirmation, null);
});

test("A28: an active conversation is not stale merely because it is long", () => {
  let state = createInitialConversationState(T0);
  let nowMs = T0;

  for (let index = 0; index < 30; index += 1) {
    nowMs += SESSION_CONTEXT_TTL_MS / 3;
    const result = turn("повтори", state, COMPLETE_PROFILE, nowMs);
    state = result.conversationState;
  }

  assert.notEqual(state.lastActivityAt, toSessionTimestamp(T0));
  assert.equal(state.staleReference, null);
});
