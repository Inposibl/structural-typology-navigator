"use client";

import { useEffect, useRef, useState } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import { MessageComposer } from "@/components/chat/message-composer";
import type { ChatMessage as ChatMessageType } from "@/components/chat/types";
import { getAssistantResponse } from "@/lib/chat-response";

const INITIAL_MESSAGE: ChatMessageType = {
  id: "assistant-initial",
  role: "assistant",
  content:
    "Здравствуйте. Я Навигатор Академии структурной типологии. Задайте вопрос — я помогу сориентироваться в материалах Академии, темах и возможных следующих шагах.",
};

export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessageType[]>([
    INITIAL_MESSAGE,
  ]);
  const [draft, setDraft] = useState("");
  const nextMessageId = useRef(1);
  const conversationEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function sendMessage() {
    const content = draft.trim();

    if (!content) {
      return;
    }

    const userMessage: ChatMessageType = {
      id: `user-${nextMessageId.current++}`,
      role: "user",
      content,
    };

    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setDraft("");

    const response = await getAssistantResponse(content);
    const assistantMessage: ChatMessageType = {
      id: `assistant-${nextMessageId.current++}`,
      role: "assistant",
      content: response,
    };

    setMessages((currentMessages) => [
      ...currentMessages,
      assistantMessage,
    ]);
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
        </ol>
        <div ref={conversationEnd} aria-hidden="true" />
      </section>

      <MessageComposer
        value={draft}
        onChange={setDraft}
        onSubmit={sendMessage}
      />
    </main>
  );
}
