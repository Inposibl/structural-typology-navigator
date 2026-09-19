/**
 * Package-B regression bindings for the frozen R0 corpus, plus the three hard
 * invariants of the act.
 *
 * Fixture turn texts and profiles are reproduced verbatim from
 * `01_R0_50_SCENARIO_FIXTURES_FROZEN.json` so the binding cannot drift from the
 * frozen corpus. Only the Package-B portion of each scenario is asserted here;
 * scenarios whose remaining behaviour belongs to a later package are named in
 * the test title.
 *
 * The structural proof used throughout is that a lane which must not route
 * never reaches the orchestration layer: the injected orchestrator records its
 * own invocation, so reaching it fails the assertion.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationProfile } from "../../src/lib/chat-contract.ts";
import {
  NavigatorStageError,
} from "../../src/lib/navigation/navigator-observability.ts";
import {
  CLARIFICATION_BUDGET,
  createInitialConversationState,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import {
  orchestrateNavigatorResponse,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  handleChatRequest,
  type ChatRouteDependencies,
} from "../../src/app/api/chat/route.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

const IVAN_TY: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

const ANNA_VY: ConversationProfile = {
  displayName: "Анна",
  addressMode: "VY",
  nameDeclined: false,
  pendingUserRequest: null,
};

function stateWith(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return { ...createInitialConversationState(T0), ...overrides };
}

/** An orchestrator that records whether the routing layer was reached at all. */
function routingSpy(behavior: () => Promise<never> = () => {
  throw new Error("routing layer must not be reached");
}): { dependencies: ChatRouteDependencies; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    dependencies: {
      orchestrate: () => {
        calls += 1;
        return behavior();
      },
    },
  };
}

function chatRequest(
  body: unknown,
  dependencies?: ChatRouteDependencies,
): Promise<Response> {
  return handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    dependencies,
  );
}

async function success(
  body: unknown,
  dependencies?: ChatRouteDependencies,
): Promise<{
  message: string;
  profile: ConversationProfile;
  conversationState: ConversationState;
}> {
  const response = await chatRequest(body, dependencies);
  assert.equal(response.status, 200);
  return (await response.json()) as {
    message: string;
    profile: ConversationProfile;
    conversationState: ConversationState;
  };
}

// ---------------------------------------------------------------------------
// HARD INVARIANT 1 (act §29) — technical failure is structurally distinct
// ---------------------------------------------------------------------------

test("HARD-1: a thrown provider failure can never become a semantic verdict", async () => {
  const response = await chatRequest(
    {
      messages: [
        {
          role: "user",
          content: "Почему курс Маслоу подходит для работы с мотивацией команды?",
        },
      ],
      profile: ANNA_VY,
      conversationState: stateWith({
        courseMatch: "MATCHED",
        selectedCourseId: "maslow",
      }),
    },
    {
      orchestrate: () =>
        Promise.reject(
          new NavigatorStageError(
            "ACT_ROUTER",
            Object.assign(new Error("provider timed out"), {
              code: "ABORTED",
            }),
          ),
        ),
    },
  );

  assert.equal(response.status, 503);
  const body = (await response.json()) as {
    error: { code: string; message: string; conversationState: ConversationState };
  };

  assert.equal(body.error.code, "NAVIGATOR_TECHNICAL_ERROR");
  assert.notEqual(body.error.conversationState.lastTechnicalError, null);
  assert.doesNotMatch(
    body.error.message,
    /не понял|не поняла|уточните запрос|вне функции|не могу уверенно отнести|no_match|out_of_scope/iu,
  );
});

// ---------------------------------------------------------------------------
// HARD INVARIANT 2 (act §30) — repair never becomes a fresh business route
// ---------------------------------------------------------------------------

