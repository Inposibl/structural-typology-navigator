/**
 * Package-A conversation-control phrases.
 *
 * This module deliberately depends on nothing but the shared chat-contract
 * constants: it recognizes control language only, with no knowledge of
 * conversation state, the profile, or any factual/commercial authority. Both
 * ADDRESS_SETUP segmentation and the conversation-control kernel therefore
 * share exactly one definition of what counts as a control phrase.
 *
 * Recognition is clause-head anchored. A control phrase counts only when
 * everything before it in the clause is another control phrase or inert
 * filler, so a substantive sentence that merely contains a control word
 * ("как проще учиться?") is never converted into a control action.
 */

import { MAX_CHAT_MESSAGE_LENGTH } from "../chat-contract.ts";

export type ControlToken =
  | "CLOSE"
  | "CANCEL_FLOW"
  | "REPEAT"
  | "REPHRASE"
  | "SIMPLIFY"
  | "RESUME"
  | "SKIP"
  | "CONFIRM_YES"
  | "CONFIRM_NO"
  | "UNSUPPORTED_ADDRESS_MODE";

export type ControlScanOptions = {
  /** YES/NO is a control only while the kernel awaits a pending confirmation. */
  confirmationPending?: boolean;
  /** Address-mode variants are controls only while ADDRESS_SETUP is unresolved. */
  addressSetupOpen?: boolean;
};

export type ControlScan = {
  controls: ControlToken[];
  /** Text the controls did not consume, or null when the clause was pure control. */
  remainder: string | null;
  /** The rejected addressing word, when an unsupported variant was recognized. */
  unsupportedAddressModeWord: string | null;
};

const ADDRESS_MODE_WORDS = new Set(["ты", "вы"]);

/** Sentence-level clause boundaries. Commas and dashes are intra-clause. */
const CLAUSE_SEPARATOR = /[.;:!?…\n]+/u;

const TRIM_EDGES = /^[\s,.;:!?—–-]+|[\s,.;:!?—–-]+$/gu;

const GREETING_CLAUSE_PATTERN =
  /^(?:привет(?:ствую)?|здравствуй(?:те)?|добрый\s+(?:день|вечер)|доброе\s+утро|доброго\s+(?:дня|вечера|времени\s+суток)|хай|салют|hello|hi)$/iu;

/**
 * A greeting followed by more text inside the same clause, e.g.
 * "Здравствуйте, меня зовут Анна". Commas are intra-clause, so the greeting
 * cannot be removed by whole-clause matching alone.
 */
const GREETING_PREFIX =
  /^(?:привет(?:ствую)?|здравствуй(?:те)?|добрый\s+(?:день|вечер)|доброе\s+утро|доброго\s+(?:дня|вечера|времени\s+суток)|хай|салют|hello|hi)\s*[!,.\s—–-]*/iu;

const MODE_ONLY_CLAUSE_PATTERN = /^(?:на\s+)?(?:ты|вы)$/iu;

/**
 * Inert lead-ins that may precede a control phrase without making the clause
 * substantive. Kept deliberately small: every entry is a word that carries no
 * business meaning on its own.
 */
const FILLER_PREFIX_PATTERN =
  /^(?:а|и|но|же|ну|да|вот|это|потом|затем|давай|давайте|пожалуйста|пожалуй|мне|меня|ещё|еще|уж|всё|все|тогда|значит|именно|таки|понятно|понял|поняла|ладно|ясно|хорошо|ок|окей|спасибо|благодарю|спс|ага|угу)(?=$|[\s,.;:!?—-])/iyu;

/** Allowed residue after a CLOSE verb: prepositions, profanity, filler. */
const CLOSE_TAIL_TOKENS = new Set([
  "на", "в", "во", "к", "ко", "от", "ото", "с", "со", "за", "по", "из", "до", "об", "о",
  "все", "всё", "и", "а", "но", "же", "ну", "мне", "тебе", "вам", "тобой", "вами",
  "хуй", "хуя", "хую", "хуем", "хуё", "хуе", "хуйня", "хуйню", "хуйнёй", "хуёвый",
  "нахуй", "нахуя", "нахер", "нахрен", "пиздец", "пизда", "пизду", "пиздой",
  "бля", "блять", "блядь", "бляди", "ебать", "ебал", "ебаный", "ёбаный", "ебись",
  "жопа", "жопу", "говно", "говна", "дерьмо", "хер", "хрен", "залупа", "мудак",
  "иди", "пошёл", "пошел",
]);

