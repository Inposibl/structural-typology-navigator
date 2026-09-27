/*
TIKHON-MINIAPP-FULL-UX-MIGRATION-1 .BATCH-6.FINAL-APPLICATION-SUBMISSION-UI-1
.IMPLEMENTATION-1 — focused author tests (navigator side).

Act test map:
  A  valid completed form enables "Отправить заявку"
  B  incomplete/invalid state cannot submit
  C  first click enters submitting state
  D  repeated click cannot create a duplicate request
  E  existing submission API is called with the correct existing payload contract
  F  success response renders success state / application ID
  G  failure renders error/retry state
  I  retry preserves existing idempotency behavior
  H  (Accounting delivery path) is proven chatbot-side:
     chatbot/tests/test_batch6_accounting_delivery.py — mock bot, hermetic temp DB,
     no real Telegram sends.
  J  adjacent Batch5 suites remain green (batch-5-submission.test.mts run in the
     same focused command; chatbot tests/test_batch5_submission.py run separately).

page.tsx keeps its screens in internal useState, so node:test (no DOM renderer)
cannot behaviorally reach individual_confirmation; for those internals the
strongest deterministic proof is source extraction (same convention as Batch-5
test 11.3). Everything renderable is rendered behaviorally.
*/

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "crypto";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LegalEntityFlowProps } from "../../src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx";
import type { LegalEntityFormValues } from "../../src/app/tikhon-miniapp-pilot/legal-entity-helpers.ts";

