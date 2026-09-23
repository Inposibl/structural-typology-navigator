import { test, describe } from "node:test";
import assert from "node:assert";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// Load .env.local if present so route handler has access to Supabase configuration under npm test
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  const envText = fs.readFileSync(envLocalPath, "utf-8");
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

import { NextRequest } from "next/server";
import {
  deriveSubjectKey,
  validateTelegramInitData,
  GET as studentStatusHandler,
} from "../../src/app/api/tikhon/student-status/route";
import {
  extractCadence,
  getOptionEligibility,
  Course,
  ApiResponse,
} from "../../src/app/tikhon-miniapp-pilot/helpers";

const SYNTHETIC_BOT_TOKEN = "123456789:AA_SYNTHETIC_TEST_TOKEN_000000000";
const SYNTHETIC_ENTITLEMENT_SECRET = "test_synthetic_secret_0123456789abcdef0123456789abcdef";

function createValidInitData(userId: number, botToken: string, options: { authDate?: number; extra?: Record<string, string> } = {}): string {
  const authDate = options.authDate ?? Math.floor(Date.now() / 1000);
  const userJson = JSON.stringify({ id: userId, first_name: "TestUser", username: "testuser" });
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAHdK...",
    user: userJson,
    ...(options.extra || {}),
  });

  const keys = Array.from(params.keys()).sort();
  const dataCheckString = keys.map((k) => `${k}=${params.get(k)}`).join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.append("hash", hash);

  return params.toString();
}

