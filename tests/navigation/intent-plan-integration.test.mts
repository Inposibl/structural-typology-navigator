/**
 * NAVIGATOR-INTENT-RECOVERY-ARM-B.IMPLEMENTATION-1 — API-level integration
 * matrix for the B-on-failure recovery, driven through the real entry point
 * (handleChatRequest → kernel → orchestrateNavigatorResponse → route.ts
 * mapping/state). Every provider response is a retained frozen real decision
 * or a deterministic offline injection; no provider call is possible.
 *
 * Parity checks follow the accepted L1/L2/N6 discipline: the recovered turn
 * must match the genuine-act turn on the full public response, masking only
 * lastActivityAt (the client-supplied requestId is identical, so
 * execution.lastCompletedRequestId matches exactly).
 */

import assert from "node:assert/strict";
import { composeCourseFollowUpAnswer } from "../../src/lib/navigation/conversation-response.ts";
import { COVERAGE_NON_CLAIM } from "../../src/lib/navigation/response-coverage.ts";
import type { TaskPlanTask } from "../../src/lib/navigation/task-plan.ts";
import test from "node:test";

import { handleChatRequest } from "../../src/app/api/chat/route.ts";
import { orchestrateNavigatorResponse } from "../../src/lib/navigation/orchestrate-navigation.ts";
import { routeConversationAct } from "../../src/lib/navigation/conversation-act-router.ts";
import { DeepSeekClientError } from "../../src/lib/navigation/deepseek-client.ts";
import type {
  RetrieveCourseKnowledgeResult,
} from "../../src/lib/knowledge/retrieval/retrieve-course-knowledge.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";
import type {
  OrchestrationDependencies,
  NavigatorOrchestrationResult,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import type { RouteConversationActOptions } from "../../src/lib/navigation/conversation-act-router.ts";
import type { ConversationMessage } from "../../src/lib/chat-contract.ts";

// Frozen DEV fixture bodies (NAVIGATOR-INTENT-RECOVERY-EXPERIMENT-1-EVIDENCE-20261014/fixtures/DEV_FIXTURES.json).
// lastActivityAt is rebased at run time by the shared helper, the single disclosed
// harness adaptation: the frozen capture timestamp would otherwise be expired by the
// product's 24h SESSION_CONTEXT_TTL at execution time; every business field is unchanged.
const DEV_S01 =
{
  "messages": [
    {
      "role": "user",
      "content": "Меня зовут Тест. На «вы». Хочу пройти курс Маслоу."
    },
    {
      "role": "assistant",
      "content": "По вашему описанию ключевая учебная задача сейчас — Изучение иерархии потребностей А. Маслоу в новой парадигме\n\nВ текущем каталоге Академии ей соответствует курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow.\n\nПо программе курса его учебные результаты включают: освоить динамическую модель потребностей вместо статичной пирамиды; освоить позицию рефлексивного наблюдателя; понимать разнонаправленные переходы мотивации под давлением контекста."
    },
    {
      "role": "user",
      "content": "А что даёт курс «Игра и творчество в жизни взрослых людей» для раскрытия креативности в работе?"
    }
  ],
  "profile": {
    "displayName": "Тест",
    "addressMode": "VY",
    "nameDeclined": false,
    "pendingUserRequest": null
  },
  "conversationState": {
    "lifecycle": "OPEN",
    "activeFlow": {
      "id": "COURSE_SELECTION",
      "pendingQuestion": null
    },
    "suspendedFlow": null,
    "courseMatch": "MATCHED",
    "selectedCourseId": "maslow",
    "clarification": null,
    "pendingConfirmation": null,
    "deferredRequest": null,
    "lastAssistant": {
      "act": "NAVIGATE",
      "content": "По вашему описанию ключевая учебная задача сейчас — Изучение иерархии потребностей А. Маслоу в новой парадигме\n\nВ текущем каталоге Академии ей соответствует курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow.\n\nПо программе курса его учебные результаты включают: освоить динамическую модель потребностей вместо статичной пирамиды; освоить позицию рефлексивного наблюдателя; понимать разнонаправленные переходы мотивации под давлением контекста.",
      "courseId": "maslow"
    },
    "lastActivityAt": "2026-10-13T04:30:10.228Z",
    "staleReference": null,
    "repair": null,
    "execution": {
      "phase": "IDLE",
      "requestId": null,
      "lastCompletedRequestId": "smoke1-T10-1"
    },
    "lastTechnicalError": null,
    "handoff": {
      "status": "NONE",
      "reason": null,
      "context": null
    },
    "qualitySignals": [],
    "courseReferents": [],
    "catalogAuthorityVersion": "2026-09-18"
  }
}
;
const DEV_S02 =
{
  "messages": [
    {
      "role": "user",
      "content": "Меня зовут Тест. На «вы». Покажите, какие курсы есть в каталоге Академии."
    },
    {
      "role": "assistant",
      "content": "В текущем каталоге Академии представлены следующие курсы:\n\n1) «Иерархия уровней сознания» — https://structural-typology.academy/courses/levels-of-consciousness\n2) «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow\n3) «Игра и творчество в жизни взрослых людей» — https://structural-typology.academy/courses/play-and-creativity\n4) «Нормативная ситуация» — https://structural-typology.academy/courses/normative-situation\n5) «Стадии профессионального развития взрослого человека» — null\n6) «Структурная типология личности с использованием типологии Майерс-Бриггс» — https://structural-typology.academy/courses/structural-typology\n\nРасскажите, какая тема вам сейчас ближе, — помогу сориентироваться."
    },
    {
      "role": "user",
      "content": "Как курс «Иерархия уровней сознания» помогает понять природу изменённых состояний сознания?"
    }
  ],
  "profile": {
    "displayName": "Тест",
    "addressMode": "VY",
    "nameDeclined": false,
    "pendingUserRequest": null
  },
  "conversationState": {
    "lifecycle": "OPEN",
    "activeFlow": null,
    "suspendedFlow": null,
    "courseMatch": "UNKNOWN",
    "selectedCourseId": null,
    "clarification": null,
    "pendingConfirmation": null,
    "deferredRequest": null,
    "lastAssistant": {
      "act": "ADDRESS_SETUP",
      "content": "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии.",
      "courseId": null
    },
    "lastActivityAt": "2026-10-13T04:26:06.588Z",
    "staleReference": null,
    "repair": null,
    "execution": {
      "phase": "IDLE",
      "requestId": null,
      "lastCompletedRequestId": "smoke1-T04-1"
    },
    "lastTechnicalError": null,
    "handoff": {
      "status": "NONE",
      "reason": null,
      "context": null
    },
    "qualitySignals": [],
    "courseReferents": []
  }
}
;
const DEV_S03 =
{
  "messages": [
    {
      "role": "user",
      "content": "Меня зовут Тест. На «вы»."
    },
    {
      "role": "assistant",
      "content": "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии."
    },
    {
      "role": "user",
      "content": "Что даёт курс по структурной типологии личности для работы с типологией Майерс-Бриггс?"
    },
    {
      "role": "user",
      "content": "Как курс «Иерархия потребностей А. Маслоу: новая парадигма» объясняет изменение мотивации человека под давлением контекста?"
    }
  ],
  "profile": {
    "displayName": "Тест",
    "addressMode": "VY",
    "nameDeclined": false,
    "pendingUserRequest": null
  },
  "conversationState": {
    "lifecycle": "OPEN",
    "activeFlow": null,
    "suspendedFlow": null,
    "courseMatch": "UNKNOWN",
    "selectedCourseId": null,
    "clarification": null,
    "pendingConfirmation": null,
    "deferredRequest": null,
    "lastAssistant": {
      "act": "ADDRESS_SETUP",
      "content": "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии.",
      "courseId": null
    },
    "lastActivityAt": "2026-10-13T04:26:06.588Z",
    "staleReference": null,
    "repair": null,
    "execution": {
      "phase": "IDLE",
      "requestId": null,
      "lastCompletedRequestId": "smoke1-T04-1"
    },
    "lastTechnicalError": null,
    "handoff": {
      "status": "NONE",
      "reason": null,
      "context": null
    },
    "qualitySignals": [],
    "courseReferents": []
  }
}
;
const DEV_S09 =
{
  "messages": [
    {
      "role": "user",
      "content": "Меня зовут Тест. На «вы»."
    },
    {
      "role": "assistant",
      "content": "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии."
    },
    {
      "role": "user",
      "content": "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией? Во сколько обойдётся участие?"
    }
  ],
  "profile": {
    "displayName": "Тест",
    "addressMode": "VY",
    "nameDeclined": false,
    "pendingUserRequest": null
  },
  "conversationState": {
    "lifecycle": "OPEN",
    "activeFlow": null,
    "suspendedFlow": null,
    "courseMatch": "UNKNOWN",
    "selectedCourseId": null,
    "clarification": null,
    "pendingConfirmation": null,
    "deferredRequest": null,
    "lastAssistant": {
      "act": "ADDRESS_SETUP",
      "content": "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии.",
      "courseId": null
    },
    "lastActivityAt": "2026-10-13T04:26:06.588Z",
    "staleReference": null,
    "repair": null,
    "execution": {
      "phase": "IDLE",
      "requestId": null,
      "lastCompletedRequestId": "smoke1-T04-1"
    },
    "lastTechnicalError": null,
    "handoff": {
      "status": "NONE",
      "reason": null,
      "context": null
    },
    "qualitySignals": [],
    "courseReferents": []
  }
}
;
const DEV_S13 =
{
  "messages": [
    {
      "role": "user",
      "content": "Меня зовут Тест. На «вы»."
    },
    {
      "role": "assistant",
      "content": "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии."
    },
    {
      "role": "user",
      "content": "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией? Объясни, как самоактуализация связана с тревогой"
    }
  ],
  "profile": {
    "displayName": "Тест",
    "addressMode": "VY",
    "nameDeclined": false,
    "pendingUserRequest": null
  },
  "conversationState": {
    "lifecycle": "OPEN",
    "activeFlow": null,
    "suspendedFlow": null,
    "courseMatch": "UNKNOWN",
    "selectedCourseId": null,
    "clarification": null,
    "pendingConfirmation": null,
    "deferredRequest": null,
    "lastAssistant": {
      "act": "ADDRESS_SETUP",
      "content": "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии.",
      "courseId": null
    },
    "lastActivityAt": "2026-10-13T04:26:06.588Z",
    "staleReference": null,
    "repair": null,
    "execution": {
      "phase": "IDLE",
      "requestId": null,
      "lastCompletedRequestId": "smoke1-T04-1"
    },
    "lastTechnicalError": null,
    "handoff": {
      "status": "NONE",
      "reason": null,
      "context": null
    },
    "qualitySignals": [],
    "courseReferents": []
  }
}
;

const DEV_S10 =
{
  "messages": [
    {
      "role": "user",
      "content": "Меня зовут Тест. На «вы»."
    },
    {
      "role": "assistant",
      "content": "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии."
    },
    {
      "role": "user",
      "content": "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией? И как его оплатить?"
    }
  ],
  "profile": {
    "displayName": "Тест",
    "addressMode": "VY",
    "nameDeclined": false,
    "pendingUserRequest": null
  },
  "conversationState": {
    "lifecycle": "OPEN",
    "activeFlow": null,
    "suspendedFlow": null,
    "courseMatch": "UNKNOWN",
    "selectedCourseId": null,
    "clarification": null,
    "pendingConfirmation": null,
    "deferredRequest": null,
    "lastAssistant": {
      "act": "ADDRESS_SETUP",
      "content": "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии.",
      "courseId": null
    },
    "lastActivityAt": "2026-10-13T04:26:06.588Z",
    "staleReference": null,
    "repair": null,
    "execution": {
      "phase": "IDLE",
      "requestId": null,
      "lastCompletedRequestId": "smoke1-T04-1"
    },
    "lastTechnicalError": null,
    "handoff": {
      "status": "NONE",
      "reason": null,
      "context": null
    },
    "qualitySignals": [],
    "courseReferents": []
  }
};

/** Retained real rejected first decisions (DEV fixtures attempt1.raw). */
const RETAINED_F1_RAW = {
  S01: {
    state: "COURSE_CONTENT",
    courseId: "play-and-creativity",
    evidenceRequested: false,
    contentIntentEvidence:
      "А что даёт курс «Игра и творчество в жизни взрослых людей» для раскрытия креативности в работе",
  },
  S02: {
    state: "COURSE_CONTENT",
    courseId: "levels-of-consciousness",
    evidenceRequested: false,
    contentIntentEvidence:
      "Как курс «Иерархия уровней сознания» помогает понять природу изменённых состояний сознания",
  },
  S03: {
    state: "COURSE_CONTENT",
    courseId: "maslow",
    evidenceRequested: false,
    contentIntentEvidence:
      "Как курс «Иерархия потребностей А. Маслоу: новая парадигма» объясняет изменение мотивации человека под давлением контекста",
  },
} as const;

/** Retained real ARM-B plans (DEV records R1__ARM-B__<S>__s1__a1.json). */
const RETAINED_PLANS = {
  S01: {
    tasks: [
      {
        type: "EDU",
        courseIds: ["play-and-creativity"],
        role: "ACTIVE",
        evidence:
          "А что даёт курс «Игра и творчество в жизни взрослых людей» для раскрытия креативности в работе",
      },
    ],
    mentions: [
      {
        courseId: "play-and-creativity",
        surface: "«Игра и творчество в жизни взрослых людей»",
        role: "ACTIVE",
      },
    ],
  },
  S02: {
    tasks: [
      {
        type: "EDU",
        courseIds: ["levels-of-consciousness"],
        role: "ACTIVE",
        evidence:
          "Как курс «Иерархия уровней сознания» помогает понять природу изменённых состояний сознания",
      },
    ],
    mentions: [
      {
        courseId: "levels-of-consciousness",
        surface: "«Иерархия уровней сознания»",
        role: "ACTIVE",
      },
    ],
  },
  S03: {
    tasks: [
      {
        type: "EDU",
        courseIds: ["maslow"],
        role: "ACTIVE",
        evidence:
          "Как курс «Иерархия потребностей А. Маслоу: новая парадигма» объясняет изменение мотивации человека под давлением контекста",
      },
    ],
    mentions: [
      {
        courseId: "maslow",
        surface: "«Иерархия потребностей А. Маслоу: новая парадигма»",
        role: "ACTIVE",
      },
    ],
  },
  S04: {
    tasks: [
      {
        type: "COMPARE",
        courseIds: ["maslow", "levels-of-consciousness"],
        role: "ACTIVE",
        evidence:
          "Чем отличаются курсы «Иерархия потребностей А. Маслоу: новая парадигма» и «Иерархия уровней сознания»",
      },
    ],
    mentions: [
      {
        courseId: "maslow",
        surface: "«Иерархия потребностей А. Маслоу: новая парадигма»",
        role: "ACTIVE",
      },
      {
        courseId: "levels-of-consciousness",
        surface: "«Иерархия уровней сознания»",
        role: "ACTIVE",
      },
    ],
  },
  S09: {
    tasks: [
      {
        type: "EDU",
        courseIds: ["maslow"],
        role: "ACTIVE",
        evidence:
          "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией?",
      },
      {
        type: "PRICE",
        courseIds: ["maslow"],
        role: "ACTIVE",
        evidence: "Во сколько обойдётся участие",
      },
    ],
    mentions: [
      {
        courseId: "maslow",
        surface: "«Иерархия потребностей А. Маслоу: новая парадигма»",
        role: "ACTIVE",
      },
    ],
  },
  S10: {
    tasks: [
      {
        type: "EDU",
        courseIds: ["maslow"],
        role: "ACTIVE",
        evidence:
          "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией?",
      },
      {
        type: "PAYMENT",
        courseIds: ["maslow"],
        role: "ACTIVE",
        evidence: "И как его оплатить",
      },
    ],
    mentions: [
      {
        courseId: "maslow",
        surface: "«Иерархия потребностей А. Маслоу: новая парадигма»",
        role: "ACTIVE",
      },
    ],
  },
} as const;

// ---------------------------------------------------------------- harness

type TurnCounters = {
  classifyCalls: number;
  extractionCalls: number;
  routeCalls: number;
  retrieval: { courseId: string; query: string; matchCount: number | undefined }[];
};

type TurnBody = {
  message?: string;
  profile?: unknown;
  conversationState?: Record<string, unknown>;
  contactCard?: unknown;
  resetConversation?: boolean;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    conversationState?: Record<string, unknown>;
  };
};

