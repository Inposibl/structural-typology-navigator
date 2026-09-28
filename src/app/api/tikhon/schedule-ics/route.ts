import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { validateTelegramInitData } from "../student-status/route";

export const runtime = "nodejs";

/**
 * TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-6.SCHEDULE-DELIVERY-AND-ICS-1
 *
 * Скачивание календаря (.ics) участником. Файл формируется российским
 * Tikhon-сервером ТОЛЬКО из реконсиляции B6-D; роут только аутентифицирует
 * (верифицированный Telegram initData), подписывает S2S и возвращает байты
 * как вложение. Точная пара (course_id, cohort_id) авторизуется сервером
 * против оплаченных заявок пользователя; навигаторский роут доступ не
 * расширяет (иная пара — 403 от сервера).
 */

const MAX_PAYLOAD_BYTES = 65536; // 64 KB

const APPLICATIONS_PATH = "/api/v1/applications";
const SCHEDULE_ICS_PATH = "/api/v1/calendar/schedule-ics";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: "PAYLOAD_TOO_LARGE", message: "Request payload exceeds 64KB limit" },
        { status: 413 }
      );
    }

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: "PAYLOAD_TOO_LARGE", message: "Request payload exceeds 64KB limit" },
        { status: 413 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "INVALID_JSON", message: "Request body is not valid JSON" },
        { status: 400 }
      );
    }

    const initDataHeader = request.headers.get("x-telegram-init-data");
    if (!initDataHeader || typeof initDataHeader !== "string") {
      return NextResponse.json(
        { error: "UNAUTHORIZED_NO_INIT_DATA", message: "Missing Telegram WebApp initData" },
        { status: 401 }
      );
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json(
        { error: "SERVER_CONFIGURATION_ERROR", message: "Telegram bot token not configured" },
        { status: 500 }
      );
    }

    const authResult = validateTelegramInitData(initDataHeader, botToken);
    if (!authResult.valid || !authResult.userId) {
      return NextResponse.json(
        { error: "UNAUTHORIZED_INVALID_INIT_DATA", message: authResult.error || "Invalid Telegram WebApp initData" },
        { status: 401 }
      );
    }

    const verifiedUserId = authResult.userId;

    if (typeof body.course_id !== "string" || !body.course_id ||
        typeof body.cohort_id !== "string" || !body.cohort_id) {
      return NextResponse.json(
        { error: "MISSING_COURSE_PARAMS", message: "course_id and cohort_id are required" },
        { status: 400 }
      );
    }

    const forwardPayload = {
      user_id: verifiedUserId,
      course_id: String(body.course_id).trim(),
      cohort_id: String(body.cohort_id).trim(),
    };

    const forwardBodyJson = JSON.stringify(forwardPayload);
    const bodySha256 = crypto.createHash("sha256").update(forwardBodyJson).digest("hex");

    const internalSecret = process.env.TIKHON_INTERNAL_SECRET;
    if (!internalSecret) {
      console.error(`[AUDIT] event=s2s_secret_missing latency_ms=${Date.now() - startTime}`);
      return NextResponse.json(
        { error: "SERVER_CONFIGURATION_ERROR", message: "S2S secret not configured" },
        { status: 500 }
      );
    }

    const timestampMs = Date.now().toString();
    const nonceUuid = crypto.randomUUID();

    const canonicalString = `TIKHON-S2S-V1\nPOST\n${SCHEDULE_ICS_PATH}\n${timestampMs}\n${nonceUuid}\n${bodySha256}`;
    const signature = crypto
      .createHmac("sha256", internalSecret)
      .update(canonicalString)
      .digest("hex");

    const russianServerUrl = process.env.TIKHON_RUSSIAN_SERVER_URL;
    if (!russianServerUrl) {
      console.error(`[AUDIT] event=upstream_url_missing latency_ms=${Date.now() - startTime}`);
      return NextResponse.json(
        { status: "FAILED", error: "UPSTREAM_URL_NOT_CONFIGURED", message: "Сервер расписания не настроен." },
        { status: 500 }
      );
    }

    if (process.env.NODE_ENV === "production" && !russianServerUrl.startsWith("https://")) {
      console.error(`[AUDIT] event=upstream_url_not_https latency_ms=${Date.now() - startTime}`);
      return NextResponse.json(
        { status: "FAILED", error: "UPSTREAM_URL_NOT_HTTPS", message: "Небезопасная конфигурация сервера расписания." },
        { status: 500 }
      );
    }

    let configuredUrl: URL;
    try {
      configuredUrl = new URL(russianServerUrl);
    } catch {
      console.error(`[AUDIT] event=upstream_url_malformed latency_ms=${Date.now() - startTime}`);
      return NextResponse.json(
        { status: "FAILED", error: "UPSTREAM_URL_NOT_CONFIGURED", message: "Сервер расписания не настроен." },
        { status: 500 }
      );
    }

    if (
      configuredUrl.pathname !== APPLICATIONS_PATH ||
      configuredUrl.search !== "" ||
      configuredUrl.hash !== ""
    ) {
      console.error(`[AUDIT] event=upstream_url_shape_unsupported latency_ms=${Date.now() - startTime}`);
      return NextResponse.json(
        { status: "FAILED", error: "UPSTREAM_URL_NOT_CONFIGURED", message: "Сервер расписания не настроен." },
        { status: 500 }
      );
    }

    const scheduleIcsUrl = configuredUrl.origin + SCHEDULE_ICS_PATH;

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(scheduleIcsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tikhon-Timestamp": timestampMs,
          "X-Tikhon-Nonce": nonceUuid,
          "X-Tikhon-Signature": signature,
        },
        body: forwardBodyJson,
      });
    } catch {
      console.error(`[AUDIT] event=schedule_ics_forward_network_error latency_ms=${Date.now() - startTime}`);
      return NextResponse.json(
        { status: "FAILED", error: "RUSSIAN_SERVER_UNREACHABLE", message: "Сервер расписания временно недоступен. Повторите попытку позже." },
        { status: 502 }
      );
    }

    if (!upstreamResponse.ok) {
      let errorData: Record<string, unknown> = {};
      try {
        errorData = (await upstreamResponse.json()) as Record<string, unknown>;
      } catch {
        errorData = {};
      }
      console.log(
        `[AUDIT] event=schedule_ics_forward_rejected status=${upstreamResponse.status} latency_ms=${Date.now() - startTime}`
      );
      return NextResponse.json(
        {
          status: "FAILED",
          error: errorData.error || "SCHEDULE_ICS_FAILED",
          message: "Не удалось получить календарь. Повторите попытку.",
        },
        { status: upstreamResponse.status || 502 }
      );
    }

    const icsBytes = Buffer.from(await upstreamResponse.arrayBuffer());
    const disposition =
      upstreamResponse.headers.get("content-disposition") ||
      'attachment; filename="schedule.ics"';

    console.log(
      `[AUDIT] event=schedule_ics_forward_complete bytes=${icsBytes.byteLength} latency_ms=${Date.now() - startTime}`
    );

    return new NextResponse(new Uint8Array(icsBytes), {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    console.error(`[AUDIT] event=schedule_ics_unhandled_error latency_ms=${Date.now() - startTime}`);
    return NextResponse.json(
      { error: "INTERNAL_SERVER_ERROR", message: "Произошла непредвиденная ошибка при получении календаря." },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "METHOD_NOT_ALLOWED", message: "Only POST requests are supported" },
    { status: 405 }
  );
}
