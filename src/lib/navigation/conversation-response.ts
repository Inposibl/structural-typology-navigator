import type {
  ConversationMessage,
  ConversationProfile,
} from "../chat-contract.ts";
import {
  ACADEMY_COURSES,
  ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE,
  getAcademyCourse,
  type AcademyCourse,
} from "../academy/course-catalog.ts";
import { getPublicCourseOutcomes } from "../academy/public-course-outcomes.ts";
import {
  getAuthoritativeCoursePrice,
} from "../academy/commercial-authority.ts";
import type { ResolvedCourseEvidence } from "../knowledge/retrieval/authority-resolver.ts";
import type { CourseEvidenceSelection } from "../knowledge/retrieval/evidence-selector.ts";
import {
  callDeepSeekJson,
  callDeepSeekText,
  type DeepSeekClientOptions,
} from "./deepseek-client.ts";
import type {
  ConversationActDecision,
  FactualIntent,
} from "./conversation-act-router.ts";
import {
  addressStyleInstruction,
} from "./conversation-profile.ts";
import {
  auditCourseFollowUpAnswer,
  buildFollowUpAuthorityPayload,
  composeCatalogFollowUpAnswer,
  isCatalogAnswerableFollowUp,
  type FollowUpAuthorityPayload,
  type FollowUpEvidenceExcerpt,
  type FollowUpGroundingAudit,
} from "./follow-up-grounding.ts";
import type { NavigatorGroundingDetails } from "./navigator-observability.ts";
import {
  composeCourseFactualCeilingAnswer,
  composeAcademyContactAnswer,
} from "../academy/contact-policy.ts";
import type {
  HandoffReason,
  LastAssistantAction,
} from "./conversation-state.ts";
import { handoffOfferClause } from "./handoff.ts";

/* ---------------------------------------------------------------------------
 * Package A — deterministic conversation-control responses.
 *
 * These are control-lane answers: they never route through the conversation-act
 * router, never select or re-select a course, and never introduce factual or
 * commercial claims. Wording follows the selected TY/VY mode using the same
 * ternary idiom as the existing deterministic composers.
 * ------------------------------------------------------------------------ */

type PackageAProfile = ConversationProfile | undefined;

function modePick(
  profile: PackageAProfile,
  ty: string,
  vy: string,
): string {
  return profile?.addressMode === "TY" ? ty : vy;
}

export function composeConversationCloseAnswer(
  profile: PackageAProfile,
): string {
  return modePick(
    profile,
    "Хорошо, до связи. Если понадобится — просто напиши.",
    "Хорошо, до связи. Если понадобится — просто напишите.",
  );
}

export function composeCancelFlowAnswer(profile: PackageAProfile): string {
  return modePick(
    profile,
    "Хорошо, текущий подбор отменён. Ничего не выбрано. Если захочешь, опиши задачу заново — и я начну с начала.",
    "Хорошо, текущий подбор отменён. Ничего не выбрано. Если захотите, опишите задачу заново — и я начну с начала.",
  );
}

export function composeResumeFlowAnswer(
  pendingQuestion: string | null,
  profile: PackageAProfile,
): string {
  if (pendingQuestion) {
    return `Возвращаюсь к подбору. ${pendingQuestion}`;
  }

  return modePick(
    profile,
    "Возвращаюсь к тому, на чём мы остановились. Опиши, пожалуйста, что для тебя важнее всего.",
    "Возвращаюсь к тому, на чём мы остановились. Опишите, пожалуйста, что для вас важнее всего.",
  );
}

export function composeSkipAnswer(profile: PackageAProfile): string {
  return modePick(
    profile,
    "Хорошо, пропускаем этот вопрос — повторять его не буду. Можешь описать задачу своими словами или выбрать другое направление.",
    "Хорошо, пропускаем этот вопрос — повторять его не буду. Можете описать задачу своими словами или выбрать другое направление.",
  );
}

export function composeStaleReferenceConfirmationAnswer(
  courseTitle: string,
  profile: PackageAProfile,
): string {
  return modePick(
    profile,
    `Ранее мы обсуждали курс «${courseTitle}». Ты имеешь в виду его?`,
    `Ранее мы обсуждали курс «${courseTitle}». Вы имеете в виду его?`,
  );
}

export function composeStaleReferenceConfirmedAnswer(
  courseTitle: string,
  profile: PackageAProfile,
): string {
  return modePick(
    profile,
    `Хорошо, продолжаем с курсом «${courseTitle}». Спрашивай, что важно.`,
    `Хорошо, продолжаем с курсом «${courseTitle}». Спрашивайте, что важно.`,
  );
}

export function composeStaleReferenceDeclinedAnswer(
  profile: PackageAProfile,
): string {
  return modePick(
    profile,
    "Понятно. Тогда уточни, пожалуйста, о каком курсе речь.",
    "Понятно. Тогда уточните, пожалуйста, о каком курсе речь.",
  );
}

/**
 * Bounded, neutral explanation for an unsupported addressing variant (A02).
 * It states the supported modes, does not debate identity, and does not treat
 * identity language as educational evidence. Attempt count changes the wording
 * so repeated invalid input never re-emits the same initial prompt.
 */
export function composeUnsupportedAddressModeAnswer(
  priorAttempts: number,
  budget: number,
): string {
  if (priorAttempts === 0) {
    return "Сейчас в Навигаторе поддерживаются только два варианта обращения: на «ты» и на «вы». Другие формы использовать не получится. Выберите, пожалуйста: на «ты» или на «вы».";
  }

  if (priorAttempts >= budget - 1) {
    return "Других вариантов обращения, кроме «ты» и «вы», в Навигаторе нет. Как только напишете «на ты» или «на вы», продолжим.";
  }

  return "Чтобы продолжить, нужно выбрать один из двух вариантов обращения: на «ты» или на «вы». Напишите просто «на ты» или «на вы» — и мы продолжим.";
}

/**
 * Structured clarification exhaustion (A14). Package A stops asking; it does
 * not implement human handoff, which is Package B.
 */