type TurnState = {
  lastAssistant?: { act?: string };
  courseMatch?: string;
  selectedCourseId?: string | null;
  pendingConfirmation?: unknown;
  courseReferents?: string[];
} & Record<string, unknown>;

type TurnResult = {
  orchestration: NavigatorOrchestrationResult | null;
  http: number;
  body: TurnBody;
  state: TurnState | null;
  message: string | null;
  logs: { level: string; line: string }[];
  counters: TurnCounters;
};

/** The single disclosed fixture adaptation: rebase the frozen timestamp so the
 * product's 24h SESSION_CONTEXT_TTL does not expire the frozen state at run
 * time; every business field is unchanged. */
function rebaseLastActivity(body: unknown): unknown {
  const cloned = structuredClone(body) as {
    conversationState: { lastActivityAt: string };
  };
  cloned.conversationState.lastActivityAt = new Date(
    Date.now() - 60_000,
  ).toISOString();
  return cloned;
}

const NO_SOURCES: RetrieveCourseKnowledgeResult = {
  hasActiveSources: false,
  bindings: [],
  matches: [],
};

async function runTurn(input: {
  body: unknown;
  raw?: unknown;
  plan?: unknown;
  extractionError?: (options: { timeoutMs?: number; signal?: AbortSignal }) => Error;
  retrieve?: NonNullable<OrchestrationDependencies["retrieve"]>;
  resolve?: OrchestrationDependencies["resolve"];
  selectEvidence?: OrchestrationDependencies["selectEvidence"];
  composeFollowUp?: OrchestrationDependencies["composeFollowUp"];
  compose?: OrchestrationDependencies["compose"];
  classifyRaw?: unknown;
  requestId?: string;
  signal?: AbortSignal;
}): Promise<TurnResult> {
  let orchestration: NavigatorOrchestrationResult | null = null;
  const counters: TurnCounters = {
    classifyCalls: 0,
    extractionCalls: 0,
    routeCalls: 0,
    retrieval: [],
  };

  const retrieve =
    input.retrieve ??
    (async (courseId, query, options) => {
      counters.retrieval.push({
        courseId,
        query,
        matchCount: options.matchCount,
      });
      return NO_SOURCES;
    });

  const classifyAct = async (
    messages: readonly ConversationMessage[],
    options: RouteConversationActOptions,
  ) => {
    counters.classifyCalls += 1;
    const raw = input.classifyRaw !== undefined ? input.classifyRaw : input.raw;
    return routeConversationAct(messages, {
      ...options,
      callJson: async () => structuredClone(raw),
    });
  };

  const route = (async () => {
    counters.routeCalls += 1;
    throw new Error("ROUTE_MUST_NOT_BE_CALLED_IN_THESE_TESTS");
  }) as never;

  const dependencies: OrchestrationDependencies = {
    classifyAct,
    route,
    retrieve,
    resolve: input.resolve ?? (() => [] as ResolvedCourseEvidence[]),
    selectEvidence:
      input.selectEvidence ??
      (async () => ({ status: "INSUFFICIENT", evidence: [] as never })),
    ...(input.composeFollowUp ? { composeFollowUp: input.composeFollowUp } : {}),
    ...(input.compose ? { compose: input.compose } : {}),
    ...(input.plan !== undefined || input.extractionError
      ? {
          extractPlan: async (messages, options) => {
            counters.extractionCalls += 1;
            if (input.extractionError) throw input.extractionError(options);
            return structuredClone(input.plan);
          },
        }
      : {}),
  };

  const logs: { level: string; line: string }[] = [];
  const saved = {
    info: console.info,
    warn: console.warn,
    error: console.error,
    log: console.log,
  };
  const consoleSink = console as unknown as Record<
    string,
    (...parts: unknown[]) => void
  >;
  for (const level of ["info", "warn", "error", "log"] as const) {
    consoleSink[level] = (...parts: unknown[]) =>
      logs.push({
        level,
        line: parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "),
      });
  }

  try {
    const response = await handleChatRequest(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: input.signal,
        body: JSON.stringify({
          ...(rebaseLastActivity(input.body) as Record<string, unknown>),
          requestId: input.requestId ?? "armb-integration-1",
        }),
      }),
      {
        orchestrate: async (messages, options) => {
          orchestration = await orchestrateNavigatorResponse(messages, { ...options, dependencies });
          return orchestration;
        },
      },
    );
    const http = response.status;
    const responseBody = await response.json();
    return {
      http,
      orchestration,
      body: responseBody,
      state:
        (responseBody.conversationState ??
          responseBody.error?.conversationState ??
          null) as TurnState | null,
      message: responseBody.message ?? responseBody.error?.message ?? null,
      logs,
      counters,
    };
  } finally {
    Object.assign(console, saved);
  }
}

