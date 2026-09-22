import { randomUUID } from "node:crypto";

import type {
  ChatErrorResponse,
  ChatSuccessResponse,
  ChatTechnicalErrorResponse,
  ConversationMessage,
  ConversationProfile,
} from "@/lib/chat-contract";
import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CONVERSATION_MESSAGES,
} from "@/lib/chat-contract";
import {
  normalizeConversationProfilePayload,
  ConversationProfileValidationError,
} from "@/lib/navigation/conversation-profile";
import {
  ConversationStateValidationError,
  appendQualitySignal,
  applyOrchestratedTurn,
  normalizeConversationStatePayload,
  systemSessionClock,
  withCompletedExecution,
  withTechnicalError,
  isValidRequestId,
  type ConversationFlowId,
  type ConversationState,
  type LastAssistantAct,
  type OrchestratedDecision,
} from "@/lib/navigation/conversation-state";
import {
  prepareConversationTurn,
} from "@/lib/navigation/conversation-turn-control";
import {
  orchestrateNavigatorResponse,
  type NavigatorOrchestrationResult,
} from "@/lib/navigation/orchestrate-navigation";
import {
  createNavigatorFailureLog,
  createNavigatorTurnLog,
  type NavigatorTurnDetails,
} from "@/lib/navigation/navigator-observability";
import { buildTechnicalErrorState } from "@/lib/navigation/technical-error";
import { buildMaterialFailureSignal } from "@/lib/navigation/failure-capture";
import { composeTechnicalErrorAnswer } from "@/lib/navigation/conversation-response";

const MAX_REQUEST_BYTES = 200_000;
const NAVIGATOR_REQUEST_ID_HEADER = "X-Navigator-Request-Id";

const CONTROL_TURN_OBSERVABILITY: NavigatorTurnDetails = {
  lane: "CONTROL",
  conversationAct: null,
  decision: null,
  courseId: null,
  ragInvoked: false,
  authorityResolved: false,
  activeBindingCount: 0,
  bindingSourceSlugs: [],
  retrievedMatchCount: 0,
  resolvedEvidenceCount: 0,
  selectedEvidence: [],
  evidenceSelectionStatus: "NOT_RUN",
  answerOrigin: "DETERMINISTIC_CONTROL",
  fallback: "NONE",
  crossCourseLeakageDetected: false,
};

function fallbackOrchestrationObservability(
  result: NavigatorOrchestrationResult,
): NavigatorTurnDetails {
  return {
    ...CONTROL_TURN_OBSERVABILITY,
    lane: "ORCHESTRATION",
    conversationAct: result.conversationAct.state,
    decision: result.decision?.state ?? null,
    courseId:
      result.conversationAct.state === "COURSE_FOLLOW_UP" ||
      result.conversationAct.state === "COURSE_CONTENT"
        ? result.conversationAct.courseId
        : result.decision?.state === "RECOMMEND_COURSE"
          ? result.decision.primaryCourseId
          : null,
    answerOrigin: "CATALOG_AUTHORITY",
  };
}

type ValidationResult =
  | {
      ok: true;
      messages: ConversationMessage[];
      profile: ConversationProfile;
      conversationState: ConversationState;
      requestId: string | null;
    }
  | { ok: false; message: string };

