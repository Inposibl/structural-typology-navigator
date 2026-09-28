import React, { useCallback, useEffect, useState } from "react";
import styles from "./miniapp.module.css";
import {
  ScheduleView,
  ScheduleEntry,
  fetchParticipantSchedule,
  downloadScheduleIcs,
} from "./schedule.ts";

/**
 * TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-6.SCHEDULE-DELIVERY-AND-ICS-1
 *
 * РАСПИСАНИЕ: пользовательская поверхность расписания в рабочем пространстве
 * Тихона. Контент строится ТОЛЬКО сервером из реконсиляции B6-D; панель
 * никогда не собирает расписание сама и не показывает выдуманные ссылки.
 */

export const SCHEDULE_PANEL_TITLE = "РАСПИСАНИЕ";
export const SCHEDULE_NEAREST_LABEL = "Ближайшая встреча";
export const SCHEDULE_UPCOMING_LABEL = "Предстоящие занятия";
export const SCHEDULE_ICS_CTA = "Добавить в календарь";
export const SCHEDULE_ICS_PENDING = "Готовим календарь…";
export const SCHEDULE_ERROR_COPY = "Расписание временно недоступно. Повторите попытку позже.";
export const SCHEDULE_RETRY_COPY = "Повторить";

type PanelPhase = "loading" | "ready" | "error";

interface IcsPhase {
  key: string;
  state: "pending" | "done";
}

export interface SchedulePanelProps {
  initData?: string;
}

