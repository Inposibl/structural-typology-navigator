import type {
  ChatErrorResponse,
  ChatSuccessResponse,
  ConversationMessage,
} from "@/lib/chat-contract";

const FALLBACK_ERROR_MESSAGE =
  "Не удалось получить ответ Навигатора. Попробуйте ещё раз.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSuccessResponse(value: unknown): value is ChatSuccessResponse {
  return (
    isRecord(value) &&
    typeof value.message === "string" &&
    value.message.trim().length > 0
  );
}

function getSafeErrorMessage(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.error)) {
    return FALLBACK_ERROR_MESSAGE;
  }

  const response = value as ChatErrorResponse;
  return typeof response.error.message === "string" &&
    response.error.message.trim().length > 0
    ? response.error.message
    : FALLBACK_ERROR_MESSAGE;
}

export async function requestAssistantResponse(
  messages: ConversationMessage[],
): Promise<string> {
  let response: Response;

  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages }),
    });
  } catch {
    throw new Error(FALLBACK_ERROR_MESSAGE);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new Error(FALLBACK_ERROR_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(getSafeErrorMessage(payload));
  }

  if (!isSuccessResponse(payload)) {
    throw new Error(FALLBACK_ERROR_MESSAGE);
  }

  return payload.message;
}
