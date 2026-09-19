import type {
  ConversationMessage,
  ConversationProfile,
} from "../chat-contract.ts";
import { applyConversationControlKernel } from "./conversation-control-kernel.ts";
import {
  createInitialConversationState,
  systemSessionClock,
  type ConversationState,
  type SessionClock,
} from "./conversation-state.ts";

export type ConversationTurnPreparation =
  | {
      state: "RESPOND";
      profile: ConversationProfile;
      conversationState: ConversationState;
      message: string;
      resetConversation: boolean;
    }
  | {
      state: "ROUTE";
      profile: ConversationProfile;
      conversationState: ConversationState;
      messages: ConversationMessage[];
    };

export type PrepareConversationTurnOptions = {
  /** Last server-returned canonical state. Absent means a fresh session. */
  conversationState?: ConversationState;
  nowMs?: number;
  clock?: SessionClock;
};

function lastUserMessage(
  messages: readonly ConversationMessage[],
): string {
  const message = messages.at(-1);
  if (!message || message.role !== "user") {
    throw new Error("Conversation must end with a user message.");
  }

  return message.content;
}

function replaceLastUserMessage(
  messages: readonly ConversationMessage[],
  content: string,
): ConversationMessage[] {
  return messages.map((message, index) =>
    index === messages.length - 1
      ? { role: "user", content }
      : message,
  );
}

/**
 * Resolves one turn through the Package-A conversation-control kernel. A turn
 * the kernel handles is answered deterministically and never reaches the
 * conversation-act router; any other turn continues to ordinary routing.
 */
export function prepareConversationTurn(
  messages: readonly ConversationMessage[],
  profile: ConversationProfile,
  options: PrepareConversationTurnOptions = {},
): ConversationTurnPreparation {
  const latestUserMessage = lastUserMessage(messages);
  const nowMs =
    options.nowMs ?? (options.clock ?? systemSessionClock).now();

  const result = applyConversationControlKernel({
    profile,
    conversationState:
      options.conversationState ??
      createInitialConversationState(nowMs),
    userText: latestUserMessage,
    nowMs,
  });

  if (result.state === "RESPOND") {
    return {
      state: "RESPOND",
      profile: result.profile,
      conversationState: result.conversationState,
      message: result.message,
      resetConversation: result.resetConversation,
    };
  }

  return {
    state: "ROUTE",
    profile: result.profile,
    conversationState: result.conversationState,
    messages: replaceLastUserMessage(messages, result.request),
  };
}
