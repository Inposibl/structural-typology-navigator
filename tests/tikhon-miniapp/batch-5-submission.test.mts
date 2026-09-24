import test, { describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { POST, GET } from "../../src/app/api/tikhon/submit-application/route.ts";
import {
  SUCCESS_COPY_VERBATIM,
  CANONICAL_CURATOR_USERNAME,
  CANONICAL_CURATOR_TG_LINK,
  IndividualEnrollmentDraft,
} from "../../src/app/tikhon-miniapp-pilot/helpers.ts";
import { submitTikhonApplication } from "../../src/app/tikhon-miniapp-pilot/submission.ts";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY_LEGAL_ENTITY_FORM } from "../../src/app/tikhon-miniapp-pilot/legal-entity-helpers.ts";
import type { LegalEntityFlowProps } from "../../src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx";

// CORR2 #47: register a hooks stub for CSS module imports so the behavioral render
// test can import the real legal-entity-flow.tsx component under node:test (no DOM,
// no bundler). The stub must be registered before the dynamic import in 11.4.
const corr2LoaderSource = `const STUB_SOURCE = "const stub = new Proxy({}, { get: () => 'corr2-css-stub' });\\nexport default stub;";
export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return { url: "corr2-css-stub:" + encodeURIComponent(specifier), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export function load(url, context, nextLoad) {
  if (url.startsWith("corr2-css-stub:")) {
    return { format: "module", source: STUB_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;
const corr2LoaderDir = fs.mkdtempSync(path.join(os.tmpdir(), "corr2-css-loader-"));
const corr2LoaderFile = path.join(corr2LoaderDir, "css-stub-loader.mjs");
fs.writeFileSync(corr2LoaderFile, corr2LoaderSource);
register(pathToFileURL(corr2LoaderFile));

const BOT_TOKEN = "8682116994:TEST_BOT_TOKEN_FOR_BATCH_5_TESTS";

function createValidInitData(userId: number, botToken: string, userExtra: Record<string, unknown> = {}): string {
  const authDate = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({
    id: userId,
    first_name: "TestUser",
    username: "test_pilot",
    ...userExtra,
  });

  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAG_test_query_id");
  params.set("user", user);

  const sortedPairs: string[] = [];
  Array.from(params.keys())
    .sort()
    .forEach((key) => {
      sortedPairs.push(`${key}=${params.get(key)}`);
    });
  const dataCheckString = sortedPairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  params.set("hash", hash);
  return params.toString();
}

describe("TIKHON-MINIAPP BATCH 5: Application Submission & Dual Handoff", () => {
  // Set test bot tokens so that validateTelegramInitData uses BOT_TOKEN consistently
  process.env.BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;

  const pagePath = path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/page.tsx");
  const flowPath = path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx");
  const helpersPath = path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/helpers.ts");
  const screenPath = path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/submission-screen.tsx");
  const routePath = path.resolve(process.cwd(), "src/app/api/tikhon/submit-application/route.ts");

  const pageSource = fs.readFileSync(pagePath, "utf-8");
  const flowSource = fs.readFileSync(flowPath, "utf-8");
  const helpersSource = fs.readFileSync(helpersPath, "utf-8");
  const screenSource = fs.readFileSync(screenPath, "utf-8");
  const getRouteSource = () => fs.readFileSync(routePath, "utf-8");

  /* ---------------- 1. VERBATIM COPY & CURATOR IDENTITY ---------------- */

  test("1.1: Success copy verbatim matches exact Owner mandate", () => {
    assert.strictEqual(
      SUCCESS_COPY_VERBATIM,
      "Для выполнения оплаты свяжитесь с куратором курса Алексеем Лебедевым @Lebedev_AST. Спасибо",
      "SUCCESS_COPY_VERBATIM must match exact Owner wording"
    );
  });

  test("1.2: Curator username is Lebedev_AST and link is https://t.me/Lebedev_AST", () => {
    assert.strictEqual(CANONICAL_CURATOR_USERNAME, "Lebedev_AST");
    assert.strictEqual(CANONICAL_CURATOR_TG_LINK, "https://t.me/Lebedev_AST");
  });

  test("1.3: Zero references to obsolete @AST_lebedev across pilot sources", () => {
    for (const [name, src] of [
      ["page.tsx", pageSource],
      ["legal-entity-flow.tsx", flowSource],
      ["helpers.ts", helpersSource],
      ["submission-screen.tsx", screenSource],
      ["route.ts", getRouteSource()],
    ]) {
      assert.ok(
        !src.includes("AST_lebedev") && !src.includes("@AST_lebedev"),
        `File ${name} must not contain obsolete @AST_lebedev`
      );
    }
  });

  /* ---------------- 2. S2S SUBMISSION ENDPOINT AUTH & VALIDATION ---------------- */

  test("2.1: S2S route rejects missing Telegram initData with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payer_type: "individual" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 401);
    const json = await res.json();
    assert.strictEqual(json.error, "UNAUTHORIZED_NO_INIT_DATA");
  });

  test("2.2: S2S route rejects tampered Telegram initData with 401", async () => {
    process.env.BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const valid = createValidInitData(8807727029, BOT_TOKEN);
    const tampered = valid.replace("TestUser", "HackedUser");

    const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": tampered,
      },
      body: JSON.stringify({ payer_type: "individual" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 401);
    const json = await res.json();
    assert.strictEqual(json.error, "UNAUTHORIZED_INVALID_INIT_DATA");
  });

  test("2.3: S2S route rejects invalid payer type with 400", async () => {
    process.env.BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const initData = createValidInitData(8807727029, BOT_TOKEN);

    const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": initData,
      },
      body: JSON.stringify({
        payer_type: "crypto_currency",
        course_id: "structural_typology",
        cohort_id: "cohort_5",
        pricing_option_id: "level_1",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.strictEqual(json.error, "INVALID_PAYER_TYPE");
  });

  test("2.4: S2S route rejects missing course parameters with 400", async () => {
    process.env.BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const initData = createValidInitData(8807727029, BOT_TOKEN);

    const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": initData,
      },
      body: JSON.stringify({
        payer_type: "individual",
        course_id: "structural_typology",
        // cohort_id missing
        pricing_option_id: "level_1",
        full_name: "Иван Иванов",
        email: "ivan@example.com",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.strictEqual(json.error, "MISSING_COURSE_PARAMS");
  });

  test("2.5: S2S route rejects malformed individual full name (< 2 words) with 400", async () => {
    process.env.BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const initData = createValidInitData(8807727029, BOT_TOKEN);

    const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": initData,
      },
      body: JSON.stringify({
        payer_type: "individual",
        course_id: "structural_typology",
        cohort_id: "cohort_5",
        pricing_option_id: "level_1",
        full_name: "Однофамилец",
        email: "ivan@example.com",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.strictEqual(json.error, "INVALID_FULL_NAME");
  });

  test("2.6: S2S route rejects malformed email with 400", async () => {
    process.env.BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const initData = createValidInitData(8807727029, BOT_TOKEN);

    const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": initData,
      },
      body: JSON.stringify({
        payer_type: "individual",
        course_id: "structural_typology",
        cohort_id: "cohort_5",
        pricing_option_id: "level_1",
        full_name: "Иван Иванов",
        email: "invalid-email-no-at",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.strictEqual(json.error, "INVALID_EMAIL");
  });

  test("2.7: S2S route rejects invalid INN (< 10 or 11 digits) with 400", async () => {
    process.env.BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const initData = createValidInitData(8807727029, BOT_TOKEN);

    const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": initData,
      },
      body: JSON.stringify({
        payer_type: "legal_entity",
        course_id: "structural_typology",
        cohort_id: "cohort_5",
        pricing_option_id: "level_1",
        inn: "123456789", // 9 digits
        company_name: "ООО Тест",
        bik: "044525974",
        account: "40802810100003037685",
        doc_email: "buh@test.ru",
        edo_type: "Диадок",
        contact_person: "Петров",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.strictEqual(json.error, "INVALID_INN");
  });

  test("2.8: S2S route rejects missing required legal entity fields with 400", async () => {
    process.env.BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const initData = createValidInitData(8807727029, BOT_TOKEN);

    const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": initData,
      },
      body: JSON.stringify({
        payer_type: "legal_entity",
        course_id: "structural_typology",
        cohort_id: "cohort_5",
        pricing_option_id: "level_1",
        inn: "7814519993",
        company_name: "ООО Тест",
        // bik missing
        account: "40802810100003037685",
        doc_email: "buh@test.ru",
        edo_type: "Диадок",
        contact_person: "Петров",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.strictEqual(json.error, "MISSING_LEGAL_FIELDS");
  });

  test("2.9: S2S route rejects GET method with 405", async () => {
    const res = await GET();
    assert.strictEqual(res.status, 405);
    const json = await res.json();
    assert.strictEqual(json.error, "METHOD_NOT_ALLOWED");
  });

  /* ---------------- 3. S2S PROTOCOL & HMAC SIGNING CONTRACT ---------------- */

  test("3.1: Protocol identifier is strictly TIKHON-S2S-V1", () => {
    assert.ok(getRouteSource().includes("TIKHON-S2S-V1"), "Protocol version must be TIKHON-S2S-V1");
  });

  test("3.2: Canonical signing string follows exact spec: version\\nmethod\\npath\\nts\\nnonce\\nsha256", () => {
    assert.ok(
      getRouteSource().includes("`TIKHON-S2S-V1\\nPOST\\n/api/v1/applications\\n${timestampMs}\\n${nonceUuid}\\n${bodySha256}`"),
      "Canonical signing string must match exact specification"
    );
  });

  test("3.3: Headers strictly set X-Tikhon-Timestamp, X-Tikhon-Nonce, X-Tikhon-Signature", () => {
    assert.ok(getRouteSource().includes('"X-Tikhon-Timestamp": timestampMs'));
    assert.ok(getRouteSource().includes('"X-Tikhon-Nonce": nonceUuid'));
    assert.ok(getRouteSource().includes('"X-Tikhon-Signature": signature'));
  });

  test("3.4: Server commercial authority: client financial parameters are ignored", () => {
    assert.ok(
      getRouteSource().includes("body.amount") &&
      getRouteSource().includes("body.price") &&
      getRouteSource().includes("body.chat_id"),
      "route.ts must guard against client-supplied commercial parameters"
    );
    // Forward payload must NOT include amount, price, or chat_id from body
    assert.ok(!getRouteSource().includes("amount: body.amount"));
    assert.ok(!getRouteSource().includes("price: body.price"));
    assert.ok(!getRouteSource().includes("chat_id: body.chat_id"));
  });

  /* ---------------- 4. CLIENT SUBMISSION HELPER ---------------- */

  test("4.1: submitTikhonApplication rejects call without Telegram auth", async () => {
    const draft: IndividualEnrollmentDraft = {
      course_id: "structural_typology",
      cohort_id: "cohort_5",
      pricing_option_id: "level_1",
      payer_type: "individual",
      full_name: "Иван Иванов",
      phone: "+79991234567",
      email: "ivan@example.com",
    };

    const res = await submitTikhonApplication(draft, "individual", "");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, "MISSING_TELEGRAM_AUTH");
  });

  /* ---------------- 5. UI SCREEN TRANSITIONS & COMPONENTS ---------------- */

  test("5.1: MiniAppScreen includes submission_result", () => {
    assert.ok(
      helpersSource.includes('"submission_result"'),
      "MiniAppScreen must include 'submission_result'"
    );
  });

  test("5.2: SubmissionResultScreen renders in page.tsx for submission_result", () => {
    assert.ok(
      pageSource.includes('screen === "submission_result"'),
      "page.tsx must branch on screen === 'submission_result'"
    );
    assert.ok(
      pageSource.includes("<SubmissionResultScreen"),
      "page.tsx must render <SubmissionResultScreen"
    );
  });

  test("5.3: individual_confirmation CTA triggers submission and advances screen", () => {
    const confirmIdx = pageSource.indexOf('screen === "individual_confirmation" ? (');
    const nextIdx = pageSource.indexOf('screen === "individual_next_stage" ? (');
    const confirmSection = pageSource.slice(confirmIdx, nextIdx);

    assert.ok(
      confirmSection.includes("handleExecuteSubmission"),
      "individual_confirmation CTA must call handleExecuteSubmission"
    );
    assert.ok(
      confirmSection.includes("Оформить заявку"),
      "individual_confirmation CTA must be labeled 'Оформить заявку'"
    );
  });

  test("5.4: legal_entity_confirmation CTA triggers submission via onSubmitApplication", () => {
    assert.ok(
      flowSource.includes("onSubmitApplication"),
      "legal-entity-flow.tsx must support onSubmitApplication prop"
    );
    assert.ok(
      flowSource.includes("Оформить заявку"),
      "legal_entity_confirmation CTA must be labeled 'Оформить заявку'"
    );
  });

  test("5.5: SubmissionResultScreen displays SUCCESS_COPY_VERBATIM on success", () => {
    assert.ok(
      screenSource.includes("{SUCCESS_COPY_VERBATIM}"),
      "SubmissionResultScreen must bind SUCCESS_COPY_VERBATIM"
    );
    assert.ok(
      screenSource.includes("Связаться с куратором (@Lebedev_AST)"),
      "SubmissionResultScreen must contain curator CTA button"
    );
    assert.ok(
      screenSource.includes("CANONICAL_CURATOR_TG_LINK"),
      "SubmissionResultScreen must bind CANONICAL_CURATOR_TG_LINK"
    );
  });

  test("5.6: SubmissionResultScreen displays loading spinner and error retry button", () => {
    assert.ok(screenSource.includes('submissionState === "submitting"'));
    assert.ok(screenSource.includes('submissionState === "error"'));
    assert.ok(screenSource.includes("Повторить попытку"));
    assert.ok(screenSource.includes("Вернуться к проверке данных"));
  });

  /* ---------------- 6. SECURITY, PRIVACY & PERSISTENCE SAFETY ---------------- */

  test("6.1: Zero PII persistence in browser storage across submission files", () => {
    for (const [name, src] of [
      ["submission.ts", fs.readFileSync(path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/submission.ts"), "utf-8")],
      ["submission-screen.tsx", screenSource],
      ["route.ts", getRouteSource()],
    ]) {
      for (const storage of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
        assert.ok(!src.includes(storage), `${name} must not use ${storage}`);
      }
    }
  });

  test("6.2: S2S route logs only operational metadata (PII absent from logs)", () => {
    // Only metadata: event, status, latency_ms, app_id
    assert.ok(getRouteSource().includes("[AUDIT]"));
    assert.ok(!getRouteSource().includes("console.log(forwardPayload"));
    assert.ok(!getRouteSource().includes("console.log(rawBody"));
    assert.ok(!getRouteSource().includes("console.log(body.email"));
    assert.ok(!getRouteSource().includes("console.log(body.full_name"));
    assert.ok(!getRouteSource().includes("console.log(body.inn"));
  });

  test("6.3: Zero DaData or Google dependencies introduced in submission files", () => {
    for (const [name, src] of [
      ["submission.ts", fs.readFileSync(path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/submission.ts"), "utf-8")],
      ["submission-screen.tsx", screenSource],
      ["route.ts", getRouteSource()],
    ]) {
      assert.ok(!src.toLowerCase().includes("dadata"), `${name} must not contain DaData references`);
      assert.ok(!src.toLowerCase().includes("sheets_sync"), `${name} must not contain sheets_sync`);
    }
  });

  /* ---------------- 7. F-2 CORR1: S2S SECRET FAIL-CLOSED ---------------- */

  test("7.1: F-2 — No hardcoded test_internal_secret_key_ast_2026 in route.ts", () => {
    assert.ok(
      !getRouteSource().includes("test_internal_secret_key_ast_2026"),
      "route.ts must not contain hardcoded test secret"
    );
  });

  test("7.2: F-2 — Missing TIKHON_INTERNAL_SECRET returns 500 SERVER_CONFIGURATION_ERROR", async () => {
    const savedSecret = process.env.TIKHON_INTERNAL_SECRET;
    try {
      process.env.BOT_TOKEN = BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
      delete process.env.TIKHON_INTERNAL_SECRET;

      const initData = createValidInitData(8807727029, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({
          payer_type: "individual",
          course_id: "structural_typology",
          cohort_id: "cohort_5",
          pricing_option_id: "level_1",
          full_name: "Иван Иванов",
          email: "ivan@example.com",
        }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 500);
      const json = await res.json();
      assert.strictEqual(json.error, "SERVER_CONFIGURATION_ERROR");
    } finally {
      if (savedSecret !== undefined) {
        process.env.TIKHON_INTERNAL_SECRET = savedSecret;
      }
    }
  });

  /* ---------------- 8. F-3 CORR1: BOT TOKEN FAIL-CLOSED ---------------- */

  test("8.1: F-3 — No PLACEHOLDER_BOT_TOKEN in route.ts", () => {
    assert.ok(
      !getRouteSource().includes("PLACEHOLDER_BOT_TOKEN"),
      "route.ts must not contain PLACEHOLDER_BOT_TOKEN"
    );
  });

  test("8.2: F-3 — Missing bot token returns 500 SERVER_CONFIGURATION_ERROR", async () => {
    try {
      delete process.env.BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_TOKEN;

      const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": "fake_init_data",
        },
        body: JSON.stringify({ payer_type: "individual" }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 500);
      const json = await res.json();
      assert.strictEqual(json.error, "SERVER_CONFIGURATION_ERROR");
    } finally {
      process.env.BOT_TOKEN = BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    }
  });

  test("8.3: F-3 — Forged placeholder-signed initData with no bot token -> rejected, zero forward", async () => {
    try {
      delete process.env.BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_TOKEN;

      // Create initData signed with PLACEHOLDER_BOT_TOKEN
      const forgedInitData = createValidInitData(8807727029, "PLACEHOLDER_BOT_TOKEN");
      const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": forgedInitData,
        },
        body: JSON.stringify({
          payer_type: "individual",
          course_id: "structural_typology",
          cohort_id: "cohort_5",
          pricing_option_id: "level_1",
          full_name: "Forged User",
          email: "forged@example.com",
        }),
      });
      const res = await POST(req);
      // Must be rejected (500 because no bot token configured)
      assert.strictEqual(res.status, 500);
      const json = await res.json();
      assert.strictEqual(json.error, "SERVER_CONFIGURATION_ERROR");
    } finally {
      process.env.BOT_TOKEN = BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    }
  });

  /* ---------------- 9. F-13 CORR1: HTTPS FAIL-CLOSED ---------------- */

  test("9.1: F-13 — No http://127.0.0.1:8080 fallback in route.ts", () => {
    assert.ok(
      !getRouteSource().includes('|| "http://127.0.0.1:8080'),
      "route.ts must not have http://127.0.0.1:8080 fallback"
    );
  });

  test("9.2: F-13 — Missing TIKHON_RUSSIAN_SERVER_URL -> 500 UPSTREAM_URL_NOT_CONFIGURED", async () => {
    const savedUrl = process.env.TIKHON_RUSSIAN_SERVER_URL;
    const savedSecret = process.env.TIKHON_INTERNAL_SECRET;
    try {
      process.env.BOT_TOKEN = BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
      process.env.TIKHON_INTERNAL_SECRET = "test_secret_f13";
      delete process.env.TIKHON_RUSSIAN_SERVER_URL;

      const initData = createValidInitData(8807727029, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({
          payer_type: "individual",
          course_id: "structural_typology",
          cohort_id: "cohort_5",
          pricing_option_id: "level_1",
          full_name: "Иван Иванов",
          email: "ivan_f13@example.com",
        }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 500);
      const json = await res.json();
      assert.strictEqual(json.error, "UPSTREAM_URL_NOT_CONFIGURED");
    } finally {
      if (savedUrl !== undefined) process.env.TIKHON_RUSSIAN_SERVER_URL = savedUrl;
      if (savedSecret !== undefined) process.env.TIKHON_INTERNAL_SECRET = savedSecret;
    }
  });

  test("9.3: F-13 — http upstream in production mode -> 500 UPSTREAM_URL_NOT_HTTPS", async () => {
    const savedUrl = process.env.TIKHON_RUSSIAN_SERVER_URL;
    const savedSecret = process.env.TIKHON_INTERNAL_SECRET;
    const savedEnv = process.env.NODE_ENV;
    try {
      process.env.BOT_TOKEN = BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
      process.env.TIKHON_INTERNAL_SECRET = "test_secret_f13_https";
      process.env.TIKHON_RUSSIAN_SERVER_URL = "http://insecure.example.com/api";
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";

      const initData = createValidInitData(8807727029, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({
          payer_type: "individual",
          course_id: "structural_typology",
          cohort_id: "cohort_5",
          pricing_option_id: "level_1",
          full_name: "Иван Иванов",
          email: "ivan_https@example.com",
        }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 500);
      const json = await res.json();
      assert.strictEqual(json.error, "UPSTREAM_URL_NOT_HTTPS");
    } finally {
      if (savedUrl !== undefined) process.env.TIKHON_RUSSIAN_SERVER_URL = savedUrl;
      else delete process.env.TIKHON_RUSSIAN_SERVER_URL;
      if (savedSecret !== undefined) process.env.TIKHON_INTERNAL_SECRET = savedSecret;
      if (savedEnv !== undefined) (process.env as Record<string, string | undefined>).NODE_ENV = savedEnv;
      else delete (process.env as Record<string, string | undefined>).NODE_ENV;
    }
  });

  test("9.4: F-13 — https upstream accepted configuration", async () => {
    // Verify route code allows https:// URLs through (no scheme rejection)
    assert.ok(
      getRouteSource().includes('!russianServerUrl.startsWith("https://")'),
      "Route must check for https:// scheme in production"
    );
    // The actual fetch would fail (no server), but the URL validation passes
    assert.ok(
      getRouteSource().includes('process.env.NODE_ENV === "production"'),
      "HTTPS enforcement is production-only"
    );
  });

  /* ---------------- 10. F-12 CORR1: LOG HARDENING ---------------- */

  test("10.1: F-12 — No raw network error details in logs", () => {
    // The error log should not include errMsg or netErr.message
    assert.ok(
      !getRouteSource().includes("err=${errMsg}"),
      "Route must not log raw error messages"
    );
    assert.ok(
      !getRouteSource().includes("netErr.message"),
      "Route must not reference raw netErr.message in logs"
    );
  });

  test("10.2: F-12 — No unvalidated course_id in logs before validation", () => {
    // The forward_complete log should not include course=${course_id}
    assert.ok(
      !getRouteSource().includes("course=${course_id}"),
      "Route must not log unvalidated course_id"
    );
  });

  test("10.3: F-12 — Raw secret never appears in any response or log", () => {
    assert.ok(
      !getRouteSource().includes("console.log(internalSecret"),
      "Route must not log the internal secret"
    );
    assert.ok(
      !getRouteSource().includes("secret:"),
      "Route responses must not contain secret"
    );
  });

  /* ---------------- 11. CORR2 TEST-COVERAGE CLOSURE (#43, #44, #47) ---------------- */

  test("11.1: CORR2 #44 — raw S2S secret never transmitted on the outbound Navigator fetch (behavioral)", async () => {
    const savedSecret = process.env.TIKHON_INTERNAL_SECRET;
    const savedUrl = process.env.TIKHON_RUSSIAN_SERVER_URL;
    const originalFetch = globalThis.fetch;
    const rawSecretMarker = `CORR2_44_RAW_SECRET_MARKER_${crypto.randomBytes(8).toString("hex")}`;
    const captured: Array<{ url: string; init: RequestInit }> = [];

    try {
      process.env.BOT_TOKEN = BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
      process.env.TIKHON_INTERNAL_SECRET = rawSecretMarker;
      process.env.TIKHON_RUSSIAN_SERVER_URL = "https://tikhon-upstream-corr2-44.invalid/api/v1/applications";

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        captured.push({ url: String(input), init: init ?? {} });
        return new Response(
          JSON.stringify({
            status: "SUCCESS",
            application_id: 46110044,
            deliveries: { CURATOR: "DELIVERED", ACCOUNTING: "DELIVERED" },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;

      const initData = createValidInitData(46110044, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({
          payer_type: "individual",
          course_id: "structural_typology",
          cohort_id: "cohort_5",
          pricing_option_id: "level_1",
          full_name: "Секрет Транзит 44",
          email: "corr2-44@example.com",
        }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(captured.length, 1, "exactly one outbound fetch must occur");

      const { url, init } = captured[0];
      const headers = new Headers(init.headers as HeadersInit);
      const bodyText = String(init.body);
      const signature = headers.get("x-tikhon-signature");
      assert.ok(signature, "outbound request must carry X-Tikhon-Signature");

      // The raw secret marker must appear in NONE of: URL, header names/values, body.
      assert.ok(!url.includes(rawSecretMarker), "URL must not contain the raw secret");
      for (const [name, value] of Array.from(headers.entries())) {
        assert.ok(!name.includes(rawSecretMarker), `header name must not contain the raw secret (${name})`);
        assert.ok(!value.includes(rawSecretMarker), `header value must not contain the raw secret (${name})`);
      }
      assert.ok(!bodyText.includes(rawSecretMarker), "forwarded body must not contain the raw secret");

      // The signature must validate using the injected secret.
      const timestamp = headers.get("x-tikhon-timestamp");
      const nonce = headers.get("x-tikhon-nonce");
      assert.ok(timestamp && nonce, "outbound request must carry timestamp and nonce headers");
      const bodySha256 = crypto.createHash("sha256").update(bodyText, "utf8").digest("hex");
      const canonical = `TIKHON-S2S-V1\nPOST\n/api/v1/applications\n${timestamp}\n${nonce}\n${bodySha256}`;
      const expectedSignature = crypto.createHmac("sha256", rawSecretMarker).update(canonical).digest("hex");
      assert.strictEqual(signature, expectedSignature, "X-Tikhon-Signature must validate using the injected secret");
    } finally {
      globalThis.fetch = originalFetch;
      if (savedSecret !== undefined) process.env.TIKHON_INTERNAL_SECRET = savedSecret;
      else delete process.env.TIKHON_INTERNAL_SECRET;
      if (savedUrl !== undefined) process.env.TIKHON_RUSSIAN_SERVER_URL = savedUrl;
      else delete process.env.TIKHON_RUSSIAN_SERVER_URL;
    }
  });

  test("11.2: CORR2 #43 — synthetic bot token absent from built client bundle (behavioral build-artifact scan)", () => {
    const repoRoot = process.cwd();
    const nextCli = path.resolve(repoRoot, "node_modules", "next", "dist", "bin", "next");
    assert.ok(fs.existsSync(nextCli), "next CLI must exist");

    // Distinctive SYNTHETIC marker token injected only into this build environment.
    // Never a real bot token.
    const syntheticToken = `999001462:AA${crypto.randomBytes(12).toString("hex")}`;

    let buildLog = "";
    try {
      buildLog = execFileSync(process.execPath, [nextCli, "build"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          TELEGRAM_BOT_TOKEN: syntheticToken,
          BOT_TOKEN: syntheticToken,
          NEXT_TELEMETRY_DISABLED: "1",
        },
        encoding: "utf-8",
        timeout: 540_000,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      const e = err as Error & { stdout?: string; stderr?: string };
      const tail = `${e.stdout ?? ""}\n${e.stderr ?? ""}`.slice(-4000);
      assert.fail(`next build failed with the synthetic token in env: ${e.message}\n${tail}`);
    }
    assert.ok(typeof buildLog === "string", "build must complete with captured output");

    // Scan every client-delivered build artifact: static chunks and prerendered HTML.
    const scanRoots = [path.join(repoRoot, ".next", "static")];
    const prerenderedRoot = path.join(repoRoot, ".next", "server", "app");
    if (fs.existsSync(prerenderedRoot)) scanRoots.push(prerenderedRoot);

    let scanned = 0;
    const violations: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else {
          scanned += 1;
          const content = fs.readFileSync(entryPath, "utf-8");
          if (content.includes(syntheticToken)) violations.push(entryPath);
        }
      }
    };
    for (const root of scanRoots) {
      assert.ok(fs.existsSync(root), `build output directory must exist: ${root}`);
      walk(root);
    }
    assert.ok(scanned > 0, "at least one build artifact must be scanned");
    assert.deepStrictEqual(
      violations,
      [],
      "synthetic bot token must not occur in any client-delivered build artifact"
    );

    // Client-facing source dependency boundary: no env access and no bot-token
    // references in any module that ships to the browser.
    const clientSources: Array<[string, string]> = [
      ["page.tsx", pageSource],
      ["legal-entity-flow.tsx", flowSource],
      ["submission-screen.tsx", screenSource],
      ["submission.ts", fs.readFileSync(path.resolve(repoRoot, "src/app/tikhon-miniapp-pilot/submission.ts"), "utf-8")],
      ["helpers.ts", helpersSource],
      ["legal-entity-helpers.ts", fs.readFileSync(path.resolve(repoRoot, "src/app/tikhon-miniapp-pilot/legal-entity-helpers.ts"), "utf-8")],
    ];
    for (const [name, src] of clientSources) {
      assert.ok(!src.includes("process.env"), `${name} must not read process.env client-side`);
      assert.ok(
        !src.includes("TELEGRAM_BOT_TOKEN") && !src.includes("BOT_TOKEN"),
        `${name} must not reference bot token env vars`
      );
    }
  });

  test("11.3: CORR2 #47 — individual confirmation CTA is disabled while submitting (page.tsx disabled expression)", () => {
    // Strongest deterministic proof available in this lightweight harness (node:test
    // has no DOM renderer): page.tsx keeps submissionState in internal useState, so a
    // full behavioral render cannot reach individual_confirmation. The exact
    // `disabled={...}` expression bound to the actual 'Оформить заявку' button is
    // extracted from the individual_confirmation branch and evaluated under every
    // submission state. The legal-entity flow (11.4) gets a full behavioral render.
    const confirmIdx = pageSource.indexOf('screen === "individual_confirmation" ? (');
    const nextIdx = pageSource.indexOf('screen === "individual_next_stage" ? (');
    assert.ok(confirmIdx !== -1, "individual_confirmation branch must exist");
    assert.ok(nextIdx !== -1 && nextIdx > confirmIdx, "individual_confirmation section must be bounded");
    const confirmSection = pageSource.slice(confirmIdx, nextIdx);

    const ctaLabelIdx = confirmSection.indexOf("Оформить заявку");
    assert.ok(ctaLabelIdx !== -1, "individual confirmation CTA must be labeled 'Оформить заявку'");
    const disabledIdx = confirmSection.lastIndexOf("disabled={", ctaLabelIdx);
    assert.ok(disabledIdx !== -1, "CTA button must bind a disabled condition");
    const exprStart = disabledIdx + "disabled={".length;
    let depth = 1;
    let end = -1;
    for (let i = exprStart; i < confirmSection.length; i += 1) {
      if (confirmSection[i] === "{") depth += 1;
      else if (confirmSection[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    assert.notStrictEqual(end, -1, "disabled expression must be closed");
    const disabledExpr = confirmSection.slice(exprStart, end);
    assert.ok(
      disabledExpr.includes("submissionState") && disabledExpr.includes("individualDraft"),
      "disabled expression must depend on the draft and the submission state"
    );

    const evalDisabled = new Function(
      "individualDraft",
      "submissionState",
      `"use strict"; return (${disabledExpr});`
    ) as (draft: unknown, state: string) => boolean;

    const validDraft = {
      course_id: "structural_typology",
      cohort_id: "cohort_5",
      pricing_option_id: "level_1",
      payer_type: "individual" as const,
      full_name: "Тест Юзер 47",
      phone: null,
      email: "corr2-47@example.com",
    };

    assert.strictEqual(
      evalDisabled(validDraft, "submitting"),
      true,
      "CTA must be disabled while submissionState === 'submitting'"
    );
    assert.strictEqual(evalDisabled(validDraft, "idle"), false, "CTA must be enabled when idle");
    assert.strictEqual(evalDisabled(validDraft, "success"), false, "CTA must be enabled on success state");
    assert.strictEqual(evalDisabled(validDraft, "error"), false, "CTA must be enabled on error state");
    assert.strictEqual(evalDisabled(null, "idle"), true, "CTA must be disabled without a draft");
  });

  test("11.4: CORR2 #47 — legal_entity_confirmation CTA is disabled while submitting (behavioral render)", async () => {
    // Full behavioral component render: LegalEntityFlow is a presentational component
    // receiving submissionState as a prop, so the actual rendered CTA is asserted
    // under both the submitting and idle states.
    const { LegalEntityFlow } = await import("../../src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx");

    const selectedCourse = {
      id: "structural_typology",
      title: "Структурная типология личности",
      short_description: "",
      meetings_count: 25,
      format_info: "",
      max_participants: 12,
      pricing_options: [],
      cohorts: [],
    };
    const selectedCohort = {
      id: "cohort_5",
      title: "5-й поток (Осень 2026)",
      start_date: "11 октября 2026",
      schedule: "По воскресеньям в 18:00 МСК",
      is_active: true,
      enrollment_status: "AVAILABLE",
      is_enrollment_open: true,
    };
    const selectedPricingOption = {
      id: "level_2",
      title: "Основной курс",
      price: 100000,
      description: "",
    };
    const legalEntityDraft = {
      course_id: "structural_typology",
      cohort_id: "cohort_5",
      pricing_option_id: "level_2",
      payer_type: "legal_entity" as const,
      entity_type: "legal_entity" as const,
      inn: "7814519993",
      company_name: "ООО Корр2 47",
      bik: "044525974",
      account: "40802810100003037685",
      doc_email: "buh-corr2-47@example.com",
      edo_type: "Диадок" as const,
      contact_person: "Контакт 47",
    };

    const baseProps: LegalEntityFlowProps = {
      screen: "legal_entity_confirmation",
      setScreen: () => {},
      legalEntityStep: 4,
      setLegalEntityStep: () => {},
      legalEntityForm: EMPTY_LEGAL_ENTITY_FORM,
      updateLegalEntityField: () => {},
      markLegalEntityFieldTouched: () => {},
      legalEntityTouched: {},
      setLegalEntityTouched: () => {},
      legalEntityContinueAttempted: { 1: false, 2: false, 3: false, 4: false },
      legalEntityValidation: {
        valid: true,
        errors: {},
      } as LegalEntityFlowProps["legalEntityValidation"],
      legalEntityDraft,
      selectedCourse,
      selectedCohort,
      selectedPricingOption,
      selectedPayerOption: { value: "legal_entity", title: "Юрлицо / ИП", description: "" },
      handleStep1Continue: () => {},
      handleStep2Continue: () => {},
      handleStep3Continue: () => {},
      handleStep4Continue: () => {},
      onSubmitApplication: () => {},
    };

    const htmlSubmitting = renderToStaticMarkup(
      createElement(LegalEntityFlow, { ...baseProps, submissionState: "submitting" })
    );
    assert.ok(htmlSubmitting.includes("ООО Корр2 47"), "legal_entity_confirmation screen must render the draft summary");
    assert.match(
      htmlSubmitting,
      /<button[^>]*disabled[^>]*>\s*Оформить заявку<\/button>/,
      "the 'Оформить заявку' CTA must render disabled while submissionState === 'submitting'"
    );

    const htmlIdle = renderToStaticMarkup(
      createElement(LegalEntityFlow, { ...baseProps, submissionState: "idle" })
    );
    assert.ok(htmlIdle.includes(">Оформить заявку</button>"), "idle render must contain the CTA");
    assert.ok(!htmlIdle.includes("disabled"), "no control may be disabled when idle with a valid draft");
  });
});
