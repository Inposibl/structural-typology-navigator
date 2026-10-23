import type {
  ConversationMessage,
  ConversationProfile,
} from "../chat-contract.ts";
import { ACADEMY_CONTACT_POLICY } from "../academy/contact-policy.ts";
import { ACADEMY_COURSES, getAcademyCourse } from "../academy/course-catalog.ts";
import { resolveCourseReferences } from "../academy/course-reference.ts";
import type {
  CurrentMetadataField,
  FactualIntent,
} from "./conversation-act-router.ts";
import {
  composeCatalogFollowUpAnswer,
  isCourseDurationQuestion,
} from "./follow-up-grounding.ts";
import type {
  MetadataFieldGuardDisposition,
  MetadataSubjectFamily,
  NavigatorMetadataFieldGuardLog,
} from "./navigator-observability.ts";
import { courseLiteralIn } from "./task-plan.ts";

/**
 * NAVIGATOR-CONVERSATION-ENTRY-SIMPLIFICATION-1.CORR1.FIX-4b — deterministic
 * metadata field consistency guard (DESIGN-1 + DESIGN-1.CORR1).
 *
 * A structurally valid FACTUAL decision may name a CURRENT_METADATA field the
 * current request did not ask about (the observed case: PRICE for «А сколько
 * длится этот курс?»). The guard compares the proposed fields with the closed
 * subject families of the current effective text only. Every field whose
 * family was not requested is removed before coverage is evaluated; a correct
 * sibling never authorizes an unrequested field. The guard never adds PRICE;
 * it may add only an admitted no-authority timing field, the unchanged FIX-1
 * catalogue duration text, or a closed limitation line. No cue, no change.
 */

export type TimingMetadataField = "SCHEDULE" | "COHORT" | "ENROLLMENT_WINDOW";

export type MetadataFieldVerdict =
  | "NOT_APPLICABLE"
  | "UNCORROBORATED"
  | "CONSISTENT"
  | "PARTIAL"
  | "MISMATCH";

const SUBJECT_FAMILY_ORDER: readonly MetadataSubjectFamily[] = [
  "PRICE",
  "DURATION",
  "TIMING",
];

const METADATA_FIELD_ORDER: readonly CurrentMetadataField[] = [
  "PRICE",
  "SCHEDULE",
  "COHORT",
  "ENROLLMENT_WINDOW",
];

const TIMING_FIELD_ORDER: readonly TimingMetadataField[] = [
  "SCHEDULE",
  "COHORT",
  "ENROLLMENT_WINDOW",
];

const FIELD_FAMILY: Readonly<Record<CurrentMetadataField, MetadataSubjectFamily>> = {
  PRICE: "PRICE",
  SCHEDULE: "TIMING",
  COHORT: "TIMING",
  ENROLLMENT_WINDOW: "TIMING",
};

// ---------------------------------------------------------------- closed lexicon
// Ported verbatim from the DESIGN-1 prototype (probe.mts:25-87).

/** Quoted spans carry no current-turn authority. */
const QUOTED = /«[^»]*»|„[^“”]*[“”]|“[^”]*”|"[^"]*"/gu;
/** Attributive instrumental «курс длительностью N…» describes, it does not ask. */
const ATTRIBUTIVE_DURATION = /(?<![а-яё])(?:длительностью|продолжительностью)(?![а-яё])/giu;
/** Clause boundaries: punctuation, dash, and the contrastive conjunctions. */
const CLAUSE_SPLIT = /[,.;:!?\n—–]+|\s-\s|\s(?=(?:а|но|однако|зато)\s)/iu;
/** Closed negated-request triggers; the polite «не подскажете» is not one. */
const NEGATED_CLAUSE =
  /(?<![а-яё])не\s+(?:(?:спрашива|спрош|интерес|нужн|надо|важн|волну|ищу|прошу|путай|путат|смешива|подменя|подставля|цен|стоимост|сколько|когда|длит|продолжит)[а-яё]*|(?:о|об|про)(?![а-яё])|хочу\s+знать)/iu;
/** Closed retrospective triggers. */
const RETRO_CLAUSE =
  /(?<![а-яё])(?:раньше|ранее|прежде|до\s+этого|в\s+прошлый\s+раз|спрашивал[аи]?|узнавал[аи]?|уточнял[аи]?|уже\s+(?:знаю|знаем|узнал[аи]?|выяснил[аи]?))(?![а-яё])/iu;

