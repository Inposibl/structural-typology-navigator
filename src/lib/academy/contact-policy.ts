import type {
  AcademyContactCard,
  ConversationProfile,
} from "../chat-contract.ts";

export const ACADEMY_CONTACT_POLICY = {
  contactsPage: "https://structural-typology.academy/contacts",
  fastTelegramHandle: "@AST_rulang",
  fastTelegramUrl: "https://t.me/AST_rulang",
  manager: {
    name: "Алексей Лебедев",
    role: "Менеджер Академии",
    availability: "09:00–19:00 МСК, Пн–Пт",
    imageUrl: "/academy/alexey-lebedev.png",
    telegramHandle: "@LebedevOo",
    telegramUrl: "https://t.me/LebedevOo",
    phoneLabel: "+7 999 260-02-01",
    phoneHref: "tel:+79992600201",
  },
} as const;

export type AcademyContactIntent =
  | "FAST_TEXT"
  | "LIVE"
  | "GENERAL";

/**
 * Contact actions and channels are written as intent-bearing forms, never as
 * raw stems.
 *
 * Russian stems are not safe here, because they also cover ordinary course
 * language: "связ" covers "курс связан с психологией" and "связь между темами",
 * "позвон" covers "позвонок" and "позвоночник", "звон" covers "звонкий", and
 * "напис" covers "написан" and "написание". A relational or semantic sentence
 * about course content must never be read as a request for the Academy contact
 * surface (independent Z.ai IV1, D-IV1-F1).
 *
 * The three classes are kept apart here, because only one of them is contact
 * intent on its own: an action or a channel asks *how* to reach the Academy, a
 * role noun only says *who* could be reached, and a question verb is ordinary
 * user language. A role noun or a question verb must therefore never enter the
 * channel class (independent Z.ai IV1, D-IV1-F2/M1).
 */
const CONNECT_FORMS =
  "связаться|свяжитесь|свяжись|свяжусь|свяжемся|связываться|связывайтесь|связался|связалась|связались";
const SPOKEN_FORMS =
  "позвонить|позвоните|позвони|позвоню|позвонил[а-яё]*|созвон[а-яё]*|звонок|звонка|звонку|звонки|звонков|телефон";
const WRITTEN_FORMS =
  "телеграм|telegram|написать|напишите|напиши|напишу|напишет|напишем|написал|написала|написали";
/**
 * The contact surface named as a noun. The plural "контакты" is the surface
 * itself; the singular "контакт" is relational prose and is admitted only behind
 * a request lead (see CONTACT_NOUN_REQUEST_PATTERN).
 */
const CONTACT_NOUN_FORMS = "контакты|контактов|контактами";

/**
 * Canonical manager-name stems, derived from the contact authority in exactly
 * one place. The last character is dropped so ordinary case endings match.
 */
const MANAGER_NAME_FORMS = ACADEMY_CONTACT_POLICY.manager.name
  .toLowerCase()
  .split(/\s+/u)
  .filter(Boolean)
  .map((token) => token.slice(0, -1))
  .join("|");

/**
 * The human addressees a question can be directed to: the manager, a curator, or
 * the manager by name. This is the directed human-contact structure of a help
 * request. The support noun is deliberately absent, because it is ordinary course
 * language as well ("поддержка мотивации", "поддержка преподавателя"), and so is
 * "Академия": writing to the Academy is reached through a channel ("Куда написать
 * в Академию?", "Контакты поддержки Академии"), never through a bare question
 * verb. The "человек" of the Package-B handoff is absent too — a human request
 * belongs to that lane, not to this one.
 *
 * The direction matters as well: a question *about* a person or a role ("Можно
 * спросить про нашего куратора?", "Можно задать вопрос про работу менеджера?")
 * asks about the Academy's staff rather than for them. That frame is carried by a
 * preposition governing the candidate's own noun phrase, so the preposition
 * stands away from the candidate token and cannot be read by a lookbehind that
 * merely touches it (independent Z.ai IV1 CORR3, M-1).
 *
 * Direction is a relation, not a vocabulary: see readAddresseeRelation.
 */
const CONTACT_ADDRESSEE_FORMS = "менеджер|куратор";

/**
 * Candidate addressees: the manager, a curator, or the manager by name. This
 * pattern finds candidates only, because the direction decides whether one is an
 * addressee at all — see isAboutFramedAddressee.
 *
 * Iterated with matchAll only, so the lastIndex of this shared pattern stays at
 * zero and no candidate is skipped.
 */
