/**
 * Package-A regression bindings.
 *
 * Each test name carries the frozen scenario ID from
 * `01_R0_50_SCENARIO_FIXTURES_FROZEN.json`. Fixture turn texts are reproduced
 * verbatim so the binding cannot drift from the frozen corpus, and the
 * recovered production dialogues (R0 closure §2.4) are included as exact
 * inputs.
 *
 * Only the Package-A portion of each scenario is asserted here. Scenarios whose
 * remaining behaviour belongs to Packages B–E are marked in the test name.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { NavigationDecision } from "../../src/lib/navigation/navigation-decision.ts";
import {
  orchestrateNavigatorResponse,
  type OrchestrationDependencies,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  CLARIFICATION_BUDGET,
  SESSION_CONTEXT_TTL_MS,
  clarificationIssueKey,
  createInitialConversationState,
  normalizeConversationStatePayload,
  toSessionTimestamp,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import {
  prepareConversationTurn,
} from "../../src/lib/navigation/conversation-turn-control.ts";
import {
  advanceConversationProfile,
  createEmptyConversationProfile,
  isConversationProfileComplete,
} from "../../src/lib/navigation/conversation-profile.ts";
import type { ConversationProfile } from "../../src/lib/chat-contract.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

const COMPLETE_PROFILE: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

function turn(
  content: string,
  conversationState: ConversationState = createInitialConversationState(T0),
  profile: ConversationProfile = COMPLETE_PROFILE,
) {
  return prepareConversationTurn(
    [{ role: "user", content }],
    profile,
    { conversationState, nowMs: T0 },
  );
}

function stateWith(
  overrides: Partial<ConversationState>,
): ConversationState {
  return normalizeConversationStatePayload(
    { ...createInitialConversationState(T0), ...overrides },
    T0,
  );
}

function conversation(
  turns: Array<{ role: "user" | "assistant"; content: string }>,
) {
  return turns;
}

// ---------------------------------------------------------------------------
// A01 — setup segmentation
// ---------------------------------------------------------------------------

test("R01: greeting + name + TY + Academy request in one message", () => {
  const result = turn(
    "Привет, меня зовут Иван, давай на ты. Мне нужен курс про мотивацию команды.",
    createInitialConversationState(T0),
    createEmptyConversationProfile(),
  );

  assert.equal(result.profile.displayName, "Иван");
  assert.equal(result.profile.addressMode, "TY");
  assert.equal(result.state, "ROUTE");

  if (result.state !== "ROUTE") return;
  assert.equal(
    result.messages.at(-1)?.content,
    "Мне нужен курс про мотивацию команды",
  );
});

test("R02: greeting + name + VY + course question in one message", () => {
  const result = turn(
    "Здравствуйте, меня зовут Анна, давайте на вы. Какой курс поможет лучше понимать поведение команды?",
    createInitialConversationState(T0),
    createEmptyConversationProfile(),
  );

  assert.equal(result.profile.displayName, "Анна");
  assert.equal(result.profile.addressMode, "VY");
  assert.equal(result.state, "ROUTE");

  if (result.state !== "ROUTE") return;
  assert.equal(
    result.messages.at(-1)?.content,
    "Какой курс поможет лучше понимать поведение команды",
  );
});

test("R03: an unsupported addressing phrase yields one bounded clarification", () => {
  const partial: ConversationProfile = {
    displayName: "Иван",
    addressMode: null,
    nameDeclined: false,
    pendingUserRequest: null,
  };

  const result = turn("на они", createInitialConversationState(T0), partial);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.profile.addressMode, null);
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");

  if (result.state !== "RESPOND") return;
  assert.match(result.message, /на «ты» или на «вы»/u);
});

test("recovered dialogue 12: 'микадо. я оно' does not swallow 'я оно' into the name", () => {
  const result = advanceConversationProfile(
    createEmptyConversationProfile(),
    "микадо. я оно",
  );

  assert.equal(result.profile.displayName, "микадо");
  assert.equal(result.profile.addressMode, null);
  assert.equal(result.complete, false);
  assert.equal(result.effectiveUserRequest, null);
});

test("recovered dialogue 12: repeated unsupported mode never repeats the initial prompt", () => {
  const partial: ConversationProfile = {
    displayName: "микадо",
    addressMode: null,
    nameDeclined: false,
    pendingUserRequest: null,
  };

  const prompts: string[] = [];
  let state = createInitialConversationState(T0);

  for (const content of [
    "на они",
    "мы они. мы небинарное животное",
    "на оно",
    "на они",
  ]) {
    const result = turn(content, state, partial);
    assert.equal(result.state, "RESPOND", content);
    assert.equal(result.profile.addressMode, null, content);

    if (result.state === "RESPOND") {
      prompts.push(result.message);
      state = result.conversationState;
    }
  }

  for (const prompt of prompts) {
    assert.doesNotMatch(prompt, /Прежде чем начнём/u);
  }

  assert.notEqual(prompts[0], prompts[1]);
  assert.notEqual(prompts[1], prompts[2]);
});

test("recovered dialogue 14: 'привет. Я Семен. Можно на ты.' stores only 'Семен'", () => {
  const result = advanceConversationProfile(
    createEmptyConversationProfile(),
    "привет. Я Семен. Можно на ты.",
  );

  assert.equal(result.profile.displayName, "Семен");
  assert.equal(result.profile.addressMode, "TY");
  assert.equal(result.complete, true);
});

test("recovered dialogue 16: greeting is never the name and the request is retained", () => {
  const result = advanceConversationProfile(
    createEmptyConversationProfile(),
    "привет. у меня проблема в общении с мужем. он просто меня не слышит. и я не знаю, что делать",
  );

  assert.notEqual(result.profile.displayName, "привет");
  assert.equal(result.profile.displayName, null);
  assert.equal(isConversationProfileComplete(result.profile), false);
  assert.equal(result.profile.addressMode, null);
  assert.match(
    result.profile.pendingUserRequest ?? "",
    /проблема в общении с мужем/u,
  );
});

// ---------------------------------------------------------------------------
// A04 — close
// ---------------------------------------------------------------------------

test("R06: 'спасибо, пока' during idle conversation closes concisely", () => {
  const result = turn("спасибо, пока");

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.lifecycle, "CLOSED");

  if (result.state !== "RESPOND") return;
  assert.doesNotMatch(result.message, /вне функции/u);
});

test("R07: 'пока' during an active flow closes without executing the flow", () => {
  const active = stateWith({
    activeFlow: { id: "COURSE_SELECTION", pendingQuestion: "team-or-self" },
    courseMatch: "AMBIGUOUS",
  });

  const result = turn("пока", active);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.lifecycle, "CLOSED");
  assert.equal(result.conversationState.activeFlow, null);
  assert.equal(result.conversationState.suspendedFlow, null);
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");
});

// ---------------------------------------------------------------------------
// A20 — repeat / rephrase / simplify
// ---------------------------------------------------------------------------

test("R11: 'повтори' repeats the prior answer without rerunning routing", () => {
  const state = stateWith({
    lastAssistant: {
      act: "CLARIFICATION",
      content:
        "Для вашей задачи сейчас нужен один уточняющий параметр: это вопрос о мотивации команды или о личной мотивации?",
      courseId: null,
    },
  });

  const result = turn("повтори", state);

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;
  assert.equal(
    result.message,
    "Для вашей задачи сейчас нужен один уточняющий параметр: это вопрос о мотивации команды или о личной мотивации?",
  );
});

test("R12: 'скажи проще' simplifies while preserving facts and addressing", () => {
  const state = stateWith({
    lastAssistant: {
      act: "COURSE_FOLLOW_UP",
      content:
        "Курс описывает динамическую модель переходов мотивации в зависимости от контекста. Модель не является клинической классификацией.",
      courseId: null,
    },
  });

  const result = turn("скажи проще", state, {
    ...COMPLETE_PROFILE,
    displayName: "Анна",
    addressMode: "VY",
  });

  assert.equal(result.state, "RESPOND");
  assert.equal(result.profile.addressMode, "VY");

  if (result.state !== "RESPOND") return;
  assert.match(result.message, /не является клинической/u);
  assert.ok(result.message.length < 160);
});

test("R13: 'короче' compresses without changing authority or state", () => {
  const state = stateWith({
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
    lastAssistant: {
      act: "NAVIGATE",
      content:
        "Курс помогает различать текущую мотивацию, контекст и возможные изменения поведения человека или команды. Отдельная часть посвящена командным ситуациям. Курс не заменяет терапию.",
      courseId: "maslow",
    },
  });

  const result = turn("короче", state);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.courseMatch, "MATCHED");
  assert.equal(result.conversationState.selectedCourseId, "maslow");
});

// ---------------------------------------------------------------------------
// A14 — clarification budget
// ---------------------------------------------------------------------------

const ASK_MORE_QUESTIONS = [
  "Что именно в поведении людей на работе вы хотите лучше понимать?",
  "Вам важнее разобраться в мотивации команды или в собственном стиле взаимодействия?",
  "Что для вас сейчас важнее: понять причины поведения или изменить свою реакцию?",
];

function askMoreDecision(): NavigationDecision {
  return {
    state: "ASK_MORE",
    candidateCourseIds: ["maslow", "levels-of-consciousness"],
    questions: ASK_MORE_QUESTIONS,
    rationale: "Два курса остаются сопоставимо правдоподобными.",
  };
}

function clarificationDependencies(): OrchestrationDependencies {
  return {
    classifyAct: async () => ({ state: "NAVIGATE" }),
    route: async () => askMoreDecision(),
  };
}

function clarificationOptions(
  priorIssueKey: string | null,
  priorAttempts: number,
) {
  return {
    dependencies: clarificationDependencies(),
    profile: COMPLETE_PROFILE,
    clarification: { priorIssueKey, priorAttempts },
  };
}

test("R14: the first genuinely ambiguous request asks one useful clarification", async () => {
  const result = await orchestrateNavigatorResponse(
    conversation([
      { role: "user", content: "Мне нужно лучше понимать людей на работе." },
    ]),
    clarificationOptions(null, 0),
  );

  assert.equal(result.clarification.status, "ASKED");
  assert.equal(result.clarification.attempts, 1);
  assert.equal(result.clarification.question, ASK_MORE_QUESTIONS[0]);
  assert.equal(
    result.clarification.issueKey,
    clarificationIssueKey(["maslow", "levels-of-consciousness"]),
  );
});

test("R15: a repeated unresolved ambiguity asks a materially different question", async () => {
  const issueKey = clarificationIssueKey([
    "maslow",
    "levels-of-consciousness",
  ]);

  const result = await orchestrateNavigatorResponse(
    conversation([
      {
        role: "user",
        content: "Не знаю, просто хочу лучше разбираться.",
      },
    ]),
    clarificationOptions(issueKey, 1),
  );

  assert.equal(result.clarification.status, "ASKED");
  assert.equal(result.clarification.attempts, 2);
  assert.equal(result.clarification.question, ASK_MORE_QUESTIONS[1]);
  assert.notEqual(result.clarification.question, ASK_MORE_QUESTIONS[0]);
});

test("R15: the counter is scoped to the unresolved issue, not the session", async () => {
  const otherIssueKey = clarificationIssueKey(["play-and-creativity"]);

  const result = await orchestrateNavigatorResponse(
    conversation([{ role: "user", content: "Не знаю, просто хочу разбираться." }]),
    clarificationOptions(otherIssueKey, CLARIFICATION_BUDGET - 1),
  );

  // A different unresolved issue starts its own count.
  assert.equal(result.clarification.attempts, 1);
  assert.equal(result.clarification.question, ASK_MORE_QUESTIONS[0]);
});

test("R16: an exhausted clarification budget stops asking and returns a structured result", async () => {
  const issueKey = clarificationIssueKey([
    "maslow",
    "levels-of-consciousness",
  ]);

  const result = await orchestrateNavigatorResponse(
    conversation([
      { role: "user", content: "Не знаю, я уже ответил как мог." },
    ]),
    clarificationOptions(issueKey, CLARIFICATION_BUDGET),
  );

  assert.equal(result.clarification.status, "EXHAUSTED");
  assert.equal(result.clarification.attempts, CLARIFICATION_BUDGET);
  assert.equal(result.clarification.question, null);
  assert.match(result.message, /Больше их задавать не буду/u);

  for (const question of ASK_MORE_QUESTIONS) {
    assert.doesNotMatch(result.message, new RegExp(question, "u"));
  }
});

// ---------------------------------------------------------------------------
// A15 — suspend / resume
// ---------------------------------------------------------------------------

test("R17: a supported digression suspends the active flow and keeps resumable state", async () => {
  const active = stateWith({
    activeFlow: { id: "COURSE_SELECTION", pendingQuestion: "team-or-self" },
    courseMatch: "AMBIGUOUS",
  });

  const orchestrated = await orchestrateNavigatorResponse(
    conversation([
      {
        role: "assistant",
        content:
          "Что для тебя важнее: мотивация людей или изменение мышления под давлением?",
      },
      { role: "user", content: "Кстати, а как связаться с Алексеем?" },
    ]),
    {
      profile: COMPLETE_PROFILE,
      dependencies: {
        classifyAct: async () => ({
          state: "COURSE_FOLLOW_UP",
          courseId: "maslow",
          evidenceRequested: false,
        }),
      },
    },
  );

  // The digression is answered by the existing contact authority.
  assert.notEqual(orchestrated.contactCard, null);

  const { applyOrchestratedTurn } = await import(
    "../../src/lib/navigation/conversation-state.ts"
  );

  const afterDigression = applyOrchestratedTurn(
    active,
    {
      act: "ACADEMY_CONTACT",
      flowId: "ACADEMY_CONTACT",
      message: orchestrated.message,
      decision: { kind: "NONE" },
      clarification: orchestrated.clarification,
    },
    T0,
  );

  assert.equal(afterDigression.activeFlow?.id, "ACADEMY_CONTACT");
  assert.equal(afterDigression.suspendedFlow?.id, "COURSE_SELECTION");
  assert.equal(
    afterDigression.suspendedFlow?.pendingQuestion,
    "team-or-self",
  );
});

test("R18: 'вернёмся к курсу' resumes the suspended flow from structured state", () => {
  const suspended = stateWith({
    suspendedFlow: {
      id: "COURSE_SELECTION",
      pendingQuestion:
        "Что для тебя важнее: мотивация людей или изменение мышления под давлением?",
    },
  });

  const result = turn("вернёмся к курсу", suspended);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.activeFlow?.id, "COURSE_SELECTION");
  assert.equal(result.conversationState.suspendedFlow, null);

  if (result.state !== "RESPOND") return;
  assert.match(
    result.message,
    /мотивация людей или изменение мышления под давлением/u,
  );
});

// ---------------------------------------------------------------------------
// A16 — skip / decline
// ---------------------------------------------------------------------------

test("R19: decline is respected and the same question is not forced again", () => {
  const active = stateWith({
    activeFlow: { id: "COURSE_SELECTION", pendingQuestion: "team-or-self" },
  });

  const result = turn("не хочу отвечать на этот вопрос", active, {
    ...COMPLETE_PROFILE,
    displayName: "Анна",
    addressMode: "VY",
  });

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.activeFlow?.pendingQuestion, null);

  if (result.state !== "RESPOND") return;
  assert.doesNotMatch(result.message, /team-or-self/u);
});

// ---------------------------------------------------------------------------
// A17 — cancel and restart
// ---------------------------------------------------------------------------

test("R20: 'отмени подбор' cancels the flow only", () => {
  const active = stateWith({
    activeFlow: { id: "COURSE_SELECTION", pendingQuestion: null },
    courseMatch: "AMBIGUOUS",
  });

  const result = turn("отмени подбор", active);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.lifecycle, "OPEN");
  assert.equal(result.conversationState.activeFlow, null);
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");
  assert.equal(result.profile.addressMode, "TY");
  assert.equal(result.profile.displayName, "Иван");
});

test("R21: 'давай сначала' performs a full restart, distinct from cancel", () => {
  const active = stateWith({
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
  });

  const result = turn("ну ладно ладно. давай сначала", active);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.resetConversation, true);
  assert.equal(result.profile.displayName, null);
  assert.equal(result.profile.addressMode, null);
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");
  assert.equal(result.conversationState.selectedCourseId, null);
});

// ---------------------------------------------------------------------------
// A19 — multi-intent control preservation
// ---------------------------------------------------------------------------

test("R22: compatible multi-intent controls are both resolved and nothing is discarded", () => {
  const state = stateWith({
    suspendedFlow: {
      id: "COURSE_SELECTION",
      pendingQuestion:
        "Что для тебя важнее: мотивация людей или изменение мышления?",
    },
    lastAssistant: {
      act: "CLARIFICATION",
      content:
        "Первый вопрос был про мотивацию команды. Второй — про личную мотивацию. Отвечать можно в любом порядке.",
      courseId: null,
    },
  });

  const result = turn("повтори коротко, а потом продолжим", state);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.activeFlow?.id, "COURSE_SELECTION");
  assert.equal(result.conversationState.suspendedFlow, null);

  if (result.state !== "RESPOND") return;
  assert.match(result.message, /Первый вопрос был про мотивацию команды/u);
  assert.match(result.message, /Возвращаюсь к подбору/u);
});

test("R22: substantive text accompanying a control is preserved structurally", () => {
  const active = stateWith({
    activeFlow: { id: "COURSE_SELECTION", pendingQuestion: null },
    courseMatch: "AMBIGUOUS",
  });

  const result = turn("отмени подбор, а потом подбери мне курс про команду", active);

  assert.equal(result.state, "RESPOND");
  assert.equal(
    result.conversationState.deferredRequest,
    "подбери мне курс про команду",
  );
});

// ---------------------------------------------------------------------------
// A12 — control acts never fall through to META / OUT_OF_SCOPE
// ---------------------------------------------------------------------------

test("R24: a genuine meta question still reaches the META lane", async () => {
  // The kernel must not intercept it.
  const prepared = turn("Зачем Навигатор задаёт мне уточняющие вопросы?");
  assert.equal(prepared.state, "ROUTE");

  const result = await orchestrateNavigatorResponse(
    conversation([
      { role: "user", content: "Зачем Навигатор задаёт мне уточняющие вопросы?" },
    ]),
    {
      profile: COMPLETE_PROFILE,
      dependencies: {
        classifyAct: async () => ({ state: "META" }),
        route: async () => {
          throw new Error("META must not reach the educational router.");
        },
      },
    },
  );

  assert.equal(result.conversationAct.state, "META");
  assert.match(result.message, /Навигатор нужен для выбора/u);
});

test("R25: supported control phrasing selects the higher-priority control", () => {
  const state = stateWith({
    lastAssistant: {
      act: "NAVIGATE",
      content: "Курс Маслоу связан с анализом мотивации. Это не клинический диагноз.",
      courseId: null,
    },
  });

  const result = turn("скажи проще", state);

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;
  assert.doesNotMatch(result.message, /вне функции Навигатора/u);
});

test("R26: a genuine unsupported request still reaches the final OOS path", async () => {
  const prepared = turn("Какая погода завтра в Асунсьоне?");
  assert.equal(prepared.state, "ROUTE");

  const result = await orchestrateNavigatorResponse(
    conversation([
      { role: "user", content: "Какая погода завтра в Асунсьоне?" },
    ]),
    {
      profile: COMPLETE_PROFILE,
      dependencies: {
        classifyAct: async () => ({ state: "OUT_OF_SCOPE" }),
        route: async () => {
          throw new Error("OUT_OF_SCOPE must not reach the educational router.");
        },
      },
    },
  );

  assert.equal(result.conversationAct.state, "OUT_OF_SCOPE");
  assert.match(result.message, /вне функции Навигатора/u);
});

// ---------------------------------------------------------------------------
// A28 — stale context
// ---------------------------------------------------------------------------

test("R50: a stale session + 'этот курс' never reuses the old binding", () => {
  const stale = stateWith({
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
    activeFlow: { id: "COURSE_SELECTION", pendingQuestion: "team-or-self" },
    lastActivityAt: toSessionTimestamp(T0 - SESSION_CONTEXT_TTL_MS - 1),
  });

  const result = turn("этот курс мне подойдёт?", stale);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.conversationState.selectedCourseId, null);
  assert.equal(result.conversationState.courseMatch, "UNKNOWN");
  assert.equal(result.conversationState.activeFlow, null);

  // The old course may only be offered back as a confirmation candidate.
  assert.equal(
    result.conversationState.pendingConfirmation?.candidateCourseId,
    "maslow",
  );

  if (result.state !== "RESPOND") return;
  assert.match(result.message, /Ранее мы обсуждали/u);

  // Accepting the candidate is the only way it becomes active again.
  const accepted = turn("да", result.conversationState);
  assert.equal(accepted.conversationState.selectedCourseId, "maslow");
});
