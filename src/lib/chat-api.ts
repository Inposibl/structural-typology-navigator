import type {
  ChatErrorResponse,
  ChatSuccessResponse,
  ConversationMessage,
  ConversationProfile,
} from "@/lib/chat-contract";
import {
  normalizeConversationProfilePayload,
} from "@/lib/navigation/conversation-profile";

const FALLBACK_ERROR_MESSAGE =
  "Не удалось получить ответ Навигатора. Попробуйте ещё раз.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSuccessResponse(value: unknown): value is ChatSuccessResponse {
  if (
    !isRecord(value) ||
    typeof value.message !== "string" ||
    value.message.trim().length === 0 ||
    !("profile" in value) ||
    !("contactCard" in value)
  ) {
    return false;
  }

  try {
    normalizeConversationProfilePayload(value.profile);
  } catch {
    return false;
  }

  if (value.contactCard === null) {
    return true;
  }

  if (!isRecord(value.contactCard)) {
    return false;
  }

  return (
    value.contactCard.kind === "ACADEMY_MANAGER" &&
    typeof value.contactCard.name === "string" &&
    typeof value.contactCard.role === "string" &&
    typeof value.contactCard.availability === "string" &&
    typeof value.contactCard.imageUrl === "string" &&
    isRecord(value.contactCard.telegram) &&
    typeof value.contactCard.telegram.label === "string" &&
    typeof value.contactCard.telegram.href === "string" &&
    isRecord(value.contactCard.phone) &&
    typeof value.contactCard.phone.label === "string" &&
    typeof value.contactCard.phone.href === "string"
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
  profile: ConversationProfile,
): Promise<ChatSuccessResponse> {
  let response: Response;

  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages, profile }),
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

  return payload;
}
