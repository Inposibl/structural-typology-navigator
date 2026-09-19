import { AcademyManagerCard } from "@/components/chat/academy-manager-card";
import type { ChatMessage as ChatMessageType } from "@/components/chat/types";
import { tokenizeMessageContent } from "@/components/chat/message-linkifier";

type ChatMessageProps = {
  message: ChatMessageType;
};

export function ChatMessage({ message }: ChatMessageProps) {
  const isAssistant = message.role === "assistant";

  return (
    <li className={`message message--${message.role}`}>
      {isAssistant ? <p className="message__author">Навигатор</p> : null}
      <p className="message__content">
        {isAssistant
          ? tokenizeMessageContent(message.content).map((segment, index) =>
              segment.kind === "link" ? (
                <a
                  className="message__link"
                  href={segment.href}
                  key={`${segment.href}-${index}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {segment.value}
                </a>
              ) : (
                <span key={`text-${index}`}>{segment.value}</span>
              ),
            )
          : message.content}
      </p>
      {isAssistant && message.contactCard ? (
        <AcademyManagerCard card={message.contactCard} />
      ) : null}
    </li>
  );
}
