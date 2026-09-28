import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { validateTelegramInitData } from "../student-status/route";

export const runtime = "nodejs";

/**
 * TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-6.SCHEDULE-DELIVERY-AND-ICS-1
 *
 * Проксирует пользовательскую поверхность расписания (B6-F) с российского
 * Tikhon-сервера. Сервер — единственный авторитет: расписание построено
 * только из реконсиляции B6-D. Роут только аутентифицирует и подписывает.
 *
 * Идентификация: user_id — ТОЛЬКО из верифицированного Telegram initData;
 * клиентский user_id никогда не читается и не пересылается. Точная пара
 * (course_id, cohort_id) выводится Tikhon-сервером из оплаченных заявок
 * пользователя; опциональная явная пара из клиента проверяется сервером
 * против оплаченного множества (иное — 403), навигаторский роут доступ
 * не расширяет.
 */

const MAX_PAYLOAD_BYTES = 65536; // 64 KB

const APPLICATIONS_PATH = "/api/v1/applications";
const SCHEDULE_PATH = "/api/v1/calendar/schedule";

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

    // Опциональная явная пара: сервер Tikhon сам проверит ее против
    // оплаченного множества пользователя. Навигатор не доверяет ей доступ.
    const forwardPayload: Record<string, unknown> = { user_id: verifiedUserId };
    if (typeof body.course_id === "string" && body.course_id) {
      forwardPayload.course_id = body.course_id.trim();
    }
    if (typeof body.cohort_id === "string" && body.cohort_id) {
      forwardPayload.cohort_id = body.cohort_id.trim();
    }

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

    const canonicalString = `TIKHON-S2S-V1\nPOST\n${SCHEDULE_PATH}\n${timestampMs}\n${nonceUuid}\n${bodySha256}`;
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

    // CORR1 (принятый паттерн send-schedule): строгий разбор URL — путь ровно
    // /api/v1/applications, без префиксов/query/fragment; origin валидируется,
    // путь расписания строится от проверенного origin.
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

    const scheduleUrl = configuredUrl.origin + SCHEDULE_PATH;

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(scheduleUrl, {
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
      console.error(`[AUDIT] event=schedule_forward_network_error latency_ms=${Date.now() - startTime}`);
      return NextResponse.json(
        { status: "FAILED", error: "RUSSIAN_SERVER_UNREACHABLE", message: "Сервер расписания временно недоступен. Повторите попытку позже." },
        { status: 502 }
      );
    }

    let responseData: Record<string, unknown> = {};
    try {
      responseData = (await upstreamResponse.json()) as Record<string, unknown>;
    } catch {
      responseData = {};
    }

    console.log(
      `[AUDIT] event=schedule_surface_forward_complete status=${upstreamResponse.status} latency_ms=${Date.now() - startTime}`
    );

    if (upstreamResponse.ok) {
      return NextResponse.json(responseData, {
        status: 200,
        headers: { "Cache-Control": "private, no-cache, no-store, must-revalidate" },
      });
    }

    return NextResponse.json(
      {
        status: "FAILED",
        error: responseData.error || "SCHEDULE_READ_FAILED",
        message: "Расписание временно недоступно. Повторите попытку позже.",
      },
      { status: upstreamResponse.status || 502 }
    );
  } catch {
    console.error(`[AUDIT] event=schedule_unhandled_error latency_ms=${Date.now() - startTime}`);
    return NextResponse.json(
      { error: "INTERNAL_SERVER_ERROR", message: "Произошла непредвиденная ошибка при загрузке расписания." },
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
