import type { ConversationState } from "./navigation/conversation-state.ts";

export const MAX_CHAT_MESSAGE_LENGTH = 4_000;
export const MAX_CONVERSATION_MESSAGES = 40;
export const MAX_DISPLAY_NAME_LENGTH = 80;

export type ConversationMessage = {
  role: "assistant" | "user";
  content: string;
};

export type AddressMode = "TY" | "VY";

export type ConversationProfile = {
  displayName: string | null;
  addressMode: AddressMode | null;
  nameDeclined: boolean;
  pendingUserRequest: string | null;
};

export type AcademyContactCard = {
  kind: "ACADEMY_MANAGER";
  name: string;
  role: string;
  availability: string;
  imageUrl: string;
  telegram: {
    label: string;
    href: string;
  };
  phone: {
    label: string;
    href: string;
  };
};

/**
 * Structured Package-A conversation state (A09). Imported as a type only, so
 * no runtime module cycle exists between the contract and the state model.
 */
export type { ConversationState } from "./navigation/conversation-state.ts";

export type ChatSuccessResponse = {
  message: string;
  profile: ConversationProfile;
  conversationState: ConversationState;
  contactCard: AcademyContactCard | null;
  resetConversation: boolean;
};

export type ChatErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};