describe("TIKHON-MINIAPP BATCH 1 CORR1: Commercial, Progression & Private Entitlements", () => {
  // -------------------------------------------------------------------------
  // 1. Telegram WebApp HMAC Authentication & Subject Key Derivation
  // -------------------------------------------------------------------------
  test("Auth 1: Valid initData passes HMAC validation and extracts user id", () => {
    const initData = createValidInitData(8807727029, SYNTHETIC_BOT_TOKEN);
    const result = validateTelegramInitData(initData, SYNTHETIC_BOT_TOKEN);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.userId, 8807727029);
  });

  test("Auth 2: Tampered initData is rejected with HASH_MISMATCH", () => {
    const initData = createValidInitData(8807727029, SYNTHETIC_BOT_TOKEN);
    const tampered = initData.replace("TestUser", "Hacker");
    const result = validateTelegramInitData(tampered, SYNTHETIC_BOT_TOKEN);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, "HASH_MISMATCH");
  });

  test("Auth 3: Expired initData (> 7 days) is rejected", () => {
    const expiredDate = Math.floor(Date.now() / 1000) - 700000;
    const initData = createValidInitData(8807727029, SYNTHETIC_BOT_TOKEN, { authDate: expiredDate });
    const result = validateTelegramInitData(initData, SYNTHETIC_BOT_TOKEN);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, "EXPIRED_INIT_DATA");
  });

  test("Auth 4: Future initData (> 300s clock skew) is rejected", () => {
    const futureDate = Math.floor(Date.now() / 1000) + 1000;
    const initData = createValidInitData(8807727029, SYNTHETIC_BOT_TOKEN, { authDate: futureDate });
    const result = validateTelegramInitData(initData, SYNTHETIC_BOT_TOKEN);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, "FUTURE_AUTH_DATE");
  });

  test("Auth 5: Missing hash is rejected", () => {
    const result = validateTelegramInitData("user=%7B%22id%22%3A123%7D&auth_date=123", SYNTHETIC_BOT_TOKEN);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, "MISSING_HASH");
  });

  test("Auth 6: Subject key derivation matches canonical Python HMAC bit-for-bit on synthetic vectors", () => {
    const sk8807727029 = deriveSubjectKey(SYNTHETIC_ENTITLEMENT_SECRET, 8807727029);
    assert.strictEqual(
      sk8807727029,
      "1f752705fe4e131e39001cb5d5d1d2e836217246164ccecaa2535e0fb799604e",
      "Subject key for 8807727029 must match exact Python projection output"
    );

    const skMock1 = deriveSubjectKey(SYNTHETIC_ENTITLEMENT_SECRET, 500000001);
    assert.strictEqual(
      skMock1,
      "35e102a41a82e08885d65ff201940116df1f574e9ac20803d4f3e0e47d451e8e",
      "Subject key for 500000001 must match exact Python projection output"
    );

    assert.notStrictEqual(sk8807727029, skMock1);
  });

  // -------------------------------------------------------------------------
  // 2. Staged Payment Progression Matrix
  // -------------------------------------------------------------------------
  test("Progression 1: Legacy Cohort 5 student is fail-closed with unverified warning", () => {
    const legacyStatus = {
      paid_options: [],
      legacy_history_unverified: true,
    };

    const l1 = getOptionEligibility("structural_typology", "level_1", legacyStatus);
    assert.strictEqual(l1.state, "LOCKED");
    assert.ok(l1.lockReason?.includes("требуется подтверждение истории предыдущих оплат"));

    const l2 = getOptionEligibility("structural_typology", "level_2", legacyStatus);
    assert.strictEqual(l2.state, "LOCKED");

    const l3 = getOptionEligibility("structural_typology", "level_3", legacyStatus);
    assert.strictEqual(l3.state, "LOCKED");

    const full = getOptionEligibility("structural_typology", "full_prepayment", legacyStatus);
    assert.strictEqual(full.state, "LOCKED");
  });

  test("Progression 2: New prospective student starts at Level 1 or Full Prepayment", () => {
    const newStatus = {
      paid_options: [],
      legacy_history_unverified: false,
    };

    const full = getOptionEligibility("structural_typology", "full_prepayment", newStatus);
    assert.strictEqual(full.state, "ELIGIBLE");

    const l1 = getOptionEligibility("structural_typology", "level_1", newStatus);
    assert.strictEqual(l1.state, "ELIGIBLE");

    const l2 = getOptionEligibility("structural_typology", "level_2", newStatus);
    assert.strictEqual(l2.state, "LOCKED");
    assert.strictEqual(l2.lockReason, "Доступно после оплаты 1-го уровня");

    const l3 = getOptionEligibility("structural_typology", "level_3", newStatus);
    assert.strictEqual(l3.state, "LOCKED");
    assert.strictEqual(l3.lockReason, "Доступно после оплаты 2-го уровня");
  });

  test("Progression 3: Student with paid Level 1 unlocks Level 2 and locks Full Prepayment", () => {
    const statusL1 = {
      paid_options: ["level_1"],
      legacy_history_unverified: false,
    };

    const l1 = getOptionEligibility("structural_typology", "level_1", statusL1);
    assert.strictEqual(l1.state, "PAID");

    const l2 = getOptionEligibility("structural_typology", "level_2", statusL1);
    assert.strictEqual(l2.state, "ELIGIBLE");

    const l3 = getOptionEligibility("structural_typology", "level_3", statusL1);
    assert.strictEqual(l3.state, "LOCKED");
    assert.strictEqual(l3.lockReason, "Доступно после оплаты 2-го уровня");

    const full = getOptionEligibility("structural_typology", "full_prepayment", statusL1);
    assert.strictEqual(full.state, "DISABLED_STARTED_STAGED");
    assert.strictEqual(full.lockReason, "Недоступно: начата поэтапная оплата по уровням");
  });

  test("Progression 4: Student with paid Level 1 + Level 2 unlocks Level 3", () => {
    const statusL12 = {
      paid_options: ["level_1", "level_2"],
      legacy_history_unverified: false,
    };

    const l1 = getOptionEligibility("structural_typology", "level_1", statusL12);
    assert.strictEqual(l1.state, "PAID");

    const l2 = getOptionEligibility("structural_typology", "level_2", statusL12);
    assert.strictEqual(l2.state, "PAID");

    const l3 = getOptionEligibility("structural_typology", "level_3", statusL12);
    assert.strictEqual(l3.state, "ELIGIBLE");

    const full = getOptionEligibility("structural_typology", "full_prepayment", statusL12);
    assert.strictEqual(full.state, "DISABLED_STARTED_STAGED");
  });

  test("Progression 5: Student with full prepayment marks all levels PAID", () => {
    const statusFull = {
      paid_options: ["full_prepayment"],
      legacy_history_unverified: false,
    };

    const full = getOptionEligibility("structural_typology", "full_prepayment", statusFull);
    assert.strictEqual(full.state, "PAID");

    const l1 = getOptionEligibility("structural_typology", "level_1", statusFull);
    assert.strictEqual(l1.state, "PAID");

    const l2 = getOptionEligibility("structural_typology", "level_2", statusFull);
    assert.strictEqual(l2.state, "PAID");

    const l3 = getOptionEligibility("structural_typology", "level_3", statusFull);
    assert.strictEqual(l3.state, "PAID");
  });

  test("Reconciliation 1: Cancelled application is excluded from paid_options", () => {
    const statusWithCancellation = {
      paid_options: ["level_1"],
      legacy_history_unverified: false,
    };
    const l1 = getOptionEligibility("structural_typology", "level_1", statusWithCancellation);
    assert.strictEqual(l1.state, "PAID");
    const l2 = getOptionEligibility("structural_typology", "level_2", statusWithCancellation);
    assert.strictEqual(l2.state, "ELIGIBLE");
  });

  test("Reconciliation 2: Multi-level reduction - user paid L1 + L2, L2 canceled leaves only L1", () => {
    const statusBefore = {
      paid_options: ["level_1", "level_2"],
      legacy_history_unverified: false,
    };
    assert.strictEqual(getOptionEligibility("structural_typology", "level_2", statusBefore).state, "PAID");
    assert.strictEqual(getOptionEligibility("structural_typology", "level_3", statusBefore).state, "ELIGIBLE");

    const statusAfter = {
      paid_options: ["level_1"],
      legacy_history_unverified: false,
    };
    assert.strictEqual(getOptionEligibility("structural_typology", "level_1", statusAfter).state, "PAID");
    assert.strictEqual(getOptionEligibility("structural_typology", "level_2", statusAfter).state, "ELIGIBLE");
    assert.strictEqual(getOptionEligibility("structural_typology", "level_3", statusAfter).state, "LOCKED");
  });

  test("Reconciliation 3: Zero entitlements - all applications canceled/empty", () => {
    const statusEmpty = {
      paid_options: [],
      legacy_history_unverified: false,
    };
    assert.strictEqual(getOptionEligibility("structural_typology", "level_1", statusEmpty).state, "ELIGIBLE");
    assert.strictEqual(getOptionEligibility("structural_typology", "level_2", statusEmpty).state, "LOCKED");
    assert.strictEqual(getOptionEligibility("structural_typology", "level_3", statusEmpty).state, "LOCKED");
    assert.strictEqual(getOptionEligibility("structural_typology", "full_prepayment", statusEmpty).state, "ELIGIBLE");
  });

  // -------------------------------------------------------------------------
  // 3. Cadence Cleanup: Zero Manufactured Fallback
  // -------------------------------------------------------------------------
  test("Cadence 1: Real schedule phrases are formatted cleanly", () => {
    assert.strictEqual(extractCadence("4 онлайн-встречи в Zoom по 2 часа · 2 раза в неделю"), "Zoom · 2 раза в неделю");
    assert.strictEqual(extractCadence("25 онлайн-встреч в Zoom по 2 часа · 1 раз в неделю (вс)"), "Zoom · 1 раз в неделю");
  });

  test("Cadence 2: Unmatched or empty format returns empty string without manufactured fallback", () => {
    assert.strictEqual(extractCadence(""), "");
    assert.strictEqual(extractCadence("Онлайн-формат без указания дней"), "");
    assert.notStrictEqual(extractCadence(""), "Zoom · Онлайн");
  });

  // -------------------------------------------------------------------------
  // 4. Source Text Verification: Zero "невозвратный" and Public Offer Wiring
  // -------------------------------------------------------------------------
  test("Text 1: Zero instances of 'невозвратный' in live pilot frontend and backend files", () => {
    const pageSrc = fs.readFileSync(path.resolve("src/app/tikhon-miniapp-pilot/page.tsx"), "utf-8");
    assert.ok(!pageSrc.includes("невозвратный"), "page.tsx must contain 0 occurrences of 'невозвратный'");

    const helpersSrc = fs.readFileSync(path.resolve("src/app/tikhon-miniapp-pilot/helpers.ts"), "utf-8");
    assert.ok(!helpersSrc.includes("невозвратный"), "helpers.ts must contain 0 occurrences of 'невозвратный'");

    const cssSrc = fs.readFileSync(path.resolve("src/app/tikhon-miniapp-pilot/miniapp.module.css"), "utf-8");
    assert.ok(!cssSrc.includes("невозвратный"), "miniapp.module.css must contain 0 occurrences of 'невозвратный'");
  });

  test("Text 2: Public Offer link and copy is bound in page.tsx", () => {
    const pageSrc = fs.readFileSync(path.resolve("src/app/tikhon-miniapp-pilot/page.tsx"), "utf-8");
    assert.ok(pageSrc.includes("Условия оплаты и возврата указаны в"), "Must include canonical offer phrasing");
    assert.ok(pageSrc.includes('href="/offer"'), "Must link to /offer");
  });

  test("Routing 1: next.config.ts rewrites /offer to /offer.html", () => {
    const nextCfgSrc = fs.readFileSync(path.resolve("next.config.ts"), "utf-8");
    assert.ok(nextCfgSrc.includes('source: "/offer"'), "Must rewrite source /offer");
    assert.ok(nextCfgSrc.includes('destination: "/offer.html"'), "Must rewrite destination /offer.html");
  });

  test("Routing 2: public/offer.html exists and is valid HTML", () => {
    const offerHtml = fs.readFileSync(path.resolve("public/offer.html"), "utf-8");
    assert.ok(offerHtml.includes("<!DOCTYPE html>"), "offer.html must be valid HTML");
    assert.ok(offerHtml.includes("Публичная оферта") || offerHtml.includes("договор-оферта"), "offer.html must contain offer copy");
  });

  // -------------------------------------------------------------------------
  // 5. Live Supabase End-to-End API Integration
  // -------------------------------------------------------------------------
  test("Live 1: GET /api/tikhon/student-status for legacy user 8807727029 returns unverified status", async () => {
    const liveBotToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    const liveEntitlementSecret = process.env.ENTITLEMENT_SUBJECT_SECRET;
    assert.ok(liveBotToken, "TELEGRAM_BOT_TOKEN must be in environment");
    assert.ok(liveEntitlementSecret, "ENTITLEMENT_SUBJECT_SECRET must be in environment");

    const initData = createValidInitData(8807727029, liveBotToken);
    const req = new NextRequest("http://localhost:3000/api/tikhon/student-status", {
      headers: { "x-telegram-init-data": initData },
    });

    const res = await studentStatusHandler(req);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.is_authenticated, true);
    assert.strictEqual(json.user_id, undefined, "user_id must NOT be exposed in response");
    assert.strictEqual(json.subject_key, undefined, "subject_key must NOT be exposed in response");
    assert.ok(json.courses?.structural_typology, "Must contain structural_typology entitlement record");
    assert.strictEqual(json.courses.structural_typology.legacy_history_unverified, true);
    assert.deepStrictEqual(json.courses.structural_typology.paid_options, []);
  });

  test("Live 2: GET /api/tikhon/courses contains canonical URLs, cadence and 160k prepayment", async () => {
    const supabaseUrl = process.env.SUPABASE_URL || "https://mgtghkxebccahtqqyyjv.supabase.co";
    const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.ok(supabaseKey, "SUPABASE_SECRET_KEY must be in environment");

    const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/tikhon_public_projection?id=eq.current&select=courses`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    assert.strictEqual(res.status, 200);
    const rows = await res.json();
    assert.strictEqual(rows.length, 1);
    const courses: Course[] = rows[0].courses;
    assert.strictEqual(courses.length, 5);

    const st = courses.find((c) => c.id === "structural_typology");
    assert.ok(st, "structural_typology must exist");
    assert.strictEqual(st.course_page_url, "https://structural-typology.academy/courses/structural-typology");
    assert.strictEqual(st.cadence, "1 раз в неделю (вс)");

    const fullPrepay = st.pricing_options.find((po) => po.id === "full_prepayment");
    assert.ok(fullPrepay, "full_prepayment option must exist");
    assert.strictEqual(fullPrepay.price, 160000, "Price must be 160 000 ₽");
    assert.strictEqual(fullPrepay.base_price, 200000, "Base price must be 200 000 ₽");
    assert.strictEqual(fullPrepay.discount_percent, 20, "Discount must be 20%");

    const l1 = st.pricing_options.find((po) => po.id === "level_1");
    const l2 = st.pricing_options.find((po) => po.id === "level_2");
    const l3 = st.pricing_options.find((po) => po.id === "level_3");
    assert.strictEqual(l1?.price, 50000);
    assert.strictEqual(l2?.price, 100000);
    assert.strictEqual(l3?.price, 50000);
    assert.strictEqual((l1!.price + l2!.price + l3!.price), 200000);

    for (const c of courses) {
      assert.ok(c.course_page_url?.startsWith("https://structural-typology.academy/courses/"), `${c.id} must have canonical course page URL`);
      for (const po of c.pricing_options) {
        assert.ok(!po.description.includes("невозвратный"), `Option ${po.id} must not mention невозвратный`);
      }
    }
  });
});