type ControlRule = {
  token: ControlToken;
  pattern: RegExp;
  /** Captured word must be a supported mode, i.e. the match is not a control. */
  inspectAddressWord?: boolean;
};

const CONTROL_RULES: readonly ControlRule[] = [
  {
    token: "CLOSE",
    pattern:
      /^(?:не\s+хочу\s+(?:больше\s+)?(?:общаться|разговаривать|продолжать|болтать)|хватит\s+(?:общаться|разговаривать|болтать)|(?:закончим|завершим)\s+(?:на\s+этом|разговор|диалог|общение)|хочу\s+(?:закончить|завершить|прекратить)\s+(?:разговор|общение|диалог|это|на\s+этом)|спасибо\s+(?:за\s+)?(?:общение|разговор|беседу))(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "CLOSE",
    pattern: /^пока(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "CLOSE",
    pattern:
      /^(?:я\s+)?(?:пош[её]л|пошла|пошли|ухожу|уш[её]л|ушла|уехал|уехала)(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "CANCEL_FLOW",
    pattern:
      /^отмен(?:а|и|ите|ить|яем|яется|яю|яй)(?:\s+(?:это|подбор|подбора|выбор|выбора|курс|курса|его|всё|все|то|эту\s+тему))?(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "CANCEL_FLOW",
    pattern:
      /^верн[её]мся\s+к\s+(?:выбору|подбору|выбирать|курсам|началу|списку)(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "CANCEL_FLOW",
    pattern:
      /^покажи(?:те)?\s+(?:мне\s+)?(?:другие|другой|других|другое|что-то\s+другое)(?:\s+(?:курсы|курс|варианты|вариант))?(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "CANCEL_FLOW",
    pattern:
      /^не\s+хочу\s+(?:этот\s+курс|этот\s+подбор|это\s+подбор|про\s+это|больше\s+про\s+это|эту\s+тему)(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "CANCEL_FLOW",
    pattern:
      /^не\s+будем\s+(?:про\s+это|об\s+этом|это|больше)(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "CANCEL_FLOW",
    pattern:
      /^давай(?:те)?\s+друг(?:ой|ие|их|ого)\s+курс(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "REPHRASE",
    pattern:
      /^(?:перефразируй(?:те)?|переформулируй(?:те)?|другими\s+словами|скажи(?:те)?\s+(?:по-?другому|иначе))(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "SIMPLIFY",
    pattern:
      /^(?:объясни(?:те)?\s+проще|скажи(?:те)?\s+проще|скажи(?:те)?\s+короче|проще|попроще|покороче|короче|кратко|покороче|вкратце|сократи(?:те)?|сожми(?:те)?|коротко|кратенько)(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "REPEAT",
    pattern:
      /^(?:повтори(?:те)?|повторяй(?:те)?|продублируй(?:те)?|проговори(?:те)?\s+ещ[её]\s+раз|скажи(?:те)?\s+ещ[её]\s+раз|ещ[её]\s+раз)(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "RESUME",
    pattern:
      /^(?:верн[её]мся\s+к\s+(?:курсу|курса|теме|этой\s+теме|этому|нему|ней)|верн[её]мся|вернуться|продолжим|продолжаем|продолжай(?:те)?|давай(?:те)?\s+продолжим)(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "SKIP",
    pattern:
      /^(?:пропустим|пропусти(?:те)?|не\s+хочу\s+отвечать(?:\s+на\s+(?:этот|это|такой)?\s*вопрос)?|не\s+буду\s+отвечать(?:\s+на\s+(?:этот|это|такой)?\s*вопрос)?|не\s+могу\s+ответить|откажусь\s+отвечать|это\s+личное|не\s+знаю|без\s+комментариев)(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "CONFIRM_YES",
    pattern:
      /^(?:да|ага|угу|верно|подтверждаю|именно\s+так|совершенно\s+верно|всё\s+верно|все\s+верно)(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "CONFIRM_NO",
    pattern:
      /^(?:нет|неверно|не\s+это|не\s+то|не\s+надо|не\s+так|нет,\s*не\s+(?:это|он|она|то))(?=$|[\s,.;:!?—-])/iyu,
  },
  {
    token: "UNSUPPORTED_ADDRESS_MODE",
    pattern: /^(?:на|мы)\s+([A-Za-zА-Яа-яЁё]{2,16})(?=$|[\s,.;:!?—-])/iu,
    inspectAddressWord: true,
  },
];

/** Recognizes the "на они" / "на оно" / "мы они" class as an unsupported variant. */
export function detectUnsupportedAddressModeVariant(
  text: string,
): string | null {
  const scan = scanControls(text, { addressSetupOpen: true });
  return scan.unsupportedAddressModeWord;
}

export function splitIntoClauses(value: string): string[] {
  return value
    .split(CLAUSE_SEPARATOR)
    .map((clause) => clause.replace(TRIM_EDGES, "").replace(/\s+/gu, " ").trim())
    .filter((clause) => clause.length > 0);
}

export function isGreetingClause(clause: string): boolean {
  return GREETING_CLAUSE_PATTERN.test(clause);
}

export function isModeOnlyClause(clause: string): boolean {
  return MODE_ONLY_CLAUSE_PATTERN.test(clause);
}

export function stripGreetingClauses(value: string): string {
  const kept = splitIntoClauses(value).filter(
    (clause) => !isGreetingClause(clause),
  );

  const first = kept[0];
  if (first === undefined) return "";

  const withoutPrefix = first
    .replace(GREETING_PREFIX, "")
    .replace(TRIM_EDGES, "")
    .trim();

  return [withoutPrefix, ...kept.slice(1)].filter(Boolean).join(". ");
}

/** Consumes inert lead-ins so a control phrase can be reached at the head. */
function consumeFillers(value: string): string {
  let rest = value.trimStart();
  for (;;) {
    FILLER_PREFIX_PATTERN.lastIndex = 0;
    const match = FILLER_PREFIX_PATTERN.exec(rest);
    if (!match) return rest;
    const next = rest.slice(match[0].length).replace(/^[\s,.;:!?—-]+/u, "");
    if (next === rest) return rest;
    rest = next;
  }
}

/**
 * Clause-external punctuation. Whitespace alone is deliberately not a
 * boundary: it is what separates a control word from the prose that merely
 * follows it ("короче говоря, мне нужен курс").
 */
const CLAUSE_PUNCTUATION = /^[.,;:!?—-]+/u;

/** Sequence connectives that may join a control to preserved substantive text. */
const CONJUNCTION_PREFIX =
  /^(?:а|и|но|потом|затем|или|либо|да)(?=$|[\s,.;:!?—-])/iyu;

function consumeControl(
  rest: string,
  options: ControlScanOptions,
): { token: ControlToken; word: string | null; length: number } | null {
  for (const rule of CONTROL_RULES) {
    if (
      (rule.token === "CONFIRM_YES" || rule.token === "CONFIRM_NO") &&
      options.confirmationPending !== true
    ) {
      continue;
    }

    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(rest);
    if (!match) continue;

    if (rule.inspectAddressWord) {
      const word = (match[1] ?? "").toLowerCase();
      if (ADDRESS_MODE_WORDS.has(word)) continue;
      return { token: rule.token, word, length: match[0].length };
    }

    return { token: rule.token, word: null, length: match[0].length };
  }

  return null;
}

/** True when a CLOSE verb is followed only by profanity or a prepositional tail. */
function isCloseTail(residue: string): boolean {
  const tokens = residue
    .split(/\s+/u)
    .map((token) => token.replace(/[«»"'“”,.;:!?—-]/gu, "").toLowerCase())
    .filter(Boolean);

  return (
    tokens.length > 0 &&
    tokens.length <= 4 &&
    tokens.every((token) => CLOSE_TAIL_TOKENS.has(token))
  );
}

/**
 * Decides what a scanned clause means.
 *
 * An empty residue is a pure control clause. A non-empty residue is only
 * accepted when the control is separated from it by a real clause boundary, so
 * "отмени подбор, а потом подбери мне курс" resolves the cancellation and
 * preserves the request — while "короче говоря, мне нужен курс" stays ordinary
 * text and reaches normal routing.
 */
function resolveClause(
  controls: readonly ControlToken[],
  residue: string,
  sawBoundary: boolean,
): { accepted: boolean; remainder: string | null } {
  if (residue.length === 0) {
    return { accepted: controls.length > 0, remainder: null };
  }

  if (controls.length === 0) {
    return { accepted: false, remainder: null };
  }

  if (controls.includes("CLOSE")) {
    return isCloseTail(residue)
      ? { accepted: true, remainder: null }
      : { accepted: false, remainder: null };
  }

  // An addressing variant only counts when it is the whole clause, so
  // "на работе проблемы" stays substantive text.
  if (controls.includes("UNSUPPORTED_ADDRESS_MODE")) {
    return { accepted: false, remainder: null };
  }

  return sawBoundary
    ? { accepted: true, remainder: residue }
    : { accepted: false, remainder: null };
}

function scanClause(clause: string, options: ControlScanOptions): ControlScan {
  const controls: ControlToken[] = [];
  let unsupportedAddressModeWord: string | null = null;
  let sawBoundary = false;
  let rest = clause.trimStart();

  for (;;) {
    const consumed = consumeControl(rest, options);

    if (consumed) {
      controls.push(consumed.token);
      if (consumed.token === "UNSUPPORTED_ADDRESS_MODE") {
        unsupportedAddressModeWord = consumed.word;
      }

      rest = rest.slice(consumed.length).replace(/^\s+/u, "");
      const punctuation = rest.match(CLAUSE_PUNCTUATION);
      if (punctuation) {
        sawBoundary = true;
        rest = rest.slice(punctuation[0].length).replace(/^\s+/u, "");
      }
      continue;
    }

    const conjunction = rest.match(CONJUNCTION_PREFIX);
    if (conjunction) {
      sawBoundary = true;
      rest = rest
        .slice(conjunction[0].length)
        .replace(/^\s+/u, "")
        .replace(CLAUSE_PUNCTUATION, "")
        .replace(/^\s+/u, "");
      continue;
    }

    const afterFillers = consumeFillers(rest);
    if (afterFillers !== rest) {
      rest = afterFillers;
      continue;
    }

    break;
  }

  const residue = rest.replace(TRIM_EDGES, "").replace(/\s+/gu, " ").trim();
  const resolved = resolveClause(controls, residue, sawBoundary);

  if (!resolved.accepted) {
    // The clause merely contained control-looking words inside substantive
    // text; report it as ordinary text so it reaches normal routing.
    return {
      controls: [],
      remainder: clause,
      unsupportedAddressModeWord: null,
    };
  }

  return {
    controls,
    remainder: resolved.remainder,
    unsupportedAddressModeWord,
  };
}

export function scanControls(
  text: string,
  options: ControlScanOptions = {},
): ControlScan {
  const clauses = splitIntoClauses(text);

  if (clauses.length === 0) {
    return {
      controls: [],
      remainder: null,
      unsupportedAddressModeWord: null,
    };
  }

  const controls: ControlToken[] = [];
  const remainders: string[] = [];
  let unsupportedAddressModeWord: string | null = null;

  for (const clause of clauses) {
    const scan = scanClause(clause, options);
    controls.push(...scan.controls);
    if (scan.unsupportedAddressModeWord) {
      unsupportedAddressModeWord = scan.unsupportedAddressModeWord;
    }
    if (scan.remainder) remainders.push(scan.remainder);
  }

  const remainder = remainders.join(". ").slice(0, MAX_CHAT_MESSAGE_LENGTH);

  return {
    controls,
    remainder: remainder.length > 0 ? remainder : null,
    unsupportedAddressModeWord,
  };
}

/** True when the text contains Package-A control language in any position. */
export function hasControlLanguage(text: string): boolean {
  return scanControls(text, {
    confirmationPending: true,
    addressSetupOpen: true,
  }).controls.length > 0;
}

const STALE_REFERENCE_PATTERN =
  /(?:этот\s+курс|тот\s+курс|этот\s+поток|тот\s+поток|про\s+него|про\s+неё|этот\s+же\s+курс|та\s+же\s+тема)/iu;

/**
 * Stale-referential language ("этот курс", "продолжим") after the session TTL
 * expired. Recognized at message level because the referent, not the clause
 * structure, is what must not be silently reused.
 */
export function detectStaleReferenceLanguage(text: string): boolean {
  if (STALE_REFERENCE_PATTERN.test(text)) return true;

  const scan = scanControls(text, { addressSetupOpen: false });
  return scan.controls.includes("RESUME") && scan.remainder === null;
}
