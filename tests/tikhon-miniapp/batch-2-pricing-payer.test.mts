import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

import {
  PAYER_TYPE_OPTIONS,
  isValidPayerType,
  getNextStageLabel,
  getSingleAutoPricingOption,
  getPublicAwareOptionEligibility,
  canProceedToPayerSelection,
  getOptionEligibility,
  Course,
  Cohort,
  PricingOption,
  StudentCourseStatus,
} from "../../src/app/tikhon-miniapp-pilot/helpers.ts";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import {
  validateTelegramInitData,
  GET as studentStatusHandler,
} from "../../src/app/api/tikhon/student-status/route.ts";

describe("Tikhon Mini App Batch 2 — Pricing & Payer Selection Contract", () => {
  const pageSourcePath = path.resolve(
    process.cwd(),
    "src/app/tikhon-miniapp-pilot/page.tsx",
  );
  const helpersSourcePath = path.resolve(
    process.cwd(),
    "src/app/tikhon-miniapp-pilot/helpers.ts",
  );

  const pageSource = fs.readFileSync(pageSourcePath, "utf-8");
  const helpersSource = fs.readFileSync(helpersSourcePath, "utf-8");

  // Screen 3 + stub rendered contract region (post Screen-2 JSX)
  const payerRegionStart = pageSource.indexOf('screen === "payer" ? (');
  const stubRegionStart = pageSource.indexOf("LOCAL-ONLY NEXT-STAGE STUB");
  assert.ok(payerRegionStart > 0, "page.tsx must contain Screen 3 payer branch");
  assert.ok(stubRegionStart > payerRegionStart, "page.tsx must contain stub branch");
  const payerRegion = pageSource.slice(payerRegionStart, stubRegionStart);
  const stubRegion = pageSource.slice(stubRegionStart);

  function makeCohort(overrides: Partial<Cohort> = {}): Cohort {
    return {
      id: "cohort_1",
      title: "Test Cohort",
      start_date: "Future",
      schedule: "Weekly",
      is_active: true,
      enrollment_status: "AVAILABLE",
      is_enrollment_open: true,
      ...overrides,
    };
  }

  function makeOption(overrides: Partial<PricingOption> = {}): PricingOption {
    return {
      id: "single_payment",
      title: "Test Option",
      price: 1,
      description: "Test",
      ...overrides,
    };
  }

  function makeCourse(overrides: Partial<Course> = {}): Course {
    return {
      id: "maslow",
      title: "Test Course",
      short_description: "Test",
      meetings_count: 4,
      format_info: "Zoom",
      max_participants: 24,
      pricing_options: [makeOption()],
      cohorts: [makeCohort()],
      ...overrides,
    };
  }

  /* ---------------- PRICING (§23) ---------------- */

  test("A: all four single-option courses auto-select single_payment from the source object", async () => {
    const { GET } = await import("../../src/app/api/tikhon/courses/route.ts");
    const response = await GET();
    assert.equal(response.status, 200, "API response must return 200");
    const data = await response.json();

    const singleOptionIds = [
      "levels_of_consciousness",
      "maslow",
      "normative_situation",
      "play_and_creativity",
    ];
    for (const id of singleOptionIds) {
      const course = data.courses.find((c: { id: string }) => c.id === id);
      assert.ok(course, `Course ${id} must exist in projection`);
      assert.equal(
        course.pricing_options.length,
        1,
        `${id} must have exactly one pricing option`,
      );
      const auto = getSingleAutoPricingOption(course);
      assert.ok(auto, `${id} must auto-select its only pricing option`);
      assert.equal(
        auto.id,
        course.pricing_options[0].id,
        "auto-selected option must come from the source course object",
      );
      assert.equal(
        auto.id,
        "single_payment",
        `${id} source option must be single_payment`,
      );
    }
  });

  test("B: Structural Typology does NOT auto-select among multiple eligible options", async () => {
    const { GET } = await import("../../src/app/api/tikhon/courses/route.ts");
    const response = await GET();
    const data = await response.json();
    const st = data.courses.find(
      (c: { id: string }) => c.id === "structural_typology",
    );
    assert.ok(st, "Structural Typology must exist in projection");
    assert.ok(
      st.pricing_options.length > 1,
      "Structural Typology must expose multiple pricing options",
    );
    assert.strictEqual(
      getSingleAutoPricingOption(st),
      null,
      "multi-option course must never auto-select",
    );
    assert.ok(
      !pageSource.includes("firstEligible"),
      "page.tsx must not auto-select the first eligible option anymore",
    );
  });

  test("C: Structural Typology PAID option cannot be selected or carried to Screen 3", () => {
    const status: StudentCourseStatus = {
      paid_options: ["level_1"],
      legacy_history_unverified: false,
    };
    assert.strictEqual(
      getOptionEligibility("structural_typology", "level_1", status).state,
      "PAID",
    );
    const gate = canProceedToPayerSelection({
      course: makeCourse({ id: "structural_typology" }),
      cohort: makeCohort(),
      pricingOption: makeOption({ id: "level_1" }),
      studentCourseStatus: status,
      isAuthenticated: true,
    });
    assert.deepStrictEqual(gate, { allowed: false, reason: "not_eligible" });
  });


  test("D: Structural Typology LOCKED and staged-disabled options cannot be selected", () => {
    const emptyStatus: StudentCourseStatus = {
      paid_options: [],
      legacy_history_unverified: false,
    };
    assert.strictEqual(
      getOptionEligibility("structural_typology", "level_2", emptyStatus).state,
      "LOCKED",
    );
    const gateLocked = canProceedToPayerSelection({
      course: makeCourse({ id: "structural_typology" }),
      cohort: makeCohort(),
      pricingOption: makeOption({ id: "level_2" }),
      studentCourseStatus: emptyStatus,
      isAuthenticated: true,
    });
    assert.deepStrictEqual(gateLocked, { allowed: false, reason: "not_eligible" });

    const stagedStatus: StudentCourseStatus = {
      paid_options: ["level_1"],
      legacy_history_unverified: false,
    };
    assert.strictEqual(
      getOptionEligibility("structural_typology", "full_prepayment", stagedStatus)
        .state,
      "DISABLED_STARTED_STAGED",
    );
    const gateStaged = canProceedToPayerSelection({
      course: makeCourse({ id: "structural_typology" }),
      cohort: makeCohort(),
      pricingOption: makeOption({ id: "full_prepayment" }),
      studentCourseStatus: stagedStatus,
      isAuthenticated: true,
    });
    assert.deepStrictEqual(gateStaged, { allowed: false, reason: "not_eligible" });
  });

  test("E: legacy_history_unverified remains fail-closed", () => {
    const legacyStatus: StudentCourseStatus = {
      paid_options: [],
      legacy_history_unverified: true,
    };
    for (const optId of ["full_prepayment", "level_1", "level_2", "level_3"]) {
      assert.strictEqual(
        getOptionEligibility("structural_typology", optId, legacyStatus).state,
        "LOCKED",
        `${optId} must remain LOCKED for unverified legacy history`,
      );
    }
    const gate = canProceedToPayerSelection({
      course: makeCourse({ id: "structural_typology" }),
      cohort: makeCohort(),
      pricingOption: makeOption({ id: "level_1" }),
      studentCourseStatus: legacyStatus,
      isAuthenticated: true,
    });
    assert.deepStrictEqual(gate, { allowed: false, reason: "not_eligible" });
  });

  test("F: Screen 3 consumes prices from course projection without hardcoded commercial constants", () => {
    const pricePatterns = [
      /\b45\s?000\b/,
      /\b50\s?000\b/,
      /\b60\s?000\b/,
      /\b100\s?000\b/,
      /\b150\s?000\b/,
      /\b160\s?000\b/,
      /\b200\s?000\b/,
    ];
    for (const pat of pricePatterns) {
      assert.strictEqual(
        pat.test(payerRegion),
        false,
        `Prohibited hardcoded price pattern ${pat} found in Screen 3 region`,
      );
      assert.strictEqual(
        pat.test(stubRegion),
        false,
        `Prohibited hardcoded price pattern ${pat} found in stub region`,
      );
    }
    assert.ok(
      payerRegion.includes("selectedPricingOption.price"),
      "Screen 3 must render price from the source-backed pricing option object",
    );
    assert.ok(
      payerRegion.includes("selectedCourse.title") &&
        payerRegion.includes("selectedCohort.title") &&
        payerRegion.includes("selectedPricingOption.title"),
      "Screen 3 summary must be bound to source-backed objects",
    );
  });


  /* ---------------- PAYER TYPES (§24) ---------------- */

  test("G: exact canonical payer values are individual and legal_entity", () => {
    assert.deepStrictEqual(
      PAYER_TYPE_OPTIONS.map((o) => o.value),
      ["individual", "legal_entity"],
    );
    assert.strictEqual(isValidPayerType("individual"), true);
    assert.strictEqual(isValidPayerType("legal_entity"), true);
  });

  test("H: no third payer class exists", () => {
    assert.strictEqual(PAYER_TYPE_OPTIONS.length, 2);
    assert.strictEqual(isValidPayerType("individual_entrepreneur"), false);
    assert.strictEqual(isValidPayerType("ip"), false);
    assert.strictEqual(isValidPayerType(""), false);
    assert.strictEqual(isValidPayerType(null), false);
    assert.ok(
      !helpersSource.includes("individual_entrepreneur"),
      "helpers.ts must not define individual_entrepreneur payer type",
    );
    assert.ok(
      !pageSource.includes("individual_entrepreneur"),
      "page.tsx must not define individual_entrepreneur payer type",
    );
  });

  test("I: individual selection works", () => {
    const individual = PAYER_TYPE_OPTIONS.find((o) => o.value === "individual");
    assert.ok(individual);
    assert.equal(individual.title, "Физическое лицо");
    assert.equal(individual.description, "Оплата от физического лица.");
    assert.equal(getNextStageLabel("individual"), "Данные участника");
    assert.ok(
      payerRegion.includes("setSelectedPayerType(opt.value)"),
      "payer card must set the canonical payer value on selection",
    );
  });

  test("J: legal_entity selection works", () => {
    const legal = PAYER_TYPE_OPTIONS.find((o) => o.value === "legal_entity");
    assert.ok(legal);
    assert.equal(legal.title, "ИП или юридическое лицо");
    assert.equal(
      legal.description,
      "Оплата от ИП или организации с оформлением документов.",
    );
    assert.equal(
      getNextStageLabel("legal_entity"),
      "Реквизиты ИП или организации",
    );
  });

  test("K: CTA disabled before payer selection", () => {
    assert.ok(
      payerRegion.includes("disabled={!selectedPayerType}"),
      "Screen 3 primary CTA must expose a real disabled state before payer selection",
    );
  });

  test("L: CTA enabled after valid payer selection and heading semantics (§6)", () => {
    assert.ok(
      payerRegion.includes('if (selectedPayerType) setScreen("next_stage_stub")'),
      "Screen 3 CTA must transition only after a valid payer selection",
    );
    assert.ok(
      payerRegion.includes("Кто будет оплачивать?"),
      "Screen 3 heading must be 'Кто будет оплачивать?'",
    );
    assert.ok(
      payerRegion.includes("Выберите тип плательщика"),
      "Screen 3 subheading must be 'Выберите тип плательщика'",
    );
    assert.ok(
      !payerRegion.includes("Способ оплаты"),
      "Screen 3 must NOT be titled 'Способ оплаты'",
    );
  });


  /* ---------------- NAVIGATION (§25) ---------------- */

  test("M: Screen 2 -> Screen 3 preserves course, cohort and pricing option", () => {
    const course = makeCourse({ id: "maslow" });
    const cohort = course.cohorts[0];
    const option = course.pricing_options[0];
    const gate = canProceedToPayerSelection({
      course,
      cohort,
      pricingOption: option,
      studentCourseStatus: null,
      isAuthenticated: true,
    });
    assert.deepStrictEqual(gate, { allowed: true });
    // Missing prerequisites are rejected without side effects
    assert.deepStrictEqual(
      canProceedToPayerSelection({
        course: null,
        cohort,
        pricingOption: option,
        isAuthenticated: true,
      }),
      { allowed: false, reason: "missing_selection" },
    );
    assert.deepStrictEqual(
      canProceedToPayerSelection({
        course,
        cohort: null,
        pricingOption: option,
        isAuthenticated: true,
      }),
      { allowed: false, reason: "missing_selection" },
    );
    assert.deepStrictEqual(
      canProceedToPayerSelection({
        course,
        cohort,
        pricingOption: null,
        isAuthenticated: true,
      }),
      { allowed: false, reason: "missing_selection" },
    );
    // Transition carries selection state only (no reset of carried state)
    assert.ok(pageSource.includes('setScreen("payer")'));
    assert.ok(
      !payerRegion.includes("setSelectedCohortId") &&
        !payerRegion.includes("setSelectedPricingOptionId") &&
        !payerRegion.includes("setSelectedCourseId"),
      "entering Screen 3 must not reset carried selection state",
    );
  });

  test("N: Screen 3 Back -> Screen 2 preserves selection", () => {
    assert.ok(
      payerRegion.includes('setScreen("detail")'),
      "Screen 3 in-app back must return to Screen 2",
    );
    assert.ok(
      pageSource.includes('screen === "payer") setScreen("detail")'),
      "Telegram BackButton must route Screen 3 -> Screen 2",
    );
  });

  test("O: local transition stub preserves selected payer type", () => {
    assert.equal(getNextStageLabel("individual"), "Данные участника");
    assert.equal(
      getNextStageLabel("legal_entity"),
      "Реквизиты ИП или организации",
    );
    // selectedPayerType is reset exactly once — on course change only
    const resets = pageSource.match(/setSelectedPayerType\(null\)/g) || [];
    assert.strictEqual(
      resets.length,
      1,
      "selectedPayerType must be reset only on course change",
    );
    assert.ok(
      !stubRegion.includes("setSelectedPayerType(null)"),
      "stub must not reset payer choice",
    );
  });

  test("P: stub Back -> Screen 3 preserves payer choice", () => {
    assert.ok(
      stubRegion.includes('setScreen("payer")'),
      "stub back must return to Screen 3",
    );
    assert.ok(
      pageSource.includes('screen === "next_stage_stub") setScreen("payer")'),
      "Telegram BackButton must route stub -> Screen 3",
    );
  });

  test("Q: navigation invokes zero persistence/payment mutation", () => {
    const fetches = pageSource.match(/\bfetch\(/g) || [];
    assert.strictEqual(
      fetches.length,
      2,
      "page.tsx must contain exactly two fetch calls (courses + student-status GETs)",
    );
    assert.ok(pageSource.includes('fetch("/api/tikhon/courses")'));
    assert.ok(pageSource.includes('fetch("/api/tikhon/student-status"'));
    assert.ok(
      !/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(pageSource),
      "page.tsx must not issue any mutating HTTP request",
    );
    assert.ok(
      !pageSource.includes("XMLHttpRequest"),
      "page.tsx must not use XMLHttpRequest",
    );
  });


  /* ---------------- SECURITY (§26) ---------------- */

  test("R: no POST/mutation API is reachable from Batch-2 interaction", () => {
    const forbiddenEndpoints = [
      "/api/tikhon/applications",
      "/api/tikhon/payment",
      "/api/tikhon/invoice",
      "/api/tikhon/enroll",
    ];
    for (const ep of forbiddenEndpoints) {
      assert.ok(
        !pageSource.includes(ep),
        `page.tsx must not reference mutation endpoint ${ep}`,
      );
    }
    assert.ok(
      !pageSource.includes("supabase"),
      "page.tsx must not touch Supabase directly",
    );
  });

  test("S: raw telegram user ID is not introduced into UI state", () => {
    assert.ok(
      !pageSource.includes("user_id"),
      "page.tsx must not reference user_id",
    );
    assert.ok(
      !/initDataUnsafe\?\.user/.test(pageSource),
      "page.tsx must not read initDataUnsafe.user into UI state",
    );
  });

  test("T: subject_key is not exposed", () => {
    assert.ok(
      !pageSource.includes("subject_key"),
      "page.tsx must not reference subject_key",
    );
  });

  test("U: payment/bank requisites are absent from Batch-2 source/rendered contract", () => {
    const forbidden = [
      "+79112988413",
      "40802810100003037685",
      "781451999355",
      "Я оплатил",
      "БИК",
      "QR",
    ];
    for (const token of forbidden) {
      assert.ok(
        !pageSource.includes(token),
        `page.tsx must not contain payment requisite token: ${token}`,
      );
      assert.ok(
        !helpersSource.includes(token),
        `helpers.ts must not contain payment requisite token: ${token}`,
      );
    }
    // Screen 3 / stub region specifically must not expose payment channels
    assert.ok(
      !payerRegion.includes("СБП") && !stubRegion.includes("СБП"),
      "Screen 3 must not expose СБП payment channel",
    );
    assert.ok(
      !payerRegion.includes("счёт") &&
        !payerRegion.includes("счет") &&
        !stubRegion.includes("счёт"),
      "Screen 3 must not expose bank account details",
    );
  });

  test("V: unauthenticated mode does not fabricate entitlement identity", () => {
    // Public-browser mode: gated Structural Typology stages stay locked
    assert.strictEqual(
      getPublicAwareOptionEligibility("structural_typology", "level_2", null, false)
        .state,
      "LOCKED",
    );
    assert.strictEqual(
      getPublicAwareOptionEligibility("structural_typology", "level_3", null, false)
        .state,
      "LOCKED",
    );
    // Public pricing remains viewable
    assert.strictEqual(
      getPublicAwareOptionEligibility(
        "structural_typology",
        "full_prepayment",
        null,
        false,
      ).state,
      "ELIGIBLE",
    );
    assert.strictEqual(
      getPublicAwareOptionEligibility("structural_typology", "level_1", null, false)
        .state,
      "ELIGIBLE",
    );
    // Authenticated evaluation delegates unchanged to the Batch-1 helper
    assert.deepStrictEqual(
      getPublicAwareOptionEligibility("structural_typology", "level_2", null, true),
      getOptionEligibility("structural_typology", "level_2", null),
    );
    // Transition into payer selection is auth-gated (public = pricing view only)
    assert.deepStrictEqual(
      canProceedToPayerSelection({
        course: makeCourse({ id: "maslow" }),
        cohort: makeCohort(),
        pricingOption: makeOption(),
        studentCourseStatus: null,
        isAuthenticated: false,
      }),
      { allowed: false, reason: "auth_required" },
    );
    // No localStorage / query-param identity authority
    assert.ok(
      !pageSource.includes("localStorage"),
      "page.tsx must not use localStorage as identity authority",
    );
    assert.ok(
      !pageSource.includes("sessionStorage"),
      "page.tsx must not use sessionStorage as identity authority",
    );
    assert.ok(
      pageSource.includes("Требуется вход через Telegram"),
      "bounded Telegram-auth-required state must exist",
    );
  });
});

/* ---------------- CORR1: TELEGRAM LAUNCH AUTH CLOSURE ---------------- */

describe("Tikhon Mini App Batch 2 CORR1 — Telegram launch auth closure", () => {
  const pageSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/page.tsx"),
    "utf-8",
  );

  const SYNTHETIC_BOT_TOKEN = "123456789:AA_SYNTHETIC_CORR1_TOKEN_0000000000";
  const SYNTHETIC_USER_ID = 424242001;
  const ENV_KEYS = [
    "TELEGRAM_BOT_TOKEN",
    "BOT_TOKEN",
    "ENTITLEMENT_SUBJECT_SECRET",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;

  function signInitData(authDate: number = Math.floor(Date.now() / 1000)): string {
    const params = new URLSearchParams({
      auth_date: String(authDate),
      query_id: "SYNTHETIC_QUERY",
      user: JSON.stringify({ id: SYNTHETIC_USER_ID, first_name: "Synthetic" }),
    });
    const dataCheckString = Array.from(params.keys())
      .sort()
      .map((k) => `${k}=${params.get(k)}`)
      .join("\n");
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(SYNTHETIC_BOT_TOKEN)
      .digest();
    params.append(
      "hash",
      crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex"),
    );
    return params.toString();
  }

  /** Runs the student-status route hermetically: synthetic env, stubbed upstream, no network. */
  async function callStudentStatus(
    initData: string | null,
    upstream: { status: number; body: string },
  ): Promise<{ status: number; body: Record<string, unknown>; upstreamMethods: string[] }> {
    const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    const savedFetch = globalThis.fetch;
    const upstreamMethods: string[] = [];
    try {
      for (const k of ENV_KEYS) delete process.env[k];
      process.env.TELEGRAM_BOT_TOKEN = SYNTHETIC_BOT_TOKEN;
      process.env.ENTITLEMENT_SUBJECT_SECRET = "synthetic_corr1_entitlement_secret";
      process.env.SUPABASE_URL = "https://synthetic-corr1.invalid";
      process.env.SUPABASE_SECRET_KEY = "synthetic_corr1_supabase_key";
      globalThis.fetch = (async (_input: unknown, init?: { method?: string }) => {
        upstreamMethods.push((init?.method || "GET").toUpperCase());
        return new Response(upstream.body, { status: upstream.status });
      }) as typeof fetch;
      const headers: Record<string, string> = {};
      if (initData) headers["x-telegram-init-data"] = initData;
      const res = await studentStatusHandler(
        new NextRequest("https://synthetic-corr1.invalid/api/tikhon/student-status", {
          headers,
        }),
      );
      return { status: res.status, body: await res.json(), upstreamMethods };
    } finally {
      globalThis.fetch = savedFetch;
      for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
    }
  }

  function makeCorr1Cohort(): Cohort {
    return {
      id: "cohort_1",
      title: "Test Cohort",
      start_date: "Future",
      schedule: "Weekly",
      is_active: true,
      enrollment_status: "AVAILABLE",
      is_enrollment_open: true,
    };
  }

  function makeCorr1Option(): PricingOption {
    return { id: "single_payment", title: "Test Option", price: 1, description: "Test" };
  }

  function makeCorr1Course(): Course {
    return {
      id: "maslow",
      title: "Test Course",
      short_description: "Test",
      meetings_count: 4,
      format_info: "Zoom",
      max_participants: 24,
      pricing_options: [makeCorr1Option()],
      cohorts: [makeCorr1Cohort()],
    };
  }

  const handleProceedStart = pageSource.indexOf("const handleProceedToPayer = () => {");
  const handleProceedBody = pageSource.slice(
    handleProceedStart,
    pageSource.indexOf("\n  };", handleProceedStart),
  );

  test("CORR1-A: Telegram WebApp initData is handed to the server as the only identity input", () => {
    assert.ok(pageSource.includes("const initData = window.Telegram?.WebApp?.initData;"));
    assert.ok(pageSource.includes('"x-telegram-init-data": initData'));
    assert.ok(!pageSource.includes("?initData="), "initData must not travel in a query string");
    assert.ok(
      pageSource.includes("const isAuthenticated = studentStatus?.is_authenticated === true;"),
      "authentication must derive only from the server-verified status response",
    );
  });

  test("CORR1-B: valid signed initData authenticates and permits payer transition", async () => {
    const initData = signInitData();
    assert.strictEqual(validateTelegramInitData(initData, SYNTHETIC_BOT_TOKEN).valid, true);
    const res = await callStudentStatus(initData, { status: 200, body: "[]" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.is_authenticated, true);
    assert.deepStrictEqual(
      canProceedToPayerSelection({
        course: makeCorr1Course(),
        cohort: makeCorr1Cohort(),
        pricingOption: makeCorr1Option(),
        studentCourseStatus: null,
        isAuthenticated: res.body.is_authenticated === true,
      }),
      { allowed: true },
    );
  });

  test("CORR1-C: ordinary browser (no initData) remains blocked", async () => {
    const res = await callStudentStatus(null, { status: 200, body: "[]" });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.is_authenticated, false);
    assert.deepStrictEqual(res.upstreamMethods, [], "no upstream lookup without initData");
    assert.deepStrictEqual(
      canProceedToPayerSelection({
        course: makeCorr1Course(),
        cohort: makeCorr1Cohort(),
        pricingOption: makeCorr1Option(),
        studentCourseStatus: null,
        isAuthenticated: false,
      }),
      { allowed: false, reason: "auth_required" },
    );
  });

  test("CORR1-D: tampered initData remains rejected", async () => {
    const tampered = signInitData().replace(
      encodeURIComponent(String(SYNTHETIC_USER_ID)),
      encodeURIComponent(String(SYNTHETIC_USER_ID + 1)),
    );
    const res = await callStudentStatus(tampered, { status: 200, body: "[]" });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "HASH_MISMATCH");
  });

  test("CORR1-E: expired initData remains rejected", async () => {
    const res = await callStudentStatus(
      signInitData(Math.floor(Date.now() / 1000) - 8 * 24 * 3600),
      { status: 200, body: "[]" },
    );
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "EXPIRED_INIT_DATA");
  });

  test("CORR1-F: future-skewed initData remains rejected", async () => {
    const res = await callStudentStatus(
      signInitData(Math.floor(Date.now() / 1000) + 3600),
      { status: 200, body: "[]" },
    );
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "FUTURE_AUTH_DATE");
  });

  test("CORR1-G: no raw Telegram user ID is exposed in the status response or page", async () => {
    const res = await callStudentStatus(signInitData(), { status: 200, body: "[]" });
    assert.strictEqual(res.status, 200);
    const serialized = JSON.stringify(res.body);
    assert.ok(!serialized.includes(String(SYNTHETIC_USER_ID)));
    assert.ok(!serialized.includes("subject_key"));
    assert.ok(!/initDataUnsafe\?\.user/.test(pageSource));
  });

  test("CORR1-H: no payment/Application mutation is introduced", async () => {
    const res = await callStudentStatus(signInitData(), { status: 200, body: "[]" });
    assert.deepStrictEqual(res.upstreamMethods, ["GET"]);
    assert.strictEqual((pageSource.match(/\bfetch\(/g) || []).length, 2);
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(pageSource));
  });

  test("CORR1-W: upstream entitlement failure after valid signature is not reported as missing Telegram login", async () => {
    // Server: valid signature + failed entitlement lookup is 502, never 401
    const res = await callStudentStatus(signInitData(), {
      status: 503,
      body: '{"message":"synthetic upstream failure"}',
    });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error, "SUPABASE_QUERY_FAILED");

    // Client: only a 401 is treated as unauthenticated; other failures are "unavailable"
    assert.ok(pageSource.includes("if (res.status === 401) {"));
    assert.ok(pageSource.includes('let outcome: StudentStatusCheck = "unavailable";'));
    assert.ok(pageSource.includes("attempt < STUDENT_STATUS_MAX_ATTEMPTS"));
    assert.ok(/const STUDENT_STATUS_MAX_ATTEMPTS = [1-5];/.test(pageSource), "retries are bounded");

    // Gate: the unavailable branch precedes and short-circuits the auth_required path
    const unavailableIdx = handleProceedBody.indexOf('studentStatusCheck === "unavailable"');
    const gateIdx = handleProceedBody.indexOf("canProceedToPayerSelection(");
    assert.ok(handleProceedStart > 0 && unavailableIdx > 0 && gateIdx > unavailableIdx);
    assert.ok(handleProceedBody.includes("setShowStatusUnavailableModal(true);"));
    const unavailableBranch = handleProceedBody.slice(unavailableIdx, gateIdx);
    assert.ok(!unavailableBranch.includes("setScreen("), "unavailable status never opens Screen 3");
    assert.ok(!unavailableBranch.includes("setShowAuthRequiredModal"));

    // Distinct, retryable state
    assert.ok(pageSource.includes("Не удалось проверить статус участия"));
    assert.ok(pageSource.includes("Повторить проверку"));
  });
});