function jsonError(
  status: number,
  code: string,
  message: string,
): Response {
  const body: ChatErrorResponse = {
    error: { code, message },
  };

  return Response.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validateRequestBody(
  value: unknown,
  nowMs: number,
): ValidationResult {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "messages",
      "profile",
      "conversationState",
      "requestId",
    ]) ||
    !Array.isArray(value.messages)
  ) {
    return { ok: false, message: "Некорректный формат запроса." };
  }

  if (value.messages.length === 0) {
    return { ok: false, message: "Диалог не может быть пустым." };
  }

  if (value.messages.length > MAX_CONVERSATION_MESSAGES) {
    return {
      ok: false,
      message: `В диалоге допускается не более ${MAX_CONVERSATION_MESSAGES} сообщений.`,
    };
  }

  const messages: ConversationMessage[] = [];

  for (const message of value.messages) {
    if (
      !isRecord(message) ||
      !hasOnlyKeys(message, ["role", "content"]) ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string"
    ) {
      return {
        ok: false,
        message: "Каждое сообщение должно содержать допустимую роль и текст.",
      };
    }

    if (message.content.trim().length === 0) {
      return { ok: false, message: "Сообщения не могут быть пустыми." };
    }

    if (message.content.length > MAX_CHAT_MESSAGE_LENGTH) {
      return {
        ok: false,
        message: `Сообщение не должно превышать ${MAX_CHAT_MESSAGE_LENGTH} символов.`,
      };
    }

    messages.push({
      role: message.role,
      content: message.content,
    });
  }

  if (messages.at(-1)?.role !== "user") {
    return {
      ok: false,
      message: "Последнее сообщение в диалоге должно быть от пользователя.",
    };
  }

  let profile: ConversationProfile;
  try {
    profile = normalizeConversationProfilePayload(value.profile);
  } catch (error) {
    if (error instanceof ConversationProfileValidationError) {
      return {
        ok: false,
        message: "Некорректный контекст обращения в диалоге.",
      };
    }
    throw error;
  }

  let conversationState: ConversationState;
  try {
    conversationState = normalizeConversationStatePayload(
      value.conversationState,
      nowMs,
    );
  } catch (error) {
    if (error instanceof ConversationStateValidationError) {
      return {
        ok: false,
        message: "Некорректное состояние диалога.",
      };
    }
    throw error;
  }

  // A22 — fail closed on a contradictory execution baseline. A state handed
  // back as the baseline of a new turn is always idle, because a completed turn
  // returns idle and a failed turn never marks itself completed. An in-progress
  // baseline therefore cannot be a clean turn, and is refused instead of
  // executed.
  if (conversationState.execution.phase === "IN_PROGRESS") {
    return {
      ok: false,
      message: "Некорректное состояние диалога.",
    };
  }

  const requestIdRaw = value.requestId;

  if (
    requestIdRaw !== undefined &&
    requestIdRaw !== null &&
    !isValidRequestId(requestIdRaw)
  ) {
    return {
      ok: false,
      message: "Некорректный идентификатор запроса.",
    };
  }

  return {
    ok: true,
    messages,
    profile,
    conversationState,
    requestId: typeof requestIdRaw === "string" ? requestIdRaw : null,
  };
}

/** Package-A act identity for an orchestrated turn. */
function orchestrationAct(
  result: NavigatorOrchestrationResult,
): { act: LastAssistantAct; flowId: ConversationFlowId | null } {
  if (result.stateEffects.pendingConfirmation?.kind === "PAYMENT_COURSE_CHANGE") {
    return { act: "PAYMENT_CONFIRMATION", flowId: null };
  }

  if (result.conversationAct.state === "FACTUAL") {
    return { act: "FACTUAL", flowId: null };
  }

  if (result.stateEffects.transactionalAuthorityVersion !== null) {
    return { act: "PAYMENT", flowId: null };
  }

  if (result.clarification.status === "ASKED") {
    return { act: "CLARIFICATION", flowId: "COURSE_SELECTION" };
  }

  if (result.clarification.status === "EXHAUSTED") {
    return { act: "CLARIFICATION_EXHAUSTED", flowId: "COURSE_SELECTION" };
  }

  if (result.contactCard !== null) {
    return { act: "ACADEMY_CONTACT", flowId: "ACADEMY_CONTACT" };
  }

  switch (result.conversationAct.state) {
    case "NAVIGATE":
      return { act: "NAVIGATE", flowId: "COURSE_SELECTION" };
    case "COURSE_FOLLOW_UP":
      return { act: "COURSE_FOLLOW_UP", flowId: "COURSE_FOLLOW_UP" };
    // EXPERIMENT-1.ROUTER-ACCESS-1: an evidential turn about a course's
    // material is the same conversation act as a follow-up about that course,
    // so the existing Package-A act identity is reused rather than extended.
    case "COURSE_CONTENT":
      return { act: "COURSE_FOLLOW_UP", flowId: "COURSE_FOLLOW_UP" };
    // The degrade lane is a technical failure that reached the user as a turn,
    // so it records the act the project already uses for that situation.
    case "ROUTER_DEGRADED":
      return { act: "TECHNICAL_ERROR", flowId: null };
    case "META":
      return { act: "META", flowId: null };
    default:
      return { act: "OUT_OF_SCOPE", flowId: null };
  }
}

function orchestrationDecision(
  result: NavigatorOrchestrationResult,
): OrchestratedDecision {
  const decision = result.decision;

  if (decision === null) return { kind: "NONE" };

  switch (decision.state) {
    case "RECOMMEND_COURSE":
      return { kind: "MATCHED", courseId: decision.primaryCourseId };
    case "NO_CURRENT_COURSE_MATCH":
      return { kind: "NO_MATCH" };
    case "ASK_MORE":
      return decision.candidateCourseIds.length > 1
        ? { kind: "AMBIGUOUS" }
        : { kind: "NONE" };
  }
}

/**
 * Injectable seams for the conversation turn. The production entry point
 * (`POST`) uses the real orchestration; a test injects a deterministic failure
 * so the technical-error lane can be verified without a live provider,
 * database, or network timeout.
 */
export type ChatRouteDependencies = {
  orchestrate?: typeof orchestrateNavigatorResponse;
};

