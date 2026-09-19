import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  type AddressMode,
  type ConversationProfile,
} from "../chat-contract.ts";

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
const EXPLICIT_NAME_PATTERN =
  /(?:меня\s+зовут|зови(?:те)?(?:\s+меня)?|называй(?:те)?(?:\s+меня)?|можно\s+(?:звать|называть)\s+меня)\s+([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’-]{0,39}(?:\s+[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’-]{0,39}){0,2})/iu;
const SIMPLE_NAME_TOKEN =
  /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’-]{0,39}$/u;

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

function looksLikeSimpleName(value: string): boolean {
  const tokens = value.split(/\s+/u).filter(Boolean);
  return (
    tokens.length >= 1 &&
    tokens.length <= 2 &&
    tokens.every((token) => SIMPLE_NAME_TOKEN.test(token)) &&
    value.length <= MAX_DISPLAY_NAME_LENGTH
  );
}

function extractName(
  textWithoutMode: string,
): {
  displayName: string | null;
  consumedText: string | null;
} {
  const explicit = textWithoutMode.match(EXPLICIT_NAME_PATTERN);
  if (explicit?.[1]) {
    return {
      displayName: normalizeDisplayName(explicit[1]),
      consumedText: explicit[0],
    };
  }

  const firstSegment =
    textWithoutMode.split(/[,.!?;:\n]/u)[0]?.trim() ?? "";

  if (looksLikeSimpleName(firstSegment)) {
    return {
      displayName: normalizeDisplayName(firstSegment),
      consumedText: firstSegment,
    };
  }

  return {
    displayName: null,
    consumedText: null,
  };
}

function cleanRemainder(value: string): string | null {
  const cleaned = value
    .replace(NAME_DECLINE_PATTERN, " ")
    .replace(
      /(?:^|[\s,;:.!?])(?:да|ок|окей|конечно|пожалуйста|можно|хорошо)(?=$|[\s,;:.!?])/giu,
      " ",
    )
    .replace(/^[\s,.;:!?—–-]+|[\s,.;:!?—–-]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
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

  if (!displayName && !nameDeclined) {
    const extracted = extractName(working);
    if (extracted.displayName) {
      displayName = extracted.displayName;
      if (extracted.consumedText) {
        working = working.replace(extracted.consumedText, " ");
      }
    }
  }

  const remainder = cleanRemainder(working);
  const pending = mergePending(
    incoming.pendingUserRequest,
    remainder,
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
