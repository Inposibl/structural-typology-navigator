/**
 * NAVIGATOR-CONVERSATION-ENTRY-SIMPLIFICATION-1 — new entry regression matrix.
 *
 * Owner decision (2026-10-20): mandatory name and address-mode setup is
 * superseded. A new conversation opens with the Owner-approved welcome, the
 * Navigator addresses the user on respectful «вы» by default, and the first
 * substantive message enters the accepted routing pipeline immediately.
 *
 * Every handler-level test drives the real `handleChatRequest`, the real
 * control kernel, the real act-decision validator and the real orchestration;
 * only provider-backed dependencies are injected. Any network access throws,
 * so no live model, retrieval or Production request can be made.
 */

import assert from "node:assert/strict";
import test, { after, mock } from "node:test";

import type {
  ConversationMessage,
  ConversationProfile,
} from "../../src/lib/chat-contract.ts";
import {
  handleChatRequest,
  type ChatRouteDependencies,
} from "../../src/app/api/chat/route.ts";
import { orchestrateNavigatorResponse } from "../../src/lib/navigation/orchestrate-navigation.ts";
import { routeConversationAct } from "../../src/lib/navigation/conversation-act-router.ts";
import { NavigatorStageError } from "../../src/lib/navigation/navigator-observability.ts";
import * as profileApi from "../../src/lib/navigation/conversation-profile.ts";
import {
  INITIAL_ADDRESS_PROMPT,
  isConversationProfileComplete,
  normalizeConversationProfilePayload,
} from "../../src/lib/navigation/conversation-profile.ts";
import { applyConversationControlKernel } from "../../src/lib/navigation/conversation-control-kernel.ts";
import {
  createInitialConversationState,
  systemSessionClock,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import { createEmbeddedNavigatorProfile } from "../../src/app/tikhon-miniapp-pilot/helpers.ts";
import { ACADEMY_COURSES } from "../../src/lib/academy/course-catalog.ts";

const T0 = Date.parse("2026-10-20T12:00:00.000Z");
// The route reads systemSessionClock; the suite clock is pinned so every
// timestamp in the fixtures is deterministic. Restored after the file.
mock.method(systemSessionClock, "now", () => T0);
after(() => {
  mock.restoreAll();
});

/** Owner-accepted welcome, written out literally: the test is the oracle. */
const OWNER_WELCOME =
  "Здравствуйте! Я — Навигатор Академии структурной типологии.\n" +
  "Помогу разобраться в образовательных программах, формате и условиях обучения, а также выбрать подходящий курс.\n" +
  "С чего вы хотели бы начать?";

/** Anonymous respectful-«вы» conversation (accepted Tikhon precedent). */
const DEFAULT_PROFILE: ConversationProfile = {
  displayName: null,
  addressMode: "VY",
  nameDeclined: true,
  pendingUserRequest: null,
};

/** What a pre-simplification client holds before setup: the old empty profile. */
const EMPTY_LEGACY_PROFILE: ConversationProfile = {
  displayName: null,
  addressMode: null,
  nameDeclined: false,
  pendingUserRequest: null,
};

/** Any wording that asks the user for a name or an address-mode choice. */
const SETUP_QUESTION =
  /как\s+к\s+вам\s+обращаться|как\s+вас\s+(?:называть|зовут)|как\s+тебя\s+(?:называть|зовут)|на\s+«ты»\s+или\s+на\s+«вы»|«ты»\s+или\s+«вы»|напишите\s+имя|если\s+не\s+хотите\s+указывать\s+имя|прежде\s+чем\s+начн[её]м/iu;

const PRICE_AMOUNT = /\d[\d\s]*(?:₽|руб)/iu;
const PAYMENT_LINK = /AST_payment_course_bot|\?start=/iu;
const INVENTED_ENROLLMENT = /набор\s+открыт|открыт\s+набор|осталось\s+\d+\s+мест|ближайший\s+поток\s+стартует/iu;

type Decide = (latest: string) => unknown;

type Probe = {
  orchestrateCalls: number;
  orchestratedMessages: ConversationMessage[][];
  classifierInputs: string[];
  retrieved: string[];
  planCalls: number;
  composeCalls: number;
  networkCalls: number;
};

function newProbe(): Probe {
  return {
    orchestrateCalls: 0,
    orchestratedMessages: [],
    classifierInputs: [],
    retrieved: [],
    planCalls: 0,
    composeCalls: 0,
    networkCalls: 0,
  };
}

/** Real orchestration; only provider-backed seams are injected. */
function stubbedProviders(decide: Decide, probe: Probe): ChatRouteDependencies {
  return {
    orchestrate: (messages, options) => {
      probe.orchestrateCalls += 1;
      probe.orchestratedMessages.push(messages.map((message) => ({ ...message })));
      return orchestrateNavigatorResponse(messages, {
        ...options,
        fetch: async () => {
          probe.networkCalls += 1;
          throw new Error("network access is forbidden in this suite");
        },
        dependencies: {
          classifyAct: async (effective) => {
            const latest = effective.at(-1)?.content ?? "";
            probe.classifierInputs.push(latest);
            return routeConversationAct(effective, {
              callJson: async () => decide(latest),
            });
          },
          route: async () => {
            throw new Error("selection router was not expected");
          },
          retrieve: async (courseId) => {
            probe.retrieved.push(courseId);
            return { hasActiveSources: true, bindings: [], matches: [] };
          },
          resolve: () => [],
          compose: async () => {
            probe.composeCalls += 1;
            return "STUB COMPOSE";
          },
          composeFollowUp: async (_messages, _act, composeOptions) => {
            probe.composeCalls += 1;
            composeOptions.onOutcome?.({ answerOrigin: "RAG_EVIDENCE", fallback: "NONE" });
            return "STUB FOLLOW-UP";
          },
          extractPlan: async () => {
            probe.planCalls += 1;
            throw new Error("task-plan extraction was not expected");
          },
        },
      });
    },
  };
}

function retryableFailure(probe: Probe): ChatRouteDependencies {
  return {
    orchestrate: (messages) => {
      probe.orchestrateCalls += 1;
      probe.orchestratedMessages.push(messages.map((message) => ({ ...message })));
      return Promise.reject(
        new NavigatorStageError(
          "COURSE_RPC",
          Object.assign(new Error("rpc"), { code: "RPC_UNAVAILABLE" }),
        ),
      );
    },
  };
}

type ChatBody = {
  messages: ConversationMessage[];
  profile: ConversationProfile;
  conversationState: ConversationState | null;
  requestId: string;
};

type SuccessPayload = {
  message: string;
  profile: ConversationProfile;
  conversationState: ConversationState;
  contactCard: unknown;
  resetConversation: boolean;
};

async function post(
  body: ChatBody,
  dependencies?: ChatRouteDependencies,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const info = console.info;
  const error = console.error;
  console.info = () => undefined;
  console.error = () => undefined;
  try {
    const response = await handleChatRequest(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      dependencies,
    );
    return {
      status: response.status,
      json: (await response.json()) as Record<string, unknown>,
    };
  } finally {
    console.info = info;
    console.error = error;
  }
}

async function postOk(
  body: ChatBody,
  dependencies?: ChatRouteDependencies,
): Promise<SuccessPayload> {
  const result = await post(body, dependencies);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  return result.json as unknown as SuccessPayload;
}

function firstTurn(
  content: string,
  profile: ConversationProfile = DEFAULT_PROFILE,
  requestId = "entry-first-1",
): ChatBody {
  return {
    messages: [{ role: "user", content }],
    profile,
    conversationState: null,
    requestId,
  };
}

/** Trailing punctuation is trimmed from the routed request by the kernel. */
function routed(content: string): string {
  return content.replace(/[\s,.;:!?—–-]+$/u, "");
}

function assertNoSetup(payload: SuccessPayload, label: string): void {
  assert.doesNotMatch(payload.message, SETUP_QUESTION, label);
  assert.equal(payload.message.includes(INITIAL_ADDRESS_PROMPT), false, label);
  assert.equal(payload.message.includes(OWNER_WELCOME), false, label);
  assert.notEqual(payload.conversationState.lastAssistant?.act, "ADDRESS_SETUP", label);
  assert.ok(isConversationProfileComplete(payload.profile), label);
}

const CATALOG_LIST: Decide = () => ({ state: "FACTUAL", intents: [{ kind: "CATALOG_LIST" }] });
const ACADEMY_OVERVIEW: Decide = () => ({ state: "FACTUAL", intents: [{ kind: "ACADEMY_OVERVIEW" }] });
const PRICE_UNSELECTED: Decide = () => ({
  state: "FACTUAL",
  intents: [{ kind: "CURRENT_METADATA", courseIds: [], fields: ["PRICE"], scope: "SELECTED" }],
});
const FOLLOW_UP = (courseId: string): Decide => () => ({
  state: "COURSE_FOLLOW_UP",
  courseId,
  evidenceRequested: false,
});
const CONTENT = (courseId: string): Decide => (latest) => ({
  state: "COURSE_CONTENT",
  courseId,
  evidenceRequested: false,
  contentIntentEvidence: latest.slice(0, 240),
});

/* ------------------------------------------------------------------------ *
 * Default profile and entry resolution
 * ------------------------------------------------------------------------ */

test("default profile: anonymous «вы», complete, valid at the API boundary, equal to the accepted Tikhon profile", () => {
  const created = profileApi.createDefaultConversationProfile();
  assert.deepEqual(created, DEFAULT_PROFILE);
  assert.deepEqual(normalizeConversationProfilePayload(created), DEFAULT_PROFILE);
  assert.equal(isConversationProfileComplete(created), true);
  assert.deepEqual(createEmbeddedNavigatorProfile(), created);
  // A fresh object each call, so no caller can mutate a shared default.
  assert.notEqual(profileApi.createDefaultConversationProfile(), created);
});

test("welcome constant is exactly the Owner-approved text", () => {
  assert.equal(profileApi.NAVIGATOR_WELCOME_MESSAGE, OWNER_WELCOME);
  assert.doesNotMatch(profileApi.NAVIGATOR_WELCOME_MESSAGE, SETUP_QUESTION);
});

test("entry resolution: every valid profile shape becomes a complete profile; only legacy pending text is carried out", () => {
  const names = [null, "Анна"] as const;
  const modes = [null, "TY", "VY"] as const;
  const declinedValues = [false, true] as const;
  const pendings = [null, "Подберите курс по мотивации"] as const;
  let checked = 0;

  for (const displayName of names) {
    for (const addressMode of modes) {
      for (const nameDeclined of declinedValues) {
        for (const pendingUserRequest of pendings) {
          const input = { displayName, addressMode, nameDeclined, pendingUserRequest };
          let valid: ConversationProfile;
          try {
            valid = normalizeConversationProfilePayload(input);
          } catch {
            continue; // the API boundary never lets this shape reach the kernel
          }
          checked += 1;
          const label = JSON.stringify(valid);
          const entry = profileApi.resolveConversationEntryProfile(valid);

          assert.equal(isConversationProfileComplete(entry.profile), true, label);
          assert.equal(entry.profile.pendingUserRequest, null, label);
          assert.deepEqual(normalizeConversationProfilePayload(entry.profile), entry.profile, label);
          // Explicit choices survive; only a missing mode defaults to «вы».
          assert.equal(entry.profile.addressMode, valid.addressMode ?? "VY", label);
          assert.equal(entry.profile.displayName, valid.displayName, label);
          assert.equal(entry.profile.nameDeclined, valid.displayName === null, label);

          if (isConversationProfileComplete(valid)) {
            assert.deepEqual(entry.profile, valid, label);
            assert.equal(entry.legacyPendingRequest, null, label);
          } else {
            assert.equal(entry.legacyPendingRequest, valid.pendingUserRequest, label);
          }
        }
      }
    }
  }

  assert.equal(checked, 14);
});

/* ------------------------------------------------------------------------ *
 * E2–E5 — first substantive message routes immediately
 * ------------------------------------------------------------------------ */

test("E2: the first educational question is routed immediately, on «вы», with no name capture", async () => {
  const question = "Какие образовательные программы предлагает Академия?";
  const probe = newProbe();
  const payload = await postOk(firstTurn(question), stubbedProviders(CATALOG_LIST, probe));

  assertNoSetup(payload, "E2");
  assert.equal(probe.orchestrateCalls, 1);
  assert.deepEqual(probe.classifierInputs, [routed(question)]);
  // Exactly the one user message: no welcome or synthetic history was sent.
  assert.deepEqual(probe.orchestratedMessages[0], [{ role: "user", content: routed(question) }]);
  assert.deepEqual(payload.profile, DEFAULT_PROFILE);
  assert.equal(payload.conversationState.lastAssistant?.act, "FACTUAL");
  assert.match(payload.message, /^Каталог Академии/u);
  for (const course of ACADEMY_COURSES) {
    assert.ok(payload.message.includes(course.title), course.title);
  }
  assert.equal(payload.conversationState.execution.lastCompletedRequestId, "entry-first-1");
  assert.equal(probe.planCalls, 0);
  assert.equal(probe.networkCalls, 0);
});

test("E3: the first commercial question reaches the accepted commercial authority without a profile gate or invented terms", async () => {
  const question = "Сколько стоит обучение?";
  const probe = newProbe();
  const payload = await postOk(firstTurn(question), stubbedProviders(PRICE_UNSELECTED, probe));

  assertNoSetup(payload, "E3");
  assert.deepEqual(probe.classifierInputs, [routed(question)]);
  assert.equal(payload.conversationState.lastAssistant?.act, "FACTUAL");
  assert.deepEqual(probe.retrieved, []);
  // No course is named or selected, so no price can be stated.
  assert.match(payload.message, /Уточните, пожалуйста, название курса/u);
  assert.doesNotMatch(payload.message, PRICE_AMOUNT);
  assert.doesNotMatch(payload.message, PAYMENT_LINK);
  assert.doesNotMatch(payload.message, INVENTED_ENROLLMENT);
  assert.equal(payload.conversationState.selectedCourseId, null);
  assert.equal(probe.networkCalls, 0);
});

test("E4: the first course-specific question goes straight to the accepted course evidence path", async () => {
  const question = "Что изучают на курсе Маслоу?";
  const probe = newProbe();
  const payload = await postOk(firstTurn(question), stubbedProviders(CONTENT("maslow"), probe));

  assertNoSetup(payload, "E4");
  assert.deepEqual(probe.classifierInputs, [routed(question)]);
  assert.deepEqual(probe.retrieved, ["maslow"]);
  assert.equal(payload.conversationState.lastAssistant?.act, "COURSE_FOLLOW_UP");
  assert.equal(payload.message, "STUB FOLLOW-UP");
  assert.deepEqual(payload.profile, DEFAULT_PROFILE);
  assert.equal(probe.networkCalls, 0);
});

test("E5: a short first question is routed as the question and never stored as a name", async () => {
  for (const profile of [DEFAULT_PROFILE, EMPTY_LEGACY_PROFILE]) {
    const question = "Курсы онлайн?";
    const probe = newProbe();
    const payload = await postOk(firstTurn(question, profile), stubbedProviders(ACADEMY_OVERVIEW, probe));
    const label = `E5 ${JSON.stringify(profile)}`;

    assertNoSetup(payload, label);
    assert.deepEqual(probe.classifierInputs, [routed(question)], label);
    assert.equal(payload.profile.displayName, null, label);
    assert.equal(payload.profile.pendingUserRequest, null, label);
    assert.deepEqual(payload.profile, DEFAULT_PROFILE, label);
  }
});

test("E5/historical: the exact Production-smoke opening is routed and never becomes a display name", async () => {
  const question =
    "Здравствуйте. Какие образовательные программы предлагает Академия структурной типологии?";
  for (const profile of [DEFAULT_PROFILE, EMPTY_LEGACY_PROFILE]) {
    const probe = newProbe();
    const payload = await postOk(firstTurn(question, profile), stubbedProviders(CATALOG_LIST, probe));
    const label = `smoke ${JSON.stringify(profile)}`;

    assertNoSetup(payload, label);
    assert.equal(probe.orchestrateCalls, 1, label);
    assert.ok(probe.classifierInputs[0]?.includes("Какие образовательные программы"), label);
    assert.equal(payload.profile.displayName, null, label);
    assert.doesNotMatch(payload.message, /^Спасибо,/u, label);
    assert.match(payload.message, /^Каталог Академии/u, label);
  }
});

test("no name inference: ordinary first messages always route and leave the profile anonymous", () => {
  const ordinary = [
    "Какие курсы есть?",
    "Курсы онлайн?",
    "Расскажите про Академию",
    "Маслоу?",
    "Нормативная ситуация",
    "Здравствуйте",
    "Добрый день, подскажите расписание",
    "Анна",
    "Иван Петрович",
    "Доктор Кто",
    "Кто ведёт курсы?",
    "Сколько длится обучение?",
    "Есть ли сертификат?",
    "Можно ли учиться без опыта?",
    "Хочу разобраться в типологии",
    "Мне нужен курс про мотивацию",
    "Подберите курс",
    "Как проходят занятия",
    "Что такое структурная типология?",
    "Где посмотреть программу курса?",
    "Я Анна",
    "без имени",
    "Меня зовут Анна. Какие курсы есть?",
    "Здравствуйте! Сколько стоит курс Маслоу?",
    "Привет",
    "ок",
  ];

  for (const profile of [DEFAULT_PROFILE, EMPTY_LEGACY_PROFILE]) {
    for (const text of ordinary) {
      const label = `${text} / ${JSON.stringify(profile)}`;
      const result = applyConversationControlKernel({
        profile,
        conversationState: createInitialConversationState(T0),
        userText: text,
        nowMs: T0,
        requestId: "entry-ordinary",
      });

      assert.equal(result.state, "ROUTE", label);
      assert.deepEqual(result.profile, DEFAULT_PROFILE, label);
      assert.equal(result.conversationState.deferredRequest, null, label);
    }
  }
});

test("no setup lane: legacy setup-shaped input on an empty profile never yields ADDRESS_SETUP or a setup prompt", () => {
  const setupShaped = [
    "Анна",
    "на вы",
    "на ты",
    "ты",
    "вы",
    "без имени",
    "без имени, на «вы».",
    "Меня зовут Анна",
    "Меня зовут Анна, на вы",
    "на Вы-с",
    "мне всё равно",
    "не важно",
    "Я Ольга",
  ];

  for (const text of setupShaped) {
    const result = applyConversationControlKernel({
      profile: EMPTY_LEGACY_PROFILE,
      conversationState: createInitialConversationState(T0),
      userText: text,
      nowMs: T0,
      requestId: "entry-setup-shaped",
    });

    assert.ok(isConversationProfileComplete(result.profile), text);
    assert.equal(result.profile.pendingUserRequest, null, text);
    if (result.state === "RESPOND") {
      assert.notEqual(result.act, "ADDRESS_SETUP", text);
      assert.notEqual(result.act, "UNSUPPORTED_ADDRESS_MODE", text);
      assert.doesNotMatch(result.message, SETUP_QUESTION, text);
    }
  }
});

test("no question swallowed by a rename: a declared name never spans a sentence boundary", () => {
  const routedWhole = [
    "Меня зовут Анна. Курсы онлайн?",
    "Меня зовут Тест. На «вы».",
    "Зовите меня Олег. Сколько стоит обучение?",
    "Меня зовут Анна! Есть ли курсы для начинающих?",
  ];

  for (const profile of [DEFAULT_PROFILE, EMPTY_LEGACY_PROFILE]) {
    for (const text of routedWhole) {
      const label = `${text} / ${JSON.stringify(profile)}`;
      const result = applyConversationControlKernel({
        profile,
        conversationState: createInitialConversationState(T0),
        userText: text,
        nowMs: T0,
        requestId: "entry-name-bound",
      });

      assert.equal(result.state, "ROUTE", label);
      assert.equal(result.state === "ROUTE" ? result.request : "", routed(text), label);
      assert.deepEqual(result.profile, DEFAULT_PROFILE, label);
    }
  }
});

test("E7: a voluntary single-sentence name works through the existing profile control", () => {
  const result = applyConversationControlKernel({
    profile: DEFAULT_PROFILE,
    conversationState: createInitialConversationState(T0),
    userText: "Меня зовут Анна.",
    nowMs: T0,
    requestId: "entry-e7-name",
  });

  assert.equal(result.state, "RESPOND");
  assert.equal(result.state === "RESPOND" ? result.act : null, "PROFILE_CONTROL");
  assert.equal(result.state === "RESPOND" ? result.message : null, "Хорошо, Анна. Буду обращаться на «вы».");
  assert.deepEqual(result.profile, {
    displayName: "Анна",
    addressMode: "VY",
    nameDeclined: false,
    pendingUserRequest: null,
  });
});

/* ------------------------------------------------------------------------ *
 * E6–E8 — continuing, voluntary preference, restart
 * ------------------------------------------------------------------------ */

test("E6: several ordinary turns without a name continue normally with no welcome, name or mode prompt", async () => {
  const turns: Array<[string, Decide]> = [
    ["Какие образовательные программы предлагает Академия?", CATALOG_LIST],
    // After the catalog answer the course's literal URL is in the history, so
    // the accepted literal-history authority admits a FOLLOW_UP proposal.
    ["Что изучают на курсе Маслоу?", FOLLOW_UP("maslow")],
    ["Сколько стоит обучение?", PRICE_UNSELECTED],
    ["Курсы онлайн?", ACADEMY_OVERVIEW],
  ];
  const history: ConversationMessage[] = [];
  let profile = DEFAULT_PROFILE;
  let state: ConversationState | null = null;
  const probe = newProbe();

  for (const [index, [question, decide]] of turns.entries()) {
    history.push({ role: "user", content: question });
    const payload = await postOk(
      { messages: [...history], profile, conversationState: state, requestId: `entry-e6-${index}` },
      stubbedProviders(decide, probe),
    );
    assertNoSetup(payload, question);
    assert.deepEqual(payload.profile, DEFAULT_PROFILE, question);
    assert.equal(payload.resetConversation, false, question);
    history.push({ role: "assistant", content: payload.message });
    profile = payload.profile;
    state = payload.conversationState;
  }

  assert.equal(probe.orchestrateCalls, turns.length);
  assert.deepEqual(probe.classifierInputs, turns.map(([question]) => routed(question)));
});

test("E7: an explicit «давайте на ты» applies through the existing profile control and later turns honour it", async () => {
  const probe = newProbe();
  const first = await postOk(firstTurn("Давайте на ты."), stubbedProviders(PRICE_UNSELECTED, probe));

  assert.equal(probe.orchestrateCalls, 0);
  assert.equal(first.conversationState.lastAssistant?.act, "PROFILE_CONTROL");
  assert.equal(first.message, "Хорошо. Буду обращаться на «ты».");
  assert.deepEqual(first.profile, { ...DEFAULT_PROFILE, addressMode: "TY" });
  assertNoSetup(first, "E7 first");

  const second = await postOk(
    {
      messages: [
        { role: "user", content: "Давайте на ты." },
        { role: "assistant", content: first.message },
        { role: "user", content: "Сколько стоит обучение?" },
      ],
      profile: first.profile,
      conversationState: first.conversationState,
      requestId: "entry-e7-2",
    },
    stubbedProviders(PRICE_UNSELECTED, probe),
  );

  assertNoSetup(second, "E7 second");
  assert.equal(probe.orchestrateCalls, 1);
  assert.equal(second.profile.addressMode, "TY");
  assert.match(second.message, /Уточни,/u);
  assert.doesNotMatch(second.message, /Уточните/u);
});

test("E8: «давай сначала» restarts on the accepted semantics, keeps the profile and never re-opens setup", async () => {
  const probe = newProbe();

  const fresh = await postOk(firstTurn("Давай сначала."), stubbedProviders(CATALOG_LIST, probe));
  assert.equal(fresh.resetConversation, true);
  assert.equal(fresh.message, "Хорошо, начнём сначала.");
  assert.deepEqual(fresh.profile, DEFAULT_PROFILE);
  assertNoSetup(fresh, "E8 fresh");

  // After a personalised preference, mid-conversation.
  const ty = { ...DEFAULT_PROFILE, addressMode: "TY" as const };
  const answered = await postOk(
    firstTurn("Какие образовательные программы предлагает Академия?", ty, "entry-e8-a"),
    stubbedProviders(CATALOG_LIST, probe),
  );
  const restarted = await postOk(
    {
      messages: [
        { role: "user", content: "Какие образовательные программы предлагает Академия?" },
        { role: "assistant", content: answered.message },
        { role: "user", content: "Давай сначала." },
      ],
      profile: answered.profile,
      conversationState: answered.conversationState,
      requestId: "entry-e8-b",
    },
    stubbedProviders(CATALOG_LIST, probe),
  );
  assert.equal(restarted.resetConversation, true);
  assert.equal(restarted.message, "Хорошо, начнём сначала.");
  assert.deepEqual(restarted.profile, ty);
  assert.equal(restarted.conversationState.lastAssistant, null);
  assertNoSetup(restarted, "E8 restarted");

  // The next ordinary question routes at once.
  const next = await postOk(
    {
      messages: [
        { role: "assistant", content: restarted.message },
        { role: "user", content: "Курсы онлайн?" },
      ],
      profile: restarted.profile,
      conversationState: restarted.conversationState,
      requestId: "entry-e8-c",
    },
    stubbedProviders(ACADEMY_OVERVIEW, probe),
  );
  assertNoSetup(next, "E8 next");
  assert.equal(probe.orchestrateCalls, 2);
});

/* ------------------------------------------------------------------------ *
 * E9 — legacy client-held state
 * ------------------------------------------------------------------------ */

test("E9: legacy incomplete and complete profiles never block an ordinary question", async () => {
  const smokeName = "Какие образовательные программы предлагает Академия структурной типологии";
  const cases: Array<[string, ConversationProfile, ConversationProfile]> = [
    ["empty", EMPTY_LEGACY_PROFILE, DEFAULT_PROFILE],
    ["name only", { ...EMPTY_LEGACY_PROFILE, displayName: "Анна" }, { displayName: "Анна", addressMode: "VY", nameDeclined: false, pendingUserRequest: null }],
    ["TY only", { ...EMPTY_LEGACY_PROFILE, addressMode: "TY" }, { ...DEFAULT_PROFILE, addressMode: "TY" }],
    ["VY only", { ...EMPTY_LEGACY_PROFILE, addressMode: "VY" }, DEFAULT_PROFILE],
    ["declined only", { ...EMPTY_LEGACY_PROFILE, nameDeclined: true }, DEFAULT_PROFILE],
    ["complete named", { displayName: "Иван", addressMode: "TY", nameDeclined: false, pendingUserRequest: null }, { displayName: "Иван", addressMode: "TY", nameDeclined: false, pendingUserRequest: null }],
    ["complete anonymous", DEFAULT_PROFILE, DEFAULT_PROFILE],
    // The historical defect: the question was stored as the display name.
    ["smoke name", { ...EMPTY_LEGACY_PROFILE, displayName: smokeName }, { displayName: smokeName, addressMode: "VY", nameDeclined: false, pendingUserRequest: null }],
  ];

  for (const [label, legacy, expected] of cases) {
    const probe = newProbe();
    const payload = await postOk(
      firstTurn("Сколько стоит обучение?", legacy, `entry-e9-${label.replace(/\s+/gu, "-")}`),
      stubbedProviders(PRICE_UNSELECTED, probe),
    );

    assertNoSetup(payload, label);
    assert.equal(probe.orchestrateCalls, 1, label);
    // Only the new question is routed: a legacy name is never turned into a request.
    assert.deepEqual(probe.classifierInputs, ["Сколько стоит обучение"], label);
    assert.deepEqual(payload.profile, expected, label);
    assert.match(payload.message, expected.addressMode === "TY" ? /Уточни,/u : /Уточните,/u, label);
  }
});

test("E9: a legacy pending request is preserved and routed ahead of the new question, exactly once", async () => {
  const pending = "Подберите курс по мотивации";
  const legacy = { ...EMPTY_LEGACY_PROFILE, pendingUserRequest: pending };
  const probe = newProbe();

  const payload = await postOk(
    firstTurn("Курсы онлайн?", legacy, "entry-e9-pending"),
    stubbedProviders(ACADEMY_OVERVIEW, probe),
  );

  assertNoSetup(payload, "pending");
  assert.deepEqual(probe.classifierInputs, [`${pending}\nКурсы онлайн`]);
  assert.deepEqual(payload.profile, DEFAULT_PROFILE);
  // Consumed by the completed routing turn, so it cannot replay later.
  assert.equal(payload.conversationState.deferredRequest, null);

  const next = await postOk(
    {
      messages: [
        { role: "user", content: "Курсы онлайн?" },
        { role: "assistant", content: payload.message },
        { role: "user", content: "Сколько стоит обучение?" },
      ],
      profile: payload.profile,
      conversationState: payload.conversationState,
      requestId: "entry-e9-pending-2",
    },
    stubbedProviders(PRICE_UNSELECTED, probe),
  );
  assertNoSetup(next, "pending next");
  assert.equal(probe.classifierInputs[1], "Сколько стоит обучение");
});

test("E9: a profile command releases a legacy pending request with the changed profile", async () => {
  // CORR1 (C-3): as the superseded setup completion released it (accepted
  // HEAD "pending educational task is released only after final required slot
  // is filled"), not one turn later through the deferred-request store.
  const pending = "Подберите курс по мотивации";
  const legacy = { ...EMPTY_LEGACY_PROFILE, pendingUserRequest: pending };
  const probe = newProbe();

  const released = await postOk(
    firstTurn("Давайте на ты.", legacy, "entry-e9-control"),
    stubbedProviders(ACADEMY_OVERVIEW, probe),
  );
  assert.equal(probe.orchestrateCalls, 1);
  assert.deepEqual(probe.classifierInputs, [pending]);
  assert.deepEqual(released.profile, { ...DEFAULT_PROFILE, addressMode: "TY" });
  assert.equal(released.conversationState.deferredRequest, null);
  assertNoSetup(released, "released");
});

test("E9: an existing deferred request and a legacy pending request are both kept, in order", async () => {
  const pending = "Подберите курс по мотивации";
  const deferred = "Есть ли рассрочка";
  const probe = newProbe();

  const payload = await postOk(
    {
      messages: [{ role: "user", content: "Курсы онлайн?" }],
      profile: { ...EMPTY_LEGACY_PROFILE, pendingUserRequest: pending },
      conversationState: { ...createInitialConversationState(T0), deferredRequest: deferred },
      requestId: "entry-e9-both",
    },
    stubbedProviders(ACADEMY_OVERVIEW, probe),
  );

  assertNoSetup(payload, "both");
  assert.deepEqual(probe.classifierInputs, [`${deferred}\n${pending}\nКурсы онлайн`]);
  assert.equal(payload.conversationState.deferredRequest, null);
});

test("E9: a legacy pending request that does not fit beside a stored remainder stays in the client-held profile", () => {
  // CORR1 (C-3): the legacy request is no longer copied into the 4,000-character
  // deferred store; the bound is the 8,001-character effective request.
  const fits = applyConversationControlKernel({
    profile: { ...EMPTY_LEGACY_PROFILE, pendingUserRequest: "п".repeat(3_000) },
    conversationState: { ...createInitialConversationState(T0), deferredRequest: "д".repeat(3_000) },
    userText: "Курсы онлайн?",
    nowMs: T0,
    requestId: "entry-e9-capacity-fits",
  });
  assert.equal(fits.state === "ROUTE" ? fits.request : "", `${"д".repeat(3_000)}\n${"п".repeat(3_000)}\nКурсы онлайн`);
  assert.deepEqual(fits.profile, DEFAULT_PROFILE);

  const pending = "п".repeat(4_000);
  const deferred = "д".repeat(4_000);
  const legacy = { ...EMPTY_LEGACY_PROFILE, pendingUserRequest: pending };

  const result = applyConversationControlKernel({
    profile: legacy,
    conversationState: { ...createInitialConversationState(T0), deferredRequest: deferred },
    userText: "Курсы онлайн?",
    nowMs: T0,
    requestId: "entry-e9-capacity",
  });

  // Nothing is dropped: the stored deferred request routes now and the legacy
  // pending text is handed back unchanged for the next turn.
  assert.equal(result.state, "ROUTE");
  assert.equal(result.state === "ROUTE" ? result.request : "", `${deferred}\nКурсы онлайн`);
  assert.deepEqual(result.profile, legacy);

  const next = applyConversationControlKernel({
    profile: result.profile,
    conversationState: { ...result.conversationState, deferredRequest: null },
    userText: "Сколько стоит обучение?",
    nowMs: T0,
    requestId: "entry-e9-capacity-2",
  });
  assert.equal(next.state, "ROUTE");
  assert.equal(next.state === "ROUTE" ? next.request : "", `${pending}\nСколько стоит обучение`);
  assert.deepEqual(next.profile, DEFAULT_PROFILE);
});

test("E9: restart (T32) and close keep the whole client-held profile, legacy pending request included", () => {
  // CORR1 (C-3): T32 preserves the pre-restart profile as a whole, and accepted
  // HEAD kept profile-held pending text through close; it is routed later.
  const legacy = { ...EMPTY_LEGACY_PROFILE, pendingUserRequest: "Подберите курс по мотивации" };

  const restart = applyConversationControlKernel({
    profile: legacy,
    conversationState: createInitialConversationState(T0),
    userText: "Давай сначала.",
    nowMs: T0,
    requestId: "entry-e9-restart",
  });
  assert.equal(restart.state, "RESPOND");
  assert.equal(restart.state === "RESPOND" ? restart.act : null, "RESTART");
  assert.equal(restart.state === "RESPOND" ? restart.message : null, "Хорошо, начнём сначала.");
  assert.deepEqual(restart.profile, legacy);
  assert.equal(restart.conversationState.deferredRequest, null);

  const close = applyConversationControlKernel({
    profile: legacy,
    conversationState: createInitialConversationState(T0),
    userText: "пока",
    nowMs: T0,
    requestId: "entry-e9-close",
  });
  assert.equal(close.state, "RESPOND");
  assert.equal(close.state === "RESPOND" ? close.act : null, "CONVERSATION_CLOSE");
  assert.deepEqual(close.profile, legacy);
});

test("E9: a stale session keeps the legacy pending request (profile-held text survives the 24h boundary)", () => {
  const legacy = { ...EMPTY_LEGACY_PROFILE, pendingUserRequest: "Подберите курс по мотивации" };
  const stale = createInitialConversationState(T0 - 25 * 60 * 60 * 1000);

  const result = applyConversationControlKernel({
    profile: legacy,
    conversationState: stale,
    userText: "Курсы онлайн?",
    nowMs: T0,
    requestId: "entry-e9-stale",
  });

  assert.equal(result.state, "ROUTE");
  assert.equal(result.state === "ROUTE" ? result.request : "", "Подберите курс по мотивации\nКурсы онлайн");
  assert.deepEqual(result.profile, DEFAULT_PROFILE);
});

/* ------------------------------------------------------------------------ *
 * E10 — technical error and retry
 * ------------------------------------------------------------------------ */

test("E10: a failed first question is preserved and the retry routes the same question without a synthetic answer", async () => {
  const question = "Какие образовательные программы предлагает Академия?";
  const failedProbe = newProbe();
  const failed = await post(firstTurn(question, DEFAULT_PROFILE, "entry-e10-1"), retryableFailure(failedProbe));

  assert.equal(failed.status, 503);
  assert.equal(failedProbe.orchestrateCalls, 1);
  const error = failed.json.error as {
    code: string;
    retryable: boolean;
    conversationState: ConversationState;
  };
  assert.equal(error.code, "NAVIGATOR_TECHNICAL_ERROR");
  assert.equal(error.retryable, true);
  assert.equal(error.conversationState.execution.lastCompletedRequestId, null);
  assert.equal(error.conversationState.lastAssistant, null);
  assert.equal("profile" in failed.json, false);

  // The browser keeps its profile, adopts the preserved state, and the user
  // sends again (a new request identity; the failed user line stays visible).
  const probe = newProbe();
  const retried = await postOk(
    {
      messages: [
        { role: "user", content: question },
        { role: "user", content: question },
      ],
      profile: DEFAULT_PROFILE,
      conversationState: error.conversationState,
      requestId: "entry-e10-2",
    },
    stubbedProviders(CATALOG_LIST, probe),
  );
  assertNoSetup(retried, "E10 retry");
  assert.deepEqual(probe.classifierInputs, [routed(question)]);
  assert.equal(retried.conversationState.execution.lastCompletedRequestId, "entry-e10-2");
  assert.equal(retried.conversationState.lastTechnicalError, null);
  assert.match(retried.message, /^Каталог Академии/u);

  // A replay of the identity that actually failed is executed again, not suppressed.
  const replayProbe = newProbe();
  const replay = await postOk(
    { ...firstTurn(question, DEFAULT_PROFILE, "entry-e10-1"), conversationState: error.conversationState },
    stubbedProviders(CATALOG_LIST, replayProbe),
  );
  assert.equal(replayProbe.orchestrateCalls, 1);
  assert.equal(replay.conversationState.execution.lastCompletedRequestId, "entry-e10-1");
});

test("E10: a legacy pending request survives a technical failure and is routed exactly once on retry", async () => {
  for (const deferred of [null, "Есть ли рассрочка"]) {
    const pending = "Подберите курс по мотивации";
    const legacy = { ...EMPTY_LEGACY_PROFILE, pendingUserRequest: pending };
    const label = `deferred=${deferred}`;
    const failedProbe = newProbe();
    const failed = await post(
      {
        messages: [{ role: "user", content: "Курсы онлайн?" }],
        profile: legacy,
        conversationState: { ...createInitialConversationState(T0), deferredRequest: deferred },
        requestId: "entry-e10-legacy-1",
      },
      retryableFailure(failedProbe),
    );
    assert.equal(failed.status, 503, label);
    const preserved = (failed.json.error as { conversationState: ConversationState }).conversationState;
    const expectedRequest = [deferred, pending, "Курсы онлайн"].filter((part) => part !== null).join("\n");
    assert.deepEqual(failedProbe.orchestratedMessages[0]?.at(-1)?.content, expectedRequest, label);

    // The client still holds the legacy profile; it retries with the preserved state.
    for (const requestId of ["entry-e10-legacy-1", "entry-e10-legacy-2"]) {
      const probe = newProbe();
      const retried = await postOk(
        {
          messages: [{ role: "user", content: "Курсы онлайн?" }],
          profile: legacy,
          conversationState: preserved,
          requestId,
        },
        stubbedProviders(ACADEMY_OVERVIEW, probe),
      );
      assert.deepEqual(probe.classifierInputs, [expectedRequest], `${label} ${requestId}`);
      assert.deepEqual(retried.profile, DEFAULT_PROFILE, `${label} ${requestId}`);
      assert.equal(retried.conversationState.deferredRequest, null, `${label} ${requestId}`);
    }
  }
});

/* ------------------------------------------------------------------------ *
 * E12 — accepted controls on the very first turn
 * ------------------------------------------------------------------------ */

test("E12: close, handoff, repair, restatement and duplicate replay keep their accepted lanes on the first turn", async () => {
  const cases: Array<[string, string]> = [
    ["пока", "CONVERSATION_CLOSE"],
    ["хочу поговорить с человеком", "HANDOFF_READY"],
    ["ответь нормально", "REPAIR_UNAVAILABLE"],
    ["повтори", "REPEAT"],
  ];

  for (const [text, act] of cases) {
    const probe = newProbe();
    const payload = await postOk(firstTurn(text, DEFAULT_PROFILE, "entry-e12"), stubbedProviders(CATALOG_LIST, probe));
    assert.equal(probe.orchestrateCalls, 0, text);
    assert.doesNotMatch(payload.message, SETUP_QUESTION, text);
    assert.equal(payload.message.includes(INITIAL_ADDRESS_PROMPT), false, text);
    assert.equal(payload.conversationState.lastAssistant?.act, act, text);
    assert.deepEqual(payload.profile, DEFAULT_PROFILE, text);
  }

  // A22 — a completed identity is answered from the record; no new model call.
  const probe = newProbe();
  const first = await postOk(firstTurn("Курсы онлайн?", DEFAULT_PROFILE, "entry-e12-dup"), stubbedProviders(ACADEMY_OVERVIEW, probe));
  const duplicate = await postOk(
    { ...firstTurn("Курсы онлайн?", DEFAULT_PROFILE, "entry-e12-dup"), conversationState: first.conversationState },
    stubbedProviders(ACADEMY_OVERVIEW, probe),
  );
  assert.equal(probe.orchestrateCalls, 1);
  assert.equal(duplicate.message, first.message);
  assert.deepEqual(duplicate.profile, DEFAULT_PROFILE);
});
