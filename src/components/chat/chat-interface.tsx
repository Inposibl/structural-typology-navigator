"use client";

import { useEffect, useRef, useState } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import { MessageComposer } from "@/components/chat/message-composer";
import type { ChatMessage as ChatMessageType } from "@/components/chat/types";
import {
  ChatRequestError,
  fallbackAssistantErrorMessage,
  requestAssistantResponse,
} from "@/lib/chat-api";
import type {
  ConversationMessage,
  ConversationProfile,
  ConversationState,
} from "@/lib/chat-contract";
import {
  createEmptyConversationProfile,
  INITIAL_ADDRESS_PROMPT,
} from "@/lib/navigation/conversation-profile";
import {
  IDLE_EXECUTION,
  completeExecution,
  createClientRequestId,
  submitExecution,
  type ClientExecutionState,
} from "@/lib/navigation/execution-control";

const INITIAL_MESSAGE: ChatMessageType = {
  id: "assistant-initial",
  role: "assistant",
  content: INITIAL_ADDRESS_PROMPT,
};

export type ChatInterfaceVariant = "standalone" | "embedded";

export type ChatInterfaceProps = {
  variant?: ChatInterfaceVariant;
};

export function ChatInterface({
  variant = "standalone",
}: ChatInterfaceProps = {}) {
  const [messages, setMessages] = useState<ChatMessageType[]>([
    INITIAL_MESSAGE,
  ]);
  const [profile, setProfile] = useState<ConversationProfile>(
    createEmptyConversationProfile(),
  );
  // Null until the server returns the canonical state for this session.
  const [conversationState, setConversationState] =
    useState<ConversationState | null>(null);
  const [draft, setDraft] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const nextMessageId = useRef(1);
  // A22 — one submission at a time. This is the guard the handler itself uses,
  // so a double submit can never issue a second outbound chat request.
  const execution = useRef<ClientExecutionState>(IDLE_EXECUTION);
  const conversationEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ block: "end" });
  }, [isPending, messages, requestError]);

  async function sendMessage() {
    const decision = submitExecution(
      execution.current,
      draft,
      createClientRequestId,
    );

    if (decision.status !== "ACCEPTED") {
      return;
    }

    execution.current = decision.execution;

    const userMessage: ChatMessageType = {
      id: `user-${nextMessageId.current++}`,
      role: "user",
      content: decision.text,
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

    setIsPending(true);
    setRequestError(null);
    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setDraft("");

    try {
      const response = await requestAssistantResponse(
        conversation,
        profile,
        conversationState,
        decision.requestId,
      );
      setProfile(response.profile);
      setConversationState(response.conversationState);

      const assistantMessage: ChatMessageType = {
        id: `assistant-${nextMessageId.current++}`,
        role: "assistant",
        content: response.message,
        contactCard: response.contactCard,
      };

      if (response.resetConversation) {
        setMessages([assistantMessage]);
      } else {
        setMessages((currentMessages) => [
          ...currentMessages,
          assistantMessage,
        ]);
      }
    } catch (error) {
      if (error instanceof ChatRequestError && error.conversationState) {
        // Continue from the canonical state the server preserved, so a retry
        // resumes the conversation instead of a locally guessed one.
        setConversationState(error.conversationState);
      }

      setRequestError(
        error instanceof Error
          ? error.message
          : fallbackAssistantErrorMessage(profile),
      );
    } finally {
      execution.current = completeExecution(
        execution.current,
        decision.requestId,
      );
      setIsPending(false);
    }
  }

  return (
    <main className="chat-shell" data-variant={variant}>
      {variant !== "embedded" ? (
        <header className="chat-header">
          <h1>Навигатор</h1>
        </header>
      ) : null}

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
        addressMode={profile.addressMode}
        onChange={setDraft}
        onSubmit={sendMessage}
      />
    </main>
  );
}
