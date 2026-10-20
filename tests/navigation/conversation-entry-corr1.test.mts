/**
 * NAVIGATOR-CONVERSATION-ENTRY-SIMPLIFICATION-1.CORR1 — frozen C-1/C-2/C-3
 * regression matrix.
 *
 * Expectations come from the Owner's CORR1 instruction (OD-1=A, OD-2=A,
 * OD-3=A controlling), the independent IV1 counterexamples, and accepted
 * authority: accepted-HEAD behaviour (the legacy fixtures below are real
 * responses of the accepted HEAD handler, e7efcb40), T32 whole-profile
 * restart survival, A19 preserved-remainder lifecycle, A22 duplicate
 * suppression and CORR2-A confirmation precedence. Nothing here is generated
 * from the corrected implementation.
 *
 * Handler-level tests drive the real `handleChatRequest`, kernel, act-decision
 * validator and orchestration; only provider seams are injected and every
 * network access throws.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import { applyConversationControlKernel } from "../../src/lib/navigation/conversation-control-kernel.ts";
import {
  detectUnsupportedAddressModeVariant,
  hasControlLanguage,
  scanControls,
} from "../../src/lib/navigation/conversation-control-phrases.ts";
import { normalizeConversationProfilePayload } from "../../src/lib/navigation/conversation-profile.ts";
import {
  createInitialConversationState,
  normalizeConversationStatePayload,
  systemSessionClock,
  withActiveFlow,
  withLastAssistant,
  withPendingConfirmation,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";

const T0 = Date.parse("2026-10-20T12:00:00.000Z");
mock.method(systemSessionClock, "now", () => T0);
after(() => {
  mock.restoreAll();
});

type Body = {
  messages: ConversationMessage[];
  profile: ConversationProfile;
  conversationState: ConversationState | null;
  requestId: string;
};
type Payload = {
  message: string;
  profile: ConversationProfile;
  conversationState: ConversationState;
  resetConversation: boolean;
};
type HeadFixture = {
  request: Body;
  status: number;
  orchestrated: number;
  response: Payload;
};

/** Real accepted-HEAD responses (fixture-generation/generate-head-legacy.mts). */
const HEAD = JSON.parse(
  readFileSync(new URL("./conversation-entry-corr1.head-legacy.json", import.meta.url), "utf8"),
) as {
  provenance: { headSha: string; clockIso: string; networkCalls: number };
  fixtures: Record<
    | "setupPending"
    | "closedWithPending"
    | "deferredWithPending"
    | "closedAfterDeferred"
    | "restartWithPending"
    | "setupPendingMax",
    HeadFixture
  >;
};
const F = HEAD.fixtures;
const P = "Хочу разобраться в мотивации сотрудников";
const P_MAX = F.setupPendingMax.response.profile.pendingUserRequest ?? "";

const DEFAULT_PROFILE: ConversationProfile = {
  displayName: null,
  addressMode: "VY",
  nameDeclined: true,
  pendingUserRequest: null,
};
const EMPTY_LEGACY_PROFILE: ConversationProfile = {
  displayName: null,
  addressMode: null,
  nameDeclined: false,
  pendingUserRequest: null,
};
const NAMED_TY_PROFILE: ConversationProfile = {
  displayName: "Ирина",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

type Probe = {
  orchestrateCalls: number;
  orchestrated: ConversationMessage[][];
  classifierInputs: string[];
  networkCalls: number;
};

function newProbe(): Probe {
  return { orchestrateCalls: 0, orchestrated: [], classifierInputs: [], networkCalls: 0 };
}

const OVERVIEW = () => ({ state: "FACTUAL", intents: [{ kind: "ACADEMY_OVERVIEW" }] });

function providers(probe: Probe): ChatRouteDependencies {
  return {
    orchestrate: (messages, options) => {
      probe.orchestrateCalls += 1;
      probe.orchestrated.push(messages.map((message) => ({ ...message })));
      return orchestrateNavigatorResponse(messages, {
        ...options,
        fetch: async () => {
          probe.networkCalls += 1;
          throw new Error("network access is forbidden in this suite");
        },
        dependencies: {
          classifyAct: async (effective) => {
            probe.classifierInputs.push(effective.at(-1)?.content ?? "");
            return routeConversationAct(effective, { callJson: async () => OVERVIEW() });
          },
          route: async () => {
            throw new Error("selection router was not expected");
          },
          retrieve: async () => {
            throw new Error("retrieval was not expected");
          },
          resolve: () => [],
          compose: async () => "STUB COMPOSE",
          extractPlan: async () => {
            throw new Error("task-plan extraction was not expected");
          },
        },
      });
    },
  };
}

function failing(probe: Probe): ChatRouteDependencies {
  return {
    orchestrate: (messages) => {
      probe.orchestrateCalls += 1;
      probe.orchestrated.push(messages.map((message) => ({ ...message })));
      return Promise.reject(
        new NavigatorStageError(
          "COURSE_RPC",
          Object.assign(new Error("rpc"), { code: "RPC_UNAVAILABLE" }),
        ),
      );
    },
  };
}

async function post(
  body: Body,
  dependencies: ChatRouteDependencies,
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
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  } finally {
    console.info = info;
    console.error = error;
  }
}