const CONTACT_ADDRESSEE_CANDIDATE_PATTERN = new RegExp(
  String.raw`(?<![а-яё])(?:${CONTACT_ADDRESSEE_FORMS}|${MANAGER_NAME_FORMS})[а-яё]*(?![а-яё])`,
  "giu",
);

/**
 * The prepositions that open an about-frame. They are read as whole tokens, never
 * as character sequences: the "о" inside "нашего" and the "про" inside "просто"
 * are letters, not prepositions.
 */
const CONTACT_ABOUT_PREPOSITIONS: ReadonlySet<string> = new Set([
  "про",
  "о",
  "об",
]);

/** The explicit directed relation of Russian: "спросить у менеджера". */
const CONTACT_DIRECTED_PREPOSITION = "у";

/**
 * The prepositions that take the dative themselves. They matter because they are
 * the other explanation for a dative form: in "вопрос о требованиях к менеджеру"
 * the manager is dative because "к" governs them, and what is asked about is the
 * requirements towards them — no question is given to anyone. The same holds for
 * "по": "вопрос по менеджеру" is a question on that subject, not to that person.
 *
 * A governor of this class therefore accounts for the form, and the recipient
 * fallback below must not claim it (independent Orchestrator finding D-R3-F1: a
 * dative form was read as a recipient although "к" governed it).
 */
const CONTACT_NON_RECIPIENT_PREPOSITIONS: ReadonlySet<string> = new Set([
  "к",
  "ко",
  "по",
]);

/**
 * The prepositions that can govern a candidate addressee at all. The nearest one
 * in front of the candidate is the head of its own noun phrase, so this set is
 * scanned from the candidate backwards and the first hit decides — the ones
 * further away govern other noun phrases.
 */
const CONTACT_RELATION_PREPOSITIONS: ReadonlySet<string> = new Set([
  ...CONTACT_ABOUT_PREPOSITIONS,
  ...CONTACT_NON_RECIPIENT_PREPOSITIONS,
  CONTACT_DIRECTED_PREPOSITION,
]);

/**
 * The second directed relation: the dative recipient of a question ("задать
 * вопрос менеджеру", "задать вопрос Алексею"). These are exact forms, never
 * stems, because the form *is* the relation here: the genitive of a topic
 * ("работа менеджера"), the prepositional of an about-object ("о менеджере") and
 * the dative plural of a class ("Какой курс подходит менеджерам?") are different
 * words, and none of them is the recipient of a question. A form that is not
 * listed is not guessed — it is left to the classifier (independent Orchestrator
 * finding D-R2-F1).
 *
 * A listed form is a recipient only when nothing else accounts for it: see
 * CONTACT_NON_RECIPIENT_PREPOSITIONS and readAddresseeRelation.
 *
 * The manager's own forms are derived from the canonical contact authority, so
 * the detector cannot drift from the policy it serves: a name ending in "й" takes
 * "ю" ("Алексей" → "Алексею"), one ending in a consonant takes "у" ("Лебедев" →
 * "Лебедеву").
 */
const CONTACT_ADDRESSEE_DATIVE_FORMS: ReadonlySet<string> = new Set([
  "менеджеру",
  "куратору",
  ...ACADEMY_CONTACT_POLICY.manager.name
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) =>
      token.endsWith("й") ? `${token.slice(0, -1)}ю` : `${token}у`,
    ),
]);

/**
 * A relation is clause-local: a preposition in another clause governs another
 * noun phrase, and a question in another clause is another request. The clause is
 * bounded structurally — by clause punctuation — and never by a word count,
 * because a count can only cut a valid frame short once its object is described
 * at length (independent Orchestrator finding D-R1-F1: a frame eleven words long
 * was read as directed contact).
 */
const CONTACT_CLAUSE_BOUNDARIES = ",.;:!?…\n—–";

/**
 * The question class. A question verb is not a channel on its own — it asks for
 * content ("Можно спросить, как устроен курс?", "Хочу задать вопрос о Маслоу").
 * It becomes a directed request for a human only together with a contact
 * addressee that its own clause relates it to: "Где можно задать вопрос менеджеру
 * Академии?".
 */
const QUESTION_VERB_PATTERN =
  /(?<![а-яё])(?:задать\s+вопрос|спросить)(?![а-яё])/iu;
