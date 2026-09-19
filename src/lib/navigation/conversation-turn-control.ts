import type {
  ConversationMessage,
  ConversationProfile,
} from "../chat-contract.ts";
import {
  advanceConversationProfile,
  isConversationProfileComplete,
} from "./conversation-profile.ts";
import {
  applyConversationProfileControl,
} from "./conversation-profile-control.ts";

export type ConversationTurnPreparation =
  | {
      state: "RESPOND";
      profile: ConversationProfile;
      message: string;
      resetConversation: boolean;
    }
  | {
      state: "ROUTE";
      profile: ConversationProfile;
      messages: ConversationMessage[];
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

export function prepareConversationTurn(
  messages: readonly ConversationMessage[],
  profile: ConversationProfile,
): ConversationTurnPreparation {
  const latestUserMessage = lastUserMessage(messages);

  const profileControl = applyConversationProfileControl(
    profile,
    latestUserMessage,
  );

  if (profileControl.handled) {
    return {
      state: "RESPOND",
      profile: profileControl.profile,
      message: profileControl.message,
      resetConversation: profileControl.resetConversation,
    };
  }

  if (!isConversationProfileComplete(profile)) {
    const setup = advanceConversationProfile(
      profile,
      latestUserMessage,
    );

    if (!setup.complete || setup.effectiveUserRequest === null) {
      return {
        state: "RESPOND",
        profile: setup.profile,
        message:
          setup.response ??
          "Скажите, пожалуйста, как к вам обращаться.",
        resetConversation: false,
      };
    }

    return {
      state: "ROUTE",
      profile: setup.profile,
      messages: replaceLastUserMessage(
        messages,
        setup.effectiveUserRequest,
      ),
    };
  }

  return {
    state: "ROUTE",
    profile,
    messages: [...messages],
  };
}
