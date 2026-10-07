import type {
  AddressMode,
  ConversationProfile,
} from "../chat-contract.ts";
import type {
  ConversationActDecision,
} from "../navigation/conversation-act-router.ts";
import { ACADEMY_COURSES } from "./course-catalog.ts";
import {
  isAcademyCourseId,
  resolveCourseReferences,
  type AcademyCourseId,
} from "./course-reference.ts";

export const ACADEMY_PAYMENT_POLICY = {
  generalUrl: "https://t.me/AST_payment_course_bot",
  botHandle: "@AST_payment_course_bot",
  courses: {
    "structural-typology": {
      paymentUrl:
        "https://t.me/AST_payment_course_bot?start=structural_typology",
      title: "Структурная типология личности",
    },
    "levels-of-consciousness": {
      paymentUrl:
        "https://t.me/AST_payment_course_bot?start=levels_of_consciousness",
      title: "Иерархия уровней сознания",
    },
    maslow: {
      paymentUrl:
        "https://t.me/AST_payment_course_bot?start=maslow",
      title: "Иерархия потребностей А. Маслоу",
    },
    "normative-situation": {
      paymentUrl:
        "https://t.me/AST_payment_course_bot?start=normative_situation",
      title: "Нормативная ситуация",
    },
    "play-and-creativity": {
      paymentUrl:
        "https://t.me/AST_payment_course_bot?start=play_and_creativity",
      title: "Игра и творчество",
    },
  },
} as const;

export type PaymentCourseId =
  keyof typeof ACADEMY_PAYMENT_POLICY.courses;

export type EnrollmentPaymentAction = {
  courseId: PaymentCourseId | null;
  paymentUrl: string;
};

export type PaymentResolutionContext = {
  selectedCourseId?: string | null;
  courseMatch?:
    | "UNKNOWN"
    | "MATCHED"
    | "NO_CURRENT_COURSE_MATCH"
    | "AMBIGUOUS";
  staleCourseReference?: boolean;
  /** P03: the stored validated comparison candidates, [] when none. */
  courseReferents?: readonly AcademyCourseId[];
  /**
   * P03: a live structured payment clarification exists (lastAssistant act,
   * payment-multiple issue, AMBIGUOUS state, no stale/no-match guard), so an
   * exact named-candidate answer may continue the already-qualified flow.
   */
  pendingPaymentClarification?: boolean;
};

export type EnrollmentPaymentDecision =
  | { kind: "NONE" }
  | { kind: "ACTION"; action: EnrollmentPaymentAction }
  | {
      kind: "CLARIFY_MULTIPLE";
      courseIds: readonly AcademyCourseId[];
      /** True when the ambiguity came from stored P03 candidates or AMBIGUOUS state. */
      fromStoredCandidates?: boolean;
    }
  | {
      kind: "CONFIRM_COURSE_CHANGE";
      currentCourseId: PaymentCourseId;
      requestedCourseId: PaymentCourseId;
    }
  | { kind: "REESTABLISH_COURSE" }
  | { kind: "PRESERVE_NO_MATCH" }
  | { kind: "COURSE_NOT_PAYABLE"; courseId: AcademyCourseId };

const ENROLLMENT_INTENT_PATTERNS: readonly RegExp[] = [
  /хочу\s+на\s+(?:этот\s+)?курс/iu,
  /хочу\s+(?:оплатить|записаться|купить|участвовать|оформить)/iu,
  /как\s+(?:записаться|оплатить|купить|оформить)/iu,
  /куда\s+(?:платить|оплачивать|перевести)/iu,
  /готов[а-я]*\s+(?:оплатить|записаться|идти\s+на\s+курс|участвовать)/iu,
  /(?:запишите|запиши)\s+меня/iu,
  /(?:пришлите|пришли)\s+(?:ссылку\s+)?(?:на\s+)?оплат/iu,
  // A bare imperative at the start of the message is itself an enrollment
  // request; the same words mid-sentence stay narrative, not a request.
  /(?:^|\n)\s*(?:оплатить|записаться|купить|оформить)(?![а-яё])/iu,
  // RC-P02: the exact whole-message "где оплатить" form and nothing wider —
  // case, whitespace and terminal ?!. variation only; no stems, no prefixes.
  /^\s*где\s+оплатить\s*[?!.]*\s*$/iu,
];

