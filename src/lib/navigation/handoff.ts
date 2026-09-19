/**
 * Package-B A23/A24 human handoff.
 *
 * Handoff is a policy state, not a transport. No notification, CRM transfer, or
 * Telegram message exists in this architecture, so the Navigator stops at
 * READY: it prepares a bounded context summary and gives the canonical contact
 * path, and the public wording never claims that a human was reached.
 *
 * The summary is built from structured state and canonical entities only. It
 * never scrapes prior assistant prose, and every field is a closed enum or a
 * catalog identifier, so the handoff cannot carry an invented fact.
 */

import { getAcademyCourse } from "../academy/course-catalog.ts";
import {
  MAX_HANDOFF_CONTEXT_LENGTH,
  MAX_HANDOFF_ESTABLISHED_FACTS,
  type ConversationFlowId,
  type ConversationState,
  type CourseMatchState,
  type HandoffContactPreference,
  type HandoffContext,
  type HandoffFact,
  type HandoffGoal,
  type HandoffReason,
  type HandoffState,
  type HandoffUnresolvedChoice,
} from "./conversation-state.ts";
import { splitIntoClauses } from "./conversation-control-phrases.ts";

/** A person the user could be handed over to. */
const HUMAN_TARGET = String.raw`(?:человек[а-яё]*|жив(?:ой|ого|ому|ым|ом)\s+человек[а-яё]*|менеджер[а-яё]*|оператор[а-яё]*|специалист[а-яё]*|администратор[а-яё]*|алексе[а-яё]+)`;

/**
 * The person plus the designation that follows the name in ordinary Russian
 * ("менеджером Академии Алексеем"), so the designation is part of the request
 * rather than a spurious remainder.
 */
const HUMAN_PHRASE = String.raw`${HUMAN_TARGET}(?:\s+(?:[А-ЯЁ][а-яё]+|академии)){0,3}`;

const HANDOFF_RULES: readonly RegExp[] = [
  // "хочу поговорить с человеком", "можно связаться с менеджером Академии"
  new RegExp(
    String.raw`^(?:я\s+)?(?:хочу|хотел[а-яё]*|можно|надо|мне\s+надо)\s+(?:поговорить|пообщаться|побеседовать|посоветоваться|связаться|соединиться|обсудить)\s+(?:с|со)\s+${HUMAN_PHRASE}`,
    "iu",
  ),
  // "хочу человека", "мне нужен оператор", "нужен живой человек"
  new RegExp(
    String.raw`^(?:я\s+)?(?:хочу|хотел[а-яё]*|мне\s+нуж(?:ен|на|но|ны)|нужен|нужна|надо)\s+${HUMAN_PHRASE}`,
    "iu",
  ),
  // "позови человека", "дайте мне живого человека", "соедини с Алексеем"
  new RegExp(
    String.raw`^(?:позови(?:те)?|соедини(?:те)?|подключи(?:те)?|переведи(?:те)?|дайте|дай|пригласи(?:те)?)\s+(?:мне\s+|меня\s+)?(?:с\s+|со\s+)?${HUMAN_PHRASE}`,
    "iu",
  ),
  // "можно к человеку?", "можно к живому человеку?"
  new RegExp(
    String.raw`^(?:а\s+)?можно\s+(?:к|до)\s+${HUMAN_PHRASE}`,
    "iu",
  ),
  // "передайте это Алексею", "напишите менеджеру"
  new RegExp(
    String.raw`^(?:передай(?:те)?|передавай(?:те)?|напиши(?:те)?|отправь(?:те)?)\s+(?:это\s+|всё\s+|все\s+|ему\s+|ей\s+|меня\s+)?${HUMAN_PHRASE}`,
    "iu",
  ),
];

const BARE_AFFIRMATIVE =
  /^(?:да|давай|давайте|ага|угу|ок|окей)(?:[,!.\s]+давай(?:те)?)?[.]*$/iu;

const CONJUNCTION_LEAD =
  /^(?:а|и|но|потом|затем|да|или|либо)(?=$|[\s,.;:!?—-])/iu;
const BOUNDARY_LEAD = /^[.,;:!?—-]+/u;