/** Deliberately broad: a genuine price or payment question is never vetoed. */
const PRICE_CUES: readonly RegExp[] = [
  /(?<![а-яё])сколько\s+(?:[а-яё]+\s+){0,3}?сто(?:ит|ят|ить|ило|или)(?![а-яё])/iu,
  /(?<![а-яё])обойд[её]т(?:ся)?(?![а-яё])/iu,
  /стоимост/iu,
  /(?<![а-яё])цен(?:а|ы|у|е|ой|ник|ам|ах)?(?![а-яё])/iu,
  /(?<![а-яё])поч[её]м(?![а-яё])/iu,
  /₽|(?<![а-яё])руб(?:л|\.|(?![а-яё]))/iu,
  /(?<![а-яё])(?:дорог|деш[её]в|бесплатн|платн|скидк|рассрочк|тариф|взнос|прайс)/iu,
  /(?<![а-яё])(?:оплат(?:а|у|ы|е|ой|ить|ите|им)|заплатить|платить|плата|плату|платы)(?![а-яё])/iu,
  /(?<![а-яё])сколько\s+(?:[а-яё]+\s+){0,2}?денег(?![а-яё])/iu,
];

const DURATION_CUES: readonly RegExp[] = [
  /(?<![а-яё])как\s+долго(?![а-яё])/iu,
  /(?<![а-яё])сколько\s+(?:по\s+)?времени(?![а-яё])/iu,
  /(?<![а-яё])сколько\s+(?:академических\s+)?(?:час(?:ов|а)?|минут|недел[ьи]|месяц(?:ев|а)?|дней|дня)(?![а-яё])/iu,
  /(?<![а-яё])сколько\s+(?:[а-яё]+\s+){0,2}?(?:длит|длят|ид[её]т|идут|продолжа)[а-яё]*/iu,
  /(?:^|(?<![а-яё])(?:какая|какова|каков|узнать|нужна|нужно|интересует|интересна|о|об|про|уточнить|подскажите|скажите|сообщите)\s+(?:[а-яё]+\s+){0,1}?)(?:длительност|продолжительност)(?:ь|и)(?![а-яё])/iu,
  /(?<![а-яё])сколько\s+(?:(?!сто)[а-яё]+\s+){0,2}?(?:встреч|заняти|урок|лекци|модул)/iu,
  /^\s*(?:а\s+)?(?:по\s+времени|надолго|долго|долгий)\s*$/iu,
];

const TIMING_CUES: readonly RegExp[] = [
  /(?<![а-яё])когда\s+(?:[а-яё]+\s+){0,2}?(?:начина|начн|старт|откро|открыва|следующ|ближайш|поток|набор|будет\s+(?:поток|набор|старт))/iu,
  /расписани/iu,
  /(?<![а-яё])(?:дат[аыуе]?|числ[оа])\s+(?:старта|начала|запуска|набора)/iu,
  /(?<![а-яё])(?:ближайш|следующ)[а-яё]*\s+(?:поток|набор|запуск|старт)/iu,
  /(?<![а-яё])(?:окн[оа]|срок[иа]?)\s+(?:набора|записи)|до\s+какого\s+(?:числа|срока)/iu,
  /в\s+какие\s+дни|по\s+каким\s+дням|во\s+сколько\s+(?:начина|проход|идут|будут|встреч|заняти)/iu,
  /(?<![а-яё])(?:старт|начало)\s+(?:курса|обучения|занятий|потока)/iu,
];

/**
 * The closed subject families the current effective text asks about, in the
 * fixed order PRICE, DURATION, TIMING. Quoted, negated and retrospective
 * clauses contribute nothing. Prior turns are never scanned.
 */
export function detectRequestedFamilies(text: string): MetadataSubjectFamily[] {
  const found = new Set<MetadataSubjectFamily>();
  const unquoted = text.replace(QUOTED, " ").replace(ATTRIBUTIVE_DURATION, " ");
  for (const raw of unquoted.split(CLAUSE_SPLIT)) {
    const clause = raw.trim();
    if (clause.length === 0) continue;
    if (NEGATED_CLAUSE.test(clause) || RETRO_CLAUSE.test(clause)) continue;
    if (PRICE_CUES.some((cue) => cue.test(clause))) found.add("PRICE");
    if (
      isCourseDurationQuestion(clause) ||
      DURATION_CUES.some((cue) => cue.test(clause))
    ) {
      found.add("DURATION");
    }
    if (TIMING_CUES.some((cue) => cue.test(clause))) found.add("TIMING");
  }
  return SUBJECT_FAMILY_ORDER.filter((family) => found.has(family));
}

