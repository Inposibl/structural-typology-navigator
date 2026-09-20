import assert from "node:assert/strict";
import test from "node:test";

import {
  orchestrateNavigatorResponse,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  prepareConversationTurn,
} from "../../src/lib/navigation/conversation-turn-control.ts";
import {
  createInitialConversationState,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import type {
  ChatSuccessResponse,
  ConversationProfile,
} from "../../src/lib/chat-contract.ts";
import {
  detectDeterministicAcademyContactIntent,
} from "../../src/lib/academy/contact-policy.ts";
import { handleChatRequest } from "../../src/app/api/chat/route.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

const ANNA_VY: ConversationProfile = {
  displayName: "Анна",
  addressMode: "VY",
  nameDeclined: false,
  pendingUserRequest: null,
};

const CONTACT_TEXT = "Как связаться с менеджером Академии?";
const STALE_REFERENCE_PROMPT =
  "Ранее мы обсуждали курс «Иерархия потребностей А. Маслоу: новая парадигма». Вы имеете в виду его?";

function maslowSession(): ConversationState {
  return {
    ...createInitialConversationState(T0),
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
  };
}

/** Reaching the model fails the assertion that must not use it. */
function noModelDependencies() {
  return {
    classifyAct: async () => {
      throw new Error("the act classifier must not run for a deterministic contact turn");
    },
  };
}

test("course contact follow-up bypasses RAG and returns exact manager contact card", async () => {
  let retrievalCalls = 0;

  const result = await orchestrateNavigatorResponse(
    [
      {
        role: "assistant",
        content:
          "Курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow.",
      },
      {
        role: "user",
        content: "С кем я могу обсудить этот курс вживую?",
      },
    ],
    {
      profile: {
        displayName: "Николай",
        addressMode: "VY",
        nameDeclined: false,
        pendingUserRequest: null,
      },
      dependencies: {
        classifyAct: async () => ({
          state: "COURSE_FOLLOW_UP",
          courseId: "maslow",
          evidenceRequested: false,
        }),
        retrieve: async () => {
          retrievalCalls += 1;
          throw new Error("RAG must be bypassed for deterministic contact");
        },
      },
    },
  );

  assert.equal(retrievalCalls, 0);
  assert.equal(result.contactCard?.name, "Алексей Лебедев");
  assert.equal(
    result.contactCard?.telegram.href,
    "https://t.me/LebedevOo",
  );
  assert.equal(
    result.contactCard?.phone.href,
    "tel:+79992600201",
  );
  assert.match(result.message, /09:00–19:00 МСК/u);
});

test("A10: a deterministic contact turn needs no provider call", async () => {
  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Дайте Telegram и телефон Алексея." }],
    { profile: ANNA_VY, dependencies: noModelDependencies() },
  );

  assert.equal(result.contactCard?.name, "Алексей Лебедев");
  assert.equal(result.conversationAct.state, "NAVIGATE");
});

test("A10: a contact request keeps the selected course and creates no new match", async () => {
  const selected = await orchestrateNavigatorResponse(
    [{ role: "user", content: CONTACT_TEXT }],
    {
      profile: ANNA_VY,
      conversationState: maslowSession(),
      dependencies: noModelDependencies(),
    },
  );

  assert.equal(selected.decision, null);
  assert.equal(selected.stateEffects.catalogAuthorityVersion, null);
  assert.equal(selected.stateEffects.pendingConfirmation, null);

  const noMatch = await orchestrateNavigatorResponse(
    [{ role: "user", content: CONTACT_TEXT }],
    {
      profile: ANNA_VY,
      conversationState: {
        ...createInitialConversationState(T0),
        courseMatch: "NO_CURRENT_COURSE_MATCH",
        catalogAuthorityVersion: "2026-09-18",
      },
      dependencies: noModelDependencies(),
    },
  );

  // The no-match state is preserved: a contact request neither creates a fit
  // nor reopens the recommendation, so no routing decision is produced.
  assert.equal(noMatch.decision, null);
  assert.equal(noMatch.contactCard?.name, "Алексей Лебедев");
});

