import { IndividualEnrollmentDraft, SUCCESS_COPY_VERBATIM } from "./helpers.ts";
import { LegalEntityEnrollmentDraft } from "./legal-entity-helpers.ts";

export interface SubmissionResult {
  ok: boolean;
  status: "SUCCESS" | "FAILED" | "PARTIAL_OR_FAILED";
  application_id?: number;
  message: string;
  error?: string;
  deliveries?: Record<string, string>;
}

/**
 * Отправляет заявку на курс через защищенный Next.js роут /api/tikhon/submit-application.
 * Роут проверяет подлинность Telegram initData, формирует канонический payload,
 * подписывает его HMAC-SHA256 и передает на российский сервер приёма заявок.
 * Никаких данных не сохраняется в Vercel/Supabase, PII не логируется.
 */
export async function submitTikhonApplication(
  draft: IndividualEnrollmentDraft | LegalEntityEnrollmentDraft,
  payerType: "individual" | "legal_entity",
  initData?: string
): Promise<SubmissionResult> {
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
      message:
        "Для оформления заявки необходимо открыть сервис через официальный Telegram-бот.",
    };
  }

  const payload: Record<string, unknown> = {
    ...draft,
    payer_type: payerType,
    initData: tgInitData,
  };

  try {
    const res = await fetch("/api/tikhon/submit-application", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": tgInitData,
      },
      body: JSON.stringify(payload),
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
        application_id: typeof data.application_id === "number" ? data.application_id : undefined,
        deliveries: typeof data.deliveries === "object" && data.deliveries !== null ? (data.deliveries as Record<string, string>) : undefined,
        message: typeof data.message === "string" ? data.message : SUCCESS_COPY_VERBATIM,
      };
    } else {
      return {
        ok: false,
        status: (data.status as "FAILED" | "PARTIAL_OR_FAILED") || "FAILED",
        application_id: typeof data.application_id === "number" ? data.application_id : undefined,
        deliveries: typeof data.deliveries === "object" && data.deliveries !== null ? (data.deliveries as Record<string, string>) : undefined,
        error: typeof data.error === "string" ? data.error : "SUBMISSION_FAILED",
        message:
          typeof data.message === "string"
            ? data.message
            : "Не удалось завершить оформление заявки. Пожалуйста, повторите попытку.",
      };
    }
  } catch {
    return {
      ok: false,
      status: "FAILED",
      error: "NETWORK_ERROR",
      message:
        "Ошибка соединения при отправке заявки. Проверьте подключение к интернету и повторите попытку.",
    };
  }
}
