/**
 * Package-B A05 conversational repair.
 *
 * A repair signal is a control signal about the *previous assistant answer*,
 * not a fresh business intent: "ответь нормально" asks for a better-shaped
 * version of what was already said, "что ты имел в виду?" asks what that answer
 * meant, and "ты сам сказал, что..." challenges it against the record.
 *
 * Recognition is clause-head anchored and bounded, exactly like the Package-A
 * control phrases: a substantive sentence that merely contains one of these
 * words stays ordinary text and keeps its business route. Nothing here reads
 * assistant prose to reconstruct state — the repair itself is rendered from
 * `conversationState.lastAssistant` and the structured state around it.
 */

import {
  MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH,
  REPAIR_FAILURE_THRESHOLD,
  withRepair,
  type ConversationState,
} from "./conversation-state.ts";
import { splitIntoClauses } from "./conversation-control-phrases.ts";

export type RepairSignalKind =
  | "REPAIR_RESTATE"
  | "REPAIR_CLARIFY"
  | "REPAIR_CHALLENGE"
  | "FRUSTRATION";

export type RepairSignal = {
  kind: RepairSignalKind;
  /** Clear explicit frustration, including "the previous answer did not help". */
  frustration: boolean;
  /** Text the signal phrase did not consume, or null when it consumed it all. */
  remainder: string | null;
};

/**
 * Neutral particles that may trail a whole-clause signal without making the
 * clause something else ("не помогло, к сожалению" style tails are deliberately
 * not accepted: the pattern stays bounded and predictable).
 */
const CLAUSE_TAIL =
  String.raw`(?:\s+(?:мне|нам|вообще|совсем|уже|и|а|же|ну|пожалуйста|пожалуй|таки|это|всё|все))*[.!?…]*$`;

function wholeClause(source: string): RegExp {
  return new RegExp(`${source}${CLAUSE_TAIL}`, "iu");
}

type RepairRule = {
  kind: RepairSignalKind;
  pattern: RegExp;
};

/**
 * Bounded signal classes (CORR2 §11 and §26). Frustration classes must match
 * the whole clause, so "не помогает мне выбрать курс" stays substantive.
 */
