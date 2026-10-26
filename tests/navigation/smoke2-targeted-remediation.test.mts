/**
 * NAVIGATOR-PRODUCTION-SMOKE-2.TARGETED-REMEDIATION-1
 *
 * Offline, provider-free coverage for the two Smoke-2 failures and the
 * completion contract around an unrecovered technical retry. Model calls are
 * injected. No DeepSeek, Cohere, Supabase, Telegram or Production request is
 * made. These tests do not claim that every live model output is recoverable.
 */

import assert from "node:assert/strict";
import test, { after, mock } from "node:test";

import type { ConversationProfile } from "../../src/lib/chat-contract.ts";
import {
  ACADEMY_COMMERCIAL_AUTHORITY,
  ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
} from "../../src/lib/academy/commercial-authority.ts";
import { currentMetadataComposerAdmitsField } from "../../src/lib/navigation/orchestrate-navigation.ts";
import { ConversationActDecisionValidationError } from "../../src/lib/navigation/conversation-act-router.ts";
import {
  applySessionFreshness,
  createInitialConversationState,
  SESSION_CONTEXT_TTL_MS,
  systemSessionClock,
  toSessionTimestamp,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import { NavigationDecisionValidationError } from "../../src/lib/navigation/navigation-decision.ts";
import {
  orchestrateNavigatorResponse,
  type NavigatorOrchestrationResult,
  type OrchestrationDependencies,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  handleChatRequest,
  type ChatRouteDependencies,
} from "../../src/app/api/chat/route.ts";

const T0 = Date.parse("2026-10-17T12:00:00.000Z");
// The production route reads systemSessionClock. The fixture stamps session
// activity at T0, so the suite clock stays at T0. Production TTL is unchanged.
// Each test file runs in its own process; after() restores the method even
// when a test fails. The mock is a constant, so concurrent tests in this
// file cannot observe a different clock.
mock.method(systemSessionClock, "now", () => T0);
after(() => {
  mock.restoreAll();
});

const T02_TASK = "Здравствуйте! Помогите, пожалуйста, разобраться в курсах Академии.";
const T02_NAME = "Меня зовут Тест. На «вы».";
const T12_QUESTION =
  "Когда начинается ближайший набор на курс Маслоу и до какого числа можно записаться?";

const OPEN_PROFILE: ConversationProfile = {
  displayName: null,
  addressMode: null,
  nameDeclined: false,
  pendingUserRequest: null,
};

const VY_PROFILE: ConversationProfile = {
  displayName: "Тест",
  addressMode: "VY",
  nameDeclined: false,
  pendingUserRequest: null,
};

const TY_PROFILE: ConversationProfile = {
  displayName: "Тест",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

const PAYMENT_MARKERS =
  /t\.me\/AST_payment_course_bot|@AST_payment_course_bot|\?start=/iu;
const INVENTED_ENROLLMENT_DATE =
  /15\s+мая|15\s+июля|6\s+апреля|апреля\s+2026|мая\s+2026|июля\s+2026|открыт набор|набор открыт|до\s+\d/iu;

type SuccessBody = {
  message: string;
  profile: ConversationProfile;
  conversationState: ConversationState;
  contactCard: unknown;
  resetConversation: boolean;
};

type TechnicalBody = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    conversationState: ConversationState;
  };
};

type ProviderCounters = {
  classify: number;
  route: number;
  retrieve: number;
  compose: number;
  extract: number;
};

function initialState(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return { ...createInitialConversationState(T0), ...overrides };
}

function chat(
  body: unknown,
  dependencies?: ChatRouteDependencies,
): Promise<Response> {
  return handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    dependencies,
  );
}

async function readSuccess(response: Response): Promise<SuccessBody> {
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text) as SuccessBody;
}

async function readTechnical(response: Response): Promise<TechnicalBody> {
  const text = await response.text();
  assert.notEqual(response.status, 200, text);
  return JSON.parse(text) as TechnicalBody;
}

function withCapturedWarnings(
  run: () => Promise<void>,
): Promise<string[]> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...parts: unknown[]) => {
    warnings.push(parts.map((part) => String(part)).join(" "));
  };
  return run().finally(() => {
    console.warn = original;
  }).then(() => warnings);
}

function routedText(content: string): string {
  return content.endsWith("?") ? content.slice(0, -1) : content;
}

function groundedEnrollmentPlan(
  evidence: string,
  courseId: string,
  surface: string,
) {
  return {
    tasks: [
      {
        type: "ENROLLMENT_WINDOW",
        courseIds: [courseId],
        role: "ACTIVE",
        evidence,
      },
    ],
    mentions: [{ courseId, surface, role: "ACTIVE" }],
  };
}

function orchestration(input: {
  counters: ProviderCounters;
  classify?: OrchestrationDependencies["classifyAct"];
  route?: OrchestrationDependencies["route"];
  retrieve?: OrchestrationDependencies["retrieve"];
  compose?: OrchestrationDependencies["compose"];
  composeFollowUp?: OrchestrationDependencies["composeFollowUp"];
  plan?: unknown;
  captured?: { result: NavigatorOrchestrationResult | null };
}): ChatRouteDependencies {
  return {
    orchestrate: async (messages, options) => {
      const result = await orchestrateNavigatorResponse(messages, {
        ...options,
        dependencies: {
          classifyAct: async (messages, actOptions) => {
            input.counters.classify += 1;
            if (!input.classify) {
              throw new Error("classifyAct was not expected");
            }
            return input.classify(messages, actOptions);
          },
          route: async (messages, routeOptions) => {
            input.counters.route += 1;
            if (!input.route) {
              throw new Error("educational route was not expected");
            }
            return input.route(messages, routeOptions);
          },
          retrieve: async (courseId, query, retrieveOptions) => {
            input.counters.retrieve += 1;
            if (input.retrieve) {
              return input.retrieve(courseId, query, retrieveOptions);
            }
            throw new Error("retrieval was not expected");
          },
          resolve: () => {
            throw new Error("authority resolution was not expected");
          },
          selectEvidence: async () => {
            throw new Error("evidence selection was not expected");
          },
          compose: async (messages, decision, composeOptions) => {
            input.counters.compose += 1;
            if (!input.compose) {
              throw new Error("composer was not expected");
            }
            return input.compose(messages, decision, composeOptions);
          },
          composeFollowUp: input.composeFollowUp,
          extractPlan: async () => {
            input.counters.extract += 1;
            if (input.plan !== undefined) return input.plan;
            throw new Error("task-plan extraction was not expected");
          },
        },
      });
      if (input.captured) input.captured.result = result;
      return result;
    },
  };
}

function zeroCounters(): ProviderCounters {
  return { classify: 0, route: 0, retrieve: 0, compose: 0, extract: 0 };
}

function rejectAct(): never {
  throw new ConversationActDecisionValidationError(
    "Structured act output did not match the closed schema.",
  );
}

function rejectNavigation(): never {
  throw new NavigationDecisionValidationError(
    "candidateCourseIds contains foreign-course-id.",
  );
}

test("T02: an invalid educational decision continues the catalogue dialogue on вы", async () => {
  // NAVIGATOR-CONVERSATION-ENTRY-SIMPLIFICATION-1 — the setup turn of the
  // original Smoke-2 history is Owner-superseded: the opening task now routes
  // on the first turn, on the default «вы» profile, with no name captured.
  const counters = zeroCounters();
  let routedQuery = "";
  const dependencies = orchestration({
    counters,
    classify: async () => ({ state: "NAVIGATE" }),
    route: async (messages) => {
      routedQuery = messages.at(-1)?.content ?? "";
      return rejectNavigation();
    },
  });

  const warnings = await withCapturedWarnings(async () => {
    const second = await readSuccess(
      await chat(
        {
          messages: [{ role: "user", content: T02_TASK }],
          profile: OPEN_PROFILE,
          conversationState: initialState(),
          requestId: "smoke2-T02-2",
        },
        dependencies,
      ),
    );

    assert.match(routedQuery, /курсах Академии/u);
    assert.equal(second.profile.displayName, null);
    assert.equal(second.profile.addressMode, "VY");
    assert.equal(second.profile.pendingUserRequest, null);
    assert.match(second.message, /Каталог Академии/u);
    assert.match(second.message, /Напишите/u);
    assert.doesNotMatch(second.message, /Напиши,/u);
    assert.doesNotMatch(second.message, /foreign-course-id/u);
    assert.doesNotMatch(second.message, PAYMENT_MARKERS);
    assert.doesNotMatch(second.message, INVENTED_ENROLLMENT_DATE);
    assert.equal(second.contactCard, null);
    assert.equal(second.conversationState.selectedCourseId, null);
    assert.equal(second.conversationState.courseMatch, "UNKNOWN");
    assert.equal(second.conversationState.lastAssistant?.act, "NAVIGATE");
    assert.equal(second.conversationState.lastAssistant?.courseId, null);
    assert.equal(second.conversationState.lastTechnicalError, null);
    assert.deepEqual(second.conversationState.qualitySignals, []);
    assert.equal(
      second.conversationState.execution.lastCompletedRequestId,
      "smoke2-T02-2",
    );
    assert.equal(counters.classify, 1);
    assert.equal(counters.route, 1);
    assert.equal(counters.retrieve, 0);
    assert.equal(counters.compose, 0);
    assert.equal(counters.extract, 0);
  });

  assert.match(warnings.join("\n"), /"stage":"ROUTER"/u);
  assert.match(warnings.join("\n"), /"fallback":"CATALOG_CONTINUATION"/u);
  assert.match(warnings.join("\n"), /"errorName":"NavigationDecisionValidationError"/u);
});

test("T02: ты address mode is preserved when the educational decision is invalid", async () => {
  const counters = zeroCounters();
  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Помогите разобраться в курсах Академии." }],
    {
      profile: TY_PROFILE,
      requestId: "ty-router-recovery",
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
        route: async () => rejectNavigation(),
        compose: async () => {
          counters.compose += 1;
          return "composer must not run";
        },
        retrieve: async () => {
          counters.retrieve += 1;
          throw new Error("retrieval must not run");
        },
      },
    },
  );

  assert.match(result.message, /Напиши, пожалуйста/u);
  assert.doesNotMatch(result.message, /Напишите/u);
  assert.equal(result.decision, null);
  assert.equal(result.stateEffects.courseBinding, undefined);
  assert.equal(counters.compose, 0);
  assert.equal(counters.retrieve, 0);
});

test("T02: a non-validation router failure stays a technical error and preserves the completed request", async () => {
  // NAVIGATOR-CONVERSATION-ENTRY-SIMPLIFICATION-1 — the completed first turn
  // is no longer an address-setup turn: it is the opening task, answered by
  // the catalogue continuation, and the failing second turn is a new request.
  const counters = zeroCounters();
  const setup = await readSuccess(
    await chat(
      {
        messages: [{ role: "user", content: T02_TASK }],
        profile: OPEN_PROFILE,
        conversationState: initialState(),
        requestId: "smoke2-T02-1",
      },
      orchestration({
        counters: zeroCounters(),
        classify: async () => ({ state: "NAVIGATE" }),
        route: async () => rejectNavigation(),
      }),
    ),
  );
  assert.equal(setup.conversationState.lastAssistant?.act, "NAVIGATE");

  const failed = await readTechnical(
    await chat(
      {
        messages: [
          { role: "user", content: T02_TASK },
          { role: "assistant", content: setup.message },
          { role: "user", content: T02_NAME },
        ],
        profile: setup.profile,
        conversationState: setup.conversationState,
        requestId: "smoke2-T02-2",
      },
      orchestration({
        counters,
        classify: async () => ({ state: "NAVIGATE" }),
        route: async () => {
          throw new Error("router transport failed");
        },
      }),
    ),
  );

  assert.equal(failed.error.code, "NAVIGATOR_TECHNICAL_ERROR");
  assert.equal(failed.error.retryable, true);
  assert.match(failed.error.message, /технический сбой/u);
  assert.doesNotMatch(failed.error.message, /Каталог Академии/u);
  assert.equal(
    failed.error.conversationState.execution.lastCompletedRequestId,
    "smoke2-T02-1",
  );
  assert.equal(
    failed.error.conversationState.lastTechnicalError?.stage,
    "ROUTER",
  );
  assert.equal(
    failed.error.conversationState.lastTechnicalError?.failureClass,
    "INTERNAL_RUNTIME_FAILURE",
  );
  assert.equal(failed.error.conversationState.selectedCourseId, null);
  assert.equal(
    failed.error.conversationState.qualitySignals.at(-1)?.signalType,
    "MATERIAL_FAILURE",
  );
  assert.equal(counters.route, 1);
  assert.equal(counters.compose, 0);
  assert.equal(counters.retrieve, 0);
});

test("T02: an authenticated upstream refusal is not converted into a catalogue answer", async () => {
  class UpstreamAuthError extends Error {
    readonly status = 401;
    readonly code = "CONFIGURATION_ERROR";

    constructor() {
      super("upstream refused the credential");
      this.name = "UpstreamAuthError";
    }
  }

  const failed = await readTechnical(
    await chat(
      {
        messages: [{ role: "user", content: "Помогите разобраться в курсах Академии." }],
        profile: VY_PROFILE,
        conversationState: initialState(),
        requestId: "auth-router-1",
      },
      orchestration({
        counters: zeroCounters(),
        classify: async () => ({ state: "NAVIGATE" }),
        route: async () => {
          throw new UpstreamAuthError();
        },
      }),
    ),
  );

  assert.equal(failed.error.retryable, false);
  assert.match(failed.error.message, /чуть позже/u);
  assert.doesNotMatch(failed.error.message, /Каталог Академии/u);
  assert.equal(failed.error.conversationState.selectedCourseId, null);
  assert.equal(
    failed.error.conversationState.execution.lastCompletedRequestId,
    null,
  );
});