function stateOf(result: TurnResult): TurnState {
  assert.ok(result.state);
  return result.state;
}

/** An unrecovered retry prompt is a technical failure, not a completed turn. */
function assertUnrecoveredTechnicalRetry(result: TurnResult): void {
  assert.equal(result.http, 503);
  assert.equal(result.body.error?.code, "NAVIGATOR_TECHNICAL_ERROR");
  assert.match(result.message ?? "", /технический сбой/u);
  const state = stateOf(result);
  assert.equal(state.lastAssistant?.act, "NAVIGATE");
  assert.equal(
    (state.execution as { lastCompletedRequestId?: string } | undefined)
      ?.lastCompletedRequestId,
    "smoke1-T10-1",
  );
  assert.notEqual(state.lastTechnicalError, null);
  assert.equal(
    (state.qualitySignals as Array<{ signalType?: string }> | undefined)?.at(-1)
      ?.signalType,
    "MATERIAL_FAILURE",
  );
}

function maskVolatile(state: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(state);
  delete cloned.lastActivityAt;
  return cloned;
}

type PlanEvent = {
  event?: string;
  disposition?: string;
  reasonCode?: string | null;
  originalAct?: string;
  extractionCalls?: number;
  activeTaskCount?: number | null;
  limitationCount?: number | null;
  allTasksAccounted?: boolean;
  answerOrigin?: string;
  crossCourseLeakageDetected?: boolean;
};

function recoveryEvents(result: TurnResult): PlanEvent[] {
  return result.logs
    .map((entry) => {
      try {
        return JSON.parse(entry.line) as PlanEvent;
      } catch {
        return null;
      }
    })
    .filter(
      (event): event is PlanEvent =>
        event !== null &&
        (event.event === "NAVIGATOR_INTENT_PLAN_RECOVERY" ||
          event.event === "NAVIGATOR_INTENT_PLAN_COVERAGE"),
    );
}

// ---------------------------------------------------------------- L1/L2/N6

for (const scenario of [
  { id: "L1", body: DEV_S01, raw: RETAINED_F1_RAW.S01, plan: RETAINED_PLANS.S01, courseId: "play-and-creativity" },
  { id: "L2", body: DEV_S02, raw: RETAINED_F1_RAW.S02, plan: RETAINED_PLANS.S02, courseId: "levels-of-consciousness" },
  { id: "N6", body: DEV_S03, raw: RETAINED_F1_RAW.S03, plan: RETAINED_PLANS.S03, courseId: "maslow" },
] as const) {
  test(`${scenario.id}: retained real F-1 decision recovers into the genuine FOLLOW_UP turn (full-wire parity)`, async () => {
    const recovered = await runTurn({
      body: scenario.body,
      raw: scenario.raw,
      plan: scenario.plan,
    });

    assert.equal(recovered.http, 200);
    assert.equal(recovered.counters.classifyCalls, 1);
    assert.equal(recovered.counters.extractionCalls, 1);
    assert.equal(recovered.counters.routeCalls, 0);
    // The recovered act retrieves exactly the plan's course, through the
    // unchanged COURSE_RPC parameters.
    assert.equal(recovered.counters.retrieval.length, 1);
    assert.equal(recovered.counters.retrieval[0].courseId, scenario.courseId);
    assert.equal(recovered.counters.retrieval[0].matchCount, 12);

    const genuine = await runTurn({
      body: scenario.body,
      classifyRaw: {
        state: "COURSE_FOLLOW_UP",
        courseId: scenario.courseId,
        evidenceRequested: false,
      },
    });
    assert.equal(genuine.http, 200);

    // Full public response parity, masking only the volatile timestamp.
    assert.equal(recovered.body.message, genuine.body.message);
    assert.deepEqual(recovered.body.profile, genuine.body.profile);
    assert.deepEqual(
      maskVolatile(recovered.body.conversationState ?? {}),
      maskVolatile(genuine.body.conversationState ?? {}),
    );
    assert.equal(recovered.body.contactCard, genuine.body.contactCard);
    assert.equal(recovered.body.resetConversation, genuine.body.resetConversation);

    // The recorded act identity is the course follow-up, and the plan-recovery
    // event is bounded.
    assert.equal(stateOf(recovered).lastAssistant?.act, "COURSE_FOLLOW_UP");
    const events = recoveryEvents(recovered);
    const recoveryEvent = events.find((event) => event.event === "NAVIGATOR_INTENT_PLAN_RECOVERY");
    assert.ok(recoveryEvent);
    assert.equal(recoveryEvent.disposition, "RECOVERED_SINGLE_ACT");
    assert.equal(recoveryEvent.originalAct, "COURSE_CONTENT");
    assert.equal(recoveryEvent.extractionCalls, 1);
  });
}

test("N6 preserves the UNKNOWN course state on the recovered turn", async () => {
  const recovered = await runTurn({
    body: DEV_S03,
    raw: RETAINED_F1_RAW.S03,
    plan: RETAINED_PLANS.S03,
  });
  assert.equal(stateOf(recovered).courseMatch, "UNKNOWN");
  assert.equal(stateOf(recovered).selectedCourseId, null);
});

test("L1 preserves the MATCHED maslow selection while answering the play course", async () => {
  const recovered = await runTurn({
    body: DEV_S01,
    raw: RETAINED_F1_RAW.S01,
    plan: RETAINED_PLANS.S01,
  });
  assert.equal(stateOf(recovered).courseMatch, "MATCHED");
  assert.equal(stateOf(recovered).selectedCourseId, "maslow");
});

// ---------------------------------------------------------------- S13

test("S13 correction: two same-course EDU tasks are dispatched on their own task scope", async () => {
  const seenSegmentQueries: string[] = [];
  const recovered = await runTurn({
    body: DEV_S13,
    raw: {
      state: "COURSE_CONTENT",
      courseId: "maslow",
      evidenceRequested: false,
      contentIntentEvidence:
        "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией?",
    },
    plan: {
      tasks: [
        {
          type: "EDU",
          courseIds: ["maslow"],
          role: "ACTIVE",
          evidence:
            "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией?",
        },
        {
          type: "EDU",
          courseIds: ["maslow"],
          role: "ACTIVE",
          evidence: "Объясни, как самоактуализация связана с тревогой",
        },
      ],
      mentions: [
        {
          courseId: "maslow",
          surface: "«Иерархия потребностей А. Маслоу: новая парадигма»",
          role: "ACTIVE",
        },
      ],
    },
    composeFollowUp: async (messages, act, options) => {
      options.onOutcome?.({
        answerOrigin: "CATALOG_AUTHORITY",
        fallback: "CATALOG_FOLLOW_UP",
      });
      return `ОТВЕТ[${act.courseId}]<${messages.at(-1)!.content}>`;
    },
  });

  assert.equal(recovered.http, 200);
  const latest = DEV_S13.messages.at(-1)!.content;
  const span2 = "Объясни, как самоактуализация связана с тревогой";
  // Both completed task results answer only their own validated scope.
  assert.equal(
    recovered.message,
    `ОТВЕТ[maslow]<Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией?>\n\nОТВЕТ[maslow]<${span2}>`,
  );
  // Exactly one retrieval per task; no whole-message primary re-execution.
  assert.equal(recovered.counters.retrieval.length, 2);
  seenSegmentQueries.push(...recovered.counters.retrieval.map((entry) => entry.query));
  assert.equal(seenSegmentQueries.includes(latest), false);
  assert.ok(seenSegmentQueries.includes(span2));
  // Coverage: both ACTIVE tasks answered, no limitations.
  const coverage = recoveryEvents(recovered).find((event) => event.event === "NAVIGATOR_INTENT_PLAN_COVERAGE");
  assert.ok(coverage);
  assert.equal(coverage.activeTaskCount, 2);
  assert.equal(coverage.limitationCount, 0);
  assert.equal(coverage.allTasksAccounted, true);
});

// ---------------------------------------------------------------- multi-task