test("A10: an outstanding handoff offer is preserved, not auto-accepted", async () => {
  const offered = {
    ...createInitialConversationState(T0),
    handoff: { status: "OFFERED" as const, reason: "FRUSTRATION" as const, context: null },
  };

  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: CONTACT_TEXT }],
    {
      profile: ANNA_VY,
      conversationState: offered,
      dependencies: noModelDependencies(),
    },
  );

  assert.equal(result.contactCard?.name, "Алексей Лебедев");
  assert.equal(result.conversationAct.state, "NAVIGATE");
});

test("A10: an open confirmation outranks contact and is not consumed", async () => {
  const pending: ConversationState = {
    ...maslowSession(),
    pendingConfirmation: {
      confirmationKey: "stale-course:maslow",
      kind: "STALE_COURSE_REFERENCE",
      prompt: STALE_REFERENCE_PROMPT,
      candidateCourseId: "maslow",
    },
  };

  // The kernel answers the confirmation, preserves it, and only queues the
  // contact text as a bounded remainder.
  const kernel = prepareConversationTurn(
    [{ role: "user", content: CONTACT_TEXT }],
    ANNA_VY,
    { conversationState: pending, nowMs: T0 },
  );

  assert.equal(kernel.state, "RESPOND");
  if (kernel.state !== "RESPOND") return;
  assert.equal(kernel.message.includes(STALE_REFERENCE_PROMPT), true);
  assert.equal(kernel.conversationState.pendingConfirmation?.confirmationKey, "stale-course:maslow");
  assert.equal(kernel.conversationState.selectedCourseId, "maslow");
  // The bounded capture is clause-normalized, so the queued value drops the
  // sentence-final punctuation; the request itself is preserved verbatim.
  assert.equal(
    kernel.conversationState.deferredRequest,
    "Как связаться с менеджером Академии",
  );

  // Defence in depth: even if the orchestrator is reached with a confirmation
  // still open, the deterministic pre-route shortcut refuses. The reported act
  // is the classifier's own decision, which is the structural proof that the
  // shortcut did not fire; the answer that follows belongs to the pre-existing
  // post-classification lane, whose Package-A/B behaviour is not changed here.
  let classified = 0;
  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: CONTACT_TEXT }],
    {
      profile: ANNA_VY,
      conversationState: pending,
      dependencies: {
        classifyAct: async () => {
          classified += 1;
          return { state: "META" };
        },
      },
    },
  );

  assert.equal(classified, 1);
  assert.equal(result.conversationAct.state, "META");
});

test("A10: a promoted remainder keeps ordinary routing and is not lost", async () => {
  const confirmationResolved = prepareConversationTurn(
    [{ role: "user", content: "нет" }],
    ANNA_VY,
    {
      conversationState: {
        ...maslowSession(),
        pendingConfirmation: {
          confirmationKey: "stale-course:maslow",
          kind: "STALE_COURSE_REFERENCE",
          prompt: STALE_REFERENCE_PROMPT,
          candidateCourseId: "maslow",
        },
        deferredRequest: CONTACT_TEXT,
      },
      nowMs: T0,
    },
  );

  assert.equal(confirmationResolved.state, "RESPOND");
  if (confirmationResolved.state !== "RESPOND") return;
  assert.equal(confirmationResolved.conversationState.pendingConfirmation, null);
  // The preserved request survives the resolution instead of being consumed.
  assert.equal(confirmationResolved.conversationState.deferredRequest, CONTACT_TEXT);

  const promoted = prepareConversationTurn(
    [{ role: "user", content: "спасибо" }],
    ANNA_VY,
    { conversationState: confirmationResolved.conversationState, nowMs: T0 },
  );

  assert.equal(promoted.state, "ROUTE");
  if (promoted.state !== "ROUTE") return;
  assert.equal(
    promoted.messages.at(-1)?.content,
    `${CONTACT_TEXT}\nспасибо`,
  );

  // The kernel-effective request is mixed, so the deterministic pre-route
  // shortcut must not fire: the act classifier is consulted and the turn keeps
  // the ordinary routing path. The reported act proves which lane answered —
  // the classifier's own decision, not the shortcut's synthetic one.
  let classified = 0;
  const result = await orchestrateNavigatorResponse(promoted.messages, {
    profile: promoted.profile,
    conversationState: promoted.conversationState,
    dependencies: {
      classifyAct: async () => {
        classified += 1;
        return { state: "OUT_OF_SCOPE" };
      },
    },
  });

  assert.equal(classified, 1);
  assert.equal(result.conversationAct.state, "OUT_OF_SCOPE");
});