export async function handleChatRequest(
  request: Request,
  dependencies: ChatRouteDependencies = {},
): Promise<Response> {
  const nowMs = systemSessionClock.now();
  const contentType = request.headers.get("content-type");

  if (!contentType?.toLowerCase().startsWith("application/json")) {
    return jsonError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Ожидается запрос в формате JSON.",
    );
  }

  const contentLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonError(
      413,
      "REQUEST_TOO_LARGE",
      "Размер запроса превышает допустимый предел.",
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Не удалось прочитать JSON-запрос.");
  }

  const validation = validateRequestBody(body, nowMs);

  if (validation.ok === false) {
    return jsonError(400, "INVALID_REQUEST", validation.message);
  }

  const logRequestId = randomUUID();

  const prepared = prepareConversationTurn(
    validation.messages,
    validation.profile,
    {
      conversationState: validation.conversationState,
      nowMs,
      requestId: validation.requestId,
    },
  );

  if (prepared.state === "RESPOND") {
    const responseBody: ChatSuccessResponse = {
      message: prepared.message,
      profile: prepared.profile,
      conversationState: prepared.conversationState,
      contactCard: null,
      resetConversation: prepared.resetConversation,
    };

    console.info(
      JSON.stringify(
        createNavigatorTurnLog(logRequestId, CONTROL_TURN_OBSERVABILITY),
      ),
    );

    return Response.json(responseBody, {
      headers: { [NAVIGATOR_REQUEST_ID_HEADER]: logRequestId },
    });
  }

  const clarification = prepared.conversationState.clarification;

  try {
    const result = await (dependencies.orchestrate ??
      orchestrateNavigatorResponse)(prepared.messages, {
      signal: request.signal,
      requestId: logRequestId,
      profile: prepared.profile,
      clarification: {
        priorIssueKey: clarification?.issueKey ?? null,
        priorAttempts: clarification?.attempts ?? 0,
      },
      conversationState: prepared.conversationState,
    });

    const { act, flowId } = orchestrationAct(result);

    const responseBody: ChatSuccessResponse = {
      message: result.message,
      profile: prepared.profile,
      conversationState: withCompletedExecution(
        applyOrchestratedTurn(
          prepared.conversationState,
          {
            act,
            flowId,
            message: result.message,
            decision: orchestrationDecision(result),
            clarification: result.clarification,
            catalogAuthorityVersion:
              result.stateEffects.catalogAuthorityVersion,
            transactionalAuthorityVersion:
              result.stateEffects.transactionalAuthorityVersion,
            pendingConfirmation: result.stateEffects.pendingConfirmation,
          },
          nowMs,
        ),
        validation.requestId,
      ),
      contactCard: result.contactCard,
      resetConversation: false,
    };

    console.info(
      JSON.stringify(
        createNavigatorTurnLog(
          logRequestId,
          result.observability ?? fallbackOrchestrationObservability(result),
        ),
      ),
    );

    return Response.json(responseBody, {
      headers: { [NAVIGATOR_REQUEST_ID_HEADER]: logRequestId },
    });
  } catch (error) {
    return technicalErrorResponse({
      error,
      profile: prepared.profile,
      conversationState: prepared.conversationState,
      requestId: validation.requestId,
      logRequestId,
      nowMs,
    });
  }
}

type TechnicalErrorResponseInput = {
  error: unknown;
  profile: ConversationProfile;
  conversationState: ConversationState;
  requestId: string | null;
  logRequestId: string;
  nowMs: number;
};

/**
 * A21 — the technical-error lane. The failure is classified coarsely, recorded
 * in bounded structured state, and rendered as a safe public response. The
 * canonical conversation state is preserved exactly: no business action is
 * marked successful, no deferred remainder is consumed, no course match moves,
 * and no clarification counter is incremented because infrastructure failed.
 */
function technicalErrorResponse(input: TechnicalErrorResponseInput): Response {
  console.error(
    JSON.stringify(createNavigatorFailureLog(input.error, input.logRequestId)),
  );

  const technicalError = buildTechnicalErrorState(input.error, input.nowMs);

  const preserved = appendQualitySignal(
    withTechnicalError(input.conversationState, technicalError),
    buildMaterialFailureSignal({
      state: input.conversationState,
      technicalError,
      requestId: input.requestId,
      nowMs: input.nowMs,
    }),
  );

  const body: ChatTechnicalErrorResponse = {
    error: {
      code: "NAVIGATOR_TECHNICAL_ERROR",
      message: composeTechnicalErrorAnswer(
        input.profile,
        technicalError.retryable,
      ),
      retryable: technicalError.retryable,
      conversationState: preserved,
    },
  };

  return Response.json(body, {
    status: technicalError.retryable ? 503 : 500,
    headers: { [NAVIGATOR_REQUEST_ID_HEADER]: input.logRequestId },
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleChatRequest(request);
}