/**
 * The question as a thing that can be given to someone. A dative recipient is
 * read only from this construction, because the dative alone is not a request:
 * "Можно спросить, что менеджеру нужно?" gives the manager no question.
 */
const QUESTION_REQUEST_PATTERN = /(?<![а-яё])задать\s+вопрос(?![а-яё])/iu;

const PERSON_DISCUSSION_PATTERN =
  /(?:(?:с\s+кем|к\s+кому|у\s+кого|кому).{0,80}(?:обсуд|поговор|обрат|задать|спрос)|(?:обсуд|поговор|обрат|задать|спрос).{0,80}(?:с\s+кем|к\s+кому|у\s+кого|кому))/iu;
const ACADEMY_CONTEXT_PATTERN =
  /(?:академ|курс|обучен|программ)/iu;

/**
 * Every way of asking for contact, as one capture pattern: the channel class
 * only. A role noun ("Курс для менеджеров") and a bare question verb ("Можно
 * спросить, как устроен курс?") are deliberately absent, so neither can reach
 * the contact lane without a channel or a directed target of its own.
 */
const CONTACT_ACTION_PATTERN = new RegExp(
  String.raw`(?<![а-яё])(?:${CONNECT_FORMS}|${SPOKEN_FORMS}|${WRITTEN_FORMS}|${CONTACT_NOUN_FORMS})(?![а-яё])`,
  "iu",
);

/**
 * The live-contact class is the manager himself: naming the manager (or his
 * canonical first name) asks for the manager's own channels, so the answer
 * carries his card instead of the Academy's fast written chat.
 */
const LIVE_PATTERN = new RegExp(
  String.raw`(?:вживую|жив(?:ое|ого)\s+общен|поговор|${SPOKEN_FORMS}|менеджер|куратор|человек|(?<![а-яё])(?:${MANAGER_NAME_FORMS})[а-яё]*(?![а-яё])|(?:с\s+кем|к\s+кому|у\s+кого|кому).{0,80}(?:обсуд|поговор|обрат|спрос))`,
  "iu",
);
const FAST_PATTERN = new RegExp(
  String.raw`(?:быстр|чат|${WRITTEN_FORMS}|письменн|задать\s+вопрос)`,
  "iu",
);

/**
 * The manager is named explicitly. Cyrillic letter lookarounds are used instead
 * of \b, which is ASCII-only and never matches between Cyrillic letters.
 */
const MANAGER_NAME_PATTERN = new RegExp(
  String.raw`(?<![а-яё])(?:${MANAGER_NAME_FORMS})[а-яё]*(?![а-яё])`,
  "iu",
);

const MANAGER_ROLE_PATTERN =
  /(?<![а-яё])(?:менеджер|куратор)[а-яё]*(?![а-яё])/iu;

/** A photo of the manager is part of the same contact surface (A27). */
const PHOTO_TOPIC_PATTERN =
  /(?<![а-яё])(?:фото|снимок|снимки|карточк|аватар)[а-яё]*(?![а-яё])/iu;

/**
 * A directed request for "контакты" themselves: "Дайте контакты Академии."
 * The singular noun is relational in ordinary prose ("наладить контакт с
 * людьми"), so it counts only behind one of these request leads.
 */
const CONTACT_NOUN_REQUEST_PATTERN =
  /(?<![а-яё])(?:дай|дайте|нужн|нужны|какие|какой|каковы|подскажи|подскажите)(?![а-яё])[^.!?,;]{0,24}?(?<![а-яё])контакт[а-яё]*(?![а-яё])/iu;

/**
 * Deterministic contact detection for the pre-classification shortcut (A10).
 *
 * Only an utterance that names the Academy or the Academy manager, together
 * with an explicit channel or a directed request for contacts, is accepted.
 * Ordinary course prose that merely mentions people or "контакт" therefore
 * keeps its normal educational lane, and so does a course sentence that only
 * names a role ("Курс для менеджеров", "Роль куратора в обучении") or only asks
 * an ordinary question ("Можно спросить, как устроен курс?"). A photo follow-up
 * is accepted when it names the manager, or when the structured state says the
 * conversation already reached the contact surface, so no assistant prose is
 * ever scanned.
 */