test("A10: a contact turn after a technical failure succeeds and clears the marker", async () => {
  const previouslyFailed: ConversationState = {
    ...createInitialConversationState(T0),
    lastTechnicalError: {
      failureClass: "PROVIDER_UNAVAILABLE",
      occurredAt: new Date(T0 - 60_000).toISOString(),
      retryable: true,
      stage: "ACT_ROUTER",
    },
  };

  const response = await handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: CONTACT_TEXT }],
        profile: ANNA_VY,
        conversationState: previouslyFailed,
        requestId: "corr2-d-after-failure",
      }),
    }),
  );

  const body = (await response.json()) as ChatSuccessResponse;

  // The new turn is a new kernel cycle, and the deterministic contact lane
  // answers it without a provider call; the completed turn supersedes the
  // recorded failure marker exactly as any other successful turn does.
  assert.equal(response.status, 200);
  assert.equal(body.contactCard?.name, "Алексей Лебедев");
  assert.equal(body.conversationState.lastTechnicalError, null);
  assert.equal(body.conversationState.execution.phase, "IDLE");
  assert.equal(body.conversationState.execution.lastCompletedRequestId, "corr2-d-after-failure");
});

test("A10 (IV1-D-F1): relational course questions are never consumed by the deterministic shortcut", async () => {
  const relationalTurns = [
    "Как курс связан с психологией?",
    "Чем связаны между собой темы курса?",
  ];

  for (const query of relationalTurns) {
    let classified = 0;

    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      {
        profile: ANNA_VY,
        conversationState: maslowSession(),
        dependencies: {
          classifyAct: async () => {
            classified += 1;
            return {
              state: "COURSE_FOLLOW_UP",
              courseId: "maslow",
              evidenceRequested: false,
            };
          },
          retrieve: async () => ({
            hasActiveSources: false,
            bindings: [],
            matches: [],
          }),
        },
      },
    );

    // The classifier is reached and the reported act is its own decision, which
    // is the structural proof that the pre-route contact shortcut refused.
    assert.equal(classified, 1, query);
    assert.equal(result.conversationAct.state, "COURSE_FOLLOW_UP", query);
    assert.equal(result.contactCard, null, query);

    // The answer is the course lane's own, not a contact answer: a contact
    // answer opens with one of these channel lines, and the course answer never
    // does. (The course answer may still *mention* canonical contact facts in
    // its factual-ceiling paragraph, which is its own verified behaviour.)
    assert.doesNotMatch(
      result.message,
      /^(?:Если нужен быстрый письменный ответ|Для живого общения)/u,
      query,
    );
    assert.match(
      result.message,
      /нет достаточного основания|Подтверждённые публичные учебные результаты|подключённом материале/u,
      query,
    );
  }
});

test("A10 (IV1-D-F2/M1): role, support and question prose reaches the classifier end to end", async () => {
  const ordinaryTurns = [
    "Курс для менеджеров",
    "Роль куратора в обучении",
    "Можно спросить, как устроен курс?",
    "Какой курс подходит менеджерам?",
    "Есть ли курс для менеджеров?",
    "Кто такой куратор курса?",
    "В курсе есть поддержка преподавателя?",
  ];

  for (const query of ordinaryTurns) {
    let classified = 0;

    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      {
        profile: ANNA_VY,
        conversationState: maslowSession(),
        dependencies: {
          classifyAct: async () => {
            classified += 1;
            return { state: "META" };
          },
        },
      },
    );

    // The classifier ran, so the deterministic shortcut did not consume the
    // turn, and the reported act is the classifier's own decision — which is the
    // structural proof that no synthetic contact act was produced instead.
    assert.equal(classified, 1, query);
    assert.equal(result.conversationAct.state, "META", query);
    assert.equal(result.contactCard, null, query);
    assert.doesNotMatch(
      result.message,
      /^(?:Если нужен быстрый письменный ответ|Для живого общения)/u,
      query,
    );
  }
});

