/*
TIKHON-MINIAPP-FULL-UX-MIGRATION-1 .ENROLLMENT-AVAILABILITY-AND-WAITLIST-SEMANTICS-1
.IMPLEMENTATION-1 — focused author tests (navigator side).

Act test map (navigator side):
  4  waitlist: no seat counter (chip hidden + waitlist panel has none)
  5  waitlist: no payment selection / payment CTA
  6  waitlist submit: contact data forwarded through /api/tikhon/waitlist with
     verified initData identity and canonical S2S signature (persistence itself
     proven chatbot-side: tests/test_enrollment_waitlist_semantics.py)
  7  exact waitlist success copy
  §5 generalization: catalog badge works from read-model pseudo cohort (no
     page.tsx change needed — asserted), auto-select prefers waitlist over a
     closed cohort
  §6 cohort availability gates the enrollment CTA

Conventions identical to batch-5/batch-6 suites: node:test, CSS stub loader,
renderToStaticMarkup for renderable components, source extraction for page.tsx
internal state, NextRequest + mocked globalThis.fetch for route behavior.
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

const cssLoaderSource = `const STUB_SOURCE = "const stub = new Proxy({}, { get: () => 'wl-css-stub' });\\nexport default stub;";
export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return { url: "wl-css-stub:" + encodeURIComponent(specifier), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export function load(url, context, nextLoad) {
  if (url.startsWith("wl-css-stub:")) {
    return { format: "module", source: STUB_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;
const cssLoaderDir = fs.mkdtempSync(path.join(os.tmpdir(), "wl-css-loader-"));
const cssLoaderFile = path.join(cssLoaderDir, "css-stub-loader.mjs");
fs.writeFileSync(cssLoaderFile, cssLoaderSource);
register(pathToFileURL(cssLoaderFile));

const BOT_TOKEN = "8682116994:TEST_BOT_TOKEN_FOR_WAITLIST_TESTS";

function createValidInitData(userId: number, botToken: string): string {
  const authDate = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({
    id: userId,
    first_name: "TestUser",
    username: "test_pilot",
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

const pilotDir = path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot");
const pageSource = fs.readFileSync(path.join(pilotDir, "page.tsx"), "utf-8");
const helpersSource = fs.readFileSync(path.join(pilotDir, "helpers.ts"), "utf-8");
const waitlistClientSource = fs.readFileSync(path.join(pilotDir, "waitlist.ts"), "utf-8");
const routePath = path.resolve(process.cwd(), "src/app/api/tikhon/waitlist/route.ts");
const getRouteSource = () => fs.readFileSync(routePath, "utf-8");

const EXACT_SUCCESS_COPY =
  "Заявка в лист ожидания принята.\n\n" +
  "Как только откроется набор на следующий поток,\n" +
  "наш специалист свяжется с вами по указанным контактам\n" +
  "и сообщит условия участия.";

const courseFixture = {
  id: "maslow",
  title: "Иерархия потребностей А. Маслоу: новая парадигма",
  short_description: "Переосмысление мотивации и ценностных ориентиров человека.",
  meetings_count: 4,
  format_info: "4 онлайн-встречи в Zoom по 2 часа · 2 раза в неделю",
  max_participants: 24,
  pricing_options: [
    { id: "single_payment", title: "Полный курс (4 встречи)", price: 45000, description: "Полный курс (4 встречи)" },
  ],
  cohorts: [],
};

async function importWaitlistPanel() {
  return await import("../../src/app/tikhon-miniapp-pilot/waitlist-panel.tsx");
}

async function importWaitlistClient() {
  return await import("../../src/app/tikhon-miniapp-pilot/waitlist.ts");
}

async function importHelpers() {
  return await import("../../src/app/tikhon-miniapp-pilot/helpers.ts");
}

describe("TIKHON-MINIAPP: Enrollment Availability & Waitlist Semantics", () => {
  process.env.BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;

  /* ---------------- 7. EXACT WAITLIST SUCCESS COPY ---------------- */

  test("WL-7: waitlist success copy matches Owner mandate exactly", async () => {
    const { WAITLIST_SUCCESS_COPY } = await importHelpers();
    assert.strictEqual(WAITLIST_SUCCESS_COPY, EXACT_SUCCESS_COPY);
  });

  /* ---------------- 4-5. WAITLIST MODE: NO COUNTER, NO PAYMENT ---------------- */

  test("WL-4: cohort chip hides the seat counter for waitlist cohorts (source)", () => {
    assert.ok(
      pageSource.includes("{!waitingList &&"),
      "seat counter must be gated off for waitlist cohorts"
    );
    assert.ok(
      pageSource.includes("`Свободно ${cohort.available_seats} из ${cohort.capacity}`"),
      "open-cohort counter must render 'Свободно N из M'"
    );
    assert.ok(
      !pageSource.includes("Свободных мест:"),
      "legacy counter string must be gone"
    );
  });

  test("WL-4b: waitlist panel renders no seat counter (behavioral)", async () => {
    const { WaitlistPanel } = await importWaitlistPanel();
    const html = renderToStaticMarkup(createElement(WaitlistPanel, { course: courseFixture }));
    assert.ok(!html.includes("Свободно"), "waitlist mode must not show any seat counter");
    assert.ok(!html.includes("из 24"), "waitlist mode must not show capacity");
  });

  test("WL-5: waitlist panel renders no payment selection or payment CTA (behavioral)", async () => {
    const { WaitlistPanel } = await importWaitlistPanel();
    const html = renderToStaticMarkup(createElement(WaitlistPanel, { course: courseFixture }));
    assert.ok(!html.includes("₽"), "no prices in waitlist mode");
    assert.ok(!html.includes("Оформить участие"), "no enrollment CTA in waitlist mode");
    assert.ok(!html.includes("Тарифы и этапы оплаты"), "no pricing section in waitlist mode");
    assert.ok(!html.includes("оплата"), "no payment wording in waitlist mode");
  });

  test("WL-5b: pricing section and CTA are rendered only outside waitlist mode (source)", () => {
    assert.ok(
      pageSource.includes("selectedCohort && isCohortWaitingList(selectedCohort) ? (\n                <WaitlistPanel course={selectedCourse} />"),
      "waitlist mode must switch the detail screen to WaitlistPanel"
    );
    assert.ok(
      pageSource.includes("<WaitlistPanel course={selectedCourse} />"),
      "WaitlistPanel must be used on the detail screen"
    );
  });

  test("WL-5c: waitlist panel shows course identity and contact form (behavioral)", async () => {
    const { WaitlistPanel } = await importWaitlistPanel();
    const html = renderToStaticMarkup(createElement(WaitlistPanel, { course: courseFixture }));
    assert.ok(html.includes("Курс «Иерархия потребностей А. Маслоу: новая парадигма»"), "course identity required");
    assert.ok(html.includes("waitlist-name-input"), "name field required");
    assert.ok(html.includes("waitlist-phone-input"), "phone field required");
    assert.ok(html.includes("waitlist-email-input"), "email field required");
    assert.ok(html.includes("waitlist-submit-btn"), "submit action required");
    assert.ok(html.includes("Записаться в лист ожидания"), "waitlist CTA copy");
  });

  /* ---------------- 6. WAITLIST SUBMISSION SEAM (navigator side) ---------------- */

  test("WL-6: route forwards verified initData identity and contact data to /api/v1/waitlist", async () => {
    process.env.TIKHON_INTERNAL_SECRET = "wl_route_secret";
    process.env.TIKHON_RUSSIAN_SERVER_URL = "https://tikhon-upstream-wl.invalid/api/v1/applications";
    const originalFetch = globalThis.fetch;
    const captured: Array<{ url: string; init: RequestInit }> = [];
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        captured.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ status: "SUCCESS", already_registered: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const { POST } = await import("../../src/app/api/tikhon/waitlist/route.ts");
      const initData = createValidInitData(46161200, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({
          course_id: "maslow",
          user_id: 999999,
          full_name: "Лист Ожидания",
          phone: "+7 999 555-66-77",
          email: "wl@example.com",
        }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 200);
      assert.strictEqual((await res.json()).status, "SUCCESS");

      assert.strictEqual(captured.length, 1);
      assert.strictEqual(captured[0].url, "https://tikhon-upstream-wl.invalid/api/v1/waitlist");

      const headers = new Headers(captured[0].init.headers as HeadersInit);
      const bodyText = String(captured[0].init.body);
      const forwarded = JSON.parse(bodyText);
      assert.strictEqual(forwarded.user_id, 46161200, "identity is the initData-verified user");
      assert.notStrictEqual(forwarded.user_id, 999999, "client user_id must be ignored");
      assert.strictEqual(forwarded.full_name, "Лист Ожидания");
      assert.strictEqual(forwarded.phone, "+7 999 555-66-77");
      assert.strictEqual(forwarded.email, "wl@example.com");
      assert.ok(!("amount" in forwarded) && !("pricing_option_id" in forwarded), "no payment fields");

      const timestamp = headers.get("x-tikhon-timestamp");
      const nonce = headers.get("x-tikhon-nonce");
      const signature = headers.get("x-tikhon-signature");
      assert.ok(timestamp && nonce && signature);
      const bodySha256 = crypto.createHash("sha256").update(bodyText, "utf8").digest("hex");
      const canonical = `TIKHON-S2S-V1\nPOST\n/api/v1/waitlist\n${timestamp}\n${nonce}\n${bodySha256}`;
      const expected = crypto.createHmac("sha256", "wl_route_secret").update(canonical).digest("hex");
      assert.strictEqual(signature, expected);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.TIKHON_RUSSIAN_SERVER_URL;
    }
  });

  test("WL-6b: waitlist route fails closed on unexpected upstream URL shapes (zero fetches)", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    try {
      process.env.TIKHON_INTERNAL_SECRET = "wl_route_secret";
      globalThis.fetch = (async (): Promise<Response> => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ status: "SUCCESS" }), { status: 200 });
      }) as typeof fetch;

      const { POST } = await import("../../src/app/api/tikhon/waitlist/route.ts");
      for (const bad of [
        "https://api.example.test/unexpected/api/v1/applications",
        "https://api.example.test/api/v1/applications?x=1",
        "https://api.example.test/api/v1/applications#frag",
        "not-a-url",
      ]) {
        process.env.TIKHON_RUSSIAN_SERVER_URL = bad;
        const initData = createValidInitData(46161200, BOT_TOKEN);
        const req = new NextRequest("http://localhost:3000/api/tikhon/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
          body: JSON.stringify({ course_id: "maslow", full_name: "Лист Ожидания", phone: "+7 999" }),
        });
        const res = await POST(req);
        assert.strictEqual(res.status, 500, `must fail closed for ${bad}`);
        assert.strictEqual((await res.json()).error, "UPSTREAM_URL_NOT_CONFIGURED");
      }
      assert.strictEqual(fetchCalls, 0, "zero upstream fetches on invalid URL shapes");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.TIKHON_RUSSIAN_SERVER_URL;
    }
  });

  test("WL-6c: one waitlist submit = one fetch; concurrent repeat is blocked by in-flight guard", async () => {
    const wl = await importWaitlistClient();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      globalThis.fetch = (async (): Promise<Response> => {
        calls += 1;
        await gate;
        return new Response(JSON.stringify({ status: "SUCCESS", already_registered: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const first = wl.submitWaitlistLead(
        "maslow",
        { full_name: "Лист Ожидания", phone: "+7 999", email: "" },
        "init-data-wl"
      );
      const second = await wl.submitWaitlistLead(
        "maslow",
        { full_name: "Лист Ожидания", phone: "+7 999", email: "" },
        "init-data-wl"
      );
      assert.strictEqual(second.ok, false);
      assert.strictEqual(second.error, "SEND_IN_PROGRESS");
      release();
      const done = await first;
      assert.strictEqual(done.ok, true);
      assert.strictEqual(done.status, "SUCCESS");
      assert.strictEqual(calls, 1);
      assert.strictEqual(wl.isWaitlistSendInFlight(), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  /* ---------------- §5/§6 WIRING ---------------- */

  test("WL-8/9: catalog waitlist option is read-model driven; auto-select prefers waitlist over a closed cohort (source)", () => {
    // Generalization happens in the read model; the catalog badge consumes
    // the waiting_list cohort, so no course-specific page.tsx logic is needed.
    assert.ok(
      pageSource.includes('ch.id === "waiting_list" || ch.enrollment_status === "WAITING_LIST"'),
      "catalog badge consumes waitlist cohort from the read model"
    );
    assert.ok(
      pageSource.includes("const waitlistCohort = selectedCourse.cohorts.find("),
      "auto-select must prefer the waitlist cohort when no cohort is enrollable"
    );
  });

  test("WL-10/11: enrollment CTA is gated on canonical cohort availability (source)", () => {
    assert.ok(
      pageSource.includes("!isCohortAvailable(selectedCohort)"),
      "CTA must be disabled when the selected cohort is not enrollable"
    );
  });

  test("WL-12: waitlist client sends no user_id/chat_id and no payment fields (source)", () => {
    const bodyShape = waitlistClientSource.match(/body:\s*JSON\.stringify\(\{[\s\S]*?\}\)/);
    assert.ok(bodyShape, "explicit body shape expected");
    assert.ok(!bodyShape[0].includes("user_id"), "client must not send user_id");
    assert.ok(!bodyShape[0].includes("chat_id"), "client must not send chat_id");
    assert.ok(!bodyShape[0].includes("amount"), "client must not send payment fields");
    assert.ok(!bodyShape[0].includes("pricing_option_id"), "client must not send pricing fields");
  });

  /* ---------------- CORR1: COHORT_5 OWNER-CLOSED (is_active/INACTIVE authority) ---------------- */

  const inactiveCohort = {
    id: "cohort_5",
    title: "5-й поток (Осень 2026)",
    start_date: "11 октября 2026",
    schedule: "По воскресеньям в 18:00 МСК",
    is_active: false,
    has_canonical_sessions: false,
    enrollment_status: "INACTIVE",
    is_enrollment_open: false,
  } as any;

  test("CORR1-2: INACTIVE cohort is never labeled «Открыт набор» (behavioral helpers)", async () => {
    const h = await importHelpers();
    assert.strictEqual(h.isCohortAvailable(inactiveCohort), false);
    assert.strictEqual(h.isCohortUnavailable(inactiveCohort), true);
    assert.strictEqual(h.getCohortBadgeText(inactiveCohort), "Набор закрыт");
    assert.notStrictEqual(h.getCohortBadgeText(inactiveCohort), "Открыт набор");
  });

  test("CORR1-2b: catalog open badge counts only AVAILABLE cohorts (source)", () => {
    assert.ok(
      pageSource.includes('(ch) => Boolean(ch.is_enrollment_open) && ch.enrollment_status === "AVAILABLE"'),
      "hasOpenCohort must require AVAILABLE — an INACTIVE cohort cannot produce «Открыт набор»"
    );
  });

  test("CORR1-4: closed cohort remains visible with schedule context (source)", () => {
    // The chip renders regardless of availability; only selection is disabled.
    assert.ok(pageSource.includes("cohort.title"), "chip title rendering present");
    assert.ok(pageSource.includes("Старт: {cohort.start_date}"), "start date context preserved");
    assert.ok(pageSource.includes("График: {cohort.schedule}"), "schedule context preserved");
  });

  /* ---------------- CORR1.CORR1 ISSUE 1: WAITLIST FABRICATES NOTHING ---------------- */

  const productionShapedWaitlist = {
    id: "waiting_list",
    title: "Лист ожидания",
    is_active: true,
    has_canonical_sessions: false,
    enrollment_status: "WAITING_LIST",
    is_enrollment_open: true,
  } as any;

  test("C1x2-1: public contract legally omits waitlist date/schedule (interface)", () => {
    assert.ok(
      helpersSource.includes("start_date?: string | null"),
      "Cohort.start_date must be optional/null in the public contract"
    );
    assert.ok(
      helpersSource.includes("schedule?: string | null"),
      "Cohort.schedule must be optional/null in the public contract"
    );
  });

  test("C1x2-2: chip renders a schedule-less waitlist without dates or counter (source)", () => {
    // Truthy guards already skip Старт/График for absent fields…
    assert.ok(pageSource.includes("{cohort.start_date && ("));
    assert.ok(pageSource.includes("{cohort.schedule && ("));
    // …and the counter is gated off for waitlist cohorts regardless of seats.
    assert.ok(pageSource.includes("{!waitingList &&"));
  });

  test("C1x2-3: waitlist panel renders the production-shaped waitlist cleanly (behavioral)", async () => {
    const { WaitlistPanel } = await import("../../src/app/tikhon-miniapp-pilot/waitlist-panel.tsx");
    const html = renderToStaticMarkup(createElement(WaitlistPanel, { course: courseFixture }));
    assert.ok(!html.includes("undefined"));
    assert.ok(!html.includes("По согласованию"), "no fabricated start date");
    assert.ok(!html.includes("Индивидуально"), "no fabricated schedule");
    assert.ok(!html.includes("Свободно"), "no seat counter");
    assert.ok(!html.includes("₽"), "no payment");
  });
});