const TELEGRAM_PREFERENCE = /(?:телеграм|telegram|телеге|в\s+тг)/iu;
const PHONE_PREFERENCE = /(?:по\s+телефону|телефон|позвони|звонок|набери)/iu;
const CHAT_PREFERENCE = /(?:в\s+чат|чате|переписк|написать\s+в\s+чат)/iu;

export type HandoffRequestAnalysis = {
  /** Text after the handoff clause, or null when it consumed the turn. */
  remainder: string | null;
};

/**
 * Splits the text a handoff rule did not consume.
 *
 * A clause boundary or a conjunction means what follows is a separate request
 * and is preserved. Any other residue is reported as a remainder too, so user
 * text is never silently discarded — never dropped, and never folded into the
 * handoff as if it had been said about the person.
 */
function splitResidue(
  residue: string,
): { remainder: string | null } {
  let value = residue.trim();

  if (value.length === 0) return { remainder: null };

  const conjunction = value.match(CONJUNCTION_LEAD);
  if (conjunction) {
    value = value.slice(conjunction[0].length).replace(BOUNDARY_LEAD, "").trim();
  } else if (BOUNDARY_LEAD.test(value)) {
    value = value.replace(BOUNDARY_LEAD, "").trim();
  }

  return { remainder: value.length > 0 ? value : null };
}

/**
 * Recognises a direct human request at a clause head.
 *
 * Both the request verb and the person are part of one anchored rule, so a
 * business clause that merely mentions a person — "мне нужен курс про работу с
 * человеком", "расскажи про Алексея" — keeps its ordinary lane.
 */
export function detectHandoffRequest(
  text: string,
): HandoffRequestAnalysis | null {
  const clauses = splitIntoClauses(text);

  for (const [index, clause] of clauses.entries()) {
    const rule = HANDOFF_RULES.find((candidate) => candidate.test(clause));
    if (rule === undefined) continue;

    const trailing = splitResidue(clause.replace(rule, "").trim());
    const rest = clauses
      .filter((_, clauseIndex) => clauseIndex !== index)
      .join(". ")
      .trim();

    const remainder = [trailing.remainder, rest]
      .filter((part): part is string => part !== null)
      .join(". ")
      .trim();

    return { remainder: remainder.length > 0 ? remainder : null };
  }

  return null;
}

/** Accepting an outstanding offer is a bare affirmative and nothing else. */
export function detectHandoffAcceptance(text: string): boolean {
  const clauses = splitIntoClauses(text);

  return clauses.length === 1 && BARE_AFFIRMATIVE.test(clauses[0] ?? "");
}

export function detectContactPreference(
  text: string,
): HandoffContactPreference {
  if (TELEGRAM_PREFERENCE.test(text)) return "TELEGRAM";
  if (PHONE_PREFERENCE.test(text)) return "PHONE";
  if (CHAT_PREFERENCE.test(text)) return "CHAT";

  return "NONE";
}

export type HandoffContextInput = {
  goal: HandoffGoal | null;
  courseId: string | null;
  courseMatch: CourseMatchState;
  flowId: ConversationFlowId | null;
  reason: HandoffReason;
  clarificationPending: boolean;
  pendingConfirmation: boolean;
  deferredRequest: boolean;
  technicalFailure: boolean;
  repairInProgress: boolean;
  contactPreference: HandoffContactPreference;
};

function unresolvedChoiceFor(
  input: HandoffContextInput,
): HandoffUnresolvedChoice {
  if (input.pendingConfirmation) return "AWAITING_CONFIRMATION";
  if (input.clarificationPending) return "CLARIFYING";
  if (input.courseMatch === "NO_CURRENT_COURSE_MATCH") return "NOT_MATCHED";
  if (input.courseMatch === "AMBIGUOUS") return "AMBIGUOUS";

  return "NONE";
}