test("A10 (IV1-D-F2/M1): COURSE_FOLLOW_UP does not turn question or support prose into contact", async () => {
  const postClassificationTurns = [
    "Поддержка мотивации",
    "Хочу задать вопрос о Маслоу",
    "Можно спросить про уровни Маслоу?",
  ];

  for (const query of postClassificationTurns) {
    let classified = 0;

    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      {
        profile: ANNA_VY,
        conversationState: maslowSession(),
        dependencies: {
          classifyAct: async () => {
            classified += 1;
            return {
              state: "COURSE_FOLLOW_UP",
              courseId: "maslow",
              evidenceRequested: false,
            };
          },
          retrieve: async () => ({
            hasActiveSources: false,
            bindings: [],
            matches: [],
          }),
        },
      },
    );

    // The course-context flag is what the post-classification detector sees
    // here, and it must not convert this prose: the answer is the course lane's
    // own and no contact card is introduced.
    assert.equal(classified, 1, query);
    assert.equal(result.conversationAct.state, "COURSE_FOLLOW_UP", query);
    assert.equal(result.contactCard, null, query);
    assert.doesNotMatch(
      result.message,
      /^(?:Если нужен быстрый письменный ответ|Для живого общения)/u,
      query,
    );
    assert.match(
      result.message,
      /нет достаточного основания|Подтверждённые публичные учебные результаты|подключённом материале/u,
      query,
    );
  }
});

test("A10 (IV1-D-F2/M1): canonical contact requests stay deterministic with canonical authority", async () => {
  const deterministicRequests = [
    "Как связаться с менеджером Академии?",
    "Дайте Telegram и телефон Алексея.",
    "Можно позвонить менеджеру?",
    "Дайте контакты Академии.",
  ];

  for (const query of deterministicRequests) {
    // Reaching the model fails the test: these turns need no classifier call.
    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      { profile: ANNA_VY, dependencies: noModelDependencies() },
    );

    assert.equal(result.contactCard?.name, "Алексей Лебедев", query);
    assert.equal(
      result.contactCard?.telegram.href,
      "https://t.me/LebedevOo",
      query,
    );
    assert.equal(result.contactCard?.phone.href, "tel:+79992600201", query);
    assert.match(result.message, /09:00–19:00 МСК/u, query);
  }

  // A bare photo follow-up continues the contact surface only when the
  // structured state recorded that surface; the wording of no prior answer is
  // consulted, only the stored act.
  const inContactSurface = await orchestrateNavigatorResponse(
    [{ role: "user", content: "А фото?" }],
    {
      profile: ANNA_VY,
      conversationState: {
        ...maslowSession(),
        lastAssistant: {
          act: "ACADEMY_CONTACT",
          content: "Ответ с контактами Академии.",
          courseId: null,
        },
      },
      dependencies: noModelDependencies(),
    },
  );

  assert.equal(inContactSurface.contactCard?.name, "Алексей Лебедев");

  let classified = 0;
  const withoutContactSurface = await orchestrateNavigatorResponse(
    [{ role: "user", content: "А фото?" }],
    {
      profile: ANNA_VY,
      conversationState: maslowSession(),
      dependencies: {
        classifyAct: async () => {
          classified += 1;
          return { state: "META" };
        },
      },
    },
  );

  assert.equal(classified, 1);
  assert.equal(withoutContactSurface.contactCard, null);
});

test("A10/A23 (IV1-D-F1): a human request stays in the Package-B handoff lane", async () => {
  const humanRequests = [
    "Хочу поговорить с человеком",
    "Можно поговорить с человеком?",
    "Соедините меня с человеком",
  ];

  for (const humanRequest of humanRequests) {
    // The detector does not claim it as an ordinary contact request...
    assert.equal(detectDeterministicAcademyContactIntent(humanRequest), null, humanRequest);

    // ...because the kernel owns it: the turn is answered by the handoff lane.
    const kernel = prepareConversationTurn(
      [{ role: "user", content: humanRequest }],
      ANNA_VY,
      { conversationState: maslowSession(), nowMs: T0 },
    );

    assert.equal(kernel.state, "RESPOND", humanRequest);
    if (kernel.state !== "RESPOND") return;
    assert.equal(kernel.act, "HANDOFF_READY", humanRequest);
    assert.equal(kernel.conversationState.handoff.status, "READY", humanRequest);
    assert.doesNotMatch(kernel.message, /быстр|@LebedevOo.*@AST_rulang/u, humanRequest);
  }
});

