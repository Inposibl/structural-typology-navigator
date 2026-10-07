import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import type { Course } from "../../src/app/tikhon-miniapp-pilot/helpers.ts";

// Explicit live-only revision: Owner adjudication 2026-10-07, base d3c32014936d01cd129c8ec04985210df48372d7.
// Never load env files, log credential values, signed initData or identity-bearing URLs.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const entitlementSecret = process.env.ENTITLEMENT_SUBJECT_SECRET;
if (!supabaseUrl || !supabaseKey || !botToken || !entitlementSecret) {
  throw new Error("Live smoke requires explicit Supabase, bot and entitlement credentials.");
}
let origin: URL;
try {
  origin = new URL(supabaseUrl);
} catch {
  throw new Error("Live smoke requires a valid Supabase URL.");
}
if (origin.protocol !== "https:" || !origin.hostname.endsWith(".supabase.co") ||
    origin.port || origin.username || origin.password || origin.search || origin.hash ||
    (origin.pathname !== "/" && origin.pathname !== "")) {
  throw new Error("Live smoke requires a credential-free HTTPS Supabase project origin.");
}

const nativeFetch = globalThis.fetch;
const nativeHttpRequest = http.request;
const nativeHttpGet = http.get;
const nativeHttpsRequest = https.request;
const nativeHttpsGet = https.get;
let transportViolations = 0;
function denyTransport(): never {
  transportViolations += 1;
  throw new Error("Live smoke blocked an unexpected or mutating transport operation.");
}
// All inspected product requests use fetch. Deny alternate Node HTTP entry points.
http.request = denyTransport;
http.get = denyTransport;
https.request = denyTransport;
https.get = denyTransport;
syncBuiltinESMExports();
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  let request: Request;
  try {
    request = new Request(input, init);
  } catch {
    return denyTransport();
  }
  const url = new URL(request.url);
  if (request.method !== "GET" || request.body !== null || url.origin !== origin.origin ||
      url.username || url.password || url.hash || request.headers.has("x-http-method-override")) {
    return denyTransport();
  }
  // Only the two existing SELECT contracts; no RPC, storage, other tables or providers.
  const publicSelect = url.pathname === "/rest/v1/tikhon_public_projection" &&
    url.searchParams.get("id") === "eq.current" && url.searchParams.get("select") === "*";
  const privateSelect = url.pathname === "/rest/v1/tikhon_private_entitlements" &&
    /^eq\.[a-f0-9]{64}$/.test(url.searchParams.get("subject_key") ?? "") &&
    url.searchParams.get("select") === "course_id,paid_options,legacy_history_unverified";
  const keys = Array.from(url.searchParams.keys()).sort();
  const permittedKeys = publicSelect ? ["id", "select"] : ["select", "subject_key"];
  if ((!publicSelect && !privateSelect) ||
      keys.length !== 2 || keys.some((key, index) => key !== permittedKeys[index])) {
    return denyTransport();
  }
  try {
    // Never follow a redirect: it could bypass the origin/operation check.
    return await nativeFetch(new Request(request, {
      redirect: "error", signal: AbortSignal.timeout(15_000),
    }));
  } catch {
    throw new Error("Read-only Supabase transport failed.");
  }
}) as typeof fetch;

function assertNoInternalIdentity(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(!["user_id", "subject_key", "application_id", "telegram_id"].includes(key),
      "response must not expose internal identity fields");
    assertNoInternalIdentity(nested);
  }
}

function createLegacyInitData(): string {
  // The existing legacy-user smoke identity; signing is local, with no Telegram network.
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 8807727029 }),
  });
  const check = Array.from(params.keys()).sort().map((key) => `${key}=${params.get(key)}`).join("\n");
  const key = crypto.createHmac("sha256", "WebAppData").update(botToken!).digest();
  params.set("hash", crypto.createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
}

let courses: Course[];
let helpers: typeof import("../../src/app/tikhon-miniapp-pilot/helpers.ts");
before(async () => {
  helpers = await import("../../src/app/tikhon-miniapp-pilot/helpers.ts");
  const response = await fetch(`${origin.origin}/rest/v1/tikhon_public_projection?id=eq.current&select=*`, {
    method: "GET",
    headers: { apikey: supabaseKey!, Authorization: `Bearer ${supabaseKey!}` },
  });
  assert.ok(response.status === 200, "public projection SELECT must return 200");
  let rows;
  try {
    rows = await response.json();
  } catch {
    throw new Error("Public projection must return valid JSON.");
  }
  assert.ok(Array.isArray(rows) && rows.length === 1, "current projection must have one row");
  assert.ok(rows[0].currency === "RUB", "public projection currency must be RUB");
  courses = rows[0].courses;
});
after(() => {
  globalThis.fetch = nativeFetch;
  http.request = nativeHttpRequest;
  http.get = nativeHttpGet;
  https.request = nativeHttpsRequest;
  https.get = nativeHttpsGet;
  syncBuiltinESMExports();
  assert.ok(transportViolations === 0, "no blocked transport operation may be silently swallowed");
});