async function ok(body: Body, dependencies: ChatRouteDependencies): Promise<Payload> {
  const result = await post(body, dependencies);
  assert.equal(result.status, 200, JSON.stringify(result.json).slice(0, 400));
  return result.json as unknown as Payload;
}

/** The next client turn after a recorded response, exactly as the browser builds it. */
function after_(
  previous: { request: Body; response: Payload },
  text: string,
  requestId: string,
): Body {
  const history: ConversationMessage[] = previous.response.resetConversation
    ? [{ role: "assistant", content: previous.response.message }]
    : [...previous.request.messages, { role: "assistant", content: previous.response.message }];
  return {
    messages: [...history, { role: "user", content: text }],
    profile: previous.response.profile,
    conversationState: previous.response.conversationState,
    requestId,
  };
}

function firstTurn(text: string, profile: ConversationProfile, requestId: string): Body {
  return { messages: [{ role: "user", content: text }], profile, conversationState: null, requestId };
}

function routed(text: string): string {
  return text.replace(/[\s,.;:!?—–-]+$/u, "");
}

function kernel(
  text: string,
  profile: ConversationProfile,
  state: ConversationState = createInitialConversationState(T0),
  requestId = "corr1-kernel",
) {
  return applyConversationControlKernel({
    profile,
    conversationState: state,
    userText: text,
    nowMs: T0,
    requestId,
  });
}

/* ======================================================================== *
 * C-1 — realistic learner context is never removed by the obsolete rule
 * ======================================================================== */

const LEARNER_CONTEXT = [
  "Мы новички. Какие курсы подходят?",
  "Мы преподаватели. Есть ли курс по мотивации?",
  "Мы начинаем. Что посоветуете?",
  "Мы руководители. Что выбрать?",
  "На работе. Какой курс поможет?",
  "Мы впервые знакомимся со структурной типологией. С чего начать?",
  "На работе возник конфликт. Какой курс поможет?",
  "Мы новички, какие курсы подходят?",
];

test("C-1: the complete learner message reaches the classifier (first turn, default and legacy profiles)", async () => {
  for (const profile of [DEFAULT_PROFILE, EMPTY_LEGACY_PROFILE]) {
    for (const text of LEARNER_CONTEXT) {
      const probe = newProbe();
      await ok(firstTurn(text, profile, "corr1-c1"), providers(probe));
      const label = `${text} / ${JSON.stringify(profile)}`;
      assert.equal(probe.orchestrateCalls, 1, label);
      assert.deepEqual(probe.classifierInputs, [routed(text)], label);
      assert.equal(probe.networkCalls, 0, label);
    }
  }
});

test("C-1: learner context is kept on a completed profile too", () => {
  for (const text of LEARNER_CONTEXT) {
    const result = kernel(text, NAMED_TY_PROFILE);
    assert.equal(result.state, "ROUTE", text);
    assert.equal(result.state === "ROUTE" ? result.request : null, routed(text), text);
  }
});

test("C-1 contrast: context-only statements route as the learner's own words", () => {
  for (const text of ["Мы новички", "На работе", "Мы преподаватели", "Мы руководители."]) {
    const result = kernel(text, DEFAULT_PROFILE);
    assert.equal(result.state, "ROUTE", text);
    assert.equal(result.state === "ROUTE" ? result.request : null, routed(text), text);
    assert.deepEqual(result.profile, DEFAULT_PROFILE, text);
  }
});

