export type WaitlistSendStatus = "SUCCESS" | "FAILED";

export interface WaitlistSendResult {
  ok: boolean;
  status: WaitlistSendStatus;
  alreadyRegistered?: boolean;
  error?: string;
}

export interface WaitlistContactDraft {
  full_name: string;
  phone: string;
  email: string;
}

// Модульный in-flight guard: повторный вызов, пока отправка не завершилась,
// не создает второй запрос — один клик = одна заявка в лист ожидания.
let waitlistSendInFlight = false;

export function isWaitlistSendInFlight(): boolean {
  return waitlistSendInFlight;
}

/**
 * Отправляет контактные данные в лист ожидания через защищенный Next.js роут
 * /api/tikhon/waitlist. Роут верифицирует Telegram initData, подписывает S2S-запрос
 * и передает на российский сервер. Лист ожидания НЕ является заявкой на участие:
 * никаких платежных записей не создается, места в потоках не потребляются.
 */
export async function submitWaitlistLead(
  courseId: string,
  draft: WaitlistContactDraft,
  initData?: string
): Promise<WaitlistSendResult> {
  if (waitlistSendInFlight) {
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

  waitlistSendInFlight = true;
  try {
    const res = await fetch("/api/tikhon/waitlist", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": tgInitData,
      },
      body: JSON.stringify({
        course_id: courseId,
        full_name: draft.full_name,
        phone: draft.phone,
        email: draft.email,
      }),
    });

    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }

    if (res.ok && data.status === "SUCCESS") {
      return {
        ok: true,
        status: "SUCCESS",
        alreadyRegistered: data.already_registered === true,
      };
    }
    return {
      ok: false,
      status: "FAILED",
      error: typeof data.error === "string" ? data.error : "WAITLIST_SEND_FAILED",
    };
  } catch {
    return { ok: false, status: "FAILED", error: "NETWORK_ERROR" };
  } finally {
    waitlistSendInFlight = false;
  }
}

/** Клиентская валидация контактных данных листа ожидания. */
export function validateWaitlistDraft(
  draft: WaitlistContactDraft
): { valid: boolean; error?: string } {
  const fullName = draft.full_name.trim();
  if (fullName.split(/\s+/).filter(Boolean).length < 2) {
    return { valid: false, error: "Укажите имя и фамилию" };
  }
  const phone = draft.phone.trim();
  const email = draft.email.trim();
  if (!phone && !email) {
    return { valid: false, error: "Укажите телефон или email для связи" };
  }
  if (email && !email.includes("@")) {
    return { valid: false, error: "Некорректный email" };
  }
  return { valid: true };
}