function establishedFacts(
  input: HandoffContextInput,
  unresolvedChoice: HandoffUnresolvedChoice,
): HandoffFact[] {
  const facts: HandoffFact[] = [];

  if (input.courseId !== null) facts.push("SELECTED_COURSE");
  if (input.courseMatch === "NO_CURRENT_COURSE_MATCH") {
    facts.push("NO_CURRENT_COURSE_MATCH");
  }
  if (input.courseMatch === "AMBIGUOUS") facts.push("AMBIGUOUS_COURSE_CHOICE");
  if (unresolvedChoice === "CLARIFYING") facts.push("AWAITING_CLARIFICATION");
  if (unresolvedChoice === "AWAITING_CONFIRMATION") {
    facts.push("PENDING_CONFIRMATION");
  }
  if (input.deferredRequest) facts.push("PRESERVED_REQUEST");
  if (input.technicalFailure) facts.push("RECENT_TECHNICAL_FAILURE");
  if (input.repairInProgress) facts.push("REPAIR_IN_PROGRESS");
  if (
    input.goal === "COURSE_SELECTION" &&
    (unresolvedChoice === "NOT_MATCHED" || unresolvedChoice === "AMBIGUOUS")
  ) {
    facts.push("UNRESOLVED_COURSE_CHOICE");
  }

  return facts.slice(0, MAX_HANDOFF_ESTABLISHED_FACTS);
}

export function buildHandoffContext(
  input: HandoffContextInput,
): HandoffContext {
  const unresolvedChoice = unresolvedChoiceFor(input);

  return {
    goal: input.goal,
    courseId: input.courseId,
    unresolvedChoice,
    flowId: input.flowId,
    blockingProblem: input.reason,
    facts: establishedFacts(input, unresolvedChoice),
    contactPreference: input.contactPreference,
  };
}

const GOAL_PHRASES: Record<HandoffGoal, string> = {
  COURSE_SELECTION: "подбор подходящего курса Академии",
  COURSE_FOLLOW_UP: "разбор уже обсуждаемого курса Академии",
  ACADEMY_CONTACT: "связь с Академией",
  HUMAN_CONTACT: "разговор с человеком по вопросам Академии",
  COURSE_CONFIRMATION: "подтверждение ранее обсуждавшегося курса",
  UNRESOLVED_CLARIFICATION: "уточнение учебного запроса",
};

const UNRESOLVED_PHRASES: Record<HandoffUnresolvedChoice, string | null> = {
  NONE: null,
  NOT_MATCHED: "подходящий курс пока не найден",
  AMBIGUOUS: "запрос относится сразу к нескольким курсам",
  CLARIFYING: "запрос всё ещё уточняется",
  AWAITING_CONFIRMATION: "ожидает подтверждения курса",
};

const REASON_PHRASES: Record<HandoffReason, string> = {
  DIRECT_REQUEST: "просьба соединить с человеком",
  REPEATED_REPAIR_FAILURE: "повторные объяснения не помогли",
  FRUSTRATION: "предыдущие ответы не помогли",
  CLARIFICATION_EXHAUSTED: "уточняющие вопросы не помогли",
  REPAIR_CONTEXT_UNAVAILABLE: "не удалось объяснить предыдущий ответ",
  INSUFFICIENT_AUTHORITY: "для этого вопроса не хватает подтверждённых данных",
};

const FACT_PHRASES: Record<HandoffFact, string> = {
  SELECTED_COURSE: "курс выбран",
  NO_CURRENT_COURSE_MATCH: "подходящий курс не найден",
  AMBIGUOUS_COURSE_CHOICE: "под запрос подходит несколько курсов",
  UNRESOLVED_COURSE_CHOICE: "выбор курса не закрыт",
  PRESERVED_REQUEST: "есть сохранённый запрос",
  PENDING_CONFIRMATION: "ждёт подтверждения курса",
  AWAITING_CLARIFICATION: "запрос уточняется",
  RECENT_TECHNICAL_FAILURE: "был технический сбой",
  REPAIR_IN_PROGRESS: "разбираем непонятный ответ",
};

const CONTACT_PREFERENCE_PHRASES: Record<
  Exclude<HandoffContactPreference, "NONE">,
  string
> = {
  TELEGRAM: "Telegram",
  PHONE: "телефонный звонок",
  CHAT: "переписка в чате",
};

/** Full sentences used when human help is offered. All are mode-neutral. */
export const HANDOFF_OFFER_CLAUSES: Record<HandoffReason, string> = {
  DIRECT_REQUEST: "Передам разговор человеку.",
  REPEATED_REPAIR_FAILURE: "Похоже, мои объяснения не помогли.",
  FRUSTRATION: "Похоже, мои ответы не помогли.",
  CLARIFICATION_EXHAUSTED: "Похоже, уточняющие вопросы не помогли.",
  REPAIR_CONTEXT_UNAVAILABLE:
    "Похоже, объяснить предыдущий ответ своими словами не получается.",
  INSUFFICIENT_AUTHORITY:
    "Похоже, для этого вопроса у меня недостаточно подтверждённых данных.",
};