test("S09 composition: catalog outcomes + dated commercial price, bounded call count", async () => {
  const recovered = await runTurn({
    body: DEV_S09,
    raw: {
      state: "COURSE_CONTENT",
      courseId: "maslow",
      evidenceRequested: false,
      contentIntentEvidence:
        "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией?",
    },
    plan: RETAINED_PLANS.S09,
  });

  assert.equal(recovered.http, 200);
  assert.equal(recovered.counters.classifyCalls, 1);
  assert.equal(recovered.counters.extractionCalls, 1);
  assert.equal(recovered.counters.routeCalls, 0);
  // Educational segment from catalog authority, commercial segment dated.
  assert.match(recovered.message!, /Подтверждённые публичные учебные результаты курса/);
  assert.match(recovered.message!, /60\s?\u00a0000|60 000/);
  assert.match(recovered.message!, /26 октября 2026/);
  // Exactly one payment line worth of no-payment-URL safety.
  assert.equal(recovered.message!.includes("t.me/AST_payment_course_bot"), false);
  const coverage = recoveryEvents(recovered).find((event) => event.event === "NAVIGATOR_INTENT_PLAN_COVERAGE");
  assert.ok(coverage);
  assert.equal(coverage.activeTaskCount, 2);
  assert.equal(coverage.limitationCount, 0);
});

test("S10 composition: explicit payment limitation line, no payment destination", async () => {
  const recovered = await runTurn({
    body: DEV_S10,
    raw: {
      state: "COURSE_CONTENT",
      courseId: "maslow",
      evidenceRequested: false,
      contentIntentEvidence:
        "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией?",
    },
    plan: RETAINED_PLANS.S10,
  });

  assert.equal(recovered.http, 200);
  assert.match(recovered.message!, /Подтверждённые публичные учебные результаты курса/);
  assert.match(recovered.message!, /не даю платёжных ссылок/);
  assert.equal(recovered.message!.includes("t.me/AST_payment_course_bot"), false);
  const coverage = recoveryEvents(recovered).find((event) => event.event === "NAVIGATOR_INTENT_PLAN_COVERAGE");
  assert.ok(coverage);
  assert.equal(coverage.activeTaskCount, 2);
  assert.equal(coverage.limitationCount, 1);
  // No transactional authority was committed by the composition.
  assert.equal(stateOf(recovered).pendingConfirmation, null);
});

test("T11 inherited limitation: mixed price+payment question keeps the payment contract untouched", async () => {
  const body = {
    messages: [
      { role: "user", content: "Меня зовут Тест. На «вы»." },
      {
        role: "assistant",
        content:
          "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии.",
      },
      {
        role: "user",
        content:
          "Как оплатить курсы Академии и сколько стоит «Иерархия потребностей А. Маслоу: новая парадигма»?",
      },
    ],
    profile: DEV_S09.profile,
    conversationState: DEV_S09.conversationState,
  };
  const recovered = await runTurn({
    body,
    raw: {
      state: "COURSE_CONTENT",
      courseId: "maslow",
      evidenceRequested: false,
      contentIntentEvidence: "сколько стоит «Иерархия потребностей А. Маслоу: новая парадигма»?",
    },
    plan: {
      tasks: [
        {
          type: "PRICE",
          courseIds: ["maslow"],
          role: "ACTIVE",
          evidence: "сколько стоит «Иерархия потребностей А. Маслоу: новая парадигма»",
        },
        {
          type: "PAYMENT",
          courseIds: [],
          role: "ACTIVE",
          evidence: "Как оплатить курсы Академии",
        },
      ],
      mentions: [
        {
          courseId: "maslow",
          surface: "«Иерархия потребностей А. Маслоу: новая парадигма»",
          role: "ACTIVE",
        },
      ],
    },
  });

  assert.equal(recovered.http, 200);
  // Price answered from commercial authority; the payment task is an explicit
  // limitation, not a payment method and not a payment link (D-3 open).
  assert.match(recovered.message!, /60\s?\u00a0000|60 000/);
  assert.match(recovered.message!, /не даю платёжных ссылок/);
  assert.equal(recovered.message!.includes("t.me/AST_payment_course_bot"), false);
  const coverage = recoveryEvents(recovered).find((event) => event.event === "NAVIGATOR_INTENT_PLAN_COVERAGE");
  assert.ok(coverage);
  assert.equal(coverage.limitationCount, 1);
});

// ---------------------------------------------------------------- safety

test("a composition whose primary act would activate payment refuses and fails closed", async () => {
  // The stored selection is the play course; the effective request opens with
  // the closed fresh payment form for maslow. On the primary COURSE_FOLLOW_UP
  // act the accepted payment contract resolves CONFIRM_COURSE_CHANGE — a
  // state-changing payment confirmation that must never be attached to a
  // composed answer, so the whole composition refuses and the turn retains the
  // authorized fail-closed behavior.
  const body = {
    messages: [
      { role: "user", content: "Меня зовут Тест. На «вы»." },
      {
        role: "assistant",
        content:
          "Мы обсуждали курс «Игра и творчество в жизни взрослых людей», а также курс «Иерархия потребностей А. Маслоу: новая парадигма».",
      },
      {
        role: "user",
        content:
          "Хочу оплатить курс Маслоу. Объясни, как самоактуализация связана с тревогой",
      },
    ],
    profile: DEV_S01.profile,
    conversationState: {
      ...DEV_S01.conversationState,
      courseMatch: "MATCHED",
      selectedCourseId: "play-and-creativity",
      deferredRequest: "Когда начинается набор на курс Маслоу?",
    },
  };
  const recovered = await runTurn({
    body,
    raw: {
      state: "COURSE_CONTENT",
      courseId: "maslow",
      evidenceRequested: false,
      contentIntentEvidence: "Объясни, как самоактуализация связана с тревогой",
    },
    plan: {
      tasks: [
        {
          type: "EDU",
          courseIds: ["maslow"],
          role: "ACTIVE",
          evidence: "Объясни, как самоактуализация связана с тревогой",
        },
        {
          type: "PAYMENT",
          courseIds: ["maslow"],
          role: "ACTIVE",
          evidence: "Хочу оплатить курс Маслоу",
        },
      ],
      mentions: [
        {
          courseId: "maslow",
          surface: "«Иерархия потребностей А. Маслоу: новая парадигма»",
          role: "ACTIVE",
        },
      ],
    },
  });

  assert.equal(recovered.http, 503);
  assert.equal(recovered.body.error?.retryable, true);
  assert.equal(recovered.body.error?.code, "NAVIGATOR_TECHNICAL_ERROR");
  assert.equal(recovered.message!.includes("t.me/AST_payment_course_bot"), false);
  // The veto is a retryable technical failure. It must not complete the
  // request, consume the queued remainder, or replace the stored selection.
  assert.equal(stateOf(recovered).lastAssistant?.act, "NAVIGATE");
  assert.equal(stateOf(recovered).pendingConfirmation, null);
  assert.equal(stateOf(recovered).selectedCourseId, "play-and-creativity");
  assert.equal(stateOf(recovered).deferredRequest, "Когда начинается набор на курс Маслоу?");
  assert.equal(
    (stateOf(recovered).execution as { lastCompletedRequestId?: string } | undefined)
      ?.lastCompletedRequestId,
    "smoke1-T10-1",
  );
  assert.notEqual(stateOf(recovered).lastTechnicalError, null);
  assert.equal(
    (stateOf(recovered).qualitySignals as Array<{ signalType?: string }> | undefined)?.at(-1)
      ?.signalType,
    "MATERIAL_FAILURE",
  );
  const veto = recoveryEvents(recovered).find((event) => event.event === "NAVIGATOR_INTENT_PLAN_RECOVERY");
  assert.ok(veto);
  assert.equal(veto.disposition, "PAYMENT_COMPOSITION_VETO");
});

test("an invalid extraction plan fails closed on the existing technical lane", async () => {
  const recovered = await runTurn({
    body: DEV_S01,
    raw: RETAINED_F1_RAW.S01,
    plan: { tasks: [] },
  });
  assertUnrecoveredTechnicalRetry(recovered);
  assert.equal(recovered.counters.extractionCalls, 1);
  const event = recoveryEvents(recovered).find((event) => event.event === "NAVIGATOR_INTENT_PLAN_RECOVERY");
  assert.ok(event);
  assert.equal(event.disposition, "PLAN_REJECTED");
  // State untouched.
  assert.equal(stateOf(recovered).courseMatch, "MATCHED");
  assert.equal(stateOf(recovered).selectedCourseId, "maslow");
});

test("a recoverable non-F-1 validation rejection uses one task-plan extraction", async () => {
  const recovered = await runTurn({
    body: DEV_S01,
    raw: "not a decision at all",
    plan: RETAINED_PLANS.S01,
  });
  assert.equal(recovered.http, 200);
  assert.equal(recovered.counters.extractionCalls, 1);
  assert.equal(recovered.counters.classifyCalls, 1);
  assert.equal(stateOf(recovered).lastAssistant?.act, "COURSE_FOLLOW_UP");
  assert.equal(stateOf(recovered).selectedCourseId, "maslow");
  assert.doesNotMatch(recovered.message ?? "", /окно набора/u);
  assert.equal(recovered.message!.includes("t.me/AST_payment_course_bot"), false);
  const event = recoveryEvents(recovered).find((entry) => entry.event === "NAVIGATOR_INTENT_PLAN_RECOVERY");
  assert.ok(event);
  assert.equal(event.disposition, "RECOVERED_SINGLE_ACT");
  assert.equal(event.extractionCalls, 1);

  const rejected = await runTurn({
    body: DEV_S01,
    raw: "not a decision at all",
    plan: { tasks: [] },
  });
  assertUnrecoveredTechnicalRetry(rejected);
  assert.equal(rejected.counters.extractionCalls, 1);
});

