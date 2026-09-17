export const MAX_CHAT_MESSAGE_LENGTH = 4_000;
export const MAX_CONVERSATION_MESSAGES = 40;

export type ConversationMessage = {
  role: "assistant" | "user";
  content: string;
};

export type ChatSuccessResponse = {
  message: string;
};

export type ChatErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};
