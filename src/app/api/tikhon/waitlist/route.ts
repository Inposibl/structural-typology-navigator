import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { validateTelegramInitData } from "../student-status/route";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 65536; // 64 KB

// CORR1-паттерн: строгий разбор URL — точный pathname applications,
// без префиксов, query и фрагментов; календарный/вайтлистный эндпоинт
// строится из валидированного origin.
const APPLICATIONS_PATH = "/api/v1/applications";
const WAITLIST_PATH = "/api/v1/waitlist";

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
    const verifiedUser = authResult.user || {};

    // 3. Валидация канонических параметров
    const { course_id } = body;

    if (!course_id || typeof course_id !== "string") {
      return NextResponse.json(
        { error: "MISSING_COURSE_PARAMS", message: "course_id is required" },
        { status: 400 }
      );
    }

    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    if (fullName.split(/\s+/).filter(Boolean).length < 2) {
      return NextResponse.json(
        { error: "INVALID_FULL_NAME", message: "Full name must contain at least 2 words" },
        { status: 400 }
      );
    }

    const rawPhone = body.phone;
    const phone = rawPhone && String(rawPhone).trim() ? String(rawPhone).trim() : null;
    const rawEmail = body.email;
    const email = rawEmail && String(rawEmail).trim() ? String(rawEmail).trim() : null;

    if (!phone && !email) {
      return NextResponse.json(
        { error: "MISSING_CONTACT_DATA", message: "Phone or email is required" },
        { status: 400 }
      );
    }

    if (email && !email.includes("@")) {
      return NextResponse.json(
        { error: "INVALID_EMAIL", message: "Valid email is required" },
        { status: 400 }
      );
    }

    // 4. Канонический payload: user_id ТОЛЬКО из верифицированного initData.
    // Никаких платежных полей: лист ожидания не является заявкой на участие.
    const forwardPayload = {
      user_id: verifiedUserId,
      username: verifiedUser.username || null,
      course_id: String(course_id).trim(),
      full_name: fullName,
      phone: phone,
      email: email,
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

    const canonicalString = `TIKHON-S2S-V1\nPOST\n${WAITLIST_PATH}\n${timestampMs}\n${nonceUuid}\n${bodySha256}`;
    const signature = crypto
      .createHmac("sha256", internalSecret)
      .update(canonicalString)
      .digest("hex");

    // 6. Fail-closed URL: строгий разбор — точный applications pathname,
    // без префиксов, query и фрагментов; waitlist-эндпоинт строится из origin.
    const russianServerUrl = process.env.TIKHON_RUSSIAN_SERVER_URL;
    if (!russianServerUrl) {
      console.error(
        `[AUDIT] event=upstream_url_missing latency_ms=${Date.now() - startTime}`
      );
      return NextResponse.json(
        {
          status: "FAILED",
          error: "UPSTREAM_URL_NOT_CONFIGURED",
          message: "Сервер листа ожидания не настроен.",
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
          message: "Небезопасная конфигурация сервера листа ожидания.",
        },
        { status: 500 }
      );
    }

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
          message: "Сервер листа ожидания не настроен.",
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
          message: "Сервер листа ожидания не настроен.",
        },
        { status: 500 }
      );
    }

    const waitlistUrl = configuredUrl.origin + WAITLIST_PATH;

    // 7. Отправка на российский сервер
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(waitlistUrl, {
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
        `[AUDIT] event=waitlist_forward_network_error latency_ms=${Date.now() - startTime}`
      );
      return NextResponse.json(
        {
          status: "FAILED",
          error: "RUSSIAN_SERVER_UNREACHABLE",
          message: "Сервер листа ожидания временно недоступен. Повторите попытку позже.",
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
      `[AUDIT] event=waitlist_forward_complete status=${upstreamResponse.status} latency_ms=${latencyMs}`
    );

    if (upstreamResponse.ok && responseData.status === "SUCCESS") {
      return NextResponse.json(
        {
          status: "SUCCESS",
          already_registered: responseData.already_registered === true,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        status: "FAILED",
        error: responseData.error || "WAITLIST_SEND_FAILED",
        message: "Не удалось отправить заявку в лист ожидания. Повторите попытку.",
      },
      { status: upstreamResponse.status || 502 }
    );
  } catch {
    console.error(`[AUDIT] event=waitlist_unhandled_error latency_ms=${Date.now() - startTime}`);
    return NextResponse.json(
      { error: "INTERNAL_SERVER_ERROR", message: "Произошла непредвиденная ошибка при отправке листа ожидания." },
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
