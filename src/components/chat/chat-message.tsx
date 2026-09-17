import type { ChatMessage as ChatMessageType } from "@/components/chat/types";

type ChatMessageProps = {
  message: ChatMessageType;
};

export function ChatMessage({ message }: ChatMessageProps) {
  const isAssistant = message.role === "assistant";

  return (
    <li className={`message message--${message.role}`}>
      {isAssistant ? <p className="message__author">Навигатор</p> : null}
      <p className="message__content">{message.content}</p>
    </li>
  );
}