test("C-1 contrast: the obsolete variant is recognised only inside a genuine address-setup context", () => {
  // Normal conversation: no address question exists, so nothing is consumed.
  assert.deepEqual(scanControls("на они").controls, []);
  assert.deepEqual(scanControls("Мы новички. Какие курсы подходят?").controls, []);
  assert.equal(
    scanControls("Мы новички. Какие курсы подходят?").remainder,
    "Мы новички. Какие курсы подходят",
  );
  // A genuine address-setup context (the documented option) still recognises it.
  assert.deepEqual(scanControls("на они", { addressSetupOpen: true }).controls, [
    "UNSUPPORTED_ADDRESS_MODE",
  ]);
  assert.equal(detectUnsupportedAddressModeVariant("на они"), "они");
  assert.equal(hasControlLanguage("на они"), true);
});

/**
 * Accepted-HEAD kernel results for controls led in by a "мы/на <word>" clause
 * (fixture-generation/probe-prefix-chains.mts on git archive HEAD). The
 * obsolete variant must stay a lead-in to a real control in the same clause.
 * Added after the freeze, from the HEAD oracle, when the author's side-effect
 * probe showed that a blanket guard would turn these closes/repeats into text.
 */
const HEAD_PREFIX_CHAIN_ORACLE: ReadonlyArray<[string, "RESPOND" | "ROUTE", string | null, "OPEN" | "CLOSED"]> = [
  ["На сегодня всё, пока", "RESPOND", "CONVERSATION_CLOSE", "CLOSED"],
  ["Мы закончили, пока", "RESPOND", "CONVERSATION_CLOSE", "CLOSED"],
  ["Мы всё, спасибо, пока", "RESPOND", "CONVERSATION_CLOSE", "CLOSED"],
  ["На сегодня хватит, спасибо", "ROUTE", null, "OPEN"],
  ["Мы поняли, повтори", "RESPOND", "REPEAT", "OPEN"],
  ["Мы поняли. Пока", "RESPOND", "CONVERSATION_CLOSE", "CLOSED"],
  ["На сегодня всё. Пока", "RESPOND", "CONVERSATION_CLOSE", "CLOSED"],
  ["Мы хотим поговорить с человеком", "ROUTE", null, "OPEN"],
  ["На этом всё, давай сначала", "ROUTE", null, "OPEN"],
  ["Мы новички, повтори пожалуйста", "RESPOND", "REPEAT", "OPEN"],
  ["На работе, пока", "RESPOND", "CONVERSATION_CLOSE", "CLOSED"],
  ["мы они, пока", "RESPOND", "CONVERSATION_CLOSE", "CLOSED"],
  ["На сегодня всё", "ROUTE", null, "OPEN"],
];

test("C-1 contrast: a 'мы/на <word>' lead-in to a real control keeps the accepted-HEAD result", () => {
  const answered = withLastAssistant(createInitialConversationState(T0), {
    act: "FACTUAL",
    content: "Каталог Академии …",
    courseId: null,
  });
  for (const [text, state, act, lifecycle] of HEAD_PREFIX_CHAIN_ORACLE) {
    const result = kernel(text, { ...NAMED_TY_PROFILE, addressMode: "VY" }, answered);
    assert.equal(result.state, state, text);
    assert.equal(result.state === "RESPOND" ? result.act : null, act, text);
    assert.equal(result.conversationState.lifecycle, lifecycle, text);
  }
});

/**
 * Accepted-HEAD kernel results for the neighbouring controls on complete
 * profiles (fixture-generation/oracle-head-controls.mts, run on git archive
 * HEAD). The corrected candidate must reproduce every field.
 */
