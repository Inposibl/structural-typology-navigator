import type {
  AcademyContactCard,
  ConversationMessage,
} from "@/lib/chat-contract";

export type ChatMessage = ConversationMessage & {
  id: string;
  contactCard?: AcademyContactCard | null;
};