export function detectDeterministicAcademyContactIntent(
  query: string,
  options: { hasContactContext?: boolean } = {},
): AcademyContactIntent | null {
  const topic = analyzeContactTopic(query);
  const contactContext = options.hasContactContext === true;

  if (topic.directed) {
    const mentionsAcademy = ACADEMY_CONTEXT_PATTERN.test(query);
    const mentionsManager =
      MANAGER_NAME_PATTERN.test(query) || MANAGER_ROLE_PATTERN.test(query);

    // "Как связаться с поддержкой Google?" names neither, so it keeps its
    // ordinary lane instead of being captured as Academy contact.
    if (!mentionsAcademy && !mentionsManager) {
      return null;
    }

    return classifyContactIntent(query);
  }

  // A bare photo follow-up continues the contact surface the structured state
  // already recorded; without that context it is not deterministic.
  if (topic.photo && (topic.managerNamed || contactContext)) {
    return classifyContactIntent(query);
  }

  return null;
}

type AcademyContactTopic = {
  /** The utterance is about the Academy contact surface at all. */
  detected: boolean;
  /**
   * The utterance asks for contact directly — an explicit channel, a directed
   * request for contacts, a question standing in a directed relation to a contact
   * addressee, or the manager's photo. Narrative prose that
   * merely mentions contact ("в контакте с людьми") is not directed, and neither
   * is a role noun or a question verb:
   * "Курс для менеджеров" names a target and "Можно спросить, как устроен курс?"
   * asks for content.
   */
  directed: boolean;
  /** The utterance asks about a photo, i.e. about this contact surface. */
  photo: boolean;
  /** The canonical manager is named explicitly. */
  managerNamed: boolean;
};

function analyzeContactTopic(query: string): AcademyContactTopic {
  const mentionsManagerName = MANAGER_NAME_PATTERN.test(query);
  const mentionsManagerRole = MANAGER_ROLE_PATTERN.test(query);
  const mentionsPhoto = PHOTO_TOPIC_PATTERN.test(query);
  const mentionsChannel =
    CONTACT_ACTION_PATTERN.test(query) ||
    CONTACT_NOUN_REQUEST_PATTERN.test(query);
  // A question is a request for a human only when it is addressed to one.
  const asksContactAddressee = hasDirectedContactAddressee(query);

  // A manager-specific follow-up ("а фото Алексея?", "Дайте Telegram и телефон
  // Алексея.") is unambiguous even with no course context in the conversation.
  const managerFollowUp =
    (mentionsPhoto && (mentionsManagerName || mentionsManagerRole)) ||
    (mentionsManagerName && mentionsChannel);

  return {
    detected:
      mentionsChannel ||
      asksContactAddressee ||
      PERSON_DISCUSSION_PATTERN.test(query) ||
      managerFollowUp,
    directed:
      mentionsChannel ||
      asksContactAddressee ||
      (mentionsPhoto && (mentionsManagerName || mentionsManagerRole)),
    photo: mentionsPhoto,
    managerNamed: mentionsManagerName,
  };
}

/**
 * How a candidate person or role relates to the question in its own clause:
 *
 * - DIRECTED — the question is asked *of* them ("спросить у менеджера", "задать
 *   вопрос куратору"). Eligible for deterministic contact.
 * - ABOUT — they are what the question is *about* ("спросить про работу
 *   менеджера", "о менеджере можно спросить?"). Not contact.
 * - NON_RECIPIENT_GOVERNED — another preposition governs them, so they stand
 *   inside a phrase of its own ("о требованиях к менеджеру"). Not contact.
 * - UNKNOWN — no relation this detector can establish safely. Not contact
 *   either, but for the opposite reason: it is left to the classifier.
 */
type AddresseeRelation =
  | "DIRECTED"
  | "ABOUT"
  | "NON_RECIPIENT_GOVERNED"
  | "UNKNOWN";

/** The clause a position stands in: punctuation bounds it on both sides. */
function readClauseAround(
  query: string,
  position: number,
): { text: string; start: number } {
  let start = 0;
  let end = query.length;

  for (let at = position - 1; at >= 0; at -= 1) {
    if (CONTACT_CLAUSE_BOUNDARIES.includes(query[at] ?? "")) {
      start = at + 1;
      break;
    }
  }

  for (let at = position; at < query.length; at += 1) {
    if (CONTACT_CLAUSE_BOUNDARIES.includes(query[at] ?? "")) {
      end = at;
      break;
    }
  }

  return { text: query.slice(start, end), start };
}