const REPAIR_RULES: readonly RepairRule[] = [
  // Clear frustration and explicit negative feedback.
  {
    kind: "FRUSTRATION",
    pattern: wholeClause(String.raw`^(?:это\s+)?не\s+помог[а-яё]*`),
  },
  {
    kind: "FRUSTRATION",
    pattern: wholeClause(
      String.raw`^(?:это\s+)?(?:бесполезно|толку\s+нет|без\s+толку)`,
    ),
  },
  {
    kind: "FRUSTRATION",
    pattern: wholeClause(
      String.raw`^(?:ты|вы)\s+(?:опять|снова)\s+не\s+(?:понял[а-яё]*|услышал[а-яё]*|ответил[а-яё]*)`,
    ),
  },
  {
    kind: "FRUSTRATION",
    pattern: wholeClause(
      String.raw`^(?:ты|вы)\s+(?:вообще\s+)?меня\s+не\s+(?:понимаешь|понимаете|слышишь|слышите)`,
    ),
  },
  {
    kind: "FRUSTRATION",
    pattern: wholeClause(
      String.raw`^(?:я\s+)?уже\s+(?:второй|третий|четвёртый|пятый|\d+)[- ]?(?:й|ый|ий)?\s*раз(?:\s+(?:прошу|спрашиваю|повторяю))?`,
    ),
  },
  {
    kind: "FRUSTRATION",
    pattern: wholeClause(
      String.raw`^это\s+(?:уже\s+)?(?:второй|третий|четвёртый|пятый|\d+)[- ]?(?:й|ый|ий)?\s*раз`,
    ),
  },
  {
    kind: "FRUSTRATION",
    pattern: wholeClause(
      String.raw`^(?:ты|вы)\s+не\s+(?:помог[а-яё]*|ответил[а-яё]*)`,
    ),
  },

  // Repair: re-explain the prior answer ("ответь нормально").
  {
    kind: "REPAIR_RESTATE",
    pattern:
      /^(?:а\s+|и\s+|ну\s+)?(?:давай(?:те)?\s+|можешь\s+|можете\s+|можно\s+)?(?:ответь|отвечай|ответьте|отвечайте|отвечать)(?:\s+(?:мне|же|уж|пожалуйста|пожалуй|ка|таки|всё-таки)){0,2}\s+(?:нормально|по-?человечески|по-?русски|по\s+делу|конкретно|понятно|человеческ[а-яё]+)(?![а-яё])/iu,
  },
  {
    kind: "REPAIR_RESTATE",
    pattern:
      /^(?:а\s+|и\s+|ну\s+)?(?:нормально|по-?человечески|по-?русски|конкретно|понятно)\s+(?:ответь|отвечай|ответьте|отвечайте|отвечать)(?![а-яё])/iu,
  },

  // Repair: clarify the prior assistant statement ("что ты имел в виду?").
  {
    kind: "REPAIR_CLARIFY",
    pattern:
      /^что\s+(?:ты|вы)\s+(?:имел[а-яё]*|имеешь|имеете)\s+в\s+виду(?![а-яё])/iu,
  },
  {
    kind: "REPAIR_CLARIFY",
    pattern:
      /^что\s+(?:ты|вы)\s+(?:хотел[а-яё]*|хочешь|хотите)\s+сказать(?![а-яё])/iu,
  },
  {
    kind: "REPAIR_CLARIFY",
    pattern: /^что\s+это\s+(?:значит|означает|было)(?![а-яё])/iu,
  },

  // Repair: challenge the prior answer against the recorded exchange.
  {
    kind: "REPAIR_CHALLENGE",
    pattern:
      /^(?:но\s+|а\s+|и\s+)?(?:ты|вы)\s+(?:сам[а-яё]*|же|ведь)\s+(?:сказал[а-яё]*|говорил[а-яё]*)(?![а-яё])/iu,
  },
  {
    kind: "REPAIR_CHALLENGE",
    pattern:
      /^(?:но\s+|а\s+|и\s+)?(?:ты|вы)\s+только\s+что\s+(?:сказал[а-яё]*|говорил[а-яё]*)(?![а-яё])/iu,
  },
  {
    kind: "REPAIR_CHALLENGE",
    pattern:
      /^(?:это|оно)\s+противоречит\s+(?:твоему|вашему|твоим|вашим|твоей|вашей)(?:\s+[а-яё-]+){0,3}(?![а-яё])/iu,
  },
  {
    kind: "REPAIR_CHALLENGE",
    pattern:
      /^(?:но\s+|а\s+)?почему\s+(?:ты|вы)\s+(?:теперь\s+)?говор(?:ишь|ите)\s+(?:иначе|по-?другому)(?![а-яё])/iu,
  },
];

const CONJUNCTION_LEAD =
  /^(?:а|и|но|потом|затем|да|или|либо)(?=$|[\s,.;:!?—-])/iu;
const BOUNDARY_LEAD = /^[.,;:!?—-]+/u;

/** Residue that carries no request of its own. */
const FILLER_ONLY_REMAINDER =
  /^(?:(?:а|и|но|же|ну|да|вот|это|пожалуйста|пожалуй|мне|меня|ещё|еще|уж|всё|все|тогда|значит|таки|понятно|понял|поняла|ладно|ясно|хорошо|ок|окей|спасибо|благодарю)[\s,.;:!?—-]*)*$/iu;

function splitTrailingText(
  text: string,
): { accepted: boolean; remainder: string | null } {
  let value = text.trim();

  if (value.length === 0) return { accepted: true, remainder: null };
  if (FILLER_ONLY_REMAINDER.test(value)) {
    return { accepted: true, remainder: null };
  }

  const conjunction = value.match(CONJUNCTION_LEAD);
  if (conjunction) {
    value = value
      .slice(conjunction[0].length)
      .replace(BOUNDARY_LEAD, "")
      .trim();
  } else if (BOUNDARY_LEAD.test(value)) {
    value = value.replace(BOUNDARY_LEAD, "").trim();
  } else {
    // The signal words are inside a larger substantive clause, so the clause is
    // ordinary text: a control phrase may not swallow a business request.
    return { accepted: false, remainder: null };
  }

  if (value.length === 0 || FILLER_ONLY_REMAINDER.test(value)) {
    return { accepted: true, remainder: null };
  }

  return { accepted: true, remainder: value };
}