test("T12: a rejected act decision still reports the unavailable enrollment window", async () => {
  const counters = zeroCounters();
  const warnings = await withCapturedWarnings(async () => {
    const response = await readSuccess(
      await chat(
        {
          messages: [{ role: "user", content: T12_QUESTION }],
          profile: VY_PROFILE,
          conversationState: initialState(),
          requestId: "smoke2-T12-2",
        },
        orchestration({
          counters,
          classify: async () => rejectAct(),
          plan: groundedEnrollmentPlan(routedText(T12_QUESTION), "maslow", "Маслоу"),
        }),
      ),
    );

    assert.match(response.message, /окно набора: авторитетного значения нет/u);
    assert.match(response.message, /26 октября 2026 года/u);
    assert.doesNotMatch(response.message, INVENTED_ENROLLMENT_DATE);
    assert.doesNotMatch(response.message, PAYMENT_MARKERS);
    assert.doesNotMatch(response.message, /60[\s\u00a0]?000/u);
    assert.doesNotMatch(response.message, /технический сбой/u);
    assert.equal(response.contactCard, null);
    assert.equal(response.conversationState.lastAssistant?.act, "FACTUAL");
    assert.equal(response.conversationState.selectedCourseId, null);
    assert.equal(response.conversationState.courseMatch, "UNKNOWN");
    assert.equal(response.conversationState.lastTechnicalError, null);
    assert.deepEqual(response.conversationState.qualitySignals, []);
    assert.equal(
      response.conversationState.transactionalAuthorityVersion,
      ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
    );
    assert.equal(
      response.conversationState.execution.lastCompletedRequestId,
      "smoke2-T12-2",
    );
    assert.equal(counters.classify, 1);
    assert.equal(counters.route, 0);
    assert.equal(counters.retrieve, 0);
    assert.equal(counters.compose, 0);
    assert.equal(counters.extract, 1);
    assert.doesNotMatch(response.message, /не разобрал/u);
  });

  assert.doesNotMatch(warnings.join("\n"), /ENROLLMENT_WINDOW_AUTHORITY/u);
});

test("T12: a governed course alias recovers without using a stored course", async () => {
  const alias = "До какого числа можно записаться на курс иерархии потребностей?";
  const counters = zeroCounters();
  const response = await readSuccess(
    await chat(
      {
        messages: [{ role: "user", content: alias }],
        profile: VY_PROFILE,
        conversationState: initialState({
          courseMatch: "MATCHED",
          selectedCourseId: "normative-situation",
        }),
        requestId: "enrollment-alias-1",
      },
      orchestration({
        counters,
        classify: async () => rejectAct(),
        plan: groundedEnrollmentPlan(routedText(alias), "maslow", "иерархии потребностей"),
      }),
    ),
  );
  assert.equal(counters.extract, 1);

  assert.match(response.message, /окно набора: авторитетного значения нет/u);
  assert.equal(response.conversationState.selectedCourseId, "normative-situation");
  assert.equal(response.conversationState.courseMatch, "MATCHED");
  assert.equal(response.contactCard, null);
  assert.doesNotMatch(response.message, PAYMENT_MARKERS);
});

test("T12 negative: stale course, unknown course, mixed intent and payment do not inherit a commercial answer", async () => {
  const cases: Array<{
    label: string;
    content: string;
    state?: Partial<ConversationState>;
  }> = [
    {
      label: "no course identity",
      content: "Когда начинается ближайший набор?",
      state: { courseMatch: "MATCHED", selectedCourseId: "maslow" },
    },
    {
      label: "anaphor without a name",
      content: "Когда начинается набор на этот курс?",
      state: { courseMatch: "MATCHED", selectedCourseId: "maslow" },
    },
    {
      label: "unknown course",
      content: "Когда начинается набор на курс квантовой физики?",
    },
    {
      label: "two courses",
      content: "Когда начинается набор на Маслоу и на нормативную ситуацию?",
    },
    {
      label: "price",
      content: "Сколько стоит курс Маслоу?",
    },
    {
      label: "content",
      content: "Что на курсе Маслоу говорят о нормативной ситуации",
    },
    {
      label: "payment",
      content: "Хочу записаться на курс Маслоу.",
    },
    {
      label: "compound price and window",
      content: "Когда начинается набор на курс Маслоу и сколько он стоит?",
    },
  ];

  for (const item of cases) {
    const failed = await readTechnical(
      await chat(
        {
          messages: [{ role: "user", content: item.content }],
          profile: VY_PROFILE,
          conversationState: initialState(item.state),
          requestId: `negative-${item.label.replaceAll(" ", "-")}`,
        },
        orchestration({
          counters: zeroCounters(),
          classify: async () => rejectAct(),
        }),
      ),
    );

    assert.equal(failed.error.code, "NAVIGATOR_TECHNICAL_ERROR", item.label);
    assert.equal(failed.error.retryable, true, item.label);
    assert.match(failed.error.message, /технический сбой/u, item.label);
    assert.doesNotMatch(failed.error.message, /окно набора/u, item.label);
    assert.doesNotMatch(failed.error.message, /60[\s\u00a0]?000/u, item.label);
    assert.doesNotMatch(failed.error.message, /45[\s\u00a0]?000/u, item.label);
    assert.doesNotMatch(failed.error.message, PAYMENT_MARKERS, item.label);
    assert.equal(failed.error.conversationState.lastTechnicalError?.stage, "ACT_ROUTER", item.label);
    assert.equal(
      failed.error.conversationState.execution.lastCompletedRequestId,
      null,
      item.label,
    );
    assert.equal(
      failed.error.conversationState.qualitySignals.at(-1)?.signalType,
      "MATERIAL_FAILURE",
      item.label,
    );
    if (item.state?.selectedCourseId) {
      assert.equal(
        failed.error.conversationState.selectedCourseId,
        item.state.selectedCourseId,
        item.label,
      );
    } else {
      assert.equal(failed.error.conversationState.selectedCourseId, null, item.label);
    }
  }
});

test("unrecovered router degradation does not complete the request and a retry is not suppressed", async () => {
  const prior = initialState();
  prior.execution = {
    phase: "IDLE",
    requestId: null,
    lastCompletedRequestId: "smoke2-T12-1",
  };
  const counters = zeroCounters();
  const dependencies = orchestration({
    counters,
    classify: async () => rejectAct(),
  });
  const first = await readTechnical(
    await chat(
      {
        messages: [{ role: "user", content: "Что такое замещение эмоций?" }],
        profile: VY_PROFILE,
        conversationState: prior,
        requestId: "smoke2-T12-2",
      },
      dependencies,
    ),
  );

  assert.equal(
    first.error.conversationState.execution.lastCompletedRequestId,
    "smoke2-T12-1",
  );
  assert.equal(first.error.conversationState.lastAssistant, null);
  assert.notEqual(first.error.conversationState.lastTechnicalError, null);
  assert.equal(counters.classify, 1);

  const retried = await readTechnical(
    await chat(
      {
        messages: [{ role: "user", content: "Что такое замещение эмоций?" }],
        profile: VY_PROFILE,
        conversationState: first.error.conversationState,
        requestId: "smoke2-T12-2",
      },
      dependencies,
    ),
  );

  assert.equal(counters.classify, 2);
  assert.equal(
    retried.error.conversationState.execution.lastCompletedRequestId,
    "smoke2-T12-1",
  );
  assert.match(retried.error.message, /технический сбой/u);
});

test("a recovered enrollment answer completes, and replaying its request id does not call the provider again", async () => {
  const counters = zeroCounters();
  const dependencies = orchestration({
    counters,
    classify: async () => rejectAct(),
    plan: groundedEnrollmentPlan(routedText(T12_QUESTION), "maslow", "Маслоу"),
  });
  const first = await readSuccess(
    await chat(
      {
        messages: [{ role: "user", content: T12_QUESTION }],
        profile: VY_PROFILE,
        conversationState: initialState(),
        requestId: "smoke2-T12-2",
      },
      dependencies,
    ),
  );
  assert.equal(counters.classify, 1);
  assert.equal(counters.extract, 1);

  const replay = await readSuccess(
    await chat(
      {
        messages: [
          { role: "user", content: T12_QUESTION },
          { role: "assistant", content: first.message },
          { role: "user", content: T12_QUESTION },
        ],
        profile: VY_PROFILE,
        conversationState: first.conversationState,
        requestId: "smoke2-T12-2",
      },
      dependencies,
    ),
  );

  assert.equal(counters.classify, 1);
  assert.equal(replay.message, first.message);
  assert.equal(replay.conversationState.lastAssistant?.act, "FACTUAL");
  assert.equal(
    replay.conversationState.execution.lastCompletedRequestId,
    "smoke2-T12-2",
  );
});

test("a valid educational recommendation still binds the routed course", async () => {
  const counters = zeroCounters();
  const response = await readSuccess(
    await chat(
      {
        messages: [
          {
            role: "user",
            content: "Хочу понять структурную типологию личности.",
          },
        ],
        profile: VY_PROFILE,
        conversationState: initialState(),
        requestId: "valid-route-1",
      },
      orchestration({
        counters,
        classify: async () => ({ state: "NAVIGATE" }),
        route: async () => ({
          state: "RECOMMEND_COURSE",
          primaryCourseId: "structural-typology",
          secondaryCourseIds: [],
          learningNeed: "понять структурную типологию личности",
          evidence: [
            {
              messageIndex: 0,
              quote: "структурную типологию личности",
            },
          ],
          confidence: "sufficient",
        }),
        retrieve: async () => ({
          hasActiveSources: false,
          bindings: [],
          matches: [],
        }),
        compose: async () => "По вашему описанию подходит курс структурной типологии.",
      }),
    ),
  );

  assert.equal(response.conversationState.selectedCourseId, "structural-typology");
  assert.equal(response.conversationState.courseMatch, "MATCHED");
  assert.equal(response.conversationState.lastAssistant?.act, "NAVIGATE");
  assert.match(response.message, /структурной типологии/u);
  assert.equal(counters.route, 1);
  assert.equal(counters.compose, 1);
  assert.equal(counters.extract, 0);
  assert.equal(response.conversationState.lastTechnicalError, null);
});

test("T09-shaped content still retrieves only the requested Maslow course", async () => {
  const seen: string[] = [];
  const response = await readSuccess(
    await chat(
      {
        messages: [
          {
            role: "user",
            content: "Что на курсе Маслоу говорят о нормативной ситуации",
          },
        ],
        profile: VY_PROFILE,
        conversationState: initialState(),
        requestId: "t09-content-1",
      },
      orchestration({
        counters: zeroCounters(),
        classify: async () => ({
          state: "COURSE_CONTENT",
          courseId: "maslow",
          evidenceRequested: false,
          contentIntentEvidence: "Что на курсе Маслоу говорят о нормативной ситуации",
        }),
        retrieve: async (courseId) => {
          seen.push(courseId);
          return { hasActiveSources: false, bindings: [], matches: [] };
        },
        composeFollowUp: async () =>
          "Ответ ограничен материалами курса «Иерархия потребностей А. Маслоу: новая парадигма».",
      }),
    ),
  );

  assert.deepEqual(seen, ["maslow"]);
  assert.match(response.message, /Маслоу/u);
  assert.equal(response.conversationState.selectedCourseId, null);
  assert.doesNotMatch(response.message, /нормативной ситуации» —/u);
  assert.equal(response.conversationState.lastTechnicalError, null);
});

const F1_REJECTION =
  "COURSE_CONTENT cannot be used once a catalog course is present in the conversation.";

function taskPlan(input: {
  tasks: Array<{
    type: string;
    courseIds: string[];
    evidence: string;
    role?: string;
  }>;
  mentions?: Array<{ courseId: string | null; surface: string; role: string }>;
}) {
  return {
    tasks: input.tasks.map((task) => ({ role: "ACTIVE", ...task })),
    mentions: input.mentions ?? [],
  };
}

async function rejectedTurn(
  content: string,
  options: {
    plan?: unknown;
    state?: Partial<ConversationState>;
    requestId?: string;
  } = {},
): Promise<{ response: Response; counters: ProviderCounters }> {
  const counters = zeroCounters();
  const response = await chat(
    {
      messages: [{ role: "user", content }],
      profile: VY_PROFILE,
      conversationState: initialState(options.state),
      requestId: options.requestId ?? "arch-remediation",
    },
    orchestration({
      counters,
      classify: async () => rejectAct(),
      plan: options.plan,
    }),
  );
  return { response, counters };
}

test("M01: a payment-composition veto stays a retryable technical failure", async () => {
  const content = "Хочу оплатить курс Маслоу. Объясни, как самоактуализация связана с тревогой";
  const counters = zeroCounters();
  const prior = initialState({
    courseMatch: "MATCHED",
    selectedCourseId: "play-and-creativity",
    deferredRequest: "Когда начинается набор на курс Маслоу?",
  });
  prior.execution = {
    phase: "IDLE",
    requestId: null,
    lastCompletedRequestId: "prior-complete",
  };
  const dependencies = orchestration({
    counters,
    classify: async () => {
      throw new ConversationActDecisionValidationError(F1_REJECTION);
    },
    plan: taskPlan({
      tasks: [
        {
          type: "EDU",
          courseIds: ["maslow"],
          evidence: "Объясни, как самоактуализация связана с тревогой",
        },
        {
          type: "PAYMENT",
          courseIds: ["maslow"],
          evidence: "Хочу оплатить курс Маслоу",
        },
      ],
      mentions: [{ courseId: "maslow", surface: "Маслоу", role: "ACTIVE" }],
    }),
  });
  const body = {
    messages: [{ role: "user" as const, content }],
    profile: VY_PROFILE,
    conversationState: prior,
    requestId: "m01-veto",
  };
  const failed = await readTechnical(await chat(body, dependencies));
  assert.equal(failed.error.retryable, true);
  assert.equal(failed.error.conversationState.execution.lastCompletedRequestId, "prior-complete");
  assert.equal(
    failed.error.conversationState.deferredRequest,
    "Когда начинается набор на курс Маслоу?",
  );
  assert.equal(failed.error.conversationState.selectedCourseId, "play-and-creativity");
  assert.notEqual(failed.error.conversationState.lastTechnicalError, null);
  assert.equal(
    failed.error.conversationState.qualitySignals.at(-1)?.signalType,
    "MATERIAL_FAILURE",
  );
  assert.equal(failed.error.conversationState.pendingConfirmation, null);
  assert.doesNotMatch(failed.error.message, PAYMENT_MARKERS);
  assert.equal(counters.classify, 1);
  assert.equal(counters.extract, 1);

  const retried = await readTechnical(
    await chat(
      { ...body, conversationState: failed.error.conversationState },
      dependencies,
    ),
  );
  assert.equal(counters.classify, 2);
  assert.equal(counters.extract, 2);
  assert.equal(retried.error.conversationState.execution.lastCompletedRequestId, "prior-complete");
  assert.equal(
    retried.error.conversationState.deferredRequest,
    "Когда начинается набор на курс Маслоу?",
  );
  assert.doesNotMatch(retried.error.message, PAYMENT_MARKERS);
});