// ---------------------------------------------------------------- closed limitation copy

function limitationText(
  family: MetadataSubjectFamily,
  profile: ConversationProfile | undefined,
): string {
  const ty = profile?.addressMode === "TY";
  if (family === "DURATION") {
    return `О продолжительности: в подтверждённых данных Академии продолжительность курсов указана только количеством встреч, а длительность одной встречи, общее количество часов и календарные сроки не указаны. ${ty ? "Спроси" : "Спросите"}, пожалуйста, отдельным сообщением, сколько длится нужный курс, назвав его, — я приведу количество встреч по каталогу. Быстро уточнить это можно в Telegram Академии: ${ACADEMY_CONTACT_POLICY.fastTelegramUrl}.`;
  }
  if (family === "PRICE") {
    return `О стоимости: в этом ответе я её не называю, чтобы не ответить сведениями о другом поле. ${ty ? "Спроси" : "Спросите"}, пожалуйста, о цене отдельным сообщением, назвав курс.`;
  }
  return `О сроках курса: в этом ответе я их не называю. ${ty ? "Спроси" : "Спросите"}, пожалуйста, о расписании или наборе отдельным сообщением.`;
}

// ---------------------------------------------------------------- duration authority

type CurrentMetadataIntent = Extract<FactualIntent, { kind: "CURRENT_METADATA" }>;

/** The FIX-1 catalogue composer's duration and meeting-count lead. */
const CATALOG_DURATION_LEAD = "В текущем каталоге";

/**
 * DESIGN-1 §7.3 — the one course the price composer would have rendered, and
 * only when the conversation's literal titles (all roles) name exactly that
 * course, or name none while the latest message names it by its short name
 * (the D-A boundary). Never wider than FIX-4 / D-A.
 */
function durationSafeCourseId(
  intent: CurrentMetadataIntent,
  selectedCourseId: string | null,
  messages: readonly ConversationMessage[],
): string | null {
  if (intent.scope === "ALL") return null;
  const ids = intent.courseIds.length > 0
    ? intent.courseIds
    : selectedCourseId === null ? [] : [selectedCourseId];
  if (ids.length !== 1) return null;
  const courseId = ids[0];
  if (getAcademyCourse(courseId)?.status !== "ROUTABLE") return null;
  const literal = ACADEMY_COURSES
    .filter((course) => courseLiteralIn(course.id, messages))
    .map((course) => course.id);
  if (literal.length === 1 && literal[0] === courseId) return courseId;
  if (literal.length === 0) {
    const reference = resolveCourseReferences(messages.at(-1)?.content ?? "");
    if (reference.kind === "ONE" && reference.courseIds[0] === courseId) return courseId;
  }
  return null;
}

/** A sibling intent that the existing composers render with meeting counts. */
function statesMeetingCounts(intent: FactualIntent): boolean {
  if (intent.kind === "CATALOG_LIST") return true;
  if (intent.kind !== "COURSE_COMPARISON") return false;
  return (
    !intent.hasUnknownCourse &&
    intent.courseIds.length === 2 &&
    intent.courseIds.every((courseId) => getAcademyCourse(courseId) !== null)
  );
}

// ---------------------------------------------------------------- turn assessment

export type MetadataFieldAssessment = {
  verdict: MetadataFieldVerdict;
  requested: MetadataSubjectFamily[];
  /** Equal to the input intents unless the verdict is PARTIAL or MISMATCH. */
  sanitizedIntents: FactualIntent[];
  vetoedFields: CurrentMetadataField[];
  addedFields: TimingMetadataField[];
  /** The unchanged FIX-1 catalogue duration text (CATALOG_DURATION). */
  supplement: string | null;
  /** One closed line per requested family that remains unanswered. */
  limitations: string[];
  dispositions: MetadataFieldGuardDisposition[];
};

