/**
 * TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-6.SCHEDULE-DELIVERY-AND-ICS-1
 *
 * Клиентский модуль поверхности расписания B6-F: загрузка пользовательского
 * расписания и скачивание календаря (.ics). Расписание и календарь строит
 * российский Tikhon-сервер ТОЛЬКО из реконсиляции B6-D; клиент только
 * передает верифицированный Telegram initData (user_id никогда не
 * формируется клиентом).
 */

export type ScheduledAuthority = "current" | "last_known_good" | "unavailable";

export interface ScheduleEntry {
  kind: "scheduled" | "supplemental";
  kind_label: string;
  start_at: string;
  date_msk: string;
  time_msk: string;
  title?: string;
  zoom_url?: string;
}

export interface ScheduleView {
  course_id: string;
  course_title: string;
  cohort_id: string;
  cohort_title: string;
  scheduled_authority: ScheduledAuthority;
  upcoming: ScheduleEntry[];
  empty_label: string;
  freshness_label?: string;
  unavailable_label?: string;
}

export interface ScheduleSurfaceResult {
  ok: boolean;
  status: "OK" | "NO_ACTIVE_ENROLLMENT" | "FAILED";
  schedules: ScheduleView[];
  error?: string;
}

export interface IcsDownloadResult {
  ok: boolean;
  error?: string;
}

let scheduleFetchInFlight = false;

export function isScheduleFetchInFlight(): boolean {
  return scheduleFetchInFlight;
}

function resolveInitData(initData?: string): string | undefined {
  return (
    initData ||
    (typeof window !== "undefined" ? window.Telegram?.WebApp?.initData : undefined)
  );
}

/** Загружает пользовательское расписание (все оплаченные потоки участника). */
export async function fetchParticipantSchedule(
  initData?: string
): Promise<ScheduleSurfaceResult> {
  const tgInitData = resolveInitData(initData);
  if (!tgInitData) {
    return { ok: false, status: "FAILED", schedules: [], error: "MISSING_TELEGRAM_AUTH" };
  }
  if (scheduleFetchInFlight) {
    return { ok: false, status: "FAILED", schedules: [], error: "FETCH_IN_PROGRESS" };
  }

  scheduleFetchInFlight = true;
  try {
    const res = await fetch("/api/tikhon/schedule", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": tgInitData,
      },
      body: "{}",
    });

    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }

    if (res.ok && data.status === "OK" && Array.isArray(data.schedules)) {
      return { ok: true, status: "OK", schedules: data.schedules as ScheduleView[] };
    }
    if (res.ok && data.status === "NO_ACTIVE_ENROLLMENT") {
      return { ok: true, status: "NO_ACTIVE_ENROLLMENT", schedules: [] };
    }
    return {
      ok: false,
      status: "FAILED",
      schedules: [],
      error: typeof data.error === "string" ? data.error : "SCHEDULE_READ_FAILED",
    };
  } catch {
    return { ok: false, status: "FAILED", schedules: [], error: "NETWORK_ERROR" };
  } finally {
    scheduleFetchInFlight = false;
  }
}

// Модульный in-flight guard по паре (course, cohort): повторный клик во
// время скачивания не создает второго запроса файла.
const icsInFlight = new Set<string>();

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Скачивает календарь (.ics) ТОЧНОГО оплаченного потока участника. */
export async function downloadScheduleIcs(
  courseId: string,
  cohortId: string,
  initData?: string
): Promise<IcsDownloadResult> {
  const key = `${courseId}::${cohortId}`;
  if (icsInFlight.has(key)) {
    return { ok: false, error: "DOWNLOAD_IN_PROGRESS" };
  }
  const tgInitData = resolveInitData(initData);
  if (!tgInitData) {
    return { ok: false, error: "MISSING_TELEGRAM_AUTH" };
  }

  icsInFlight.add(key);
  try {
    const res = await fetch("/api/tikhon/schedule-ics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": tgInitData,
      },
      body: JSON.stringify({ course_id: courseId, cohort_id: cohortId }),
    });

    if (!res.ok) {
      return { ok: false, error: "SCHEDULE_ICS_FAILED" };
    }
    const blob = await res.blob();
    triggerBrowserDownload(blob, `AST_${courseId}_${cohortId}.ics`);
    return { ok: true };
  } catch {
    return { ok: false, error: "NETWORK_ERROR" };
  } finally {
    icsInFlight.delete(key);
  }
}
