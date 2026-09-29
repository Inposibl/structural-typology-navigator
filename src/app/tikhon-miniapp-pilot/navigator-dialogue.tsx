"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { tokenizeMessageContent } from "../../components/chat/message-linkifier.ts";
import { MAX_CHAT_MESSAGE_LENGTH } from "../../lib/chat-contract.ts";
import { createClientRequestId } from "../../lib/navigation/execution-control.ts";
import styles from "./miniapp.module.css";
import {
  applyEmbeddedNavigatorFailure,
  applyEmbeddedNavigatorSuccess,
  EMBEDDED_NAVIGATOR_TIMEOUT_MS,
  embeddedNavigatorExitGeneration,
  interpretNavigatorChatResponse,
  malformedNavigatorFailure,
  NAVIGATOR_DIALOGUE_HEADING,
  NAVIGATOR_EXIT_LABEL,
  NAVIGATOR_PENDING_LABEL,
  NAVIGATOR_RETRY_LABEL,
  NAVIGATOR_SEND_LABEL,
  NAVIGATOR_UNAVAILABLE_COPY,
  navigatorTransportFailure,
  openEmbeddedNavigatorDialogue,
  retryEmbeddedNavigatorTurn,
  submitEmbeddedNavigatorTurn,
  type EmbeddedDialogueSession,
  type EmbeddedNavigatorChatBody,
  type EmbeddedNavigatorChatResult,
  type EmbeddedTurnDecision,
} from "./helpers.ts";

type NavigatorDialogueProps = {
  tikhonCourseId: string;
  onExit: () => void;
};

type TelegramHost = Window & {
  Telegram?: {
    WebApp?: {
      openLink?: (url: string) => void;
    };
  };
};

export async function postEmbeddedNavigatorChat(
  body: EmbeddedNavigatorChatBody,
  signal: AbortSignal,
  timedOut: () => boolean,
): Promise<EmbeddedNavigatorChatResult> {
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    return {
      ok: false,
      failure: navigatorTransportFailure(
        timedOut() ? "timeout" : "network",
        body.profile,
      ),
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, failure: malformedNavigatorFailure(body.profile) };
  }

  return interpretNavigatorChatResponse(
    response.ok,
    payload,
    body.profile,
    Date.now(),
  );
}

function openAssistantLink(
  event: MouseEvent<HTMLAnchorElement>,
  href: string,
) {
  const openLink = (window as TelegramHost).Telegram?.WebApp?.openLink;
  if (openLink) {
    event.preventDefault();
    openLink(href);
  }
}

