/**
 * NAVIGATOR-ACT-ROUTER-ALIAS-CORRECTION-1 — course-reference evidence.
 *
 * Production port of the Owner-accepted CORR5 recognizer (PREFLIGHT-1.CORR5 spec
 * `course-reference-evidence.corr5.mts`, sha256 01cb328d…606db). Rules keep their
 * CORR4/CORR5 markers so each one can be traced to the accepted specification.
 *
 * Frozen Owner policy (OWNER-POLICY-CLOSURE-1): P1-0, P2-A, P3-A, P3-H anchors ON,
 * P4-B, P5-A, P6-A, P7-A, P8-A. No alternative is implemented here: there is no
 * educational follow-up authority (P1-B), no multi-course clarification (P5-B),
 * no strict-only recognition (P6-B) and no F-1 relaxation (P8-B).
 *
 * Authority model:
 *   - This module NEVER grants COURSE_FOLLOW_UP or commercial authority.
 *     Follow-up acceptance stays the unchanged literal
 *     title/URL predicate inside the router. This module only decides whether a
 *     NON-accepted follow-up is a controlled uncertainty (UNRESOLVED) or the
 *     unchanged technical rejection (ABSENT).
 *   - For COURSE_CONTENT it applies a question-anchored consistency gate that can
 *     only turn a current ACCEPT into UNRESOLVED (never REJECT, never widen).
 *   - Recognition is recall-oriented: an unparsed course reference becomes an
 *     UNRESOLVED entity, never "no reference" (I4). No cap discards evidence; the
 *     analysis is linear over the request (the API bounds it: 40 × 4,000 chars).
 *
 * Imports only the governed resolver, the catalog and the frozen identity-scope
 * descriptors (read-only). No alias is defined here.
 */
import type { ConversationMessage } from "../chat-contract.ts";
import {
  resolveCourseReferences,
  type AcademyCourseId,
} from "../academy/course-reference.ts";
import { ACADEMY_COURSES } from "../academy/course-catalog.ts";
import { COURSE_IDENTITY_SCOPE } from "../academy/course-identity-scope.ts";

type Msg = ConversationMessage;
export type CourseId = AcademyCourseId;

/* ------------------------------------------------------- catalog facts --- */

const CATALOG_IDS = new Set<string>(ACADEMY_COURSES.map((c) => c.id));
const OFFICIAL_HOST = "structural-typology.academy";

/**
 * Memoisation is scoped to ONE gate evaluation (see `withRequestScopedCaches`):
 * no user text outlives the validation call that analysed it, and memory is
 * bounded by the API request limits (40 × 4,000 characters).
 */
const resolverCache = new Map<string, CourseId[]>();
function resolveIds(text: string): CourseId[] {
  const cached = resolverCache.get(text);
  if (cached) return cached;
  const ids = resolveCourseReferences(text).courseIds as CourseId[];
  resolverCache.set(text, ids);
  return ids;
}

/* ---------------------------------------------------------------- URLs --- */

export type UrlInfo = {
  raw: string;
  start: number;
  end: number;
  scheme: string | null;
  userinfo: string | null;
  host: string;
  port: string | null;
  path: string;
  official: boolean;
  classification: "OFFICIAL_COURSE" | "OFFICIAL_OTHER" | "NON_OFFICIAL_ORIGIN";
  courseId: CourseId | null;
  courseLikePath: boolean;
};

const URL_CANDIDATE =
  /(?<![\p{L}\p{N}_@./-])(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^\s/@?#«»"“”<>]+@)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\.?(?::\d{1,5})?(?:[/?#][^\s«»"“”<>]*)?/giu;
const TRAILING_PUNCT = /[.,;:!?…)\]»"'’”]+$/u;

/**
 * Exact-origin classification (report §15). Origin = (scheme, host, effective
 * port). Official iff host == structural-typology.academy (case-insensitive,
 * one trailing root dot tolerated), no userinfo, scheme absent/http/https, and
 * port absent or equal to the scheme's default (80/443). A scheme-less URL with
 * an explicit port is not official. OFFICIAL_COURSE additionally requires the
 * exact path /courses/<catalog id> with at most one trailing slash.
 * NEVER used as authority under P1_0 — only as reference evidence.
 */
