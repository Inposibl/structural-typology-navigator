import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { validateTelegramInitData } from "../student-status/route";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 65536; // 64 KB

// Accepted upstream URL carries the applications path; the schedule endpoint
// rides the same host and secret, so the base is derived fail-closed.
const APPLICATIONS_PATH = "/api/v1/applications";
const SCHEDULE_SEND_PATH = "/api/v1/calendar/schedule-send";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // 1. Ограничение размера запроса
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

    // 2. Идентификация: только верифицированный Telegram initData.
    // Клиентский body.user_id никогда не читается и не пересылается.
    const initDataHeader = request.headers.get("x-telegram-init-data");
    if (!initDataHeader || typeof initDataHeader !== "string") {
      return NextResponse.json(
        { error: "UNAUTHORIZED_NO_INIT_DATA", message: "Missing Telegram WebApp initData" },
        { status: 401 }
      );
    }

    const botToken =
      process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;

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

    // 3. Валидация канонических параметров потока
    const { course_id, cohort_id } = body;

    if (!course_id || typeof course_id !== "string" || !cohort_id || typeof cohort_id !== "string") {
      return NextResponse.json(
        { error: "MISSING_COURSE_PARAMS", message: "course_id and cohort_id are required" },
        { status: 400 }
      );
    }

    // 4. Канонический payload: user_id ТОЛЬКО из верифицированного initData
    const forwardPayload = {
      user_id: verifiedUserId,
      course_id: String(course_id).trim(),
      cohort_id: String(cohort_id).trim(),
    };

    const forwardBodyJson = JSON.stringify(forwardPayload);
    const bodySha256 = crypto.createHash("sha256").update(forwardBodyJson).digest("hex");

    // 5. Fail-closed на отсутствующем S2S секрете
    const internalSecret = process.env.TIKHON_INTERNAL_SECRET;
    if (!internalSecret) {
      console.error(
        `[AUDIT] event=s2s_secret_missing latency_ms=${Date.now() - startTime}`
      );
      return NextResponse.json(
        { error: "SERVER_CONFIGURATION_ERROR", message: "S2S secret not configured" },
        { status: 500 }
      );
    }

    const timestampMs = Date.now().toString();
    const nonceUuid = crypto.randomUUID();

    const canonicalString = `TIKHON-S2S-V1\nPOST\n${SCHEDULE_SEND_PATH}\n${timestampMs}\n${nonceUuid}\n${bodySha256}`;
    const signature = crypto
      .createHmac("sha256", internalSecret)
      .update(canonicalString)
      .digest("hex");

    // 6. Fail-closed URL: тот же российский сервер, что и для заявок.
    const russianServerUrl = process.env.TIKHON_RUSSIAN_SERVER_URL;
    if (!russianServerUrl) {
      console.error(
        `[AUDIT] event=upstream_url_missing latency_ms=${Date.now() - startTime}`
      );
      return NextResponse.json(
        {
          status: "FAILED",
          error: "UPSTREAM_URL_NOT_CONFIGURED",
          message: "Сервер расписания не настроен.",
        },
        { status: 500 }
      );
    }

    if (process.env.NODE_ENV === "production" && !russianServerUrl.startsWith("https://")) {
      console.error(
        `[AUDIT] event=upstream_url_not_https latency_ms=${Date.now() - startTime}`
      );
      return NextResponse.json(
        {
          status: "FAILED",
          error: "UPSTREAM_URL_NOT_HTTPS",
          message: "Небезопасная конфигурация сервера расписания.",
        },
        { status: 500 }
      );
    }

    // CORR1: strict URL parsing. The configured URL must be EXACTLY the
    // applications endpoint — pathname exactly /api/v1/applications, no extra
    // path prefixes, no query string, no fragment. The calendar endpoint is
    // then constructed from the validated origin. No suffix-string derivation.
    let configuredUrl: URL;
    try {
      configuredUrl = new URL(russianServerUrl);
    } catch {
      console.error(
        `[AUDIT] event=upstream_url_malformed latency_ms=${Date.now() - startTime}`
      );
      return NextResponse.json(
        {
          status: "FAILED",
          error: "UPSTREAM_URL_NOT_CONFIGURED",
          message: "Сервер расписания не настроен.",
        },
        { status: 500 }
      );
    }

    if (
      configuredUrl.pathname !== APPLICATIONS_PATH ||
      configuredUrl.search !== "" ||
      configuredUrl.hash !== ""
    ) {
      console.error(
        `[AUDIT] event=upstream_url_shape_unsupported latency_ms=${Date.now() - startTime}`
      );
      return NextResponse.json(
        {
          status: "FAILED",
          error: "UPSTREAM_URL_NOT_CONFIGURED",
          message: "Сервер расписания не настроен.",
        },
        { status: 500 }
      );
    }

    const scheduleSendUrl = configuredUrl.origin + SCHEDULE_SEND_PATH;

    // 7. Отправка на российский сервер
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(scheduleSendUrl, {
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
      console.error(
        `[AUDIT] event=schedule_forward_network_error latency_ms=${Date.now() - startTime}`
      );
      return NextResponse.json(
        {
          status: "FAILED",
          error: "RUSSIAN_SERVER_UNREACHABLE",
          message: "Сервер расписания временно недоступен. Повторите попытку позже.",
        },
        { status: 502 }
      );
    }

    let responseData: Record<string, unknown> = {};
    try {
      responseData = (await upstreamResponse.json()) as Record<string, unknown>;
    } catch {
      responseData = {};
    }

    const latencyMs = Date.now() - startTime;
    console.log(
      `[AUDIT] event=schedule_forward_complete status=${upstreamResponse.status} latency_ms=${latencyMs}`
    );

    if (upstreamResponse.ok && responseData.status === "SENT") {
      return NextResponse.json({ status: "SENT" }, { status: 200 });
    }

    if (upstreamResponse.ok && responseData.status === "SCHEDULE_FORMING") {
      return NextResponse.json({ status: "SCHEDULE_FORMING" }, { status: 200 });
    }

    return NextResponse.json(
      {
        status: "FAILED",
        error: responseData.error || "SCHEDULE_SEND_FAILED",
        message: "Не удалось отправить расписание. Повторите попытку.",
      },
      { status: upstreamResponse.status || 502 }
    );
  } catch {
    console.error(`[AUDIT] event=schedule_unhandled_error latency_ms=${Date.now() - startTime}`);
    return NextResponse.json(
      { error: "INTERNAL_SERVER_ERROR", message: "Произошла непредвиденная ошибка при отправке расписания." },
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