const HEAD_CONTROL_ORACLE: ReadonlyArray<{
  label: string;
  text: string;
  profile: "VY" | "TY";
  stateKind: "base" | "answered" | "flow" | "confirm";
  act: string;
  addressMode: "VY" | "TY";
  displayName: string | null;
  deferred: string | null;
  lifecycle: "OPEN" | "CLOSED";
  handoff: string;
  reset: boolean;
}> = [
  { label: "mode-vy", text: "на вы", profile: "TY", stateKind: "base", act: "PROFILE_CONTROL", addressMode: "VY", displayName: "Ирина", deferred: null, lifecycle: "OPEN", handoff: "NONE", reset: false },
  { label: "mode-ty", text: "давай на ты", profile: "VY", stateKind: "base", act: "PROFILE_CONTROL", addressMode: "TY", displayName: null, deferred: null, lifecycle: "OPEN", handoff: "NONE", reset: false },
  { label: "repeat", text: "повтори", profile: "VY", stateKind: "answered", act: "REPEAT", addressMode: "VY", displayName: null, deferred: null, lifecycle: "OPEN", handoff: "NONE", reset: false },
  { label: "repeat+remainder", text: "повтори, а потом расскажи про мышление", profile: "VY", stateKind: "answered", act: "REPEAT", addressMode: "VY", displayName: null, deferred: "расскажи про мышление", lifecycle: "OPEN", handoff: "NONE", reset: false },
  { label: "restart", text: "давай сначала", profile: "VY", stateKind: "answered", act: "RESTART", addressMode: "VY", displayName: null, deferred: null, lifecycle: "OPEN", handoff: "NONE", reset: true },
  { label: "close", text: "пока", profile: "VY", stateKind: "answered", act: "CONVERSATION_CLOSE", addressMode: "VY", displayName: null, deferred: null, lifecycle: "CLOSED", handoff: "NONE", reset: false },
  { label: "handoff", text: "хочу поговорить с человеком", profile: "VY", stateKind: "answered", act: "HANDOFF_READY", addressMode: "VY", displayName: null, deferred: null, lifecycle: "OPEN", handoff: "READY", reset: false },
  { label: "cancel", text: "отмени подбор", profile: "VY", stateKind: "flow", act: "CANCEL_FLOW", addressMode: "VY", displayName: null, deferred: null, lifecycle: "OPEN", handoff: "NONE", reset: false },
  { label: "repair", text: "ответь нормально", profile: "VY", stateKind: "answered", act: "REPAIR_RESTATE", addressMode: "VY", displayName: null, deferred: null, lifecycle: "OPEN", handoff: "NONE", reset: false },
  { label: "confirm-yes", text: "да", profile: "VY", stateKind: "confirm", act: "PENDING_CONFIRMATION_RESOLVED", addressMode: "VY", displayName: null, deferred: null, lifecycle: "OPEN", handoff: "NONE", reset: false },
  { label: "confirm-no", text: "нет", profile: "VY", stateKind: "confirm", act: "PENDING_CONFIRMATION_RESOLVED", addressMode: "VY", displayName: null, deferred: null, lifecycle: "OPEN", handoff: "NONE", reset: false },
  { label: "no-name", text: "не называй меня по имени", profile: "TY", stateKind: "base", act: "PROFILE_CONTROL", addressMode: "TY", displayName: null, deferred: null, lifecycle: "OPEN", handoff: "NONE", reset: false },
  { label: "rename", text: "меня зовут Иван", profile: "TY", stateKind: "base", act: "PROFILE_CONTROL", addressMode: "TY", displayName: "Иван", deferred: null, lifecycle: "OPEN", handoff: "NONE", reset: false },
];

const STALE_PROMPT = "Вы имеете в виду курс «Иерархия потребностей А. Маслоу: новая парадигма»?";

function oracleState(kind: "base" | "answered" | "flow" | "confirm"): ConversationState {
  const base = createInitialConversationState(T0);
  const answered = withLastAssistant(base, { act: "FACTUAL", content: "Каталог Академии …", courseId: null });
  switch (kind) {
    case "base":
      return base;
    case "answered":
      return answered;
    case "flow":
      return withActiveFlow(answered, { id: "COURSE_SELECTION", pendingQuestion: "Что важнее?" });
    case "confirm":
      return withPendingConfirmation(
        { ...base, staleReference: { previousCourseId: "maslow", previousFlowId: null } },
        {
          confirmationKey: "stale-course:maslow",
          kind: "STALE_COURSE_REFERENCE",
          prompt: STALE_PROMPT,
          candidateCourseId: "maslow",
        },
      );
  }
}

test("C-1 contrast: neighbouring accepted controls reproduce the accepted-HEAD oracle field by field", () => {
  for (const row of HEAD_CONTROL_ORACLE) {
    const profile = row.profile === "TY" ? NAMED_TY_PROFILE : DEFAULT_PROFILE;
    const result = kernel(row.text, profile, oracleState(row.stateKind));

    assert.equal(result.state, "RESPOND", row.label);
    if (result.state !== "RESPOND") continue;
    assert.equal(result.act, row.act, row.label);
    assert.equal(result.profile.addressMode, row.addressMode, row.label);
    assert.equal(result.profile.displayName, row.displayName, row.label);
    assert.equal(result.conversationState.deferredRequest, row.deferred, row.label);
    assert.equal(result.conversationState.lifecycle, row.lifecycle, row.label);
    assert.equal(result.conversationState.handoff.status, row.handoff, row.label);
    assert.equal(result.resetConversation, row.reset, row.label);
  }
});

