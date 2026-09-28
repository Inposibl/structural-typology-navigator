import React, { useCallback, useState } from "react";
import styles from "./miniapp.module.css";
import {
  WAITLIST_SUCCESS_COPY,
  WAITLIST_CTA_COPY,
  WAITLIST_SENDING_COPY,
  WAITLIST_ERROR_COPY,
  WAITLIST_RETRY_COPY,
  Course,
} from "./helpers.ts";
import {
  submitWaitlistLead,
  validateWaitlistDraft,
  WaitlistContactDraft,
} from "./waitlist.ts";

type WaitlistPhase = "idle" | "sending" | "success" | "error";

export interface WaitlistPanelProps {
  course: Course;
}

/**
 * WAITLIST mode (ENROLLMENT-AVAILABILITY-AND-WAITLIST-SEMANTICS-1 §3, §4).
 * Показывает: курс, контактную форму, действие отправки, канонический текст успеха.
 * НЕ показывает: счетчик мест, выбор оплаты, платежные каналы, CTA оплаты,
 * намек на зарезервированное место. Платежных записей не создает.
 */
export function WaitlistPanel({ course }: WaitlistPanelProps) {
  const [phase, setPhase] = useState<WaitlistPhase>("idle");
  const [draft, setDraft] = useState<WaitlistContactDraft>({
    full_name: "",
    phone: "",
    email: "",
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleField = useCallback((field: keyof WaitlistContactDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setValidationError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (phase === "sending") return;
    const check = validateWaitlistDraft(draft);
    if (!check.valid) {
      setValidationError(check.error || "Проверьте контактные данные");
      return;
    }
    setPhase("sending");
    try {
      const result = await submitWaitlistLead(course.id, draft);
      if (result.ok && result.status === "SUCCESS") {
        setPhase("success");
      } else {
        setPhase("error");
      }
    } catch {
      setPhase("error");
    }
  }, [course.id, draft, phase]);

  // COURSE-DETAILS-CTA-WAITLIST-CARDS-1: каноническая ссылка «Подробнее о курсе»
  // не зависит от состояния набора — режим листа ожидания показывает её тем же
  // механизмом (course_page_url), что и карты открытых курсов.
  const coursePageLink = course.course_page_url ? (
    <a
      href={course.course_page_url}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.coursePageBtn}
      onClick={(e) => {
        if (window.Telegram?.WebApp?.openLink) {
          e.preventDefault();
          window.Telegram.WebApp.openLink(course.course_page_url!);
        }
      }}
    >
      Подробнее о курсе ↗
    </a>
  ) : null;

  if (phase === "success") {
    return (
      <section className={styles.waitlistPanel} data-testid="waitlist-panel">
        <h2 className={styles.waitlistTitle}>Лист ожидания</h2>
        <div className={styles.waitlistSuccessCard} role="status" data-testid="waitlist-success">
          <p className={styles.waitlistSuccessText} data-testid="waitlist-success-copy">
            {WAITLIST_SUCCESS_COPY}
          </p>
        </div>
        {coursePageLink}
      </section>
    );
  }

  return (
    <section className={styles.waitlistPanel} data-testid="waitlist-panel">
      <h2 className={styles.waitlistTitle}>Лист ожидания</h2>
      <p className={styles.waitlistSubtitle} data-testid="waitlist-course-identity">
        Курс «{course.title}»
      </p>
      <p className={styles.waitlistNote}>
        Оставьте контакты — мы сообщим вам об открытии набора на следующий поток.
      </p>

      <div className={styles.waitlistForm}>
        <label className={styles.waitlistFieldLabel} htmlFor="wl-name">
          Имя и фамилия
        </label>
        <input
          id="wl-name"
          className={styles.waitlistInput}
          type="text"
          value={draft.full_name}
          onChange={(e) => handleField("full_name", e.target.value)}
          placeholder="Иван Иванов"
          data-testid="waitlist-name-input"
        />

        <label className={styles.waitlistFieldLabel} htmlFor="wl-phone">
          Телефон
        </label>
        <input
          id="wl-phone"
          className={styles.waitlistInput}
          type="tel"
          value={draft.phone}
          onChange={(e) => handleField("phone", e.target.value)}
          placeholder="+7 ··· ··· ·· ··"
          data-testid="waitlist-phone-input"
        />

        <label className={styles.waitlistFieldLabel} htmlFor="wl-email">
          Email
        </label>
        <input
          id="wl-email"
          className={styles.waitlistInput}
          type="email"
          value={draft.email}
          onChange={(e) => handleField("email", e.target.value)}
          placeholder="you@example.com"
          data-testid="waitlist-email-input"
        />
      </div>

      {validationError && (
        <p className={styles.waitlistErrorText} role="alert" data-testid="waitlist-validation-error">
          {validationError}
        </p>
      )}

      {phase === "error" && (
        <>
          <p className={styles.waitlistErrorText} role="alert" data-testid="waitlist-error-text">
            {WAITLIST_ERROR_COPY}
          </p>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={handleSubmit}
            data-testid="waitlist-retry-btn"
          >
            {WAITLIST_RETRY_COPY}
          </button>
        </>
      )}

      <button
        type="button"
        className={styles.primaryBtn}
        onClick={handleSubmit}
        disabled={phase === "sending"}
        data-testid="waitlist-submit-btn"
      >
        {phase === "sending" ? WAITLIST_SENDING_COPY : WAITLIST_CTA_COPY}
      </button>

      {coursePageLink}
    </section>
  );
}