describe("Explicit read-only Tikhon live smoke — Owner revision 6 / 60000", () => {
  test("Catalog A: Public projection exposes the five supported course contracts", () => {
    assert.ok(Array.isArray(courses) && courses.length === 5, "five supported courses required");
    assert.deepStrictEqual(courses.map((course) => course.id).sort(), [
      "levels_of_consciousness", "maslow", "normative_situation",
      "play_and_creativity", "structural_typology",
    ].sort());
    for (const course of courses) {
      assert.ok(course.id && course.title && course.short_description, "required public text fields");
      assert.ok(typeof course.meetings_count === "number", "meetings_count must be numeric");
      assert.ok(typeof course.max_participants === "number", "max_participants must be numeric");
      assert.ok(typeof course.format_info === "string", "format_info must be text");
      assert.ok(Array.isArray(course.cohorts), "cohorts must be an array");
      assert.ok(Array.isArray(course.pricing_options), "pricing_options must be an array");
      for (const option of course.pricing_options) {
        assert.ok(option.id && option.title && typeof option.price === "number" &&
          typeof option.description === "string", "pricing option consumer fields required");
      }
    }
    assertNoInternalIdentity(courses);
  });

  test("Catalog L: Maslow matches fixed Owner canon, capacity and twice-weekly cadence", () => {
    const maslow = courses.find((course) => course.id === "maslow");
    assert.ok(maslow, "Maslow course required");
    assert.equal(maslow.meetings_count, 6, "Owner canon: 6 meetings");
    assert.equal(maslow.pricing_options.find((option) => option.id === "single_payment")?.price,
      60000, "Owner canon: 60000 RUB");
    assert.equal(maslow.max_participants, 24, "retained accepted capacity");
    assert.ok(maslow.format_info.includes("2 раза в неделю"), "retained twice-weekly format");
    assert.equal(helpers.extractCadence(maslow.format_info), "Zoom · 2 раза в неделю");
  });

  test("Entitlements Live 1: Legacy authenticated GET remains private and fail-closed", async () => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("../../src/app/api/tikhon/student-status/route.ts");
    const response = await GET(new NextRequest("http://localhost:3000/api/tikhon/student-status", {
      headers: { "x-telegram-init-data": createLegacyInitData() },
    }));
    assert.ok(response.status === 200, "private entitlement GET must return 200");
    const json = await response.json();
    assert.ok(json.is_authenticated === true, "legacy smoke must authenticate");
    assertNoInternalIdentity(json);
    assert.ok(json.courses?.structural_typology, "legacy structural_typology status required");
    assert.ok(json.courses.structural_typology.legacy_history_unverified === true,
      "legacy history must remain unverified");
    assert.ok(Array.isArray(json.courses.structural_typology.paid_options) &&
      json.courses.structural_typology.paid_options.length === 0, "legacy paid options must remain empty");
    assert.ok(response.headers.get("Cache-Control")?.includes("private"), "private caching required");
    assert.ok(response.headers.get("Cache-Control")?.includes("no-store"), "no-store caching required");
  });

  test("Entitlements Live 2: Public URLs, cadence and retained Structural Typology prices", () => {
    const st = courses.find((course) => course.id === "structural_typology");
    assert.ok(st, "Structural Typology course required");
    assert.equal(st.course_page_url, "https://structural-typology.academy/courses/structural-typology");
    assert.equal(st.cadence, "1 раз в неделю (вс)");
    const full = st.pricing_options.find((option) => option.id === "full_prepayment");
    assert.ok(full, "full prepayment required");
    assert.equal(full.price, 160000);
    assert.equal(full.base_price, 200000);
    assert.equal(full.discount_percent, 20);
    const levels = ["level_1", "level_2", "level_3"].map((id) => st.pricing_options.find((option) => option.id === id));
    assert.equal(levels[0]?.price, 50000);
    assert.equal(levels[1]?.price, 100000);
    assert.equal(levels[2]?.price, 50000);
    assert.equal(levels.reduce((sum, option) => sum + option!.price, 0), 200000);
    for (const course of courses) {
      assert.ok(course.course_page_url?.startsWith("https://structural-typology.academy/courses/"),
        "canonical public course URL required");
      for (const option of course.pricing_options) {
        assert.ok(!option.description.includes("невозвратный"), "prohibited description must be absent");
      }
    }
  });

  test("Pricing A: Four live single-option course objects preserve source auto-selection", () => {
    for (const id of ["levels_of_consciousness", "maslow", "normative_situation", "play_and_creativity"]) {
      const course = courses.find((candidate) => candidate.id === id);
      assert.ok(course, "single-option course required");
      assert.equal(course.pricing_options.length, 1);
      assert.equal(course.pricing_options[0].id, "single_payment");
      assert.ok(helpers.getSingleAutoPricingOption(course) === course.pricing_options[0],
        "auto-selection must return its source object");
    }
  });

  test("Pricing B: Live Structural Typology multiplicity prevents auto-selection", () => {
    const st = courses.find((course) => course.id === "structural_typology");
    assert.ok(st && st.pricing_options.length > 1, "multiple pricing options required");
    assert.equal(helpers.getSingleAutoPricingOption(st), null);
  });
});