test("A10: an ordinary course question containing 'человек' keeps its educational lane", async () => {
  let classified = 0;

  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Как курс помогает понимать другого человека?" }],
    {
      profile: ANNA_VY,
      conversationState: maslowSession(),
      dependencies: {
        classifyAct: async () => {
          classified += 1;
          return { state: "NAVIGATE" };
        },
        route: async () => ({
          state: "ASK_MORE",
          candidateCourseIds: ["maslow"],
          questions: ["Что именно важно понять?"],
          rationale: "Нужно уточнение.",
        }),
        compose: async () => "Уточните, пожалуйста, что именно важно понять.",
      },
    },
  );

  assert.equal(classified, 1);
  assert.equal(result.contactCard, null);
  assert.doesNotMatch(result.message, /Алексею Лебедеву|t\.me\/LebedevOo/u);
});

test("A10 (IV1-D-M1/R1): an about-person question reaches the classifier end to end", async () => {
  const aboutTurns = [
    // The two independently proven M-1 failures.
    "Хочу спросить про Алексея Лебедева",
    "Можно задать вопрос про работу менеджера?",
    // The same construction across a longer describing span.
    "Можно спросить про нашего куратора?",
    "Хочу задать вопрос о менеджере Академии",
  ];

  for (const query of aboutTurns) {
    let classified = 0;

    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      {
        profile: ANNA_VY,
        conversationState: maslowSession(),
        dependencies: {
          classifyAct: async () => {
            classified += 1;
            return { state: "META" };
          },
        },
      },
    );

    // The classifier ran, so the deterministic shortcut did not consume the
    // turn, and the reported act is the classifier's own decision — the
    // structural proof that no synthetic contact act was produced instead.
    assert.equal(classified, 1, query);
    assert.equal(result.conversationAct.state, "META", query);
    assert.equal(result.contactCard, null, query);

    // And no contact value is injected by the shortcut either: neither the
    // manager's own channels nor the Academy's fast written chat appears in the
    // answer that the user receives.
    assert.doesNotMatch(
      result.message,
      /LebedevOo|260-02-01|t\.me|Алексею Лебедеву|быстрый письменный ответ/u,
      query,
    );
  }
});

test("A10 (IV1-D-M1/R1): a directed question keeps the deterministic contact lane", async () => {
  const directedTurns = [
    "Можно спросить у Алексея?",
    "Можно задать вопрос менеджеру Академии?",
  ];

  for (const query of directedTurns) {
    // Reaching the model fails the test: the shortcut answers without it.
    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      { profile: ANNA_VY, dependencies: noModelDependencies() },
    );

    assert.equal(result.contactCard?.name, "Алексей Лебедев", query);
    assert.equal(
      result.contactCard?.telegram.href,
      "https://t.me/LebedevOo",
      query,
    );
    assert.equal(result.contactCard?.phone.href, "tel:+79992600201", query);
    assert.equal(result.conversationAct.state, "NAVIGATE", query);
    assert.match(result.message, /09:00–19:00 МСК/u, query);
  }
});

test("A10 (D-R1-F1): a long about-frame reaches the classifier end to end", async () => {
  const longSpanAboutTurns = [
    // Eleven words between "про" and the person it governs.
    "Хочу спросить про работу с руководителями крупных международных команд в период организационных изменений менеджера",
    // A second person class, at the same distance.
    "Хочу спросить про особенности взаимодействия преподавателя с участниками программы на разных этапах обучения куратора",
    // A long frame that would otherwise be read as directed because it names the
    // manager by name.
    "Хочу спросить про особенности найма и адаптации новых сотрудников в крупных распределённых командах Алексея",
  ];

  for (const query of longSpanAboutTurns) {
    let classified = 0;

    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      {
        profile: ANNA_VY,
        conversationState: maslowSession(),
        dependencies: {
          classifyAct: async () => {
            classified += 1;
            return { state: "META" };
          },
        },
      },
    );

    // The classifier ran, so the shortcut did not consume the turn, and the
    // reported act is the classifier's own decision.
    assert.equal(classified, 1, query);
    assert.equal(result.conversationAct.state, "META", query);
    assert.equal(result.contactCard, null, query);
    assert.doesNotMatch(
      result.message,
      /LebedevOo|260-02-01|t\.me|Алексею Лебедеву|быстрый письменный ответ/u,
      query,
    );
  }
});