test("HARD-2: repair phrases never create a course-selection route", async () => {
  const scenarios = [
    {
      id: "R08",
      user: "ответь нормально",
      profile: IVAN_TY,
      prior: {
        act: "CLARIFICATION" as const,
        content: "В текущем каталоге есть несколько вариантов. Уточни, что для тебя важнее.",
        courseId: null,
      },
      act: "REPAIR_RESTATE",
    },
    {
      id: "R09",
      user: "что ты имел в виду?",
      profile: ANNA_VY,
      prior: {
        act: "COURSE_FOLLOW_UP" as const,
        content:
          "Курс помогает анализировать мотивацию в контексте управленческих задач.",
        courseId: "maslow",
      },
      act: "REPAIR_CLARIFY",
    },
    {
      id: "R10",
      user: "ты сам сказал, что курс Маслоу про мотивацию. Почему теперь говоришь иначе?",
      profile: IVAN_TY,
      prior: {
        act: "NAVIGATE" as const,
        content:
          "Я не вижу подтверждённого соответствия вашему запросу текущему каталогу.",
        courseId: null,
      },
      act: "REPAIR_CHALLENGE",
    },
  ];

  for (const scenario of scenarios) {
    const spy = routingSpy();
    const payload = await success(
      {
        messages: [
          { role: "assistant", content: scenario.prior.content },
          { role: "user", content: scenario.user },
        ],
        profile: scenario.profile,
        conversationState: stateWith({ lastAssistant: scenario.prior }),
      },
      spy.dependencies,
    );

    assert.equal(spy.calls(), 0, `${scenario.id} must not reach routing`);
    assert.equal(payload.conversationState.lastAssistant?.act, scenario.act);
    // No out-of-scope answer was produced anywhere on this lane.
    assert.doesNotMatch(payload.message, /вне функции Навигатора/iu);
  }
});

// ---------------------------------------------------------------------------
// HARD INVARIANT 3 (act §31) — a direct human request never loops in the bot
// ---------------------------------------------------------------------------

test("HARD-3: a direct human request hands off instead of looping", async () => {
  const spy = routingSpy();
  const payload = await success(
    {
      messages: [
        { role: "user", content: "Хочу поговорить с менеджером Академии Алексеем." },
      ],
      profile: IVAN_TY,
      conversationState: stateWith({
        courseMatch: "MATCHED",
        selectedCourseId: "maslow",
        activeFlow: { id: "COURSE_SELECTION", pendingQuestion: "Что важнее?" },
      }),
    },
    spy.dependencies,
  );

  assert.equal(spy.calls(), 0);
  assert.equal(payload.conversationState.handoff.status, "READY");
  assert.equal(payload.conversationState.handoff.reason, "DIRECT_REQUEST");
  // No forced extra clarification and no repeated course-selection question.
  assert.doesNotMatch(payload.message, /как к вам обращаться|Что важнее/iu);
  // A bounded summary was created, and it carries the established course.
  assert.notEqual(payload.conversationState.handoff.context, null);
  assert.equal(
    payload.conversationState.handoff.context?.courseId,
    "maslow",
  );
});

// ---------------------------------------------------------------------------
// Rxx bindings
// ---------------------------------------------------------------------------

test("R08: repair of the prior clarification answer, without unrelated routing", () => {
  return success(
    {
      messages: [
        {
          role: "assistant",
          content: "В текущем каталоге есть несколько вариантов. Уточни, что для тебя важнее.",
        },
        { role: "user", content: "ответь нормально" },
      ],
      profile: IVAN_TY,
      conversationState: stateWith({
        lastAssistant: {
          act: "CLARIFICATION",
          content:
            "В текущем каталоге есть несколько вариантов. Уточни, что для тебя важнее.",
          courseId: null,
        },
      }),
    },
    routingSpy().dependencies,
  ).then((payload) => {
    assert.equal(payload.conversationState.lastAssistant?.act, "REPAIR_RESTATE");
  });
});