function matchRule(clause: string): RepairRule | null {
  for (const rule of REPAIR_RULES) {
    if (rule.pattern.test(clause)) return rule;
  }

  return null;
}

export function detectRepairSignal(text: string): RepairSignal | null {
  const clauses = splitIntoClauses(text);
  const remainders: string[] = [];
  let matched: RepairRule | null = null;

  for (const clause of clauses) {
    if (matched !== null) {
      remainders.push(clause);
      continue;
    }

    const rule = matchRule(clause);
    if (rule === null) {
      remainders.push(clause);
      continue;
    }

    const trailing = splitTrailingText(
      clause.replace(rule.pattern, "").trim(),
    );

    if (!trailing.accepted) {
      remainders.push(clause);
      continue;
    }

    matched = rule;
    if (trailing.remainder !== null) remainders.push(trailing.remainder);
  }

  if (matched === null) return null;

  const remainder = remainders.join(". ").trim();

  return {
    kind: matched.kind,
    frustration: matched.kind === "FRUSTRATION",
    remainder: remainder.length > 0 ? remainder : null,
  };
}

function subjectHash(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function boundedIssueKey(raw: string): string {
  return raw.length <= MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH
    ? raw
    : `${raw.slice(0, MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH - 9)}:${subjectHash(raw)}`;
}

export type RepairIssueInput = {
  pendingConfirmationKey: string | null;
  clarificationIssueKey: string | null;
  courseId: string | null;
};

/**
 * Issue identity for the repair counter (A05/A23).
 *
 * The subject of a repair, not its wording, defines the issue: a repair about
 * the same course stays one issue across attempts, while a repair about a
 * different subject starts a new one and therefore resets the counter.
 */
export function repairIssueKey(input: RepairIssueInput): string {
  if (input.pendingConfirmationKey !== null) {
    return boundedIssueKey(`repair:confirmation:${input.pendingConfirmationKey}`);
  }

  if (input.clarificationIssueKey !== null) {
    return boundedIssueKey(`repair:clarification:${input.clarificationIssueKey}`);
  }

  if (input.courseId !== null) {
    return boundedIssueKey(`repair:course:${input.courseId}`);
  }

  return "repair:general";
}

export type RepairAdvanceInput = {
  state: ConversationState;
  signal: RepairSignal;
};

export type RepairAdvance = {
  state: ConversationState;
  issueKey: string;
  attempts: number;
  /** True when this turn is the second failure for the same issue. */
  thresholdReached: boolean;
};

/**
 * Advances the repair counter for the current issue, bounded by the single
 * central threshold. A successful repair does not clear the episode here: the
 * episode ends when a turn completes outside the repair lane, which is what
 * makes "the user stopped complaining" a deterministic signal.
 */
export function advanceRepairState(input: RepairAdvanceInput): RepairAdvance {
  const { state } = input;

  const issueKey = repairIssueKey({
    pendingConfirmationKey: state.pendingConfirmation?.confirmationKey ?? null,
    clarificationIssueKey: state.clarification?.issueKey ?? null,
    courseId: state.selectedCourseId ?? state.lastAssistant?.courseId ?? null,
  });

  const priorAttempts =
    state.repair?.issueKey === issueKey ? state.repair.attempts : 0;
  const attempts = Math.min(priorAttempts + 1, REPAIR_FAILURE_THRESHOLD);

  return {
    state: withRepair(state, { issueKey, attempts }),
    issueKey,
    attempts,
    thresholdReached: attempts >= REPAIR_FAILURE_THRESHOLD,
  };
}