/* ======================================================================== *
 * C-2 — only a simple, standalone name declaration is a rename
 * ======================================================================== */

const STANDALONE: ReadonlyArray<[string, string]> = [
  ["Меня зовут Анна", "Анна"],
  ["Зови меня Анна", "Анна"],
  ["Меня зовут Брюс Ли", "Брюс Ли"],
  ["меня зовут Иван", "Иван"],
  ["Называйте меня Доктор Кто", "Доктор Кто"],
  ["Меня зовут Анна-Мария.", "Анна-Мария"],
];

const MIXED: readonly string[] = [
  "Меня зовут Анна. Курсы онлайн?",
  "Меня зовут Анна, курсы онлайн?",
  "Меня зовут Анна, есть ли курсы онлайн?",
  "Меня зовут Иван, давай на ты. Мне нужен курс по мотивации.",
  "Меня зовут Анна?",
  "Меня зовут Анна, давай на ты",
  "Меня зовут Анна, на вы",
  "Меня зовут Анна есть ли курсы онлайн",
  "Меня зовут Анна курсы онлайн",
  "Зови меня Анна, подскажи курс",
  "Меня зовут Анна — какие есть курсы?",
];

const C2_PROFILES: ReadonlyArray<[string, ConversationProfile, ConversationProfile]> = [
  ["first turn, default", DEFAULT_PROFILE, DEFAULT_PROFILE],
  ["first turn, legacy empty", EMPTY_LEGACY_PROFILE, DEFAULT_PROFILE],
  ["completed named TY", NAMED_TY_PROFILE, NAMED_TY_PROFILE],
];

test("C-2: a simple standalone declaration is an accepted voluntary rename", () => {
  for (const [context, profile, effective] of C2_PROFILES) {
    for (const [text, name] of STANDALONE) {
      const label = `${text} / ${context}`;
      const result = kernel(text, profile);
      assert.equal(result.state, "RESPOND", label);
      assert.equal(result.state === "RESPOND" ? result.act : null, "PROFILE_CONTROL", label);
      assert.deepEqual(
        result.profile,
        { ...effective, displayName: name, nameDeclined: false },
        label,
      );
    }
  }
});

test("C-2: a mixed message is never consumed as a name; the whole text routes", () => {
  for (const [context, profile, effective] of C2_PROFILES) {
    for (const text of MIXED) {
      const label = `${text} / ${context}`;
      const result = kernel(text, profile);
      assert.equal(result.state, "ROUTE", label);
      assert.equal(result.state === "ROUTE" ? result.request : null, routed(text), label);
      assert.deepEqual(result.profile, effective, label);
    }
  }
});

test("C-2: the attached question reaches orchestration on the first turn and after a completed profile", async () => {
  for (const [, profile, effective] of C2_PROFILES) {
    for (const text of ["Меня зовут Анна, курсы онлайн?", "Меня зовут Анна, есть ли курсы онлайн?"]) {
      const probe = newProbe();
      const payload = await ok(firstTurn(text, profile, "corr1-c2"), providers(probe));
      assert.equal(probe.orchestrateCalls, 1, text);
      assert.deepEqual(probe.classifierInputs, [routed(text)], text);
      assert.deepEqual(payload.profile, effective, text);
    }
  }
});

/* ======================================================================== *
 * C-3 — legacy pending request lifecycle (accepted-HEAD fixtures)
 * ======================================================================== */

test("C-3 fixtures are genuine, valid accepted-HEAD responses", () => {
  assert.equal(HEAD.provenance.headSha, "e7efcb404f281a343cf29591b24e0acb48d65e28");
  assert.equal(HEAD.provenance.networkCalls, 0);
  for (const [name, fixture] of Object.entries(F)) {
    assert.equal(fixture.status, 200, name);
    assert.equal(fixture.orchestrated, 0, name);
    normalizeConversationProfilePayload(fixture.response.profile);
    normalizeConversationStatePayload(fixture.response.conversationState, T0);
  }
  assert.equal(F.setupPending.response.conversationState.lastAssistant?.act, "ADDRESS_SETUP");
  assert.equal(F.setupPending.response.profile.pendingUserRequest, P);
  assert.equal(F.closedWithPending.response.conversationState.lifecycle, "CLOSED");
  assert.equal(F.closedWithPending.response.profile.pendingUserRequest, P);
  assert.equal(F.deferredWithPending.response.conversationState.deferredRequest, "расскажи про мышление");
  assert.equal(F.deferredWithPending.response.profile.pendingUserRequest, P);
  assert.equal(F.closedAfterDeferred.response.profile.pendingUserRequest, P);
  assert.equal(F.restartWithPending.response.resetConversation, true);
  assert.equal(F.restartWithPending.response.profile.pendingUserRequest, P);
  assert.equal(P_MAX.length, 4_000);
});

