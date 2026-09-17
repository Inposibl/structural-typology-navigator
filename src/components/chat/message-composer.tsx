import type { FormEvent, KeyboardEvent } from "react";

import { MAX_CHAT_MESSAGE_LENGTH } from "@/lib/chat-contract";

type MessageComposerProps = {
  value: string;
  isPending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function MessageComposer({
  value,
  isPending,
  onChange,
  onSubmit,
}: MessageComposerProps) {
  const isEmpty = value.trim().length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isEmpty || isPending) {
      return;
    }

    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();

    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  return (
    <footer className="composer-region">
      <form
        className="composer"
        aria-busy={isPending}
        onSubmit={handleSubmit}
      >
        <div className="composer__field">
          <label htmlFor="chat-message">Ваш вопрос</label>
          <textarea
            id="chat-message"
            name="message"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Напишите вопрос о материалах Академии"
            aria-describedby="composer-hint"
            maxLength={MAX_CHAT_MESSAGE_LENGTH}
            rows={2}
          />
        </div>

        <button type="submit" disabled={isEmpty || isPending}>
          {isPending ? "Навигатор отвечает…" : "Отправить"}
        </button>

        <p className="composer__hint" id="composer-hint">
          Enter — отправить · Shift+Enter — новая строка
        </p>
      </form>
    </footer>
  );
}