/**
 * The nearest preposition in front of a candidate, together with the words that
 * stand between the two. "про курс у менеджера" reaches "менеджера" with "у" and
 * "курс" with "про"; "у вас про менеджера" is the mirror image of the same fact.
 *
 * The words in between matter for one question only — whether that preposition
 * still reaches this candidate at all: see reachesCandidate.
 */
function readGoverningPhrase(
  prefix: string,
): { preposition: string; between: readonly string[] } | null {
  const words = prefix.toLowerCase().match(/[а-яё]+/giu) ?? [];

  for (let at = words.length - 1; at >= 0; at -= 1) {
    const word = words[at] ?? "";
    if (CONTACT_RELATION_PREPOSITIONS.has(word)) {
      return { preposition: word, between: words.slice(at + 1) };
    }
  }

  return null;
}

/**
 * The endings of an agreeing modifier — an adjective or a pronoun that belongs to
 * a noun phrase rather than heading one: "к нашему новому менеджеру", "к самому
 * Алексею", "у нашего нового менеджера". Both directed cases are listed together,
 * because a modifier is a modifier in either of them.
 */
const CONTACT_AGREEING_MODIFIER_ENDINGS = [
  "ому",
  "ему",
  "ого",
  "его",
] as const;
/**
 * A comparative ("более", "менее") ends like a head but heads nothing, so it is
 * excluded from both head classes: "у более опытного менеджера" still asks that
 * manager.
 */
const CONTACT_COMPARATIVE_ENDING = "ее";
/**
 * The dative endings of a noun that can head a phrase of its own: "по оплате",
 * "по программе", "по расписанию", "по требованиям".
 */
const CONTACT_DATIVE_HEAD_ENDINGS = ["ам", "ям", "е", "и", "у", "ю"] as const;
/**
 * The genitive endings of a noun that can head a phrase of its own: "у коллеги",
 * "у преподавателя", "у директора" — and the neuter noun that opens a second
 * phrase after it ("мнение менеджера").
 */
const CONTACT_GENITIVE_HEAD_ENDINGS = [
  "ов",
  "ев",
  "а",
  "я",
  "и",
  "ы",
  "е",
] as const;

/** Whether a word can head a noun phrase of its own in the governor's case. */
function isPhraseHead(word: string, endings: readonly string[]): boolean {
  if (
    CONTACT_AGREEING_MODIFIER_ENDINGS.some((ending) => word.endsWith(ending))
  ) {
    return false;
  }

  if (word.endsWith(CONTACT_COMPARATIVE_ENDING)) {
    return false;
  }

  return endings.some((ending) => word.endsWith(ending));
}

/**
 * Whether a preposition still reaches the candidate, or has already been
 * satisfied by a noun phrase of its own.
 *
 * A preposition takes one noun phrase, in one case. In "по требованиям к
 * менеджеру" nothing stands between "к" and the manager, so "к" reaches them and
 * the manager is part of the topic; in "по оплате менеджеру" the payment has
 * already satisfied "по", so the manager is the free dative the question is given
 * to. The directed "у" is no different: "у менеджера" asks the manager, while in
 * "у коллеги мнение менеджера" the colleague has taken the "у" phrase and the
 * manager is only whose opinion is meant (independent Codex Sol finding D-R4-F1).
 *
 * Only the agreeing modifiers of the phrase may stand in between; an intervening
 * head ends it. The case decides which endings head a phrase, so each governor is
 * measured in its own: "у" takes the genitive, "к"/"ко"/"по" the dative.
 *
 * A word that is neither a modifier nor a head — an adverb, a particle — leaves
 * the preposition in place ("у просто отличного куратора", "к очень опытному
 * менеджеру"). That is the conservative reading in both directions: it keeps a
 * topic governor governing, and it keeps a directed phrase directed only where it
 * was already unbroken.
 */
function reachesCandidate(governing: {
  preposition: string;
  between: readonly string[];
}): boolean {
  const endings =
    governing.preposition === CONTACT_DIRECTED_PREPOSITION
      ? CONTACT_GENITIVE_HEAD_ENDINGS
      : CONTACT_DATIVE_HEAD_ENDINGS;

  return !governing.between.some((word) => isPhraseHead(word, endings));
}