test("a grounded price and enrollment plan remains an explicit HTTP 200 answer", async () => {
  const content = "Сколько стоит курс Маслоу и когда начинается набор на курс Маслоу?";
  const { response, counters } = await rejectedTurn(content, {
    plan: taskPlan({
      tasks: [
        {
          type: "PRICE",
          courseIds: ["maslow"],
          evidence: "Сколько стоит курс Маслоу",
        },
        {
          type: "ENROLLMENT_WINDOW",
          courseIds: ["maslow"],
          evidence: "когда начинается набор на курс Маслоу",
        },
      ],
      mentions: [{ courseId: "maslow", surface: "Маслоу", role: "ACTIVE" }],
    }),
  });
  const success = await readSuccess(response);
  assert.equal(counters.extract, 1);
  assert.match(success.message, /60[\s\u00a0]?000/u);
  assert.match(success.message, /окно набора: авторитетного значения нет/u);
  assert.match(success.message, /26 октября 2026 года/u);
  assert.doesNotMatch(success.message, PAYMENT_MARKERS);
  assert.doesNotMatch(success.message, INVENTED_ENROLLMENT_DATE);
  assert.equal(success.conversationState.execution.lastCompletedRequestId, "arch-remediation");
});

test("M02: Codex mixed requests are not completed as enrollment-only answers", async () => {
  const cases = [
    {
      content: "Когда начинается набор на курс Маслоу и какие темы входят в программу?",
      enrollment: "Когда начинается набор на курс Маслоу",
      other: "какие темы входят в программу",
      type: "EDU",
      courseIds: ["maslow"],
      disclosed: /какие темы входят в программу/u,
    },
    {
      content: "Когда начинается набор на курс Маслоу и когда будут занятия?",
      enrollment: routedText("Когда начинается набор на курс Маслоу и когда будут занятия?"),
      other: routedText("Когда начинается набор на курс Маслоу и когда будут занятия?"),
      type: "SCHEDULE",
      courseIds: ["maslow"],
      disclosed: /расписание/u,
    },
    {
      content: "Когда начинается набор на курс Маслоу и какая группа будет учиться?",
      enrollment: routedText("Когда начинается набор на курс Маслоу и какая группа будет учиться?"),
      other: routedText("Когда начинается набор на курс Маслоу и какая группа будет учиться?"),
      type: "COHORT",
      courseIds: ["maslow"],
      disclosed: /текущий поток/u,
    },
    {
      content: "Когда начинается набор на курс Маслоу и какова плата за обучение?",
      enrollment: routedText("Когда начинается набор на курс Маслоу и какова плата за обучение?"),
      other: routedText("Когда начинается набор на курс Маслоу и какова плата за обучение?"),
      type: "PRICE",
      courseIds: ["maslow"],
      disclosed: /60[\s\u00a0]?000/u,
    },
    {
      content: "Когда начинается набор на курс Маслоу и какой тариф?",
      enrollment: routedText("Когда начинается набор на курс Маслоу и какой тариф?"),
      other: routedText("Когда начинается набор на курс Маслоу и какой тариф?"),
      type: "PRICE",
      courseIds: ["maslow"],
      disclosed: /60[\s\u00a0]?000/u,
    },
  ];

  for (const item of cases) {
    const lexical = await rejectedTurn(item.content);
    const failed = await readTechnical(lexical.response);
    assert.equal(failed.error.retryable, true, item.content);
    assert.doesNotMatch(failed.error.message, /окно набора/u, item.content);
    assert.equal(lexical.counters.extract, 1, item.content);
    assert.equal(
      failed.error.conversationState.execution.lastCompletedRequestId,
      null,
      item.content,
    );

    const recovered = await rejectedTurn(item.content, {
      plan: taskPlan({
        tasks: [
          {
            type: "ENROLLMENT_WINDOW",
            courseIds: ["maslow"],
            evidence: item.enrollment,
          },
          {
            type: item.type,
            courseIds: item.courseIds,
            evidence: item.other,
          },
        ],
        mentions: [{ courseId: "maslow", surface: "Маслоу", role: "ACTIVE" }],
      }),
    });
    const success = await readSuccess(recovered.response);
    assert.match(success.message, /окно набора: авторитетного значения нет/u, item.content);
    assert.match(success.message, item.disclosed, item.content);
    assert.doesNotMatch(success.message, PAYMENT_MARKERS, item.content);
    assert.doesNotMatch(success.message, INVENTED_ENROLLMENT_DATE, item.content);
    assert.equal(recovered.counters.extract, 1, item.content);
  }
});

test("held-out mixed requests disclose every accepted task or fail uncompleted", async () => {
  const cases = [
    {
      content: "Подскажите, пожалуйста, когда откроется запись на Маслоу, и заодно какие модули там разбирают?",
      enrollment: "когда откроется запись на Маслоу",
      other: "какие модули там разбирают",
      type: "EDU",
    },
    {
      content: "Интересует срок подачи документов на курс Маслоу. Ещё хочу понять, в какие дни проходят встречи.",
      enrollment: "срок подачи документов на курс Маслоу",
      other: "в какие дни проходят встречи",
      type: "SCHEDULE",
    },
    {
      content: "Можно ли успеть на ближайший набор Маслоу? И какая будет численность учебной группы?",
      enrollment: "ближайший набор Маслоу",
      other: "какая будет численность учебной группы",
      type: "COHORT",
    },
    {
      content: "До какого момента принимают заявки на Маслоу, и сколько придётся заплатить за участие?",
      enrollment: "принимают заявки на Маслоу",
      other: "сколько придётся заплатить за участие",
      type: "PRICE",
    },
    {
      content: "Когда стартует набор на курс Маслоу — и есть ли отдельный тариф для повторного прохождения?",
      enrollment: "Когда стартует набор на курс Маслоу",
      other: "есть ли отдельный тариф для повторного прохождения",
      type: "PRICE",
    },
    {
      content: "Хочу узнать окно записи на Маслоу, а также чем этот курс отличается от нормативной ситуации.",
      enrollment: "окно записи на Маслоу",
      other: "чем этот курс отличается от нормативной ситуации",
      type: "COMPARE",
      courseIds: ["maslow", "normative-situation"],
    },
    {
      content: "Когда можно подать заявление на Маслоу и что именно входит в учебную программу?",
      enrollment: "подать заявление на Маслоу",
      other: "что именно входит в учебную программу",
      type: "EDU",
    },
    {
      content: "Есть ли ещё место в наборе на Маслоу, и как устроены домашние задания?",
      enrollment: "место в наборе на Маслоу",
      other: "как устроены домашние задания",
      type: "EDU",
    },
  ];

  for (const item of cases) {
    const lexical = await rejectedTurn(item.content);
    const failed = await readTechnical(lexical.response);
    assert.equal(failed.error.retryable, true, item.content);
    assert.doesNotMatch(failed.error.message, /окно набора/u, item.content);

    const recovered = await rejectedTurn(item.content, {
      plan: taskPlan({
        tasks: [
          {
            type: "ENROLLMENT_WINDOW",
            courseIds: ["maslow"],
            evidence: item.enrollment,
          },
          {
            type: item.type,
            courseIds: item.courseIds ?? ["maslow"],
            evidence: item.other,
          },
        ],
        mentions: [
          { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
          ...(item.type === "COMPARE"
            ? [{ courseId: "normative-situation", surface: "нормативной ситуации", role: "ACTIVE" }]
            : []),
        ],
      }),
    });
    const success = await readSuccess(recovered.response);
    const quotesOther = success.message.includes(item.other);
    const quotesEnrollment = success.message.includes(item.enrollment);
    const answersOther =
      item.type === "COMPARE"
        ? /Нейтральное сравнение по данным каталога/u.test(success.message)
        : item.type === "SCHEDULE"
          ? /расписание: авторитетного значения нет/u.test(success.message)
          : item.type === "COHORT"
            ? /текущий поток: авторитетного значения нет/u.test(success.message)
            : item.type === "PRICE"
              ? /60[\s\u00a0]?000|подтверждённой цены/u.test(success.message)
              : false;
    const answersEnrollment = /окно набора: авторитетного значения нет/u.test(success.message);
    assert.ok(
      quotesOther || answersOther,
      `${item.content}\n${success.message}`,
    );
    assert.ok(
      quotesEnrollment || answersEnrollment,
      `${item.content}\n${success.message}`,
    );
    assert.equal(recovered.counters.extract, 1, item.content);
    assert.doesNotMatch(success.message, PAYMENT_MARKERS, item.content);
    assert.doesNotMatch(success.message, INVENTED_ENROLLMENT_DATE, item.content);
  }
});

test("M03 and held-out course roles do not bind a non-active or unknown target", async () => {
  const cases: Array<{
    content: string;
    evidence: string;
    courseIds: string[];
    mentions: Array<{ courseId: string | null; surface: string; role: string }>;
    state?: Partial<ConversationState>;
  }> = [
    {
      content: "Курс Маслоу мне не нужен. Когда начинается набор на курс Алхимия?",
      evidence: routedText("Когда начинается набор на курс Алхимия?"),
      courseIds: ["maslow"],
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
        { courseId: null, surface: "Алхимия", role: "ACTIVE" },
      ],
    },
    {
      content: "Я прошёл курс Маслоу. Когда начинается набор на курс Алхимия?",
      evidence: routedText("Когда начинается набор на курс Алхимия?"),
      courseIds: ["maslow"],
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "BACKGROUND" },
        { courseId: null, surface: "Алхимия", role: "ACTIVE" },
      ],
    },
    {
      content: "Я прошёл курс Маслоу. Когда можно записаться на эту новую программу?",
      evidence: routedText("Когда можно записаться на эту новую программу?"),
      courseIds: ["maslow"],
      mentions: [{ courseId: "maslow", surface: "Маслоу", role: "BACKGROUND" }],
      state: { courseMatch: "MATCHED", selectedCourseId: "maslow" },
    },
    {
      content: "Маслоу я уже закончил. Когда открывается запись на программу Алхимия сознания?",
      evidence: routedText("Когда открывается запись на программу Алхимия сознания?"),
      courseIds: ["maslow"],
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "BACKGROUND" },
        { courseId: null, surface: "Алхимия сознания", role: "ACTIVE" },
      ],
    },
    {
      content: "Не рассматриваю курс Маслоу. Интересует набор на внешний курс «Квантовая педагогика».",
      evidence: "Интересует набор на внешний курс «Квантовая педагогика»",
      courseIds: ["maslow"],
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
        { courseId: null, surface: "Квантовая педагогика", role: "ACTIVE" },
      ],
    },
    {
      content: "Коллега спрашивал про Маслоу, но мне нужно окно записи на курс структурной типологии.",
      evidence: "окно записи на курс структурной типологии",
      courseIds: ["maslow"],
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "REPORTED" },
        { courseId: "structural-typology", surface: "структурной типологии", role: "ACTIVE" },
      ],
    },
    {
      content: "Ой, не Маслоу. Когда начинается набор на нормативную ситуацию?",
      evidence: routedText("Когда начинается набор на нормативную ситуацию?"),
      courseIds: ["maslow"],
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "RETRACTED" },
        { courseId: "normative-situation", surface: "нормативную ситуацию", role: "ACTIVE" },
      ],
    },
    {
      content: "Между Маслоу и уровнями сознания я ещё не выбрал. Когда на них можно записаться?",
      evidence: routedText("Между Маслоу и уровнями сознания я ещё не выбрал. Когда на них можно записаться?"),
      courseIds: ["maslow"],
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
        { courseId: "levels-of-consciousness", surface: "уровнями сознания", role: "ACTIVE" },
      ],
    },
    {
      content: "Я про этот новый курс. Когда на него открывается набор?",
      evidence: routedText("Когда на него открывается набор?"),
      courseIds: [],
      mentions: [],
      state: { courseMatch: "MATCHED", selectedCourseId: "maslow" },
    },
  ];

  for (const item of cases) {
    const { response } = await rejectedTurn(item.content, {
      state: item.state,
      plan: taskPlan({
        tasks: [
          {
            type: "ENROLLMENT_WINDOW",
            courseIds: item.courseIds,
            evidence: item.evidence,
          },
        ],
        mentions: item.mentions,
      }),
    });
    const success = await readSuccess(response);
    assert.doesNotMatch(success.message, /окно набора/u, item.content);
    assert.doesNotMatch(success.message, /60[\s\u00a0]?000/u, item.content);
    assert.doesNotMatch(success.message, PAYMENT_MARKERS, item.content);
    assert.match(success.message, /не разобрал/u, item.content);
    if (item.state?.selectedCourseId) {
      assert.equal(success.conversationState.selectedCourseId, item.state.selectedCourseId, item.content);
    }
  }
});

test("invalid structured plans do not invent an enrollment fact", async () => {
  const evidence = routedText("Когда начинается набор на курс Алхимия?");
  const cases: Array<{ label: string; content: string; plan: unknown }> = [
    { label: "empty tasks", content: "Когда начинается набор на курс Маслоу?", plan: { tasks: [] } },
    {
      label: "span misses the claimed course",
      content: evidence,
      plan: taskPlan({
        tasks: [{ type: "ENROLLMENT_WINDOW", courseIds: ["maslow"], evidence }],
        mentions: [{ courseId: null, surface: "Алхимия", role: "ACTIVE" }],
      }),
    },
    {
      label: "rejected mention only",
      content: "Курс Маслоу мне не нужен. Когда начинается набор на курс Алхимия?",
      plan: taskPlan({
        tasks: [
          {
            type: "ENROLLMENT_WINDOW",
            courseIds: ["maslow"],
            evidence: routedText("Когда начинается набор на курс Алхимия?"),
          },
        ],
        mentions: [{ courseId: "maslow", surface: "Маслоу", role: "REJECTED" }],
      }),
    },
    { label: "tasks payload is not an array", content: "Когда начинается набор на курс Маслоу?", plan: { tasks: "nope" } },
  ];

  for (const item of cases) {
    const { response } = await rejectedTurn(item.content, { plan: item.plan });
    const text = await response.text();
    const body = JSON.parse(text) as { message?: string; error?: { message?: string } };
    const message = body.message ?? body.error?.message ?? "";
    assert.doesNotMatch(message, /окно набора/u, item.label);
    assert.doesNotMatch(message, PAYMENT_MARKERS, item.label);
    if (item.label === "empty tasks" || item.label === "tasks payload is not an array") {
      assert.notEqual(response.status, 200, item.label);
    }
  }
});

test("guarded metadata fields stay out of the unavailable composer when a snapshot is supported", () => {
  for (const field of ["SCHEDULE", "COHORT", "ENROLLMENT_WINDOW"] as const) {
    const live = field === "SCHEDULE"
      ? ACADEMY_COMMERCIAL_AUTHORITY.transactionalMetadata.schedule
      : field === "COHORT"
        ? ACADEMY_COMMERCIAL_AUTHORITY.transactionalMetadata.cohort
        : ACADEMY_COMMERCIAL_AUTHORITY.transactionalMetadata.enrollmentWindow;
    assert.equal(currentMetadataComposerAdmitsField(field, live), true, field);
    assert.equal(
      currentMetadataComposerAdmitsField(field, { status: "SUPPORTED", value: 1 }),
      false,
      field,
    );
  }
});

