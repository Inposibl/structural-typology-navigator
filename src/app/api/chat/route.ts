import { randomUUID } from "node:crypto";

import type {
  ChatErrorResponse,
  ChatSuccessResponse,
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
  applyOrchestratedTurn,
  normalizeConversationStatePayload,
  systemSessionClock,
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
import { createNavigatorFailureLog } from "@/lib/navigation/navigator-observability";

const MAX_REQUEST_BYTES = 200_000;

type ValidationResult =
  | {
      ok: true;
      messages: ConversationMessage[];
      profile: ConversationProfile;
      conversationState: ConversationState;
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
    !hasOnlyKeys(value, ["messages", "profile", "conversationState"]) ||
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

  return { ok: true, messages, profile, conversationState };
}

/** Package-A act identity for an orchestrated turn. */
function orchestrationAct(
  result: NavigatorOrchestrationResult,
): { act: LastAssistantAct; flowId: ConversationFlowId | null } {
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

export async function POST(request: Request): Promise<Response> {
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

  const prepared = prepareConversationTurn(
    validation.messages,
    validation.profile,
    {
      conversationState: validation.conversationState,
      nowMs,
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

    return Response.json(responseBody);
  }

  const requestId = randomUUID();
  const clarification = prepared.conversationState.clarification;

  try {
    const result = await orchestrateNavigatorResponse(
      prepared.messages,
      {
        signal: request.signal,
        requestId,
        profile: prepared.profile,
        clarification: {
          priorIssueKey: clarification?.issueKey ?? null,
          priorAttempts: clarification?.attempts ?? 0,
        },
      },
    );

    const { act, flowId } = orchestrationAct(result);

    const responseBody: ChatSuccessResponse = {
      message: result.message,
      profile: prepared.profile,
      conversationState: applyOrchestratedTurn(
        prepared.conversationState,
        {
          act,
          flowId,
          message: result.message,
          decision: orchestrationDecision(result),
          clarification: result.clarification,
        },
        nowMs,
      ),
      contactCard: result.contactCard,
      resetConversation: false,
    };

    return Response.json(responseBody);
  } catch (error) {
    console.error(
      JSON.stringify(createNavigatorFailureLog(error, requestId)),
    );

    return jsonError(
      502,
      "NAVIGATOR_ROUTING_UNAVAILABLE",
      "Навигатор временно не может надёжно определить образовательный маршрут. Попробуйте ещё раз.",
    );
  }
}