/**
 * The relation between a question and one candidate addressee.
 *
 * TOPIC and ADDRESSEE are independent dimensions of the same question: "Хочу
 * спросить про курс у менеджера" says both what is asked about and whom it is
 * asked of. An about-preposition standing somewhere between the verb and the
 * candidate is therefore not a veto — only the preposition that governs the
 * candidate itself decides, and a dative recipient carries its relation in its
 * own form, wherever the topic stands (independent Orchestrator finding
 * D-R2-F1).
 *
 * Both signals are read inside the candidate's own clause, so a question in one
 * clause cannot direct a person named in another ("Хочу спросить про курс.
 * Можно задать вопрос менеджеру?" is directed by its second clause alone), and
 * the clause is read in full however long the description of the topic runs.
 * Anything this grammar cannot place is UNKNOWN rather than guessed.
 *
 * An explicit governor is read first and it wins: a form only says what a word
 * *can* be, while a governor says what it *is* here. A dative that "к" or "по"
 * reaches is already accounted for ("вопрос о требованиях к менеджеру") and the
 * recipient fallback must not claim it back; a dative with no such governor is
 * the recipient of the question that its clause gives ("вопрос про оплату
 * менеджеру"), because "про", "о" and "об" cannot govern a dative at all
 * (independent Orchestrator finding D-R3-F1).
 *
 * Reaching is the whole question, though, and a preposition that already has a
 * noun phrase does not reach past it: in "вопрос по оплате менеджеру" the topic
 * is the payment and the manager is still the recipient, while in "вопрос по
 * требованиям к менеджеру" the manager is inside the topic. A topic preposition
 * standing earlier in the clause is therefore not a veto either — only a governor
 * that actually reaches this candidate is.
 */
function readAddresseeRelation(
  query: string,
  candidate: RegExpMatchArray,
): AddresseeRelation {
  const position = candidate.index ?? 0;
  const clause = readClauseAround(query, position);

  // Direction is a property of a question. Without one in this clause, the
  // candidate is merely named ("Курс для менеджеров", "У меня вопрос о нашем
  // кураторе"), and naming is not asking.
  if (!QUESTION_VERB_PATTERN.test(clause.text)) {
    return "UNKNOWN";
  }

  const governing = readGoverningPhrase(
    clause.text.slice(0, position - clause.start),
  );

  if (
    governing !== null &&
    CONTACT_NON_RECIPIENT_PREPOSITIONS.has(governing.preposition) &&
    reachesCandidate(governing)
  ) {
    return "NON_RECIPIENT_GOVERNED";
  }

  if (
    CONTACT_ADDRESSEE_DATIVE_FORMS.has(candidate[0].toLowerCase()) &&
    QUESTION_REQUEST_PATTERN.test(clause.text)
  ) {
    return "DIRECTED";
  }

  if (
    governing?.preposition === CONTACT_DIRECTED_PREPOSITION &&
    reachesCandidate(governing)
  ) {
    return "DIRECTED";
  }

  if (
    governing !== null &&
    CONTACT_ABOUT_PREPOSITIONS.has(governing.preposition)
  ) {
    return "ABOUT";
  }

  return "UNKNOWN";
}

/**
 * Whether the question is addressed to a human at all. Every candidate is
 * inspected, because one sentence can name several people in different relations:
 * "Можно спросить у менеджера про Алексея?" is addressed to the manager and only
 * talks about the other one, and one directed relation is enough.
 */
function hasDirectedContactAddressee(query: string): boolean {
  for (const candidate of query.matchAll(CONTACT_ADDRESSEE_CANDIDATE_PATTERN)) {
    if (readAddresseeRelation(query, candidate) === "DIRECTED") {
      return true;
    }
  }

  return false;
}

function classifyContactIntent(query: string): AcademyContactIntent {
  if (LIVE_PATTERN.test(query)) {
    return "LIVE";
  }

  if (FAST_PATTERN.test(query)) {
    return "FAST_TEXT";
  }

  return "GENERAL";
}

export function detectAcademyContactIntent(
  query: string,
  options: { hasCourseContext?: boolean } = {},
): AcademyContactIntent | null {
  const topic = analyzeContactTopic(query);

  if (!topic.detected) {
    return null;
  }

  if (
    !options.hasCourseContext &&
    !ACADEMY_CONTEXT_PATTERN.test(query)
  ) {
    return null;
  }

  return classifyContactIntent(query);
}

