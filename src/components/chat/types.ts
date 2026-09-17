import type { ConversationMessage } from "@/lib/chat-contract";

export type ChatMessage = ConversationMessage & {
  id: string;
};
