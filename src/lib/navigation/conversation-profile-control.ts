import type {
  AddressMode,
  ConversationProfile,
} from "../chat-contract.ts";
import {
  createEmptyConversationProfile,
  INITIAL_ADDRESS_PROMPT,
  isConversationProfileComplete,
  messageSelectsAddressMode,
  normalizeDisplayNameCandidate,
} from "./conversation-profile.ts";

export type ConversationProfileControlResult =
  | { handled: false }
  | {
      handled: true;
      profile: ConversationProfile;
      message: string;
      resetConversation: boolean;
    };

const RESET_PATTERN =
  /(?:давай\s+(?:всё\s+)?сначала|начн(?:е|ё)м\s+(?:всё\s+)?сначала|начать\s+(?:всё\s+)?сначала|сброс(?:ь|ить)\s+(?:этот\s+)?(?:диалог|разговор)|перезапуст(?:и|ить)\s+(?:этот\s+)?(?:диалог|разговор))/iu;

const NO_NAME_PATTERN =
  /^(?:пожалуйста[,\s]+)?(?:не\s+называй(?:те)?\s+меня\s+по\s+имени|давай(?:те)?\s+без\s+имени|обращай(?:ся|тесь)\s+без\s+имени|можно\s+без\s+имени)[.!?]*$/iu;

const MODE_UPDATE_PATTERN =
  /^(?:пожалуйста[,\s]+)?(?:(?:давай(?:те)?|лучше|можно|перейд(?:и|ём|ем|ите)|обращай(?:ся|тесь)|говори(?:те)?)(?:\s+(?:со\s+мной|ко\s+мне))?\s+на\s+|на\s+)(ты|вы)[.!?]*$/iu;

const NAME_UPDATE_PATTERN =
  /^(?:пожалуйста[,\s]+)?(?:меня\s+зовут|зови(?:те)?\s+меня|называй(?:те)?\s+меня|можешь\s+звать\s+меня|можете\s+звать\s+меня)\s+(.+?)[.!?]*$/iu;

/**
 * NAVIGATOR-CONVERSATION-ENTRY-SIMPLIFICATION-1.CORR1 (C-2) — a declared name
 * is words only: letters, optionally joined inside a word by a hyphen or an
 * apostrophe. A name of several words has each word capitalized, so an
 * unpunctuated attached question ("Анна есть ли курсы онлайн") is not a name.
 */
const STANDALONE_NAME_PATTERN =
  /^(?:\p{L}+(?:['’-]\p{L}+)*|\p{Lu}\p{L}*(?:['’-]\p{L}+)*(?:\s+\p{Lu}\p{L}*(?:['’-]\p{L}+)*)+)$/u;

/**
 * Every turn, the first one included, reaches the rename control, so only a
 * simple, standalone declaration is a rename: no question mark anywhere, a
 * name of words only, and no address-mode choice. A message with an attached
 * question, a comma continuation, another sentence or another command is
 * ordinary text for routing, as a whole; it is never split.
 */
function isStandaloneNameDeclaration(text: string, name: string): boolean {
  return (
    !text.includes("?") &&
    STANDALONE_NAME_PATTERN.test(name.trim()) &&
    messageSelectsAddressMode(name) === null
  );
}

function modeText(mode: AddressMode): string {
  return mode === "TY" ? "на «ты»" : "на «вы»";
}

function resetRequested(text: string): boolean {
  if (!RESET_PATTERN.test(text)) {
    return false;
  }

  const remainder = text
    .replace(RESET_PATTERN, " ")
    .replace(
      /(?:ну|ладно|ок|окей|хорошо|да|пожалуйста|всё|все)[,.\s!?]*/giu,
      " ",
    )
    .replace(/[\s,.;:!?—–-]+/gu, " ")
    .trim();

  return remainder.length === 0;
}

/**
 * Full-dialogue restart (A17/R21). Exported so the conversation-control kernel
 * can evaluate it in the session-control group, ahead of the other controls.
 */
export function isConversationResetRequest(text: string): boolean {
  return resetRequested(text);
}

export function applyConversationProfileControl(
  profile: ConversationProfile,
  userText: string,
): ConversationProfileControlResult {
  const text = userText.trim();

  if (resetRequested(text)) {
    return {
      handled: true,
      profile: createEmptyConversationProfile(),
      message: INITIAL_ADDRESS_PROMPT,
      resetConversation: true,
    };
  }

  if (!isConversationProfileComplete(profile)) {
    return { handled: false };
  }

  if (NO_NAME_PATTERN.test(text)) {
    return {
      handled: true,
      profile: {
        ...profile,
        displayName: null,
        nameDeclined: true,
        pendingUserRequest: null,
      },
      message: `Хорошо. Буду обращаться ${modeText(profile.addressMode!)} без имени.`,
      resetConversation: false,
    };
  }

  const modeMatch = text.match(MODE_UPDATE_PATTERN);
  if (modeMatch?.[1]) {
    const addressMode: AddressMode =
      modeMatch[1].toLowerCase() === "ты" ? "TY" : "VY";
    const name = profile.displayName
      ? `, ${profile.displayName}`
      : "";

    return {
      handled: true,
      profile: {
        ...profile,
        addressMode,
        pendingUserRequest: null,
      },
      message: `Хорошо${name}. Буду обращаться ${modeText(addressMode)}.`,
      resetConversation: false,
    };
  }

  const nameMatch = text.match(NAME_UPDATE_PATTERN);
  if (nameMatch?.[1] && isStandaloneNameDeclaration(text, nameMatch[1])) {
    const displayName = normalizeDisplayNameCandidate(
      nameMatch[1],
    );

    if (displayName) {
      return {
        handled: true,
        profile: {
          ...profile,
          displayName,
          nameDeclined: false,
          pendingUserRequest: null,
        },
        message: `Хорошо, ${displayName}. Буду обращаться ${modeText(profile.addressMode!)}.`,
        resetConversation: false,
      };
    }
  }

  return { handled: false };
}