/**
 * RC-P01 — the closed whole-request Academy-payment qualification that may
 * outrank an OUT_OF_SCOPE fallback. The prefixes, permitted suffixes, aliases
 * and the whole-suffix-consumed rule are exactly P01_REPAIR_CONTRACT.json's
 * closed_scope_override_grammar; anything not consumed by it stays unqualified.
 * Quotes, handles, URLs, negations and arbitrary prefixes are never stripped.
 */
const SCOPE_OVERRIDE_PREFIXES: readonly string[] = [
  "хочу оплатить",
  "хочу купить",
  "хочу оформить",
  "хочу записаться",
  "хочу участвовать",
  "хочу на",
  "как оплатить",
  "как купить",
  "как оформить",
  "как записаться",
  "где оплатить",
  "куда платить",
  "куда оплачивать",
  "куда перевести",
  "оплатить",
  "купить",
  "оформить",
  "записаться",
  "запишите меня",
  "запиши меня",
  "пришлите ссылку на оплату",
  "пришли ссылку на оплату",
  "пришлите оплату",
  "пришли оплату",
  "готов оплатить",
  "готова оплатить",
  "готовы оплатить",
  "готов записаться",
  "готова записаться",
  "готовы записаться",
  "готов идти на курс",
  "готова идти на курс",
  "готовы идти на курс",
  "готов участвовать",
  "готова участвовать",
  "готовы участвовать",
].slice().sort((a, b) => b.length - a.length);

const PERMITTED_ANAPHORIC_SUFFIXES: readonly string[] = [
  "его",
  "её",
  "этот курс",
  "участие",
];

const CLOSED_NAMED_ALIASES: ReadonlyArray<{
  courseId: AcademyCourseId;
  alias: string;
}> = [
  { courseId: "maslow", alias: "маслоу" },
  { courseId: "structural-typology", alias: "структурная типология" },
  { courseId: "structural-typology", alias: "структурную типологию" },
  { courseId: "levels-of-consciousness", alias: "уровни сознания" },
  { courseId: "levels-of-consciousness", alias: "уровней сознания" },
  { courseId: "normative-situation", alias: "нормативная ситуация" },
  { courseId: "normative-situation", alias: "нормативную ситуацию" },
  { courseId: "play-and-creativity", alias: "игра и творчество" },
  { courseId: "play-and-creativity", alias: "игру и творчество" },
  {
    courseId: "professional-development-stages",
    alias: "стадии профессионального развития",
  },
];

function normalizeForPaymentQualification(query: string): string {
  return query
    .trim()
    .replace(/[?!.]+\s*$/u, "")
    .trim()
    // A0 P01 normalization (CORR1 F02): the collapse is global, so every
    // interior whitespace run — not only the first — becomes one space.
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

/**
 * Matches the whole (already normalized) suffix against a named course object.
 * Per the P01 contract's closed grammar the optional курс/курса determiner
 * precedes the named course alternatives — an exact catalogue title or
 * catalogue ID, or one of the closed aliases (CORR1 F01: the determiner is
 * allowed before an alias too, so "Хочу оплатить курс Маслоу." qualifies).
 * The entire suffix must be consumed — substring course references alone are
 * insufficient.
 */
function matchNamedCourseObject(normalized: string): AcademyCourseId | null {
  const withoutDeterminer = normalized.replace(/^(?:курс|курса)\s+/u, "");
  for (const { courseId, alias } of CLOSED_NAMED_ALIASES) {
    if (withoutDeterminer === alias) return courseId;
  }

  for (const course of ACADEMY_COURSES) {
    if (
      (withoutDeterminer === course.id ||
        withoutDeterminer ===
          normalizeForPaymentQualification(course.title)) &&
      isAcademyCourseId(course.id)
    ) {
      return course.id;
    }
  }
  return null;
}

// Fresh authority is separate from the historical tables consumed by P03.
const FRESH_SCOPE_OVERRIDE_PREFIXES = [
  ...SCOPE_OVERRIDE_PREFIXES,
  "заплатить за",
  "где заплатить за",
].sort((a, b) => b.length - a.length);

const FRESH_NAMED_ALIASES = [
  ...CLOSED_NAMED_ALIASES,
  { courseId: "structural-typology", alias: "структурную типологию личности" },
  { courseId: "levels-of-consciousness", alias: "иерархию уровней сознания" },
] as const;

const FRESH_SECONDARY_CLAUSES = [
  "как оплатить", "где оплатить", "как купить", "как оформить", "как записаться",
  "куда платить", "куда оплачивать", "куда перевести",
  "оплатить", "купить", "оформить", "записаться",
];

const FRESH_OBJECT_SURFACES = [...new Set([
  ...FRESH_NAMED_ALIASES.map(({ alias }) => alias),
  ...ACADEMY_COURSES.flatMap((course) => [course.id, normalizeForPaymentQualification(course.title)]),
])].sort((a, b) => b.length - a.length).map((surface) =>
  surface.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/ /gu, "\\s+"),
).join("|");
const FRESH_OBJECT_SOURCE = `(?:(?:курс|курса)\\s+)?(?:${FRESH_OBJECT_SURFACES})`;
const FRESH_OBJECT_SPANS = new RegExp(
  `(?<![\\p{L}\\p{N}_@/\\-])(?:(?:курс|курса)\\s+)?(?:«\\s*${FRESH_OBJECT_SOURCE}\\s*»|"\\s*${FRESH_OBJECT_SOURCE}\\s*"|${FRESH_OBJECT_SOURCE})(?![\\p{L}\\p{N}_/\\-])`,
  "giu",
);