test("a classifier transport failure keeps the technical-error response (no recovery)", async () => {
  const counters: TurnCounters = {
    classifyCalls: 0,
    extractionCalls: 0,
    routeCalls: 0,
    retrieval: [],
  };
  const logs: { level: string; line: string }[] = [];
  const saved = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  const consoleSink = console as unknown as Record<string, (...parts: unknown[]) => void>;
  for (const level of ["info", "warn", "error", "log"] as const) {
    consoleSink[level] = (...parts: unknown[]) =>
      logs.push({ level, line: parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ") });
  }
  try {
    const response = await handleChatRequest(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(rebaseLastActivity(DEV_S01) as Record<string, unknown>),
          requestId: "armb-transport-1",
        }),
      }),
      {
        orchestrate: (messages, options) =>
          orchestrateNavigatorResponse(messages, {
            ...options,
            dependencies: {
              classifyAct: (msgs, opts) => {
                counters.classifyCalls += 1;
                return routeConversationAct(msgs, {
                  ...opts,
                  callJson: async () => {
                    throw new DeepSeekClientError("NETWORK_ERROR", "network down");
                  },
                });
              },
              extractPlan: async () => {
                counters.extractionCalls += 1;
                return RETAINED_PLANS.S01;
              },
            },
          }),
      },
    );
    assert.ok(response.status >= 500);
    const errorBody = await response.json();
    assert.equal(errorBody.error.code, "NAVIGATOR_TECHNICAL_ERROR");
    assert.equal(counters.extractionCalls, 0);
  } finally {
    Object.assign(console, saved);
  }
});

test("an extraction transport error fails closed on the technical turn", async () => {
  const recovered = await runTurn({
    body: DEV_S01,
    raw: RETAINED_F1_RAW.S01,
    plan: RETAINED_PLANS.S01,
    extractionError: () => new DeepSeekClientError("UPSTREAM_ERROR", "rejected", 503),
  });
  assertUnrecoveredTechnicalRetry(recovered);
  const event = recoveryEvents(recovered).find((event) => event.event === "NAVIGATOR_INTENT_PLAN_RECOVERY");
  assert.ok(event);
  assert.equal(event.disposition, "EXTRACTION_FAILED");
  assert.equal(event.reasonCode, "UPSTREAM_ERROR");
});

test("an extraction abort fails closed; the bounded timeout and the request signal are forwarded", async () => {
  const seen: { options: { timeoutMs?: number; signal?: AbortSignal } | null } = {
    options: null,
  };
  const recovered = await runTurn({
    body: DEV_S01,
    raw: RETAINED_F1_RAW.S01,
    plan: RETAINED_PLANS.S01,
    extractionError: (options) => {
      seen.options = options;
      return Object.assign(new Error("aborted"), { name: "AbortError" });
    },
  });
  assertUnrecoveredTechnicalRetry(recovered);
  assert.ok(seen.options);
  assert.equal(seen.options.timeoutMs, 30_000);
  assert.ok(seen.options.signal);
  const event = recoveryEvents(recovered).find((event) => event.event === "NAVIGATOR_INTENT_PLAN_RECOVERY");
  assert.ok(event);
  assert.equal(event.disposition, "EXTRACTION_FAILED");
  assert.equal(event.reasonCode, "ABORTED");
});

test("wrong-course resolved evidence takes the structural factual ceiling", async () => {
  const wrongCourseEvidence: ResolvedCourseEvidence[] = [
    {
      chunkId: 404,
      documentId: "doc-wrong",
      sourceId: "src-wrong",
      courseId: "levels-of-consciousness",
      sourceSlug: "wrong-course-slug",
      sourceTitle: "Чужой материал",
      sourceKind: "lecture",
      authorityRelation: "ELABORATION",
      courseSourceMetadata: {},
      sourceMetadata: {},
      documentMetadata: {},
      content: "WRONG_COURSE_MARKER",
      contentSha256: null,
      headingPath: [],
      locator: {},
      chunkMetadata: {},
      similarity: 0.9,
      controllingAuthorityEntries: [],
      evidenceRole: "ELABORATION",
    },
  ];
  const recovered = await runTurn({
    body: DEV_S03,
    raw: RETAINED_F1_RAW.S03,
    plan: RETAINED_PLANS.S03,
    retrieve: async () => {
      return {
        hasActiveSources: true,
        bindings: [],
        matches: [
          {
            chunkId: 404,
            documentId: "doc-wrong",
            sourceId: "src-wrong",
            courseId: "maslow",
            sourceSlug: "wrong-course-slug",
            sourceTitle: "Материал",
            sourceKind: "lecture",
            authorityRelation: "ELABORATION" as const,
            courseSourceMetadata: {},
            sourceMetadata: {},
            documentMetadata: {},
            content: "chunk",
            contentSha256: null,
            headingPath: [],
            locator: {},
            chunkMetadata: {},
            similarity: 0.9,
          },
        ],
      };
    },
    resolve: () => wrongCourseEvidence,
    selectEvidence: async () => ({
      status: "INSUFFICIENT",
      evidence: [] as never,
    }),
  });

  assert.equal(recovered.http, 200);
  assert.equal(recovered.message!.includes("WRONG_COURSE_MARKER"), false);
  const turnLog = recovered.logs
    .map((entry) => {
      try {
        return JSON.parse(entry.line) as PlanEvent;
      } catch {
        return null;
      }
    })
    .find((event) => event?.event === "NAVIGATOR_TURN");
  assert.ok(turnLog);
  assert.equal(turnLog.answerOrigin, "FACTUAL_CEILING");
  assert.equal(turnLog.crossCourseLeakageDetected, false);
});

test("a retracted course mention is not answered; the active task is", async () => {
  const body = {
    messages: [
      { role: "user", content: "Меня зовут Тест. На «вы»." },
      {
        role: "assistant",
        content:
          "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться.",
      },
      {
        role: "user",
        content:
          "Нет, вопрос про «Иерархия уровней сознания» снят. Что даёт курс «Игра и творчество в жизни взрослых людей» для раскрытия креативности?",
      },
    ],
    profile: DEV_S01.profile,
    conversationState: DEV_S01.conversationState,
  };
  const recovered = await runTurn({
    body,
    raw: {
      state: "COURSE_CONTENT",
      courseId: "play-and-creativity",
      evidenceRequested: false,
      contentIntentEvidence:
        "Что даёт курс «Игра и творчество в жизни взрослых людей» для раскрытия креативности",
    },
    plan: {
      tasks: [
        {
          type: "EDU",
          courseIds: ["play-and-creativity"],
          role: "ACTIVE",
          evidence:
            "Что даёт курс «Игра и творчество в жизни взрослых людей» для раскрытия креативности",
        },
      ],
      mentions: [
        {
          courseId: "play-and-creativity",
          surface: "«Игра и творчество в жизни взрослых людей»",
          role: "ACTIVE",
        },
        {
          courseId: "levels-of-consciousness",
          surface: "«Иерархия уровней сознания»",
          role: "RETRACTED",
        },
      ],
    },
  });

  assert.equal(recovered.http, 200);
  assert.equal(stateOf(recovered).lastAssistant?.act, "COURSE_FOLLOW_UP");
  assert.equal(recovered.counters.retrieval[0].courseId, "play-and-creativity");
  assert.match(recovered.message!, /Игра → Обучение/);
});

test("a two-course comparison recovers into the accepted FACTUAL comparison with both referents", async () => {
  const body = {
    messages: [
      { role: "user", content: "Меня зовут Тест. На «вы»." },
      {
        role: "assistant",
        content: "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться.",
      },
      {
        role: "user",
        content:
          "Чем отличаются курсы «Иерархия потребностей А. Маслоу: новая парадигма» и «Иерархия уровней сознания»?",
      },
    ],
    profile: DEV_S09.profile,
    conversationState: DEV_S09.conversationState,
  };
  const recovered = await runTurn({
    body,
    raw: {
      state: "COURSE_CONTENT",
      courseId: "maslow",
      evidenceRequested: false,
      contentIntentEvidence: "Чем отличаются курсы",
    },
    plan: RETAINED_PLANS.S04,
  });

  assert.equal(recovered.http, 200);
  assert.equal(stateOf(recovered).lastAssistant?.act, "FACTUAL");
  assert.equal(stateOf(recovered).courseMatch, "AMBIGUOUS");
  assert.deepEqual(stateOf(recovered).courseReferents, ["maslow", "levels-of-consciousness"]);
  assert.equal(recovered.counters.extractionCalls, 1);
  assert.equal(recovered.counters.routeCalls, 0);
});

// ---------------------------------------------------------------- pass-through

test("genuine accepted acts pass through with zero extraction calls", async () => {
  const priceBody = {
    messages: [
      { role: "user", content: "Меня зовут Тест. На «вы»." },
      {
        role: "assistant",
        content: "Спасибо, Тест. Расскажите, с чем хотите разобраться.",
      },
      {
        role: "user",
        content: "Сколько стоит «Иерархия потребностей А. Маслоу: новая парадигма»?",
      },
    ],
    profile: DEV_S09.profile,
    conversationState: DEV_S09.conversationState,
  };
  const factual = await runTurn({
    body: priceBody,
    classifyRaw: {
      state: "FACTUAL",
      intents: [
        { kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: ["PRICE"], scope: "REFERENCED" },
      ],
    },
    plan: RETAINED_PLANS.S09,
  });
  assert.equal(factual.http, 200);
  assert.match(factual.message!, /60/);
  assert.equal(factual.counters.extractionCalls, 0);

  const oos = await runTurn({
    body: priceBody,
    classifyRaw: { state: "OUT_OF_SCOPE" },
    plan: RETAINED_PLANS.S09,
  });
  assert.equal(oos.http, 200);
  assert.equal(stateOf(oos).lastAssistant?.act, "OUT_OF_SCOPE");
  assert.equal(oos.counters.extractionCalls, 0);
});

