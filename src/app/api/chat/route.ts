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
  prepareConversationTurn,
} from "@/lib/navigation/conversation-turn-control";
import { orchestrateNavigatorResponse } from "@/lib/navigation/orchestrate-navigation";
import { createNavigatorFailureLog } from "@/lib/navigation/navigator-observability";

const MAX_REQUEST_BYTES = 200_000;

type ValidationResult =
  | {
      ok: true;
      messages: ConversationMessage[];
      profile: ConversationProfile;
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
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function validateRequestBody(value: unknown): ValidationResult {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["messages", "profile"]) ||
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

  return { ok: true, messages, profile };
}

export async function POST(request: Request): Promise<Response> {
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

  const validation = validateRequestBody(body);

  if (validation.ok === false) {
    return jsonError(400, "INVALID_REQUEST", validation.message);
  }

  const prepared = prepareConversationTurn(
    validation.messages,
    validation.profile,
  );

  if (prepared.state === "RESPOND") {
    const responseBody: ChatSuccessResponse = {
      message: prepared.message,
      profile: prepared.profile,
      contactCard: null,
      resetConversation: prepared.resetConversation,
    };

    return Response.json(responseBody);
  }

  const requestId = randomUUID();

  try {
    const result = await orchestrateNavigatorResponse(
      prepared.messages,
      {
        signal: request.signal,
        requestId,
        profile: prepared.profile,
      },
    );

    const responseBody: ChatSuccessResponse = {
      message: result.message,
      profile: prepared.profile,
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
