import type { FormEvent, KeyboardEvent } from "react";

type MessageComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function MessageComposer({
  value,
  onChange,
  onSubmit,
}: MessageComposerProps) {
  const isEmpty = value.trim().length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isEmpty) {
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
      <form className="composer" onSubmit={handleSubmit}>
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
            rows={2}
          />
        </div>

        <button type="submit" disabled={isEmpty}>
          Отправить
        </button>

        <p className="composer__hint" id="composer-hint">
          Enter — отправить · Shift+Enter — новая строка
        </p>
      </form>
    </footer>
  );
}
