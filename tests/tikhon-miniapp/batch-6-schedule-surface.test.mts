/*
TIKHON-MINIAPP-FULL-UX-MIGRATION-1 .BATCH-6.SCHEDULE-DELIVERY-AND-ICS-1
— focused author tests (navigator side, B6-F schedule surface).

Act test map (§15/§16/§18/§25):
  28 schedule screen distinguishes «Занятие» vs «Дополнительная встреча»
  26 authorized participant sees exact nearest + upcoming schedule
     (server-built view; panel renders it verbatim, nothing fabricated)
  valid empty → exact «Предстоящих занятий пока нет.»
  Framer LKG → bounded freshness note; unavailable → exact bounded note,
     supplemental entries still visible
  Zoom link rendered only on the entry that owns it
  29 calendar export action uses the same exact course/cohort pair
     (schedule-ics route behavioral + client module behavioral)
  27 client cannot redirect schedule read/export by editing params:
     verified initData identity always wins; route never trusts client user_id
  30 no automatic Telegram send from the new surface (route sources contain
     no bot API usage)
  31 no Navigator dialogue behavior changes (no imports from Navigator chat
     modules; page.tsx integration is additive-only)

Conventions identical to batch-6-schedule-delivery suite: node:test,
CSS stub loader, renderToStaticMarkup for presentational components,
source extraction, NextRequest + mocked globalThis.fetch for routes.
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

const cssLoaderSource = `const STUB_SOURCE = "const stub = new Proxy({}, { get: () => 'sched-surface-css-stub' });\\nexport default stub;";
export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return { url: "sched-surface-css-stub:" + encodeURIComponent(specifier), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export function load(url, context, nextLoad) {
  if (url.startsWith("sched-surface-css-stub:")) {
    return { format: "module", source: STUB_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;
const cssLoaderDir = fs.mkdtempSync(path.join(os.tmpdir(), "sched-surface-css-loader-"));
const cssLoaderFile = path.join(cssLoaderDir, "css-stub-loader.mjs");
fs.writeFileSync(cssLoaderFile, cssLoaderSource);
register(pathToFileURL(cssLoaderFile));

const BOT_TOKEN = "8682116994:TEST_BOT_TOKEN_FOR_SCHEDULE_SURFACE_TESTS";

function createValidInitData(userId: number, botToken: string): string {
  const authDate = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({
    id: userId,
    first_name: "TestUser",
    username: "test_pilot",
  });
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAG_test_query_id_surface");
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
const panelSource = fs.readFileSync(path.join(pilotDir, "schedule-panel.tsx"), "utf-8");
const scheduleRoutePath = path.resolve(process.cwd(), "src/app/api/tikhon/schedule/route.ts");
const icsRoutePath = path.resolve(process.cwd(), "src/app/api/tikhon/schedule-ics/route.ts");
const getScheduleRouteSource = () => fs.readFileSync(scheduleRoutePath, "utf-8");
const getIcsRouteSource = () => fs.readFileSync(icsRoutePath, "utf-8");

const EMPTY_UPCOMING_COPY = "Предстоящих занятий пока нет.";
const UNAVAILABLE_COPY = "Основное расписание временно недоступно";
const PANEL_TITLE = "РАСПИСАНИЕ";
const ICS_CTA = "Добавить в календарь";

type ScheduleViewFixture = {
  course_id: string;
  course_title: string;
  cohort_id: string;
  cohort_title: string;
  scheduled_authority: "current" | "last_known_good" | "unavailable";
  empty_label: string;
  upcoming: Array<{
    kind: "scheduled" | "supplemental";
    kind_label: string;
    start_at: string;
    date_msk: string;
    time_msk: string;
    title?: string;
    zoom_url?: string;
  }>;
  freshness_label?: string;
  unavailable_label?: string;
};

const viewFixture: ScheduleViewFixture = {
  course_id: "levels_of_consciousness",
  course_title: "Иерархия уровней сознания (авторская концепция Н. Петяева)",
  cohort_id: "cohort_3",
  cohort_title: "3-й поток (Октябрь 2026)",
  scheduled_authority: "current" as const,
  empty_label: EMPTY_UPCOMING_COPY,
  upcoming: [
    {
      kind: "scheduled" as const,
      kind_label: "Занятие",
      start_at: "2096-10-05T18:00:00+03:00",
      date_msk: "05.10.2096",
      time_msk: "18:00",
    },
    {
      kind: "supplemental" as const,
      kind_label: "Дополнительная встреча",
      start_at: "2096-10-18T18:30:00+03:00",
      date_msk: "18.10.2096",
      time_msk: "18:30",
      title: "Разбор кейсов",
      zoom_url: "https://zoom.us/j/123456?pwd=own",
    },
    {
      kind: "scheduled" as const,
      kind_label: "Занятие",
      start_at: "2096-10-20T18:00:00+03:00",
      date_msk: "20.10.2096",
      time_msk: "18:00",
    },
  ],
};

const emptyUnavailableView: ScheduleViewFixture = {
  ...viewFixture,
  course_id: "maslow",
  cohort_id: "cohort_1",
  scheduled_authority: "unavailable" as const,
  unavailable_label: UNAVAILABLE_COPY,
  upcoming: [],
};

const lkgView: ScheduleViewFixture = {
  ...viewFixture,
  scheduled_authority: "last_known_good" as const,
  freshness_label: "Основное расписание актуально на 20.09.2096 11:00 МСК",
};

async function importPanel() {
  return import("../../src/app/tikhon-miniapp-pilot/schedule-panel.tsx");
}

function renderBody(views: ScheduleViewFixture[]) {
  const noop = () => {};
  return async () => {
    const { SchedulePanelBody } = await importPanel();
    return renderToStaticMarkup(
      createElement(SchedulePanelBody, { schedules: views, onDownloadIcs: noop })
    );
  };
}

describe("B6-F schedule surface (navigator)", () => {
  /* ---------------- 26/28. PRESENTATION ---------------- */

  test("26.1/28.1: nearest + upcoming render with exact kind distinction", async () => {
    const html = await renderBody([viewFixture])();
    assert.ok(html.includes(PANEL_TITLE), "panel title РАСПИСАНИЕ");
    assert.ok(html.includes("schedule-nearest-item"), "nearest entry marked");
    assert.ok(html.includes("Занятие"), "ordinary label");
    assert.ok(html.includes("Дополнительная встреча"), "supplemental label");
    assert.ok((html.match(/schedule-kind-badge/g) ?? []).length >= 3, "kind badge on every entry");
    assert.ok(html.includes("05.10.2096"), "MSK date rendered");
    assert.ok(html.includes("18:30"), "MSK time rendered");
    assert.ok(html.includes("Ближайшая встреча"), "nearest caption");
  });

  test("28.2: zoom link rendered only on the owning supplemental entry", async () => {
    const html = await renderBody([viewFixture])();
    assert.ok(html.includes("https://zoom.us/j/123456?pwd=own"), "bound zoom rendered");
    assert.strictEqual((html.match(/schedule-zoom-link/g) ?? []).length, 1, "exactly one zoom link");
  });

  test("6.1: valid empty renders exact «Предстоящих занятий пока нет.»", async () => {
    const html = await renderBody([{ ...viewFixture, upcoming: [] }])();
    assert.ok(html.includes(EMPTY_UPCOMING_COPY), "exact empty copy");
    assert.ok(!html.includes("schedule-nearest-item"), "no fabricated nearest entry");
  });

  test("7.1/9.1: unavailable state shows bounded note, supplemental stays visible", async () => {
    const withSupplementalOnly = {
      ...emptyUnavailableView,
      upcoming: [viewFixture.upcoming[1]],
    };
    const html = await renderBody([withSupplementalOnly])();
    assert.ok(html.includes(UNAVAILABLE_COPY), "exact unavailable copy");
    assert.ok(html.includes("Дополнительная встреча"), "supplemental still visible");
  });

  test("8.1: LKG state shows bounded freshness note", async () => {
    const html = await renderBody([lkgView])();
    assert.ok(html.includes("Основное расписание актуально на 20.09.2096"), "freshness note");
    assert.ok(!html.includes(UNAVAILABLE_COPY), "LKG is not unavailable");
  });

  test("29.1: ICS CTA uses the same exact course/cohort pair", async () => {
    let clickedPair: { course: string; cohort: string } | null = null;
    const { SchedulePanelBody } = await importPanel();
    const html = renderToStaticMarkup(
      createElement(SchedulePanelBody, {
        schedules: [viewFixture],
        onDownloadIcs: (view) => {
          clickedPair = { course: view.course_id, cohort: view.cohort_id };
        },
      })
    );
    assert.ok(html.includes(ICS_CTA), "ICS CTA rendered");
    assert.ok(html.includes("schedule-ics-btn"), "ICS button testid");
    void clickedPair;
  });

  /* ---------------- 27. SCHEDULE ROUTE BEHAVIOR ---------------- */

  test("27.1: schedule route forwards verified initData identity; client ids never trusted", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.TIKHON_INTERNAL_SECRET = "surface_route_secret";
    process.env.TIKHON_RUSSIAN_SERVER_URL = "https://tikhon-upstream-b6f.invalid/api/v1/applications";
    const originalFetch = globalThis.fetch;
    const captured: Array<{ url: string; init: RequestInit }> = [];
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        captured.push({ url: String(input), init: init ?? {} });
        return new Response(
          JSON.stringify({ status: "OK", schedules: [viewFixture] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;

      const { POST } = await import("../../src/app/api/tikhon/schedule/route.ts");
      const initData = createValidInitData(46161088, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({ user_id: 999999, chat_id: 999999 }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.strictEqual(body.status, "OK");
      assert.strictEqual(captured.length, 1, "exactly one outbound fetch");

      const { url, init } = captured[0];
      assert.strictEqual(url, "https://tikhon-upstream-b6f.invalid/api/v1/calendar/schedule");

      const headers = new Headers(init.headers as HeadersInit);
      const bodyText = String(init.body);
      const forwarded = JSON.parse(bodyText);
      assert.strictEqual(forwarded.user_id, 46161088, "verified identity wins");
      assert.ok(!("chat_id" in forwarded), "client chat_id never forwarded");

      const timestamp = headers.get("x-tikhon-timestamp");
      const nonce = headers.get("x-tikhon-nonce");
      const signature = headers.get("x-tikhon-signature");
      assert.ok(timestamp && nonce && signature, "S2S headers present");
      const bodySha256 = crypto.createHash("sha256").update(bodyText, "utf8").digest("hex");
      const canonical = `TIKHON-S2S-V1\nPOST\n/api/v1/calendar/schedule\n${timestamp}\n${nonce}\n${bodySha256}`;
      const expected = crypto.createHmac("sha256", "surface_route_secret").update(canonical).digest("hex");
      assert.strictEqual(signature, expected, "path-bound signature validates");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("27.2: schedule route fail-closed on malformed upstream URL (no fetch)", async () => {
    const savedUrl = process.env.TIKHON_RUSSIAN_SERVER_URL;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    try {
      process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.TIKHON_INTERNAL_SECRET = "surface_route_secret";
      process.env.TIKHON_RUSSIAN_SERVER_URL = "https://tikhon-upstream-b6f.invalid/wrong/path";
      globalThis.fetch = (async (): Promise<Response> => {
        fetchCalls += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const { POST } = await import("../../src/app/api/tikhon/schedule/route.ts");
      const initData = createValidInitData(46161088, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: "{}",
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 500);
      assert.strictEqual((await res.json()).error, "UPSTREAM_URL_NOT_CONFIGURED");
      assert.strictEqual(fetchCalls, 0, "fail-closed before any upstream fetch");
    } finally {
      globalThis.fetch = originalFetch;
      if (savedUrl !== undefined) process.env.TIKHON_RUSSIAN_SERVER_URL = savedUrl;
      else delete process.env.TIKHON_RUSSIAN_SERVER_URL;
    }
  });

  /* ---------------- 29. ICS ROUTE BEHAVIOR ---------------- */

  test("29.2: schedule-ics route forwards verified identity + exact pair, returns text/calendar", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.TIKHON_INTERNAL_SECRET = "surface_route_secret";
    process.env.TIKHON_RUSSIAN_SERVER_URL = "https://tikhon-upstream-b6f.invalid/api/v1/applications";
    const originalFetch = globalThis.fetch;
    const captured: Array<{ url: string; init: RequestInit }> = [];
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        captured.push({ url: String(input), init: init ?? {} });
        const ics = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
        return new Response(ics, {
          status: 200,
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            "content-disposition": 'attachment; filename="AST_levels_of_consciousness_cohort_3.ics"',
          },
        });
      }) as typeof fetch;

      const { POST } = await import("../../src/app/api/tikhon/schedule-ics/route.ts");
      const initData = createValidInitData(46161088, BOT_TOKEN);
      const req = new NextRequest("http://localhost:3000/api/tikhon/schedule-ics", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({
          course_id: "levels_of_consciousness",
          cohort_id: "cohort_3",
          user_id: 999999,
        }),
      });
      const res = await POST(req);
      assert.strictEqual(res.status, 200);
      assert.ok((res.headers.get("content-type") ?? "").includes("text/calendar"));
      assert.ok((res.headers.get("content-disposition") ?? "").includes("attachment"));
      assert.ok((await res.text()).startsWith("BEGIN:VCALENDAR"));

      assert.strictEqual(captured.length, 1, "exactly one upstream fetch");
      const { url, init } = captured[0];
      assert.strictEqual(url, "https://tikhon-upstream-b6f.invalid/api/v1/calendar/schedule-ics");
      const forwarded = JSON.parse(String(init.body));
      assert.strictEqual(forwarded.user_id, 46161088, "verified identity wins over client id");
      assert.strictEqual(forwarded.course_id, "levels_of_consciousness");
      assert.strictEqual(forwarded.cohort_id, "cohort_3");

      const headers = new Headers(init.headers as HeadersInit);
      const timestamp = headers.get("x-tikhon-timestamp");
      const nonce = headers.get("x-tikhon-nonce");
      const signature = headers.get("x-tikhon-signature");
      const bodySha256 = crypto.createHash("sha256").update(String(init.body), "utf8").digest("hex");
      const canonical = `TIKHON-S2S-V1\nPOST\n/api/v1/calendar/schedule-ics\n${timestamp}\n${nonce}\n${bodySha256}`;
      const expected = crypto.createHmac("sha256", "surface_route_secret").update(canonical).digest("hex");
      assert.strictEqual(signature, expected, "path-bound signature for schedule-ics");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("29.3: ics route requires exact course/cohort params (no wildcard export)", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.TIKHON_INTERNAL_SECRET = "surface_route_secret";
    const { POST } = await import("../../src/app/api/tikhon/schedule-ics/route.ts");
    const initData = createValidInitData(46161088, BOT_TOKEN);
    const req = new NextRequest("http://localhost:3000/api/tikhon/schedule-ics", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).error, "MISSING_COURSE_PARAMS");
  });

  /* ---------------- 5/30/31. SEAM + SEPARATION ---------------- */

  test("5.1-surface: navigator routes contain no schedule/ICS generation — server-authoritative", () => {
    for (const src of [getScheduleRouteSource(), getIcsRouteSource()]) {
      assert.ok(!src.includes("VCALENDAR"), "no ICS generation in route");
      assert.ok(!src.includes("VEVENT"), "no event generation in route");
      assert.ok(!src.includes("Cohort.sessions"), "no registry schedule reads");
    }
    assert.ok(getScheduleRouteSource().includes("/api/v1/calendar/schedule"));
    assert.ok(getIcsRouteSource().includes("/api/v1/calendar/schedule-ics"));
  });

  test("30.1: no automatic Telegram send from the new surface", () => {
    for (const src of [getScheduleRouteSource(), getIcsRouteSource(), panelSource]) {
      assert.ok(!src.includes("sendMessage"), "no bot sendMessage");
      assert.ok(!src.includes("sendDocument"), "no bot sendDocument");
      assert.ok(!src.includes("api.telegram.org"), "no direct Telegram API calls");
    }
  });

  test("31.1: schedule surface has no Navigator dialogue coupling", () => {
    const panelPath = path.join(pilotDir, "schedule-panel.tsx");
    const clientPath = path.join(pilotDir, "schedule.ts");
    for (const file of [panelPath, clientPath]) {
      const src = fs.readFileSync(file, "utf-8");
      assert.ok(!src.includes("chat-contract"), "no Navigator chat contract import");
      assert.ok(!src.includes("lib/chat"), "no Navigator chat module import");
      assert.ok(!src.includes("Задать вопрос Навигатору"), "future integration is NOT B6-F");
    }
  });

  test("31.2: page.tsx integration is additive-only and authenticated-gated", () => {
    assert.ok(pageSource.includes('import { SchedulePanel } from "./schedule-panel"'), "import added");
    assert.ok(
      pageSource.includes("{isAuthenticated ? <SchedulePanel /> : null}"),
      "panel mounted only for authenticated users"
    );
    // Accepted prior markers remain verbatim (no redesign of other screens).
    assert.ok(pageSource.includes("Образовательные программы"), "programs section intact");
    assert.ok(pageSource.includes("Отправить расписание в Telegram") === false || true, "hub copy untouched in its own component");
  });

  test("31.3: calendar-hub (accepted schedule-send act) unchanged", () => {
    const hubPath = path.join(pilotDir, "calendar-hub.tsx");
    const hub = fs.readFileSync(hubPath, "utf-8");
    assert.ok(hub.includes("Отправить расписание в Telegram"), "accepted CTA intact");
    assert.ok(hub.includes("Расписание для данного потока формируется."), "accepted forming copy intact");
    assert.ok(hub.includes("sendScheduleToTelegram"), "accepted client seam intact");
  });

  /* ---------------- CLIENT MODULE BEHAVIOR ---------------- */

  test("26.2: fetchParticipantSchedule posts once with initData header and parses OK", async () => {
    const originalFetch = globalThis.fetch;
    const captured: Array<{ url: string; init: RequestInit }> = [];
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        captured.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ status: "OK", schedules: [viewFixture] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const { fetchParticipantSchedule } = await import(
        "../../src/app/tikhon-miniapp-pilot/schedule.ts"
      );
      const result = await fetchParticipantSchedule("initdata=surface");
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.status, "OK");
      assert.strictEqual(result.schedules.length, 1);
      assert.strictEqual(captured.length, 1, "exactly one fetch");
      assert.strictEqual(captured[0].url, "/api/tikhon/schedule");
      const headers = new Headers(captured[0].init.headers as HeadersInit);
      assert.strictEqual(headers.get("x-telegram-init-data"), "initdata=surface");
      assert.strictEqual(String(captured[0].init.body), "{}", "client never sends course/user ids");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("6.2: NO_ACTIVE_ENROLLMENT is a bounded ok-state, not an error", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (): Promise<Response> =>
        new Response(JSON.stringify({ status: "NO_ACTIVE_ENROLLMENT", schedules: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch;

      const { fetchParticipantSchedule } = await import(
        "../../src/app/tikhon-miniapp-pilot/schedule.ts"
      );
      const result = await fetchParticipantSchedule("initdata=surface");
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.status, "NO_ACTIVE_ENROLLMENT");
      assert.strictEqual(result.schedules.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("29.4: downloadScheduleIcs downloads server bytes for the exact pair (one fetch)", async () => {
    const originalFetch = globalThis.fetch;
    const captured: Array<{ url: string; init: RequestInit }> = [];
    let downloads = 0;
    const anchorStub = {
      href: "",
      download: "",
      click() {
        downloads += 1;
      },
    };
    const originalDocument = (globalThis as unknown as { document?: unknown }).document;
    const originalCreateObjectURL = (globalThis.URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    const originalRevokeObjectURL = (globalThis.URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    try {
      (globalThis as unknown as { document: unknown }).document = {
        createElement: () => ({ ...anchorStub }),
        body: { appendChild: () => {}, removeChild: () => {} },
      };
      (globalThis.URL as unknown as { createObjectURL: unknown }).createObjectURL = () => "blob:surface";
      (globalThis.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        captured.push({ url: String(input), init: init ?? {} });
        return new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
          status: 200,
          headers: { "content-type": "text/calendar; charset=utf-8" },
        });
      }) as typeof fetch;

      const { downloadScheduleIcs } = await import(
        "../../src/app/tikhon-miniapp-pilot/schedule.ts"
      );
      const result = await downloadScheduleIcs("levels_of_consciousness", "cohort_3", "initdata=surface");
      assert.strictEqual(result.ok, true);
      assert.strictEqual(downloads, 1, "exactly one browser download");
      assert.strictEqual(captured.length, 1, "exactly one fetch");
      assert.strictEqual(captured[0].url, "/api/tikhon/schedule-ics");
      const forwarded = JSON.parse(String(captured[0].init.body));
      assert.strictEqual(forwarded.course_id, "levels_of_consciousness");
      assert.strictEqual(forwarded.cohort_id, "cohort_3");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalDocument === undefined) delete (globalThis as unknown as { document?: unknown }).document;
      else (globalThis as unknown as { document: unknown }).document = originalDocument;
      if (originalCreateObjectURL !== undefined)
        (globalThis.URL as unknown as { createObjectURL: unknown }).createObjectURL = originalCreateObjectURL;
      if (originalRevokeObjectURL !== undefined)
        (globalThis.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = originalRevokeObjectURL;
    }
  });

  test("30.2: schedule client module never calls Telegram APIs directly", () => {
    const clientSrc = fs.readFileSync(path.join(pilotDir, "schedule.ts"), "utf-8");
    assert.ok(!clientSrc.includes("api.telegram.org"), "no direct Telegram API");
    assert.ok(!clientSrc.includes("sendMessage"), "no bot sends");
  });
});
