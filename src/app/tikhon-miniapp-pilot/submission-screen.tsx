import React from "react";
import styles from "./miniapp.module.css";
import {
  SubmissionState,
  SUCCESS_COPY_VERBATIM,
  CANONICAL_CURATOR_TG_LINK,
} from "./helpers.ts";

export interface SubmissionResultScreenProps {
  submissionState: SubmissionState;
  submissionError: string | null;
  submissionAppId: number | null;
  onRetry: () => void;
  onBack: () => void;
  onGoCatalog: () => void;
}

export function SubmissionResultScreen({
  submissionState,
  submissionError,
  submissionAppId,
  onRetry,
  onBack,
  onGoCatalog,
}: SubmissionResultScreenProps) {
  const handleOpenCurator = () => {
    const link = CANONICAL_CURATOR_TG_LINK;
    const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(link);
    } else if (tg?.openLink) {
      tg.openLink(link);
    } else if (typeof window !== "undefined") {
      window.open(link, "_blank");
    }
  };

  return (
    <>
      <nav className={styles.navBar}>
        {submissionState !== "submitting" && (
          <button
            type="button"
            className={styles.backBtn}
            onClick={submissionState === "success" ? onGoCatalog : onBack}
          >
            {submissionState === "success" ? "← В каталог" : "← Проверка данных"}
          </button>
        )}
        <span className={styles.navTitle}>
          {submissionState === "success"
            ? "Заявка принята"
            : submissionState === "submitting"
            ? "Отправка заявки"
            : "Ошибка отправки"}
        </span>
      </nav>

      <article className={styles.detailCard}>
        {submissionState === "submitting" ? (
          <div className={styles.submittingContainer} role="status" aria-live="polite">
            <div className={styles.spinner} />
            <h1 className={styles.payerHeading}>Оформление заявки</h1>
            <p className={styles.payerSubheading}>
              Пожалуйста, подождите, мы регистрируем вашу заявку в системе...
            </p>
          </div>
        ) : submissionState === "error" ? (
          <div className={styles.errorContainer} role="alert">
            <div className={styles.errorBadge}>⚠️ Не удалось оформить заявку</div>
            <h1 className={styles.payerHeading}>Ошибка отправки</h1>
            <p className={styles.errorMessageText}>
              {submissionError ||
                "Произошла ошибка при отправке заявки. Пожалуйста, повторите попытку."}
            </p>

            <div className={styles.ctaBox}>
              <button type="button" className={styles.primaryBtn} onClick={onRetry}>
                Повторить попытку
              </button>
              <button type="button" className={styles.secondaryBtn} onClick={onBack}>
                Вернуться к проверке данных
              </button>
            </div>
          </div>
        ) : submissionState === "success" ? (
          <div className={styles.successContainer} role="status">
            {submissionAppId && (
              <div className={styles.submissionAppIdBadge} data-testid="submission-app-id">
                ✓ Заявка #{submissionAppId} принята
              </div>
            )}
            <h1 className={styles.payerHeading}>Заявка успешно оформлена!</h1>

            <div className={styles.successMessageCard}>
              <p className={styles.successMessageText} data-testid="success-copy-text">
                {SUCCESS_COPY_VERBATIM}
              </p>
            </div>

            <div className={styles.ctaBox}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleOpenCurator}
                data-testid="curator-chat-btn"
              >
                Связаться с куратором (@Lebedev_AST)
              </button>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={onGoCatalog}
              >
                В каталог курсов
              </button>
            </div>
          </div>
        ) : null}
      </article>

      <footer className={styles.footer}>
        <p className={styles.footerText}>
          Академия структурной типологии · Официальный Telegram-сервис
        </p>
      </footer>
    </>
  );
}