test("C-3a: replaying a completed id neither re-executes nor erases the legacy pending request", async () => {
  const fixture = F.setupPending;
  const probe = newProbe();
  const replay = await ok(
    {
      messages: fixture.request.messages,
      profile: fixture.response.profile,
      conversationState: fixture.response.conversationState,
      requestId: fixture.request.requestId,
    },
    providers(probe),
  );

  assert.equal(probe.orchestrateCalls, 0);
  // A22: the recorded answer is re-presented, nothing is executed again.
  assert.equal(replay.message, fixture.response.message);
  assert.equal(replay.conversationState.execution.lastCompletedRequestId, fixture.request.requestId);
  // The unexecuted request is still held where it was.
  assert.deepEqual(replay.profile, fixture.response.profile);
  assert.equal(replay.conversationState.deferredRequest, null);

  const next = await ok(
    after_({ request: fixture.request, response: replay }, "Курсы онлайн?", "corr1-c3a-next"),
    providers(probe),
  );
  assert.deepEqual(probe.classifierInputs, [`${P}\nКурсы онлайн`]);
  assert.deepEqual(next.profile, DEFAULT_PROFILE);
  assert.equal(next.conversationState.deferredRequest, null);

  // Successful completion leaves nothing to replay.
  await ok(
    after_({ request: { ...fixture.request, messages: [{ role: "user", content: "Курсы онлайн?" }] }, response: next }, "Сколько стоит обучение?", "corr1-c3a-third"),
    providers(probe),
  );
  assert.deepEqual(probe.classifierInputs, [`${P}\nКурсы онлайн`, "Сколько стоит обучение"]);
});

test("C-3a: replay with an existing A19 remainder keeps both, then routes them in order", async () => {
  const fixture = F.deferredWithPending;
  const probe = newProbe();
  const replay = await ok(
    {
      messages: fixture.request.messages,
      profile: fixture.response.profile,
      conversationState: fixture.response.conversationState,
      requestId: fixture.request.requestId,
    },
    providers(probe),
  );

  assert.equal(probe.orchestrateCalls, 0);
  assert.deepEqual(replay.profile, fixture.response.profile);
  assert.equal(replay.conversationState.deferredRequest, "расскажи про мышление");

  const next = await ok(after_({ request: fixture.request, response: replay }, "Курсы онлайн?", "corr1-c3a-d-next"), providers(probe));
  assert.deepEqual(probe.classifierInputs, [`расскажи про мышление\n${P}\nКурсы онлайн`]);
  assert.deepEqual(next.profile, DEFAULT_PROFILE);
  assert.equal(next.conversationState.deferredRequest, null);
});

test("C-3b: reopening a closed legacy session keeps the pending request for the eligible route", async () => {
  for (const name of ["closedWithPending", "closedAfterDeferred"] as const) {
    const probe = newProbe();
    const next = await ok(after_(F[name], "Курсы онлайн?", `corr1-c3b-${name}`), providers(probe));
    assert.equal(probe.orchestrateCalls, 1, name);
    assert.deepEqual(probe.classifierInputs, [`${P}\nКурсы онлайн`], name);
    assert.equal(next.conversationState.lifecycle, "OPEN", name);
    assert.deepEqual(next.profile, DEFAULT_PROFILE, name);
  }
});