export function classifyUrl(raw: string, start: number): UrlInfo | null {
  const s = raw.replace(TRAILING_PUNCT, "");
  if (s.length === 0) return null;
  let scheme: string | null = null;
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//iu.exec(s);
  let rest = s;
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    rest = s.slice(schemeMatch[0].length);
  }
  const authorityEnd = rest.search(/[/?#]/u);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const tail = authorityEnd === -1 ? "" : rest.slice(authorityEnd);
  let userinfo: string | null = null;
  let hostport = authority;
  const at = authority.lastIndexOf("@");
  if (at !== -1) {
    userinfo = authority.slice(0, at);
    hostport = authority.slice(at + 1);
  }
  let port: string | null = null;
  const portMatch = /:(\d{1,5})$/u.exec(hostport);
  if (portMatch) {
    port = portMatch[1];
    hostport = hostport.slice(0, -portMatch[0].length);
  }
  const host = hostport.toLowerCase().replace(/\.$/u, "");
  const pathEnd = tail.search(/[?#]/u);
  const path = pathEnd === -1 ? tail : tail.slice(0, pathEnd);
  // Scheme-less text is a URL only with a path, a www. host or the official host.
  if (scheme === null && path === "" && !host.startsWith("www.") && host !== OFFICIAL_HOST) return null;
  const schemeOk = scheme === null || scheme === "http" || scheme === "https";
  const defaultPort = scheme === "http" ? 80 : scheme === "https" ? 443 : null;
  const portOk = port === null || (defaultPort !== null && Number(port) === defaultPort);
  const official = host === OFFICIAL_HOST && userinfo === null && schemeOk && portOk;
  const coursePath = /^\/courses\/([a-z0-9-]+)\/?$/u.exec(path);
  const courseId =
    official && coursePath && CATALOG_IDS.has(coursePath[1]) ? (coursePath[1] as CourseId) : null;
  return {
    raw: s,
    start,
    end: start + s.length,
    scheme,
    userinfo,
    host,
    port,
    path,
    official,
    classification: courseId !== null ? "OFFICIAL_COURSE" : official ? "OFFICIAL_OTHER" : "NON_OFFICIAL_ORIGIN",
    courseId,
    courseLikePath:
      /\/(?:courses?|programs?|programmes?|kurs[a-z]*|curso[s]?|learn|lessons?|class(?:es)?|training|catalog)(?:[/?#.-]|$)/iu.test(path),
  };
}

/* ------------------------------------------------------------ tokenize --- */

export type Tok = {
  raw: string;
  low: string;
  start: number;
  end: number;
  kind: "W" | "P" | "NL" | "URL";
  latin: boolean;
  url?: UrlInfo;
  sentence: number;
};

const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*|\n+|[^\s\p{L}\p{N}]/gu;
const norm = (s: string) => s.toLowerCase().replace(/ё/gu, "е");

const ABBREV = new Set([
  "им", "т", "е", "д", "п", "др", "пр", "стр", "гл", "рис", "см", "ср", "напр", "проф", "акад",
  "доц", "англ", "рус", "лат", "г", "гг", "в", "вв", "ул", "кв", "тыс", "млн", "млрд", "руб", "коп",
  "мин", "сек", "ч", "вкл", "искл", "тел", "н", "о", "и", "etc", "vs", "dr", "mr", "mrs", "ms",
  "prof", "st", "no", "pp", "e", "g", "i",
]);
const BOUNDARY_PUNCT = new Set(["?", "!", "…", ";"]);
const CLOSERS = new Set(["»", "\"", "”", ")", "]", "'", "’"]);
/** CORR5 M1 — closed abbreviations that can end a sentence («т. д.», «т. п.», «и др.», «и пр.», «etc.»). */
const FINAL_ABBREV = new Set(["др", "пр", "etc"]);
const FINAL_ABBREV_AFTER_T = new Set(["д", "п"]);
function sentenceFinalAbbreviation(toks: Tok[], dot: number): boolean {
  const prev = toks[dot - 1];
  if (!prev) return false;
  if (FINAL_ABBREV.has(prev.low)) return true;
  return FINAL_ABBREV_AFTER_T.has(prev.low) && toks[dot - 2]?.raw === "." && toks[dot - 3]?.low === "т";
}

function tokenize(text: string): { toks: Tok[]; sentences: Array<[number, number]>; urls: UrlInfo[] } {
  const urls: UrlInfo[] = [];
  for (const m of text.matchAll(URL_CANDIDATE)) {
    const info = classifyUrl(m[0], m.index ?? 0);
    if (info) urls.push(info);
  }
  const toks: Tok[] = [];
  let cursor = 0;
  const pushRange = (from: number, to: number) => {
    const slice = text.slice(from, to);
    for (const m of slice.matchAll(WORD_RE)) {
      const raw = m[0];
      const start = from + (m.index ?? 0);
      const kind: Tok["kind"] = raw.startsWith("\n") ? "NL" : /[\p{L}\p{N}]/u.test(raw) ? "W" : "P";
      toks.push({
        raw, low: norm(raw), start, end: start + raw.length, kind,
        latin: kind === "W" && /[a-z]/iu.test(raw) && !/[\p{Script=Cyrillic}]/u.test(raw),
        sentence: 0,
      });
    }
  };
  for (const u of urls) {
    if (u.start < cursor) continue;
    pushRange(cursor, u.start);
    toks.push({ raw: u.raw, low: norm(u.raw), start: u.start, end: u.end, kind: "URL", latin: true, url: u, sentence: 0 });
    cursor = u.end;
  }
  pushRange(cursor, text.length);

  // Sentence segmentation (report §11.2): ? ! … ; newline, and "." followed by
  // whitespace/end unless the preceding word is an initial or a closed abbreviation.
  const sentences: Array<[number, number]> = [];
  let sentence = 0;
  let sentStart: number | null = null;
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (sentStart === null) sentStart = t.start;
    t.sentence = sentence;
    let boundary = false;
    if (t.kind === "NL") boundary = true;
    else if (t.kind === "P" && BOUNDARY_PUNCT.has(t.raw)) boundary = true;
    else if (t.kind === "P" && t.raw === ".") {
      // CORR5 M1: closers directly after the dot («….)», «….»») do not suppress the boundary.
      let after = t.end;
      while (after < text.length && CLOSERS.has(text[after])) after += 1;
      const nextChar = text[after];
      const followedBySpace = nextChar === undefined || /\s/u.test(nextChar);
      const prev = toks[i - 1];
      const abbreviation = prev !== undefined && prev.kind === "W" && prev.end === t.start &&
        (prev.raw.length === 1 || ABBREV.has(prev.low));
      const nextIsDot = toks[i + 1]?.raw === "." && toks[i + 1].start === t.end;
      // CORR5 M1: a sentence-final abbreviation followed by a capitalised word ends the sentence.
      const nextWord = toks.slice(i + 1).find((x) => !(x.kind === "P" && CLOSERS.has(x.raw)));
      const finalAbbreviation = abbreviation && sentenceFinalAbbreviation(toks, i) &&
        nextWord?.kind === "W" && /^\p{Lu}/u.test(nextWord.raw);
      boundary = followedBySpace && !nextIsDot && (!abbreviation || finalAbbreviation);
    }
    if (boundary) {
      // trailing closers belong to the closing sentence
      while (i + 1 < toks.length && toks[i + 1].kind === "P" && CLOSERS.has(toks[i + 1].raw)) {
        i += 1;
        toks[i].sentence = sentence;
      }
      // consecutive terminal punctuation (?!, ?!..) stays in the same sentence
      while (i + 1 < toks.length && toks[i + 1].kind === "P" && (BOUNDARY_PUNCT.has(toks[i + 1].raw) || toks[i + 1].raw === ".")) {
        i += 1;
        toks[i].sentence = sentence;
      }
      sentences.push([sentStart, toks[i].end]);
      sentence += 1;
      sentStart = null;
    }
  }
  if (sentStart !== null) sentences.push([sentStart, toks.at(-1)!.end]);
  return { toks, sentences, urls };
}

/* ------------------------------------------------------- closed classes --- */

const set = (...xs: string[]) => new Set(xs.map(norm));

const STRICT_RU = /^(?:[\p{L}]+-)?(?:спец|мини|видео|аудио|интенсив|онлайн|микро|мастер)?курс(?:а|у|ом|е|ы|ов|ам|ами|ах)?$/u;
const STRICT_LATIN = set("course", "courses", "kurs", "kurse", "kursy", "kursu", "kurso", "curso", "cursos", "cours", "corso", "corsi", "cursus");
const EVENT_RU = new RegExp(
  "^(?:" + [
    "программ(?:а|ы|е|у|ой|ою|ам|ами|ах)?",
    "лекци(?:я|и|ю|ей|ям|ями|ях|й)",
    "семинар(?:а|у|ом|е|ы|ов|ам|ами|ах)?",
    "вебинар(?:а|у|ом|е|ы|ов|ам|ами|ах)?",
    "тренинг(?:а|у|ом|е|и|ов|ам|ами|ах)?",
    "интенсив(?:а|у|ом|е|ы|ов|ам|ами|ах)?",
    "практикум(?:а|у|ом|е|ы|ов|ам|ами|ах)?",
    "мастер-класс(?:а|у|ом|е|ы|ов|ам|ами|ах)?",
    "модул(?:ь|я|ю|ем|е|и|ей|ям|ями|ях)",
    "заняти(?:е|я|ю|ем|и|й|ям|ями|ях)",
    "урок(?:а|у|ом|е|и|ов|ам|ами|ах)?",
    "воркшоп(?:а|у|ом|е|ы|ов|ам|ами|ах)?",
    "обучени(?:е|я|ю|ем|и)",
    "класс(?:а|у|ом|е|ы|ов|ам|ами|ах)?", // CORR5 M2 (A2-9 «на классе алхимии»)
  ].join("|") + ")$", "u");
const EVENT_LATIN = set(
  "program", "programs", "programme", "programmes", "programa", "programas", "programma", "programm",
  "class", "classes", "lecture", "lectures", "seminar", "seminars", "webinar", "webinars", "workshop",
  "workshops", "training", "trainings", "module", "modules", "lesson", "lessons", "bootcamp", "bootcamps",
  "curriculum",
);
const NEG = set("не", "ни");
const VASH = set("ваш", "ваша", "ваше", "ваши", "вашего", "вашей", "вашему", "вашим", "вашем", "вашу", "ваших", "вашими", "your");
const DEMONSTRATIVE = set(
  "этот", "этого", "этому", "этим", "этом", "эта", "этой", "эту", "эти", "этих", "этими",
  "тот", "того", "тому", "том", "та", "той", "ту", "те", "тех", "теми",
  "данный", "данного", "данному", "данным", "данном", "данная", "данной", "данную", "данные", "данных",
  "указанный", "указанного", "указанном", "указанная", "указанной", "упомянутый", "упомянутого", "упомянутом",
  "упомянутая", "упомянутой", "вышеупомянутый", "вышеупомянутого", "вышеупомянутом",
  "this", "these", "those", "that",
);
/**
 * CORR5 M2 — closed recognition additions for the CORR4.IV1-audited constructions only.
 *  - FRAME_PREP: an event noun inside «про/о/об/в/на …» (optionally after one adjective)
 *    WITH a named complement is a course-like reference (UNRESOLVED unless an alias resolves).
 *  - DEF_DET + one Latin pre-modifier: «the alchemy class/program/course».
 *  - Mixed-script pointer words are matched on a homoglyph skeleton («cоurse», «курcе»).
 */
const FRAME_PREP = set("про", "о", "об", "обо", "в", "во", "на");
const ADJ_ENDING = /(?:ой|ый|ий|ая|яя|ую|юю|ое|ее|ые|ие|ых|их|ым|им|ыми|ими|ого|его|ому|ему)$/u;
const DEF_DET = set("the", "this", "that", "your", "their", "his", "her", "our", "my");
const NON_NAMING_PREMOD = set(
  "online", "new", "full", "whole", "entire", "next", "last", "previous", "current", "first", "second",
  "basic", "advanced", "free", "paid", "main", "same", "other", "another",
);
const LAT_TO_CYR: Record<string, string> = { a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", k: "к" };
const CYR_TO_LAT: Record<string, string> = Object.fromEntries(Object.entries(LAT_TO_CYR).map(([l, c]) => [c, l]));
function pointerSkeletons(low: string): string[] {
  if (!(/\p{Script=Latin}/u.test(low) && /\p{Script=Cyrillic}/u.test(low))) return [low];
  const map = (m: Record<string, string>) => [...low].map((ch) => m[ch] ?? ch).join("");
  return [low, map(LAT_TO_CYR), map(CYR_TO_LAT)];
}
const SAMYI = set("самый", "самого", "самому", "самым", "самом", "самая", "самой", "самую", "самые", "самых", "same");
const GENERIC_DET = set(
  "какой", "какая", "какое", "какие", "какого", "каком", "какую", "каким", "какими", "каких", "какому",
  "любой", "любая", "любое", "любые", "любого", "любом", "любую", "каждый", "каждая", "каждом", "каждого",
  "все", "всех", "всем", "всеми", "несколько", "многие", "многих", "which", "what", "any", "every", "all", "some",
);
const OTHER_DET = set(
  "другой", "другая", "другое", "другие", "другого", "другом", "другую", "других", "иной", "иного", "ином",
  "сторонний", "стороннего", "стороннем", "чужой", "чужого", "чужом", "another", "other",
);
const IDIOM_SUBJ = set(
  "я", "ты", "он", "она", "мы", "вы", "они", "будь", "будьте", "быть", "был", "была", "были", "буду", "будем",
  "будете", "будут", "будет", "не", "меня", "тебя", "его", "ее", "нас", "вас", "их", "держать", "держите",
  "держи", "держу", "держим", "поставить", "поставьте", "поставлю", "ввести", "введите", "введу", "все",
);
const IDIOM_OBJ = set("дела", "событий", "того", "всего", "последних", "происходящего", "новостей", "всех");
const CONNECTOR1 = set(
  "про", "о", "об", "обо", "по", "about", "on", "of", "called", "named", "titled", "de", "del", "sobre",
  "über", "uber", "zu", "zum", "zur", "sur", "su", "di", "sul",
);
const CONNECTOR2: Array<[string, string]> = [["на", "тему"], ["по", "теме"], ["под", "названием"], ["с", "названием"]];
const QUOTES = new Set(["«", "\"", "“", "„", "'", "’"]);
const WRAPPERS = new Set(["«", "\"", "“", "„", "'", "(", "["]);
const LIST_SEP_WORDS = set("и", "или", "либо", "а", "and", "or");
const CLAUSE_START = set(
  "который", "которая", "которое", "которые", "которого", "которой", "которому", "которым", "котором",
  "которую", "которых", "где", "что", "чтобы", "когда", "если", "но", "хотя", "ведь", "потому", "так",
  "он", "она", "оно", "они", "это", "я", "мы", "вы", "ты", "не", "же", "его", "ее", "их", "свой", "своих",
  "своего", "свою", "своей", "весь", "вся", "всё", "все", "тоже", "также", "who", "which", "that", "it",
  // OWNER-DEFECT-REMEDIATION-1 (F03): an interrogative after «и/или» opens a
  // new question («курс Маслоу и сколько он стоит»), never a list member.
  "сколько", "как", "какой", "какая", "какое", "какие", "почему", "зачем", "кто", "куда", "откуда",
);
const FUNCTION_WORDS = set(
  "в", "во", "на", "за", "под", "над", "при", "без", "через", "к", "ко", "с", "со", "у", "от", "до", "из",
  "из-за", "для", "о", "об", "обо", "про", "по", "и", "а", "но", "или", "либо", "что", "чтобы", "как", "когда",
  "если", "хотя", "ведь", "потому", "так", "то", "не", "ни", "ли", "же", "бы", "вот", "уж", "еще", "даже",
  "только", "я", "ты", "он", "она", "оно", "мы", "вы", "они", "меня", "мне", "мной", "тебя", "тебе", "себя",
  "себе", "его", "ее", "их", "им", "ним", "нем", "ей", "ней", "это", "этот", "эта", "эти", "тот", "та", "те",
  "мой", "моя", "мое", "мои", "твой", "наш", "наша", "наши", "который", "которая", "которое", "которые",
  "был", "была", "было", "были", "будет", "буду", "будут", "есть", "является", "там", "тут", "здесь", "где",
  "куда", "сейчас", "уже", "очень", "много", "мало", "тоже", "также", "is", "was", "are", "were", "the", "a",
  "an", "in", "at", "for", "with", "by", "from", "to", "and", "or", "but", "that", "which", "who", "it",
  "this", "there", "i", "you", "we", "they", "be", "been", "has", "have", "had", "will", "would",
);
/** G1 — closed non-educational senses of «курс» (direction, exchange rate, treatment, course of life/events). */
const NON_EDU_GENITIVE = set(
  "жизни", "событий", "лечения", "терапии", "таблеток", "приема", "уколов", "процедур", "реабилитации",
  "валют", "валюты", "доллара", "евро", "рубля", "юаня", "биткоина", "акций", "обмена", "криптовалют",
  "корабля", "судна", "самолета", "поезда",
);
const COURSE_DIRECTION_VERBS = set(
  "взять", "взял", "взяла", "взяли", "возьмем", "берем", "берет", "держать", "держим", "держит", "держали",
  "сменить", "сменил", "сменили", "меняет", "изменить", "изменил", "изменили", "скорректировать", "проложить",
);
/** G2/G3 — closed lead words that may precede a list member («и/или/а/но и/не/ни/не только/также»). */
const LEAD_WORDS = set("и", "или", "либо", "а", "но", "не", "ни", "только", "также", "and", "or", "not", "only");
const LEAD_PUNCT = new Set([",", "—", "–", "-"]);
const PREPOSITIONS = set(
  "в", "во", "на", "за", "под", "над", "при", "без", "через", "к", "ко", "с", "со", "у", "от", "до", "из",
  "для", "о", "об", "обо", "про", "по", "из-за", "после", "перед", "about", "in", "on", "at", "from", "of",
  "with", "for",
);

/* --------------------------------------------------- back-references --- */

const LOCATIVE = set("там", "тут", "здесь", "туда", "сюда", "оттуда", "отсюда", "there");
const PERS3 = set(
  "он", "его", "него", "ему", "нему", "им", "ним", "нем", "она", "ее", "нее", "ей", "ней", "ею", "нею",
  "оно", "они", "их", "них", "ими", "ними", "it", "its", "they", "them", "their",
);
const DEMO_BR = set(
  "этого", "этому", "этим", "этом", "этот", "эта", "этой", "эту", "эти", "этих", "этими", "тот", "того",
  "тому", "тем", "том", "та", "той", "ту", "те", "тех", "теми", "these", "those",
);
const ETO = set("это", "this");

export type BackRef = { index: number; token: string; kind: "CONTAINER" | "ETO" };

/** Closed-class back-reference detection with closed idiom exclusions (report §14). */
export function backReferences(toks: Tok[], from: number, to: number): BackRef[] {
  const out: BackRef[] = [];
  const W = (k: number) => (k >= 0 && k < toks.length && toks[k].kind === "W" ? toks[k].low : "");
  for (let i = from; i < to; i += 1) {
    const t = toks[i];
    if (t.kind !== "W") continue;
    const low = t.low;
    const prev = W(i - 1);
    const prev2 = W(i - 2);
    const next = W(i + 1);
    const nextRaw = toks[i + 1]?.raw ?? "";
    const next2 = W(i + 2);
    if (LOCATIVE.has(low)) {
      if ((prev === "чем" || prev === "чём") && prev2 === "при") continue; // «при чём тут/там/здесь»
      if (low === "тут" && next === "же") continue;
      if (low === "здесь" && next === "и" && next2 === "сейчас") continue;
      if (low === "there" && ["is", "are", "was", "were", "'s"].includes(next)) continue;
      out.push({ index: i, token: t.raw, kind: "CONTAINER" });
      continue;
    }
    if (PERS3.has(low)) {
      out.push({ index: i, token: t.raw, kind: "CONTAINER" });
      continue;
    }
    if (DEMO_BR.has(low)) {
      if (low === "тем" && (next === "не" || next === "более" || next === "самым")) continue;
      if (next === "же") continue; // «тот же», «та же» (v3: «тот самый» without a noun IS a back-reference)
      if (nextRaw === "," && ["что", "как", "чтобы", "кто", "где", "когда"].includes(next2)) continue; // complementizer «то, что»
      if (["что", "как", "чтобы", "кто"].includes(next) && (low === "том" || low === "то" || low === "того" || low === "тем" || low === "тому")) continue;
      out.push({ index: i, token: t.raw, kind: "CONTAINER" });
      continue;
    }
    if (low === "то" && next === "есть") continue;
    if (ETO.has(low)) {
      const container = PREPOSITIONS.has(prev) || ["про", "о", "об", "обо", "about"].includes(next);
      out.push({ index: i, token: t.raw, kind: container ? "CONTAINER" : "ETO" });
    }
  }
  return out;
}

/* --------------------------------------------------- subject anchors --- */

/**
 * P3-H subject anchors: stems mechanically derived from the frozen, governed
 * identity-scope descriptor of each course (no new curated vocabulary; a closed
 * meta-stoplist removes generic framing words). Anchors are PERMISSIVE ONLY:
 * they can turn a dependent-question UNRESOLVED into ACCEPT for that course;
 * they never name a course, never create presence, never block and never
 * authorize follow-up or payment. They are not aliases.
 */
const ANCHOR_STOP = set(
  "психология", "базовые", "модель", "различение", "принципы", "основной", "предмет", "курса", "специальное",
  "теоретическое", "социальное", "стратегии", "динамика", "переходы", "между", "становятся", "четыре",
  "инструмента", "рождаются", "живые", "теории", "теория", "признаки", "структура", "основные", "способы",
  "фактор", "роли", "практические", "рекомендации", "концепция", "глава", "внутри", "книги", "типов",
);
function stem(word: string): string {
  return word.replace(/[аеиоуыэюяьйъ]+$/u, "");
}
export const COURSE_ANCHOR_STEMS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  ACADEMY_COURSES.map((course) => {
    const d = COURSE_IDENTITY_SCOPE[course.id as CourseId];
    if (!d) return [course.id, []];
    const words = (norm(d).match(/[\p{L}]+/gu) ?? []).filter((w) => w.length >= 4 && !ANCHOR_STOP.has(w));
    const stems = [...new Set(words.map(stem).filter((s) => s.length >= 3))].sort();
    return [course.id, stems];
  }),
);
/** v3 — closed discourse words that never act as subject anchors. */
const ANCHOR_DISCOURSE_STOP = set(
  "интересно", "интересует", "интересна", "интересен", "кстати", "скажите", "подскажите", "расскажите", "объясните",
  "поясните", "уточните", "слушайте", "понятно", "ясно", "спасибо", "хорошо", "ладно", "итак", "получается", "значит",
  "вопрос", "вообще", "просто", "очень", "тоже", "также", "реально", "действительно", "конечно", "наверное",
);
function tokenMatchesStem(low: string, s: string): boolean {
  return low.startsWith(s) && low.length <= s.length + (s.length >= 5 ? 5 : 3);
}
function tokenAnchors(low: string, courseId?: string): boolean {
  if (ANCHOR_DISCOURSE_STOP.has(low)) return false;
  const entries = courseId ? [[courseId, COURSE_ANCHOR_STEMS[courseId] ?? []] as const] : Object.entries(COURSE_ANCHOR_STEMS);
  return entries.some(([, stems]) => stems.some((s) => tokenMatchesStem(low, s)));
}

/* ------------------------------------------------------------ entities --- */

export type EntityKind = "RESOLVED" | "UNRESOLVED" | "ANAPHORIC" | "GENERIC";
export type Entity = {
  index: number;
  pointer: string;
  family: "STRICT" | "EVENT" | "URL";
  kind: EntityKind;
  ids: CourseId[];
  partial: boolean;
  marked: boolean;
  sentence: number;
  start: number;
  why: string;
};

export type MessageAnalysis = {
  role: "user" | "assistant";
  text: string;
  masked: string;
  toks: Tok[];
  sentences: Array<[number, number]>;
  entities: Entity[];
  aliasIds: CourseId[];
};

function maskText(text: string, urls: UrlInfo[]): string {
  let masked = text;
  for (const u of urls) masked = masked.slice(0, u.start) + " ".repeat(u.end - u.start) + masked.slice(u.end);
  return masked.replace(/академи[а-яё]*\s+структурн[а-яё]*\s+типолог[а-яё]*/giu, (m) => " ".repeat(m.length));
}

function isBoundaryTok(t: Tok | undefined): boolean {
  if (!t) return true;
  return t.kind === "NL" || (t.kind === "P" && (BOUNDARY_PUNCT.has(t.raw) || t.raw === "." || t.raw === "," ||
    t.raw === "—" || t.raw === "–" || t.raw === "-" || t.raw === ")" || t.raw === "]" || t.raw === ":"));
}

/** Alias beginning exactly at word token j (≤6 words), start-tight; returns ids and the index after the alias. */
function aliasAt(a: { toks: Tok[]; masked: string }, j: number): { ids: CourseId[]; next: number } | null {
  const toks = a.toks;
  // initials «А.», «А.Х.», «им.» before the alias
  while (j + 1 < toks.length && toks[j].kind === "W" && (toks[j].raw.length === 1 || toks[j].low === "им") &&
    toks[j + 1].raw === ".") j += 2;
  if (j >= toks.length || toks[j].kind !== "W") return null;
  let words = 0;
  for (let k = j; k < toks.length && words < 6; k += 1) {
    if (toks[k].kind === "NL" || toks[k].sentence !== toks[j].sentence) break;
    if (toks[k].kind !== "W") continue;
    words += 1;
    const span = a.masked.slice(toks[j].start, toks[k].end);
    const ids = resolveIds(span);
    if (ids.length > 0) {
      const dropped = new Set(resolveIds(a.masked.slice(toks[j].start + 1, toks[k].end)));
      const tight = ids.filter((id) => !dropped.has(id));
      if (tight.length > 0) return { ids: tight, next: k + 1 };
      return null;
    }
  }
  return null;
}

/** G2/G3 — an alias reached after at most four closed lead tokens (never across a sentence boundary). */
function aliasAfterLead(a: { toks: Tok[]; masked: string }, j: number): { ids: CourseId[]; next: number } | null {
  const toks = a.toks;
  let k = j;
  let steps = 0;
  while (k < toks.length && steps < 4 &&
    ((toks[k].kind === "P" && LEAD_PUNCT.has(toks[k].raw)) || (toks[k].kind === "W" && LEAD_WORDS.has(toks[k].low)))) {
    k += 1;
    steps += 1;
  }
  if (steps === 0) return null;
  k = skip(toks, k, WRAPPERS).j;
  if (toks[k]?.kind === "W" && CONNECTOR1.has(toks[k].low)) k = skip(toks, k + 1, WRAPPERS).j;
  return toks[k]?.kind === "W" && toks[k].sentence === toks[j]?.sentence ? aliasAt(a, k) : null;
}

function skip(toks: Tok[], j: number, s: Set<string>): { j: number; skipped: string[] } {
  const skipped: string[] = [];
  while (j < toks.length && toks[j].kind === "P" && s.has(toks[j].raw)) {
    skipped.push(toks[j].raw);
    j += 1;
  }
  return { j, skipped };
}

function prevWord(toks: Tok[], i: number, n = 1): Tok | undefined {
  let k = i - 1;
  let seen = 0;
  while (k >= 0) {
    if (toks[k].kind === "W") {
      seen += 1;
      if (seen === n) return toks[k];
    } else if (toks[k].kind === "NL" || (toks[k].kind === "P" && BOUNDARY_PUNCT.has(toks[k].raw))) {
      return undefined;
    }
    k -= 1;
  }
  return undefined;
}

function classifyPointer(a: { toks: Tok[]; masked: string }, i: number, family: "STRICT" | "EVENT"): Entity | null {
  const toks = a.toks;
  const t = toks[i];
  const prev = prevWord(toks, i);
  const prev2 = prevWord(toks, i, 2);
  const pl = prev?.low ?? "";
  const pl2 = prev2?.low ?? "";
  const base = { index: i, pointer: t.raw, family, partial: false, marked: false, sentence: t.sentence, start: t.start };
  // CORR5 M2: «the alchemy class» — an adjacent Latin pre-modifier after a definite/possessive determiner.
  const premod = prev !== undefined && toks[i - 1] === prev && prev.latin && DEF_DET.has(pl2) &&
    !FUNCTION_WORDS.has(pl) && !NON_NAMING_PREMOD.has(pl) && !GENERIC_DET.has(pl) && !DEMONSTRATIVE.has(pl) && !VASH.has(pl);

  if (family === "STRICT" && t.low === "курсе" && (pl === "в" || pl === "во")) {
    const nx = toks[i + 1]?.kind === "W" ? toks[i + 1].low : "";
    if (IDIOM_SUBJ.has(pl2) || IDIOM_OBJ.has(nx)) return null; // idiom «быть в курсе»
  }
  if (NEG.has(pl)) return null; // G2 «не курс …»: the user states it is not a course
  if (family === "STRICT" && COURSE_DIRECTION_VERBS.has(pl)) return null; // G1 «взять курс на …»

  let j = i + 1;
  let r = skip(toks, j, new Set([...WRAPPERS, ":"]));
  j = r.j;
  let quoteFound = r.skipped.some((x) => QUOTES.has(x));
  let marked = false;
  if (toks[j]?.kind === "W" && toks[j].low === "академии") {
    marked = true;
    j += 1;
    if (toks[j]?.low.startsWith("структурн") && toks[j + 1]?.low.startsWith("типолог")) j += 2;
  } else if (toks[j]?.kind === "W" && ["в", "во", "от", "из", "у"].includes(toks[j].low) &&
    toks[j + 1]?.kind === "W" && ["академии", "вас"].includes(toks[j + 1].low)) {
    marked = true;
    j += 2;
  }
  let connector = false;
  let connectorPo = false;
  const c2 = CONNECTOR2.find(([x, y]) => toks[j]?.low === x && toks[j + 1]?.low === y);
  if (c2) {
    connector = true;
    j += 2;
  } else if (toks[j]?.kind === "W" && CONNECTOR1.has(toks[j].low)) {
    connector = true;
    connectorPo = toks[j].low === "по";
    j += 1;
  }
  r = skip(toks, j, WRAPPERS);
  j = r.j;
  quoteFound = quoteFound || r.skipped.some((x) => QUOTES.has(x));
  const nextTok = toks[j];
  if (family === "STRICT" && !connector && !quoteFound && nextTok?.kind === "W" && NON_EDU_GENITIVE.has(nextTok.low)) {
    return null; // G1 «курс жизни/валют/лечения»
  }
  const alias = nextTok && (nextTok.kind === "W" || nextTok.kind === "P")
    ? (nextTok.kind === "W" ? aliasAt(a, j) : null) ?? aliasAfterLead(a, j)
    : null;

  if (family === "EVENT") {
    const qualifies =
      (connector && !connectorPo) || quoteFound || marked || nextTok?.kind === "URL" || alias !== null ||
      pl === "на" || VASH.has(pl) || DEMONSTRATIVE.has(pl) || (SAMYI.has(pl) && DEMONSTRATIVE.has(pl2));
    // CORR5 M2: framed event noun with a named complement («про программу алхимии», «в курсовой программе алхимии»).
    const framed = FRAME_PREP.has(pl) || (FRAME_PREP.has(pl2) && ADJ_ENDING.test(pl) && !FUNCTION_WORDS.has(pl) &&
      !GENERIC_DET.has(pl) && !OTHER_DET.has(pl) && !DEMONSTRATIVE.has(pl) && !VASH.has(pl));
    const namedComplement = alias !== null ||
      (nextTok?.kind === "W" && !FUNCTION_WORDS.has(nextTok.low) && !CLAUSE_START.has(nextTok.low));
    if (!qualifies && !premod && !(framed && namedComplement)) return null;
  }

  if (nextTok?.kind === "URL") {
    const u = nextTok.url!;
    return u.classification === "OFFICIAL_COURSE"
      ? { ...base, marked, kind: "RESOLVED", ids: [u.courseId!], why: "official course URL complement" }
      : { ...base, marked, kind: "UNRESOLVED", ids: [], why: `${u.classification} URL complement` };
  }

  if (alias) {
    const ids = new Set(alias.ids);
    let partial = false;
    let k = alias.next;
    for (;;) {
      const sep = toks[k];
      if (!sep) break;
      let after = k;
      if (sep.kind === "P" && (sep.raw === "," || sep.raw === "/" || sep.raw === "&")) after = k + 1;
      else if (sep.kind === "W" && LIST_SEP_WORDS.has(sep.low)) {
        after = k + 1;
        if (toks[after]?.low === "также" || toks[after]?.low === "и") after += 1;
      } else if (sep.kind === "W" && sep.low === "но" && toks[k + 1]?.low === "и") after = k + 2;
      else break;
      let leads = 0;
      while (leads < 3 && toks[after]?.kind === "W" && LEAD_WORDS.has(toks[after].low)) { after += 1; leads += 1; }
      let p = skip(toks, after, WRAPPERS).j;
      if (toks[p]?.kind === "W" && CONNECTOR1.has(toks[p].low)) p += 1;
      p = skip(toks, p, WRAPPERS).j;
      const nextAlias = toks[p]?.kind === "W" ? aliasAt(a, p) : null;
      if (nextAlias) {
        nextAlias.ids.forEach((id) => ids.add(id));
        k = nextAlias.next;
        const closers = skip(toks, k, CLOSERS);
        k = closers.j;
        continue;
      }
      const item = toks[p];
      if (!item || isBoundaryTok(item) || (item.kind === "W" && CLAUSE_START.has(item.low))) break;
      if (item.kind === "W" || item.kind === "URL") partial = true;
      break;
    }
    return {
      ...base, marked, kind: partial ? "UNRESOLVED" : "RESOLVED", ids: [...ids], partial,
      why: partial ? "list with an unresolved member" : "alias complement",
    };
  }

  const noComplement =
    !nextTok || isBoundaryTok(nextTok) || (nextTok.kind === "W" && FUNCTION_WORDS.has(nextTok.low) && !connector);
  if (noComplement || (connector && nextTok?.kind === "W" && FUNCTION_WORDS.has(nextTok.low))) {
    if (premod) {
      // CORR5 M2: the pre-modifier is the name; only a governed alias resolves it.
      const ids = resolveIds(a.masked.slice(prev!.start, prev!.end));
      return ids.length > 0
        ? { ...base, marked, kind: "RESOLVED", ids, why: "pre-modifier alias" }
        : { ...base, marked, kind: "UNRESOLVED", ids: [], why: "pre-modifier is not a catalog alias" };
    }
    if (DEMONSTRATIVE.has(pl) || (SAMYI.has(pl) && DEMONSTRATIVE.has(pl2))) {
      return { ...base, marked, kind: "ANAPHORIC", ids: [], why: "demonstrative pointer" };
    }
    if (OTHER_DET.has(pl)) return { ...base, marked, kind: "UNRESOLVED", ids: [], why: "other/foreign course" };
    if (GENERIC_DET.has(pl) || VASH.has(pl) || marked) {
      return { ...base, marked: marked || VASH.has(pl), kind: "GENERIC", ids: [], why: "generic/catalog pointer" };
    }
    return { ...base, marked, kind: "ANAPHORIC", ids: [], why: "bare pointer without complement" };
  }
  return { ...base, marked, kind: "UNRESOLVED", ids: [], why: "named complement is not a catalog alias" };
}

const analysisCache = new Map<string, MessageAnalysis>();

function withRequestScopedCaches<T>(evaluate: () => T): T {
  analysisCache.clear();
  resolverCache.clear();
  try {
    return evaluate();
  } finally {
    analysisCache.clear();
    resolverCache.clear();
  }
}

export function analyzeMessage(message: Msg): MessageAnalysis {
  const key = `${message.role}\u0000${message.content}`;
  const cached = analysisCache.get(key);
  if (cached) return cached;
  const text = message.content;
  const { toks, sentences, urls } = tokenize(text);
  const masked = maskText(text, urls);
  const a = { toks, masked };
  const entities: Entity[] = [];
  const consumedUrls = new Set<number>();
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (t.kind !== "W") continue;
    let family: "STRICT" | "EVENT" | null = null;
    const forms = pointerSkeletons(t.low); // CORR5 M2: homoglyph skeletons for mixed-script words only
    if (forms.some((f) => STRICT_RU.test(f) || STRICT_LATIN.has(f))) family = "STRICT";
    else if (forms.some((f) => EVENT_RU.test(f) || EVENT_LATIN.has(f))) family = "EVENT";
    if (!family) continue;
    const e = classifyPointer(a, i, family);
    if (e) {
      entities.push(e);
      for (let k = i + 1; k < Math.min(toks.length, i + 8); k += 1) if (toks[k].kind === "URL") consumedUrls.add(k);
    }
  }
  toks.forEach((t, i) => {
    if (t.kind !== "URL" || consumedUrls.has(i)) return;
    const u = t.url!;
    if (u.official || u.courseLikePath) {
      entities.push({
        index: i, pointer: u.raw, family: "URL", partial: false, marked: false, sentence: t.sentence, start: t.start,
        kind: u.classification === "OFFICIAL_COURSE" ? "RESOLVED" : "UNRESOLVED",
        ids: u.courseId ? [u.courseId] : [], why: `standalone ${u.classification} URL`,
      });
    }
  });
  const analysis: MessageAnalysis = {
    role: message.role, text, masked, toks, sentences, entities,
    aliasIds: resolveIds(masked),
  };
  analysisCache.set(key, analysis);
  return analysis;
}

const specific = (e: Entity) => e.kind !== "GENERIC";
const identified = (e: Entity) => e.kind === "RESOLVED" || e.kind === "UNRESOLVED";

/* ------------------------------------------------------- antecedents --- */

/**
 * Antecedent scope of the latest message (P3-H, report §14): the latest
 * message's sentences before the question region, plus the previous USER
 * messages walked backwards while each walked message contains no identified
 * course entity and itself points back (dependency chain). Assistant text never
 * contributes entities (no authority, and Navigator wording must not trap the
 * user).
 */
export function antecedentEntities(messages: readonly Msg[], latest: MessageAnalysis, qrFrom: number): Entity[] {
  // CORR5 M1: the boundary is a character offset (a detached clause may start inside a sentence).
  const out: Entity[] = latest.entities.filter((e) => e.start < qrFrom && specific(e));
  for (let k = messages.length - 2; k >= 0; k -= 1) {
    if (messages[k].role !== "user") continue;
    const m = analyzeMessage(messages[k]);
    const ents = m.entities.filter(specific);
    out.push(...ents);
    if (ents.some(identified)) break;
    const pointsBack = backReferences(m.toks, 0, m.toks.length).length > 0 || ents.some((e) => e.kind === "ANAPHORIC");
    if (!pointsBack) break;
  }
  return out;
}

/* ----------------------------------------------------------- the gates --- */

/** Closed reason codes of the controlled uncertainty (P5-B's multi-course reason is not implemented). */
export const COURSE_REFERENCE_UNRESOLVED_REASONS = [
  "FOLLOW_UP_REFERENCE_NOT_ESTABLISHED",
  "FOLLOW_UP_UNRESOLVED_COURSE_REFERENCE",
  "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION",
  "CONTENT_OUTSIDE_QUESTION_REFERENCES",
  "CONTENT_ANAPHORIC_REFERENCE_UNRESOLVED",
  "CONTENT_OUTSIDE_QUESTION_SUBJECTS",
  "CONTENT_BACK_REFERENCE_UNRESOLVED",
] as const;

export type UnresolvedReason = (typeof COURSE_REFERENCE_UNRESOLVED_REASONS)[number];

/** v3 — closed meaning/relation predicates that make a standalone «это» a perspective question. */
const PERSPECTIVE_PREDICATE =
  /^(?:знач|означа|связ|соотнос|относит|выгляд|трактов|трактуе|понима|интерпрет|объясня|объясне|описыва|mean|relat|explain|interpret)/u;

export type GateResult =
  | { kind: "ACCEPT"; rule: string }
  | { kind: "UNRESOLVED"; reason: UnresolvedReason; rule: string; referencedCourseIds: CourseId[] }
  | { kind: "ABSENT"; rule: string };

const union = (ents: Entity[]) => [...new Set(ents.flatMap((e) => e.ids))].sort() as CourseId[];

/* CORR5 M1 — question-region locality ------------------------------------ */

/** Character spans strictly inside paired quotation marks («…», “…”, „…“, "…"). */
function quotedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(/«[^«»]*»|“[^“”]*”|„[^„“”]*[“”]|"[^"]*"/gu)) {
    const at = m.index ?? 0;
    spans.push([at + 1, at + m[0].length - 1]);
  }
  return spans;
}

const CLAUSE_SEPARATORS = new Set([":", ",", "—", "–", "-", ")"]);
const NEW_QUESTION_CONJ = set("а", "но", "and", "but");
const INTERROGATIVE = set(
  "что", "как", "какой", "какая", "какое", "какие", "каков", "какова", "почему", "зачем", "где", "когда", "кто",
  "чем", "сколько", "откуда", "куда", "what", "how", "why", "where", "when", "who", "which",
);
const RU_PAST = /^[\p{Script=Cyrillic}]{2,}[аеиоуыэюя]л(?:а|о|и)?(?:сь|ся)?$/u;
const EN_PAST = /^[a-z]{3,}ed$/u;
const FINITE = set("был", "была", "было", "были", "есть", "was", "were", "had", "did");

/**
 * A same-sentence prefix is a separate, completed statement (not the frame of the
 * question) only when ALL hold: (i) the evidence begins immediately after a clause
 * separator; (ii) it opens with «а/но/and/but» + an interrogative; (iii) the prefix
 * contains a finite predicate (closed past-tense/copula forms, never after a
 * preposition). Otherwise the whole sentence stays in the question region (CORR4).
 */
function detachedClauseStart(latest: MessageAnalysis, at: number): number | null {
  const toks = latest.toks;
  const first = toks.findIndex((t) => t.start >= at);
  if (first <= 0 || toks[first].start !== at) return null;
  const sep = toks[first - 1];
  if (!(sep.kind === "P" && CLAUSE_SEPARATORS.has(sep.raw)) || sep.sentence !== toks[first].sentence) return null;
  const w1 = toks[first];
  const w2 = toks[first + 1];
  if (!(w1.kind === "W" && NEW_QUESTION_CONJ.has(w1.low) && w2?.kind === "W" && INTERROGATIVE.has(w2.low))) return null;
  const predicate = toks.some((t, k) => {
    if (k >= first - 1 || t.sentence !== w1.sentence || t.kind !== "W") return false;
    if (!(FINITE.has(t.low) || RU_PAST.test(t.low) || EN_PAST.test(t.low))) return false;
    const p = toks[k - 1];
    return !(p?.kind === "W" && PREPOSITIONS.has(p.low));
  });
  return predicate ? at : null;
}

export type QuestionRegion = { sentences: number[]; from: number };

/**
 * Question region (CORR5): the sentences overlapping the user's OWN occurrences of
 * the evidence — occurrences inside quotation marks are reported speech and are used
 * only when no unquoted occurrence exists; terminal punctuation removed by the
 * kernel does not move the anchor. `from` is the region's first character: the
 * first sentence's start, or a detached clause start inside it.
 */
export function questionRegion(latest: MessageAnalysis, q: string): QuestionRegion {
  const needle = q.replace(/[?!.…]+$/u, "") || q;
  if (needle.length === 0) return { sentences: [], from: 0 };
  const occurrences: number[] = [];
  for (let from = 0; ;) {
    const at = latest.text.indexOf(needle, from);
    if (at === -1) break;
    occurrences.push(at);
    from = at + 1;
  }
  if (occurrences.length === 0) return { sentences: [], from: 0 };
  const quoted = quotedSpans(latest.text);
  const own = occurrences.filter((at) => !quoted.some(([s, e]) => at >= s && at + needle.length <= e));
  const chosen = own.length > 0 ? own : occurrences;
  const hit = new Set<number>();
  for (const at of chosen) {
    latest.sentences.forEach(([s, e], idx) => {
      if (s < at + needle.length && e > at) hit.add(idx);
    });
  }
  const sentences = [...hit].sort((x, y) => x - y);
  const firstStart = latest.sentences[sentences[0]][0];
  const detached = detachedClauseStart(latest, chosen[0]);
  return { sentences, from: detached ?? firstStart };
}

/**
 * Content gate — runs only after the router's unchanged closed-schema, F-1,
 * routability, boolean and verbatim-evidence checks, so it can only turn their
 * ACCEPT into UNRESOLVED.
 */
export function contentGate(messages: readonly Msg[], courseId: string, q: string): GateResult {
  return withRequestScopedCaches(() => evaluateContentGate(messages, courseId, q));
}

function evaluateContentGate(messages: readonly Msg[], courseId: string, q: string): GateResult {
  const latest = analyzeMessage(messages.at(-1)!);
  const region = questionRegion(latest, q);
  const qr = region.sentences;
  if (qr.length === 0) return { kind: "ACCEPT", rule: "NO_REGION(verbatim guard owns this)" };
  const inQr = (x: { sentence: number; start: number }) => qr.includes(x.sentence) && x.start >= region.from;
  const qrEnts = latest.entities.filter((e) => inQr(e) && specific(e));
  const qrIds = union(qrEnts.filter((e) => e.kind === "RESOLVED"));
  const c = courseId as CourseId;
  const qrMasked = qr
    .map((s) => latest.masked.slice(Math.max(latest.sentences[s][0], region.from), latest.sentences[s][1]))
    .join(" ");
  const qrAliasIds = resolveIds(qrMasked);

  if (qrEnts.some((e) => e.kind === "UNRESOLVED")) {
    return { kind: "UNRESOLVED", reason: "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", rule: "C1", referencedCourseIds: qrIds };
  }
  if (qrEnts.some((e) => e.kind === "ANAPHORIC")) {
    const ant = antecedentEntities(messages, latest, region.from).filter((e) => e.kind !== "ANAPHORIC");
    if (ant.length === 0 || ant.some((e) => e.kind === "UNRESOLVED")) {
      return { kind: "UNRESOLVED", reason: "CONTENT_ANAPHORIC_REFERENCE_UNRESOLVED", rule: "C2", referencedCourseIds: qrIds };
    }
    const allowed = [...new Set([...qrIds, ...union(ant)])];
    return allowed.includes(c)
      ? { kind: "ACCEPT", rule: "C2-member" }
      : { kind: "UNRESOLVED", reason: "CONTENT_OUTSIDE_QUESTION_REFERENCES", rule: "C2", referencedCourseIds: allowed.sort() as CourseId[] };
  }
  if (qrIds.length > 0) {
    // G4 (CORR5 M3): every course reference in the question is resolved and c is one of them.
    // A course alias outside those references is a topic, not an alternative course identity.
    return qrIds.includes(c)
      ? { kind: "ACCEPT", rule: "C3-member" }
      : { kind: "UNRESOLVED", reason: "CONTENT_OUTSIDE_QUESTION_REFERENCES", rule: "C3", referencedCourseIds: qrIds };
  }

  // No course entity in the question region: a subject question.
  const qrToks = latest.toks.map((t, i) => [t, i] as const).filter(([t]) => inQr(t));
  const qrFrom = qrToks[0]?.[1] ?? 0;
  const qrTo = (qrToks.at(-1)?.[1] ?? -1) + 1;
  const cAnchored = () => qrToks.some(([t]) => t.kind === "W" && tokenAnchors(t.low, c));
  if (qrAliasIds.length >= 2 && !qrAliasIds.includes(c) && !cAnchored()) {
    return { kind: "UNRESOLVED", reason: "CONTENT_OUTSIDE_QUESTION_SUBJECTS", rule: "C4", referencedCourseIds: [...qrAliasIds].sort() as CourseId[] };
  }
  const brs = backReferences(latest.toks, qrFrom, qrTo);
  if (brs.length === 0) return { kind: "ACCEPT", rule: "C5-independent" };
  const ant = antecedentEntities(messages, latest, region.from).filter((e) => e.kind !== "ANAPHORIC");
  if (ant.length === 0) return { kind: "ACCEPT", rule: "C6-no-course-antecedent" };
  // CORR5 M3: an unresolved antecedent course cannot be erased by a subject anchor/alias.
  const unresolvedAntecedent = ant.some((e) => e.kind === "UNRESOLVED");
  const locative = (b: BackRef) => LOCATIVE.has(latest.toks[b.index].low);
  const prepositional = (b: BackRef) => {
    const p = latest.toks[b.index - 1];
    return p?.kind === "W" && PREPOSITIONS.has(p.low);
  };
  const barePronoun = (b: BackRef) => !locative(b) && !prepositional(b) && !DEMO_BR.has(latest.toks[b.index].low);
  const anyAnchorBefore = (b: BackRef) => {
    if (locative(b)) return false; // CORR5 M3: «там/тут/здесь» point at a place/course, never at a subject
    if (unresolvedAntecedent && !barePronoun(b)) return false; // CORR5 M3: «в нём», «с этим» keep the unresolved course
    const before = latest.toks.slice(qrFrom, b.index);
    if (before.some((t) => t.kind === "W" && tokenAnchors(t.low))) return true;
    const prefix = latest.masked.slice(latest.toks[qrFrom].start, latest.toks[b.index].start);
    return resolveIds(prefix).length > 0;
  };
  const nonIntra = brs.filter((b) => !anyAnchorBefore(b));
  if (nonIntra.length === 0) return { kind: "ACCEPT", rule: "C7-intra-sentence-reference" };
  // CORR5 M3: a named subject answers only a propositional «это» back-reference, never a container
  // reference («там говорят о Маслоу»), and never over an unresolved antecedent course.
  if (!unresolvedAntecedent && nonIntra.every((b) => b.kind === "ETO") && qrAliasIds.includes(c)) {
    return { kind: "ACCEPT", rule: "C8-question-names-subject" };
  }
  if (ant.every((e) => e.kind === "RESOLVED") && union(ant).includes(c)) return { kind: "ACCEPT", rule: "C9-antecedent-member" };
  const perspectiveFrame = () =>
    qrToks.some(([t]) => t.kind === "W" && PERSPECTIVE_PREDICATE.test(t.low)) ||
    /с\s+точки\s+зрения|в\s+терминах|с\s+позиции|from\s+the\s+(?:point\s+of\s+view|perspective)/iu.test(qrMasked);
  if (!unresolvedAntecedent && nonIntra.every((b) => b.kind === "ETO") && cAnchored() && perspectiveFrame()) {
    return { kind: "ACCEPT", rule: "C10-perspective-anchor" };
  }
  return { kind: "UNRESOLVED", reason: "CONTENT_BACK_REFERENCE_UNRESOLVED", rule: "C11", referencedCourseIds: union(ant) };
}

/**
 * Follow-up gate — called ONLY when the unchanged literal predicate failed.
 * P1-0: never accepts. Returns UNRESOLVED when the course is mentioned in user
 * text or the latest message carries any course reference; otherwise ABSENT
 * (the unchanged technical rejection).
 */
export function followUpWithoutLiteral(messages: readonly Msg[], courseId: string): GateResult {
  return withRequestScopedCaches(() => evaluateFollowUpWithoutLiteral(messages, courseId));
}

function evaluateFollowUpWithoutLiteral(messages: readonly Msg[], courseId: string): GateResult {
  const c = courseId as CourseId;
  const users = messages.filter((m) => m.role === "user").map(analyzeMessage);
  const latest = analyzeMessage(messages.at(-1)!);
  const mentioned = users.some((m) => m.aliasIds.includes(c) || m.entities.some((e) => e.ids.includes(c)));
  if (mentioned) {
    return { kind: "UNRESOLVED", reason: "FOLLOW_UP_REFERENCE_NOT_ESTABLISHED", rule: "F1", referencedCourseIds: [c] };
  }
  // v4: only a NAMED reference (resolved or unresolved) in the latest message turns the
  // unchanged "absent" rejection into a clarification; demonstrative/generic pointers refer
  // back to existing context and keep the anti-hallucination rejection byte-identical.
  const latestRefs = latest.entities.filter(identified);
  if (latestRefs.length > 0) {
    return { kind: "UNRESOLVED", reason: "FOLLOW_UP_UNRESOLVED_COURSE_REFERENCE", rule: "F2", referencedCourseIds: union(latestRefs) };
  }
  return { kind: "ABSENT", rule: "F3-absent" };
}

/**
 * PREVIEW-LIVE-DEEPSEEK-VERIFICATION-1.MAJOR-REMEDIATION-1 (V-MAJ-01) — reference
 * establishment for a COURSE_FOLLOW_UP proposal that has no literal title/URL
 * authority. It separates an explicit current-turn course reference from an
 * anaphoric one; it never names a course of its own and never widens an identity:
 *   - CURRENT_TURN: every specific course entity of the latest user message is
 *     RESOLVED through the governed resolver, and those entities and the latest
 *     message's aliases name exactly the proposed course (two or more courses, an
 *     unresolved entity or a mixed anaphoric reference keep the unchanged gate);
 *   - ANTECEDENT: the latest message names no course (no entity, no alias) but
 *     points back, and its antecedent scope — the same `antecedentEntities`
 *     chain the content gate uses — is RESOLVED to exactly the proposed course.
 * Anything else is null and the caller keeps the unchanged F1/F2/F3 outcome.
 */
export type EstablishedCourseReference = "CURRENT_TURN" | "ANTECEDENT";

export function establishedCourseReference(
  messages: readonly Msg[],
  courseId: string,
): EstablishedCourseReference | null {
  return withRequestScopedCaches(() => evaluateEstablishedCourseReference(messages, courseId));
}

function evaluateEstablishedCourseReference(
  messages: readonly Msg[],
  courseId: string,
): EstablishedCourseReference | null {
  const last = messages.at(-1);
  if (last === undefined || last.role !== "user") return null;
  const c = courseId as CourseId;
  const latest = analyzeMessage(last);
  const ents = latest.entities.filter(specific);
  if (ents.some(identified)) {
    if (!ents.every((e) => e.kind === "RESOLVED")) return null;
    if (!latest.aliasIds.every((id) => id === c)) return null;
    const ids = union(ents);
    return ids.length === 1 && ids[0] === c ? "CURRENT_TURN" : null;
  }
  if (latest.aliasIds.length > 0) return null;
  const pointsBack =
    ents.some((e) => e.kind === "ANAPHORIC") || backReferences(latest.toks, 0, latest.toks.length).length > 0;
  if (!pointsBack) return null;
  const ant = antecedentEntities(messages, latest, 0).filter((e) => e.kind !== "ANAPHORIC");
  if (ant.length === 0 || !ant.every((e) => e.kind === "RESOLVED")) return null;
  const ids = union(ant);
  return ids.length === 1 && ids[0] === c ? "ANTECEDENT" : null;
}

/**
 * MAJOR-REMEDIATION-1.CORR2 (F-01) — the user sentences that carry the course
 * entities establishing `courseId` under `establishedCourseReference`: the
 * latest message's sentences for CURRENT_TURN, the antecedent user message's
 * sentences for ANTECEDENT. Null exactly when the reference is not established.
 * `question` is structural only: the sentence contains «?» or opens (after at
 * most one «а/но/и») with a word of the closed interrogative class above.
 * The router uses these sentences as the commercial-applicability witness;
 * this module still decides no act and grants no commercial authority.
 */
export type EstablishingSentence = { text: string; question: boolean };

export function establishingSentences(
  messages: readonly Msg[],
  courseId: string,
): EstablishingSentence[] | null {
  return withRequestScopedCaches(() => {
    const reference = evaluateEstablishedCourseReference(messages, courseId);
    if (reference === null) return null;
    const c = courseId as CourseId;
    const latest = analyzeMessage(messages.at(-1)!);
    const sources =
      reference === "CURRENT_TURN"
        ? [latest]
        : messages.slice(0, -1).filter((m) => m.role === "user").map(analyzeMessage);
    const naming =
      reference === "CURRENT_TURN"
        ? latest.entities.filter((e) => e.kind === "RESOLVED" && e.ids.includes(c))
        : antecedentEntities(messages, latest, 0).filter((e) => e.kind === "RESOLVED" && e.ids.includes(c));
    const out: EstablishingSentence[] = [];
    for (const m of sources) {
      const sentences = [...new Set(naming.filter((e) => m.entities.includes(e)).map((e) => e.sentence))];
      for (const s of sentences) {
        const toks = m.toks.filter((t) => t.sentence === s);
        const words = toks.filter((t) => t.kind === "W");
        const lead = words[0] !== undefined && (NEW_QUESTION_CONJ.has(words[0].low) || words[0].low === "и") ? 1 : 0;
        out.push({
          text: m.text.slice(m.sentences[s][0], m.sentences[s][1]),
          question:
            toks.some((t) => t.kind === "P" && t.raw === "?") ||
            (words[lead] !== undefined && INTERROGATIVE.has(words[lead].low)),
        });
      }
    }
    return out;
  });
}