export function getAcademyManagerContactCard(): AcademyContactCard {
  return {
    kind: "ACADEMY_MANAGER",
    name: ACADEMY_CONTACT_POLICY.manager.name,
    role: ACADEMY_CONTACT_POLICY.manager.role,
    availability: ACADEMY_CONTACT_POLICY.manager.availability,
    imageUrl: ACADEMY_CONTACT_POLICY.manager.imageUrl,
    telegram: {
      label: ACADEMY_CONTACT_POLICY.manager.telegramHandle,
      href: ACADEMY_CONTACT_POLICY.manager.telegramUrl,
    },
    phone: {
      label: ACADEMY_CONTACT_POLICY.manager.phoneLabel,
      href: ACADEMY_CONTACT_POLICY.manager.phoneHref,
    },
  };
}

/**
 * Contact wording is canonical and mode-neutral except where it addresses the
 * user directly, and that one verb follows the stored TY/VY mode (A03/A31).
 */
function contactWriteVerb(profile?: ConversationProfile): string {
  return profile?.addressMode === "TY" ? "напиши" : "напишите";
}

export function composeAcademyContactAnswer(
  intent: AcademyContactIntent,
  profile?: ConversationProfile,
): {
  message: string;
  contactCard: AcademyContactCard | null;
} {
  const writeVerb = contactWriteVerb(profile);

  if (intent === "FAST_TEXT") {
    return {
      message: [
        `Если нужен быстрый письменный ответ, ${writeVerb} в чат Академии в Telegram: ${ACADEMY_CONTACT_POLICY.fastTelegramUrl} (${ACADEMY_CONTACT_POLICY.fastTelegramHandle}).`,
        `Стандартный вариант — раздел «Контакты»: ${ACADEMY_CONTACT_POLICY.contactsPage}. Там можно заполнить форму; это самый медленный способ получить ответ.`,
      ].join("\n\n"),
      contactCard: null,
    };
  }

  if (intent === "LIVE") {
    return {
      message: [
        `Для живого общения можно обратиться напрямую к менеджеру Академии Алексею Лебедеву. Он доступен ${ACADEMY_CONTACT_POLICY.manager.availability}.`,
        `Telegram: ${ACADEMY_CONTACT_POLICY.manager.telegramUrl} (${ACADEMY_CONTACT_POLICY.manager.telegramHandle}).`,
        `Телефон: ${ACADEMY_CONTACT_POLICY.manager.phoneLabel}.`,
      ].join("\n\n"),
      contactCard: getAcademyManagerContactCard(),
    };
  }

  return {
    message: [
      `Если нужен быстрый письменный ответ, ${writeVerb} в чат Академии в Telegram: ${ACADEMY_CONTACT_POLICY.fastTelegramUrl} (${ACADEMY_CONTACT_POLICY.fastTelegramHandle}).`,
      `Если нужно живое общение, можно обратиться к менеджеру Академии Алексею Лебедеву. Он доступен ${ACADEMY_CONTACT_POLICY.manager.availability}. Telegram: ${ACADEMY_CONTACT_POLICY.manager.telegramUrl}; телефон: ${ACADEMY_CONTACT_POLICY.manager.phoneLabel}.`,
      `Стандартный вариант — раздел «Контакты»: ${ACADEMY_CONTACT_POLICY.contactsPage}. Там можно заполнить форму; это самый медленный способ получить ответ.`,
    ].join("\n\n"),
    contactCard: getAcademyManagerContactCard(),
  };
}

export function composeCourseFactualCeilingAnswer(
  courseTitle: string,
): string {
  return [
    `В доступных мне подтверждённых материалах курса «${courseTitle}» нет достаточного основания, чтобы надёжно ответить на этот вопрос. Я не буду заполнять пробел общими знаниями или предположениями.`,
    `Быстро уточнить это можно в чате Академии в Telegram: ${ACADEMY_CONTACT_POLICY.fastTelegramUrl} (${ACADEMY_CONTACT_POLICY.fastTelegramHandle}).`,
    `Для живого разговора доступен менеджер Академии Алексей Лебедев — ${ACADEMY_CONTACT_POLICY.manager.availability}. Telegram: ${ACADEMY_CONTACT_POLICY.manager.telegramUrl}; телефон: ${ACADEMY_CONTACT_POLICY.manager.phoneLabel}.`,
    `Стандартная форма связи: ${ACADEMY_CONTACT_POLICY.contactsPage}. Это самый медленный способ получить ответ.`,
  ].join("\n\n");
}
