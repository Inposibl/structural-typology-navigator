import React, { useCallback, useState } from "react";
import styles from "./miniapp.module.css";
import { Cohort, Course } from "./helpers.ts";
import { sendScheduleToTelegram } from "./calendar.ts";

type ScheduleSendPhase = "idle" | "sending" | "sent" | "error";

export const SCHEDULE_FORMING_COPY = "Расписание для данного потока формируется.";
export const SCHEDULE_CTA_COPY = "Отправить расписание в Telegram";
export const SCHEDULE_SENDING_COPY = "Отправляем…";
export const SCHEDULE_SENT_COPY = "✓ Расписание отправлено в Telegram";
export const SCHEDULE_ERROR_COPY = "Не удалось отправить расписание. Попробуйте ещё раз.";
export const SCHEDULE_RETRY_COPY = "Повторить отправку";

export interface CalendarHubProps {
  course: Course | null;
  cohort: Cohort | null;
}

/**
 * Календарный хаб на экране успешной заявки.
 * A: расписание доступно → CTA «Отправить расписание в Telegram»
 * B: отправка → кнопка заблокирована («Отправляем…»)
 * C: отправлено → подтверждение
 * D: расписания еще нет → «Расписание для данного потока формируется.»
 * E: ошибка доставки → ограниченное сообщение + безопасный повтор.
 * Повторные клики во время отправки не создают дубликаты документов
 * (модульный in-flight guard в calendar.ts + disabled на кнопке).
 */
export function CalendarHub({ course, cohort }: CalendarHubProps) {
  const [phase, setPhase] = useState<ScheduleSendPhase>("idle");
  const [formingOverride, setFormingOverride] = useState(false);

  const scheduleAvailable = cohort?.has_canonical_sessions === true && !formingOverride;

  const handleSend = useCallback(async () => {
    if (!course || !cohort || phase === "sending") return;
    setPhase("sending");
    try {
      const result = await sendScheduleToTelegram(course.id, cohort.id);
      if (result.ok && result.status === "SENT") {
        setPhase("sent");
      } else if (result.ok && result.status === "SCHEDULE_FORMING") {
        setFormingOverride(true);
        setPhase("idle");
      } else {
        setPhase("error");
      }
    } catch {
      setPhase("error");
    }
  }, [course, cohort, phase]);

  if (!course || !cohort) return null;

  return (
    <section className={styles.calendarHub} data-testid="calendar-hub">
      <div className={styles.calendarHubContext}>
        <p className={styles.calendarHubCourse} data-testid="calendar-course-title">
          {course.title}
        </p>
        <p className={styles.calendarHubCohort} data-testid="calendar-cohort-context">
          {cohort.title} · {cohort.schedule}
        </p>
      </div>

      {scheduleAvailable ? (
        <div className={styles.ctaBox}>
          {phase === "sent" ? (
            <p className={styles.calendarSentText} role="status" data-testid="schedule-sent-text">
              {SCHEDULE_SENT_COPY}
            </p>
          ) : (
            <>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleSend}
                disabled={phase === "sending"}
                data-testid="send-schedule-btn"
              >
                {phase === "sending" ? SCHEDULE_SENDING_COPY : SCHEDULE_CTA_COPY}
              </button>
              {phase === "error" && (
                <>
                  <p className={styles.calendarErrorText} role="alert" data-testid="schedule-error-text">
                    {SCHEDULE_ERROR_COPY}
                  </p>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={handleSend}
                    data-testid="schedule-retry-btn"
                  >
                    {SCHEDULE_RETRY_COPY}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <p className={styles.calendarFormingText} data-testid="schedule-forming-text">
          {SCHEDULE_FORMING_COPY}
        </p>
      )}
    </section>
  );
}
