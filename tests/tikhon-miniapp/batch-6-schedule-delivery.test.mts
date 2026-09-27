/*
TIKHON-MINIAPP-FULL-UX-MIGRATION-1 .BATCH-6.SCHEDULE-DELIVERY-AND-CALENDAR-HUB-1
.IMPLEMENTATION-1 — focused author tests (navigator side).

Act test map:
  1  schedule available → CTA «Отправить расписание в Telegram» visible
  2  schedule unavailable → exact bounded copy «Расписание для данного потока формируется.»
  3  authenticated user is the delivery destination (route behavioral: verified initData id)
  4  arbitrary client Telegram user_id cannot redirect delivery (route behavioral)
  5  .ics generation is server-authoritative: navigator route only signs and forwards
     to the derived schedule-send URL with the canonical S2S signature
     (canonical .ics bytes proven chatbot-side: tests/test_schedule_send_api.py)
  6  one click produces one document send (calendar.ts behavioral: one fetch)
  7  repeated click while pending does not duplicate send (calendar.ts behavioral
     concurrent calls + UI disabled state source assertion)
  8  successful send renders success state (component + source assertion)
  9  delivery failure renders bounded retry state (source assertion)
  10 existing application-success flow remains unchanged (verbatim copy, curator CTA,
     app id badge all intact; hub is additive-only)

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

const cssLoaderSource = `const STUB_SOURCE = "const stub = new Proxy({}, { get: () => 'sched-css-stub' });\\nexport default stub;";
export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return { url: "sched-css-stub:" + encodeURIComponent(specifier), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export function load(url, context, nextLoad) {
  if (url.startsWith("sched-css-stub:")) {
    return { format: "module", source: STUB_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;
const cssLoaderDir = fs.mkdtempSync(path.join(os.tmpdir(), "sched-css-loader-"));
const cssLoaderFile = path.join(cssLoaderDir, "css-stub-loader.mjs");
fs.writeFileSync(cssLoaderFile, cssLoaderSource);
register(pathToFileURL(cssLoaderFile));

const BOT_TOKEN = "8682116994:TEST_BOT_TOKEN_FOR_SCHEDULE_TESTS";

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
const hubSource = fs.readFileSync(path.join(pilotDir, "calendar-hub.tsx"), "utf-8");
const calendarSource = fs.readFileSync(path.join(pilotDir, "calendar.ts"), "utf-8");
const screenSource = fs.readFileSync(path.join(pilotDir, "submission-screen.tsx"), "utf-8");
const helpersSource = fs.readFileSync(path.join(pilotDir, "helpers.ts"), "utf-8");
const routePath = path.resolve(process.cwd(), "src/app/api/tikhon/send-schedule/route.ts");
const getRouteSource = () => fs.readFileSync(routePath, "utf-8");

const SCHEDULE_FORMING_COPY = "Расписание для данного потока формируется.";
const SCHEDULE_CTA_COPY = "Отправить расписание в Telegram";
const SCHEDULE_SENT_COPY = "✓ Расписание отправлено в Telegram";

const availableCohort = {
  id: "cohort_3",
  title: "3-й поток (Октябрь 2026)",
  start_date: "6 октября 2026",
  schedule: "Вт и пт в 18:00 МСК",
  is_active: true,
  has_canonical_sessions: true,
  enrollment_status: "AVAILABLE",
  is_enrollment_open: true,
};

const formingCohort = {
  id: "waiting_list",
  title: "Лист ожидания",
  start_date: "По согласованию",
  schedule: "Индивидуально",
  is_active: true,
  has_canonical_sessions: false,
  enrollment_status: "WAITING_LIST",
  is_enrollment_open: false,
};

const courseFixture = {
  id: "levels_of_consciousness",
  title: "Иерархия уровней сознания (авторская концепция Н. Петяева)",
  short_description: "Динамическая модель организации и масштабирования мышления.",
  meetings_count: 4,
  format_info: "4 онлайн-встречи в Zoom по 2 часа · 2 раза в неделю",
  max_participants: 24,
  pricing_options: [
    { id: "single_payment", title: "Полный курс (4 встречи)", price: 45000, description: "Полный курс (4 встречи)" },
  ],
  cohorts: [availableCohort, formingCohort],
};

function makeSuccessScreenProps(cohort: any, course: any) {
  return {
    submissionState: "success" as const,
    submissionError: null,
    submissionAppId: 461,
    selectedCourse: course,
    selectedCohort: cohort,
    onRetry: () => {},
    onBack: () => {},
    onGoCatalog: () => {},
  };
}

async function importScreen() {
  return await import("../../src/app/tikhon-miniapp-pilot/submission-screen.tsx");
}

async function importCalendar() {
  return await import("../../src/app/tikhon-miniapp-pilot/calendar.ts");
}

async function importHub() {
  return await import("../../src/app/tikhon-miniapp-pilot/calendar-hub.tsx");
}

describe("TIKHON-MINIAPP BATCH-6: Schedule Delivery & Calendar Hub", () => {
  process.env.BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;

  /* ---------------- 1-2. SCHEDULE STATUS STATES ---------------- */

  test("1.1: schedule available → CTA «Отправить расписание в Telegram» visible on success screen", async () => {
    const { SubmissionResultScreen } = await importScreen();
    const html = renderToStaticMarkup(
      createElement(SubmissionResultScreen, makeSuccessScreenProps(availableCohort, courseFixture))
    );
    assert.ok(html.includes(SCHEDULE_CTA_COPY), "CTA copy must be visible");
    assert.ok(html.includes("send-schedule-btn"), "send-schedule button must be present");
    assert.ok(!html.includes(SCHEDULE_FORMING_COPY), "forming copy must not appear when available");
  });

  test("1.2: schedule available → course/cohort context rendered in hub", async () => {
    const { SubmissionResultScreen } = await importScreen();
    const html = renderToStaticMarkup(
      createElement(SubmissionResultScreen, makeSuccessScreenProps(availableCohort, courseFixture))
    );
    assert.ok(html.includes(courseFixture.title), "course title must be visible");
    assert.ok(html.includes("3-й поток (Октябрь 2026)"), "cohort title must be visible");
    assert.ok(html.includes("Вт и пт в 18:00 МСК"), "cohort schedule must be visible");
  });

  test("2.1: schedule unavailable → exact bounded copy «Расписание для данного потока формируется.»", async () => {
    const { SubmissionResultScreen } = await importScreen();
    const html = renderToStaticMarkup(
      createElement(SubmissionResultScreen, makeSuccessScreenProps(formingCohort, courseFixture))
    );
    assert.ok(html.includes(SCHEDULE_FORMING_COPY), "exact forming copy required");
    assert.ok(!html.includes(SCHEDULE_CTA_COPY), "CTA must not render when forming");
    assert.ok(!html.includes("send-schedule-btn"), "send button must not exist when forming");
  });

  test("2.2: cohort with undefined has_canonical_sessions (stale projection) → fail-safe forming state", async () => {
    const { SubmissionResultScreen } = await importScreen();
    const stale = { ...availableCohort, has_canonical_sessions: undefined };
    const html = renderToStaticMarkup(
      createElement(SubmissionResultScreen, makeSuccessScreenProps(stale, courseFixture))
    );
    assert.ok(html.includes(SCHEDULE_FORMING_COPY), "undefined flag must render forming (fail-safe)");
  });

  /* ---------------- 3-5. ROUTE BEHAVIOR (IDENTITY + SEAM) ---------------- */

  test("3.1: route forwards verified initData user as S2S identity to derived schedule-send URL", async () => {
    process.env.TIKHON_INTERNAL_SECRET = "sched_route_secret";
    process.env.TIKHON_RUSSIAN_SERVER_URL = "https://tikhon-upstream-sched.invalid/api/v1/applications";
    const originalFetch = globalThis.fetch;
    const captured: Array<{ url: string; init: RequestInit }> = [];
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        captured.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ status: "SENT" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const { POST } = await import("../../src/app/api/tikhon/send-schedule/route.ts");
      const initData = createValidInitData(46161088, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/send-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({ course_id: "levels_of_consciousness", cohort_id: "cohort_3" }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 200);
      assert.strictEqual((await res.json()).status, "SENT");
      assert.strictEqual(captured.length, 1, "exactly one outbound fetch");

      const { url, init } = captured[0];
      assert.strictEqual(url, "https://tikhon-upstream-sched.invalid/api/v1/calendar/schedule-send");

      const headers = new Headers(init.headers as HeadersInit);
      const bodyText = String(init.body);
      const forwarded = JSON.parse(bodyText);
      assert.strictEqual(forwarded.user_id, 46161088, "destination is the initData-verified user");

      const timestamp = headers.get("x-tikhon-timestamp");
      const nonce = headers.get("x-tikhon-nonce");
      const signature = headers.get("x-tikhon-signature");
      assert.ok(timestamp && nonce && signature, "S2S headers present");
      const bodySha256 = crypto.createHash("sha256").update(bodyText, "utf8").digest("hex");
      const canonical = `TIKHON-S2S-V1\nPOST\n/api/v1/calendar/schedule-send\n${timestamp}\n${nonce}\n${bodySha256}`;
      const expected = crypto.createHmac("sha256", "sched_route_secret").update(canonical).digest("hex");
      assert.strictEqual(signature, expected, "signature must validate for the schedule-send path");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("4.1: arbitrary client Telegram user_id cannot redirect delivery", async () => {
    process.env.TIKHON_INTERNAL_SECRET = "sched_route_secret";
    process.env.TIKHON_RUSSIAN_SERVER_URL = "https://tikhon-upstream-sched.invalid/api/v1/applications";
    const originalFetch = globalThis.fetch;
    const captured: Array<{ init: RequestInit }> = [];
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        captured.push({ init: init ?? {} });
        return new Response(JSON.stringify({ status: "SENT" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const { POST } = await import("../../src/app/api/tikhon/send-schedule/route.ts");
      const initData = createValidInitData(46161088, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/send-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({
          course_id: "levels_of_consciousness",
          cohort_id: "cohort_3",
          user_id: 999999,
          chat_id: 999999,
          destination: 999999,
        }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 200);
      const forwarded = JSON.parse(String(captured[0].init.body));
      assert.strictEqual(forwarded.user_id, 46161088, "verified identity must win");
      assert.strictEqual(forwarded.user_id, 999999 === forwarded.user_id ? -1 : forwarded.user_id, "client value must not leak");
      assert.ok(!("chat_id" in forwarded), "client chat_id must not be forwarded");
      assert.ok(!("destination" in forwarded), "client destination must not be forwarded");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("5.1: navigator route contains no ICS generation — server-authoritative only", () => {
    const src = getRouteSource();
    assert.ok(!src.includes("VCALENDAR"), "route must not generate ICS content");
    assert.ok(!src.includes("VEVENT"), "route must not generate events");
    assert.ok(src.includes("/api/v1/calendar/schedule-send"), "route must target the schedule-send endpoint");
  });

  test("5.2: route fail-closed when TIKHON_RUSSIAN_SERVER_URL lacks the applications path", async () => {
    const savedUrl = process.env.TIKHON_RUSSIAN_SERVER_URL;
    const originalFetch = globalThis.fetch;
    let fetchCalled = 0;
    try {
      process.env.TIKHON_INTERNAL_SECRET = "sched_route_secret";
      process.env.TIKHON_RUSSIAN_SERVER_URL = "https://tikhon-upstream-sched.invalid/some/other/path";
      globalThis.fetch = (async (): Promise<Response> => {
        fetchCalled += 1;
        return new Response(JSON.stringify({ status: "SENT" }), { status: 200 });
      }) as typeof fetch;

      const { POST } = await import("../../src/app/api/tikhon/send-schedule/route.ts");
      const initData = createValidInitData(46161088, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/send-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({ course_id: "levels_of_consciousness", cohort_id: "cohort_3" }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 500);
      assert.strictEqual((await res.json()).error, "UPSTREAM_URL_NOT_CONFIGURED");
      assert.strictEqual(fetchCalled, 0, "fail-closed before any upstream fetch");
    } finally {
      globalThis.fetch = originalFetch;
      if (savedUrl !== undefined) process.env.TIKHON_RUSSIAN_SERVER_URL = savedUrl;
      else delete process.env.TIKHON_RUSSIAN_SERVER_URL;
    }
  });

  /* ---------------- CORR1: STRICT UPSTREAM URL VALIDATION ---------------- */

  /** CORR1 helper: POST once with valid initData under a configured upstream URL,
   * counting upstream fetches. Returns (status, json, fetchCallCount). */
  async function corr1Probe(configuredUrl: string) {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    try {
      process.env.TIKHON_INTERNAL_SECRET = "sched_route_secret";
      process.env.TIKHON_RUSSIAN_SERVER_URL = configuredUrl;
      globalThis.fetch = (async (): Promise<Response> => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ status: "SENT" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const { POST } = await import("../../src/app/api/tikhon/send-schedule/route.ts");
      const initData = createValidInitData(46161088, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/send-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({ course_id: "levels_of_consciousness", cohort_id: "cohort_3" }),
      });
      const res = await POST(req);
      let json: Record<string, unknown> = {};
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        json = {};
      }
      return { status: res.status, json, fetchCalls };
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.TIKHON_RUSSIAN_SERVER_URL;
    }
  }

  test("CORR1-A: exact applications URL derives exactly the schedule-send URL on the same origin", async () => {
    const originalFetch = globalThis.fetch;
    const captured: string[] = [];
    try {
      process.env.TIKHON_INTERNAL_SECRET = "sched_route_secret";
      process.env.TIKHON_RUSSIAN_SERVER_URL = "https://api.example.test/api/v1/applications";
      globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
        captured.push(String(input));
        return new Response(JSON.stringify({ status: "SENT" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const { POST } = await import("../../src/app/api/tikhon/send-schedule/route.ts");
      const initData = createValidInitData(46161088, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/send-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({ course_id: "levels_of_consciousness", cohort_id: "cohort_3" }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(captured.length, 1);
      assert.strictEqual(
        captured[0],
        "https://api.example.test/api/v1/calendar/schedule-send",
        "derived URL must be exactly the validated origin + calendar path"
      );
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.TIKHON_RUSSIAN_SERVER_URL;
    }
  });

  test("CORR1-B: unexpected path prefix fails closed with ZERO upstream fetches", async () => {
    const { status, json, fetchCalls } = await corr1Probe(
      "https://api.example.test/unexpected/api/v1/applications"
    );
    assert.strictEqual(status, 500);
    assert.strictEqual(json.error, "UPSTREAM_URL_NOT_CONFIGURED");
    assert.strictEqual(fetchCalls, 0, "no upstream fetch on unexpected prefix");
  });

  test("CORR1-C: malformed applications paths fail closed (suffix, wrong segment, unparseable)", async () => {
    for (const bad of [
      "https://api.example.test/api/v1/applications/extra",
      "https://api.example.test/api/v2/applications",
      "https://api.example.test/api/v1/applicationsX",
      "not-a-url",
    ]) {
      const { status, json, fetchCalls } = await corr1Probe(bad);
      assert.strictEqual(status, 500, `must fail closed for ${bad}`);
      assert.strictEqual(json.error, "UPSTREAM_URL_NOT_CONFIGURED", `error for ${bad}`);
      assert.strictEqual(fetchCalls, 0, `zero fetches for ${bad}`);
    }
  });

  test("CORR1-D: query-bearing configured URL fails closed", async () => {
    const { status, json, fetchCalls } = await corr1Probe(
      "https://api.example.test/api/v1/applications?x=1"
    );
    assert.strictEqual(status, 500);
    assert.strictEqual(json.error, "UPSTREAM_URL_NOT_CONFIGURED");
    assert.strictEqual(fetchCalls, 0);
  });

  test("CORR1-E: fragment-bearing configured URL fails closed", async () => {
    const { status, json, fetchCalls } = await corr1Probe(
      "https://api.example.test/api/v1/applications#frag"
    );
    assert.strictEqual(status, 500);
    assert.strictEqual(json.error, "UPSTREAM_URL_NOT_CONFIGURED");
    assert.strictEqual(fetchCalls, 0);
  });

  test("5.3: route rejects missing initData with 401", async () => {
    const { POST } = await import("../../src/app/api/tikhon/send-schedule/route.ts");
    const req = new NextRequest("http://localhost:3000/api/tikhon/send-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_id: "levels_of_consciousness", cohort_id: "cohort_3" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 401);
  });

  test("5.4: route relays upstream SCHEDULE_FORMING as a 200 bounded status", async () => {
    process.env.TIKHON_INTERNAL_SECRET = "sched_route_secret";
    process.env.TIKHON_RUSSIAN_SERVER_URL = "https://tikhon-upstream-sched.invalid/api/v1/applications";
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (): Promise<Response> => {
        return new Response(JSON.stringify({ status: "SCHEDULE_FORMING" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const { POST } = await import("../../src/app/api/tikhon/send-schedule/route.ts");
      const initData = createValidInitData(46161088, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/send-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({ course_id: "levels_of_consciousness", cohort_id: "waiting_list" }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 200);
      assert.strictEqual((await res.json()).status, "SCHEDULE_FORMING");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  /* ---------------- 6-7. ONE CLICK = ONE SEND / NO DUPLICATE WHILE PENDING ---------------- */

  test("6.1: one send call produces exactly one fetch", async () => {
    const cal = await importCalendar();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    try {
      globalThis.fetch = (async (): Promise<Response> => {
        calls += 1;
        return new Response(JSON.stringify({ status: "SENT" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const result = await cal.sendScheduleToTelegram("levels_of_consciousness", "cohort_3", "init-data-x");
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.status, "SENT");
      assert.strictEqual(calls, 1, "exactly one network request per completed send");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("7.1: repeated call while pending returns SEND_IN_PROGRESS and does not duplicate", async () => {
    const cal = await importCalendar();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      globalThis.fetch = (async (): Promise<Response> => {
        calls += 1;
        await gate;
        return new Response(JSON.stringify({ status: "SENT" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const first = cal.sendScheduleToTelegram("levels_of_consciousness", "cohort_3", "init-data-x");
      const second = await cal.sendScheduleToTelegram("levels_of_consciousness", "cohort_3", "init-data-x");
      assert.strictEqual(second.ok, false);
      assert.strictEqual(second.error, "SEND_IN_PROGRESS", "pending duplicate must be blocked");
      release();
      await first;
      assert.strictEqual(calls, 1, "only one request despite repeated click while pending");
      assert.strictEqual(cal.isScheduleSendInFlight(), false, "guard releases after completion");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("7.2: button is disabled while sending (UI duplicate guard, source assertion)", () => {
    assert.ok(hubSource.includes("disabled={phase === \"sending\"}"), "send button must be disabled during sending");
    assert.ok(calendarSource.includes("scheduleSendInFlight"), "module-level in-flight guard must exist");
  });

  test("7.3: calendar.ts never sends client-controlled user_id or chat_id", () => {
    const bodyShape = calendarSource.match(/body:\s*JSON\.stringify\(\{[^}]*\}\)/);
    assert.ok(bodyShape, "explicit body shape expected");
    assert.ok(!bodyShape[0].includes("user_id"), "client must not send user_id");
    assert.ok(!bodyShape[0].includes("chat_id"), "client must not send chat_id");
  });

  /* ---------------- 8-9. SENT / ERROR STATES ---------------- */

  test("8.1: successful send renders success confirmation (source + component contract)", async () => {
    assert.ok(hubSource.includes("schedule-sent-text"), "sent testid present");
    assert.ok(hubSource.includes(SCHEDULE_SENT_COPY), "sent copy present");
    assert.ok(hubSource.includes('role="status"'), "sent confirmation announced as status");
    const { SubmissionResultScreen } = await importScreen();
    const html = renderToStaticMarkup(
      createElement(SubmissionResultScreen, makeSuccessScreenProps(availableCohort, courseFixture))
    );
    assert.ok(html.includes(SCHEDULE_CTA_COPY), "idle phase renders CTA");
  });

  test("9.1: delivery failure renders bounded retry state (source assertions)", () => {
    assert.ok(hubSource.includes("schedule-error-text"), "error text testid present");
    assert.ok(hubSource.includes('role="alert"'), "error announced as alert");
    assert.ok(hubSource.includes("schedule-retry-btn"), "retry button present");
    assert.ok(hubSource.includes("Повторить отправку"), "retry copy present");
    assert.ok(hubSource.includes("Не удалось отправить расписание. Попробуйте ещё раз."), "bounded error copy");
  });

  /* ---------------- 10. APPLICATION-SUCCESS FLOW UNCHANGED ---------------- */

  test("10.1: success screen keeps verbatim application copy and curator CTA", async () => {
    const { SubmissionResultScreen } = await importScreen();
    const html = renderToStaticMarkup(
      createElement(SubmissionResultScreen, makeSuccessScreenProps(availableCohort, courseFixture))
    );
    assert.ok(html.includes("Заявка успешно оформлена!"), "success heading intact");
    assert.ok(html.includes("submission-app-id"), "app id badge intact");
    assert.ok(html.includes("#461"), "app id rendered");
    assert.ok(
      html.includes("Для выполнения оплаты свяжитесь с куратором курса Алексеем Лебедевым @Lebedev_AST. Спасибо"),
      "SUCCESS_COPY_VERBATIM intact"
    );
    assert.ok(html.includes("curator-chat-btn"), "curator CTA intact");
    assert.ok(html.includes("@Lebedev_AST"), "curator handle intact");
  });

  test("10.2: hub is additive — screen without course/cohort props renders exactly the accepted surface", async () => {
    const { SubmissionResultScreen } = await importScreen();
    const html = renderToStaticMarkup(
      createElement(SubmissionResultScreen, {
        submissionState: "success",
        submissionError: null,
        submissionAppId: 461,
        onRetry: () => {},
        onBack: () => {},
        onGoCatalog: () => {},
      })
    );
    assert.ok(html.includes("Заявка успешно оформлена!"), "accepted flow intact");
    assert.ok(!html.includes("calendar-hub"), "no hub without props");
    assert.ok(!html.includes(SCHEDULE_CTA_COPY), "no CTA without props");
  });

  test("10.3: page.tsx passes course and cohort into the result screen", () => {
    assert.ok(pageSource.includes("selectedCourse={selectedCourse}"), "page passes selectedCourse");
    assert.ok(pageSource.includes("selectedCohort={selectedCohort}"), "page passes selectedCohort");
  });

  test("10.4: Cohort type carries optional has_canonical_sessions flag", () => {
    assert.ok(helpersSource.includes("has_canonical_sessions?: boolean"));
  });
});