test("a genuine P4-B unresolved reference keeps the controlled uncertainty lane (no recovery)", async () => {
  const body = {
    messages: [
      { role: "user", content: "Меня зовут Тест. На «вы»." },
      {
        role: "assistant",
        content: "Спасибо, Тест. Расскажите, с чем хотите разобраться.",
      },
      // MAJOR-REMEDIATION-1.CORR1 (OD-1=A1): «А что умеет курс Маслоу?» names one
      // course and is now answered (asserted below); the genuinely unresolved
      // reference is an unknown program beside the course.
      { role: "user", content: "Прохожу курс алхимии и курс Маслоу. Что там разбирается?" },
    ],
    profile: DEV_S09.profile,
    conversationState: DEV_S09.conversationState,
  };
  const resolvedBody = {
    ...body,
    messages: [...body.messages.slice(0, 2), { role: "user", content: "А что умеет курс Маслоу?" }],
  };
  const resolved = await runTurn({
    body: resolvedBody,
    classifyRaw: { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false },
    plan: RETAINED_PLANS.S03,
  });
  assert.equal(resolved.http, 200);
  assert.equal(resolved.counters.extractionCalls, 0);
  assert.notEqual(stateOf(resolved).lastAssistant?.act, "TECHNICAL_ERROR");
  assert.notEqual(stateOf(resolved).lastAssistant?.act, "NAVIGATE");
  const result = await runTurn({
    body,
    classifyRaw: {
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: false,
    },
    plan: RETAINED_PLANS.S03,
  });
  assert.equal(result.http, 200);
  // No literal course anywhere → the validator's uncertainty lane, not recovery.
  assert.equal(result.counters.extractionCalls, 0);
  assert.equal(stateOf(result).lastAssistant?.act, "NAVIGATE");
  assert.notEqual(stateOf(result).lastAssistant?.act, "TECHNICAL_ERROR");
});

// FINAL-IMPLEMENTATION-1: exact IV1 counterexamples and substantive API/state assertions.
const FINAL_M = "Иерархия потребностей А. Маслоу: новая парадигма";
const FINAL_L = "Иерархия уровней сознания";
const FINAL_P = "Игра и творчество в жизни взрослых людей";
const finalTask = (type: TaskPlanTask["type"], courseIds: string[], evidence: string): TaskPlanTask => ({ type, courseIds, evidence, role: "ACTIVE" });
function finalBody(text: string, state: Record<string, unknown> = {}) {
  return {
    messages: [
      { role: "user", content: "Обсудим учебные программы Академии" },
      { role: "assistant", content: `Курсы каталога: «${FINAL_M}»; «${FINAL_L}»; «${FINAL_P}».` },
      { role: "user", content: text },
    ],
    profile: DEV_S13.profile,
    conversationState: {
      ...structuredClone(DEV_S13.conversationState),
      lastAssistant: { act: "FACTUAL", content: "Курсы каталога Академии", courseId: null },
      ...state,
    },
  };
}
async function finalTurn(
  text: string,
  tasks: TaskPlanTask[],
  options: Partial<Parameters<typeof runTurn>[0]> = {},
  state: Record<string, unknown> = {},
  mentions: { courseId: string | null; surface: string; role: "ACTIVE" | "BACKGROUND" | "REPORTED" | "RETRACTED" | "REJECTED" }[] = [],
) {
  return runTurn({
    body: finalBody(text, state),
    raw: { state: "COURSE_CONTENT", courseId: "maslow", evidenceRequested: false, contentIntentEvidence: text.slice(0, 200) },
    plan: { tasks, mentions },
    ...options,
  });
}
function finalCoverage(result: TurnResult) {
  assert.equal(result.http, 200, JSON.stringify(result.body));
  assert.ok(result.orchestration?.taskCoverage);
  return result.orchestration.taskCoverage;
}
const countText = (text: string, fragment: string) => text.split(fragment).length - 1;

for (const [kind, question] of [["COHORT", "Когда ближайший поток"], ["SCHEDULE", "Какое расписание занятий"]] as const) {
  test(`IV1 M1/M5: PRICE plus unsupported ${kind} shares work without losing outcomes`, async () => {
    const price = `Сколько стоит курс «${FINAL_M}»`;
    const result = await finalTurn(price + "? " + question, [finalTask("PRICE", ["maslow"], price), finalTask(kind, ["maslow"], question)]);
    const coverage = finalCoverage(result);
    assert.equal(coverage.activeTaskCount, 2);
    assert.equal(coverage.limitationCount, 1);
    assert.deepEqual(coverage.outcomes.map((outcome) => outcome.outcome), ["ANSWERED_FROM_AUTHORITY", "LIMITED_BY_FACTUAL_CEILING"]);
    assert.match(result.message!, /60[\s\u00a0]?000/);
    assert.match(result.message!, /авторитетного значения нет/);
    assert.deepEqual(coverage.outcomes.map((outcome) => outcome.courseIds), [["maslow"], ["maslow"]]);
    assert.deepEqual(result.counters.retrieval, []);
    const blocks = result.orchestration!.taskResponseBlocks!;
    assert.deepEqual(blocks.find((block) => /60[\s\u00a0]?000/.test(block.text))?.taskIndices, [0]);
    assert.deepEqual(blocks.find((block) => block.text.includes("авторитетного значения нет"))?.taskIndices, [1]);
    assert.equal(countText(result.message!, "Коммерческие сведения ограничены"), 1);
  });
}

test("IV1 M1: multiple foreign and unknown courses keep separate unresolved outcomes", async () => {
  const foreign = await finalTurn("Расскажите про Coursera и про Udemy", [
    finalTask("FOREIGN", [], "Расскажите про Coursera"), finalTask("FOREIGN", [], "про Udemy"),
  ]);
  assert.equal(finalCoverage(foreign).outcomes.length, 2);
  assert.equal(finalCoverage(foreign).limitationCount, 2);
  const text = "Расскажите про «Лаборатория смыслов» и про «Карта возможностей»";
  const unknown = await finalTurn(text, [
    finalTask("UNKNOWN_COURSE", [], "Расскажите про «Лаборатория смыслов»"),
    finalTask("UNKNOWN_COURSE", [], "про «Карта возможностей»"),
  ], {}, {}, [
    { courseId: null, surface: "Лаборатория смыслов", role: "ACTIVE" },
    { courseId: null, surface: "Карта возможностей", role: "ACTIVE" },
  ]);
  assert.equal(finalCoverage(unknown).outcomes.length, 2);
  assert.equal(unknown.counters.retrieval.length, 0);
});

test("four metadata requests preserve field availability rather than authority-document presence", async () => {
  const price = `Сколько стоит курс «${FINAL_M}»`;
  const qs = [price, "Когда ближайший поток", "Какое расписание", "До какого числа набор"];
  const types = ["PRICE", "COHORT", "SCHEDULE", "ENROLLMENT_WINDOW"] as const;
  const result = await finalTurn(qs.join("? "), types.map((type, index) => finalTask(type, ["maslow"], qs[index])));
  const coverage = finalCoverage(result);
  assert.equal(coverage.activeTaskCount, 4);
  assert.equal(coverage.limitationCount, 3);
  assert.deepEqual(coverage.outcomes.map((outcome) => outcome.facts?.[0].field), types);
});

test("IV1 M2: meetings and course link execute once each and share only overlapping information", async () => {
  const meetings = `Сколько встреч в курсе «${FINAL_M}»`;
  const link = "Дайте ссылку на курс";
  const result = await finalTurn(meetings + "? " + link, [finalTask("EDU", ["maslow"], meetings), finalTask("EDU", ["maslow"], link)]);
  const coverage = finalCoverage(result);
  assert.equal(coverage.limitationCount, 0);
  assert.equal(result.counters.retrieval.length, 2);
  assert.deepEqual(new Set(result.counters.retrieval.map((entry) => entry.query)), new Set([meetings, link]));
  assert.match(result.message!, /количество встреч: 6/);
  assert.equal(countText(result.message!, "https://structural-typology.academy/courses/maslow"), 1);
  assert.equal(countText(result.message!, "Подтверждённые публичные учебные результаты курса:"), 1);
});

test("IV1 M3: all four catalog answers share a supported block without false limitations", async () => {
  const qs = [`Что даёт курс «${FINAL_M}»`, "Чему научит эта программа", "Какие учебные результаты есть", "О чём курс"];
  const result = await finalTurn(qs.join("? "), qs.map((q) => finalTask("EDU", ["maslow"], q)));
  const coverage = finalCoverage(result);
  assert.equal(coverage.activeTaskCount, 4);
  assert.equal(coverage.limitationCount, 0);
  assert.equal(result.counters.retrieval.length, 4);
  assert.equal(countText(result.message!, "Подтверждённые публичные учебные результаты курса:"), 1);
  assert.deepEqual(result.orchestration?.taskResponseBlocks?.[0].taskIndices, [0, 1, 2, 3]);
  assert.equal(result.message!.includes("не разобрал"), false);
});

test("legitimately identical answers and identical extracted tasks are not demoted", async () => {
  const first = `Что даёт курс «${FINAL_M}»`;
  const second = "Чему научит этот курс";
  const result = await finalTurn(first + "? " + second, [finalTask("EDU", ["maslow"], first), finalTask("EDU", ["maslow"], second)]);
  assert.equal(finalCoverage(result).limitationCount, 0);
  assert.equal(countText(result.message!, "Подтверждённые публичные учебные результаты курса:"), 1);
  const duplicated = await finalTurn(first, [finalTask("EDU", ["maslow"], first), finalTask("EDU", ["maslow"], first)]);
  assert.equal(finalCoverage(duplicated).outcomes.length, 2);
  assert.equal(duplicated.counters.retrieval.length, 1);
});