type FreshPaymentForm = { courseId: AcademyCourseId | null };

function matchFreshCourseObject(normalized: string): AcademyCourseId | null {
  let object = normalized.replace(/^(?:курс|курса)\s+/u, "");
  if (
    (object.startsWith("«") && object.endsWith("»")) ||
    (object.startsWith('"') && object.endsWith('"'))
  ) {
    object = object.slice(1, -1).trim();
  }
  const historical = matchNamedCourseObject(object);
  if (historical !== null) return historical;
  const withoutDeterminer = object.replace(/^(?:курс|курса)\s+/u, "");
  const alias = FRESH_NAMED_ALIASES.find((entry) => entry.alias === withoutDeterminer);
  return alias !== undefined && isAcademyCourseId(alias.courseId) ? alias.courseId : null;
}

function matchFreshPrimary(normalized: string): FreshPaymentForm | null {
  for (const prefix of FRESH_SCOPE_OVERRIDE_PREFIXES) {
    const remainder = normalized === prefix
      ? ""
      : normalized.startsWith(`${prefix} `)
        ? normalized.slice(prefix.length + 1)
        : null;
    if (remainder === null) continue;
    const courseId = matchFreshCourseObject(remainder);
    if (courseId !== null) return { courseId };
    if (
      prefix !== "заплатить за" && prefix !== "где заплатить за" &&
      (remainder === "" || PERMITTED_ANAPHORIC_SUFFIXES.includes(remainder))
    ) {
      return { courseId: null };
    }
  }
  return null;
}