test("a terminal completion disposition keeps the non-retryable error contract", async () => {
  const prior = initialState();
  prior.execution = {
    phase: "IDLE",
    requestId: null,
    lastCompletedRequestId: "prior-terminal",
  };
  const response = await chat(
      {
        messages: [{ role: "user", content: "Проверка терминального сбоя." }],
        profile: VY_PROFILE,
        conversationState: prior,
        requestId: "terminal-1",
      },
      {
        orchestrate: async () => ({
          message: "Этот текст не должен стать успешным завершением.",
          contactCard: null,
          conversationAct: { state: "META" },
          decision: null,
          courseEvidenceCount: 0,
          courseHadActiveSources: false,
          evidenceSelectionStatus: "NOT_RUN",
          clarification: {
            status: "NOT_APPLICABLE",
            issueKey: null,
            attempts: 0,
            question: null,
          },
          stateEffects: {
            catalogAuthorityVersion: null,
            transactionalAuthorityVersion: null,
            pendingConfirmation: null,
          },
          completion: "TERMINAL_TECHNICAL_FAILURE",
        }),
      },
    );
  assert.equal(response.status, 500);
  const failed = await readTechnical(response);
  assert.equal(failed.error.retryable, false);
  assert.equal(failed.error.conversationState.execution.lastCompletedRequestId, "prior-terminal");
  assert.equal(failed.error.conversationState.lastAssistant, null);
});

const P08_TEXT = "Когда будет набор на курс Маслоу. Покажите пример домашней работы";
const P08_ENROLLMENT = "Когда будет набор на курс Маслоу";
const P08_HOMEWORK = "Покажите пример домашней работы";
const COMMERCIAL_PRICE = /60[\s\u00a0]?000|последняя подтверждённая цена/u;

function enrollmentMentionPlan(
  evidence: string,
  mentions: Array<{ courseId: string | null; surface: string; role: string }>,
) {
  return taskPlan({
    tasks: [{ type: "ENROLLMENT_WINDOW", courseIds: ["maslow"], evidence }],
    mentions,
  });
}