export function composeClarificationExhaustionAnswer(
  profile: PackageAProfile,
): string {
  return modePick(
    profile,
    "Вижу, что уточняющие вопросы здесь не помогают. Больше их задавать не буду — попробуем иначе. Опиши, пожалуйста, своими словами, что для тебя сейчас самое важное.",
    "Вижу, что уточняющие вопросы здесь не помогают. Больше их задавать не буду — попробуем иначе. Опишите, пожалуйста, своими словами, что для вас сейчас самое важное.",
  );
}

export function composeRestatementUnavailableAnswer(
  profile: PackageAProfile,
): string {
  return modePick(
    profile,
    "Пока нечего повторять — я ещё ничего не отвечал. Опиши, пожалуйста, свою задачу.",
    "Пока нечего повторять — я ещё ничего не отвечал. Опишите, пожалуйста, свою задачу.",
  );
}

/**
 * Session context expired and the user referred to something from the previous
 * conversation without naming it. Nothing is restored; the user is asked to
 * restate what they want.
 */
export function composeExpiredContextAnswer(
  profile: PackageAProfile,
): string {
  return modePick(
    profile,
    "С прошлого разговора прошло больше суток, поэтому прежний контекст я не сохраняю. Напиши, пожалуйста, с чем хочешь разобраться сейчас.",
    "С прошлого разговора прошло больше суток, поэтому прежний контекст я не сохраняю. Напишите, пожалуйста, с чем хотите разобраться сейчас.",
  );
}

export function composeDeferredRequestAnswer(
  deferredRequest: string,
  profile: PackageAProfile,
): string {
  return modePick(
    profile,
    `Твой запрос я сохранил: «${deferredRequest}».`,
    `Ваш запрос я сохранил: «${deferredRequest}».`,
  );
}

/**
 * What a rejected capture has to report on: whether an earlier remainder is
 * already waiting, or the fragment stood alone.
 */
export type DeferredCapacityNoticeScope = "ALONGSIDE_STORED" | "STANDALONE";

/**
 * Bounded, non-technical explanation for a remainder that could not be
 * preserved (A19). It names no internal limit, no queue and no state, and it
 * never claims the new text was saved: an already acknowledged request stays
 * intact and the newest fragment is asked for again.
 */
export function composeDeferredCapacityRejectedAnswer(
  scope: DeferredCapacityNoticeScope,
  profile: PackageAProfile,
): string {
  if (scope === "STANDALONE") {
    return modePick(
      profile,
      "Этот запрос слишком длинный, чтобы я мог сохранить его целиком. Пришли его, пожалуйста, короче — и я сразу за него возьмусь.",
      "Этот запрос слишком длинный, чтобы я мог сохранить его целиком. Пришлите его, пожалуйста, короче — и я сразу за него возьмусь.",
    );
  }

  return modePick(
    profile,
    "Предыдущий запрос у меня сохранён. Этот дополнительный фрагмент слишком длинный, чтобы сохранить его вместе с ним — пришли его ещё раз после того, как разберём первый.",
    "Предыдущий запрос у меня сохранён. Этот дополнительный фрагмент слишком длинный, чтобы сохранить его вместе с ним — пришлите его ещё раз после того, как разберём первый.",
  );
}

export type RestatementKind = "REPEAT" | "REPHRASE" | "SIMPLIFY";

/**
 * Sentences that carry an explicit limitation or factual ceiling. Cyrillic
 * letter lookarounds are used instead of \b, which is ASCII-only in JavaScript
 * and therefore never matches between Cyrillic characters.
 */
const LIMITATION_MARKERS =
  /(?<![а-яё])(?:не могу|не является|не подтвержд[а-яё]*|не вижу|только|лишь|не гарантир[а-яё]*|ограничен[а-яё]*|не относится|вне функции|не содержит|нельзя|без натяжки)(?![а-яё])/iu;

/** Navigator self-framing sentences, i.e. meta rather than substance. */
const SELF_FRAMING_MARKERS =
  /^(?:навигатор(?![а-яё])|я показываю|цитаты|если вопрос|этот вопрос|для общего поиска)/iu;

