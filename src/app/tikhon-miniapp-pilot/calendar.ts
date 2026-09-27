export type ScheduleSendStatus = "SENT" | "SCHEDULE_FORMING" | "FAILED";

export interface ScheduleSendResult {
  ok: boolean;
  status: ScheduleSendStatus;
  error?: string;
}

// Модульный in-flight guard: повторный вызов, пока отправка не завершилась,
// не создает второй запрос — один клик = одно отправление документа.
let scheduleSendInFlight = false;

export function isScheduleSendInFlight(): boolean {
  return scheduleSendInFlight;
}

/**
 * Отправляет расписание потока в Telegram аутентифицированного пользователя
 * через защищенный Next.js роут /api/tikhon/send-schedule.
 * Роут верифицирует Telegram initData и подписывает S2S-запрос;
 * получателем документа всегда является верифицированный Telegram-пользователь.
 */
export async function sendScheduleToTelegram(
  courseId: string,
  cohortId: string,
  initData?: string
): Promise<ScheduleSendResult> {
  if (scheduleSendInFlight) {
    return { ok: false, status: "FAILED", error: "SEND_IN_PROGRESS" };
  }

  const tgInitData =
    initData ||
    (typeof window !== "undefined"
      ? window.Telegram?.WebApp?.initData
      : undefined);

  if (!tgInitData) {
    return {
      ok: false,
      status: "FAILED",
      error: "MISSING_TELEGRAM_AUTH",
    };
  }

  scheduleSendInFlight = true;
  try {
    const res = await fetch("/api/tikhon/send-schedule", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": tgInitData,
      },
      body: JSON.stringify({ course_id: courseId, cohort_id: cohortId }),
    });

    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }

    if (res.ok && data.status === "SENT") {
      return { ok: true, status: "SENT" };
    }
    if (res.ok && data.status === "SCHEDULE_FORMING") {
      return { ok: true, status: "SCHEDULE_FORMING" };
    }
    return {
      ok: false,
      status: "FAILED",
      error: typeof data.error === "string" ? data.error : "SCHEDULE_SEND_FAILED",
    };
  } catch {
    return { ok: false, status: "FAILED", error: "NETWORK_ERROR" };
  } finally {
    scheduleSendInFlight = false;
  }
}