export function handoffOfferClause(reason: HandoffReason): string {
  return HANDOFF_OFFER_CLAUSES[reason];
}

/** Bounded, privacy-minimised summary lines (A24). */
export function handoffSummaryLines(context: HandoffContext): string[] {
  const lines: string[] = [];

  if (context.goal !== null) {
    lines.push(`Задача: ${GOAL_PHRASES[context.goal]}.`);
  }

  const course =
    context.courseId !== null ? getAcademyCourse(context.courseId) : undefined;

  if (course) {
    lines.push(`Выбранный курс: «${course.title}».`);
  }

  const unresolved = UNRESOLVED_PHRASES[context.unresolvedChoice];
  if (unresolved !== null) {
    lines.push(`Что не закрыто: ${unresolved}.`);
  }

  lines.push(`Причина обращения: ${REASON_PHRASES[context.blockingProblem]}.`);

  const facts = context.facts
    .filter((fact) => fact !== "SELECTED_COURSE")
    .map((fact) => FACT_PHRASES[fact]);

  if (facts.length > 0) {
    lines.push(`Что уже установлено: ${facts.join("; ")}.`);
  }

  if (context.contactPreference !== "NONE") {
    lines.push(
      `Предпочтительный способ связи: ${CONTACT_PREFERENCE_PHRASES[context.contactPreference]}.`,
    );
  }

  return lines;
}

/**
 * Renders the summary under one hard total bound. Lines are added whole and the
 * loop stops when the next one would not fit, so the text is never truncated
 * mid-sentence and can never grow into a transcript.
 */
export function composeHandoffContextText(context: HandoffContext): string {
  const lines: string[] = [];
  let used = 0;

  for (const line of handoffSummaryLines(context)) {
    if (used + line.length + 1 > MAX_HANDOFF_CONTEXT_LENGTH) break;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}

export function offerHandoff(reason: HandoffReason): HandoffState {
  return { status: "OFFERED", reason, context: null };
}

function goalFor(
  state: ConversationState,
  reason: HandoffReason,
): HandoffGoal | null {
  const flowId = state.activeFlow?.id ?? state.suspendedFlow?.id ?? null;

  if (flowId === "COURSE_SELECTION") return "COURSE_SELECTION";
  if (flowId === "COURSE_FOLLOW_UP") return "COURSE_FOLLOW_UP";
  if (flowId === "ACADEMY_CONTACT") return "ACADEMY_CONTACT";
  if (state.activeFlow === null && state.suspendedFlow === null) {
    if (state.pendingConfirmation !== null) return "COURSE_CONFIRMATION";
    if (state.clarification !== null) return "UNRESOLVED_CLARIFICATION";
    if (state.selectedCourseId !== null) return "COURSE_SELECTION";
  }
  if (reason === "DIRECT_REQUEST") return "HUMAN_CONTACT";

  return null;
}

export type HandoffPreparation = {
  reason: HandoffReason;
  goal?: HandoffGoal | null;
  flowId?: ConversationFlowId | null;
  contactPreference?: HandoffContactPreference;
};

/**
 * Prepares a READY handoff: the structured context and the bounded summary are
 * built now, so the user never has to retell the conversation later.
 */
export function prepareHandoff(
  state: ConversationState,
  preparation: HandoffPreparation,
): HandoffState {
  const flowId =
    preparation.flowId === undefined
      ? (state.activeFlow?.id ?? state.suspendedFlow?.id ?? null)
      : preparation.flowId;

  const context = buildHandoffContext({
    goal:
      preparation.goal === undefined
        ? goalFor(state, preparation.reason)
        : preparation.goal,
    courseId: state.selectedCourseId,
    courseMatch: state.courseMatch,
    flowId,
    reason: preparation.reason,
    clarificationPending: state.clarification !== null,
    pendingConfirmation: state.pendingConfirmation !== null,
    deferredRequest: state.deferredRequest !== null,
    technicalFailure: state.lastTechnicalError !== null,
    repairInProgress: state.repair !== null,
    contactPreference: preparation.contactPreference ?? "NONE",
  });

  return { status: "READY", reason: preparation.reason, context };
}