// CSS module stub loader (same technique as Batch-5 CORR2 #47): must be
// registered synchronously before any dynamic import of a component that
// imports miniapp.module.css.
const cssLoaderSource = `const STUB_SOURCE = "const stub = new Proxy({}, { get: () => 'batch6-css-stub' });\\nexport default stub;";
export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return { url: "batch6-css-stub:" + encodeURIComponent(specifier), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export function load(url, context, nextLoad) {
  if (url.startsWith("batch6-css-stub:")) {
    return { format: "module", source: STUB_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;
const cssLoaderDir = fs.mkdtempSync(path.join(os.tmpdir(), "batch6-css-loader-"));
const cssLoaderFile = path.join(cssLoaderDir, "css-stub-loader.mjs");
fs.writeFileSync(cssLoaderFile, cssLoaderSource);
register(pathToFileURL(cssLoaderFile));

const pageSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/page.tsx"),
  "utf-8"
);
const flowSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx"),
  "utf-8"
);
const submissionClientSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/submission.ts"),
  "utf-8"
);

const BOT_TOKEN = "8682116994:TEST_BOT_TOKEN_FOR_BATCH_6_TESTS";
const S2S_SECRET = "batch6_focused_test_s2s_secret";
const UPSTREAM_URL = "https://upstream.example.test/api/v1/applications";

function createValidInitData(userId: number, botToken: string, username = "batch6_pilot"): string {
  const authDate = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({ id: userId, first_name: "Batch6", username });
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAG_batch6_query_id");
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

/** Extract the handleExecuteSubmission useCallback argument source from page.tsx. */
function extractHandlerBody(source: string): string {
  const anchor = "const handleExecuteSubmission = useCallback(";
  const start = source.indexOf(anchor);
  assert.ok(start !== -1, "handleExecuteSubmission useCallback must exist in page.tsx");
  let depth = 0;
  let end = -1;
  for (let i = start + anchor.length - 1; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notStrictEqual(end, -1, "handleExecuteSubmission useCallback must be closed");
  return source.slice(start + anchor.length, end);
}

/** Evaluate the disabled={...} expression bound to the CTA that carries `label`. */
function extractDisabledExpr(section: string, label: string): string {
  const labelIdx = section.indexOf(label);
  assert.ok(labelIdx !== -1, `section must contain the CTA label '${label}'`);
  const disabledIdx = section.lastIndexOf("disabled={", labelIdx);
  assert.ok(disabledIdx !== -1, "CTA button must bind a disabled condition");
  const exprStart = disabledIdx + "disabled={".length;
  let depth = 1;
  let end = -1;
  for (let i = exprStart; i < section.length; i += 1) {
    if (section[i] === "{") depth += 1;
    else if (section[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notStrictEqual(end, -1, "disabled expression must be closed");
  return section.slice(exprStart, end);
}

function makeLegalEntityBaseProps(
  emptyForm: LegalEntityFormValues,
  legalEntityDraft: LegalEntityFlowProps["legalEntityDraft"]
): LegalEntityFlowProps {
  return {
    screen: "legal_entity_confirmation",
    setScreen: () => {},
    legalEntityStep: 4,
    setLegalEntityStep: () => {},
    legalEntityForm: emptyForm,
    updateLegalEntityField: () => {},
    markLegalEntityFieldTouched: () => {},
    legalEntityTouched: {},
    setLegalEntityTouched: () => {},
    legalEntityContinueAttempted: { 1: false, 2: false, 3: false, 4: false },
    legalEntityValidation: { valid: true, errors: {} } as LegalEntityFlowProps["legalEntityValidation"],
    legalEntityDraft,
    selectedCourse: {
      id: "structural_typology",
      title: "Структурная типология личности",
      short_description: "",
      meetings_count: 25,
      format_info: "",
      max_participants: 12,
      pricing_options: [],
      cohorts: [],
    },
    selectedCohort: {
      id: "cohort_5",
      title: "5-й поток (Осень 2026)",
      start_date: "11 октября 2026",
      schedule: "По воскресеньям в 18:00 МСК",
      is_active: true,
      enrollment_status: "AVAILABLE",
      is_enrollment_open: true,
    },
    selectedPricingOption: { id: "level_2", title: "Основной курс", price: 100000, description: "" },
    selectedPayerOption: { value: "legal_entity", title: "Юрлицо / ИП", description: "" },
    handleStep1Continue: () => {},
    handleStep2Continue: () => {},
    handleStep3Continue: () => {},
    handleStep4Continue: () => {},
    onSubmitApplication: () => {},
  };
}

const VALID_LEGAL_ENTITY_DRAFT: LegalEntityFlowProps["legalEntityDraft"] = {
  course_id: "structural_typology",
  cohort_id: "cohort_5",
  pricing_option_id: "level_2",
  payer_type: "legal_entity",
  entity_type: "legal_entity",
  inn: "7814519993",
  company_name: "ООО Батч Шесть",
  bik: "044525974",
  account: "40802810100003037685",
  doc_email: "buh-batch6@example.com",
  edo_type: "Диадок",
  contact_person: "Контакт Батч Шесть",
};

describe("TIKHON-MINIAPP BATCH 6: Final Application Submission UI", () => {
  /* ---------------- A: valid completed form enables the CTA ---------------- */

  test("A: valid completed draft enables 'Отправить заявку' (individual disabled expr + draft builder + LE behavioral render)", async () => {
    const confirmIdx = pageSource.indexOf('screen === "individual_confirmation" ? (');
    const nextIdx = pageSource.indexOf('screen === "individual_next_stage" ? (');
    assert.ok(confirmIdx !== -1 && nextIdx > confirmIdx, "individual_confirmation branch must exist");
    const confirmSection = pageSource.slice(confirmIdx, nextIdx);
    const disabledExpr = extractDisabledExpr(confirmSection, "Отправить заявку");
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
      full_name: "Валидный Заявитель",
      phone: null,
      email: "batch6-a@example.com",
    };
    assert.strictEqual(
      evalDisabled(validDraft, "idle"),
      false,
      "CTA must be enabled for a valid completed draft in idle state"
    );

    // Draft builder gates on form validity: a fully valid form yields a draft
    const { buildIndividualEnrollmentDraft, EMPTY_INDIVIDUAL_FORM } = await import(
      "../../src/app/tikhon-miniapp-pilot/helpers.ts"
    );
    const course = { id: "structural_typology", title: "СТЛ", pricing_options: [], cohorts: [] } as never;
    const cohort = { id: "cohort_5", title: "5-й поток" } as never;
    const pricing = { id: "level_1", title: "Введение в теорию", price: 50000 } as never;
    const validValues = {
      ...EMPTY_INDIVIDUAL_FORM,
      full_name: "Валидный Заявитель",
      email: "batch6-a@example.com",
    };
    const draft = buildIndividualEnrollmentDraft({
      course,
      cohort,
      pricingOption: pricing,
      values: validValues,
    });
    assert.ok(draft, "valid completed form must produce a submission draft");

    // Legal-entity confirmation: behavioral idle render has an enabled CTA
    const { LegalEntityFlow } = await import("../../src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx");
    const { EMPTY_LEGAL_ENTITY_FORM } = await import(
      "../../src/app/tikhon-miniapp-pilot/legal-entity-helpers.ts"
    );
    const baseProps = makeLegalEntityBaseProps(EMPTY_LEGAL_ENTITY_FORM, VALID_LEGAL_ENTITY_DRAFT);
    const htmlIdle = renderToStaticMarkup(
      createElement(LegalEntityFlow, { ...baseProps, submissionState: "idle" })
    );
    assert.ok(htmlIdle.includes(">Отправить заявку</button>"), "idle render must contain the CTA");
    assert.ok(!htmlIdle.includes("disabled"), "no control may be disabled when idle with a valid draft");
  });

  /* ---------------- B: incomplete/invalid state cannot submit ---------------- */

  test("B: incomplete/invalid state cannot submit (null draft disables CTA; form gate requires validation)", async () => {
    const confirmIdx = pageSource.indexOf('screen === "individual_confirmation" ? (');
    const nextIdx = pageSource.indexOf('screen === "individual_next_stage" ? (');
    const confirmSection = pageSource.slice(confirmIdx, nextIdx);
    const disabledExpr = extractDisabledExpr(confirmSection, "Отправить заявку");
    const evalDisabled = new Function(
      "individualDraft",
      "submissionState",
      `"use strict"; return (${disabledExpr});`
    ) as (draft: unknown, state: string) => boolean;
    assert.strictEqual(
      evalDisabled(null, "idle"),
      true,
      "CTA must be disabled without a draft (incomplete/invalid state)"
    );

    const { buildIndividualEnrollmentDraft, EMPTY_INDIVIDUAL_FORM } = await import(
      "../../src/app/tikhon-miniapp-pilot/helpers.ts"
    );
    const course = { id: "structural_typology", title: "СТЛ", pricing_options: [], cohorts: [] } as never;
    const cohort = { id: "cohort_5", title: "5-й поток" } as never;
    const pricing = { id: "level_1", title: "Введение в теорию", price: 50000 } as never;
    // Single-word name + missing email = invalid form state
    const invalidValues = { ...EMPTY_INDIVIDUAL_FORM, full_name: "Однослово", email: "" };
    const draft = buildIndividualEnrollmentDraft({
      course,
      cohort,
      pricingOption: pricing,
      values: invalidValues,
    });
    assert.strictEqual(draft, null, "invalid form state must not produce a submission draft");

    // Form continue is gated before the confirmation screen: validation + draft
    assert.ok(
      /if \(!individualValidation\.valid \|\| !individualDraft\)/.test(pageSource),
      "individual form continue must require valid validation and a draft"
    );

    // Legal-entity behavioral render with null draft: CTA disabled
    const { LegalEntityFlow } = await import("../../src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx");
    const { EMPTY_LEGAL_ENTITY_FORM } = await import(
      "../../src/app/tikhon-miniapp-pilot/legal-entity-helpers.ts"
    );
    const baseProps = makeLegalEntityBaseProps(EMPTY_LEGAL_ENTITY_FORM, null);
    const htmlNullDraft = renderToStaticMarkup(
      createElement(LegalEntityFlow, { ...baseProps, legalEntityDraft: null, submissionState: "idle" })
    );
    assert.match(
      htmlNullDraft,
      /<button[^>]*disabled[^>]*>\s*Отправить заявку<\/button>/,
      "CTA must render disabled without a legal-entity draft"
    );
  });

  /* ---------------- C: first click enters submitting state ---------------- */

  test("C: first click enters submitting state (handler order + behavioral submitting render)", async () => {
    const handlerBody = extractHandlerBody(pageSource);
    const setStateIdx = handlerBody.indexOf('setSubmissionState("submitting")');
    const setScreenIdx = handlerBody.indexOf('setScreen("submission_result")');
    const awaitIdx = handlerBody.indexOf("await submitTikhonApplication");
    assert.notStrictEqual(setStateIdx, -1, "handler must enter submitting state");
    assert.notStrictEqual(setScreenIdx, -1, "handler must advance to submission_result");
    assert.notStrictEqual(awaitIdx, -1, "handler must call the Batch5 submission client");
    assert.ok(
      setStateIdx < awaitIdx && setScreenIdx < awaitIdx,
      "submitting state and screen must be set synchronously before the request"
    );

    const { SubmissionResultScreen } = await import(
      "../../src/app/tikhon-miniapp-pilot/submission-screen.tsx"
    );
    const { SUCCESS_COPY_VERBATIM } = await import("../../src/app/tikhon-miniapp-pilot/helpers.ts");
    const html = renderToStaticMarkup(
      createElement(SubmissionResultScreen, {
        submissionState: "submitting",
        submissionError: null,
        submissionAppId: null,
        onRetry: () => {},
        onBack: () => {},
        onGoCatalog: () => {},
      })
    );
    assert.ok(html.includes("Оформление заявки"), "submitting render must show the submitting heading");
    assert.ok(html.includes("мы регистрируем вашу заявку"), "submitting render must show the wait copy");
    assert.ok(!html.includes("Повторить попытку"), "submitting render must not offer retry");
    assert.ok(!html.includes(SUCCESS_COPY_VERBATIM), "submitting render must not show success copy");
  });

  /* ---------------- D: repeated click cannot create a duplicate request ---------------- */

  test("D: repeated click cannot create a duplicate request (in-flight guard precedes request; CTAs disabled while submitting)", async () => {
    const handlerBody = extractHandlerBody(pageSource);
    const guardIdx = handlerBody.indexOf("if (submissionInFlightRef.current) return;");
    const setTrueIdx = handlerBody.indexOf("submissionInFlightRef.current = true;");
    const setStateIdx = handlerBody.indexOf('setSubmissionState("submitting")');
    const awaitIdx = handlerBody.indexOf("await submitTikhonApplication");
    const finallyIdx = handlerBody.indexOf("finally {");
    const releaseIdx = handlerBody.indexOf("submissionInFlightRef.current = false;", finallyIdx);
    assert.notStrictEqual(guardIdx, -1, "in-flight guard must exist in handleExecuteSubmission");
    assert.notStrictEqual(setTrueIdx, -1, "guard must be raised");
    assert.notStrictEqual(finallyIdx, -1, "handler must release the in-flight guard in finally");
    assert.notStrictEqual(releaseIdx, -1, "guard release must exist inside finally");
    assert.ok(guardIdx < setTrueIdx, "guard check must precede raising the guard");
    assert.ok(setTrueIdx < setStateIdx, "guard must be raised before entering submitting state");
    assert.ok(setTrueIdx < awaitIdx, "guard must be raised before the submission request");
    assert.ok(releaseIdx > awaitIdx, "guard must be released only after the request completes");
    // The ref itself must be a component-level useRef
    assert.match(
      pageSource,
      /const submissionInFlightRef = useRef\(false\);/,
      "submissionInFlightRef must be declared via useRef"
    );
    // Single request seam: exactly one submission-client call site in the handler
    assert.strictEqual(
      (handlerBody.match(/submitTikhonApplication\(/g) || []).length,
      1,
      "handleExecuteSubmission must contain exactly one submission client call"
    );

    // Both CTAs route through the guarded handler
    const confirmIdx = pageSource.indexOf('screen === "individual_confirmation" ? (');
    const nextIdx = pageSource.indexOf('screen === "individual_next_stage" ? (');
    const confirmSection = pageSource.slice(confirmIdx, nextIdx);
    assert.ok(
      confirmSection.includes("handleExecuteSubmission"),
      "individual CTA must call the guarded handler"
    );
    assert.ok(
      flowSource.includes("onSubmitApplication"),
      "legal-entity CTA must route through onSubmitApplication"
    );
    assert.match(
      pageSource,
      /onSubmitApplication=\{\(\) => \{\s*if \(legalEntityDraft\) \{\s*handleExecuteSubmission\(legalEntityDraft, "legal_entity"\);/,
      "page.tsx must route legal-entity onSubmitApplication through the guarded handler"
    );

    // Disabled while submitting: individual (evaluated) + legal-entity (behavioral)
    const disabledExpr = extractDisabledExpr(confirmSection, "Отправить заявку");
    const evalDisabled = new Function(
      "individualDraft",
      "submissionState",
      `"use strict"; return (${disabledExpr});`
    ) as (draft: unknown, state: string) => boolean;
    assert.strictEqual(
      evalDisabled(
        {
          course_id: "structural_typology",
          cohort_id: "cohort_5",
          pricing_option_id: "level_1",
          payer_type: "individual",
          full_name: "x",
          phone: null,
          email: "x@x.com",
        },
        "submitting"
      ),
      true,
      "individual CTA must be disabled while submitting"
    );
    const { LegalEntityFlow } = await import("../../src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx");
    const { EMPTY_LEGAL_ENTITY_FORM } = await import(
      "../../src/app/tikhon-miniapp-pilot/legal-entity-helpers.ts"
    );
    const baseProps = makeLegalEntityBaseProps(EMPTY_LEGAL_ENTITY_FORM, VALID_LEGAL_ENTITY_DRAFT);
    const htmlSubmitting = renderToStaticMarkup(
      createElement(LegalEntityFlow, { ...baseProps, submissionState: "submitting" })
    );
    assert.match(
      htmlSubmitting,
      /<button[^>]*disabled[^>]*>\s*Отправить заявку<\/button>/,
      "legal-entity CTA must render disabled while submitting"
    );

    // Server-side duplicate authority cross-ref: concurrent duplicate submits are
    // proven single-application by chatbot tests/test_batch5_submission.py case 30
    // and by the focused chatbot/tests/test_batch6_accounting_delivery.py (mock bot).
  });

  /* ---------------- E: existing submission API payload contract ---------------- */

  test("E: submission API (S2S route) is called with the correct existing payload contract — individual", async () => {
    const { POST } = await import("../../src/app/api/tikhon/submit-application/route.ts");
    const saved = {
      BOT_TOKEN: process.env.BOT_TOKEN,
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      TIKHON_INTERNAL_SECRET: process.env.TIKHON_INTERNAL_SECRET,
      TIKHON_RUSSIAN_SERVER_URL: process.env.TIKHON_RUSSIAN_SERVER_URL,
    };
    const upstreamCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      upstreamCalls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          application_id: 6401,
          deliveries: { CURATOR: "DELIVERED", ACCOUNTING: "DELIVERED" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      process.env.BOT_TOKEN = BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
      process.env.TIKHON_INTERNAL_SECRET = S2S_SECRET;
      process.env.TIKHON_RUSSIAN_SERVER_URL = UPSTREAM_URL;

      const initData = createValidInitData(46460101, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({
          user_id: 999,
          payer_type: "individual",
          course_id: "structural_typology",
          cohort_id: "cohort_5",
          pricing_option_id: "level_2",
          full_name: "Контракт Заявитель",
          email: "batch6-e@example.com",
          phone: "+79990000000",
          amount: 1,
          chat_id: 12345,
          destination: "HACKED",
          initData,
        }),
      });
      const res = await POST(req);
      assert.equal(res.status, 200, "route must return 200 on canonical acceptance");
      const data = await res.json();
      assert.equal(data.status, "SUCCESS");
      assert.equal(data.application_id, 6401);

      assert.equal(upstreamCalls.length, 1, "upstream must receive exactly one forward");
      const call = upstreamCalls[0];
      assert.equal(call.url, UPSTREAM_URL, "forward must target the configured canonical receiver");
      const headers = new Headers(call.init?.headers);
      assert.ok(headers.get("X-Tikhon-Timestamp"), "forward must carry X-Tikhon-Timestamp");
      assert.ok(headers.get("X-Tikhon-Nonce"), "forward must carry X-Tikhon-Nonce");
      assert.ok(headers.get("X-Tikhon-Signature"), "forward must carry X-Tikhon-Signature");

      const forwarded = JSON.parse(String(call.init?.body));
      assert.deepEqual(
        Object.keys(forwarded).sort(),
        [
          "cohort_id",
          "course_id",
          "email",
          "first_name",
          "full_name",
          "last_name",
          "payer_type",
          "phone",
          "pricing_option_id",
          "user_id",
          "username",
        ],
        "forwarded individual payload must match the existing Batch5 receiver contract exactly"
      );
      assert.equal(forwarded.user_id, 46460101, "user_id must come from verified initData, not the client body");
      assert.equal(forwarded.payer_type, "individual");
      assert.equal(forwarded.course_id, "structural_typology");
      assert.equal(forwarded.cohort_id, "cohort_5");
      assert.equal(forwarded.pricing_option_id, "level_2");
      assert.equal(forwarded.full_name, "Контракт Заявитель");
      assert.equal(forwarded.email, "batch6-e@example.com");
      assert.equal(forwarded.phone, "+79990000000");
      assert.ok(!("initData" in forwarded), "raw initData must never be forwarded upstream");
      assert.ok(!("amount" in forwarded), "client financial parameters must be dropped");
      assert.ok(!("chat_id" in forwarded), "client chat destinations must be dropped");
      assert.ok(!("destination" in forwarded), "client destination overrides must be dropped");
    } finally {
      globalThis.fetch = realFetch;
      if (saved.BOT_TOKEN === undefined) delete process.env.BOT_TOKEN;
      else process.env.BOT_TOKEN = saved.BOT_TOKEN;
      if (saved.TELEGRAM_BOT_TOKEN === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = saved.TELEGRAM_BOT_TOKEN;
      if (saved.TIKHON_INTERNAL_SECRET === undefined) delete process.env.TIKHON_INTERNAL_SECRET;
      else process.env.TIKHON_INTERNAL_SECRET = saved.TIKHON_INTERNAL_SECRET;
      if (saved.TIKHON_RUSSIAN_SERVER_URL === undefined) delete process.env.TIKHON_RUSSIAN_SERVER_URL;
      else process.env.TIKHON_RUSSIAN_SERVER_URL = saved.TIKHON_RUSSIAN_SERVER_URL;
    }
  });

  test("E: submission API payload contract — legal entity (canonical legal fields forwarded)", async () => {
    const { POST } = await import("../../src/app/api/tikhon/submit-application/route.ts");
    const saved = {
      BOT_TOKEN: process.env.BOT_TOKEN,
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      TIKHON_INTERNAL_SECRET: process.env.TIKHON_INTERNAL_SECRET,
      TIKHON_RUSSIAN_SERVER_URL: process.env.TIKHON_RUSSIAN_SERVER_URL,
    };
    const upstreamCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      upstreamCalls.push({ url: String(url), init });
      return new Response(JSON.stringify({ status: "SUCCESS", application_id: 6402 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      process.env.BOT_TOKEN = BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
      process.env.TIKHON_INTERNAL_SECRET = S2S_SECRET;
      process.env.TIKHON_RUSSIAN_SERVER_URL = UPSTREAM_URL;

      const initData = createValidInitData(46460102, BOT_TOKEN, "batch6_legal_pilot");
      const req = new NextRequest("http://localhost:3000/api/tikhon/submit-application", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({
          payer_type: "legal_entity",
          course_id: "structural_typology",
          cohort_id: "cohort_5",
          pricing_option_id: "level_2",
          inn: "7814519993",
          kpp: "781401001",
          company_name: "ООО Батч Шесть",
          company_address: "г. Санкт-Петербург",
          bik: "044525974",
          account: "40802810100003037685",
          edo_type: "Диадок",
          doc_email: "buh-batch6@example.com",
          contact_person: "Контакт Батч Шесть",
        }),
      });
      const res = await POST(req);
      assert.equal(res.status, 200);
      assert.equal(upstreamCalls.length, 1);
      const forwarded = JSON.parse(String(upstreamCalls[0].init?.body));
      assert.deepEqual(
        Object.keys(forwarded).sort(),
        [
          "account",
          "bik",
          "cohort_id",
          "company_address",
          "company_name",
          "contact_person",
          "course_id",
          "doc_email",
          "edo_type",
          "first_name",
          "inn",
          "kpp",
          "last_name",
          "payer_type",
          "pricing_option_id",
          "user_id",
          "username",
        ],
        "forwarded legal-entity payload must match the existing Batch5 receiver contract exactly"
      );
      assert.equal(forwarded.user_id, 46460102);
      assert.equal(forwarded.inn, "7814519993");
      assert.equal(forwarded.doc_email, "buh-batch6@example.com");
      assert.ok(!("initData" in forwarded), "raw initData must never be forwarded upstream");
    } finally {
      globalThis.fetch = realFetch;
      if (saved.BOT_TOKEN === undefined) delete process.env.BOT_TOKEN;
      else process.env.BOT_TOKEN = saved.BOT_TOKEN;
      if (saved.TELEGRAM_BOT_TOKEN === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = saved.TELEGRAM_BOT_TOKEN;
      if (saved.TIKHON_INTERNAL_SECRET === undefined) delete process.env.TIKHON_INTERNAL_SECRET;
      else process.env.TIKHON_INTERNAL_SECRET = saved.TIKHON_INTERNAL_SECRET;
      if (saved.TIKHON_RUSSIAN_SERVER_URL === undefined) delete process.env.TIKHON_RUSSIAN_SERVER_URL;
      else process.env.TIKHON_RUSSIAN_SERVER_URL = saved.TIKHON_RUSSIAN_SERVER_URL;
    }
  });

  /* ---------------- F: success renders success state / application ID ---------------- */

  test("F: success response renders success state with application ID and truthful copy", async () => {
    // Client-level mapping: Batch5 client returns ok + application_id on SUCCESS
    const { submitTikhonApplication } = await import("../../src/app/tikhon-miniapp-pilot/submission.ts");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          application_id: 4242,
          deliveries: { CURATOR: "DELIVERED", ACCOUNTING: "DELIVERED" },
          message:
            "Для выполнения оплаты свяжитесь с куратором курса Алексеем Лебедевым @Lebedev_AST. Спасибо",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      const result = await submitTikhonApplication(
        {
          course_id: "structural_typology",
          cohort_id: "cohort_5",
          pricing_option_id: "level_1",
          payer_type: "individual",
          full_name: "Успешный Заявитель",
          phone: null,
          email: "batch6-f@example.com",
        },
        "individual",
        createValidInitData(46460103, BOT_TOKEN)
      );
      assert.equal(result.ok, true, "SUCCESS must map to ok=true");
      assert.equal(result.status, "SUCCESS");
      assert.equal(result.application_id, 4242, "application ID must surface to the UI");
    } finally {
      globalThis.fetch = realFetch;
    }

    // Render-level success state
    const { SubmissionResultScreen } = await import(
      "../../src/app/tikhon-miniapp-pilot/submission-screen.tsx"
    );
    const { SUCCESS_COPY_VERBATIM } = await import("../../src/app/tikhon-miniapp-pilot/helpers.ts");
    const html = renderToStaticMarkup(
      createElement(SubmissionResultScreen, {
        submissionState: "success",
        submissionError: null,
        submissionAppId: 4242,
        onRetry: () => {},
        onBack: () => {},
        onGoCatalog: () => {},
      })
    );
    assert.ok(html.includes("Заявка #4242 принята"), "success render must display the application ID");
    assert.ok(
      html.includes(SUCCESS_COPY_VERBATIM),
      "success render must show the verbatim curator-handoff copy"
    );
    assert.ok(
      html.includes("Связаться с куратором (@Lebedev_AST)"),
      "success render must offer the curator action"
    );
    assert.ok(html.includes("В каталог курсов"), "success render must offer next navigation");
    assert.ok(!html.includes("Повторить попытку"), "success render must not offer retry");
    // Truthfulness: copy must not pretend payment or enrollment is complete
    assert.ok(
      !/оплата\s+(завершена|прошла|выполнена)/i.test(html),
      "success render must not claim payment completed"
    );
    assert.ok(!/вы зачислен/i.test(html), "success render must not claim enrollment completed");
  });

  /* ---------------- G: failure renders bounded error / retry ---------------- */

  test("G: failure renders error/retry state and never shows success", async () => {
    const { submitTikhonApplication } = await import("../../src/app/tikhon-miniapp-pilot/submission.ts");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ status: "PARTIAL_OR_FAILED", error: "DELIVERY_INCOMPLETE", application_id: 4243 }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    let clientResult: Awaited<ReturnType<typeof submitTikhonApplication>> | null = null;
    try {
      clientResult = await submitTikhonApplication(
        {
          course_id: "structural_typology",
          cohort_id: "cohort_5",
          pricing_option_id: "level_1",
          payer_type: "individual",
          full_name: "Неудачный Заявитель",
          phone: null,
          email: "batch6-g@example.com",
        },
        "individual",
        createValidInitData(46460104, BOT_TOKEN)
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(clientResult.ok, false, "PARTIAL_OR_FAILED must map to ok=false");
    assert.equal(clientResult.status, "PARTIAL_OR_FAILED");
    assert.equal(clientResult.application_id, 4243);

    const { SubmissionResultScreen } = await import(
      "../../src/app/tikhon-miniapp-pilot/submission-screen.tsx"
    );
    const { SUCCESS_COPY_VERBATIM } = await import("../../src/app/tikhon-miniapp-pilot/helpers.ts");
    const html = renderToStaticMarkup(
      createElement(SubmissionResultScreen, {
        submissionState: "error",
        submissionError: "Доставка заявки адресатам не была завершена полностью.",
        submissionAppId: 4243,
        onRetry: () => {},
        onBack: () => {},
        onGoCatalog: () => {},
      })
    );
    assert.ok(html.includes("Ошибка отправки"), "error render must show the error heading");
    assert.ok(
      html.includes("Доставка заявки адресатам не была завершена полностью."),
      "error render must show the bounded error message"
    );
    assert.ok(html.includes("Повторить попытку"), "error render must offer retry");
    assert.ok(html.includes("Вернуться к проверке данных"), "error render must offer safe return");
    assert.ok(!html.includes(SUCCESS_COPY_VERBATIM), "error render must never show success copy");
    assert.ok(!html.includes("принята"), "error render must never show the success badge");
  });

  /* ---------------- I: retry preserves existing idempotency behavior ---------------- */

  test("I: retry routes through the guarded handler with the original draft; guard release keeps retry possible", async () => {
    // onRetry inside the submission_result branch must re-invoke handleExecuteSubmission
    const resultBranchIdx = pageSource.indexOf('{screen === "submission_result" && (');
    assert.notStrictEqual(resultBranchIdx, -1, "submission_result branch must exist");
    const resultBranch = pageSource.slice(resultBranchIdx);
    assert.match(
      resultBranch,
      /onRetry=\{\(\) => \{[\s\S]*?handleExecuteSubmission\(legalEntityDraft, "legal_entity"\);[\s\S]*?handleExecuteSubmission\(individualDraft, "individual"\);/,
      "retry must reuse the guarded handler with the original draft for both payer types"
    );
    // The guard is released in finally, so a failed submission can be retried
    const handlerBody = extractHandlerBody(pageSource);
    const finallyIdx = handlerBody.indexOf("finally {");
    assert.notStrictEqual(finallyIdx, -1, "handler must release the in-flight guard in finally");
    // Client sends a fresh request per retry; server nonce + active_application_key
    // idempotency is the canonical duplicate authority (chatbot Batch5 cases 10/21/26
    // and chatbot test_batch6_accounting_delivery.py remain the proof for that layer).
    assert.ok(
      submissionClientSource.includes('fetch("/api/tikhon/submit-application"'),
      "retry must go through the existing Batch5 submission client path"
    );
  });
});
