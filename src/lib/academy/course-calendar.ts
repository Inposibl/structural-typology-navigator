import { isAcademyCourseId, type AcademyCourseId } from "./course-reference.ts";

/**
 * NAVIGATOR-LIVE-ACCEPTANCE-1.OWNER-DEFECT-REMEDIATION-1 — read-only Academy
 * course calendar.
 *
 * Source: the public, published calendar page of the Academy website. It is
 * the same documented source and page contract the Tikhon B6-C mirror reads
 * (chatbot/framer_calendar.py): every published session is a hidden
 * `<article data-schedule-item="true">` element with `data-course-id`,
 * optional `data-cohort`, `data-date` (ISO date only, no time, no time zone)
 * and `data-session-status`. The page publishes no enrollment-open indicator,
 * so this module never reports one.
 *
 * Read-only by construction: exactly one GET of one fixed public URL, no
 * credentials, no query, no other endpoint. Every failure — transport, status,
 * content type, size, missing calendar schema marker — fails closed to
 * UNAVAILABLE; an unavailable calendar is never reported as an empty one.
 */
export const ACADEMY_CALENDAR_URL = "https://structural-typology.academy/calendar";

/** Page-level marker of the calendar component (B6-C CALENDAR_LEGEND_MARKER). */
export const ACADEMY_CALENDAR_SCHEMA_MARKER = "calendar-legend-link";

export const ACADEMY_CALENDAR_TIMEOUT_MS = 3_000;
export const ACADEMY_CALENDAR_MAX_CHARS = 2_000_000;

/** Calendar dates are interpreted in Moscow time (UTC+3), as in Tikhon B6-C/F06. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

export type CalendarSession = {
  courseId: AcademyCourseId;
  cohortLabel: string | null;
  date: string;
};

export type CalendarUnavailableReason =
  | "NETWORK"
  | "HTTP_STATUS"
  | "CONTENT_TYPE"
  | "TOO_LARGE"
  | "SCHEMA_MARKER_MISSING";

export type CalendarReadResult =
  | {
      status: "AVAILABLE";
      sourceUrl: string;
      /** ISO date (MSK) of the read. */
      readDate: string;
      /** ISO date (UTC) of the page's Last-Modified header, when present. */
      pageLastModified: string | null;
      sessions: readonly CalendarSession[];
      ignoredItemCount: number;
    }
  | { status: "UNAVAILABLE"; reason: CalendarUnavailableReason };

export type CalendarReadOptions = {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  now?: () => Date;
};

export type CalendarReadDependency = (
  options: CalendarReadOptions,
) => Promise<CalendarReadResult>;

const ITEM_PATTERN =
  /<article\b([^>]*\bdata-schedule-item="true"[^>]*)>[\s\S]*?<\/article>/gu;
const DATA_ATTRIBUTE_PATTERN = /\bdata-([a-z][a-z0-9-]*)="([^"]*)"/gu;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

/** ISO calendar date of an instant in Moscow time. */
export function moscowIsoDate(instant: Date): string {
  return new Date(instant.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Parses the published page. Returns null when the calendar component marker
 * is absent (a redesign or a different page), never an empty calendar.
 * Only `active` sessions of a known Academy course with a valid ISO date are
 * kept; every other element is counted as ignored, never guessed.
 */
export function parseAcademyCalendarHtml(
  html: string,
): { sessions: CalendarSession[]; ignoredItemCount: number } | null {
  if (!html.includes(ACADEMY_CALENDAR_SCHEMA_MARKER)) return null;
  const sessions: CalendarSession[] = [];
  let ignoredItemCount = 0;
  for (const item of html.matchAll(ITEM_PATTERN)) {
    const attributes = new Map<string, string>();
    for (const [, name, value] of item[1].matchAll(DATA_ATTRIBUTE_PATTERN)) {
      attributes.set(name, value);
    }
    const courseId = attributes.get("course-id") ?? "";
    const date = attributes.get("date") ?? "";
    const status = attributes.get("session-status") ?? "";
    const cohort = (attributes.get("cohort") ?? "").trim();
    if (!isAcademyCourseId(courseId) || !isValidIsoDate(date) || status !== "active") {
      ignoredItemCount += 1;
      continue;
    }
    sessions.push({ courseId, cohortLabel: cohort.length > 0 ? cohort : null, date });
  }
  return { sessions, ignoredItemCount };
}

function lastModifiedIsoDate(header: string | null): string | null {
  if (header === null) return null;
  const parsed = new Date(header);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** The single read-only GET of the published calendar page. */
export const readAcademyCalendar: CalendarReadDependency = async (options) => {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ACADEMY_CALENDAR_TIMEOUT_MS);
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetchImpl(ACADEMY_CALENDAR_URL, {
        method: "GET",
        headers: { accept: "text/html" },
        signal: controller.signal,
      });
    } catch {
      return { status: "UNAVAILABLE", reason: "NETWORK" };
    }
    if (response.status !== 200) return { status: "UNAVAILABLE", reason: "HTTP_STATUS" };
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) {
      return { status: "UNAVAILABLE", reason: "CONTENT_TYPE" };
    }
    let html: string;
    try {
      html = await response.text();
    } catch {
      return { status: "UNAVAILABLE", reason: "NETWORK" };
    }
    if (html.length > ACADEMY_CALENDAR_MAX_CHARS) {
      return { status: "UNAVAILABLE", reason: "TOO_LARGE" };
    }
    const parsed = parseAcademyCalendarHtml(html);
    if (parsed === null) return { status: "UNAVAILABLE", reason: "SCHEMA_MARKER_MISSING" };
    return {
      status: "AVAILABLE",
      sourceUrl: ACADEMY_CALENDAR_URL,
      readDate: moscowIsoDate(now()),
      pageLastModified: lastModifiedIsoDate(response.headers.get("last-modified")),
      sessions: parsed.sessions,
      ignoredItemCount: parsed.ignoredItemCount,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
};

/**
 * One published run of a course: the sessions of one (course, cohort label)
 * pair, an unlabeled course's sessions forming one run. Its position relative
 * to the read date is a literal comparison of published dates only.
 */
export type CalendarRunSummary = {
  courseId: AcademyCourseId;
  cohortLabel: string | null;
  firstDate: string;
  lastDate: string;
  /** UPCOMING: the first published date is today or later. */
  position: "UPCOMING" | "IN_PROGRESS" | "PAST";
};

export function summarizeCalendarRuns(
  sessions: readonly CalendarSession[],
  readDate: string,
): CalendarRunSummary[] {
  const runs = new Map<string, { courseId: AcademyCourseId; cohortLabel: string | null; dates: string[] }>();
  for (const session of sessions) {
    const key = `${session.courseId}\u0000${session.cohortLabel ?? ""}`;
    const run = runs.get(key) ?? { courseId: session.courseId, cohortLabel: session.cohortLabel, dates: [] };
    run.dates.push(session.date);
    runs.set(key, run);
  }
  return [...runs.values()]
    .map((run) => {
      const dates = [...new Set(run.dates)].sort();
      const firstDate = dates[0];
      const lastDate = dates[dates.length - 1];
      const position: CalendarRunSummary["position"] =
        firstDate >= readDate ? "UPCOMING" : lastDate >= readDate ? "IN_PROGRESS" : "PAST";
      return { courseId: run.courseId, cohortLabel: run.cohortLabel, firstDate, lastDate, position };
    })
    .sort((a, b) => (a.firstDate === b.firstDate ? a.courseId.localeCompare(b.courseId) : a.firstDate.localeCompare(b.firstDate)));
}