test("C-3: close and cancel keep the legacy pending request for the reopened or continued conversation", async () => {
  const fixture = F.setupPending;
  const probe = newProbe();

  const closed = await ok(after_(fixture, "пока", "corr1-c3-close"), providers(probe));
  assert.equal(closed.conversationState.lifecycle, "CLOSED");
  assert.deepEqual(closed.profile, fixture.response.profile);
  const reopened = await ok(
    after_({ request: after_(fixture, "пока", "corr1-c3-close"), response: closed }, "Курсы онлайн?", "corr1-c3-reopen"),
    providers(probe),
  );
  assert.deepEqual(probe.classifierInputs, [`${P}\nКурсы онлайн`]);
  assert.deepEqual(reopened.profile, DEFAULT_PROFILE);

  // Cancel (accepted HEAD keeps the profile-held request: oracle-head-legacy-lanes).
  const flow = withActiveFlow(
    withLastAssistant(createInitialConversationState(T0), { act: "NAVIGATE", content: "Что важнее?", courseId: null }),
    { id: "COURSE_SELECTION", pendingQuestion: "Что важнее?" },
  );
  const cancelled = kernel("отмени подбор", fixture.response.profile, flow, "corr1-c3-cancel");
  assert.equal(cancelled.state === "RESPOND" ? cancelled.act : null, "CANCEL_FLOW");
  assert.deepEqual(cancelled.profile, fixture.response.profile);
  const afterCancel = kernel("Курсы онлайн?", cancelled.profile, cancelled.conversationState, "corr1-c3-after-cancel");
  assert.equal(afterCancel.state === "ROUTE" ? afterCancel.request : null, `${P}\nКурсы онлайн`);
});

test("C-3: T32 — a restart preserves the whole pre-restart legacy profile, pending request included", async () => {
  const fixture = F.setupPending;
  const probe = newProbe();
  const restarted = await ok(after_(fixture, "Давай сначала.", "corr1-c3-restart"), providers(probe));

  assert.equal(probe.orchestrateCalls, 0);
  assert.equal(restarted.resetConversation, true);
  assert.equal(restarted.message, "Хорошо, начнём сначала.");
  assert.deepEqual(restarted.profile, fixture.response.profile);
  assert.equal(restarted.conversationState.lastAssistant, null);

  await ok(
    after_({ request: after_(fixture, "Давай сначала.", "corr1-c3-restart"), response: restarted }, "Курсы онлайн?", "corr1-c3-restart-next"),
    providers(probe),
  );
  assert.deepEqual(probe.classifierInputs, [`${P}\nКурсы онлайн`]);

  // The accepted-HEAD restart output itself continues the same way.
  const headProbe = newProbe();
  await ok(after_(F.restartWithPending, "Курсы онлайн?", "corr1-c3-head-restart-next"), providers(headProbe));
  assert.deepEqual(headProbe.classifierInputs, [`${P}\nКурсы онлайн`]);
});

test("C-3: a profile command releases the legacy pending request with the changed profile (HEAD completion semantics)", async () => {
  for (const [text, expected] of [
    ["Давайте на ты.", { displayName: null, addressMode: "TY", nameDeclined: true, pendingUserRequest: null }],
    ["Меня зовут Анна", { displayName: "Анна", addressMode: "VY", nameDeclined: false, pendingUserRequest: null }],
  ] as const) {
    const probe = newProbe();
    const payload = await ok(after_(F.setupPending, text, "corr1-c3-command"), providers(probe));
    assert.equal(probe.orchestrateCalls, 1, text);
    assert.deepEqual(probe.classifierInputs, [P], text);
    assert.deepEqual(payload.profile, expected, text);
  }
});

test("C-3: under an open confirmation a profile command preserves the legacy request instead of routing (CORR2-A)", () => {
  const result = kernel("Давайте на ты.", F.setupPending.response.profile, oracleState("confirm"));

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;
  assert.equal(result.act, "STALE_REFERENCE_CONFIRMATION");
  assert.ok(result.message.startsWith(STALE_PROMPT));
  assert.ok(result.message.includes(`«${P}»`));
  assert.equal(result.conversationState.deferredRequest, P);
  assert.notEqual(result.conversationState.pendingConfirmation, null);
  assert.equal(result.profile.addressMode, "TY");
  assert.equal(result.profile.pendingUserRequest, null);
});

