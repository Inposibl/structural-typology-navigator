import type {
  ChatErrorResponse,
  ChatSuccessResponse,
  ChatTechnicalErrorResponse,
  ConversationMessage,
  ConversationProfile,
  ConversationState,
} from "@/lib/chat-contract";
import {
  normalizeConversationProfilePayload,
} from "@/lib/navigation/conversation-profile";
import {
  normalizeConversationStatePayload,
} from "@/lib/navigation/conversation-state";

const FALLBACK_ERROR_MESSAGE =
  "Не удалось получить ответ Навигатора. Попробуйте ещё раз.";

/**
 * A failed turn (A21).
 *
 * `retryable` says whether a plain retry can succeed, and `conversationState`
 * carries the canonical state the server preserved, so the client continues
 * from canon instead of from a locally guessed one. A malformed preserved state
 * is ignored rather than trusted.
 */
export class ChatRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly conversationState: ConversationState | null;

  constructor(
    message: string,
    options: {
      code: string;
      retryable: boolean;
      conversationState: ConversationState | null;
    },
  ) {
    super(message);
    this.name = "ChatRequestError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.conversationState = options.conversationState;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSuccessResponse(value: unknown): value is ChatSuccessResponse {
  if (
    !isRecord(value) ||
    typeof value.message !== "string" ||
    value.message.trim().length === 0 ||
    !("profile" in value) ||
    !("conversationState" in value) ||
    !("contactCard" in value) ||
    typeof value.resetConversation !== "boolean"
  ) {
    return false;
  }

  try {
    normalizeConversationProfilePayload(value.profile);
    normalizeConversationStatePayload(value.conversationState, Date.now());
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

function getSafeErrorCode(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.error)) return "UNKNOWN";

  const code = value.error.code;
  return typeof code === "string" && code.trim().length > 0
    ? code
    : "UNKNOWN";
}

function getSafeRetryable(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.error)) return true;

  return value.error.retryable === true;
}

/** The preserved canonical state, accepted only if it validates. */
function getSafePreservedState(value: unknown): ConversationState | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;

  const candidate = (value as ChatTechnicalErrorResponse).error
    .conversationState;

  try {
    return normalizeConversationStatePayload(candidate, Date.now());
  } catch {
    return null;
  }
}

export async function requestAssistantResponse(
  messages: ConversationMessage[],
  profile: ConversationProfile,
  conversationState: ConversationState | null,
  requestId: string,
): Promise<ChatSuccessResponse> {
  let response: Response;

  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages, profile, conversationState, requestId }),
    });
  } catch {
    throw new ChatRequestError(FALLBACK_ERROR_MESSAGE, {
      code: "NETWORK_UNAVAILABLE",
      retryable: true,
      conversationState: null,
    });
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new ChatRequestError(FALLBACK_ERROR_MESSAGE, {
      code: "INVALID_RESPONSE",
      retryable: true,
      conversationState: null,
    });
  }

  if (!response.ok) {
    throw new ChatRequestError(getSafeErrorMessage(payload), {
      code: getSafeErrorCode(payload),
      retryable: getSafeRetryable(payload),
      conversationState: getSafePreservedState(payload),
    });
  }

  if (!isSuccessResponse(payload)) {
    throw new ChatRequestError(FALLBACK_ERROR_MESSAGE, {
      code: "INVALID_RESPONSE",
      retryable: true,
      conversationState: null,
    });
  }

  return payload;
}