test("A10 (D-R3-F1): a governed dative reaches the classifier end to end", async () => {
  // The person is dative here because "к" governs them, not because a question
  // is given to them. The shortcut must refuse, or the user receives the
  // manager's card for a question that was only about requirements and trust.
  const governedTurns = [
    "Можно задать вопрос о требованиях к менеджеру?",
    "Хочу задать вопрос о доверии к куратору.",
    "Можно задать вопрос об отношении команды к Алексею?",
    // The topic preposition reaches the person here: nothing stands between.
    "Можно задать вопрос по требованиям к менеджеру?",
    "Можно задать вопрос по менеджеру?",
    // The colleague has taken the "у" phrase; the role after it is not addressed.
    "Можно спросить у коллеги мнение менеджера?",
    "Хочу спросить у преподавателя мнение куратора?",
  ];

  for (const query of governedTurns) {
    let classified = 0;

    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      {
        profile: ANNA_VY,
        conversationState: maslowSession(),
        dependencies: {
          classifyAct: async () => {
            classified += 1;
            return { state: "META" };
          },
        },
      },
    );

    // The classifier ran, so the shortcut did not consume the turn, and the
    // reported act is the classifier's own decision.
    assert.equal(classified, 1, query);
    assert.equal(result.conversationAct.state, "META", query);
    assert.equal(result.contactCard, null, query);
    assert.doesNotMatch(
      result.message,
      /LebedevOo|260-02-01|t\.me|Алексею Лебедеву|быстрый письменный ответ/u,
      query,
    );
  }
});

test("A10 (D-R2-F1): a topic plus an addressee answers without the model", async () => {
  // A question that names both what it asks about and whom it asks is a directed
  // human-contact request: the deterministic lane consumes it, and the values it
  // answers with are the canonical Academy manager's, invented nowhere.
  const topicWithAddresseeTurns = [
    "Хочу спросить про курс у Алексея",
    "Можно задать вопрос менеджеру про оплату?",
    // The recipient stands in front of its topic and nothing governs it.
    "Можно задать вопрос менеджеру о требованиях?",
    // The topic preposition is already satisfied, so the dative is the recipient.
    "Можно задать вопрос по оплате менеджеру?",
    // An unbroken "у" phrase still reaches its addressee across its modifiers.
    "Можно спросить у нашего менеджера?",
    // A long topic span between the question and its addressee changes nothing.
    "Хочу спросить про особенности взаимодействия преподавателя с участниками программы на разных этапах обучения у куратора",
  ];

  for (const query of topicWithAddresseeTurns) {
    let classified = 0;

    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      {
        profile: ANNA_VY,
        dependencies: {
          classifyAct: async () => {
            classified += 1;
            throw new Error(
              "the act classifier must not run for a deterministic contact turn",
            );
          },
        },
      },
    );

    // The classifier never ran: the shortcut owns the turn.
    assert.equal(classified, 0, query);
    assert.equal(result.conversationAct.state, "NAVIGATE", query);

    // Only the canonical Academy manager authority is exposed, and a curator
    // request is answered by that manager under his own role — no curator
    // identity, handle or number is asserted anywhere.
    assert.equal(result.contactCard?.name, "Алексей Лебедев", query);
    assert.equal(result.contactCard?.role, "Менеджер Академии", query);
    assert.equal(
      result.contactCard?.telegram.href,
      "https://t.me/LebedevOo",
      query,
    );
    assert.equal(result.contactCard?.phone.href, "tel:+79992600201", query);
    assert.equal(
      result.contactCard?.imageUrl,
      "/academy/alexey-lebedev.png",
      query,
    );
    assert.match(result.message, /09:00–19:00 МСК/u, query);
    assert.match(result.message, /менеджеру Академии Алексею Лебедеву/u, query);
  }
});

test("A10 (D-R1-F1): the restored directed forms still answer without the model", async () => {
  const directedTurns = [
    "Можно спросить у нашего куратора?",
    "Можно спросить у Алексея?",
  ];

  for (const query of directedTurns) {
    // Reaching the model fails the test: the shortcut answers without it.
    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      { profile: ANNA_VY, dependencies: noModelDependencies() },
    );

    assert.equal(result.contactCard?.name, "Алексей Лебедев", query);
    assert.equal(
      result.contactCard?.telegram.href,
      "https://t.me/LebedevOo",
      query,
    );
    assert.equal(result.conversationAct.state, "NAVIGATE", query);
  }
});
