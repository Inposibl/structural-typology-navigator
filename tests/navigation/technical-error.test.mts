/**
 * Package-B A21 system-error lane (B-E1..B-E6).
 *
 * The technical path is structurally distinct from semantic fallback: a
 * provider, resolver, or data-access failure must never become NO_MATCH,
 * NO_CURRENT_COURSE_MATCH, OUT_OF_SCOPE, or a request for reformulation.
 *
 * Every failure below is injected locally and deterministically. No live
 * provider, database, or network timeout behaviour is involved.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationProfile } from "../../src/lib/chat-contract.ts";
import { DeepSeekClientError } from "../../src/lib/navigation/deepseek-client.ts";
import {
  NavigatorStageError,
} from "../../src/lib/navigation/navigator-observability.ts";
import {
  createInitialConversationState,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import {
  classifyTechnicalFailure,
} from "../../src/lib/navigation/technical-error.ts";
import {
  orchestrateNavigatorResponse,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  handleChatRequest,
  type ChatRouteDependencies,
} from "../../src/app/api/chat/route.ts";

const T0 = Date.now();

const COMPLETE_PROFILE: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

/** Internal labels that must never appear in a public response. */
const INTERNAL_LABEL_PATTERN =
  /provider|timeout|configuration|rpc|supabase|cohere|deepseek|navigator_|out_of_scope|no_match|course_rpc|act_router|stack|exception|\bstage\b|embeddings|api[_-]?key|bearer/iu;

/** Semantic-fallback wording a technical failure must never produce. */
const SEMANTIC_FALLBACK_PATTERN =
  /не понял|не поняла|уточните запрос|вне функции|не могу уверенно отнести/iu;

type TechnicalErrorBody = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    conversationState: ConversationState;
  };
};

function assertSafePublicTechnicalText(message: string): void {
  assert.doesNotMatch(message, INTERNAL_LABEL_PATTERN);
  assert.doesNotMatch(message, SEMANTIC_FALLBACK_PATTERN);
  assert.ok(message.trim().length > 0);
}

/**
 * Rich state that a technical failure must preserve untouched.
 *
 * An unresolved pending confirmation is deliberately absent: Package A gates
 * ordinary routing while a confirmation is open, so a confirmation-bearing
 * turn never reaches the orchestration layer at all.
 */