test("C-3 capacity: a 4,000-character legacy request routes; at the 8,001 bound all pieces route; above it the client keeps the request", async () => {
  const legacy = F.setupPendingMax.response.profile;
  const state = F.setupPendingMax.response.conversationState;
  const text = "Курсы онлайн?";

  // Alone.
  const alone = newProbe();
  await ok({ messages: [{ role: "user", content: text }], profile: legacy, conversationState: state, requestId: "corr1-cap-alone" }, providers(alone));
  assert.deepEqual(alone.classifierInputs, [`${P_MAX}\n${routed(text)}`]);

  // Exactly at the effective-request bound (deferred + "\n" + pending + "\n" + text = 8,001).
  const fit = "д".repeat(8_001 - P_MAX.length - routed(text).length - 2);
  const exact = newProbe();
  const exactPayload = await ok(
    { messages: [{ role: "user", content: text }], profile: legacy, conversationState: { ...state, deferredRequest: fit }, requestId: "corr1-cap-exact" },
    providers(exact),
  );
  assert.equal(exact.classifierInputs[0]?.length, 8_001);
  assert.deepEqual(exact.classifierInputs, [`${fit}\n${P_MAX}\n${routed(text)}`]);
  assert.deepEqual(exactPayload.profile, DEFAULT_PROFILE);

  // One character over: the stored remainder routes with the text; the legacy
  // request stays in the client-held profile for the next routed turn.
  const over = `${fit}д`;
  const overflow = newProbe();
  const overflowPayload = await ok(
    { messages: [{ role: "user", content: text }], profile: legacy, conversationState: { ...state, deferredRequest: over }, requestId: "corr1-cap-over" },
    providers(overflow),
  );
  assert.deepEqual(overflow.classifierInputs, [`${over}\n${routed(text)}`]);
  assert.deepEqual(overflowPayload.profile, legacy);
  assert.equal(overflowPayload.conversationState.deferredRequest, null);
  await ok(
    { messages: [{ role: "user", content: "Сколько стоит обучение?" }], profile: overflowPayload.profile, conversationState: overflowPayload.conversationState, requestId: "corr1-cap-over-next" },
    providers(overflow),
  );
  assert.equal(overflow.classifierInputs[1], `${P_MAX}\nСколько стоит обучение`);

  // A voluntary mode command is applied even beside a large stored remainder.
  const command = newProbe();
  const commandPayload = await ok(
    { messages: [{ role: "user", content: "Давайте на ты." }], profile: legacy, conversationState: { ...state, deferredRequest: "д".repeat(3_000) }, requestId: "corr1-cap-command" },
    providers(command),
  );
  assert.deepEqual(command.classifierInputs, [`${"д".repeat(3_000)}\n${P_MAX}`]);
  assert.equal(commandPayload.profile.addressMode, "TY");

  // The API boundary still rejects a pending request over 4,000 characters.
  const rejected = await post(
    { messages: [{ role: "user", content: text }], profile: { ...legacy, pendingUserRequest: `${P_MAX}а` }, conversationState: state, requestId: "corr1-cap-4001" },
    providers(newProbe()),
  );
  assert.equal(rejected.status, 400);
});

test("C-3: a retryable failure keeps the legacy request; same-id and new-id retries route it exactly once", async () => {
  for (const name of ["setupPending", "deferredWithPending"] as const) {
    const fixture = F[name];
    const deferred = fixture.response.conversationState.deferredRequest;
    const expected = [deferred, P, "Курсы онлайн"].filter((part) => part !== null).join("\n");
    const body = after_(fixture, "Курсы онлайн?", `corr1-c3-fail-${name}`);

    const failedProbe = newProbe();
    const failed = await post(body, failing(failedProbe));
    assert.equal(failed.status, 503, name);
    assert.equal(failedProbe.orchestrated[0]?.at(-1)?.content, expected, name);
    const preserved = (failed.json.error as { conversationState: ConversationState }).conversationState;
    assert.equal(preserved.execution.lastCompletedRequestId, fixture.request.requestId, name);

    for (const requestId of [body.requestId, `${body.requestId}-retry`]) {
      const probe = newProbe();
      const retried = await ok({ ...body, conversationState: preserved, requestId }, providers(probe));
      assert.deepEqual(probe.classifierInputs, [expected], `${name} ${requestId}`);
      assert.deepEqual(retried.profile, DEFAULT_PROFILE, `${name} ${requestId}`);
      assert.equal(retried.conversationState.deferredRequest, null, `${name} ${requestId}`);

      const later = newProbe();
      await ok(
        { messages: [{ role: "user", content: "Сколько стоит обучение?" }], profile: retried.profile, conversationState: retried.conversationState, requestId: `${requestId}-later` },
        providers(later),
      );
      assert.deepEqual(later.classifierInputs, ["Сколько стоит обучение"], `${name} ${requestId}`);
    }
  }
});