function toSentences(content: string): string[] {
  return content
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Deterministic restatement (A20).
 *
 * These transforms only ever remove or re-frame the previously returned public
 * content: no new factual claim is ever produced, no authority is consulted, no
 * routing decision is taken and no navigation state is changed. REPHRASE and
 * SIMPLIFY keep every sentence that carries an explicit limitation, so a
 * factual ceiling is never compressed away.
 */
export function restateAssistantContent(
  content: string,
  kind: RestatementKind,
): string {
  const normalized = content.replace(/[ \t]+/gu, " ").trim();

  if (kind === "REPEAT") {
    return normalized;
  }

  const sentences = toSentences(normalized);
  if (sentences.length <= 1) {
    return normalized;
  }

  if (kind === "REPHRASE") {
    const substantive = sentences.filter(
      (sentence) => !SELF_FRAMING_MARKERS.test(sentence),
    );

    if (substantive.length === 0 || substantive.length === sentences.length) {
      return normalized;
    }

    return ["Скажу то же самое, но без лишних пояснений.", ...substantive].join(
      "\n\n",
    );
  }

  const kept = sentences.filter(
    (sentence, index) => index === 0 || LIMITATION_MARKERS.test(sentence),
  );

  return kept.join(" ");
}

type CourseFollowUpAct = Extract<
  ConversationActDecision,
  { state: "COURSE_FOLLOW_UP" }
>;

/* ---------------------------------------------------------------------------
 * Package B — repair, handoff, execution and technical-error responses.
 *
 * The same discipline as Package A applies: these are control-lane answers
 * built from structured state and canonical entities. None of them re-routes,
 * re-selects a course, introduces a factual or commercial claim, or exposes an
 * internal route, state, provider, or error label.
 * ------------------------------------------------------------------------ */

const REPAIR_PRIOR_ANSWER_UNAVAILABLE_HEAD =
  "Пока мне нечего объяснять заново: в этом разговоре я ещё ничего не отвечал.";

function priorCourseTitle(prior: LastAssistantAction): string | null {
  if (prior.courseId === null) return null;

  return getAcademyCourse(prior.courseId)?.title ?? null;
}

/**
 * "ответь нормально" (A05): a bounded re-explanation of the prior public
 * answer. It reuses the recorded content and removes framing rather than
 * adding new claims, so no factual authority is created.
 */
export function composeRepairRestateAnswer(
  prior: LastAssistantAction,
  profile: PackageAProfile,
): string {
  return [
    "Хорошо, скажу то же самое, но по делу.",
    restateAssistantContent(prior.content, "REPHRASE"),
    modePick(
      profile,
      "Если и так непонятно — напиши, что именно смущает, и я объясню иначе.",
      "Если и так непонятно — напишите, что именно смущает, и я объясню иначе.",
    ),
  ].join("\n\n");
}

/**
 * "что ты имел в виду?" (A05): clarifies the prior assistant statement from its
 * recorded action and content — not the user's business intent.
 */
export function composeRepairClarifyAnswer(
  prior: LastAssistantAction,
  profile: PackageAProfile,
): string {
  const courseTitle = priorCourseTitle(prior);

  return [
    "Поясню, что я имел в виду.",
    ...(courseTitle !== null
      ? [`Мой прошлый ответ относился к курсу «${courseTitle}».`]
      : []),
    restateAssistantContent(prior.content, "REPHRASE"),
    modePick(
      profile,
      "Если ты спрашивал о чём-то другом, напиши прямо — я отвечу по существу.",
      "Если вы спрашивали о чём-то другом, напишите прямо — я отвечу по существу.",
    ),
  ].join("\n\n");
}

/**
 * "ты сам сказал, что..." (A05): a challenge is answered against the record.
 *
 * The recorded answer speaks for itself: the response restates what was
 * actually returned and adds no new factual claim, so it neither invents
 * agreement nor argues with the user about what was said.
 */
export function composeRepairChallengeAnswer(
  prior: LastAssistantAction,
  profile: PackageAProfile,
): string {
  const courseTitle = priorCourseTitle(prior);

  return [
    modePick(
      profile,
      "Давай сверимся с тем, что было в моём предыдущем ответе.",
      "Давайте сверимся с тем, что было в моём предыдущем ответе.",
    ),
    ...(courseTitle !== null
      ? [`В нём речь шла о курсе «${courseTitle}».`]
      : []),
    restateAssistantContent(prior.content, "REPHRASE"),
    modePick(
      profile,
      "Новых утверждений я к этому не добавлю: всё, что могу подтвердить, уже сказано выше. Если расхождение осталось, скажи, в каком именно месте, — и я разберу именно его.",
      "Новых утверждений я к этому не добавлю: всё, что могу подтвердить, уже сказано выше. Если расхождение осталось, напишите, в каком именно месте, — и я разберу именно его.",
    ),
  ].join("\n\n");
}

/**
 * Repair with nothing recorded to repair (A05). The honest answer says so and
 * offers the bounded next step instead of inventing a plausible prior reply.
 */
export function composeRepairUnavailableAnswer(
  profile: PackageAProfile,
): string {
  return [
    REPAIR_PRIOR_ANSWER_UNAVAILABLE_HEAD,
    modePick(
      profile,
      "Опиши, пожалуйста, что нужно, — и я отвечу. Если удобнее поговорить с человеком, я подготовлю краткую сводку и дам контакты для связи.",
      "Опишите, пожалуйста, что нужно, — и я отвечу. Если удобнее поговорить с человеком, я подготовлю краткую сводку и дам контакты для связи.",
    ),
  ].join("\n\n");
}

/** The canonical human contact path, read-only from the contact authority. */
function canonicalContactPath(): string {
  return composeAcademyContactAnswer("LIVE").message;
}

/**
 * The Navigator can prepare a handoff and give the canonical contact path. It
 * cannot notify anyone, so the wording says exactly that (A23).
 */
export function composeHandoffOfferedAnswer(
  profile: PackageAProfile,
  reason: HandoffReason,
): string {
  return [
    handoffOfferClause(reason),
    modePick(
      profile,
      "Если хочешь, подготовлю краткую сводку по нашему разговору, чтобы не пришлось пересказывать всё заново. Напиши «да» — и я её соберу. Или продолжим здесь: я никуда не пропадаю.",
      "Если хотите, подготовлю краткую сводку по нашему разговору, чтобы не пришлось пересказывать всё заново. Напишите «да» — и я её соберу. Или продолжим здесь: я никуда не пропадаю.",
    ),
    "Связаться с человеком можно так:",
    canonicalContactPath(),
  ].join("\n\n");
}

/**
 * A READY handoff (A23/A24): the prepared bounded summary plus the canonical
 * contact path. It never claims that the summary was sent or that a human was
 * notified, because no such transport exists.
 */
export function composeHandoffReadyAnswer(
  contextText: string,
): string {
  return [
    "Я подготовил краткую сводку по нашему разговору. Передать её человеку можно самому, чтобы не пересказывать всё заново:",
    contextText,
    "Связаться можно так:",
    canonicalContactPath(),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

/** A replay of a completed request identity (A22): nothing is executed twice. */
export function composeDuplicateRequestAnswer(
  profile: PackageAProfile,
): string {
  return modePick(
    profile,
    "Это сообщение я уже обработал, поэтому второй раз выполнять его не буду. Напиши, пожалуйста, следующий вопрос.",
    "Это сообщение я уже обработал, поэтому второй раз выполнять его не буду. Напишите, пожалуйста, следующий вопрос.",
  );
}

/**
 * Public technical-failure response (A21).
 *
 * It states that the failure was technical, makes clear that the user does not
 * need to reformulate because of it, and preserves the conversation for retry.
 * It names no provider, stage, route, error class, exception, or stack frame.
 */
export function composeTechnicalErrorAnswer(
  profile: PackageAProfile,
  retryable: boolean,
): string {
  if (retryable) {
    return modePick(
      profile,
      "Извини, на моей стороне произошёл технический сбой — к твоему запросу это отношения не имеет. Переписывать или формулировать заново ничего не нужно: попробуй, пожалуйста, отправить сообщение ещё раз.",
      "Извините, на моей стороне произошёл технический сбой — к вашему запросу это отношения не имеет. Переписывать или формулировать заново ничего не нужно: попробуйте, пожалуйста, отправить сообщение ещё раз.",
    );
  }

  return modePick(
    profile,
    "Извини, у меня сейчас техническая проблема, из-за которой я не могу ответить. Дело не в твоём запросе — переформулировать его не нужно. Попробуй, пожалуйста, чуть позже.",
    "Извините, у меня сейчас техническая проблема, из-за которой я не могу ответить. Дело не в вашем запросе — переформулировать его не нужно. Попробуйте, пожалуйста, чуть позже.",
  );
}
export type ComposeCourseFollowUpOptions = DeepSeekClientOptions & {
  callText?: typeof callDeepSeekText;
  callJson?: typeof callDeepSeekJson;
  courseEvidence?: readonly ResolvedCourseEvidence[];
  evidenceSelection?: CourseEvidenceSelection;
  onOutcome?: (outcome: CourseFollowUpOutcome) => void;
  profile?: ConversationProfile;
  /**
   * Bounded hybrid grounding guardrail trace. The composer reports which of the
   * nine bounded outcomes the turn took; the caller owns the requestId and the
   * log line, so no answer text or evidence ever leaves this function.
   */
  onGroundingEvent?: (details: NavigatorGroundingDetails) => void;
};

export type CourseFollowUpOutcome = {
  answerOrigin: "CATALOG_AUTHORITY" | "FACTUAL_CEILING" | "RAG_EVIDENCE";
  fallback: "NONE" | "CATALOG_FOLLOW_UP" | "FACTUAL_CEILING";
};

export function composeNavigatorMetaAnswer(): string {
  return [
    "Навигатор нужен для выбора и объяснения учебного маршрута внутри Академии структурной типологии.",
    "Цитаты и ссылки на внутренние материалы не должны появляться в обычной рекомендации автоматически. Я показываю их только по прямому запросу на основания, источники или конкретные выдержки из материалов курса.",
    "Если вопрос не относится к курсам Академии, Навигатор должен честно обозначить границу своей функции, а не притягивать новый вопрос к уже обсуждавшемуся курсу.",
  ].join("\n\n");
}

export function composeNavigatorOutOfScopeAnswer(
  profile?: PackageAProfile,
): string {
  return [
    "Этот вопрос вне функции Навигатора: здесь я помогаю выбирать и понимать учебные маршруты Академии структурной типологии.",
    modePick(
      profile,
      "Для общего поиска лучше использовать, например, Google или Perplexity; для диалогового разбора — универсальный ассистент вроде ChatGPT. Так ты получишь более качественный ответ по теме, которая не относится к курсам Академии.",
      "Для общего поиска лучше использовать, например, Google или Perplexity; для диалогового разбора — универсальный ассистент вроде ChatGPT. Так вы получите более качественный ответ по теме, которая не относится к курсам Академии.",
    ),
  ].join("\n\n");
}

export function composeStableNoMatchAnswer(): string {
  return [
    "По уже описанной задаче в текущем каталоге нет курса, который я могу обоснованно рекомендовать.",
    "Просьба выбрать любой курс не создаёт оснований для рекомендации. Я смогу проверить подбор заново, если появятся новые факты о задаче или изменится каталог Академии.",
  ].join("\n\n");
}

export function composePaymentAmbiguityAnswer(
  profile?: PackageAProfile,
): string {
  return modePick(
    profile,
    "В запросе указано несколько курсов. Назови, пожалуйста, один курс для оплаты — до уточнения я не буду давать платёжную ссылку.",
    "В запросе указано несколько курсов. Назовите, пожалуйста, один курс для оплаты — до уточнения я не буду давать платёжную ссылку.",
  );
}

export function composePaymentCourseChangeConfirmationAnswer(
  currentTitle: string,
  requestedTitle: string,
  profile?: PackageAProfile,
): string {
  // Both second-person forms in this prompt follow the mode: the statement
  // about what the user asked for, and the request for confirmation.
  const statement = modePick(
    profile,
    `Сейчас выбран курс «${currentTitle}», а оплатить ты просишь курс «${requestedTitle}».`,
    `Сейчас выбран курс «${currentTitle}», а оплатить вы просите курс «${requestedTitle}».`,
  );
  const request = modePick(
    profile,
    "Подтверди, пожалуйста",
    "Подтвердите, пожалуйста",
  );

  return `${statement} ${request}: переключиться на «${requestedTitle}» и открыть оплату?`;
}

export function composePaymentCourseChangeDeclinedAnswer(
  currentTitle: string,
): string {
  return `Хорошо, курс для оплаты не меняю. Выбранным остаётся «${currentTitle}».`;
}

export function composePaymentCourseIdentityRequiredAnswer(
  profile?: PackageAProfile,
): string {
  return modePick(
    profile,
    "Перед оплатой нужно заново определить курс. Назови, пожалуйста, точное название курса — до этого платёжную ссылку не дам.",
    "Перед оплатой нужно заново определить курс. Назовите, пожалуйста, точное название курса — до этого платёжную ссылку не дам.",
  );
}

export function composePaymentUnavailableAnswer(courseTitle: string): string {
  return `Для курса «${courseTitle}» в действующей платёжной политике нет подтверждённой ссылки на оплату. Я не буду придумывать или подменять её общей ссылкой.`;
}

function formatRub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

function authorityDateRu(): string {
  return "19 сентября 2026 года";
}

export function composeAcademyOverviewAnswer(): string {
  return [
    "Академия структурной типологии — образовательный проект с каталогом курсов о моделях личности, мотивации, восприятия, взаимодействия, поведения и организационных ситуаций.",
    `Я могу сообщать только сведения из каталога Академии по состоянию на ${ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE}, помогать сравнивать программы и подбирать учебный маршрут. Это не клиническая помощь и не подтверждение аккредитации или научного статуса программ.`,
  ].join("\n\n");
}

export function composePsychologyBoundaryAnswer(): string {
  return "В каталоге есть темы, смежные с психологией: мотивация, личность, восприятие, взаимодействие и поведение. При этом Навигатор не утверждает, что Академия оказывает клиническую психологическую помощь, выдаёт профессиональную аккредитацию или что программы имеют подтверждённый научный статус.";
}

/**
 * Public statement of the substantive limitation for a catalog course that is
 * listed but not recommendable (A31).
 *
 * The catalog's own `routingBlockReason` is an internal note: it explains the
 * Navigator's routing to the team rather than describing the course to the
 * user. The public renderer therefore states the same limitation in ordinary
 * user-facing Russian instead of printing that note. The catalog authority is
 * unchanged and the fact is not softened — the course is listed in the current
 * catalog, and there is no public page with a sufficient description for it.
 */
const LISTED_COURSE_LIMITATION =
  "публичной страницы с достаточным описанием пока нет";

export function composeCatalogListAnswer(): string {
  return [
    `Каталог Академии по состоянию на ${ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE}:`,
    ...ACADEMY_COURSES.map((course) => {
      const availability =
        course.status === "ROUTABLE"
          ? "доступен для навигации"
          : `только указан в каталоге; ${LISTED_COURSE_LIMITATION}`;
      return `• «${course.title}» — ${course.meetings} встреч; ${availability.replace(/[.!?]+$/u, "")}${course.url ? `; ${course.url}` : ""}.`;
    }),
  ].join("\n");
}

function metadataCourseIds(
  intent: Extract<FactualIntent, { kind: "CURRENT_METADATA" }>,
  selectedCourseId: string | null,
): string[] {
  if (intent.scope === "ALL") return ACADEMY_COURSES.map((course) => course.id);
  if (intent.courseIds.length > 0) return intent.courseIds;
  return selectedCourseId === null ? [] : [selectedCourseId];
}

export function composeCurrentMetadataAnswer(
  intent: Extract<FactualIntent, { kind: "CURRENT_METADATA" }>,
  selectedCourseId: string | null,
  profile?: PackageAProfile,
): string {
  const courseIds = metadataCourseIds(intent, selectedCourseId);
  if (courseIds.length === 0 && intent.fields.includes("PRICE")) {
    return modePick(
      profile,
      "Уточни, пожалуйста, название курса. Без выбранного или названного курса я не могу определить, о какой цене идёт речь.",
      "Уточните, пожалуйста, название курса. Без выбранного или названного курса я не могу определить, о какой цене идёт речь.",
    );
  }

  const lines: string[] = [];
  if (intent.fields.includes("PRICE")) {
    for (const courseId of courseIds) {
      const course = getAcademyCourse(courseId);
      if (!course) continue;
      const price = getAuthoritativeCoursePrice(courseId as Parameters<typeof getAuthoritativeCoursePrice>[0]);
      lines.push(
        price.status === "SUPPORTED"
          ? `• «${course.title}»: последняя подтверждённая цена по данным на ${authorityDateRu()} — ${formatRub(price.value)}.`
          : `• «${course.title}»: подтверждённой цены по данным авторитета на ${authorityDateRu()} нет.`,
      );
    }
  }

  const unavailableLabels: Record<string, string> = {
    SCHEDULE: "расписание",
    COHORT: "текущий поток",
    ENROLLMENT_WINDOW: "окно набора",
  };
  for (const field of intent.fields) {
    if (field === "PRICE") continue;
    lines.push(
      `• ${unavailableLabels[field]}: авторитетного значения нет; я не буду восстанавливать его из истории, памяти модели или материалов курса.`,
    );
  }

  return [
    `Коммерческие сведения ограничены подтверждёнными данными Академии по состоянию на ${authorityDateRu()}.`,
    ...lines,
  ].join("\n");
}

function courseComparisonBlock(course: AcademyCourse): string {
  const outcomes = getPublicCourseOutcomes(course);
  const status =
    course.status === "ROUTABLE"
      ? "доступен для навигации"
      : `только указан в каталоге; ${LISTED_COURSE_LIMITATION}`;
  return [
    `«${course.title}»`,
    `• Статус: ${status}.`,
    `• Встреч: ${course.meetings}.`,
    `• Учебные задачи: ${course.learningNeeds.length > 0 ? course.learningNeeds.join("; ") : "не указаны"}.`,
    `• Публичные результаты: ${outcomes.length > 0 ? outcomes.join("; ") : "не указаны"}.`,
    `• Аудитория: ${course.audienceSignals.length > 0 ? course.audienceSignals.join("; ") : "не указана"}.`,
    `• Публичная страница: ${course.url ?? "не указана"}.`,
  ].join("\n");
}

export function composeCourseComparisonAnswer(
  intent: Extract<FactualIntent, { kind: "COURSE_COMPARISON" }>,
  profile?: PackageAProfile,
): string {
  if (intent.hasUnknownCourse || intent.courseIds.length !== 2) {
    return modePick(
      profile,
      "Не могу выполнить сравнение: один из названных курсов не найден в текущем каталоге Академии. Уточни точное название.",
      "Не могу выполнить сравнение: один из названных курсов не найден в текущем каталоге Академии. Уточните точное название.",
    );
  }
  const courses = intent.courseIds.map(getAcademyCourse);
  if (courses.some((course) => course === null)) {
    return "Не могу выполнить сравнение: один из курсов отсутствует в текущем каталоге Академии.";
  }
  return [
    modePick(
      profile,
      "Нейтральное сравнение по данным каталога — без выбора победителя и без вывода о том, что лучше именно для тебя:",
      "Нейтральное сравнение по данным каталога — без выбора победителя и без вывода о том, что лучше именно для вас:",
    ),
    ...courses.map((course) => courseComparisonBlock(course as AcademyCourse)),
  ].join("\n\n");
}

export function composeFactualAnswer(
  intents: readonly FactualIntent[],
  selectedCourseId: string | null,
  profile?: PackageAProfile,
): string {
  return intents.map((intent) => {
    switch (intent.kind) {
      case "ACADEMY_OVERVIEW":
        return composeAcademyOverviewAnswer();
      case "CATALOG_LIST":
        return composeCatalogListAnswer();
      case "PSYCHOLOGY_BOUNDARY":
        return composePsychologyBoundaryAnswer();
      case "CURRENT_METADATA":
        return composeCurrentMetadataAnswer(intent, selectedCourseId, profile);
      case "COURSE_COMPARISON":
        return composeCourseComparisonAnswer(intent, profile);
    }
  }).join("\n\n");
}

function sourceProvenance(source: ResolvedCourseEvidence): string {
  const primary =
    typeof source.locator.primary === "object" &&
    source.locator.primary !== null &&
    !Array.isArray(source.locator.primary)
      ? (source.locator.primary as Record<string, unknown>)
      : {};

  const parts: string[] = [];
  if (Number.isInteger(primary.questionNumber)) {
    parts.push(`вопрос ${String(primary.questionNumber)}`);
  }
  if (Number.isInteger(primary.pdfPageStart)) {
    parts.push(`PDF стр. ${String(primary.pdfPageStart)}`);
  }
  if (Number.isInteger(primary.pageStart)) {
    parts.push(`стр. ${String(primary.pageStart)}`);
  }
  if (Number.isInteger(primary.slideStart)) {
    parts.push(`слайд ${String(primary.slideStart)}`);
  }

  return parts.length > 0
    ? `${source.sourceTitle} (${parts.join(", ")})`
    : source.sourceTitle;
}

function selectedEvidence(
  selection: CourseEvidenceSelection | undefined,
  evidence: readonly ResolvedCourseEvidence[] | undefined,
): FollowUpEvidenceExcerpt[] {
  if (!selection || selection.status !== "SUPPORTED" || !evidence) {
    return [];
  }

  const byChunkId = new Map(evidence.map((item) => [item.chunkId, item]));

  return selection.evidence.map((item) => {
    const source = byChunkId.get(item.chunkId);
    if (!source) {
      throw new Error("Selected follow-up evidence chunk is unavailable.");
    }

    return {
      quote: item.quote,
      source: sourceProvenance(source),
    };
  });
}

function coursePublicPayload(
  course: AcademyCourse,
  evidence: readonly FollowUpEvidenceExcerpt[],
) {
  return buildFollowUpAuthorityPayload(course, evidence);
}

/* ---------------------------------------------------------------------------
 * Bounded hybrid grounding guardrail.
 *
 * AUDIT-STABILITY-REPLAY-1 measured the semantic auditor directly: 352 frozen
 * fixed-input trials produced 333 effective PASS, zero STABLE_FAIL, a PASS
 * majority on every item, and 12 of 32 items that flipped at least once. One
 * fresh auditor call is therefore not a trustworthy sole authority for
 * destroying an otherwise valid candidate answer — but it is also not something
 * to loosen. The auditor in `follow-up-grounding.ts` is unchanged: same prompt,
 * same model, same PASS/FAIL contract, same reasonCode enum, same validator.
 *
 * What changes is only what production does with a FAIL: the turn gets exactly
 * ONE controlled repair composition over the SAME evidence, re-audited by the
 * SAME auditor. There is no majority vote, no third cycle and no fail-open
 * path — every terminal branch that is not an explicit PASS ends at the
 * factual ceiling.
 * ------------------------------------------------------------------------- */

type GroundingAuditOutcome =
  | { kind: "VERDICT"; audit: FollowUpGroundingAudit }
  | { kind: "ERROR"; errorName: string };

/**
 * The audit-error containment boundary (§15). A transport failure, a malformed
 * provider body, a parser failure or a validator rejection — including the
 * measured `{"status":"PASS","reasonCode":null}` case the frozen validator
 * correctly rejects — must never become a PASS, an unhandled 500 or a raw
 * exception shown to the user. It becomes an ERROR outcome, and every ERROR
 * outcome ends at the factual ceiling.
 */
async function runGroundingAudit(
  answer: string,
  latestUserMessage: string,
  authority: FollowUpAuthorityPayload,
  options: ComposeCourseFollowUpOptions,
): Promise<GroundingAuditOutcome> {
  try {
    const audit = await auditCourseFollowUpAnswer(
      answer,
      latestUserMessage,
      authority,
      {
        env: options.env,
        fetch: options.fetch,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        callJson: options.callJson,
      },
    );

    return { kind: "VERDICT", audit };
  } catch (error) {
    return {
      kind: "ERROR",
      errorName: error instanceof Error ? error.name : "UnknownError",
    };
  }
}

/**
 * The single repair instruction. It is deliberately narrow: no new retrieval,
 * no new selector call, no new evidence, no new source, no world knowledge and
 * no course change — the same authority payload, rewritten to drop what the
 * audit rejected.
 */
function groundingRepairInstruction(reasonCode: string): string {
  return `РЕЖИМ ИСПРАВЛЕНИЯ ОБОСНОВАННОСТИ.

Предыдущий вариант ответа отклонён независимым аудитом обоснованности с кодом причины ${reasonCode}. Он передан тебе как rejectedAnswer и НЕ является источником фактов.

Перепиши ответ так, чтобы КАЖДОЕ содержательное утверждение опиралось на переданный authorityPayload. Убери то утверждение или вывод, которое аудит не смог подтвердить переданным материалом.

ЗАПРЕЩЕНО при исправлении:
- вводить новые факты, термины, сравнения, примеры, источники;
- добавлять утверждения о структуре, составе или полноте курса;
- использовать общие знания модели;
- предполагать материал, который не передан в authorityPayload.

СОХРАНИ:
- содержание, которое подтверждается evidence;
- оговорки и ограничения источника;
- прямое указание на то, чего в переданных материалах нет.

Верни только исправленный текст ответа.`;
}

/**
 * CORR3.CONVERSATION-REPAIR-AND-FOLLOWUP-1 (D3) — an explicit request for what
 * the source/course itself says. Source attribution is appropriate here; for an
 * ordinary content question the grounded composer prefers a direct teaching
 * voice instead of repeatedly narrating "курс говорит / заявляет".
 */
const EXPLICIT_SOURCE_ATTRIBUTION_PATTERN =
  /(?:что\s+(?:именно\s+)?(?:говор(?:ит|ится)|сказано|написано|указано|пишут|пишется)\s+(?:в\s+)?(?:материал|курс|источник|тексте|занят)|что\s+(?:курс|материалы?|источник|автор)\s+(?:говор|заявл|утвержд|пиш)|как\s+(?:это\s+)?(?:описан|сформулирован|подан|назван)[оаы]?\s+(?:в\s+)?(?:материал|курс)|(?:покажи|приведи|дай|процитируй|цитир)\w*\s+(?:мне\s+)?(?:цитат|источник|выдержк|фрагмент|дослов)|на\s+ч[её]м\s+(?:это\s+)?основан|дослов(?:но|ная\s+цитата)|прям(?:ая|ую)\s+цитат)/iu;

export function isExplicitSourceAttributionRequest(query: string): boolean {
  return EXPLICIT_SOURCE_ATTRIBUTION_PATTERN.test(query);
}

export async function composeCourseFollowUpAnswer(
  messages: readonly ConversationMessage[],
  act: CourseFollowUpAct,
  options: ComposeCourseFollowUpOptions = {},
): Promise<string> {
  const course = getAcademyCourse(act.courseId);
  if (!course || course.status !== "ROUTABLE") {
    throw new Error("Follow-up course is unavailable.");
  }

  const evidence = selectedEvidence(
    options.evidenceSelection,
    options.courseEvidence,
  );
  const latestUserMessage = messages.at(-1)?.content ?? "";

  if (
    options.evidenceSelection?.status !== "SUPPORTED" ||
    evidence.length === 0
  ) {
    if (isCatalogAnswerableFollowUp(latestUserMessage)) {
      options.onOutcome?.({
        answerOrigin: "CATALOG_AUTHORITY",
        fallback: "CATALOG_FOLLOW_UP",
      });
      return composeCatalogFollowUpAnswer(
        course,
        latestUserMessage,
      );
    }

    // A structural failure is a hard failure: there is nothing to repair,
    // because there is no authority to repair against. No composition runs and
    // no repair is attempted.
    options.onGroundingEvent?.({
      stage: "FACTUAL_CEILING_STRUCTURAL",
      courseId: act.courseId,
      reasonCode: null,
      errorName: null,
      selectedEvidenceCount: evidence.length,
      repairAttempted: false,
    });
    options.onOutcome?.({
      answerOrigin: "FACTUAL_CEILING",
      fallback: "FACTUAL_CEILING",
    });
    return composeCourseFactualCeilingAnswer(course.title);
  }

  const callText = options.callText ?? callDeepSeekText;
  const authority = coursePublicPayload(course, evidence);
  const userContext = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content);

  // CORR3.CONVERSATION-REPAIR-AND-FOLLOWUP-1 (D3) — voice selection. An ordinary
  // grounded content question is answered in a direct teaching voice; source
  // attribution is reserved for an explicit source request (or evidenceRequested).
  const preferDirectVoice =
    !act.evidenceRequested &&
    !isExplicitSourceAttributionRequest(latestUserMessage);

  const voiceInstruction = preferDirectVoice
    ? `ГОЛОС ОТВЕТА — по умолчанию прямой обучающий:
- объясняй понятие напрямую («S–O активность — это ...»), а не через рамку внешнего пересказа;
- НЕ обрамляй обычный содержательный ответ повторяющейся атрибуцией «курс говорит», «курс заявляет», «курс также заявляет», «в материалах курса это описывается/поясняется как ...»;
- атрибуцию к источнику оставляй только там, где она несёт смысл: спор или противоречие в evidence, обозначение неопределённости, утверждение, специфичное именно для источника, или фактический потолок;
- содержательная граница авторитета при этом НЕ меняется: по-прежнему отвечай строго из evidence и полей course, без общих знаний.`
    : `ГОЛОС ОТВЕТА — пользователь спрашивает про источник:
- пользователь прямо просит показать или назвать, что именно сказано в материалах курса, поэтому атрибуция к источнику здесь уместна и ожидаема;
- всё равно отвечай строго из переданного evidence и полей course, без общих знаний.`;

  const composerSystemPrompt = `Ты — публичный Навигатор Академии структурной типологии.

Ответь ТОЛЬКО на последнюю реплику пользователя как на follow-up по уже обсуждаемому курсу.
Не выбирай курс заново и не повторяй полный recommendation template.

КРИТИЧЕСКАЯ ГРАНИЦА АВТОРИТЕТА:
- используй только authorityPayload;
- НЕ используй общие знания модели;
- НЕ используй предыдущие ответы assistant как фактический источник;
- предыдущие сообщения assistant намеренно не передаются как authority;
- научная/эмпирическая оценка допустима только если прямо подтверждена evidence, и тогда формулируй её как утверждение подключённого материала курса, а не как внешний научный консенсус;
- не придумывай формат курса, упражнения, психологическую безопасность, эффективность, поддержку, преподавателей, контакты или гарантии;
- если делаешь практический вывод, явно обозначь его словами "из этого следует", "это может означать" или аналогично и не добавляй новых фактов.

ЗАПРЕЩЁННЫЕ ПАТТЕРНЫ ВЫХОДА ЗА ГРАНИЦУ АВТОРИТЕТА:
- НЕ строй отрицательные сравнения вида "это X, а не Y", если Y отсутствует в evidence — не привноси из общих знаний то, чем понятие НЕ является;
- НЕ делай утверждений о структуре, составе или полноте материалов курса ("это отдельный слой курса", "подтверждается тремя местами", "в другом занятии") — ты не знаешь структуру курса за пределами переданного evidence;
- НЕ вводи терминологию или категории, которых нет в evidence, для организации ответа — используй только ту лексику, которая присутствует в переданных цитатах и полях course;
- НЕ делай педагогических рекомендаций, предложений к действию или мета-комментариев, не подтверждённых evidence ("можно разобрать на примере", "стоит обратить внимание");
- НЕ утверждай количество источников, подтверждений или мест в материалах.

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ФОРМУЛИРОВКИ:
- отвечай строго из переданного evidence и полей course;
- сохраняй контринтуитивные утверждения источника в точности — не смягчай и не переформулируй;
- сохраняй оговорки и ограничения, присутствующие в evidence;
- если evidence не поддерживает запрошенное утверждение — скажи это прямо, а не заполняй из общих знаний;
- чётко отличай прямые утверждения источника от своих выводов.

${voiceInstruction}

${addressStyleInstruction(options.profile)}

Если evidenceRequested=false, не показывай пользователю сырые цитаты, названия внутренних документов, страницы и provenance.
Если evidenceRequested=true, список точных цитат и provenance будет добавлен системой после твоего ответа.
Не раскрывай внутренние формулы, служебные labels или технические обозначения, если пользователь сам прямо о них не спрашивает.
Пиши по-русски, коротко и по существу.`;

  const composerUserPayload = JSON.stringify(
    {
      latestUserMessage,
      userContext,
      evidenceRequested: act.evidenceRequested,
      authorityPayload: authority,
    },
    null,
    2,
  );

  const answer = await callText(
    [
      { role: "system", content: composerSystemPrompt },
      { role: "user", content: composerUserPayload },
    ],
    options,
  );

  const deliver = (delivered: string): string => {
    options.onOutcome?.({
      answerOrigin: "RAG_EVIDENCE",
      fallback: "NONE",
    });

    if (!act.evidenceRequested) {
      return delivered;
    }

    return [
      delivered,
      "Основание в подключённых материалах:",
      ...evidence.map(
        (item) => `• «${item.quote}» — ${item.source}`,
      ),
    ].join("\n\n");
  };

  // The rejected candidate is never returned to the user on any failing branch:
  // it is only ever an input to the single repair composition.
  const factualCeiling = (
    stage: "FACTUAL_CEILING_AUDIT",
    reasonCode: NavigatorGroundingDetails["reasonCode"],
    errorName: string | null,
    repairAttempted: boolean,
  ): string => {
    options.onGroundingEvent?.({
      stage,
      courseId: act.courseId,
      reasonCode,
      errorName,
      selectedEvidenceCount: evidence.length,
      repairAttempted,
    });
    options.onOutcome?.({
      answerOrigin: "FACTUAL_CEILING",
      fallback: "FACTUAL_CEILING",
    });
    return composeCourseFactualCeilingAnswer(course.title);
  };

  const primary = await runGroundingAudit(
    answer,
    latestUserMessage,
    authority,
    options,
  );

  if (primary.kind === "ERROR") {
    // Malformed or failed audit state is fail-closed and is NOT repaired:
    // there is no valid verdict to repair against.
    options.onGroundingEvent?.({
      stage: "PRIMARY_AUDIT_ERROR",
      courseId: act.courseId,
      reasonCode: null,
      errorName: primary.errorName,
      selectedEvidenceCount: evidence.length,
      repairAttempted: false,
    });
    return factualCeiling("FACTUAL_CEILING_AUDIT", null, primary.errorName, false);
  }

  if (primary.audit.status === "PASS") {
    options.onGroundingEvent?.({
      stage: "PRIMARY_AUDIT_PASS",
      courseId: act.courseId,
      reasonCode: null,
      errorName: null,
      selectedEvidenceCount: evidence.length,
      repairAttempted: false,
    });
    return deliver(answer);
  }

  const primaryReasonCode = primary.audit.reasonCode;
  options.onGroundingEvent?.({
    stage: "PRIMARY_AUDIT_FAIL",
    courseId: act.courseId,
    reasonCode: primaryReasonCode,
    errorName: null,
    selectedEvidenceCount: evidence.length,
    repairAttempted: false,
  });

  // Exactly ONE repair opportunity. Straight-line code, no loop: there is no
  // second repair and no third audit anywhere below this point.
  options.onGroundingEvent?.({
    stage: "REPAIR_ATTEMPTED",
    courseId: act.courseId,
    reasonCode: primaryReasonCode,
    errorName: null,
    selectedEvidenceCount: evidence.length,
    repairAttempted: true,
  });

  let repaired: string;
  try {
    repaired = await callText(
      [
        { role: "system", content: composerSystemPrompt },
        {
          role: "system",
          content: groundingRepairInstruction(primaryReasonCode),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              latestUserMessage,
              userContext,
              evidenceRequested: act.evidenceRequested,
              // Identical authority: no new retrieval, no new selector call,
              // no new evidence, no new source, no course change.
              authorityPayload: authority,
              rejectedAnswer: answer,
              auditReasonCode: primaryReasonCode,
            },
            null,
            2,
          ),
        },
      ],
      options,
    );
  } catch (error) {
    return factualCeiling(
      "FACTUAL_CEILING_AUDIT",
      primaryReasonCode,
      error instanceof Error ? error.name : "UnknownError",
      true,
    );
  }

  const second = await runGroundingAudit(
    repaired,
    latestUserMessage,
    authority,
    options,
  );

  if (second.kind === "ERROR") {
    options.onGroundingEvent?.({
      stage: "REPAIR_AUDIT_ERROR",
      courseId: act.courseId,
      reasonCode: primaryReasonCode,
      errorName: second.errorName,
      selectedEvidenceCount: evidence.length,
      repairAttempted: true,
    });
    return factualCeiling(
      "FACTUAL_CEILING_AUDIT",
      primaryReasonCode,
      second.errorName,
      true,
    );
  }

  if (second.audit.status !== "PASS") {
    options.onGroundingEvent?.({
      stage: "REPAIR_AUDIT_FAIL",
      courseId: act.courseId,
      reasonCode: second.audit.reasonCode,
      errorName: null,
      selectedEvidenceCount: evidence.length,
      repairAttempted: true,
    });
    return factualCeiling(
      "FACTUAL_CEILING_AUDIT",
      second.audit.reasonCode,
      null,
      true,
    );
  }

  options.onGroundingEvent?.({
    stage: "REPAIR_AUDIT_PASS",
    courseId: act.courseId,
    reasonCode: primaryReasonCode,
    errorName: null,
    selectedEvidenceCount: evidence.length,
    repairAttempted: true,
  });

  return deliver(repaired);
}
