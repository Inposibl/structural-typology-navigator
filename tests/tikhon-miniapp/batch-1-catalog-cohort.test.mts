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
  getMeetingWord,
  extractCadence,
  resolveDeepLinkCourseId,
  isCohortAvailable,
  isCohortWaitingList,
  isCohortUnavailable,
  getCohortBadgeText,
  Cohort,
} from "../../src/app/tikhon-miniapp-pilot/helpers.ts";

describe("Tikhon Mini App Batch 1 — Catalog & Cohort Selection Contract", () => {
  const pageSourcePath = path.resolve(
    process.cwd(),
    "src/app/tikhon-miniapp-pilot/page.tsx",
  );
  const cssSourcePath = path.resolve(
    process.cwd(),
    "src/app/tikhon-miniapp-pilot/miniapp.module.css",
  );

  const pageSource = fs.readFileSync(pageSourcePath, "utf-8");
  const cssSource = fs.readFileSync(cssSourcePath, "utf-8");

  test("A: Screen 1 renders course cards from API payload dynamically", async () => {
    const { GET } = await import("../../src/app/api/tikhon/courses/route.ts");
    const response = await GET();
    assert.equal(response.status, 200, "API response must return 200");
    const data = await response.json();

    assert.ok(Array.isArray(data.courses));
    assert.equal(data.courses.length, 5, "Expected 5 courses from projection");

    for (const c of data.courses) {
      assert.ok(c.id, "Course must have id");
      assert.ok(c.title, "Course must have title");
      assert.ok(c.short_description, "Course must have short_description");
      assert.ok(typeof c.meetings_count === "number");
      assert.ok(typeof c.max_participants === "number");
      assert.ok(Array.isArray(c.cohorts));
    }
  });

  test("B: No hardcoded course prices in Screen 1/2 source code", () => {
    // Prohibit explicit course price constants in component source
    const pricePatterns = [
      /\b45\s?000\b/,
      /\b200\s?000\b/,
      /\b50\s?000\b/,
      /\b100\s?000\b/,
      /\b150\s?000\b/,
    ];
    for (const pat of pricePatterns) {
      assert.strictEqual(
        pat.test(pageSource),
        false,
        `Prohibited hardcoded price pattern ${pat} found in page.tsx`,
      );
    }
  });

  test("C: No hardcoded course dates in Screen 1/2 source code", () => {
    // Prohibit calendar date strings embedded in code
    const datePatterns = [
      /6\s+октябр/i,
      /16\s+август/i,
      /17\s+январ/i,
      /2026/i,
      /2027/i,
    ];
    for (const pat of datePatterns) {
      assert.strictEqual(
        pat.test(pageSource),
        false,
        `Prohibited hardcoded date pattern ${pat} found in page.tsx`,
      );
    }
  });

  test("D: 'Открыт набор' appears ONLY for canonical open enrollment state", () => {
    // Test rule: is_enrollment_open === true && enrollment_status === "AVAILABLE"
    const openCohort: Cohort = {
      id: "c1",
      title: "Open Cohort",
      start_date: "Future",
      schedule: "Weekly",
      is_active: true,
      enrollment_status: "AVAILABLE",
      is_enrollment_open: true,
    };
    const startedCohort: Cohort = {
      id: "c2",
      title: "Started Cohort",
      start_date: "Past",
      schedule: "Weekly",
      is_active: true,
      enrollment_status: "STARTED",
      is_enrollment_open: false,
    };
    const fullCohort: Cohort = {
      id: "c3",
      title: "Full Cohort",
      start_date: "Future",
      schedule: "Weekly",
      is_active: true,
      enrollment_status: "CAPACITY_REACHED",
      is_enrollment_open: false,
    };

    assert.strictEqual(isCohortAvailable(openCohort), true);
    assert.strictEqual(isCohortAvailable(startedCohort), false);
    assert.strictEqual(isCohortAvailable(fullCohort), false);

    assert.strictEqual(getCohortBadgeText(openCohort), "Открыт набор");
    assert.strictEqual(getCohortBadgeText(startedCohort), "Набор завершён");
    assert.strictEqual(getCohortBadgeText(fullCohort), "Мест нет");

    // Verify page.tsx implements this exact invariant
    assert.ok(
      pageSource.includes('enrollment_status === "AVAILABLE"'),
      "page.tsx must check enrollment_status === AVAILABLE",
    );
    assert.ok(
      pageSource.includes("is_enrollment_open"),
      "page.tsx must check is_enrollment_open",
    );
  });

  test("E: Unavailable cohort renders disabled with sold-out indicator", () => {
    const startedCohort: Cohort = {
      id: "c2",
      title: "Started Cohort",
      start_date: "Past",
      schedule: "Weekly",
      is_active: true,
      enrollment_status: "STARTED",
      is_enrollment_open: false,
    };
    assert.strictEqual(isCohortUnavailable(startedCohort), true);

    // Must contain disabled cohort classes and ARIA disabled attributes
    assert.ok(
      pageSource.includes("cohortCardDisabled"),
      "page.tsx must apply cohortCardDisabled class",
    );
    assert.ok(
      pageSource.includes("aria-disabled={unavailable}"),
      "page.tsx must set aria-disabled for unavailable cohort",
    );
    assert.ok(
      pageSource.includes("Мест нет") || pageSource.includes("Набор завершён"),
      "page.tsx must render sold out / finished text",
    );
  });

  test("F: Waiting-list state renders distinctly marked and selectable", () => {
    const wlCohort: Cohort = {
      id: "waiting_list",
      title: "Лист ожидания",
      start_date: "По согласованию",
      schedule: "Индивидуально",
      is_active: true,
      enrollment_status: "WAITING_LIST",
      is_enrollment_open: false,
    };

    assert.strictEqual(isCohortWaitingList(wlCohort), true);
    assert.strictEqual(isCohortUnavailable(wlCohort), false);
    assert.strictEqual(getCohortBadgeText(wlCohort), "Лист ожидания");

    assert.ok(
      pageSource.includes("Лист ожидания"),
      "page.tsx must contain 'Лист ожидания'",
    );
    assert.ok(
      pageSource.includes("cohortCardWaitingList"),
      "page.tsx must apply cohortCardWaitingList class",
    );
  });

  test("G: Course selection opens Screen 2 for all courses", () => {
    // Verify pilot restriction was removed (all 5 courses navigable)
    assert.strictEqual(
      pageSource.includes('course.id === "levels_of_consciousness"'),
      false,
      "page.tsx must NOT restrict navigation to levels_of_consciousness",
    );
    assert.ok(
      pageSource.includes('setScreen("detail")'),
      "page.tsx must navigate to detail screen",
    );
  });

  test("H: Back navigation returns to Screen 1", () => {
    assert.ok(
      pageSource.includes('setScreen("catalog")'),
      "page.tsx must support navigating back to catalog",
    );
    assert.ok(
      pageSource.includes("tg.BackButton"),
      "page.tsx must integrate Telegram BackButton",
    );
  });

  test("I: Valid deep link opens correct course directly", () => {
    assert.strictEqual(
      resolveDeepLinkCourseId("?course=maslow"),
      "maslow",
    );
    assert.strictEqual(
      resolveDeepLinkCourseId("?startapp=structural_typology"),
      "structural_typology",
    );
    assert.strictEqual(
      resolveDeepLinkCourseId("?start=levels_of_consciousness"),
      "levels_of_consciousness",
    );
    assert.strictEqual(
      resolveDeepLinkCourseId("", "maslow"),
      "maslow",
    );
  });

  test("J: Invalid deep link safely returns null (catalog fallback)", () => {
    assert.strictEqual(resolveDeepLinkCourseId(""), null);
    assert.strictEqual(resolveDeepLinkCourseId("?foo=bar"), null);
    assert.strictEqual(resolveDeepLinkCourseId("", undefined), null);
  });

  test("K: API error displays bounded UI message without stale hardcoded facts", () => {
    assert.ok(
      pageSource.includes("Актуальные данные временно недоступны"),
      "page.tsx must display 'Актуальные данные временно недоступны' on error",
    );
    assert.ok(
      pageSource.includes("Повторить"),
      "page.tsx must display retry button on error",
    );
  });

  test("L: Maslow live control values render correctly from projection", async () => {
    const { GET } = await import("../../src/app/api/tikhon/courses/route.ts");
    const response = await GET();
    const data = await response.json();
    const maslow = data.courses.find((c: { id: string }) => c.id === "maslow");

    assert.ok(maslow, "Maslow course must exist in projection");
    assert.equal(maslow.meetings_count, 4, "Maslow must have 4 meetings");
    assert.equal(maslow.pricing_options[0].price, 45000, "Maslow price must be 45 000 RUB");
    assert.equal(maslow.max_participants, 24, "Maslow limit must be 24");
    assert.ok(
      maslow.format_info.includes("2 раза в неделю"),
      "Maslow cadence must be 2 times a week",
    );
    assert.strictEqual(extractCadence(maslow.format_info), "Zoom · 2 раза в неделю");
  });

  test("M: Responsive structure contains no known horizontal-overflow regression", () => {
    assert.ok(
      cssSource.includes("overflow-x: hidden"),
      "CSS container must have overflow-x: hidden",
    );
    assert.ok(
      cssSource.includes("max-width: 480px"),
      "CSS container must constrain max-width to 480px",
    );
    assert.ok(
      cssSource.includes("@media (max-width: 390px)"),
      "CSS must include 390px responsive rules",
    );
    assert.ok(
      cssSource.includes("@media (max-width: 320px)"),
      "CSS must include 320px responsive rules",
    );
  });

  test("Helper: Russian meeting count inflection", () => {
    assert.strictEqual(getMeetingWord(1), "встреча");
    assert.strictEqual(getMeetingWord(2), "встречи");
    assert.strictEqual(getMeetingWord(4), "встречи");
    assert.strictEqual(getMeetingWord(5), "встреч");
    assert.strictEqual(getMeetingWord(12), "встреч");
    assert.strictEqual(getMeetingWord(21), "встреча");
    assert.strictEqual(getMeetingWord(24), "встречи");
    assert.strictEqual(getMeetingWord(25), "встреч");
  });
});
