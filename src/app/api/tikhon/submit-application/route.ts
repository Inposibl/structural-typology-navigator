import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { validateTelegramInitData } from "../student-status/route";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 65536; // 64 KB

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

    // 2. Получение и верификация Telegram initData
    const initDataHeader = request.headers.get("x-telegram-init-data");
    const initData = initDataHeader || body.initData;

    if (!initData || typeof initData !== "string") {
      return NextResponse.json(
        { error: "UNAUTHORIZED_NO_INIT_DATA", message: "Missing Telegram WebApp initData" },
        { status: 401 }
      );
    }

    // F-3 CORR1: Bot token fail-closed — reuse canonical resolution from student-status route.
    // Strictly fail-closed without fallback.
    const botToken =
      process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;

    if (!botToken) {
      return NextResponse.json(
        { error: "SERVER_CONFIGURATION_ERROR", message: "Telegram bot token not configured" },
        { status: 500 }
      );
    }

    const authResult = validateTelegramInitData(initData, botToken);

    if (!authResult.valid || !authResult.userId) {
      return NextResponse.json(
        { error: "UNAUTHORIZED_INVALID_INIT_DATA", message: authResult.error || "Invalid Telegram WebApp initData" },
        { status: 401 }
      );
    }

    const verifiedUserId = authResult.userId;
    const verifiedUser = authResult.user || {};

    // 3. Валидация входных данных заявки
    const { payer_type, course_id, cohort_id, pricing_option_id } = body;

    if (payer_type !== "individual" && payer_type !== "legal_entity") {
      return NextResponse.json(
        { error: "INVALID_PAYER_TYPE", message: "payer_type must be 'individual' or 'legal_entity'" },
        { status: 400 }
      );
    }

    if (!course_id || typeof course_id !== "string" || !cohort_id || typeof cohort_id !== "string" || !pricing_option_id || typeof pricing_option_id !== "string") {
      return NextResponse.json(
        { error: "MISSING_COURSE_PARAMS", message: "course_id, cohort_id, and pricing_option_id are required" },
        { status: 400 }
      );
    }

    // Защита от передачи запрещенных клиентских параметров
    if (body.amount !== undefined || body.price !== undefined || body.chat_id !== undefined || body.destination !== undefined || body.bot_token !== undefined || body.active_application_key !== undefined) {
      // Клиентские финансовые параметры и дестинации категорически игнорируются
    }

    // 4. Формирование канонического payload для отправки на российский сервер
    let forwardPayload: Record<string, unknown>;

    if (payer_type === "individual") {
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const rawPhone = body.phone;
      const phone = rawPhone && String(rawPhone).trim() ? String(rawPhone).trim() : null;

      if (!fullName || fullName.split(/\s+/).length < 2) {
        return NextResponse.json(
          { error: "INVALID_FULL_NAME", message: "Full name must contain at least 2 words" },
          { status: 400 }
        );
      }

      if (!email || !email.includes("@")) {
        return NextResponse.json(
          { error: "INVALID_EMAIL", message: "Valid email is required" },
          { status: 400 }
        );
      }

      forwardPayload = {
        user_id: verifiedUserId,
        username: verifiedUser.username || null,
        first_name: verifiedUser.first_name || null,
        last_name: verifiedUser.last_name || null,
        payer_type: "individual",
        course_id: String(course_id).trim(),
        cohort_id: String(cohort_id).trim(),
        pricing_option_id: String(pricing_option_id).trim(),
        full_name: fullName,
        email: email,
        phone: phone,
      };
    } else {
      const inn = typeof body.inn === "string" ? body.inn.trim() : "";
      const companyName = typeof body.company_name === "string" ? body.company_name.trim() : "";
      const bik = typeof body.bik === "string" ? body.bik.trim() : "";
      const account = typeof body.account === "string" ? body.account.trim() : "";
      const docEmail = typeof body.doc_email === "string" ? body.doc_email.trim() : "";
      const edoType = typeof body.edo_type === "string" ? body.edo_type.trim() : "";
      const contactPerson = typeof body.contact_person === "string" ? body.contact_person.trim() : "";
      const kpp = body.kpp && String(body.kpp).trim() ? String(body.kpp).trim() : null;
      const companyAddress = body.company_address && String(body.company_address).trim() ? String(body.company_address).trim() : null;

      if (inn.length !== 10 && inn.length !== 12) {
        return NextResponse.json(
          { error: "INVALID_INN", message: "INN must be 10 or 12 digits" },
          { status: 400 }
        );
      }

      if (!companyName || !bik || !account || !docEmail || !edoType || !contactPerson) {
        return NextResponse.json(
          { error: "MISSING_LEGAL_FIELDS", message: "All required legal entity fields must be provided" },
          { status: 400 }
        );
      }

      forwardPayload = {
        user_id: verifiedUserId,
        username: verifiedUser.username || null,
        first_name: verifiedUser.first_name || null,
        last_name: verifiedUser.last_name || null,
        payer_type: "legal_entity",
        course_id: String(course_id).trim(),
        cohort_id: String(cohort_id).trim(),
        pricing_option_id: String(pricing_option_id).trim(),
        inn: inn,
        company_name: companyName,
        bik: bik,
        account: account,
        doc_email: docEmail,
        edo_type: edoType,
        contact_person: contactPerson,
        kpp: kpp,
        company_address: companyAddress,
      };
    }

    // 5. Вычисление SHA-256 сырого сериализованного тела
    const forwardBodyJson = JSON.stringify(forwardPayload);
    const bodySha256 = crypto.createHash("sha256").update(forwardBodyJson).digest("hex");

    // 6. F-2 CORR1: Fail-closed on missing S2S secret. No hardcoded fallback.
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

    const canonicalString = `TIKHON-S2S-V1\nPOST\n/api/v1/applications\n${timestampMs}\n${nonceUuid}\n${bodySha256}`;
    const signature = crypto
      .createHmac("sha256", internalSecret)
      .update(canonicalString)
      .digest("hex");

    // 7. F-13 CORR1: HTTPS fail-closed. No fallback to http://127.0.0.1:8080.
    // TIKHON_RUSSIAN_SERVER_URL must be explicitly configured.
    // In production mode (NODE_ENV=production), scheme MUST be https:.
    const russianServerUrl = process.env.TIKHON_RUSSIAN_SERVER_URL;
    if (!russianServerUrl) {
      console.error(
        `[AUDIT] event=upstream_url_missing latency_ms=${Date.now() - startTime}`
      );
      return NextResponse.json(
        {
          status: "FAILED",
          error: "UPSTREAM_URL_NOT_CONFIGURED",
          message: "Сервер приема заявок не настроен.",
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
          message: "Небезопасная конфигурация сервера приема заявок.",
        },
        { status: 500 }
      );
    }

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(russianServerUrl, {
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
      // F-12 CORR1: Log bounded error code only, no raw network error details
      console.error(
        `[AUDIT] event=application_forward_network_error latency_ms=${Date.now() - startTime}`
      );
      return NextResponse.json(
        {
          status: "FAILED",
          error: "RUSSIAN_SERVER_UNREACHABLE",
          message: "Сервер приема заявок временно недоступен. Пожалуйста, повторите попытку позже.",
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
    // F-12 CORR1: Log only operational metadata — validated course_id only after canonical
    // validation on the upstream server. No raw request data.
    console.log(
      `[AUDIT] event=application_forward_complete status=${upstreamResponse.status} latency_ms=${latencyMs} app_id=${responseData.application_id || "none"}`
    );

    if (upstreamResponse.ok && responseData.status === "SUCCESS") {
      return NextResponse.json(
        {
          status: "SUCCESS",
          application_id: responseData.application_id,
          deliveries: responseData.deliveries,
          message:
            responseData.message ||
            "Для выполнения оплаты свяжитесь с куратором курса Алексеем Лебедевым @Lebedev_AST. Спасибо",
        },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        {
          status: responseData.status || "PARTIAL_OR_FAILED",
          application_id: responseData.application_id,
          deliveries: responseData.deliveries,
          error: responseData.error || "SUBMISSION_FAILED",
          message: responseData.message || "Не удалось завершить отправку заявки. Пожалуйста, повторите попытку.",
        },
        { status: upstreamResponse.status || 502 }
      );
    }
  } catch {
    console.error(`[AUDIT] event=application_unhandled_error latency_ms=${Date.now() - startTime}`);
    return NextResponse.json(
      { error: "INTERNAL_SERVER_ERROR", message: "Произошла непредвиденная ошибка при обработке заявки." },
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