test("R16: exhausted clarification changes strategy and offers human help", async () => {
  const spy = routingSpy();
  const payload = await success(
    {
      messages: [{ role: "user", content: "Не знаю, я уже ответил как мог." }],
      profile: IVAN_TY,
      conversationState: stateWith({
        courseMatch: "AMBIGUOUS",
        clarification: {
          issueKey: "ask-more:maslow+play-and-creativity",
          attempts: CLARIFICATION_BUDGET,
          strategyKey: null,
        },
        lastAssistant: {
          act: "CLARIFICATION",
          content: "Что для тебя важнее?",
          courseId: null,
        },
      }),
    },
    spy.dependencies,
  );

  assert.equal(spy.calls(), 0);
  assert.equal(payload.conversationState.handoff.status, "OFFERED");
  assert.equal(
    payload.conversationState.handoff.reason,
    "CLARIFICATION_EXHAUSTED",
  );
  assert.equal(
    payload.conversationState.clarification?.attempts,
    CLARIFICATION_BUDGET,
  );
});

test("R27: a provider timeout on a normal request renders the technical lane", async () => {
  const response = await chatRequest(
    {
      messages: [
        {
          role: "user",
          content: "Почему курс Маслоу подходит для работы с мотивацией команды?",
        },
      ],
      profile: ANNA_VY,
      conversationState: stateWith(),
    },
    {
      orchestrate: () =>
        Promise.reject(
          new NavigatorStageError(
            "ACT_ROUTER",
            Object.assign(new Error("timed out"), { code: "ABORTED" }),
          ),
        ),
    },
  );

  assert.equal(response.status, 503);
  const body = (await response.json()) as {
    error: { message: string; conversationState: ConversationState };
  };
  assert.equal(
    body.error.conversationState.lastTechnicalError?.failureClass,
    "PROVIDER_TIMEOUT",
  );
  assert.equal(body.error.conversationState.courseMatch, "UNKNOWN");
  assert.doesNotMatch(body.error.message, /не понял|уточните запрос|вне функции/iu);
});

test("R28: a failing semantic resolver preserves deterministic state for retry", async () => {
  const response = await chatRequest(
    {
      messages: [
        { role: "user", content: "Мне важно и про мотивацию, и про поведение под давлением." },
      ],
      profile: IVAN_TY,
      conversationState: stateWith({
        courseMatch: "MATCHED",
        selectedCourseId: "maslow",
        clarification: {
          issueKey: "ask-more:maslow",
          attempts: 2,
          strategyKey: "ask-more-2",
        },
      }),
    },
    {
      orchestrate: (messages, options) =>
        orchestrateNavigatorResponse(messages, {
          ...options,
          dependencies: {
            classifyAct: () => {
              throw new Error("resolver failed");
            },
          },
        }),
    },
  );

  assert.notEqual(response.status, 200);
  const body = (await response.json()) as {
    error: { conversationState: ConversationState };
  };
  const preserved = body.error.conversationState;

  assert.equal(preserved.selectedCourseId, "maslow");
  assert.equal(preserved.courseMatch, "MATCHED");
  assert.equal(preserved.clarification?.attempts, 2);
  assert.equal(preserved.execution.phase, "IDLE");
  assert.notEqual(preserved.lastTechnicalError, null);
});

test("R30: a duplicate submit is duplicate-safe; transactional idempotency stays in Package C", async () => {
  const first = await success({
    messages: [{ role: "user", content: "меня зовут Пётр" }],
    profile: ANNA_VY,
    conversationState: stateWith(),
    requestId: "r30-duplicate",
  });

  const second = await success({
    messages: [{ role: "user", content: "пока" }],
    profile: first.profile,
    conversationState: first.conversationState,
    requestId: "r30-duplicate",
  });

  // The replay is recognised and does not execute as a fresh business action.
  assert.equal(second.message, first.message);
  assert.equal(second.conversationState.lifecycle, "OPEN");
  // Package B makes no transactional idempotency claim: payment/deep-link
  // idempotency remains owned by the commercial authority (Package C).
  assert.equal(
    second.conversationState.execution.lastCompletedRequestId,
    "r30-duplicate",
  );
});