export function NavigatorDialogueView({
  session,
  draft,
  notice,
  onDraft,
  onSubmit,
  onRetry,
  onExit,
}: {
  session: EmbeddedDialogueSession;
  draft: string;
  notice: string | null;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onExit: () => void;
}) {
  const pending = session.phase === "pending";
  const endRef = useRef<HTMLLIElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [session.messages.length, session.phase, session.errorMessage]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <section
      className={styles.navigatorDialogue}
      aria-label="Диалог с Навигатором"
    >
      <header className={styles.navigatorHeader}>
        <h1 className={styles.navigatorHeading}>{NAVIGATOR_DIALOGUE_HEADING}</h1>
        <p className={styles.navigatorCourseLine}>
          Вопросы по курсу «{session.canonicalTitle}»
        </p>
      </header>

      <ol className={styles.navigatorTranscript} aria-live="polite">
        {session.messages.map((message) => (
          <li
            key={message.id}
            className={
              message.role === "assistant"
                ? styles.navigatorMessageAssistant
                : styles.navigatorMessageUser
            }
          >
            {message.role === "assistant" ? (
              <p className={styles.navigatorAuthor}>Навигатор</p>
            ) : null}
            <p className={styles.navigatorBubble}>
              {message.role === "assistant"
                ? tokenizeMessageContent(message.content).map((segment, index) =>
                    segment.kind === "link" ? (
                      <a
                        key={`${segment.href}-${index}`}
                        href={segment.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => openAssistantLink(event, segment.href)}
                      >
                        {segment.value}
                      </a>
                    ) : (
                      <span key={`text-${index}`}>{segment.value}</span>
                    ),
                  )
                : message.content}
            </p>
          </li>
        ))}
        {pending ? (
          <li className={styles.navigatorPending} role="status">
            {NAVIGATOR_PENDING_LABEL}
          </li>
        ) : null}
        <li className={styles.navigatorEnd} ref={endRef} aria-hidden="true" />
      </ol>

      {session.phase === "error" && session.errorMessage ? (
        <div className={styles.navigatorError} role="alert">
          <p>{session.errorMessage}</p>
          {session.errorRetryable ? (
            <button
              type="button"
              className={styles.navigatorRetryBtn}
              onClick={onRetry}
            >
              {NAVIGATOR_RETRY_LABEL}
            </button>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p className={styles.navigatorError} role="alert">
          {notice}
        </p>
      ) : null}

      <form
        className={styles.navigatorComposer}
        aria-busy={pending}
        onSubmit={handleSubmit}
      >
        <label className={styles.navigatorLabel} htmlFor="tikhon-navigator-question">
          Ваш вопрос
        </label>
        <textarea
          id="tikhon-navigator-question"
          ref={inputRef}
          className={styles.navigatorTextarea}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Напишите вопрос по курсу"
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          enterKeyHint="send"
          autoComplete="off"
          rows={3}
          disabled={pending}
        />
        <button
          type="submit"
          className={styles.navigatorSendBtn}
          disabled={pending || draft.trim().length === 0}
        >
          {pending ? NAVIGATOR_PENDING_LABEL : NAVIGATOR_SEND_LABEL}
        </button>
        <button
          type="button"
          className={styles.navigatorExitBtn}
          onClick={onExit}
        >
          {NAVIGATOR_EXIT_LABEL}
        </button>
      </form>
    </section>
  );
}

export function NavigatorDialogue({
  tikhonCourseId,
  onExit,
}: NavigatorDialogueProps) {
  const [session, setSession] = useState<EmbeddedDialogueSession | null>(() =>
    openEmbeddedNavigatorDialogue(tikhonCourseId),
  );
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const generationRef = useRef(session?.generation ?? 0);
  const abortRef = useRef<AbortController | null>(null);
  const timedOutRef = useRef(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    return () => {
      generationRef.current = embeddedNavigatorExitGeneration(
        generationRef.current,
      );
      abortRef.current?.abort();
    };
  }, []);

  function handleExit() {
    generationRef.current = embeddedNavigatorExitGeneration(
      generationRef.current,
    );
    abortRef.current?.abort();
    onExit();
  }

  function rejectionNotice(decision: EmbeddedTurnDecision): string | null {
    if (decision.status !== "REJECTED") return null;
    if (decision.reason === "too_long") {
      return `Сообщение не должно превышать ${MAX_CHAT_MESSAGE_LENGTH} символов.`;
    }
    if (decision.reason === "too_large") {
      return "Диалог слишком большой для отправки. Завершите его и начните снова.";
    }
    return null;
  }

  function begin(decision: EmbeddedTurnDecision, clearDraft: boolean) {
    if (decision.status !== "ACCEPTED") {
      sendingRef.current = false;
      const nextNotice = rejectionNotice(decision);
      if (nextNotice) setNotice(nextNotice);
      return;
    }

    setNotice(null);
    if (clearDraft) setDraft("");
    setSession(decision.session);

    const turnGeneration = decision.session.generation;
    const requestId = decision.requestId;
    const controller = new AbortController();
    abortRef.current = controller;
    timedOutRef.current = false;
    const timer = window.setTimeout(() => {
      timedOutRef.current = true;
      controller.abort();
    }, EMBEDDED_NAVIGATOR_TIMEOUT_MS);

    void (async () => {
      let result: EmbeddedNavigatorChatResult;
      try {
        result = await postEmbeddedNavigatorChat(
          decision.body,
          controller.signal,
          () => timedOutRef.current,
        );
      } catch {
        result = {
          ok: false,
          failure: navigatorTransportFailure("network", decision.body.profile),
        };
      } finally {
        window.clearTimeout(timer);
        sendingRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      }

      if (generationRef.current !== turnGeneration) return;
      setSession((current) => {
        if (current === null || generationRef.current !== turnGeneration) {
          return current;
        }
        const turn = { generation: turnGeneration, requestId };
        if (result.ok) {
          const next = applyEmbeddedNavigatorSuccess(
            current,
            generationRef.current,
            turn,
            result.success,
          );
          return next === "IGNORED" ? current : next;
        }
        const next = applyEmbeddedNavigatorFailure(
          current,
          generationRef.current,
          turn,
          result.failure,
        );
        return next === "IGNORED" ? current : next;
      });
    })();
  }

  function handleSubmit() {
    if (session === null || sendingRef.current || session.phase === "pending") {
      return;
    }
    sendingRef.current = true;
    begin(
      submitEmbeddedNavigatorTurn(session, draft, createClientRequestId()),
      true,
    );
  }

  function handleRetry() {
    if (session === null || sendingRef.current || session.phase !== "error") {
      return;
    }
    sendingRef.current = true;
    begin(retryEmbeddedNavigatorTurn(session, createClientRequestId()), false);
  }

  if (session === null) {
    return (
      <section
        className={styles.navigatorDialogue}
        aria-label="Диалог с Навигатором"
      >
        <h1 className={styles.navigatorHeading}>{NAVIGATOR_DIALOGUE_HEADING}</h1>
        <p className={styles.navigatorUnavailable} role="status">
          {NAVIGATOR_UNAVAILABLE_COPY}
        </p>
        <button
          type="button"
          className={styles.navigatorExitBtn}
          onClick={handleExit}
        >
          {NAVIGATOR_EXIT_LABEL}
        </button>
      </section>
    );
  }

  return (
    <NavigatorDialogueView
      session={session}
      draft={draft}
      notice={notice}
      onDraft={setDraft}
      onSubmit={handleSubmit}
      onRetry={handleRetry}
      onExit={handleExit}
    />
  );
}