function EntryRow({ entry, nearest }: { entry: ScheduleEntry; nearest?: boolean }) {
  const supplemental = entry.kind === "supplemental";
  return (
    <li
      className={`${styles.scheduleItem}${nearest ? ` ${styles.scheduleItemNearest}` : ""}`}
      data-testid={nearest ? "schedule-nearest-item" : "schedule-item"}
    >
      <div className={styles.scheduleItemWhen}>
        <span className={styles.scheduleItemDate}>{entry.date_msk}</span>
        <span className={styles.scheduleItemTime}>{entry.time_msk} МСК</span>
      </div>
      <div className={styles.scheduleItemBody}>
        <span
          className={
            supplemental
              ? styles.kindBadgeSupplemental
              : styles.kindBadge
          }
          data-testid="schedule-kind-badge"
        >
          {entry.kind_label}
        </span>
        {entry.title ? (
          <span className={styles.scheduleItemTitle}>{entry.title}</span>
        ) : null}
        {entry.zoom_url ? (
          <a
            className={styles.scheduleZoomLink}
            href={entry.zoom_url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="schedule-zoom-link"
          >
            Ссылка на Zoom
          </a>
        ) : null}
      </div>
    </li>
  );
}

function CohortScheduleCard({
  view,
  onDownloadIcs,
  icsPhase,
}: {
  view: ScheduleView;
  onDownloadIcs: (view: ScheduleView) => void;
  icsPhase?: IcsPhase;
}) {
  const key = `${view.course_id}::${view.cohort_id}`;
  const nearest = view.upcoming[0];
  const rest = view.upcoming.slice(1);

  return (
    <article className={styles.scheduleCard} data-testid="schedule-cohort-card">
      <header className={styles.scheduleCardHeader}>
        <p className={styles.scheduleCardCourse} data-testid="schedule-course-title">
          {view.course_title}
        </p>
        <p className={styles.scheduleCardCohort} data-testid="schedule-cohort-title">
          {view.cohort_title}
        </p>
      </header>

      {view.unavailable_label ? (
        <p className={styles.scheduleUnavailable} data-testid="schedule-unavailable-note">
          {view.unavailable_label}
        </p>
      ) : null}
      {view.freshness_label ? (
        <p className={styles.scheduleFreshness} data-testid="schedule-freshness-note">
          {view.freshness_label}
        </p>
      ) : null}

      {view.upcoming.length === 0 ? (
        <p className={styles.scheduleEmpty} data-testid="schedule-empty-text">
          {view.empty_label}
        </p>
      ) : (
        <>
          <p className={styles.scheduleNearestCaption}>{SCHEDULE_NEAREST_LABEL}</p>
          <ul className={styles.scheduleList}>
            <EntryRow entry={nearest} nearest />
          </ul>
          {rest.length > 0 ? (
            <>
              <p className={styles.scheduleUpcomingCaption}>{SCHEDULE_UPCOMING_LABEL}</p>
              <ul className={styles.scheduleList}>
                {rest.map((entry, idx) => (
                  <EntryRow key={`${entry.start_at}-${entry.kind}-${idx}`} entry={entry} />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}

      <button
        type="button"
        className={styles.secondaryBtn}
        onClick={() => onDownloadIcs(view)}
        disabled={icsPhase?.key === key && icsPhase?.state === "pending"}
        data-testid="schedule-ics-btn"
      >
        {icsPhase?.key === key && icsPhase?.state === "pending"
          ? SCHEDULE_ICS_PENDING
          : SCHEDULE_ICS_CTA}
      </button>
    </article>
  );
}

/**
 * Presentational body панели (без эффектов): статически тестируемый слой.
 * SchedulePanel отвечает за загрузку; Body — только за рендер данных,
 * полученных с сервера.
 */
export function SchedulePanelBody({
  schedules,
  onDownloadIcs,
  icsPhase,
}: {
  schedules: ScheduleView[];
  onDownloadIcs: (view: ScheduleView) => void;
  icsPhase?: IcsPhase;
}) {
  return (
    <section className={styles.schedulePanel} data-testid="schedule-panel">
      <h2 className={styles.schedulePanelTitle}>{SCHEDULE_PANEL_TITLE}</h2>
      {schedules.map((view) => (
        <CohortScheduleCard
          key={`${view.course_id}-${view.cohort_id}`}
          view={view}
          onDownloadIcs={onDownloadIcs}
          icsPhase={icsPhase}
        />
      ))}
    </section>
  );
}

export function SchedulePanel({ initData }: SchedulePanelProps) {
  const [phase, setPhase] = useState<PanelPhase>("loading");
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [icsPhase, setIcsPhase] = useState<IcsPhase | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchParticipantSchedule(initData).then((result) => {
      if (cancelled) return;
      if (result.ok && result.status === "OK") {
        setSchedules(result.schedules);
        setPhase("ready");
      } else if (result.ok && result.status === "NO_ACTIVE_ENROLLMENT") {
        setSchedules([]);
        setPhase("ready");
      } else {
        setPhase("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [initData]);

  const handleDownloadIcs = useCallback(
    (view: ScheduleView) => {
      const key = `${view.course_id}::${view.cohort_id}`;
      if (icsPhase?.key === key && icsPhase.state === "pending") return;
      setIcsPhase({ key, state: "pending" });
      downloadScheduleIcs(view.course_id, view.cohort_id, initData).then((res) => {
        setIcsPhase(res.ok ? { key, state: "done" } : undefined);
      });
    },
    [initData, icsPhase]
  );

  const retry = useCallback(() => {
    setPhase("loading");
    fetchParticipantSchedule(initData).then((result) => {
      if (result.ok) {
        setSchedules(result.schedules);
        setPhase("ready");
      } else {
        setPhase("error");
      }
    });
  }, [initData]);

  if (phase === "error") {
    return (
      <section className={styles.schedulePanel} data-testid="schedule-panel-error">
        <h2 className={styles.schedulePanelTitle}>{SCHEDULE_PANEL_TITLE}</h2>
        <p className={styles.scheduleErrorText} role="alert" data-testid="schedule-error-text">
          {SCHEDULE_ERROR_COPY}
        </p>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={retry}
          data-testid="schedule-retry-btn"
        >
          {SCHEDULE_RETRY_COPY}
        </button>
      </section>
    );
  }

  // Без оплаченных потоков поверхность расписания не показывается
  // (участник еще не зачислен — каталог остается первичным экраном).
  if (phase !== "ready" || schedules.length === 0) {
    return null;
  }

  return (
    <SchedulePanelBody
      schedules={schedules}
      onDownloadIcs={handleDownloadIcs}
      icsPhase={icsPhase}
    />
  );
}