function loadedState(): ConversationState {
  return {
    ...createInitialConversationState(T0),
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
    activeFlow: { id: "COURSE_FOLLOW_UP", pendingQuestion: "Что уточнить?" },
    clarification: {
      issueKey: "ask-more:maslow",
      attempts: 1,
      strategyKey: "ask-more-1",
    },
    deferredRequest: "и ещё расскажи про следующий поток",
    repair: { issueKey: "repair:course:maslow", attempts: 1 },
    handoff: { status: "OFFERED", reason: "FRUSTRATION", context: null },
    lastAssistant: {
      act: "COURSE_FOLLOW_UP",
      content: "Курс помогает анализировать мотивацию.",
      courseId: "maslow",
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

async function failedTurn(
  error: unknown,
  state: ConversationState = loadedState(),
): Promise<TechnicalErrorBody> {
  const response = await chatRequest(
    {
      messages: [{ role: "user", content: "Почему курс Маслоу подходит?" }],
      profile: COMPLETE_PROFILE,
      conversationState: state,
    },
    { orchestrate: () => Promise.reject(error) },
  );

  assert.notEqual(response.status, 200);
  const payload = (await response.json()) as TechnicalErrorBody;

  assert.equal(payload.error.code, "NAVIGATOR_TECHNICAL_ERROR");
  assertSafePublicTechnicalText(payload.error.message);

  const returned = payload.error.conversationState;
  // The canonical state is preserved, not replaced and not advanced.
  assert.equal(returned.selectedCourseId, state.selectedCourseId);
  assert.equal(returned.courseMatch, state.courseMatch);
  assert.deepEqual(returned.clarification, state.clarification);
  assert.equal(returned.deferredRequest, state.deferredRequest);
  assert.deepEqual(returned.activeFlow, state.activeFlow);
  assert.deepEqual(returned.repair, state.repair);
  assert.deepEqual(returned.handoff, state.handoff);
  assert.deepEqual(returned.lastAssistant, state.lastAssistant);
  // A technical failure never marks a request as successfully completed.
  assert.equal(returned.execution.phase, "IDLE");
  assert.equal(returned.execution.lastCompletedRequestId, null);
  assert.notEqual(returned.lastTechnicalError, null);

  return payload;
}

test("B-E1: a provider timeout selects the technical lane with a retryable class", async () => {
  const payload = await failedTurn(
    new NavigatorStageError(
      "ACT_ROUTER",
      new DeepSeekClientError(
        "ABORTED",
        "DeepSeek request was aborted or timed out.",
      ),
    ),
  );

  assert.equal(payload.error.retryable, true);
  assert.equal(
    payload.error.conversationState.lastTechnicalError?.failureClass,
    "PROVIDER_TIMEOUT",
  );
  assert.equal(
    payload.error.conversationState.lastTechnicalError?.stage,
    "ACT_ROUTER",
  );
  assert.match(
    payload.error.conversationState.lastTechnicalError?.occurredAt ?? "",
    /Z$/u,
  );
});

test("B-E1b: a provider outage selects PROVIDER_UNAVAILABLE", async () => {
  const network = classifyTechnicalFailure(
    new NavigatorStageError(
      "ROUTER",
      new DeepSeekClientError("NETWORK_ERROR", "DeepSeek was unreachable."),
    ),
  );
  assert.equal(network.failureClass, "PROVIDER_UNAVAILABLE");
  assert.equal(network.retryable, true);

  const upstream = classifyTechnicalFailure(
    new NavigatorStageError(
      "ACT_ROUTER",
      new DeepSeekClientError("UPSTREAM_ERROR", "rejected", 503),
    ),
  );
  assert.equal(upstream.failureClass, "PROVIDER_UNAVAILABLE");
});

test("B-E2: a provider configuration failure is classified and not retryable", async () => {
  const payload = await failedTurn(
    new NavigatorStageError(
      "ROUTER",
      new DeepSeekClientError(
        "CONFIGURATION_ERROR",
        "DEEPSEEK_API_KEY is required.",
      ),
    ),
  );

  assert.equal(payload.error.retryable, false);
  assert.equal(
    payload.error.conversationState.lastTechnicalError?.failureClass,
    "CONFIGURATION_FAILURE",
  );
});

test("B-E3: a throwing semantic resolver is a technical failure, never a semantic verdict", async () => {
  const response = await chatRequest(
    {
      messages: [
        { role: "user", content: "Мне важно и про мотивацию, и про поведение." },
      ],
      profile: COMPLETE_PROFILE,
      conversationState: loadedState(),
    },
    {
      orchestrate: (messages, options) =>
        orchestrateNavigatorResponse(messages, {
          ...options,
          dependencies: {
            classifyAct: () => {
              throw new Error("resolver exploded");
            },
          },
        }),
    },
  );

  assert.notEqual(response.status, 200);
  const payload = (await response.json()) as TechnicalErrorBody;

  assert.equal(payload.error.code, "NAVIGATOR_TECHNICAL_ERROR");
  assertSafePublicTechnicalText(payload.error.message);
  assert.equal(
    payload.error.conversationState.lastTechnicalError?.failureClass,
    "INTERNAL_RUNTIME_FAILURE",
  );
  // Deterministic state survives the resolver failure for retry/handoff.
  assert.equal(payload.error.conversationState.selectedCourseId, "maslow");
  assert.equal(payload.error.conversationState.courseMatch, "MATCHED");
  // The semantic clarification counter is not touched by infrastructure.
  assert.equal(payload.error.conversationState.clarification?.attempts, 1);
});

test("B-E4: a data-access failure is classified as a data failure", async () => {
  const payload = await failedTurn(
    new NavigatorStageError(
      "COURSE_RPC",
      Object.assign(new Error("rpc unavailable"), { code: "RPC_UNAVAILABLE" }),
    ),
  );

  assert.equal(
    payload.error.conversationState.lastTechnicalError?.failureClass,
    "DATA_ACCESS_FAILURE",
  );
  assert.equal(
    payload.error.conversationState.lastTechnicalError?.stage,
    "COURSE_RPC",
  );
  assert.equal(
    payload.error.conversationState.lastTechnicalError?.retryable,
    true,
  );
});

test("B-E4b: the coarse taxonomy is closed and unmapped failures stay unknown", () => {
  assert.equal(
    classifyTechnicalFailure(new NavigatorStageError("COMPOSER", new Error("x")))
      .failureClass,
    "INTERNAL_RUNTIME_FAILURE",
  );
  assert.equal(
    classifyTechnicalFailure("not an error").failureClass,
    "UNKNOWN_TECHNICAL_FAILURE",
  );
  assert.equal(
    classifyTechnicalFailure(
      new NavigatorStageError(
        "AUTHORITY",
        new DeepSeekClientError("INVALID_RESPONSE", "bad"),
      ),
    ).failureClass,
    "PROVIDER_UNAVAILABLE",
  );
});

test("B-E5: a turn after a technical failure is still usable for retry", async () => {
  const state = loadedState();
  const failed = await chatRequest(
    {
      messages: [{ role: "user", content: "Почему курс Маслоу подходит?" }],
      profile: COMPLETE_PROFILE,
      conversationState: state,
      requestId: "retry-1",
    },
    {
      orchestrate: () =>
        Promise.reject(
          new NavigatorStageError(
            "COURSE_RPC",
            Object.assign(new Error("rpc"), { code: "RPC_UNAVAILABLE" }),
          ),
        ),
    },
  );

  const failedBody = (await failed.json()) as TechnicalErrorBody;
  const preserved = failedBody.error.conversationState;

  // Not stuck busy: the failed turn left the session idle and retryable.
  assert.equal(preserved.execution.phase, "IDLE");
  assert.equal(preserved.execution.lastCompletedRequestId, null);

  // The preserved state is still accepted, and a deterministic turn completes.
  const retried = await chatRequest({
    messages: [{ role: "user", content: "что ты имел в виду?" }],
    profile: COMPLETE_PROFILE,
    conversationState: preserved,
    requestId: "retry-1",
  });

  assert.equal(retried.status, 200);
  const retriedBody = (await retried.json()) as {
    message: string;
    conversationState: ConversationState;
  };
  assert.ok(retriedBody.message.trim().length > 0);
  assert.equal(retriedBody.conversationState.execution.phase, "IDLE");
  assert.equal(
    retriedBody.conversationState.execution.lastCompletedRequestId,
    "retry-1",
  );
});

test("B-E6: a later successful turn deterministically clears the technical marker", async () => {
  const failed = await chatRequest(
    {
      messages: [{ role: "user", content: "Почему курс Маслоу подходит?" }],
      profile: COMPLETE_PROFILE,
      conversationState: loadedState(),
    },
    {
      orchestrate: () =>
        Promise.reject(
          new NavigatorStageError(
            "ACT_ROUTER",
            new DeepSeekClientError("ABORTED", "aborted"),
          ),
        ),
    },
  );

  const failedBody = (await failed.json()) as TechnicalErrorBody;
  assert.notEqual(failedBody.error.conversationState.lastTechnicalError, null);

  const succeeded = await chatRequest({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: failedBody.error.conversationState,
  });

  assert.equal(succeeded.status, 200);
  const body = (await succeeded.json()) as {
    conversationState: ConversationState;
  };
  assert.equal(body.conversationState.lastTechnicalError, null);
});