test("P06 and P08 disclose an independent clause that a mention does not cover", async () => {
  const honest = await rejectedTurn(P08_TEXT, {
    plan: enrollmentMentionPlan(P08_ENROLLMENT, [
      { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
    ]),
  });
  const honestBody = await readSuccess(honest.response);
  assert.match(honestBody.message, /окно набора: авторитетного значения нет/u);
  assert.ok(honestBody.message.includes(P08_HOMEWORK), honestBody.message);
  assert.equal(honest.counters.extract, 1);

  const erased = await rejectedTurn(P08_TEXT, {
    plan: enrollmentMentionPlan(P08_ENROLLMENT, [
      { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
      { courseId: null, surface: P08_HOMEWORK, role: "BACKGROUND" },
    ]),
  });
  const erasedBody = await readSuccess(erased.response);
  assert.ok(erasedBody.message.includes(P08_HOMEWORK), erasedBody.message);
  assert.match(erasedBody.message, /не разобрал/u);
  assert.doesNotMatch(erasedBody.message, COMMERCIAL_PRICE);
  assert.equal(erased.counters.extract, 1);

  const wholeSurface = await rejectedTurn(P08_TEXT, {
    plan: enrollmentMentionPlan(P08_ENROLLMENT, [
      { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
      { courseId: null, surface: P08_TEXT, role: "BACKGROUND" },
    ]),
  });
  const wholeBody = await readSuccess(wholeSurface.response);
  assert.ok(wholeBody.message.includes(P08_HOMEWORK), wholeBody.message);

  const otherClause = "Пришлите список литературы";
  const otherText = `${P08_ENROLLMENT}. ${otherClause}`;
  const other = await rejectedTurn(otherText, {
    plan: enrollmentMentionPlan(P08_ENROLLMENT, [
      { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
      { courseId: null, surface: otherClause, role: "BACKGROUND" },
    ]),
  });
  const otherBody = await readSuccess(other.response);
  assert.ok(otherBody.message.includes(otherClause), otherBody.message);
  assert.match(otherBody.message, /окно набора: авторитетного значения нет/u);
});

test("S10 discloses the independent clause before a completed partial consumes deferred work", async () => {
  const counters = zeroCounters();
  const dependencies = orchestration({
    counters,
    classify: async () => rejectAct(),
    plan: enrollmentMentionPlan(P08_ENROLLMENT, [
      { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
      { courseId: null, surface: P08_HOMEWORK, role: "BACKGROUND" },
    ]),
  });
  const first = await readSuccess(
    await chat(
      {
        messages: [{ role: "user", content: P08_TEXT }],
        profile: VY_PROFILE,
        conversationState: initialState({
          deferredRequest: P08_ENROLLMENT,
        }),
        requestId: "corr1-S10",
      },
      dependencies,
    ),
  );
  assert.ok(first.message.includes(P08_HOMEWORK), first.message);
  assert.equal(first.conversationState.deferredRequest, null);
  assert.equal(first.conversationState.execution.lastCompletedRequestId, "corr1-S10");
  assert.equal(counters.extract, 1);

  const replay = await readSuccess(
    await chat(
      {
        messages: [
          { role: "user", content: P08_TEXT },
          { role: "assistant", content: first.message },
          { role: "user", content: P08_TEXT },
        ],
        profile: VY_PROFILE,
        conversationState: first.conversationState,
        requestId: "corr1-S10",
      },
      dependencies,
    ),
  );
  assert.equal(counters.extract, 1);
  assert.equal(counters.classify, 1);
  assert.equal(replay.message, first.message);
  assert.ok(replay.message.includes(P08_HOMEWORK));
});

test("P09 repeated evidence and P10 overlapping evidence keep accepted task dispositions", async () => {
  const repeated = "Когда будет набор на курс Маслоу. Когда будет набор на курс Маслоу";
  const repeatedBody = await readSuccess(
    (await rejectedTurn(repeated, {
      plan: enrollmentMentionPlan(P08_ENROLLMENT, [
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
      ]),
    })).response,
  );
  assert.match(repeatedBody.message, /окно набора: авторитетного значения нет/u);
  assert.doesNotMatch(repeatedBody.message, /не разобрал/u);

  const overlapping = "Когда будет набор на курс Маслоу и в какие дни идут занятия курса Маслоу";
  const overlappingBody = await readSuccess(
    (await rejectedTurn(overlapping, {
      plan: taskPlan({
        tasks: [
          {
            type: "ENROLLMENT_WINDOW",
            courseIds: ["maslow"],
            evidence: overlapping,
          },
          {
            type: "SCHEDULE",
            courseIds: ["maslow"],
            evidence: "в какие дни идут занятия курса Маслоу",
          },
        ],
        mentions: [{ courseId: "maslow", surface: "Маслоу", role: "ACTIVE" }],
      }),
    })).response,
  );
  assert.match(overlappingBody.message, /окно набора: авторитетного значения нет/u);
  assert.match(overlappingBody.message, /расписание: авторитетного значения нет/u);
  assert.doesNotMatch(overlappingBody.message, COMMERCIAL_PRICE);
});

test("contradictory same-surface roles do not authorize Maslow commercial metadata", async () => {
  const priceText = "Маслоу исключаю; сколько стоит курс для меня";
  const contextText = "Маслоу упомянут только для контекста; сколько стоит курс для меня";
  const cases: Array<{
    content: string;
    type: "PRICE" | "ENROLLMENT_WINDOW";
    courseIds: string[];
    evidence: string;
    mentions: Array<{ courseId: string | null; surface: string; role: string }>;
    selectedCourseId?: string;
  }> = [
    {
      content: priceText,
      type: "PRICE",
      courseIds: ["maslow"],
      evidence: priceText,
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
      ],
    },
    {
      content: priceText,
      type: "PRICE",
      courseIds: ["maslow"],
      evidence: priceText,
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
        { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
      ],
      selectedCourseId: "maslow",
    },
    {
      content: "Маслоу исключаю; когда будет набор",
      type: "ENROLLMENT_WINDOW",
      courseIds: ["maslow"],
      evidence: "Маслоу исключаю; когда будет набор",
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
      ],
    },
    {
      content: "Нет, Маслоу исключаю; когда будет набор на курс Нормативная ситуация",
      type: "ENROLLMENT_WINDOW",
      courseIds: ["maslow"],
      evidence: "Нет, Маслоу исключаю; когда будет набор на курс Нормативная ситуация",
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
        { courseId: "normative-situation", surface: "Нормативная ситуация", role: "BACKGROUND" },
      ],
    },
  ];
  for (const role of ["BACKGROUND", "RETRACTED", "REPORTED"] as const) {
    for (const nonActiveFirst of [true, false]) {
      const pair = [
        { courseId: "maslow", surface: "Маслоу", role },
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
      ];
      cases.push({
        content: contextText,
        type: "PRICE",
        courseIds: ["maslow"],
        evidence: contextText,
        mentions: nonActiveFirst ? pair : [...pair].reverse(),
      });
    }
  }
  cases.push({
    content: "Маслоу не беру. Маслоу: сколько стоит курс для меня",
    type: "PRICE",
    courseIds: ["maslow"],
    evidence: "Маслоу не беру. Маслоу: сколько стоит курс для меня",
    mentions: [
      { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
      { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
    ],
  });

  for (const item of cases) {
    const { response } = await rejectedTurn(item.content, {
      state: item.selectedCourseId
        ? { courseMatch: "MATCHED", selectedCourseId: item.selectedCourseId }
        : undefined,
      plan: taskPlan({
        tasks: [{ type: item.type, courseIds: item.courseIds, evidence: item.evidence }],
        mentions: item.mentions,
      }),
    });
    const success = await readSuccess(response);
    assert.doesNotMatch(success.message, COMMERCIAL_PRICE, item.content);
    assert.doesNotMatch(success.message, /окно набора/u, item.content);
    assert.match(success.message, /не разобрал/u, item.content);
    assert.doesNotMatch(success.message, PAYMENT_MARKERS, item.content);
    if (item.selectedCourseId) {
      assert.equal(success.conversationState.selectedCourseId, item.selectedCourseId);
    } else {
      assert.equal(success.conversationState.selectedCourseId, null);
    }
  }
});

test("duplicate active mentions and a distinct-course correction stay grounded", async () => {
  const priced = await readSuccess(
    (await rejectedTurn("Сколько стоит курс Маслоу", {
      plan: taskPlan({
        tasks: [{
          type: "PRICE",
          courseIds: ["maslow"],
          evidence: "Сколько стоит курс Маслоу",
        }],
        mentions: [
          { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
          { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
        ],
      }),
    })).response,
  );
  assert.match(priced.message, /60[\s\u00a0]?000/u);
  assert.doesNotMatch(priced.message, PAYMENT_MARKERS);

  const correction = "Нет, Маслоу исключаю; когда будет набор на курс Нормативная ситуация";
  const corrected = await orchestrateNavigatorResponse(
    [{ role: "user", content: correction }],
    {
      profile: VY_PROFILE,
      requestId: "corr1-P15",
      dependencies: {
        classifyAct: async () => rejectAct(),
        extractPlan: async () => taskPlan({
          tasks: [{
            type: "ENROLLMENT_WINDOW",
            courseIds: ["normative-situation"],
            evidence: correction,
          }],
          mentions: [
            { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
            { courseId: "normative-situation", surface: "Нормативная ситуация", role: "ACTIVE" },
          ],
        }),
      },
    },
  );
  assert.equal(corrected.conversationAct.state, "FACTUAL");
  if (corrected.conversationAct.state === "FACTUAL") {
    const metadata = corrected.conversationAct.intents.find(
      (intent) => intent.kind === "CURRENT_METADATA",
    );
    assert.equal(metadata?.kind, "CURRENT_METADATA");
    if (metadata?.kind === "CURRENT_METADATA") {
      assert.deepEqual(metadata.courseIds, ["normative-situation"]);
    }
  }
  assert.match(corrected.message, /окно набора: авторитетного значения нет/u);
  assert.doesNotMatch(corrected.message, COMMERCIAL_PRICE);
  assert.equal(corrected.completion, "PARTIAL_WITH_EXPLICIT_LIMITATIONS");

  const ordinary = await readSuccess(
    (await rejectedTurn(T12_QUESTION, {
      plan: groundedEnrollmentPlan(routedText(T12_QUESTION), "maslow", "Маслоу"),
    })).response,
  );
  assert.match(ordinary.message, /окно набора: авторитетного значения нет/u);
  assert.match(ordinary.message, /26 октября 2026 года/u);
  assert.doesNotMatch(ordinary.message, COMMERCIAL_PRICE);
  assert.doesNotMatch(ordinary.message, PAYMENT_MARKERS);
});

test("overlapping source intervals do not authorize contradictory Maslow metadata", async () => {
  const decline: Array<{
    content: string;
    type: "PRICE" | "ENROLLMENT_WINDOW";
    mentions: Array<{ courseId: string | null; surface: string; role: string }>;
    selectedCourseId?: string;
  }> = [];
  const nestedTexts = [
    "Курс Маслоу исключаю; сколько стоит курс для меня",
    "курс Маслоу исключаю; сколько стоит курс для меня",
    "полный курс Маслоу исключаю; сколько стоит курс для меня",
    "Курс «Маслоу» исключаю; сколько стоит курс для меня",
  ];
  const nestedSurfaces = [
    ["Маслоу", "Курс Маслоу"],
    ["Маслоу", "курс Маслоу"],
    ["Маслоу", "полный курс Маслоу"],
    ["Маслоу", "«Маслоу»"],
  ];
  for (const [index, content] of nestedTexts.entries()) {
    const [narrow, wide] = nestedSurfaces[index];
    for (const role of ["REJECTED", "BACKGROUND", "RETRACTED", "REPORTED"] as const) {
      for (const nonActiveFirst of [true, false]) {
        const pair = [
          { courseId: "maslow", surface: narrow, role },
          { courseId: "maslow", surface: wide, role: "ACTIVE" },
        ];
        decline.push({
          content,
          type: "PRICE",
          mentions: nonActiveFirst ? pair : [...pair].reverse(),
        });
      }
    }
  }
  for (const nonActiveFirst of [true, false]) {
    const pair = [
      { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
      { courseId: "maslow", surface: "Курс Маслоу", role: "ACTIVE" },
    ];
    decline.push({
      content: "Курс Маслоу исключаю; когда будет набор",
      type: "ENROLLMENT_WINDOW",
      mentions: nonActiveFirst ? pair : [...pair].reverse(),
    });
  }
  const partial = "Маслоу курс цена для меня";
  const suffix = "Маслоу исключаю; сколько стоит курс для меня";
  for (const item of [
    { content: partial, left: "Маслоу курс", right: "курс цена" },
    { content: suffix, left: "аслоу", right: "Маслоу" },
  ]) {
    for (const rejectLeft of [true, false]) {
      for (const nonActiveFirst of [true, false]) {
        const pair = [
          {
            courseId: "maslow",
            surface: rejectLeft ? item.left : item.right,
            role: "REJECTED",
          },
          {
            courseId: "maslow",
            surface: rejectLeft ? item.right : item.left,
            role: "ACTIVE",
          },
        ];
        decline.push({
          content: item.content,
          type: "PRICE",
          mentions: nonActiveFirst ? pair : [...pair].reverse(),
        });
      }
    }
  }
  for (const item of [
    {
      content: "Маслоу не беру. Маслоу: сколько стоит курс для меня",
      narrow: "Маслоу",
      wide: "Маслоу",
    },
    {
      content: "Курс Маслоу один. Курс Маслоу два. Сколько это стоит",
      narrow: "Маслоу",
      wide: "Курс Маслоу",
    },
    {
      content: "Маслоу, затем Маслоу, затем курс Маслоу: сколько стоит",
      narrow: "Маслоу",
      wide: "курс Маслоу",
    },
    {
      content: "Сколько стоит курс Маслоу",
      narrow: "иерархия потребностей",
      wide: "Маслоу",
    },
  ]) {
    for (const nonActiveFirst of [true, false]) {
      const pair = [
        { courseId: "maslow", surface: item.narrow, role: "REJECTED" },
        { courseId: "maslow", surface: item.wide, role: "ACTIVE" },
      ];
      decline.push({
        content: item.content,
        type: "PRICE",
        mentions: nonActiveFirst ? pair : [...pair].reverse(),
      });
    }
  }
  for (const selectedCourseId of ["maslow", "play-and-creativity"]) {
    decline.push({
      content: "Курс Маслоу исключаю; сколько стоит курс для меня",
      type: "PRICE",
      selectedCourseId,
      mentions: [
        { courseId: "maslow", surface: "Курс Маслоу", role: "ACTIVE" },
        { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
      ],
    });
  }

  for (const item of decline) {
    const success = await readSuccess(
      (await rejectedTurn(item.content, {
        state: item.selectedCourseId
          ? { courseMatch: "MATCHED", selectedCourseId: item.selectedCourseId }
          : undefined,
        plan: taskPlan({
          tasks: [{ type: item.type, courseIds: ["maslow"], evidence: item.content }],
          mentions: item.mentions,
        }),
      })).response,
    );
    assert.doesNotMatch(success.message, COMMERCIAL_PRICE, item.content);
    assert.doesNotMatch(success.message, /окно набора/u, item.content);
    assert.match(success.message, /не разобрал/u, item.content);
    assert.doesNotMatch(success.message, PAYMENT_MARKERS, item.content);
    assert.equal(success.contactCard, null, item.content);
    assert.equal(
      success.conversationState.selectedCourseId,
      item.selectedCourseId ?? null,
      item.content,
    );
  }
});

test("provably disjoint occurrences and active-only overlaps stay grounded", async () => {
  const disjoint = "Маслоу исключаю. Сколько стоит иерархия потребностей";
  for (const nonActiveFirst of [true, false]) {
    const pair = [
      { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
      { courseId: "maslow", surface: "иерархия потребностей", role: "ACTIVE" },
    ];
    const priced = await readSuccess(
      (await rejectedTurn(disjoint, {
        plan: taskPlan({
          tasks: [{ type: "PRICE", courseIds: ["maslow"], evidence: disjoint }],
          mentions: nonActiveFirst ? pair : [...pair].reverse(),
        }),
      })).response,
    );
    assert.match(priced.message, /60[\s\u00a0]?000/u, disjoint);
    assert.doesNotMatch(priced.message, PAYMENT_MARKERS, disjoint);
    assert.equal(priced.contactCard, null);
  }

  const activeOverlap = await readSuccess(
    (await rejectedTurn("Сколько стоит курс Маслоу", {
      plan: taskPlan({
        tasks: [{
          type: "PRICE",
          courseIds: ["maslow"],
          evidence: "Сколько стоит курс Маслоу",
        }],
        mentions: [
          { courseId: "maslow", surface: "курс Маслоу", role: "ACTIVE" },
          { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
        ],
      }),
    })).response,
  );
  assert.match(activeOverlap.message, /60[\s\u00a0]?000/u);
  assert.doesNotMatch(activeOverlap.message, PAYMENT_MARKERS);
});

test("the IV1 overlap plan replays the limitation without a Maslow price", async () => {
  const content = "Курс Маслоу исключаю; сколько стоит курс для меня";
  const counters = zeroCounters();
  const dependencies = orchestration({
    counters,
    classify: async () => rejectAct(),
    plan: taskPlan({
      tasks: [{ type: "PRICE", courseIds: ["maslow"], evidence: content }],
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
        { courseId: "maslow", surface: "Курс Маслоу", role: "ACTIVE" },
      ],
    }),
  });
  const first = await readSuccess(
    await chat(
      {
        messages: [{ role: "user", content }],
        profile: VY_PROFILE,
        conversationState: initialState(),
        requestId: "corr2-overlap",
      },
      dependencies,
    ),
  );
  assert.doesNotMatch(first.message, COMMERCIAL_PRICE);
  assert.match(first.message, /не разобрал/u);
  assert.equal(first.contactCard, null);
  assert.equal(first.conversationState.execution.lastCompletedRequestId, "corr2-overlap");
  assert.equal(counters.extract, 1);

  const replay = await readSuccess(
    await chat(
      {
        messages: [
          { role: "user", content },
          { role: "assistant", content: first.message },
          { role: "user", content },
        ],
        profile: VY_PROFILE,
        conversationState: first.conversationState,
        requestId: "corr2-overlap",
      },
      dependencies,
    ),
  );
  assert.equal(counters.extract, 1);
  assert.equal(counters.classify, 1);
  assert.equal(replay.message, first.message);
  assert.doesNotMatch(replay.message, COMMERCIAL_PRICE);
});

/**
 * Frozen Option C matrix for M03 trust-boundary authorization.
 * Declared before the production behavior assertions below.
 *
 * Generation: the row list is the §11 decision matrix, in order. Reachable
 * non-F-1 rows are checked through handleChatRequest with injected plans.
 * Structural RP rows stay on the existing validator/technical lane. Interval
 * expectations come from an independent UTF-16 oracle that advances one code
 * unit and does not normalize. A second oracle advances by surface length and
 * is used only to prove that the self-overlap case is invisible to that
 * shortcut. No production exception is keyed to a particular string.
 */
const FROZEN_M03_MATRIX_ROWS = [
  "invalid mention shape",
  "unknown non-null id",
  "array course id",
  "mentions null",
  "invalid task shape",
  "existing contextual veto",
  "empty surface",
  "surface absent from latest",
  "surface only in history",
  "short non-active overlap",
  "short non-active disjoint",
  "short active unrecognized",
  "corroborated active",
  "whitespace or punctuation",
  "surrogate combining sequence",
  "raw-absent variant",
  "raw-present variant",
  "target absent from evidence resolver",
  "empty course ids with stored selection",
  "rejected-only local claims",
  "other non-active-only local claims",
  "same occurrence opposing roles",
  "identical opposing surfaces",
  "nested or partial overlap",
  "repeated ambiguous pairing",
  "provably disjoint same-course roles",
  "duplicate corroborated active",
  "active-only nested aliases",
  "local active plus unlocated active",
  "located active with wrong id",
  "null active inside evidence",
  "null active outside evidence",
  "null non-active disjoint context",
  "null or different id overlaps support",
  "same surface assigned two ids",
  "surface exposes a different declared id",
  "separate other-course occurrence",
  "extra resolver id without explanation",
  "extra active identity inside evidence",
  "missing mention single-target fallback",
  "missing mention with multiple targets",
  "several separable targets",
  "rejected maslow active normative",
  "non-active task overlaps support",
  "non-active task provably disjoint",
  "surface outside evidence is not a witness",
  "repeated evidence embeddings",
  "merged constituent failure",
  "supported price after provenance",
  "unavailable price after provenance",
  "unavailable guarded field after provenance",
  "supported guarded field stays declined",
  "accepted non-metadata segment",
  "mapping demotion",
  "existing clarification path",
  "plan rejected or extraction failure",
  "payment veto or binding conflict",
  "normally classified factual",
  "exact F-1 recovery",
  "incomplete inspection refuses",
] as const;

const MASLOW_TITLE = "Иерархия потребностей А. Маслоу: новая парадигма";
const PLAY_TITLE = "Игра и творчество в жизни взрослых людей";
const LEVELS_TITLE = "Иерархия уровней сознания";
const STAGES_TITLE = "Стадии профессионального развития взрослого человека";
const NON_ACTIVE_ROLES = ["BACKGROUND", "REJECTED", "RETRACTED", "REPORTED"] as const;

type MentionRecord = { courseId: string | null; surface: string; role: string };

function oracleIntervals(source: string, surface: string): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  if (surface.length === 0) return found;
  for (let start = 0; start <= source.length - surface.length; start += 1) {
    if (source.startsWith(surface, start)) found.push([start, start + surface.length]);
  }
  return found;
}

function oracleOverlaps(source: string, left: string, right: string): boolean {
  const first = oracleIntervals(source, left);
  const second = oracleIntervals(source, right);
  return first.some((one) => second.some((two) => one[0] < two[1] && two[0] < one[1]));
}

function lengthStepOverlaps(source: string, left: string, right: string): boolean {
  const collect = (surface: string): Array<[number, number]> => {
    const found: Array<[number, number]> = [];
    if (surface.length === 0) return found;
    let from = 0;
    while (from <= source.length) {
      const start = source.indexOf(surface, from);
      if (start < 0) break;
      found.push([start, start + surface.length]);
      from = start + surface.length;
    }
    return found;
  };
  const first = collect(left);
  const second = collect(right);
  return first.some((one) => second.some((two) => one[0] < two[1] && two[0] < one[1]));
}

function assertMaslowPrice(message: string, label: string): void {
  assert.match(message, /60[\s\u00a0]?000/u, label);
  assert.ok(message.includes(MASLOW_TITLE), label);
  assert.equal(message.includes(PLAY_TITLE), false, label);
  assert.equal(message.includes(LEVELS_TITLE), false, label);
  assert.doesNotMatch(message, PAYMENT_MARKERS, label);
}

function assertNoCommercialFact(message: string, label: string): void {
  assert.match(message, /не разобрал/u, label);
  assert.doesNotMatch(message, COMMERCIAL_PRICE, label);
  assert.doesNotMatch(message, /45[\s\u00a0]?000/u, label);
  assert.doesNotMatch(message, /200[\s\u00a0]?000/u, label);
  assert.doesNotMatch(message, PAYMENT_MARKERS, label);
  assert.equal(message.includes(PLAY_TITLE), false, label);
  assert.equal(message.includes(LEVELS_TITLE), false, label);
  assert.equal(message.includes(MASLOW_TITLE), false, label);
}

async function priceTurn(
  content: string,
  mentions: readonly MentionRecord[],
  options: {
    evidence?: string;
    courseIds?: string[];
    selectedCourseId?: string;
    tasks?: Array<{ type: string; courseIds: string[]; evidence: string; role?: string }>;
  } = {},
): Promise<SuccessBody> {
  const success = await readSuccess(
    (await rejectedTurn(content, {
      state: options.selectedCourseId
        ? { courseMatch: "MATCHED", selectedCourseId: options.selectedCourseId }
        : undefined,
      plan: taskPlan({
        tasks: options.tasks ?? [{
          type: "PRICE",
          courseIds: options.courseIds ?? ["maslow"],
          evidence: options.evidence ?? content,
        }],
        mentions: [...mentions],
      }),
    })).response,
  );
  assert.equal(success.contactCard, null, content);
  return success;
}

test("frozen M03 matrix is the §11 row set", () => {
  assert.equal(FROZEN_M03_MATRIX_ROWS.length, 60);
  assert.equal(new Set(FROZEN_M03_MATRIX_ROWS).size, 60);
});

test("original overlapping and short surfaces decline for every non-active role and order", async () => {
  const text = "Курс Маслоу исключаю; сколько стоит курс для меня";
  assert.equal(oracleOverlaps(text, "Маслоу", "Курс Маслоу"), true);
  assert.equal(oracleOverlaps(text, "Ма", "Курс Маслоу"), true);
  assert.deepEqual(oracleIntervals(text, "Ма"), [[5, 7]]);
  assert.deepEqual(oracleIntervals(text, "Курс Маслоу"), [[0, 11]]);
  for (const surface of ["Маслоу", "Ма"]) {
    for (const role of NON_ACTIVE_ROLES) {
      for (const nonActiveFirst of [true, false]) {
        for (const selectedCourseId of [undefined, "maslow", "play-and-creativity", "structural-typology"] as const) {
          const pair = [
            { courseId: "maslow", surface, role },
            { courseId: "maslow", surface: "Курс Маслоу", role: "ACTIVE" },
          ];
          const success = await priceTurn(text, nonActiveFirst ? pair : [...pair].reverse(), {
            selectedCourseId,
          });
          assertNoCommercialFact(success.message, `${surface}/${role}/${String(nonActiveFirst)}/${selectedCourseId ?? "none"}`);
          assert.equal(success.conversationState.selectedCourseId, selectedCourseId ?? null);
          assert.equal(success.conversationState.execution.lastCompletedRequestId, "arch-remediation");
        }
      }
    }
  }
});

test("the short-surface limitation replays without a second extraction", async () => {
  const content = "Курс Маслоу исключаю; сколько стоит курс для меня";
  const counters = zeroCounters();
  const dependencies = orchestration({
    counters,
    classify: async () => rejectAct(),
    plan: taskPlan({
      tasks: [{ type: "PRICE", courseIds: ["maslow"], evidence: content }],
      mentions: [
        { courseId: "maslow", surface: "Ма", role: "REJECTED" },
        { courseId: "maslow", surface: "Курс Маслоу", role: "ACTIVE" },
      ],
    }),
  });
  const first = await readSuccess(await chat({
    messages: [{ role: "user", content }],
    profile: VY_PROFILE,
    conversationState: initialState(),
    requestId: "m03-short-surface",
  }, dependencies));
  assertNoCommercialFact(first.message, "first");
  assert.equal(first.conversationState.execution.lastCompletedRequestId, "m03-short-surface");
  assert.equal(counters.extract, 1);
  const replay = await readSuccess(await chat({
    messages: [
      { role: "user", content },
      { role: "assistant", content: first.message },
      { role: "user", content },
    ],
    profile: VY_PROFILE,
    conversationState: first.conversationState,
    requestId: "m03-short-surface",
  }, dependencies));
  assert.equal(counters.extract, 1);
  assert.equal(counters.classify, 1);
  assert.equal(replay.message, first.message);
  assert.equal(replay.contactCard, null);
});

test("positive provenance controls keep the authorized course and ceiling", async () => {
  const ordinary = await priceTurn("Сколько стоит курс Маслоу", [
    { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
  ]);
  assertMaslowPrice(ordinary.message, "ordinary");

  const omitted = await priceTurn("Сколько стоит курс Маслоу", []);
  assertMaslowPrice(omitted.message, "missing-mention fallback");

  const duplicate = await priceTurn("Сколько стоит курс Маслоу", [
    { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
    { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
  ]);
  assertMaslowPrice(duplicate.message, "duplicate active");

  const nested = await priceTurn("Сколько стоит курс Маслоу", [
    { courseId: "maslow", surface: "курс Маслоу", role: "ACTIVE" },
    { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
  ]);
  assertMaslowPrice(nested.message, "nested active");

  const disjoint = "Маслоу исключаю. Сколько стоит иерархия потребностей";
  assert.equal(oracleOverlaps(disjoint, "Маслоу", "иерархия потребностей"), false);
  assert.deepEqual(oracleIntervals(disjoint, "Маслоу"), [[0, 6]]);
  assert.deepEqual(oracleIntervals(disjoint, "иерархия потребностей"), [[31, 52]]);
  for (const nonActiveFirst of [true, false]) {
    const pair = [
      { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
      { courseId: "maslow", surface: "иерархия потребностей", role: "ACTIVE" },
    ];
    const priced = await priceTurn(disjoint, nonActiveFirst ? pair : [...pair].reverse());
    assertMaslowPrice(priced.message, "documented disjoint control");
  }

  const touching = "Маслоуиерархия потребностей сколько стоит";
  assert.equal(oracleOverlaps(touching, "Маслоу", "иерархия потребностей"), false);
  assert.deepEqual(oracleIntervals(touching, "Маслоу"), [[0, 6]]);
  assert.deepEqual(oracleIntervals(touching, "иерархия потребностей"), [[6, 27]]);
  const touched = await priceTurn(touching, [
    { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
    { courseId: "maslow", surface: "иерархия потребностей", role: "ACTIVE" },
  ]);
  assertMaslowPrice(touched.message, "touching endpoints");

  const shortDisjoint = "Ма исключаю. Сколько стоит иерархия потребностей";
  assert.equal(oracleOverlaps(shortDisjoint, "Ма", "иерархия потребностей"), false);
  const shortOk = await priceTurn(shortDisjoint, [
    { courseId: "maslow", surface: "Ма", role: "REJECTED" },
    { courseId: "maslow", surface: "иерархия потребностей", role: "ACTIVE" },
  ]);
  assertMaslowPrice(shortOk.message, "short disjoint");

  const spaced = "Сколько стоит Маслоу";
  const spacedOk = await priceTurn(spaced, [
    { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
    { courseId: null, surface: " ", role: "BACKGROUND" },
  ]);
  assertMaslowPrice(spacedOk.message, "whitespace constraint");

  const marked = `е\u0301. Сколько стоит иерархия потребностей`;
  assert.equal(oracleOverlaps(marked, "е\u0301", "иерархия потребностей"), false);
  const markedOk = await priceTurn(marked, [
    { courseId: null, surface: "е\u0301", role: "BACKGROUND" },
    { courseId: "maslow", surface: "иерархия потребностей", role: "ACTIVE" },
  ]);
  assertMaslowPrice(markedOk.message, "combining mark disjoint");

  const stages = "Сколько стоит курс стадии профессионального развития";
  const unavailable = await priceTurn(stages, [
    { courseId: "professional-development-stages", surface: "стадии профессионального развития", role: "ACTIVE" },
  ], { courseIds: ["professional-development-stages"] });
  assert.ok(unavailable.message.includes(STAGES_TITLE), unavailable.message);
  assert.match(unavailable.message, /подтверждённой цены/u);
  assert.doesNotMatch(unavailable.message, /60[\s\u00a0]?000/u);
  assert.doesNotMatch(unavailable.message, PAYMENT_MARKERS);
});

test("cross-id, null, unlocated and ambiguous provenance refuse without substitution", async () => {
  const overlap = "Курс Маслоу исключаю; сколько стоит курс для меня";
  const selfOverlap = "Сколько стоит МММаслоу";
  assert.equal(oracleOverlaps(selfOverlap, "ММ", "Маслоу"), true);
  assert.equal(lengthStepOverlaps(selfOverlap, "ММ", "Маслоу"), false);
  const emoji = "Сколько стоит 🙂Маслоу";
  assert.equal("🙂".length, 2);
  assert.equal(oracleOverlaps(emoji, "🙂", "🙂Маслоу"), true);

  const declines: Array<{ label: string; content: string; mentions: MentionRecord[]; evidence?: string; courseIds?: string[] }> = [
    {
      label: "self-overlap",
      content: selfOverlap,
      mentions: [
        { courseId: "maslow", surface: "ММ", role: "REJECTED" },
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
      ],
    },
    {
      label: "emoji overlap",
      content: emoji,
      mentions: [
        { courseId: "maslow", surface: "🙂", role: "REJECTED" },
        { courseId: "maslow", surface: "🙂Маслоу", role: "ACTIVE" },
      ],
    },
    {
      label: "empty surface",
      content: "Сколько стоит курс Маслоу",
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
        { courseId: null, surface: "", role: "BACKGROUND" },
      ],
    },
    {
      label: "unlocated active",
      content: "Сколько стоит курс Маслоу",
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
        { courseId: "maslow", surface: "МАСЛОУ", role: "ACTIVE" },
      ],
    },
    {
      label: "unlocated other id",
      content: "Сколько стоит курс Маслоу",
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
        { courseId: "levels-of-consciousness", surface: "несуществующая поверхность", role: "BACKGROUND" },
      ],
    },
    {
      label: "same surface two ids",
      content: "Сколько стоит курс Маслоу",
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
        { courseId: "levels-of-consciousness", surface: "Маслоу", role: "BACKGROUND" },
      ],
    },
    {
      label: "null active inside",
      content: overlap,
      mentions: [
        { courseId: null, surface: "Ма", role: "ACTIVE" },
        { courseId: "maslow", surface: "Курс Маслоу", role: "ACTIVE" },
      ],
    },
    {
      label: "wrong declared id",
      content: "Сколько стоит курс Маслоу",
      mentions: [
        { courseId: "levels-of-consciousness", surface: "Маслоу", role: "ACTIVE" },
      ],
      courseIds: ["maslow"],
    },
    {
      label: "surface exposes another id",
      content: "Маслоу исключаю. Сколько стоит иерархия потребностей",
      mentions: [
        { courseId: null, surface: "Маслоу", role: "BACKGROUND" },
        { courseId: "maslow", surface: "иерархия потребностей", role: "ACTIVE" },
      ],
    },
    {
      label: "ambiguous repeated pairing",
      content: "Маслоу исключаю. Сколько стоит курс Маслоу",
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "REJECTED" },
        { courseId: "maslow", surface: "курс Маслоу", role: "ACTIVE" },
      ],
    },
    {
      label: "short active is not a witness",
      content: overlap,
      mentions: [
        { courseId: "maslow", surface: "Ма", role: "ACTIVE" },
      ],
    },
    {
      label: "extra course without explanation",
      content: "Сколько стоит курс Маслоу и Нормативная ситуация",
      mentions: [
        { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
        { courseId: "normative-situation", surface: "ситуация", role: "REJECTED" },
      ],
    },
  ];
  for (const item of declines) {
    if (item.label === "ambiguous repeated pairing") {
      assert.equal(oracleOverlaps(item.content, "Маслоу", "курс Маслоу"), true);
    }
    const success = await priceTurn(item.content, item.mentions, {
      evidence: item.evidence,
      courseIds: item.courseIds,
    });
    assertNoCommercialFact(success.message, item.label);
    assert.equal(success.conversationState.selectedCourseId, null, item.label);
  }

  for (const selectedCourseId of ["maslow", "play-and-creativity", "structural-typology"] as const) {
    const success = await priceTurn(overlap, [
      { courseId: null, surface: "Ма", role: "ACTIVE" },
      { courseId: "maslow", surface: "Курс Маслоу", role: "ACTIVE" },
    ], { selectedCourseId });
    assertNoCommercialFact(success.message, selectedCourseId);
    assert.equal(success.conversationState.selectedCourseId, selectedCourseId);
  }

  const outside = await priceTurn(
    "Пришлите список. Сколько стоит иерархия потребностей",
    [
      { courseId: null, surface: "Пришлите", role: "ACTIVE" },
      { courseId: "maslow", surface: "иерархия потребностей", role: "ACTIVE" },
    ],
    { evidence: "Сколько стоит иерархия потребностей" },
  );
  assertMaslowPrice(outside.message, "null active outside evidence");
  assert.ok(outside.message.includes("Пришлите"), outside.message);

  const history = await readSuccess(await chat({
    messages: [
      { role: "user", content: "Маслоу" },
      { role: "assistant", content: "Понятно." },
      { role: "user", content: "сколько стоит курс для меня" },
    ],
    profile: VY_PROFILE,
    conversationState: initialState(),
    requestId: "m03-history-surface",
  }, orchestration({
    counters: zeroCounters(),
    classify: async () => rejectAct(),
    plan: taskPlan({
      tasks: [{ type: "PRICE", courseIds: ["maslow"], evidence: "сколько стоит курс для меня" }],
      mentions: [{ courseId: "maslow", surface: "Маслоу", role: "ACTIVE" }],
    }),
  })));
  assertNoCommercialFact(history.message, "history-only surface");
});

test("record order, duplication and merged or inactive tasks stay total", async () => {
  const text = "Курс Маслоу исключаю; сколько стоит курс для меня. Покажите пример";
  const records: MentionRecord[] = [
    { courseId: "maslow", surface: "Ма", role: "REJECTED" },
    { courseId: "maslow", surface: "Курс Маслоу", role: "ACTIVE" },
    { courseId: null, surface: "Покажите пример", role: "BACKGROUND" },
  ];
  const permutations: MentionRecord[][] = [];
  const walk = (remaining: MentionRecord[], chosen: MentionRecord[]): void => {
    if (remaining.length === 0) {
      permutations.push(chosen);
      return;
    }
    for (let index = 0; index < remaining.length; index += 1) {
      walk(
        remaining.filter((_, item) => item !== index),
        [...chosen, remaining[index]],
      );
    }
  };
  walk(records, []);
  assert.equal(permutations.length, 6);
  for (const mentions of permutations) {
    const success = await priceTurn(text, mentions);
    assertNoCommercialFact(success.message, JSON.stringify(mentions.map((item) => item.role)));
  }

  const base = [
    { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
    { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
  ];
  const accepted = await priceTurn("Сколько стоит курс Маслоу", base);
  assertMaslowPrice(accepted.message, "duplicate baseline");
  for (const index of [0, 1, 2]) {
    const mentions = [...base];
    mentions.splice(index, 0, { courseId: "maslow", surface: "МАСЛОУ", role: "ACTIVE" });
    const success = await priceTurn("Сколько стоит курс Маслоу", mentions);
    assertNoCommercialFact(success.message, `inserted at ${index}`);
  }

  const separated = "Маслоу исключаю. Сколько стоит иерархия потребностей";
  const separatedPrice = await priceTurn(separated, [
    { courseId: "maslow", surface: "иерархия потребностей", role: "ACTIVE" },
  ], {
    evidence: "Сколько стоит иерархия потребностей",
    tasks: [
      {
        type: "PRICE",
        courseIds: ["maslow"],
        evidence: "Сколько стоит иерархия потребностей",
      },
      {
        type: "PRICE",
        courseIds: ["maslow"],
        role: "REJECTED",
        evidence: "Маслоу исключаю",
      },
    ],
  });
  assertMaslowPrice(separatedPrice.message, "disjoint inactive task");
  assert.ok(separatedPrice.message.includes("Маслоу исключаю"), separatedPrice.message);

  const opposed = await priceTurn(
    "Курс Маслоу исключаю и сколько стоит курс Маслоу",
    [{ courseId: "maslow", surface: "Маслоу", role: "ACTIVE" }],
    {
      tasks: [
        {
          type: "PRICE",
          courseIds: ["maslow"],
          evidence: "сколько стоит курс Маслоу",
        },
        {
          type: "PRICE",
          courseIds: ["maslow"],
          role: "REJECTED",
          evidence: "Курс Маслоу исключаю",
        },
      ],
    },
  );
  assertNoCommercialFact(opposed.message, "inactive task overlap");

  const merged = "Сколько стоит курс Маслоу. Когда будет набор на курс Маслоу и Нормативная ситуация";
  const mergedBody = await priceTurn(merged, [
    { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
    { courseId: "normative-situation", surface: "Нормативная ситуация", role: "ACTIVE" },
  ], {
    tasks: [
      { type: "PRICE", courseIds: ["maslow"], evidence: "Сколько стоит курс Маслоу" },
      {
        type: "ENROLLMENT_WINDOW",
        courseIds: ["maslow"],
        evidence: "Когда будет набор на курс Маслоу и Нормативная ситуация",
      },
    ],
  });
  assertNoCommercialFact(mergedBody.message, "merged constituent");
  assert.ok(mergedBody.message.includes("Сколько стоит курс Маслоу"), mergedBody.message);
  assert.ok(
    mergedBody.message.includes("Когда будет набор на курс Маслоу и Нормативная ситуация"),
    mergedBody.message,
  );
  assert.doesNotMatch(mergedBody.message, /окно набора/u);

  const repeated = "Сколько стоит иерархия потребностей. Маслоу сколько стоит иерархия потребностей";
  const laterEvidence = "Маслоу сколько стоит иерархия потребностей";
  assert.equal(oracleIntervals(repeated, "Сколько стоит иерархия потребностей").length, 1);
  assert.ok(oracleIntervals(repeated, "иерархия потребностей").length > 1);
  assert.equal(oracleOverlaps(repeated, laterEvidence, "иерархия потребностей"), true);
  assert.equal(
    oracleOverlaps(repeated, laterEvidence, "Сколько стоит иерархия потребностей"),
    false,
  );
  const repeatedBody = await priceTurn(repeated, [
    { courseId: "maslow", surface: "иерархия потребностей", role: "ACTIVE" },
  ], {
    evidence: "Сколько стоит иерархия потребностей",
    tasks: [
      {
        type: "PRICE",
        courseIds: ["maslow"],
        evidence: "Сколько стоит иерархия потребностей",
      },
      {
        type: "PRICE",
        courseIds: ["maslow"],
        role: "REJECTED",
        evidence: laterEvidence,
      },
    ],
  });
  assertNoCommercialFact(repeatedBody.message, "later embedding collides with inactive scope");

  const separable = "Сколько стоит Маслоу и Нормативная ситуация";
  const both = await priceTurn(separable, [
    { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" },
    { courseId: "normative-situation", surface: "Нормативная ситуация", role: "ACTIVE" },
  ], { courseIds: ["maslow", "normative-situation"] });
  assert.match(both.message, /60[\s\u00a0]?000/u);
  assert.doesNotMatch(both.message, /45[\s\u00a0]?000/u);
  assert.ok(both.message.includes(MASLOW_TITLE), both.message);
  assert.ok(both.message.includes("Нормативная ситуация"), both.message);
  assert.equal(both.message.includes(PLAY_TITLE), false);
  const maslowAt = both.message.indexOf(MASLOW_TITLE);
  const normativeAt = both.message.indexOf("Нормативная ситуация");
  assert.ok(maslowAt >= 0 && normativeAt >= 0);
  for (const title of [MASLOW_TITLE, "Нормативная ситуация"]) {
    const line = both.message.split("\n").find((part) => part.includes(title));
    assert.ok(line, title);
    assert.match(line, /60[\s\u00a0]?000/u, title);
  }

  const missingMany = await priceTurn(separable, [], {
    courseIds: ["maslow", "normative-situation"],
  });
  assertNoCommercialFact(missingMany.message, "missing mention cannot assign two courses");

  const outsideNull = "Маслоу в стороне. Сколько стоит иерархия потребностей";
  assert.equal(oracleOverlaps(outsideNull, "Маслоу", "иерархия потребностей"), false);
  const separatedNull = await priceTurn(outsideNull, [
    { courseId: null, surface: "Маслоу", role: "BACKGROUND" },
    { courseId: "maslow", surface: "иерархия потребностей", role: "ACTIVE" },
  ], { evidence: "Сколько стоит иерархия потребностей" });
  assertMaslowPrice(separatedNull.message, "outside null alias stays separated");

  const lone = "\uD800Сколько стоит иерархия потребностей";
  assert.equal(oracleOverlaps(lone, "\uD800", "иерархия потребностей"), false);
  const loneOk = await priceTurn(lone, [
    { courseId: null, surface: "\uD800", role: "BACKGROUND" },
    { courseId: "maslow", surface: "иерархия потребностей", role: "ACTIVE" },
  ]);
  assertMaslowPrice(loneOk.message, "lone surrogate disjoint");

  const loneOverlap = "Сколько стоит \uD800иерархия потребностей";
  assert.equal(oracleOverlaps(loneOverlap, "\uD800", "\uD800иерархия потребностей"), true);
  const loneBad = await priceTurn(loneOverlap, [
    { courseId: "maslow", surface: "\uD800", role: "REJECTED" },
    { courseId: "maslow", surface: "\uD800иерархия потребностей", role: "ACTIVE" },
  ]);
  assertNoCommercialFact(loneBad.message, "lone surrogate overlap");
});

test("a supported guarded field stays declined by the existing composer predicate", () => {
  assert.equal(
    currentMetadataComposerAdmitsField("ENROLLMENT_WINDOW", {
      status: "SUPPORTED",
      value: 1,
    }),
    false,
  );
  assert.equal(
    currentMetadataComposerAdmitsField("SCHEDULE", {
      status: "UNAVAILABLE",
      reason: "NO_AUTHORITATIVE_VALUE",
    }),
    true,
  );
  assert.equal(
    currentMetadataComposerAdmitsField("COHORT", {
      status: "UNAVAILABLE",
      reason: "NO_AUTHORITATIVE_VALUE",
    }),
    true,
  );
  assert.equal(ACADEMY_COMMERCIAL_AUTHORITY_VERSION, "OWNER-COMMERCIAL-AUTHORITY-2026-10-26@2026-10-26");
  assert.equal(ACADEMY_COMMERCIAL_AUTHORITY.pricesRub.maslow.status, "SUPPORTED");
  if (ACADEMY_COMMERCIAL_AUTHORITY.pricesRub.maslow.status === "SUPPORTED") {
    assert.equal(ACADEMY_COMMERCIAL_AUTHORITY.pricesRub.maslow.value, 60_000);
  }
  assert.equal(
    ACADEMY_COMMERCIAL_AUTHORITY.transactionalMetadata.enrollmentWindow.status,
    "UNAVAILABLE",
  );
});

test("unknown mention identity remains a validator rejection, not a substituted price", async () => {
  const content = "Сколько стоит курс Маслоу";
  const { response } = await rejectedTurn(content, {
    plan: taskPlan({
      tasks: [{ type: "PRICE", courseIds: ["maslow"], evidence: content }],
      mentions: [{ courseId: "not-a-course", surface: "Маслоу", role: "ACTIVE" }],
    }),
  });
  const text = await response.text();
  assert.notEqual(response.status, 200, text);
  assert.doesNotMatch(text, /60[\s\u00a0]?000/u);
  assert.doesNotMatch(text, PAYMENT_MARKERS);
});

test("malformed mention containers stay on the validator rejection lane", async () => {
  const content = "Сколько стоит курс Маслоу";
  const task = { type: "PRICE", courseIds: ["maslow"], role: "ACTIVE", evidence: content };
  const plans = [
    { label: "mentions null", plan: { tasks: [task], mentions: null } },
    { label: "array course id", plan: { tasks: [task], mentions: [{ courseId: ["maslow"], surface: "Маслоу", role: "ACTIVE" }] } },
    { label: "invalid role", plan: { tasks: [task], mentions: [{ courseId: "maslow", surface: "Маслоу", role: "MAYBE" }] } },
    { label: "non-string surface", plan: { tasks: [task], mentions: [{ courseId: "maslow", surface: 12, role: "ACTIVE" }] } },
  ];
  for (const item of plans) {
    const { response } = await rejectedTurn(content, { plan: item.plan });
    const text = await response.text();
    assert.notEqual(response.status, 200, `${item.label}: ${text}`);
    assert.doesNotMatch(text, /60[\s\u00a0]?000/u, item.label);
    assert.doesNotMatch(text, PAYMENT_MARKERS, item.label);
  }
});

/**
 * CORR1 F1-RENDER-IV1 inventory. Frozen before the render correction.
 *
 * A. Merged SELECTED PRICE+PRICE. Text: "Сколько стоит этот курс; цена
 *    обучения интересует сейчас". Evidence: "Сколько стоит этот курс" and
 *    "цена обучения интересует сейчас". Mentions: []. Both task orders.
 *    Selected courses: maslow, normative-situation, play-and-creativity.
 *    Assert HTTP 200, that course's title and dated amount, no other course
 *    title, no course-name clarification, no payment destination, coverage
 *    facts for that course, completion ANSWERED, same-id replay, one extraction.
 * B. Merged SELECTED PRICE + ENROLLMENT_WINDOW for the same three courses and
 *    both task orders. Dated price, unavailable enrollment window, no invented
 *    start date or cohort, partial completion.
 * C. F-1 with no selected course keeps the course-name clarification and does
 *    not invent a course. An invalid selectedCourseId remains request
 *    validation failure.
 * D. Single SELECTED PRICE for the three courses, plus one explicit Maslow
 *    PRICE while another course is selected, stay on the existing factual path.
 * E. The same empty-id plan prices on the exact F-1 rejection only. NON_F1
 *    schema rejection and the similar COURSE_CONTENT field rejection do not
 *    inherit a stored course. Empty-id NON_F1 is repeated for no selection,
 *    maslow, play-and-creativity, and structural-typology.
 * The real validator twin of A/E is in intent-plan-integration.test.mts.
 */

const NORMATIVE_TITLE = "Нормативная ситуация";
const STRUCTURAL_TITLE = "Структурная типология личности с использованием типологии Майерс-Бриггс";
const COURSE_NAME_CLARIFICATION = /Уточните, пожалуйста, название курса/u;
const F1_PRICE_TEXT = "Сколько стоит этот курс; цена обучения интересует сейчас";
const F1_WINDOW_TEXT = "Сколько стоит этот курс? Когда будет набор? IV1конец";
const STORED_DEFERRED = "Вернитесь к этому вопросу позже";
const F1_SELECTED_COURSES = [
  { id: "maslow", title: MASLOW_TITLE, amount: /60[\s\u00a0]?000/u },
  { id: "normative-situation", title: NORMATIVE_TITLE, amount: /60[\s\u00a0]?000/u },
  { id: "play-and-creativity", title: PLAY_TITLE, amount: /60[\s\u00a0]?000/u },
] as const;
const F1_OTHER_TITLES = [
  MASLOW_TITLE,
  PLAY_TITLE,
  LEVELS_TITLE,
  NORMATIVE_TITLE,
  STRUCTURAL_TITLE,
  STAGES_TITLE,
];

function f1PricePlan(order: "forward" | "reverse") {
  const tasks = [
    { type: "PRICE", courseIds: [] as string[], evidence: "Сколько стоит этот курс" },
    { type: "PRICE", courseIds: [] as string[], evidence: "цена обучения интересует сейчас" },
  ];
  return taskPlan({
    tasks: order === "forward" ? tasks : [...tasks].reverse(),
    mentions: [],
  });
}

function f1WindowPlan(order: "forward" | "reverse") {
  const tasks = [
    { type: "PRICE", courseIds: [] as string[], evidence: "Сколько стоит этот курс" },
    { type: "ENROLLMENT_WINDOW", courseIds: [] as string[], evidence: "Когда будет набор?" },
  ];
  return taskPlan({
    tasks: order === "forward" ? tasks : [...tasks].reverse(),
    mentions: [],
  });
}

function assertAttributedPrice(
  message: string,
  title: string,
  amount: RegExp,
  label: string,
): void {
  assert.match(message, amount, label);
  assert.equal(message.split(title).length - 1, 1, label);
  assert.match(message, /26 октября 2026 года/u, label);
  assert.equal(message.split("Коммерческие сведения ограничены").length - 1, 1, label);
  assert.doesNotMatch(message, COURSE_NAME_CLARIFICATION, label);
  assert.doesNotMatch(message, PAYMENT_MARKERS, label);
  assert.doesNotMatch(message, /200[\s\u00a0]?000/u, label);
  assert.doesNotMatch(message, /45[\s\u00a0]?000/u, label);
  for (const other of F1_OTHER_TITLES) {
    if (other === title) continue;
    assert.equal(message.includes(other), false, `${label}: ${other}`);
  }
}

function assertNoInventedCourse(message: string, label: string): void {
  assert.doesNotMatch(message, /60[\s\u00a0]?000/u, label);
  assert.doesNotMatch(message, /45[\s\u00a0]?000/u, label);
  assert.doesNotMatch(message, /200[\s\u00a0]?000/u, label);
  assert.doesNotMatch(message, PAYMENT_MARKERS, label);
  for (const title of F1_OTHER_TITLES) {
    assert.equal(message.includes(title), false, `${label}: ${title}`);
  }
}

async function f1CapturedTurn(input: {
  content: string;
  plan: unknown;
  requestId: string;
  mode: "F1" | "NON_F1" | "SIMILAR";
  counters: ProviderCounters;
  captured: { result: NavigatorOrchestrationResult | null };
  state?: Partial<ConversationState>;
  conversationState?: ConversationState;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<Response> {
  return chat(
    {
      messages: input.messages ?? [{ role: "user", content: input.content }],
      profile: VY_PROFILE,
      conversationState: input.conversationState ?? initialState(input.state),
      requestId: input.requestId,
    },
    orchestration({
      counters: input.counters,
      captured: input.captured,
      plan: input.plan,
      classify: async () => {
        if (input.mode === "F1") {
          throw new ConversationActDecisionValidationError(F1_REJECTION);
        }
        if (input.mode === "SIMILAR") {
          throw new ConversationActDecisionValidationError(
            "COURSE_CONTENT contains unsupported fields.",
          );
        }
        return rejectAct();
      },
    }),
  );
}

for (const course of F1_SELECTED_COURSES) {
  for (const order of ["forward", "reverse"] as const) {
    test(`CORR1 F-1 merged PRICE+PRICE ${course.id} ${order}`, async () => {
      const requestId = `corr1-price-${course.id}-${order}`;
      const counters = zeroCounters();
      const captured = { result: null as NavigatorOrchestrationResult | null };
      const success = await readSuccess(await f1CapturedTurn({
        content: F1_PRICE_TEXT,
        plan: f1PricePlan(order),
        requestId,
        mode: "F1",
        counters,
        captured,
        state: {
          courseMatch: "MATCHED",
          selectedCourseId: course.id,
          deferredRequest: STORED_DEFERRED,
        },
      }));
      assertAttributedPrice(success.message, course.title, course.amount, requestId);
      assert.equal(success.contactCard, null);
      assert.equal(success.conversationState.selectedCourseId, course.id);
      assert.equal(success.conversationState.courseMatch, "MATCHED");
      assert.equal(success.conversationState.deferredRequest, null);
      assert.equal(success.conversationState.execution.lastCompletedRequestId, requestId);
      assert.equal(success.conversationState.lastTechnicalError, null);
      assert.equal(success.conversationState.pendingConfirmation, null);
      assert.equal(counters.classify, 1);
      assert.equal(counters.extract, 1);
      assert.equal(counters.route, 0);
      assert.equal(counters.retrieve, 0);
      const result = captured.result;
      assert.ok(result);
      assert.equal(success.message, result.message);
      assert.equal(result.completion, "ANSWERED");
      assert.equal(result.observability?.answerOrigin, "COMMERCIAL_AUTHORITY");
      assert.equal(result.conversationAct.state, "FACTUAL");
      if (result.conversationAct.state === "FACTUAL") {
        const intent = result.conversationAct.intents[0];
        assert.equal(intent.kind, "CURRENT_METADATA");
        if (intent.kind === "CURRENT_METADATA") {
          assert.equal(intent.scope, "SELECTED");
          assert.deepEqual([...intent.courseIds], []);
          assert.deepEqual([...intent.fields], ["PRICE"]);
        }
      }
      const coverage = result.taskCoverage;
      assert.ok(coverage);
      assert.equal(coverage.activeTaskCount, 2);
      assert.equal(coverage.limitationCount, 0);
      assert.equal(coverage.allTasksAccounted, true);
      assert.deepEqual(coverage.outcomes.map((outcome) => outcome.taskType), ["PRICE", "PRICE"]);
      for (const outcome of coverage.outcomes) {
        assert.equal(outcome.outcome, "ANSWERED_FROM_AUTHORITY");
        assert.equal(outcome.reasonCode, "CATALOG_OR_COMMERCIAL_AUTHORITY");
        assert.deepEqual(outcome.courseIds, [course.id]);
        assert.equal(outcome.facts?.length, 1);
        assert.equal(outcome.facts?.[0]?.courseId, course.id);
        assert.equal(outcome.facts?.[0]?.field, "PRICE");
        assert.equal(outcome.facts?.[0]?.status, "SUPPORTED");
        assert.equal(outcome.facts?.[0]?.authorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION);
      }

      const replayCaptured = { result: null as NavigatorOrchestrationResult | null };
      const replay = await readSuccess(await f1CapturedTurn({
        content: F1_PRICE_TEXT,
        plan: f1PricePlan(order),
        requestId,
        mode: "F1",
        counters,
        captured: replayCaptured,
        conversationState: success.conversationState,
        messages: [
          { role: "user", content: F1_PRICE_TEXT },
          { role: "assistant", content: success.message },
          { role: "user", content: F1_PRICE_TEXT },
        ],
      }));
      assert.equal(replay.message, success.message);
      assert.equal(replay.contactCard, null);
      assert.equal(replayCaptured.result, null);
      assert.equal(counters.classify, 1);
      assert.equal(counters.extract, 1);
      assert.equal(replay.conversationState.execution.lastCompletedRequestId, requestId);
      assert.equal(replay.conversationState.deferredRequest, null);
    });
  }
}

for (const course of F1_SELECTED_COURSES) {
  for (const order of ["forward", "reverse"] as const) {
    test(`CORR1 F-1 merged PRICE+ENROLLMENT_WINDOW ${course.id} ${order}`, async () => {
      const requestId = `corr1-window-${course.id}-${order}`;
      const counters = zeroCounters();
      const captured = { result: null as NavigatorOrchestrationResult | null };
      const success = await readSuccess(await f1CapturedTurn({
        content: F1_WINDOW_TEXT,
        plan: f1WindowPlan(order),
        requestId,
        mode: "F1",
        counters,
        captured,
        state: {
          courseMatch: "MATCHED",
          selectedCourseId: course.id,
          deferredRequest: STORED_DEFERRED,
        },
      }));
      assertAttributedPrice(success.message, course.title, course.amount, requestId);
      assert.match(success.message, /окно набора: авторитетного значения нет/u);
      assert.doesNotMatch(success.message, /текущий поток/u);
      assert.doesNotMatch(success.message, /расписание/u);
      assert.doesNotMatch(success.message, INVENTED_ENROLLMENT_DATE);
      assert.equal(success.contactCard, null);
      assert.equal(success.conversationState.selectedCourseId, course.id);
      assert.equal(success.conversationState.deferredRequest, null);
      assert.equal(success.conversationState.execution.lastCompletedRequestId, requestId);
      assert.equal(counters.extract, 1);
      const result = captured.result;
      assert.ok(result?.taskCoverage);
      assert.equal(result.completion, "PARTIAL_WITH_EXPLICIT_LIMITATIONS");
      assert.equal(result.taskCoverage.limitationCount, 1);
      assert.equal(result.taskCoverage.activeTaskCount, 2);
      const price = result.taskCoverage.outcomes.find((outcome) => outcome.taskType === "PRICE");
      const enrollment = result.taskCoverage.outcomes.find((outcome) => outcome.taskType === "ENROLLMENT_WINDOW");
      assert.ok(price && enrollment);
      assert.equal(price.outcome, "ANSWERED_FROM_AUTHORITY");
      assert.equal(price.facts?.[0]?.status, "SUPPORTED");
      assert.equal(price.facts?.[0]?.courseId, course.id);
      assert.equal(price.facts?.[0]?.field, "PRICE");
      assert.equal(enrollment.outcome, "LIMITED_BY_FACTUAL_CEILING");
      assert.equal(enrollment.reasonCode, "MISSING_AUTHORITATIVE_FIELD");
      assert.equal(enrollment.facts?.[0]?.status, "UNAVAILABLE");
      assert.equal(enrollment.facts?.[0]?.field, "ENROLLMENT_WINDOW");
      assert.equal(enrollment.facts?.[0]?.courseId, course.id);
      assert.equal(enrollment.facts?.[0]?.authorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION);
      if (result.conversationAct.state === "FACTUAL") {
        const intent = result.conversationAct.intents[0];
        if (intent.kind === "CURRENT_METADATA") {
          assert.equal(intent.scope, "SELECTED");
          assert.deepEqual([...intent.courseIds], []);
          assert.deepEqual([...intent.fields].sort(), ["ENROLLMENT_WINDOW", "PRICE"]);
        }
      }

      const replayCaptured = { result: null as NavigatorOrchestrationResult | null };
      const replay = await readSuccess(await f1CapturedTurn({
        content: F1_WINDOW_TEXT,
        plan: f1WindowPlan(order),
        requestId,
        mode: "F1",
        counters,
        captured: replayCaptured,
        conversationState: success.conversationState,
      }));
      assert.equal(replay.message, success.message);
      assert.equal(replayCaptured.result, null);
      assert.equal(counters.extract, 1);
      assert.equal(counters.classify, 1);
    });
  }
}

for (const course of F1_SELECTED_COURSES) {
  test(`CORR1 F-1 single SELECTED PRICE ${course.id}`, async () => {
    const requestId = `corr1-single-${course.id}`;
    const counters = zeroCounters();
    const captured = { result: null as NavigatorOrchestrationResult | null };
    const success = await readSuccess(await f1CapturedTurn({
      content: "Сколько стоит этот курс",
      plan: taskPlan({
        tasks: [{ type: "PRICE", courseIds: [], evidence: "Сколько стоит этот курс" }],
        mentions: [],
      }),
      requestId,
      mode: "F1",
      counters,
      captured,
      state: { courseMatch: "MATCHED", selectedCourseId: course.id },
    }));
    assertAttributedPrice(success.message, course.title, course.amount, requestId);
    assert.equal(success.conversationState.selectedCourseId, course.id);
    assert.equal(captured.result?.completion, "ANSWERED");
    assert.equal(captured.result?.taskCoverage?.outcomes.length, 1);
    assert.equal(captured.result?.taskCoverage?.outcomes[0]?.outcome, "ANSWERED_FROM_AUTHORITY");
    assert.equal(captured.result?.taskCoverage?.outcomes[0]?.facts?.[0]?.courseId, course.id);
    assert.equal(counters.extract, 1);
  });
}

test("CORR1 F-1 explicit course ids outrank a different stored course", async () => {
  const content = "Сколько стоит курс Маслоу; какая цена курса Маслоу";
  const counters = zeroCounters();
  const captured = { result: null as NavigatorOrchestrationResult | null };
  const success = await readSuccess(await f1CapturedTurn({
    content,
    plan: taskPlan({
      tasks: [
        { type: "PRICE", courseIds: ["maslow"], evidence: "Сколько стоит курс Маслоу" },
        { type: "PRICE", courseIds: ["maslow"], evidence: "какая цена курса Маслоу" },
      ],
      mentions: [{ courseId: "maslow", surface: "Маслоу", role: "ACTIVE" }],
    }),
    requestId: "corr1-explicit-maslow",
    mode: "F1",
    counters,
    captured,
    state: { courseMatch: "MATCHED", selectedCourseId: "play-and-creativity" },
  }));
  assertAttributedPrice(success.message, MASLOW_TITLE, /60[\s\u00a0]?000/u, "explicit");
  assert.equal(success.message.includes(PLAY_TITLE), false);
  assert.equal(success.conversationState.selectedCourseId, "play-and-creativity");
  assert.equal(captured.result?.completion, "ANSWERED");
  for (const outcome of captured.result?.taskCoverage?.outcomes ?? []) {
    assert.deepEqual(outcome.courseIds, ["maslow"]);
    assert.equal(outcome.facts?.[0]?.courseId, "maslow");
    assert.equal(outcome.outcome, "ANSWERED_FROM_AUTHORITY");
  }
});

test("CORR1 F-1 without a selected course does not invent one", async () => {
  const counters = zeroCounters();
  const captured = { result: null as NavigatorOrchestrationResult | null };
  const success = await readSuccess(await f1CapturedTurn({
    content: F1_PRICE_TEXT,
    plan: f1PricePlan("forward"),
    requestId: "corr1-f1-none",
    mode: "F1",
    counters,
    captured,
    state: { deferredRequest: STORED_DEFERRED },
  }));
  assert.match(success.message, COURSE_NAME_CLARIFICATION);
  assertNoInventedCourse(success.message, "none");
  assert.equal(success.contactCard, null);
  assert.equal(success.conversationState.selectedCourseId, null);
  assert.equal(success.conversationState.courseMatch, "UNKNOWN");
  assert.equal(success.conversationState.deferredRequest, null);
  assert.equal(success.conversationState.execution.lastCompletedRequestId, "corr1-f1-none");
  assert.equal(captured.result?.completion, "PARTIAL_WITH_EXPLICIT_LIMITATIONS");
  const coverage = captured.result?.taskCoverage;
  assert.ok(coverage);
  assert.equal(coverage.limitationCount, 2);
  for (const outcome of coverage.outcomes) {
    assert.equal(outcome.outcome, "LIMITED_BY_FACTUAL_CEILING");
    assert.equal(outcome.reasonCode, "COURSE_NOT_RESOLVED");
    assert.notEqual(outcome.outcome, "ANSWERED_FROM_AUTHORITY");
    assert.equal(outcome.facts?.[0]?.status, "UNAVAILABLE");
    assert.equal(outcome.facts?.[0]?.courseId, null);
    assert.equal(outcome.facts?.[0]?.field, "PRICE");
  }
});

test("CORR1 invalid selectedCourseId fails validation and invents no course", async () => {
  const counters = zeroCounters();
  const response = await chat(
    {
      messages: [{ role: "user", content: F1_PRICE_TEXT }],
      profile: VY_PROFILE,
      conversationState: initialState({
        courseMatch: "MATCHED",
        selectedCourseId: "not-a-course",
      }),
      requestId: "corr1-f1-invalid",
    },
    orchestration({
      counters,
      classify: async () => {
        throw new ConversationActDecisionValidationError(F1_REJECTION);
      },
      plan: f1PricePlan("forward"),
    }),
  );
  const text = await response.text();
  assert.equal(response.status, 400, text);
  const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
  assert.equal(body.error?.code, "INVALID_REQUEST");
  assert.match(body.error?.message ?? "", /Некорректное состояние диалога/u);
  assertNoInventedCourse(text, "invalid");
  assert.equal(counters.classify, 0);
  assert.equal(counters.extract, 0);
});

for (const mode of ["NON_F1", "SIMILAR"] as const) {
  for (const selectedCourseId of [undefined, "maslow", "play-and-creativity", "structural-typology"] as const) {
    test(`CORR1 ${mode} empty PRICE plan does not inherit ${selectedCourseId ?? "none"}`, async () => {
      const counters = zeroCounters();
      const captured = { result: null as NavigatorOrchestrationResult | null };
      const success = await readSuccess(await f1CapturedTurn({
        content: F1_PRICE_TEXT,
        plan: f1PricePlan("forward"),
        requestId: `corr1-${mode}-${selectedCourseId ?? "none"}`,
        mode,
        counters,
        captured,
        state: selectedCourseId
          ? { courseMatch: "MATCHED", selectedCourseId, deferredRequest: STORED_DEFERRED }
          : { deferredRequest: STORED_DEFERRED },
      }));
      assert.match(success.message, /не разобрал/u);
      assertNoInventedCourse(success.message, `${mode}/${selectedCourseId ?? "none"}`);
      assert.equal(success.contactCard, null);
      assert.equal(success.conversationState.selectedCourseId, selectedCourseId ?? null);
      assert.equal(success.conversationState.deferredRequest, null);
      assert.equal(captured.result?.completion, "PARTIAL_WITH_EXPLICIT_LIMITATIONS");
      const coverage = captured.result?.taskCoverage;
      assert.ok(coverage);
      assert.equal(coverage.limitationCount, 2);
      for (const outcome of coverage.outcomes) {
        assert.equal(outcome.outcome, "NOT_SAFELY_EXECUTABLE");
        assert.equal(outcome.facts, undefined);
        assert.notEqual(outcome.outcome, "ANSWERED_FROM_AUTHORITY");
      }
      assert.equal(counters.extract, 1);
    });
  }
}

test("the injected session clock keeps T0 fresh and the production TTL still expires at the boundary", async () => {
  assert.equal(systemSessionClock.now(), T0);

  const active = initialState({
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
    activeFlow: { id: "COURSE_SELECTION", pendingQuestion: "team-or-self" },
  });

  const justInside = applySessionFreshness(
    {
      ...active,
      lastActivityAt: toSessionTimestamp(T0 - SESSION_CONTEXT_TTL_MS + 1),
    },
    systemSessionClock.now(),
  );
  assert.equal(justInside.expired, false);
  assert.equal(justInside.state.selectedCourseId, "maslow");
  assert.equal(justInside.state.courseMatch, "MATCHED");
  assert.equal(justInside.state.activeFlow?.id, "COURSE_SELECTION");
  assert.equal(justInside.state.staleReference, null);

  const atBoundary = applySessionFreshness(
    {
      ...active,
      lastActivityAt: toSessionTimestamp(T0 - SESSION_CONTEXT_TTL_MS),
    },
    systemSessionClock.now(),
  );
  assert.equal(atBoundary.expired, true);
  assert.equal(atBoundary.state.selectedCourseId, null);
  assert.equal(atBoundary.state.courseMatch, "UNKNOWN");
  assert.equal(atBoundary.state.activeFlow, null);
  assert.equal(atBoundary.state.lastAssistant, null);
  assert.deepEqual(atBoundary.state.staleReference, {
    previousCourseId: "maslow",
    previousFlowId: "COURSE_SELECTION",
  });

  const expired = await readSuccess(
    await chat({
      messages: [{ role: "user", content: "этот курс мне подойдёт?" }],
      profile: VY_PROFILE,
      conversationState: {
        ...initialState({
          courseMatch: "MATCHED",
          selectedCourseId: "maslow",
        }),
        lastActivityAt: toSessionTimestamp(T0 - SESSION_CONTEXT_TTL_MS),
      },
    }),
  );
  assert.equal(expired.conversationState.selectedCourseId, null);
  assert.equal(expired.conversationState.courseMatch, "UNKNOWN");
  assert.equal(expired.conversationState.staleReference?.previousCourseId, "maslow");
  assert.equal(expired.conversationState.pendingConfirmation?.candidateCourseId, "maslow");
  assert.match(expired.message, /Ранее мы обсуждали/u);
  assert.doesNotMatch(expired.message, PAYMENT_MARKERS);
  assert.equal(systemSessionClock.now(), T0);
});