test("IV1 M4: two comparisons survive with distinct pairs and exactly one state owner", async () => {
  const q = `Что даёт курс «${FINAL_M}»`;
  const first = `Сравните «${FINAL_M}» и «${FINAL_L}»`;
  const second = `Сравните «${FINAL_M}» и «${FINAL_P}»`;
  const result = await finalTurn(q + "? " + first + ". " + second, [
    finalTask("EDU", ["maslow"], q),
    finalTask("COMPARE", ["maslow", "levels-of-consciousness"], first),
    finalTask("COMPARE", ["maslow", "play-and-creativity"], second),
  ], {}, { courseMatch: "MATCHED", selectedCourseId: "normative-situation" });
  const coverage = finalCoverage(result);
  assert.equal(coverage.limitationCount, 0);
  assert.ok(result.message!.includes(FINAL_L));
  assert.ok(result.message!.includes(FINAL_P));
  assert.deepEqual(coverage.outcomes[1].courseIds, ["maslow", "levels-of-consciousness"]);
  assert.deepEqual(coverage.outcomes[2].courseIds, ["maslow", "play-and-creativity"]);
  assert.equal(stateOf(result).courseMatch, "AMBIGUOUS");
  assert.equal(stateOf(result).selectedCourseId, null);
  assert.deepEqual(stateOf(result).courseReferents, ["maslow", "levels-of-consciousness"]);
});

test("two comparisons alone both answer and do not recreate the single-segment crash", async () => {
  const first = `Сравните «${FINAL_M}» и «${FINAL_L}»`;
  const second = `Сравните «${FINAL_M}» и «${FINAL_P}»`;
  const result = await finalTurn(first + ". " + second, [
    finalTask("COMPARE", ["maslow", "levels-of-consciousness"], first),
    finalTask("COMPARE", ["maslow", "play-and-creativity"], second),
  ]);
  assert.equal(finalCoverage(result).outcomes.length, 2);
  assert.equal(finalCoverage(result).limitationCount, 0);
  assert.ok(result.message!.includes(FINAL_L) && result.message!.includes(FINAL_P));
});

for (const failing of ["primary", "secondary"] as const) {
  test(`${failing} failure preserves the other completed API answer and canonical selection`, async () => {
    const primary = `Что даёт курс «${FINAL_M}»`;
    const secondary = `Что даёт курс «${FINAL_P}»`;
    const calls: string[] = [];
    const result = await finalTurn(primary + "? " + secondary, [finalTask("EDU", ["maslow"], primary), finalTask("EDU", ["play-and-creativity"], secondary)], {
      retrieve: async (courseId) => {
        calls.push(courseId);
        if (courseId === (failing === "primary" ? "maslow" : "play-and-creativity")) throw new Error("OFFLINE_SEGMENT_FAILURE");
        return NO_SOURCES;
      },
    }, { courseMatch: "MATCHED", selectedCourseId: "levels-of-consciousness" });
    const coverage = finalCoverage(result);
    assert.deepEqual(calls, ["play-and-creativity", "maslow"]);
    assert.equal(coverage.limitationCount, 1);
    assert.equal(coverage.outcomes[failing === "primary" ? 0 : 1].reasonCode, "SEGMENT_DISPATCH_FAILED");
    assert.match(result.message!, /Подтверждённые публичные учебные результаты курса:/);
    assert.match(result.message!, /не разобрал/);
    assert.equal(stateOf(result).selectedCourseId, "levels-of-consciousness");
    if (failing === "primary") {
      assert.equal(result.orchestration!.conversationAct.state, "ROUTER_DEGRADED");
      assert.equal(stateOf(result).lastAssistant?.act, "TECHNICAL_ERROR");
    }
  });
}

function finalEvidence(courseId: string, chunkId: number, content: string): ResolvedCourseEvidence {
  return {
    chunkId, documentId: `doc-${chunkId}`, sourceId: `source-${chunkId}`, courseId,
    sourceSlug: `audit-${chunkId}`, sourceTitle: "Synthetic authority", sourceKind: "lecture",
    authorityRelation: "FOUNDATIONAL", courseSourceMetadata: {}, sourceMetadata: {}, documentMetadata: {},
    content, contentSha256: null, headingPath: [], locator: {}, chunkMetadata: {}, similarity: 0.9,
    controllingAuthorityEntries: [], evidenceRole: "FOUNDATIONAL",
  };
}

for (const missingSecond of [false, true]) {
  test(`different same-course knowledge has task-specific evidence; missing second=${missingSecond}`, async () => {
    const first = `Как «${FINAL_M}» объясняет изменение мотивации`;
    const second = "Как тревога связана с самоактуализацией";
    const fact1 = "Мотивация меняется под давлением контекста.";
    const fact2 = "Тревога препятствует самоактуализации.";
    const queries: string[] = [];
    const result = await finalTurn(first + "? " + second, [finalTask("EDU", ["maslow"], first), finalTask("EDU", ["maslow"], second)], {
      retrieve: async (courseId, query) => {
        queries.push(query);
        if (missingSecond && query === second) return NO_SOURCES;
        return { hasActiveSources: true, bindings: [], matches: [finalEvidence(courseId, query === first ? 21 : 22, query === first ? fact1 : fact2)] };
      },
      resolve: (matches) => matches.map((match) => ({ ...match, controllingAuthorityEntries: [], evidenceRole: "FOUNDATIONAL" as const })),
      selectEvidence: async (_query, evidence) => ({ status: "SUPPORTED", evidence: [{ chunkId: evidence[0].chunkId, quote: evidence[0].content }] }),
      composeFollowUp: (messages, act, options) => composeCourseFollowUpAnswer(messages, act, {
        ...options,
        callText: async () => options.courseEvidence![0].content,
        callJson: async () => ({ status: "PASS" }),
      }),
    });
    const coverage = finalCoverage(result);
    assert.deepEqual(new Set(queries), new Set([first, second]));
    assert.equal(queries.length, 2);
    assert.ok(result.message!.includes(fact1));
    assert.deepEqual(coverage.outcomes[0].evidenceChunkIds, [21]);
    if (missingSecond) {
      assert.equal(coverage.outcomes[1].outcome, "LIMITED_BY_FACTUAL_CEILING");
      assert.equal(result.message!.includes(fact2), false);
    } else {
      assert.ok(result.message!.includes(fact2));
      assert.deepEqual(coverage.outcomes[1].evidenceChunkIds, [22]);
      assert.equal(coverage.limitationCount, 0);
    }
  });
}

test("semantically wrong but structurally valid plan remains an explicit extraction limitation", async () => {
  const q = `Что даёт курс «${FINAL_M}»`;
  const result = await finalTurn(q, [finalTask("EDU", ["levels-of-consciousness"], q)], {}, {}, [
    { courseId: "maslow", surface: FINAL_M, role: "ACTIVE" },
  ]);
  assert.equal(finalCoverage(result).outcomes.length, 1);
  assert.deepEqual(result.counters.retrieval.map((entry) => entry.courseId), ["levels-of-consciousness"]);
  assert.deepEqual(finalCoverage(result).outcomes[0].courseIds, ["levels-of-consciousness"]);
  // This is not a correct semantic answer. Accounting only establishes accepted-plan coverage.
  assert.match(COVERAGE_NON_CLAIM, /extraction completeness is UNKNOWN/);
});

for (const [role, lead] of [
  ["BACKGROUND", `Раньше изучал «${FINAL_M}». `],
  ["REPORTED", `Коллега спрашивал про «${FINAL_M}». `],
  ["RETRACTED", `Вопрос про «${FINAL_M}» снимаю. `],
] as const) {
  test(`correct ${role} mention does not become an active task`, async () => {
    const active = `Что даёт курс «${FINAL_P}»`;
    const result = await finalTurn(lead + active, [finalTask("EDU", ["play-and-creativity"], active)], {}, {}, [
      { courseId: "maslow", surface: FINAL_M, role },
    ]);
    assert.deepEqual(result.counters.retrieval.map((entry) => entry.courseId), ["play-and-creativity"]);
    assert.equal(finalCoverage(result).outcomes.length, 1);
  });
}

test("pending payment confirmation stays kernel-owned and saved/new requests both answer after routing", async () => {
  const q = `Что даёт курс «${FINAL_P}»`;
  const pending = { confirmationKey: "payment-course-change:maslow:play-and-creativity", kind: "PAYMENT_COURSE_CHANGE", prompt: "Подтвердите смену курса?", candidateCourseId: "play-and-creativity" };
  const blocked = await finalTurn(q, [finalTask("EDU", ["play-and-creativity"], q)], {}, { courseMatch: "MATCHED", selectedCourseId: "maslow", pendingConfirmation: pending });
  assert.equal(blocked.http, 200);
  assert.equal(blocked.counters.classifyCalls, 0);
  assert.equal(blocked.counters.extractionCalls, 0);
  assert.deepEqual(stateOf(blocked).pendingConfirmation, pending);
  const price = `Сколько стоит курс «${FINAL_M}»`;
  const answered = await finalTurn(q, [finalTask("PRICE", ["maslow"], price), finalTask("EDU", ["play-and-creativity"], q)], {}, { courseMatch: "MATCHED", selectedCourseId: "maslow", deferredRequest: price });
  assert.equal(finalCoverage(answered).outcomes.length, 2);
  assert.equal(finalCoverage(answered).limitationCount, 0);
  assert.match(answered.message!, /60[\s\u00a0]?000/);
  assert.match(answered.message!, /Игра → Обучение → Творчество → Рутина/);
  assert.equal(stateOf(answered).deferredRequest, null);
});

