import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  type AddressMode,
  type ConversationProfile,
} from "../chat-contract.ts";
import {
  hasControlLanguage,
  isGreetingClause,
  splitIntoClauses,
  stripGreetingClauses,
} from "./conversation-control-phrases.ts";

export const INITIAL_ADDRESS_PROMPT =
  "Здравствуйте. Прежде чем начнём, скажите, пожалуйста, как к вам обращаться? Напишите имя и выберите: на «ты» или на «вы».";

export class ConversationProfileValidationError extends Error {
  readonly code = "INVALID_CONVERSATION_PROFILE";

  constructor(message: string) {
    super(message);
    this.name = "ConversationProfileValidationError";
  }
}

export type AddressSetupAdvance = {
  profile: ConversationProfile;
  complete: boolean;
  effectiveUserRequest: string | null;
  response: string | null;
};

const MODE_CHOICE_PATTERN =
  /(?:^|[\s,;:.!?()])на\s+[«"'“”]?(ты|вы)[»"'“”]?(?=$|[\s,;:.!?()])/giu;

const NAME_DECLINE_PATTERN =
  /(?:можно\s+без\s+имени|без\s+имени|имя\s+(?:не\s+)?(?:важно|нужно)|не\s+хочу\s+(?:называть|говорить)\s+(?:сво[её]\s+)?имя)/giu;

const EXPLICIT_NAME_PREFIX =
  /^(?:меня\s+зовут|зови(?:те)?(?:\s+меня)?|называй(?:те)?(?:\s+меня)?|можно\s+(?:звать|называть)\s+меня)\s+/iu;

const SUBSTANTIVE_TASK_START =
  /(?:я\s+хочу|хочу|мне\s+нуж(?:ен|на|но|ны)|нуж(?:ен|на|но|ны)\s+мне|помоги(?:те)?|подбери(?:те)?|посоветуй(?:те)?|интересует|я\s+пытаюсь|хочу\s+понять|хочу\s+разобраться|нужно\s+понять|нужно\s+разобраться|у\s+меня\s+(?:ситуац|проблем|вопрос)|как\s+(?:мне|лучше|можно)|почему\s+|что\s+(?:делать|выбрать|изучать)|какой\s+курс|какие\s+курсы|учиться|обучение|курс\s+про)/iu;

const MODE_ONLY_PATTERN =
  /^(?:на\s+)?(?:ты|вы)$/iu;

const FILLER_ONLY_PATTERN =
  /^(?:да|ок|окей|конечно|пожалуйста|можно|хорошо|спасибо)[.!?]*$/iu;

/**
 * A whole clause of the form "я <Имя>". Requires a capitalized single word that
 * is not a pronoun or identity word, so "я оно" cannot be read as a name
 * introduction (recovered production dialogue 12).
 */
const IDENTITY_NAME_CLAUSE =
  /^(?:[Яя])\s+([A-ZА-ЯЁ][a-zа-яё]+)$/u;

const NON_NAME_IDENTITY_WORDS = new Set([
  "оно", "они", "он", "она", "оный", "оная", "оные", "это", "этот", "эта",
  "эти", "то", "тот", "та", "те", "всё", "все", "не", "нет", "да", "тоже",
  "так", "тут", "здесь", "там", "сам", "сама", "само", "сами", "человек",
  "животное", "существо", "небинарное", "небинарный",
]);

export function createEmptyConversationProfile(): ConversationProfile {
  return {
    displayName: null,
    addressMode: null,
    nameDeclined: false,
    pendingUserRequest: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export function normalizeDisplayNameCandidate(
  value: string,
): string | null {
  const normalized = normalizeDisplayName(
    value
      .replace(/^[\s,.;:!?—–-]+|[\s,.;:!?—–-]+$/gu, "")
      .trim(),
  );

  if (
    normalized.length === 0 ||
    normalized.length > MAX_DISPLAY_NAME_LENGTH ||
    normalized.includes("\n") ||
    /https?:\/\/|www\.|@/iu.test(normalized) ||
    MODE_ONLY_PATTERN.test(normalized) ||
    FILLER_ONLY_PATTERN.test(normalized) ||
    SUBSTANTIVE_TASK_START.test(normalized) ||
    hasControlLanguage(normalized) ||
    isGreetingClause(normalized)
  ) {
    return null;
  }

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) {
    return null;
  }

  if (!/[A-Za-zА-Яа-яЁё]/u.test(normalized)) {
    return null;
  }

  return normalized;
}

export function normalizeConversationProfilePayload(
  value: unknown,
): ConversationProfile {
  if (value === undefined || value === null) {
    return createEmptyConversationProfile();
  }

  if (
    !isRecord(value) ||
    !onlyKeys(value, [
      "displayName",
      "addressMode",
      "nameDeclined",
      "pendingUserRequest",
    ])
  ) {
    throw new ConversationProfileValidationError(
      "Conversation profile has an invalid shape.",
    );
  }

  const displayNameRaw = value.displayName;
  const addressModeRaw = value.addressMode;
  const nameDeclinedRaw = value.nameDeclined;
  const pendingRaw = value.pendingUserRequest;

  if (displayNameRaw !== null && typeof displayNameRaw !== "string") {
    throw new ConversationProfileValidationError(
      "displayName must be string or null.",
    );
  }

  const displayName =
    typeof displayNameRaw === "string"
      ? normalizeDisplayName(displayNameRaw)
      : null;

  if (
    displayName !== null &&
    (displayName.length === 0 ||
      displayName.length > MAX_DISPLAY_NAME_LENGTH)
  ) {
    throw new ConversationProfileValidationError(
      "displayName length is invalid.",
    );
  }

  if (
    addressModeRaw !== null &&
    addressModeRaw !== "TY" &&
    addressModeRaw !== "VY"
  ) {
    throw new ConversationProfileValidationError(
      "addressMode must be TY, VY or null.",
    );
  }

  if (typeof nameDeclinedRaw !== "boolean") {
    throw new ConversationProfileValidationError(
      "nameDeclined must be boolean.",
    );
  }

  if (displayName !== null && nameDeclinedRaw) {
    throw new ConversationProfileValidationError(
      "displayName and nameDeclined cannot both be set.",
    );
  }

  if (pendingRaw !== null && typeof pendingRaw !== "string") {
    throw new ConversationProfileValidationError(
      "pendingUserRequest must be string or null.",
    );
  }

  const pendingUserRequest =
    typeof pendingRaw === "string" ? pendingRaw.trim() : null;

  if (
    pendingUserRequest !== null &&
    (pendingUserRequest.length === 0 ||
      pendingUserRequest.length > MAX_CHAT_MESSAGE_LENGTH)
  ) {
    throw new ConversationProfileValidationError(
      "pendingUserRequest length is invalid.",
    );
  }

  const profile: ConversationProfile = {
    displayName,
    addressMode: addressModeRaw as AddressMode | null,
    nameDeclined: nameDeclinedRaw,
    pendingUserRequest,
  };

  if (
    isConversationProfileComplete(profile) &&
    profile.pendingUserRequest !== null
  ) {
    throw new ConversationProfileValidationError(
      "A complete profile cannot retain a pending user request.",
    );
  }

  return profile;
}

export function isConversationProfileComplete(
  profile: ConversationProfile,
): boolean {
  return (
    (profile.displayName !== null || profile.nameDeclined) &&
    profile.addressMode !== null
  );
}

function detectAddressMode(text: string): AddressMode | null {
  const explicit = [...text.matchAll(MODE_CHOICE_PATTERN)].map(
    (match) => match[1]?.toLowerCase(),
  );

  const hasTy = explicit.includes("ты");
  const hasVy = explicit.includes("вы");

  if (hasTy === hasVy) {
    const simple = text.trim().toLowerCase().replace(/[«»"'“”]/gu, "");
    if (simple === "ты") return "TY";
    if (simple === "вы") return "VY";
    return null;
  }

  return hasTy ? "TY" : "VY";
}

function stripModeChoice(text: string): string {
  const trimmed = text.trim();
  const simple = trimmed.toLowerCase().replace(/[«»"'“”]/gu, "");

  if (simple === "ты" || simple === "вы") {
    return "";
  }

  return text.replace(MODE_CHOICE_PATTERN, " ");
}

function cleanText(value: string): string {
  return value
    .replace(/^[\s,.;:!?—–-]+|[\s,.;:!?—–-]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Trailing discourse fillers that a name prefix may pick up, e.g. "Иван, давай". */
const TRAILING_NAME_FILLERS =
  /(?:\s|^)(?:и|а|но|давай|давайте|пожалуйста|пожалуй|ну|можно|тогда|вот|это|же|уж)$/iu;

function splitTask(
  value: string,
): {
  beforeTask: string;
  task: string | null;
} {
  const match = value.match(SUBSTANTIVE_TASK_START);
  if (!match || match.index === undefined) {
    return {
      beforeTask: cleanText(value),
      task: null,
    };
  }

  let beforeTask = cleanText(value.slice(0, match.index));

  for (;;) {
    const stripped = beforeTask.replace(TRAILING_NAME_FILLERS, "").trim();
    if (stripped === beforeTask) break;
    beforeTask = stripped;
  }

  const task = cleanText(value.slice(match.index));

  return {
    beforeTask,
    task: task.length > 0 ? task : null,
  };
}

function identityNameClause(clause: string): string | null {
  const match = clause.match(IDENTITY_NAME_CLAUSE);
  const word = match?.[1];
  if (!word) return null;

  if (NON_NAME_IDENTITY_WORDS.has(word.toLowerCase())) {
    return null;
  }

  return normalizeDisplayNameCandidate(word);
}

/**
 * Clause-aware segmentation for ADDRESS_SETUP (A01).
 *
 * Greetings are dropped as whole clauses first, so a greeting can never be read
 * as the user's name, and a name prefix can never swallow the substantive
 * request that follows it in the same message.
 */
function parseNameAndTask(
  value: string,
): {
  displayName: string | null;
  task: string | null;
} {
  const withoutGreetings = stripGreetingClauses(value);

  if (!withoutGreetings) {
    return { displayName: null, task: null };
  }

  const explicitPrefix = withoutGreetings.match(EXPLICIT_NAME_PREFIX);
  if (explicitPrefix) {
    const rest = cleanText(withoutGreetings.slice(explicitPrefix[0].length));
    const split = splitTask(rest);
    return {
      displayName: normalizeDisplayNameCandidate(split.beforeTask),
      task: split.task,
    };
  }

  const clauses = splitIntoClauses(withoutGreetings);

  const identityIndex = clauses.findIndex(
    (clause) => identityNameClause(clause) !== null,
  );

  if (identityIndex !== -1) {
    const displayName = identityNameClause(clauses[identityIndex]);
    const rest = clauses
      .filter((_, index) => index !== identityIndex)
      .join(". ");
    const split = splitTask(rest);
    return { displayName, task: split.task };
  }

  if (clauses.length > 1) {
    const leadingCandidate = normalizeDisplayNameCandidate(clauses[0]);

    if (leadingCandidate) {
      const rest = clauses.slice(1).join(". ");
      const split = splitTask(rest);
      return { displayName: leadingCandidate, task: split.task };
    }
  }

  const split = splitTask(withoutGreetings);

  if (split.task && split.beforeTask) {
    return {
      displayName: normalizeDisplayNameCandidate(split.beforeTask),
      task: split.task,
    };
  }

  if (split.task) {
    return {
      displayName: null,
      task: split.task,
    };
  }

  return {
    displayName: normalizeDisplayNameCandidate(withoutGreetings),
    task: null,
  };
}

function mergePending(
  existing: string | null,
  current: string | null,
): string | null {
  if (!existing) return current;
  if (!current || current === existing) return existing;

  const combined = `${existing}\n${current}`.trim();
  return combined.length <= MAX_CHAT_MESSAGE_LENGTH
    ? combined
    : existing;
}

function setupPrompt(profile: ConversationProfile): string {
  const needsName =
    profile.displayName === null && !profile.nameDeclined;
  const needsMode = profile.addressMode === null;

  if (needsName && needsMode) {
    return INITIAL_ADDRESS_PROMPT;
  }

  if (needsName) {
    return "И как вас называть? Если не хотите указывать имя, так и напишите: «без имени».";
  }

  if (needsMode) {
    const prefix = profile.displayName
      ? `Спасибо, ${profile.displayName}. `
      : "";
    return `${prefix}И как вам удобнее — на «ты» или на «вы»?`;
  }

  throw new Error("setupPrompt called for a complete profile.");
}

function completionMessage(profile: ConversationProfile): string {
  const mode =
    profile.addressMode === "TY" ? "на «ты»" : "на «вы»";
  const name = profile.displayName
    ? `, ${profile.displayName}`
    : "";

  return `Спасибо${name}. Буду обращаться ${mode}. Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии.`;
}

export function advanceConversationProfile(
  incoming: ConversationProfile,
  userText: string,
): AddressSetupAdvance {
  if (isConversationProfileComplete(incoming)) {
    return {
      profile: { ...incoming, pendingUserRequest: null },
      complete: true,
      effectiveUserRequest: userText.trim(),
      response: null,
    };
  }

  let working = userText.trim();
  const mode = incoming.addressMode ?? detectAddressMode(working);

  if (mode !== null) {
    working = stripModeChoice(working);
  }

  const declineMatch =
    !incoming.displayName && NAME_DECLINE_PATTERN.test(working);
  NAME_DECLINE_PATTERN.lastIndex = 0;

  let displayName = incoming.displayName;
  let nameDeclined = incoming.nameDeclined;

  if (!displayName && !nameDeclined && declineMatch) {
    nameDeclined = true;
    working = working.replace(NAME_DECLINE_PATTERN, " ");
  }
  NAME_DECLINE_PATTERN.lastIndex = 0;

  const parsed = parseNameAndTask(working);

  if (!displayName && !nameDeclined && parsed.displayName) {
    displayName = parsed.displayName;
  }

  const pending = mergePending(
    incoming.pendingUserRequest,
    parsed.task,
  );

  const provisional: ConversationProfile = {
    displayName,
    addressMode: mode,
    nameDeclined,
    pendingUserRequest: pending,
  };

  if (!isConversationProfileComplete(provisional)) {
    return {
      profile: provisional,
      complete: false,
      effectiveUserRequest: null,
      response: setupPrompt(provisional),
    };
  }

  const completed: ConversationProfile = {
    ...provisional,
    pendingUserRequest: null,
  };

  if (pending) {
    return {
      profile: completed,
      complete: true,
      effectiveUserRequest: pending,
      response: null,
    };
  }

  return {
    profile: completed,
    complete: true,
    effectiveUserRequest: null,
    response: completionMessage(completed),
  };
}

export function addressStyleInstruction(
  profile: ConversationProfile | undefined,
): string {
  if (profile?.addressMode === "TY") {
    return "Пользователь выбрал обращение на «ты». Во всех пользовательских формулировках последовательно используй «ты» и соответствующие формы; не переключайся на «вы».";
  }

  return "Пользователь выбрал обращение на «вы» либо выбор ещё не задан. Во всех пользовательских формулировках последовательно используй уважительное «вы»; не переключайся на «ты».";
}
