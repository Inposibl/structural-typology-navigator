"use client";

import { useEffect, useRef, useState } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import { MessageComposer } from "@/components/chat/message-composer";
import type { ChatMessage as ChatMessageType } from "@/components/chat/types";
import { requestAssistantResponse } from "@/lib/chat-api";
import type {
  ConversationMessage,
  ConversationProfile,
} from "@/lib/chat-contract";
import {
  createEmptyConversationProfile,
  INITIAL_ADDRESS_PROMPT,
} from "@/lib/navigation/conversation-profile";

const INITIAL_MESSAGE: ChatMessageType = {
  id: "assistant-initial",
  role: "assistant",
  content: INITIAL_ADDRESS_PROMPT,
};

export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessageType[]>([
    INITIAL_MESSAGE,
  ]);
  const [profile, setProfile] = useState<ConversationProfile>(
    createEmptyConversationProfile(),
  );
  const [draft, setDraft] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const nextMessageId = useRef(1);
  const requestInFlight = useRef(false);
  const conversationEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ block: "end" });
  }, [isPending, messages, requestError]);

  async function sendMessage() {
    const content = draft.trim();

    if (!content || requestInFlight.current) {
      return;
    }

    const userMessage: ChatMessageType = {
      id: `user-${nextMessageId.current++}`,
      role: "user",
      content,
    };

    const conversation: ConversationMessage[] = [
      ...messages
        .filter((message) => message.id !== INITIAL_MESSAGE.id)
        .map(({ role, content: messageContent }) => ({
          role,
          content: messageContent,
        })),
      { role: userMessage.role, content: userMessage.content },
    ];

    requestInFlight.current = true;
    setIsPending(true);
    setRequestError(null);
    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setDraft("");

    try {
      const response = await requestAssistantResponse(
        conversation,
        profile,
      );
      setProfile(response.profile);

      const assistantMessage: ChatMessageType = {
        id: `assistant-${nextMessageId.current++}`,
        role: "assistant",
        content: response.message,
        contactCard: response.contactCard,
      };

      setMessages((currentMessages) => [
        ...currentMessages,
        assistantMessage,
      ]);
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : "Не удалось получить ответ Навигатора. Попробуйте ещё раз.",
      );
    } finally {
      requestInFlight.current = false;
      setIsPending(false);
    }
  }

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <h1>Навигатор</h1>
      </header>

      <section className="conversation" aria-label="Диалог">
        <ol
          className="conversation__list"
          role="list"
          aria-live="polite"
          aria-relevant="additions"
        >
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          {isPending ? (
            <li
              className="message message--assistant message--pending"
              role="status"
            >
              <p className="message__author">Навигатор</p>
              <p className="message__content">Готовлю ответ…</p>
            </li>
          ) : null}
          {requestError ? (
            <li className="request-error" role="alert">
              {requestError}
            </li>
          ) : null}
        </ol>
        <div ref={conversationEnd} aria-hidden="true" />
      </section>

      <MessageComposer
        value={draft}
        isPending={isPending}
        onChange={setDraft}
        onSubmit={sendMessage}
      />
    </main>
  );
}