test("single supported extraction error and all-segment failures remain closed with no phantom outcomes", async () => {
  const q = `Как «${FINAL_M}» объясняет тревогу`;
  const other = "Как мотивация связана с контекстом";
  const result = await finalTurn(q + "? " + other, [finalTask("EDU", ["maslow"], q), finalTask("EDU", ["maslow"], other)], {
    retrieve: async () => { throw new Error("ALL_SEGMENTS_FAILED"); },
  });
  assert.equal(finalCoverage(result).limitationCount, 2);
  assert.equal(finalCoverage(result).outcomes.every((outcome) => outcome.reasonCode === "SEGMENT_DISPATCH_FAILED"), true);
  assert.equal(result.message!.includes("Подтверждённые публичные учебные результаты курса:"), false);
});


test("abort after a safe secondary keeps its answer and prevents primary work/state", async () => {
  const controller = new AbortController();
  const first = `Что даёт курс «${FINAL_M}»`;
  const second = `Что даёт курс «${FINAL_P}»`;
  const calls: string[] = [];
  const result = await finalTurn(first + "? " + second, [finalTask("EDU", ["maslow"], first), finalTask("EDU", ["play-and-creativity"], second)], {
    signal: controller.signal,
    retrieve: async (id) => { calls.push(id); controller.abort(); return NO_SOURCES; },
  }, { courseMatch: "MATCHED", selectedCourseId: "levels-of-consciousness" });
  assert.equal(finalCoverage(result).limitationCount, 1);
  assert.deepEqual(calls, ["play-and-creativity"]);
  assert.match(result.message!, /Игра → Обучение → Творчество → Рутина/);
  assert.equal(result.orchestration!.conversationAct.state, "ROUTER_DEGRADED");
  assert.equal(stateOf(result).selectedCourseId, "levels-of-consciousness");
});

test("LISTED_UNROUTABLE tasks remain explicit limitations without retrieval", async () => {
  const title = "Стадии профессионального развития взрослого человека";
  const text = `Что даёт курс «${title}»`;
  const result = await finalTurn(text, [finalTask("EDU", ["professional-development-stages"], text)]);
  assert.equal(finalCoverage(result).limitationCount, 1);
  assert.equal(finalCoverage(result).outcomes[0].outcome, "NOT_SAFELY_EXECUTABLE");
  assert.deepEqual(result.counters.retrieval, []);
  assert.match(result.message!, /не разобрал/);
});

test("F-1 recovery does not apply the non-F-1 metadata provenance gate", async () => {
  const text = "Курс Маслоу исключаю; сколько стоит курс для меня";
  const mentions = [
    { courseId: "maslow" as const, surface: "Ма", role: "REJECTED" as const },
    { courseId: "maslow" as const, surface: "Курс Маслоу", role: "ACTIVE" as const },
  ];
  const plan = {
    tasks: [{ type: "PRICE", courseIds: ["maslow"], role: "ACTIVE", evidence: text }],
    mentions,
  };
  const nonF1 = await runTurn({
    body: {
      messages: [{ role: "user", content: text }],
      profile: DEV_S13.profile,
      conversationState: structuredClone(DEV_S13.conversationState),
    },
    raw: { state: "UNRECOGNIZED" },
    plan,
    requestId: "m03-non-f1-isolation",
  });
  assert.equal(nonF1.http, 200, JSON.stringify(nonF1.body));
  assert.equal(nonF1.counters.extractionCalls, 1);
  assert.equal(nonF1.counters.classifyCalls, 1);
  assert.match(nonF1.message ?? "", /не разобрал/u);
  assert.doesNotMatch(nonF1.message ?? "", /60[\s\u00a0]?000/u);
  assert.equal(nonF1.body.contactCard ?? null, null);

  const f1 = await finalTurn(
    text,
    [finalTask("PRICE", ["maslow"], text)],
    { requestId: "m03-f1-isolation" },
    {},
    mentions,
  );
  assert.equal(f1.http, 200, JSON.stringify(f1.body));
  assert.equal(f1.counters.extractionCalls, 1);
  assert.match(f1.message ?? "", /60[\s\u00a0]?000/u);
  assert.match(f1.message ?? "", /Иерархия потребностей А\. Маслоу: новая парадигма/u);
});

test("CORR1 exact F-1 validator prices merged selected courses and similar rejections do not", async () => {
  const text = "Сколько стоит этот курс; цена обучения интересует сейчас";
  const tasks = [
    finalTask("PRICE", [], "Сколько стоит этот курс"),
    finalTask("PRICE", [], "цена обучения интересует сейчас"),
  ];
  const courses = [
    {
      id: "maslow",
      title: /Иерархия потребностей А\. Маслоу: новая парадигма/u,
      amount: /60[\s\u00a0]?000/u,
      absent: /Игра и творчество в жизни взрослых людей|Нормативная ситуация/u,
    },
    {
      id: "normative-situation",
      title: /«Нормативная ситуация»/u,
      amount: /60[\s\u00a0]?000/u,
      absent: /Иерархия потребностей А\. Маслоу|Игра и творчество|Иерархия уровней сознания/u,
    },
    {
      id: "play-and-creativity",
      title: /Игра и творчество в жизни взрослых людей/u,
      amount: /60[\s\u00a0]?000/u,
      absent: /Иерархия потребностей А\. Маслоу|Нормативная ситуация/u,
    },
  ] as const;
  for (const course of courses) {
    for (const order of [tasks, [...tasks].reverse()] as const) {
      const requestId = `corr1-real-${course.id}-${order[0].evidence.startsWith("Сколько") ? "forward" : "reverse"}`;
      const result = await finalTurn(
        text,
        [...order],
        { requestId },
        {
          courseMatch: "MATCHED",
          selectedCourseId: course.id,
          deferredRequest: "Вернитесь к этому вопросу позже",
        },
      );
      assert.equal(result.http, 200, JSON.stringify(result.body));
      assert.equal(result.counters.classifyCalls, 1);
      assert.equal(result.counters.extractionCalls, 1);
      assert.equal(result.counters.routeCalls, 0);
      assert.match(result.message ?? "", course.title);
      assert.match(result.message ?? "", course.amount);
      assert.match(result.message ?? "", /26 октября 2026 года/u);
      assert.doesNotMatch(result.message ?? "", course.absent);
      assert.doesNotMatch(result.message ?? "", /Уточните, пожалуйста, название курса/u);
      assert.doesNotMatch(result.message ?? "", /t\.me\/|@AST_payment/u);
      assert.equal(result.orchestration?.completion, "ANSWERED");
      assert.equal(result.body.contactCard ?? null, null);
      const coverage = finalCoverage(result);
      assert.equal(coverage.limitationCount, 0);
      assert.equal(coverage.activeTaskCount, 2);
      for (const outcome of coverage.outcomes) {
        assert.equal(outcome.outcome, "ANSWERED_FROM_AUTHORITY");
        assert.deepEqual(outcome.courseIds, [course.id]);
        assert.equal(outcome.facts?.[0]?.courseId, course.id);
        assert.equal(outcome.facts?.[0]?.status, "SUPPORTED");
        assert.equal(outcome.facts?.[0]?.field, "PRICE");
      }
      const state = stateOf(result);
      assert.equal(state.selectedCourseId, course.id);
      assert.equal(state.courseMatch, "MATCHED");
      assert.equal(state.deferredRequest, null);
      assert.equal(
        (state.execution as { lastCompletedRequestId?: string }).lastCompletedRequestId,
        requestId,
      );
      if (course.id === "maslow" && order[0].evidence.startsWith("Сколько")) {
        const replay = await runTurn({
          body: {
            messages: [{ role: "user", content: text }],
            profile: DEV_S13.profile,
            conversationState: state,
          },
          raw: {
            state: "COURSE_CONTENT",
            courseId: "maslow",
            evidenceRequested: false,
            contentIntentEvidence: text,
          },
          plan: { tasks: order, mentions: [] },
          requestId,
        });
        assert.equal(replay.http, 200);
        assert.equal(replay.message, result.message);
        assert.equal(replay.counters.extractionCalls, 0);
        assert.equal(replay.counters.classifyCalls, 0);
        assert.equal(replay.counters.routeCalls, 0);
      }
    }
  }

  const stored = {
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
    deferredRequest: "Вернитесь к этому вопросу позже",
  };
  const unrecognized = await runTurn({
    body: finalBody(text, stored),
    raw: { state: "UNRECOGNIZED" },
    plan: { tasks, mentions: [] },
    requestId: "corr1-real-unrecognized",
  });
  assert.equal(unrecognized.http, 200, JSON.stringify(unrecognized.body));
  assert.equal(unrecognized.counters.extractionCalls, 1);
  assert.match(unrecognized.message ?? "", /не разобрал/u);
  assert.doesNotMatch(unrecognized.message ?? "", /60[\s\u00a0]?000/u);
  assert.doesNotMatch(unrecognized.message ?? "", /Иерархия потребностей А\. Маслоу/u);
  assert.equal(stateOf(unrecognized).selectedCourseId, "maslow");

  const similar = await runTurn({
    body: finalBody(text, stored),
    raw: {
      state: "COURSE_CONTENT",
      courseId: "maslow",
      evidenceRequested: false,
      contentIntentEvidence: text,
      extra: true,
    },
    plan: { tasks, mentions: [] },
    requestId: "corr1-real-similar",
  });
  assert.equal(similar.http, 200, JSON.stringify(similar.body));
  assert.equal(similar.counters.extractionCalls, 1);
  assert.match(similar.message ?? "", /не разобрал/u);
  assert.doesNotMatch(similar.message ?? "", /60[\s\u00a0]?000/u);
  assert.doesNotMatch(similar.message ?? "", /Иерархия потребностей А\. Маслоу/u);
  assert.equal(stateOf(similar).selectedCourseId, "maslow");
});