export function assessMetadataFieldConsistency(input: {
  intents: readonly FactualIntent[];
  /** The current effective request; the only cue source. */
  text: string;
  /** Literal course identity only; never scanned for cues. */
  messages: readonly ConversationMessage[];
  selectedCourseId: string | null;
  profile?: ConversationProfile;
  /** Timing fields the unchanged metadata composer may narrate as unavailable. */
  admittedTimingFields: readonly TimingMetadataField[];
}): MetadataFieldAssessment {
  const unchanged = (
    verdict: MetadataFieldVerdict,
    requested: MetadataSubjectFamily[],
  ): MetadataFieldAssessment => ({
    verdict,
    requested,
    sanitizedIntents: [...input.intents],
    vetoedFields: [],
    addedFields: [],
    supplement: null,
    limitations: [],
    dispositions: [],
  });

  // 1. Applicability.
  const metadata = input.intents.find(
    (intent): intent is CurrentMetadataIntent => intent.kind === "CURRENT_METADATA",
  );
  if (metadata === undefined) return unchanged("NOT_APPLICABLE", []);

  // 2. Requested families; no cue means no change.
  const requested = detectRequestedFamilies(input.text);
  if (requested.length === 0) return unchanged("UNCORROBORATED", []);

  // 3. Field corroboration, before coverage may decide anything.
  const kept = metadata.fields.filter((field) => requested.includes(FIELD_FAMILY[field]));
  const vetoedFields = metadata.fields.filter(
    (field) => !requested.includes(FIELD_FAMILY[field]),
  );

  // 4–5. Coverage from the corroborated proposal only.
  const covered = new Set<MetadataSubjectFamily>(kept.map((field) => FIELD_FAMILY[field]));
  if (input.intents.some(statesMeetingCounts)) covered.add("DURATION");
  let uncovered = requested.filter((family) => !covered.has(family));

  // 6. The only unchanged exit.
  if (uncovered.length === 0 && vetoedFields.length === 0) {
    return unchanged("CONSISTENT", requested);
  }
  const verdict: MetadataFieldVerdict = requested.some((family) => covered.has(family))
    ? "PARTIAL"
    : "MISMATCH";

  const fields: CurrentMetadataField[] = [...kept];
  const addedFields: TimingMetadataField[] = [];
  const dispositions: MetadataFieldGuardDisposition[] = [];
  let supplement: string | null = null;

  // 7. Uncovered TIMING: only admitted no-authority fields; never PRICE.
  if (uncovered.includes("TIMING")) {
    const admitted = TIMING_FIELD_ORDER.filter(
      (field) => input.admittedTimingFields.includes(field) && !kept.includes(field),
    );
    if (admitted.length > 0) {
      fields.push(...admitted);
      addedFields.push(...admitted);
      uncovered = uncovered.filter((family) => family !== "TIMING");
      dispositions.push("TIMING_NO_AUTHORITY");
    }
  }

  // 8. Uncovered DURATION: FIX-1 catalogue text under the identity gate.
  if (uncovered.includes("DURATION")) {
    const courseId = durationSafeCourseId(metadata, input.selectedCourseId, input.messages);
    const course = courseId === null ? null : getAcademyCourse(courseId);
    const answer = course === null ? null : composeCatalogFollowUpAnswer(course, input.text);
    if (answer !== null && answer.startsWith(CATALOG_DURATION_LEAD)) {
      supplement = answer;
      uncovered = uncovered.filter((family) => family !== "DURATION");
      dispositions.push("CATALOG_DURATION");
    }
  }

  // 9. Residual families: closed limitation copy.
  const limitations: string[] = [];
  for (const family of uncovered) {
    limitations.push(limitationText(family, input.profile));
    dispositions.push(`LIMITATION_${family}`);
  }

  // 11. Sanitized intents, original order.
  const sanitizedIntents = input.intents.flatMap((intent): FactualIntent[] => {
    if (intent !== metadata) return [intent];
    return fields.length === 0
      ? []
      : [{ ...metadata, courseIds: [...metadata.courseIds], fields }];
  });

  return {
    verdict,
    requested,
    sanitizedIntents,
    vetoedFields,
    addedFields,
    supplement,
    limitations,
    dispositions,
  };
}