test("R31: a direct manager/Alexey request offers handoff without forcing clarification", async () => {
  const spy = routingSpy();
  const payload = await success(
    {
      messages: [
        { role: "user", content: "Хочу поговорить с менеджером Академии Алексеем." },
      ],
      profile: IVAN_TY,
      conversationState: stateWith(),
    },
    spy.dependencies,
  );

  assert.equal(spy.calls(), 0);
  assert.equal(payload.conversationState.handoff.status, "READY");
  assert.match(payload.message, /Лебедев/u);
});

test("R32: frustration after repeated repair offers handoff and stays calm", async () => {
  const spy = routingSpy();
  const payload = await success(
    {
      messages: [
        {
          role: "assistant",
          content: "По подтверждённым данным я не могу уверенно отнести запрос к одному текущему курсу.",
        },
        { role: "user", content: "Ты опять не понял. Это уже третий раз." },
      ],
      profile: IVAN_TY,
      conversationState: stateWith({
        lastAssistant: {
          act: "NAVIGATE",
          content:
            "По подтверждённым данным я не могу уверенно отнести запрос к одному текущему курсу.",
          courseId: null,
        },
        repair: { issueKey: "repair:general", attempts: 1 },
      }),
    },
    spy.dependencies,
  );

  assert.equal(spy.calls(), 0);
  assert.equal(payload.conversationState.handoff.status, "OFFERED");
  assert.equal(payload.conversationState.handoff.reason, "FRUSTRATION");
  // Public tone stays calm: no blame, no argument.
  assert.doesNotMatch(payload.message, /сам виноват|ты неправильно|вы неправильно|не буду/iu);
});

test("R33: handoff after a course-selection discussion carries the goal, not the transcript", async () => {
  const spy = routingSpy();
  const payload = await success(
    {
      messages: [
        { role: "assistant", content: "Курс помогает анализировать мотивацию." },
        { role: "user", content: "Передайте это Алексею, пожалуйста." },
      ],
      profile: ANNA_VY,
      conversationState: stateWith({
        courseMatch: "MATCHED",
        selectedCourseId: "maslow",
        activeFlow: { id: "COURSE_SELECTION", pendingQuestion: null },
        lastAssistant: {
          act: "COURSE_FOLLOW_UP",
          content: "Курс помогает анализировать мотивацию.",
          courseId: "maslow",
        },
      }),
    },
    spy.dependencies,
  );

  assert.equal(spy.calls(), 0);
  const context = payload.conversationState.handoff.context;
  assert.notEqual(context, null);
  assert.equal(context?.courseId, "maslow");
  assert.equal(context?.goal, "COURSE_SELECTION");
  assert.equal(context?.flowId, "COURSE_SELECTION");
  assert.doesNotMatch(payload.message, /Курс помогает анализировать мотивацию/u);
});

test("R34: 'не помогло' is captured as a quality signal, not an out-of-scope answer", async () => {
  const spy = routingSpy();
  const payload = await success(
    {
      messages: [
        {
          role: "assistant",
          content:
            "По подтверждённым данным я не могу уверенно отнести запрос к одному текущему курсу.",
        },
        { role: "user", content: "не помогло" },
      ],
      profile: IVAN_TY,
      conversationState: stateWith({
        lastAssistant: {
          act: "NAVIGATE",
          content:
            "По подтверждённым данным я не могу уверенно отнести запрос к одному текущему курсу.",
          courseId: null,
        },
      }),
    },
    spy.dependencies,
  );

  assert.equal(spy.calls(), 0);
  assert.doesNotMatch(payload.message, /вне функции Навигатора/iu);
  const signal = payload.conversationState.qualitySignals.at(-1);
  assert.equal(signal?.signalType, "NEGATIVE_FEEDBACK");
  assert.equal(signal?.lastAssistantAct, "NAVIGATE");
});
