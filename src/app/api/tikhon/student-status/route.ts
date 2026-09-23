import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

/**
 * Вычисляет детерминированный криптографический subject_key для сопоставления
 * с приватной проекцией tikhon_private_entitlements.
 * Полностью идентичен формуле в Python chatbot/projection_service.py.
 */
export function deriveSubjectKey(secret: string, userId: number | string): string {
  const canonicalUserId = String(userId).trim();
  return crypto
    .createHmac("sha256", secret)
    .update(`telegram:${canonicalUserId}`)
    .digest("hex");
}

/**
 * Валидирует аутентичность Telegram WebApp initData по спецификации Telegram:
 * 1. secret_key = HMAC_SHA256("WebAppData", botToken)
 * 2. data_check_string = sorted key=value (excluding hash) separated by \n
 * 3. computed_hash = HMAC_SHA256(secret_key, data_check_string).hex()
 * 4. timingSafeEqual(computed_hash, hash)
 */
export function validateTelegramInitData(
  initDataStr: string,
  botToken: string
): { valid: boolean; error?: string; userId?: number; user?: any } {
  if (!initDataStr || typeof initDataStr !== "string") {
    return { valid: false, error: "MISSING_INIT_DATA" };
  }

  const params = new URLSearchParams(initDataStr);
  const hash = params.get("hash");
  if (!hash) {
    return { valid: false, error: "MISSING_HASH" };
  }
  params.delete("hash");

  const authDateStr = params.get("auth_date");
  if (!authDateStr || isNaN(Number(authDateStr))) {
    return { valid: false, error: "INVALID_AUTH_DATE" };
  }

  const authDate = Number(authDateStr);
  const now = Math.floor(Date.now() / 1000);

  // Допуск на опережение часов (clock skew) до 300 секунд
  if (authDate > now + 300) {
    return { valid: false, error: "FUTURE_AUTH_DATE" };
  }

  // Срок действия сессии: 7 дней (604800 секунд)
  if (now - authDate > 604800) {
    return { valid: false, error: "EXPIRED_INIT_DATA" };
  }

  // Формируем data_check_string
  const keys = Array.from(params.keys()).sort();
  const dataCheckString = keys
    .map((k) => `${k}=${params.get(k)}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  try {
    const hashBuf = Buffer.from(hash, "hex");
    const calcBuf = Buffer.from(computedHash, "hex");
    if (
      hashBuf.length !== calcBuf.length ||
      !crypto.timingSafeEqual(hashBuf, calcBuf)
    ) {
      return { valid: false, error: "HASH_MISMATCH" };
    }
  } catch {
    return { valid: false, error: "CRYPTO_VERIFICATION_FAILED" };
  }

  const userStr = params.get("user");
  if (!userStr) {
    return { valid: false, error: "MISSING_USER_PAYLOAD" };
  }

  try {
    const user = JSON.parse(userStr);
    if (!user || typeof user.id !== "number") {
      return { valid: false, error: "INVALID_USER_ID" };
    }
    return { valid: true, userId: user.id, user };
  } catch {
    return { valid: false, error: "MALFORMED_USER_JSON" };
  }
}

export async function GET(request: NextRequest) {
  const botToken =
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.BOT_TOKEN;

  const entitlementSecret = process.env.ENTITLEMENT_SUBJECT_SECRET;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!botToken) {
    return NextResponse.json(
      { error: "SERVER_CONFIGURATION_ERROR", message: "Telegram bot token not configured" },
      { status: 500 }
    );
  }

  if (!entitlementSecret) {
    return NextResponse.json(
      { error: "SERVER_CONFIGURATION_ERROR", message: "Entitlement secret not configured" },
      { status: 500 }
    );
  }

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "SERVER_CONFIGURATION_ERROR", message: "Supabase not configured" },
      { status: 500 }
    );
  }

  // Получаем initData из заголовка или query-параметра
  const initDataHeader = request.headers.get("x-telegram-init-data");
  const initDataParam = request.nextUrl.searchParams.get("initData");
  const initData = initDataHeader || initDataParam;

  if (!initData) {
    return NextResponse.json(
      {
        is_authenticated: false,
        error: "UNAUTHORIZED_NO_INIT_DATA",
        message: "Telegram initData required",
      },
      { status: 401 }
    );
  }

  const validation = validateTelegramInitData(initData, botToken);
  if (!validation.valid || !validation.userId) {
    return NextResponse.json(
      {
        is_authenticated: false,
        error: validation.error || "UNAUTHORIZED_INIT_DATA",
        message: "Invalid Telegram authentication signature",
      },
      { status: 401 }
    );
  }

  const userId = validation.userId;
  const subjectKey = deriveSubjectKey(entitlementSecret, userId);

  try {
    const endpoint = `${supabaseUrl.replace(
      /\/$/,
      ""
    )}/rest/v1/tikhon_private_entitlements?subject_key=eq.${subjectKey}&select=course_id,paid_options,legacy_history_unverified`;

    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        {
          is_authenticated: true,
          error: "SUPABASE_QUERY_FAILED",
          status: res.status,
          message: errText,
        },
        { status: 502 }
      );
    }

    const rows: Array<{
      course_id: string;
      paid_options: string[];
      legacy_history_unverified: boolean;
    }> = await res.json();

    const coursesMap: Record<
      string,
      {
        paid_options: string[];
        legacy_history_unverified: boolean;
      }
    > = {};

    for (const row of rows) {
      coursesMap[row.course_id] = {
        paid_options: Array.isArray(row.paid_options) ? row.paid_options : [],
        legacy_history_unverified: Boolean(row.legacy_history_unverified),
      };
    }

    return NextResponse.json(
      {
        is_authenticated: true,
        courses: coursesMap,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        is_authenticated: true,
        error: "INTERNAL_ERROR",
        message: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