function recognizeFreshPaymentForm(query: string): FreshPaymentForm | null {
  const framing = query.match(/^\s*(?:да|хорошо|окей)(?![а-яёa-z0-9])([\s,.;:!?…]+)/iu);
  if (framing !== null && (framing[1].match(/\n/gu)?.length ?? 0) <= 1) {
    query = query.slice(framing[0].length);
  }

  // Exact leftmost-longest objects protect their original source offsets,
  // including title punctuation and formatting whitespace inside the object.
  const spans = [...query.matchAll(FRESH_OBJECT_SPANS)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const fragments: string[] = [];
  const boundaries: ("SOFT_LF" | "HARD_PUNCT")[] = [];
  let fragment = "";
  let spanIndex = 0;
  let cursor = 0;
  while (cursor < query.length) {
    const span = spans[spanIndex];
    if (span !== undefined && cursor === span.start) {
      fragment += query.slice(span.start, span.end);
      cursor = span.end;
      spanIndex += 1;
      continue;
    }
    if (!/[\s.;:!?…]/u.test(query[cursor])) {
      fragment += query[cursor++];
      continue;
    }
    const start = cursor;
    while (cursor < query.length && /[\s.;:!?…]/u.test(query[cursor])) cursor += 1;
    const run = query.slice(start, cursor);
    const hard = /[.;:!?…]/u.test(run);
    if (hard || run.includes("\n")) {
      if (fragment.trim().length > 0) {
        fragments.push(fragment.trim());
        boundaries.push(hard ? "HARD_PUNCT" : "SOFT_LF");
        fragment = "";
      } else if (hard && boundaries.length > 0) {
        boundaries[boundaries.length - 1] = "HARD_PUNCT";
      }
    } else {
      fragment += " ";
    }
  }
  if (fragment.trim().length > 0) fragments.push(fragment.trim());
  if (fragments.length === 0) return null;

  // Evaluate contiguous partitions from the end, retaining only minimum-join
  // cost and its count. A tied minimum fails closed; hard edges never join.
  const best: ({ joins: number; count: number } & FreshPaymentForm | null)[] =
    Array(fragments.length + 1).fill(null);
  best[fragments.length] = { joins: 0, count: 1, courseId: null };
  for (let start = fragments.length - 1; start >= 0; start -= 1) {
    let block = "";
    for (let end = start; end < fragments.length; end += 1) {
      if (end > start && boundaries[end - 1] !== "SOFT_LF") break;
      block += `${end > start ? " " : ""}${fragments[end]}`;
      const normalized = block.replace(/\s+/gu, " ").trim().toLowerCase();
      const form = start === 0
        ? matchFreshPrimary(normalized)
        : FRESH_SECONDARY_CLAUSES.includes(normalized) ? { courseId: null } : null;
      const suffix = best[end + 1];
      if (form === null || suffix === null) continue;
      const joins = end - start + suffix.joins;
      const prior = best[start];
      if (prior === null || joins < prior.joins) {
        best[start] = { joins, count: suffix.count, courseId: form.courseId };
      } else if (joins === prior.joins) {
        prior.count = Math.min(2, prior.count + suffix.count);
      }
    }
  }
  const winner = best[0];
  return winner !== null && winner.count === 1 ? { courseId: winner.courseId } : null;
}

export function qualifiesForAcademyPaymentScopeOverride(
  query: string,
): boolean {
  return recognizeFreshPaymentForm(query) !== null;
}

/**
 * P03 issue identity for the structured payment clarification: the catalogue
 * ordinal indices (1-based positions in ACADEMY_COURSES) of the candidate set,
 * sorted ascending, so the same set always yields the same issue and a set
 * change always resets the budget. An empty (legacy) set gets a generic key.
 */
export function paymentMultipleIssueKey(
  courseIds: readonly AcademyCourseId[],
): string {
  const ordinals = [...new Set(courseIds)]
    .map((courseId) =>
      ACADEMY_COURSES.findIndex((course) => course.id === courseId) + 1,
    )
    .filter((ordinal) => ordinal > 0)
    .sort((a, b) => a - b);

  return ordinals.length === 0
    ? "payment-multiple:generic"
    : `payment-multiple:${ordinals.join("+")}`;
}

/**
 * P03 continuation: the whole message must be exactly a named course object
 * (P01 grammar) whose identity is a member of the stored candidate set. Merely
 * naming a course in any other frame is not consent to pay.
 */
export function resolvePaymentClarificationCandidate(
  query: string,
  courseReferents: readonly AcademyCourseId[],
): AcademyCourseId | null {
  const candidate = matchNamedCourseObject(
    normalizeForPaymentQualification(query),
  );
  return candidate !== null && courseReferents.includes(candidate)
    ? candidate
    : null;
}

/**
 * CORR2 F04 — the bounded structural identification used by the conversation
 * control kernel: the whole message must be an exact payable named course
 * object — bare, or under the closed RC-P01 qualification grammar ("хочу
 * оплатить курс Маслоу.") — whose identity is a member of the current stored
 * candidate set. This is what lets the kernel recognize the answer to the
 * actually asked third payment-multiple question without any lexical-generic
 * "looks like a course name" rule; everything else — a non-member name, a
 * listed-unroutable identity, arbitrary prose, or an unconsumed foreign
 * tail — resolves to null and stays with the ordinary control lanes.
 */
export function resolveLivePaymentMultipleAnswer(
  query: string,
  courseReferents: readonly AcademyCourseId[],
): PaymentCourseId | null {
  const normalized = normalizeForPaymentQualification(query);
  if (normalized.length === 0) return null;

  const suffixes = [normalized];
  for (const prefix of SCOPE_OVERRIDE_PREFIXES) {
    if (normalized === prefix) {
      break;
    }
    if (normalized.startsWith(`${prefix} `)) {
      suffixes.push(normalized.slice(prefix.length + 1));
      break;
    }
  }

  for (const suffix of suffixes) {
    if (suffix.length === 0) continue;
    const candidate = matchNamedCourseObject(suffix);
    if (
      candidate !== null &&
      courseReferents.includes(candidate) &&
      isPaymentCourseId(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

export function hasEnrollmentPaymentIntent(
  query: string,
): boolean {
  return ENROLLMENT_INTENT_PATTERNS.some((pattern) =>
    pattern.test(query),
  );
}

export function resolveExplicitPaymentCourseId(
  query: string,
): PaymentCourseId | null {
  const resolution = resolveCourseReferences(query);
  return resolution.kind === "ONE" && isPaymentCourseId(resolution.courseIds[0])
    ? resolution.courseIds[0]
    : null;
}

function isPaymentCourseId(value: string): value is PaymentCourseId {
  return Object.prototype.hasOwnProperty.call(
    ACADEMY_PAYMENT_POLICY.courses,
    value,
  );
}

export function resolveEnrollmentPaymentAction(
  query: string,
  act: ConversationActDecision,
  context: PaymentResolutionContext = {},
): EnrollmentPaymentAction | null {
  const decision = resolveEnrollmentPaymentDecision(query, act, context);
  return decision.kind === "ACTION" ? decision.action : null;
}

export function paymentActionForCourse(
  courseId: PaymentCourseId,
): EnrollmentPaymentAction {
  return {
    courseId,
    paymentUrl: ACADEMY_PAYMENT_POLICY.courses[courseId].paymentUrl,
  };
}

export function resolveEnrollmentPaymentDecision(
  query: string,
  act: ConversationActDecision,
  context: PaymentResolutionContext = {},
): EnrollmentPaymentDecision {
  if (act.state === "ROUTER_DEGRADED") return { kind: "NONE" };

  // P03 continuation — evaluated before the fresh-intent gate and only for a
  // live structured payment clarification: an exact named-candidate answer
  // continues the already-qualified flow without repeating payment language.
  // Every other request falls through to the fresh-intent precedence below.
  if (context.pendingPaymentClarification === true) {
    const storedReferents = context.courseReferents ?? [];
    if (storedReferents.length > 0) {
      const candidate = resolvePaymentClarificationCandidate(
        query,
        storedReferents,
      );
      if (candidate !== null) {
        if (!isPaymentCourseId(candidate)) {
          return { kind: "COURSE_NOT_PAYABLE", courseId: candidate };
        }
        return { kind: "ACTION", action: paymentActionForCourse(candidate) };
      }
    }
  }

  const freshForm = recognizeFreshPaymentForm(query);
  const genericIntent = hasEnrollmentPaymentIntent(query);
  if (!genericIntent && freshForm?.courseId == null) {
    return { kind: "NONE" };
  }

  // RC-P01 — only a complete fresh request satisfying the closed Academy-
  // payment qualification may outrank the scope fallback; every unqualified
  // OUT_OF_SCOPE request keeps the existing NONE veto.
  if (
    act.state === "OUT_OF_SCOPE" &&
    freshForm === null
  ) {
    return { kind: "NONE" };
  }

  const references = resolveCourseReferences(query);
  if (references.kind === "MULTIPLE") {
    return {
      kind: "CLARIFY_MULTIPLE",
      courseIds: references.courseIds,
    };
  }

  const explicitCourseId = references.kind === "ONE"
    ? references.courseIds[0]
    : null;
  if (explicitCourseId !== null && !isPaymentCourseId(explicitCourseId)) {
    return { kind: "COURSE_NOT_PAYABLE", courseId: explicitCourseId };
  }

  const selectedCourseId =
    context.selectedCourseId && isPaymentCourseId(context.selectedCourseId)
      ? context.selectedCourseId
      : act.state === "COURSE_FOLLOW_UP" && isPaymentCourseId(act.courseId)
        ? act.courseId
        : null;

  if (explicitCourseId !== null && isPaymentCourseId(explicitCourseId)) {
    if (selectedCourseId !== null && selectedCourseId !== explicitCourseId) {
      return {
        kind: "CONFIRM_COURSE_CHANGE",
        currentCourseId: selectedCourseId,
        requestedCourseId: explicitCourseId,
      };
    }

    if (freshForm?.courseId !== explicitCourseId) return { kind: "NONE" };
    return { kind: "ACTION", action: paymentActionForCourse(explicitCourseId) };
  }

  if (context.staleCourseReference) {
    return { kind: "REESTABLISH_COURSE" };
  }

  if (context.courseMatch === "NO_CURRENT_COURSE_MATCH") {
    return { kind: "PRESERVE_NO_MATCH" };
  }

  // P03 — stored ambiguity outranks the selected/general fallback: a retained
  // multi-course set (or a legacy AMBIGUOUS state with no known set) asks the
  // structured payment clarification instead of choosing a course.
  const storedCandidates = context.courseReferents ?? [];
  if (storedCandidates.length > 0 || context.courseMatch === "AMBIGUOUS") {
    return {
      kind: "CLARIFY_MULTIPLE",
      courseIds: storedCandidates,
      fromStoredCandidates: true,
    };
  }

  if (selectedCourseId !== null) {
    if (freshForm === null) return { kind: "NONE" };
    return { kind: "ACTION", action: paymentActionForCourse(selectedCourseId) };
  }

  if (genericIntent && act.state !== "META") {
    return {
      kind: "ACTION",
      action: {
        courseId: null,
        paymentUrl: ACADEMY_PAYMENT_POLICY.generalUrl,
      },
    };
  }

  return { kind: "NONE" };
}

/**
 * Opening sentence of the enrollment answer (A03).
 *
 * The mode is the profile's and only the profile's. An unknown mode yields
 * address-free wording rather than an invented default, so a session that chose
 * «ты» can never be addressed with a «вы» imperative; nothing else about the
 * payment facts depends on it. Course titles, the payment destination and the
 * transaction identity are never inflected.
 */
function enrollmentOpeningSentence(
  action: EnrollmentPaymentAction,
  mode: AddressMode | null,
): string {
  if (action.courseId) {
    const course = ACADEMY_PAYMENT_POLICY.courses[action.courseId];

    if (mode === null) {
      return `Отлично! Оформление участия и оплаты курса «${course.title}» — через Тихона (AI-секретаря Академии) в Telegram: ${action.paymentUrl}.`;
    }

    const verb = mode === "TY" ? "перейди" : "перейдите";
    return `Отлично! Для оформления участия и оплаты курса «${course.title}» ${verb} к Тихону — AI-секретарю Академии в Telegram: ${action.paymentUrl}.`;
  }

  if (mode === null) {
    return `Запись и оплата — через Тихона (AI-секретаря Академии) в Telegram: ${ACADEMY_PAYMENT_POLICY.generalUrl}.`;
  }

  const verb = mode === "TY" ? "перейди" : "перейдите";
  return `Для записи и оплаты ${verb} к Тихону — AI-секретарю Академии в Telegram: ${ACADEMY_PAYMENT_POLICY.generalUrl}.`;
}

/**
 * Canonical enrollment/payment answer (Package C).
 *
 * Wording only: the payment destination, the course identity, the payment link
 * choice and the payment action are exactly what they were. The only thing the
 * profile influences here is the address mode of the one user-directed verb.
 */
export function composeEnrollmentPaymentAnswer(
  action: EnrollmentPaymentAction,
  profile?: ConversationProfile,
): string {
  return [
    enrollmentOpeningSentence(action, profile?.addressMode ?? null),
    action.courseId
      ? "Он за 1 минуту оформит заявку и пришлёт реквизиты или счёт для бухгалтерии."
      : "Там можно выбрать программу из каталога Академии.",
  ].join("\n\n");
}