export function isMetadataFieldIntervention(
  assessment: MetadataFieldAssessment,
): boolean {
  return assessment.verdict === "PARTIAL" || assessment.verdict === "MISMATCH";
}

/** The closed guard record; null on every non-intervened turn. */
export function metadataFieldGuardRecord(
  assessment: MetadataFieldAssessment,
  hook: "TURN",
): NavigatorMetadataFieldGuardLog | null {
  if (assessment.verdict !== "PARTIAL" && assessment.verdict !== "MISMATCH") return null;
  return {
    verdict: assessment.verdict,
    requested: [...assessment.requested],
    vetoedFields: [...assessment.vetoedFields],
    addedFields: [...assessment.addedFields],
    dispositions: [...assessment.dispositions],
    hook,
  };
}

// ---------------------------------------------------------------- recovery (H2)

export type MetadataRecoveryTaskAssessment = {
  blocked: boolean;
  /** null when nothing was assessed (or identity was unreadable and failed closed). */
  verdict: "PARTIAL" | "MISMATCH" | null;
  requested: MetadataSubjectFamily[];
  vetoedFields: CurrentMetadataField[];
};

function isCurrentMetadataField(value: string): value is CurrentMetadataField {
  return (METADATA_FIELD_ORDER as readonly string[]).includes(value);
}

/**
 * DESIGN-1 §8.4 + CORR1 §4.4, ID-1 = A, OD-I2 = A — `tasks` are the tasks of
 * ONE recovery segment. Each task's own field must be corroborated by that
 * task's evidence; only a single-task plan falls back to the whole effective
 * request when the span carries no cue. The families a task requests must be
 * covered by the union of the fields of that same segment (the fields its
 * per-task render displays) — never by another segment. An uncorroborated
 * field (MISMATCH) or an uncovered requested family (PARTIAL) blocks the
 * segment.
 */
export function assessRecoveryMetadataTasks(input: {
  tasks: readonly { type: string; evidence: string }[];
  latestText: string;
  activeTaskCount: number;
}): MetadataRecoveryTaskAssessment {
  const requested = new Set<MetadataSubjectFamily>();
  const vetoed = new Set<CurrentMetadataField>();
  const segmentFamilies = new Set<MetadataSubjectFamily>();
  for (const task of input.tasks) {
    if (isCurrentMetadataField(task.type)) segmentFamilies.add(FIELD_FAMILY[task.type]);
  }
  let blocked = false;
  let partial = false;
  for (const task of input.tasks) {
    if (!isCurrentMetadataField(task.type)) continue;
    let families = detectRequestedFamilies(task.evidence);
    if (families.length === 0 && input.activeTaskCount === 1) {
      families = detectRequestedFamilies(input.latestText);
    }
    if (families.length === 0) continue;
    const kept = families.includes(FIELD_FAMILY[task.type]);
    const covered = families.every((requestedFamily) => segmentFamilies.has(requestedFamily));
    if (kept && covered) continue;
    blocked = true;
    for (const requestedFamily of families) requested.add(requestedFamily);
    if (kept) partial = true;
    else vetoed.add(task.type);
  }
  return {
    blocked,
    verdict: blocked ? (partial ? "PARTIAL" : "MISMATCH") : null,
    requested: SUBJECT_FAMILY_ORDER.filter((family) => requested.has(family)),
    vetoedFields: METADATA_FIELD_ORDER.filter((field) => vetoed.has(field)),
  };
}

/** One RECOVERY record for every guard-blocked segment of a recovered turn. */
export function recoveryMetadataFieldGuardRecord(
  blocks: readonly MetadataRecoveryTaskAssessment[],
): NavigatorMetadataFieldGuardLog | null {
  const assessed = blocks.filter((block) => block.blocked && block.verdict !== null);
  if (assessed.length === 0) return null;
  const requested = new Set(assessed.flatMap((block) => block.requested));
  const vetoed = new Set(assessed.flatMap((block) => block.vetoedFields));
  return {
    verdict: assessed.every((block) => block.verdict === "MISMATCH") ? "MISMATCH" : "PARTIAL",
    requested: SUBJECT_FAMILY_ORDER.filter((family) => requested.has(family)),
    vetoedFields: METADATA_FIELD_ORDER.filter((field) => vetoed.has(field)),
    addedFields: [],
    dispositions: [],
    hook: "RECOVERY",
  };
}
