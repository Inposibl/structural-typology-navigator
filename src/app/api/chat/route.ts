import type {
  ChatErrorResponse,
  ChatSuccessResponse,
  ConversationMessage,
} from "@/lib/chat-contract";
import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CONVERSATION_MESSAGES,
} from "@/lib/chat-contract";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const MAX_REQUEST_BYTES = 200_000;
const UPSTREAM_TIMEOUT_MS = 45_000;

const SYSTEM_MESSAGE =
  "Ты — Навигатор Академии структурной типологии. Отвечай на русском языке. Помогай пользователю ориентироваться в темах и материалах Академии, но не утверждай, что располагаешь знаниями из материалов Академии, которые ещё не подключены. Не ставь психологические или медицинские диагнозы. Если для точного ответа потребуется база знаний Академии, прямо скажи об этом.";

type ValidationResult =
  | { ok: true; messages: ConversationMessage[] }
  | { ok: false; message: string };

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

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
    !hasOnlyKeys(value, ["messages"]) ||
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

  return { ok: true, messages };
}

function getAssistantContent(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const response = value as DeepSeekResponse;
  const content = response.choices?.[0]?.message?.content;

  return typeof content === "string" && content.trim().length > 0
    ? content.trim()
    : null;
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

  if (!validation.ok) {
    return jsonError(400, "INVALID_REQUEST", validation.message);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return jsonError(
      500,
      "SERVER_CONFIGURATION_ERROR",
      "Сервис Навигатора временно не настроен.",
    );
  }

  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(DEEPSEEK_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-flash",
        messages: [
          { role: "system", content: SYSTEM_MESSAGE },
          ...validation.messages,
        ],
        stream: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return jsonError(
      502,
      "UPSTREAM_UNAVAILABLE",
      "Навигатор временно не может получить ответ. Попробуйте ещё раз.",
    );
  }

  if (!upstreamResponse.ok) {
    return jsonError(
      502,
      "UPSTREAM_ERROR",
      "Навигатор временно не может получить ответ. Попробуйте ещё раз.",
    );
  }

  let upstreamBody: unknown;

  try {
    upstreamBody = await upstreamResponse.json();
  } catch {
    return jsonError(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "Навигатор получил некорректный ответ. Попробуйте ещё раз.",
    );
  }

  const assistantContent = getAssistantContent(upstreamBody);

  if (!assistantContent) {
    return jsonError(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "Навигатор получил некорректный ответ. Попробуйте ещё раз.",
    );
  }

  const responseBody: ChatSuccessResponse = {
    message: assistantContent,
  };

  return Response.json(responseBody);
}
