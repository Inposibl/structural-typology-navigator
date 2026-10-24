import type { ConversationMessage } from "../chat-contract.ts";
import {
  getAcademyCourse,
  getRoutingCourseSummaries,
  isRecommendableCourseId,
} from "../academy/course-catalog.ts";
import {
  isAcademyCourseId,
  type AcademyCourseId,
} from "../academy/course-reference.ts";
import { getCourseIdentityScope } from "../academy/course-identity-scope.ts";
import { ACADEMY_COMMERCIAL_AUTHORITY } from "../academy/commercial-authority.ts";
import { hasEnrollmentPaymentIntent } from "../academy/payment-policy.ts";
import {
  contentGate,
  establishedCourseReference,
  establishingSentences,
  followUpWithoutLiteral,
  type UnresolvedReason,
} from "./course-reference-evidence.ts";
import { detectRequestedFamilies } from "./metadata-field-consistency.ts";
import {
  callDeepSeekJson,
  type DeepSeekClientOptions,
} from "./deepseek-client.ts";

export type CurrentMetadataField =
  | "PRICE"
  | "SCHEDULE"
  | "COHORT"
  | "ENROLLMENT_WINDOW";

export type FactualIntent =
  | { kind: "ACADEMY_OVERVIEW" }
  | { kind: "PSYCHOLOGY_BOUNDARY" }
  | { kind: "CATALOG_LIST" }
  | {
      kind: "CURRENT_METADATA";
      courseIds: AcademyCourseId[];
      fields: CurrentMetadataField[];
      scope: "REFERENCED" | "SELECTED" | "ALL";
    }
  | {
      kind: "COURSE_COMPARISON";
      courseIds: AcademyCourseId[];
      hasUnknownCourse: boolean;
    };

export type ConversationActDecision =
  | { state: "NAVIGATE"; newTaskEvidence?: string }
  | { state: "META" }
  | { state: "OUT_OF_SCOPE" }
  | { state: "FACTUAL"; intents: FactualIntent[] }
  | {
      state: "COURSE_FOLLOW_UP";
      courseId: string;
      evidenceRequested: boolean;
    }
  /**
   * EXPERIMENT-1.ROUTER-ACCESS-1 — the act the taxonomy was missing: the user
   * asks a question that is answerable from Academy course material, without
   * that material having been named in the conversation. `contentIntentEvidence`
   * is the structural anti-hallucination guard, identical in discipline to
   * NAVIGATE.newTaskEvidence: the decision must be anchored in verbatim user
   * text, while the course binding is the router's own inference and is
   * measured, not assumed.
   */
  | {
      state: "COURSE_CONTENT";
      courseId: string;
      evidenceRequested: boolean;
      contentIntentEvidence: string;
    }
  /**
   * EXPERIMENT-1.ROUTER-ACCESS-1 — the fail-closed lane. Produced only by the
   * orchestrator when the provider's act decision fails validation; the model
   * can never select it, because validation rejects the state outright. It
   * carries no course, no evidence and no RAG authority.
   */
  | { state: "ROUTER_DEGRADED" }
  /**
   * NAVIGATOR-ACT-ROUTER-ALIAS-CORRECTION-1 — server-derived controlled
   * uncertainty. Returned (never thrown) by the validator when a well-formed
   * COURSE_FOLLOW_UP has no literal authority but refers to a course, or when a
   * well-formed COURSE_CONTENT conflicts with the course references of its own
   * question region. Model-unselectable: validation rejects this state as input.
   * `proposed` is exactly the decision the pre-correction validator would have
   * produced (CONTENT) or rejected (FOLLOW_UP), so the orchestrator can keep
   * every commercial/contact precedence identical. It binds no course.
   */
  | {
      state: "COURSE_REFERENCE_UNRESOLVED";
      proposed:
        | { state: "COURSE_FOLLOW_UP"; courseId: string; evidenceRequested: boolean }
        | {
            state: "COURSE_CONTENT";
            courseId: string;
            evidenceRequested: boolean;
            contentIntentEvidence: string;
          };
      reason: UnresolvedReason;
      referencedCourseIds: string[];
    };

export class ConversationActDecisionValidationError extends Error {
  readonly code = "INVALID_CONVERSATION_ACT_DECISION";

  constructor(message: string) {
    super(message);
    this.name = "ConversationActDecisionValidationError";
  }
}

export type RouteConversationActOptions = DeepSeekClientOptions & {
  callJson?: typeof callDeepSeekJson;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function courseWasActuallyInConversation(
  courseId: string,
  messages: readonly ConversationMessage[],
): boolean {
  const course = getAcademyCourse(courseId);
  if (!course) return false;

  return messages.some(
    (message) =>
      message.content.includes(course.title) ||
      (course.url !== null && message.content.includes(course.url)),
  );
}

/**
 * PRODUCTION-IMPLEMENTATION-1.CORR1 F-1 — the COURSE_CONTENT precondition.
 *
 * COURSE_CONTENT exists for exactly one case: a substantive question about course
 * material asked when NO catalog course has been named. The moment any catalog
 * course is present in the conversation, the stricter COURSE_FOLLOW_UP binding
 * semantics govern, and COURSE_CONTENT must not be able to bypass them by binding
 * some other course.
 *
 * This deliberately reuses `courseWasActuallyInConversation` — the same title/URL
 * presence semantics COURSE_FOLLOW_UP already binds on — rather than introducing a
 * second, inconsistent detector. The whole catalog is scanned, including
 * LISTED_UNROUTABLE entries, so naming an unroutable course cannot open a rebinding
 * path to a routable one.
 */
function anyCourseWasActuallyInConversation(
  messages: readonly ConversationMessage[],
): boolean {
  return getRoutingCourseSummaries().some((course) =>
    courseWasActuallyInConversation(course.id, messages),
  );
}

const CURRENT_METADATA_FIELDS: readonly CurrentMetadataField[] = [
  "PRICE",
  "SCHEDULE",
  "COHORT",
  "ENROLLMENT_WINDOW",
];

/**
 * MAJOR-REMEDIATION-1 (V-MAJ-01) — the timing fields the unchanged metadata
 * composer may narrate: only those the commercial authority marks as having no
 * authoritative value (the composer always states them as unavailable).
 */
function unavailableTimingFields(): CurrentMetadataField[] {
  const metadata = ACADEMY_COMMERCIAL_AUTHORITY.transactionalMetadata;
  const timing: ReadonlyArray<readonly [CurrentMetadataField, keyof typeof metadata]> = [
    ["SCHEDULE", "schedule"],
    ["COHORT", "cohort"],
    ["ENROLLMENT_WINDOW", "enrollmentWindow"],
  ];
  return timing
    .filter(([, key]) =>
      metadata[key].status === "UNAVAILABLE" &&
      metadata[key].reason === "NO_AUTHORITATIVE_VALUE"
    )
    .map(([field]) => field);
}

/**
 * MAJOR-REMEDIATION-1.CORR2 — the commercial metadata fields a request asks
 * for: PRICE, and only the timing fields above. One derivation shared by the
 * A1 re-validation and the literal re-validation (F-03), so both paths can
 * only ever produce the same closed field set.
 */
function commercialMetadataFields(text: string): CurrentMetadataField[] {
  const families = detectRequestedFamilies(text);
  return [
    ...(families.includes("PRICE") ? (["PRICE"] as const) : []),
    ...(families.includes("TIMING") ? unavailableTimingFields() : []),
  ];
}

function currentMetadataDecision(
  courseId: string,
  fields: CurrentMetadataField[],
): ConversationActDecision {
  return {
    state: "FACTUAL",
    intents: [
      {
        kind: "CURRENT_METADATA",
        courseIds: [courseId as AcademyCourseId],
        fields,
        scope: "REFERENCED",
      },
    ],
  };
}

/**
 * MAJOR-REMEDIATION-1.CORR2 (F-01) — the closed commercial request tests:
 * `requestsCommercialMetadata` is a PRICE or TIMING metadata subject (the
 * FIX-4b closed families); `carriesCommercialRequest` is that, or the payment
 * policy's own enrollment/payment intent.
 */
function requestsCommercialMetadata(text: string): boolean {
  const families = detectRequestedFamilies(text);
  return families.includes("PRICE") || families.includes("TIMING");
}

function carriesCommercialRequest(text: string): boolean {
  return requestsCommercialMetadata(text) || hasEnrollmentPaymentIntent(text);
}

/**
 * MAJOR-REMEDIATION-1.CORR2 (F-01) — commercial applicability of a course
 * reference that has no literal catalog title/URL in the conversation.
 *
 * A1 recognises the course for content; it does not by itself establish that
 * the product the user refers to is offered by the Academy. Academy price,
 * timing or payment authority is therefore granted to such a reference only
 * when a user sentence that names the course is itself a request to the
 * Navigator: a question, or the commercial request itself. A report about a
 * course («Школа феникс запустила курс про Маслоу.») grounds content identity
 * at most, never Academy commercial or payment authority; the request then
 * keeps the unchanged uncertainty. No school, platform or provider lexicon is
 * consulted: the witness is positive and structural.
 */
function commerciallyGrounded(
  messages: readonly ConversationMessage[],
  courseId: string,
): boolean {
  const sentences = establishingSentences(messages, courseId);
  return (
    sentences !== null &&
    sentences.some(
      (sentence) => sentence.question || carriesCommercialRequest(sentence.text),
    )
  );
}

/**
 * PREVIEW-LIVE-DEEPSEEK-VERIFICATION-1.MAJOR-REMEDIATION-1 (V-MAJ-01) —
 * reference precedence for a COURSE_FOLLOW_UP that failed the literal predicate.
 *
 * Live, a fresh question naming one catalog course by a short or partial title
 * («курса „Иерархия потребностей А. Маслоу“», «курсе „Игра и творчество“») was
 * proposed as COURSE_FOLLOW_UP and then refused as an unestablished follow-up.
 * That request is the prompt's own «КОРОТКОЕ НАЗВАНИЕ ОДНОГО КУРСА» case. Only
 * when no catalog course is literally present (the unchanged COURSE_CONTENT F-1
 * precondition) and the user's own words establish exactly the proposed course
 * is the request re-validated as the act its subject requires. No follow-up
 * authority is granted (P1-0 unchanged):
 *   - a price/payment or timing subject (the FIX-4b closed families) becomes
 *     FACTUAL CURRENT_METADATA for that course under commercial authority;
 *   - any other subject becomes COURSE_CONTENT anchored on the latest message,
 *     kept only when the unchanged question-anchored content gate accepts it.
 * Every other case returns null and keeps the unchanged uncertainty/rejection.
 */
function establishedReferenceDecision(
  messages: readonly ConversationMessage[],
  courseId: string,
  evidenceRequested: boolean,
): ConversationActDecision | null {
  if (anyCourseWasActuallyInConversation(messages)) return null;
  if (establishedCourseReference(messages, courseId) === null) return null;

  const latestUserMessage = messages.at(-1)?.content ?? "";
  // MAJOR-REMEDIATION-1.CORR2 (F-01) — commercial authority needs its own
  // grounding; without it the request keeps the unchanged uncertainty.
  if (
    carriesCommercialRequest(latestUserMessage) &&
    !commerciallyGrounded(messages, courseId)
  ) {
    return null;
  }
  const fields = commercialMetadataFields(latestUserMessage);
  if (fields.length > 0) {
    return currentMetadataDecision(courseId, fields);
  }

  if (
    latestUserMessage.trim().length < 3 ||
    latestUserMessage.length > 240 ||
    contentGate(messages, courseId, latestUserMessage).kind !== "ACCEPT"
  ) {
    return null;
  }
  return {
    state: "COURSE_CONTENT",
    courseId,
    evidenceRequested,
    contentIntentEvidence: latestUserMessage,
  };
}

/**
 * MAJOR-REMEDIATION-1.CORR2 (F-03) — a provider-proposed literal
 * COURSE_FOLLOW_UP whose subject is commercial metadata (PRICE / timing) is
 * answered from commercial authority, not from course-content RAG sufficiency
 * (the E02 «А сколько он стоит?» after a catalog answer that carries the full
 * title). It is applied to the provider's proposal in `routeConversationAct`
 * only: `validateConversationActDecision` stays the unchanged full-conversation
 * authority that also validates server-built recovery segments, whose literal
 * EDU segments keep COURSE_FOLLOW_UP. The act becomes FACTUAL only when
 *   - the latest request asks a PRICE/timing subject and carries no
 *     enrollment/payment intent (the unchanged payment policy keeps its literal
 *     follow-up payment route);
 *   - the user's own words establish exactly this course (the A1 identity rule):
 *     either the commercial request itself names it (every sentence naming the
 *     course asks the commercial subject — a content question naming the course
 *     keeps the follow-up), or an unbroken user antecedent that is commercially
 *     grounded (F-01).
 * Every other literal follow-up, including duration and content questions, is
 * returned unchanged.
 */
function revalidateCommercialFollowUp(
  act: ConversationActDecision,
  messages: readonly ConversationMessage[],
): ConversationActDecision {
  if (act.state !== "COURSE_FOLLOW_UP") return act;
  const latestUserMessage = messages.at(-1)?.content ?? "";
  const fields = commercialMetadataFields(latestUserMessage);
  if (fields.length === 0 || hasEnrollmentPaymentIntent(latestUserMessage)) {
    return act;
  }
  const reference = establishedCourseReference(messages, act.courseId);
  const naming = establishingSentences(messages, act.courseId) ?? [];
  const established =
    reference === "ANTECEDENT"
      ? commerciallyGrounded(messages, act.courseId)
      : reference === "CURRENT_TURN" &&
        naming.length > 0 &&
        naming.every((sentence) => requestsCommercialMetadata(sentence.text));
  return established ? currentMetadataDecision(act.courseId, fields) : act;
}

function readCourseIds(value: unknown, fieldName: string): AcademyCourseId[] {
  if (
    !Array.isArray(value) ||
    value.some((courseId) =>
      typeof courseId !== "string" || !isAcademyCourseId(courseId)
    )
  ) {
    throw new ConversationActDecisionValidationError(
      `${fieldName} must contain only current catalog course IDs.`,
    );
  }

  const courseIds = [...new Set(value as AcademyCourseId[])];
  if (courseIds.length !== value.length) {
    throw new ConversationActDecisionValidationError(
      `${fieldName} cannot contain duplicate course IDs.`,
    );
  }
  return courseIds;
}

function validateFactualIntent(value: unknown): FactualIntent {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new ConversationActDecisionValidationError(
      "Factual intent must be an object with a kind.",
    );
  }

  if (
    value.kind === "ACADEMY_OVERVIEW" ||
    value.kind === "PSYCHOLOGY_BOUNDARY" ||
    value.kind === "CATALOG_LIST"
  ) {
    if (!onlyKeys(value, ["kind"])) {
      throw new ConversationActDecisionValidationError(
        `${value.kind} contains unsupported fields.`,
      );
    }
    return { kind: value.kind };
  }

  if (value.kind === "CURRENT_METADATA") {
    if (!onlyKeys(value, ["kind", "courseIds", "fields", "scope"])) {
      throw new ConversationActDecisionValidationError(
        "CURRENT_METADATA contains unsupported fields.",
      );
    }
    const courseIds = readCourseIds(value.courseIds, "CURRENT_METADATA.courseIds");
    if (
      !Array.isArray(value.fields) ||
      value.fields.length === 0 ||
      value.fields.some((field) =>
        typeof field !== "string" ||
        !CURRENT_METADATA_FIELDS.includes(field as CurrentMetadataField)
      ) ||
      new Set(value.fields).size !== value.fields.length
    ) {
      throw new ConversationActDecisionValidationError(
        "CURRENT_METADATA.fields must be a non-empty unique supported field list.",
      );
    }
    if (
      value.scope !== "REFERENCED" &&
      value.scope !== "SELECTED" &&
      value.scope !== "ALL"
    ) {
      throw new ConversationActDecisionValidationError(
        "CURRENT_METADATA.scope is invalid.",
      );
    }
    return {
      kind: "CURRENT_METADATA",
      courseIds,
      fields: value.fields as CurrentMetadataField[],
      scope: value.scope,
    };
  }

  if (value.kind === "COURSE_COMPARISON") {
    if (!onlyKeys(value, ["kind", "courseIds", "hasUnknownCourse"])) {
      throw new ConversationActDecisionValidationError(
        "COURSE_COMPARISON contains unsupported fields.",
      );
    }
    const courseIds = readCourseIds(value.courseIds, "COURSE_COMPARISON.courseIds");
    if (typeof value.hasUnknownCourse !== "boolean") {
      throw new ConversationActDecisionValidationError(
        "COURSE_COMPARISON.hasUnknownCourse must be boolean.",
      );
    }
    if (
      courseIds.length > 2 ||
      (!value.hasUnknownCourse && courseIds.length !== 2) ||
      (value.hasUnknownCourse && courseIds.length > 1)
    ) {
      throw new ConversationActDecisionValidationError(
        "COURSE_COMPARISON must resolve exactly two identities or mark an unknown identity.",
      );
    }
    return {
      kind: "COURSE_COMPARISON",
      courseIds,
      hasUnknownCourse: value.hasUnknownCourse,
    };
  }

  throw new ConversationActDecisionValidationError(
    `Unsupported factual intent: ${String(value.kind)}.`,
  );
}

export function validateConversationActDecision(
  value: unknown,
  messages: readonly ConversationMessage[],
): ConversationActDecision {
  if (!isRecord(value) || typeof value.state !== "string") {
    throw new ConversationActDecisionValidationError(
      "Conversation act decision must be an object with a state.",
    );
  }

  if (value.state === "NAVIGATE") {
    if (!onlyKeys(value, ["state", "newTaskEvidence"])) {
      throw new ConversationActDecisionValidationError(
        "NAVIGATE contains unsupported fields.",
      );
    }
    if (value.newTaskEvidence === undefined) return { state: "NAVIGATE" };
    const latestUserMessage = messages.at(-1)?.content ?? "";
    if (
      typeof value.newTaskEvidence !== "string" ||
      value.newTaskEvidence.trim().length < 3 ||
      value.newTaskEvidence.length > 240 ||
      !latestUserMessage.includes(value.newTaskEvidence)
    ) {
      throw new ConversationActDecisionValidationError(
        "NAVIGATE.newTaskEvidence must be a bounded verbatim fragment of the latest user message.",
      );
    }
    return { state: "NAVIGATE", newTaskEvidence: value.newTaskEvidence };
  }

  if (
    value.state === "META" ||
    value.state === "OUT_OF_SCOPE"
  ) {
    if (!onlyKeys(value, ["state"])) {
      throw new ConversationActDecisionValidationError(
        `${value.state} contains unsupported fields.`,
      );
    }

    return { state: value.state };
  }

  if (value.state === "FACTUAL") {
    if (!onlyKeys(value, ["state", "intents"]) || !Array.isArray(value.intents)) {
      throw new ConversationActDecisionValidationError(
        "FACTUAL must contain an intents array.",
      );
    }
    if (value.intents.length === 0 || value.intents.length > 3) {
      throw new ConversationActDecisionValidationError(
        "FACTUAL must contain between one and three closed intents.",
      );
    }
    const intents = value.intents.map(validateFactualIntent);
    if (new Set(intents.map((intent) => intent.kind)).size !== intents.length) {
      throw new ConversationActDecisionValidationError(
        "FACTUAL cannot contain duplicate intent kinds.",
      );
    }
    return { state: "FACTUAL", intents };
  }

  if (value.state === "COURSE_FOLLOW_UP") {
    if (
      !onlyKeys(value, [
        "state",
        "courseId",
        "evidenceRequested",
      ])
    ) {
      throw new ConversationActDecisionValidationError(
        "COURSE_FOLLOW_UP contains unsupported fields.",
      );
    }

    if (
      typeof value.courseId !== "string" ||
      !isRecommendableCourseId(value.courseId)
    ) {
      throw new ConversationActDecisionValidationError(
        "COURSE_FOLLOW_UP courseId must be a current routable course.",
      );
    }

    if (typeof value.evidenceRequested !== "boolean") {
      throw new ConversationActDecisionValidationError(
        "COURSE_FOLLOW_UP evidenceRequested must be boolean.",
      );
    }

    if (!courseWasActuallyInConversation(value.courseId, messages)) {
      // MAJOR-REMEDIATION-1 (V-MAJ-01) — an explicit, uniquely established
      // course reference in the user's own words is not an unestablished
      // follow-up; it is re-validated as the act its subject requires.
      const established = establishedReferenceDecision(
        messages,
        value.courseId,
        value.evidenceRequested,
      );
      if (established !== null) return established;

      // P1-0 — the literal authority above is unchanged; nothing below accepts.
      // A course reference without literal authority becomes the controlled
      // uncertainty; everything else keeps the unchanged rejection.
      const gate = followUpWithoutLiteral(messages, value.courseId);
      if (gate.kind === "UNRESOLVED") {
        return {
          state: "COURSE_REFERENCE_UNRESOLVED",
          proposed: {
            state: "COURSE_FOLLOW_UP",
            courseId: value.courseId,
            evidenceRequested: value.evidenceRequested,
          },
          reason: gate.reason,
          referencedCourseIds: gate.referencedCourseIds,
        };
      }
      throw new ConversationActDecisionValidationError(
        "COURSE_FOLLOW_UP cannot bind to a course that is absent from the conversation.",
      );
    }

    return {
      state: "COURSE_FOLLOW_UP",
      courseId: value.courseId,
      evidenceRequested: value.evidenceRequested,
    };
  }

  if (value.state === "COURSE_CONTENT") {
    if (
      !onlyKeys(value, [
        "state",
        "courseId",
        "evidenceRequested",
        "contentIntentEvidence",
      ])
    ) {
      throw new ConversationActDecisionValidationError(
        "COURSE_CONTENT contains unsupported fields.",
      );
    }

    // CORR1 F-1: the act's precondition. A conversation that has already named a
    // catalog course belongs to the existing follow-up/dialogue paths, never to
    // COURSE_CONTENT — otherwise the act becomes a rebinding bypass around the
    // stricter COURSE_FOLLOW_UP course-presence guard.
    if (anyCourseWasActuallyInConversation(messages)) {
      throw new ConversationActDecisionValidationError(
        "COURSE_CONTENT cannot be used once a catalog course is present in the conversation.",
      );
    }

    if (
      typeof value.courseId !== "string" ||
      !isRecommendableCourseId(value.courseId)
    ) {
      throw new ConversationActDecisionValidationError(
        "COURSE_CONTENT courseId must be a current routable course.",
      );
    }

    if (typeof value.evidenceRequested !== "boolean") {
      throw new ConversationActDecisionValidationError(
        "COURSE_CONTENT evidenceRequested must be boolean.",
      );
    }

    // The one anti-hallucination guard this act keeps. A course question that
    // was never named in the conversation is exactly the case this act exists
    // for, so the course title cannot be required here; what IS required is
    // that the decision be anchored in the user's own words.
    const latestUserMessage = messages.at(-1)?.content ?? "";
    if (
      typeof value.contentIntentEvidence !== "string" ||
      value.contentIntentEvidence.trim().length < 3 ||
      value.contentIntentEvidence.length > 240 ||
      !latestUserMessage.includes(value.contentIntentEvidence)
    ) {
      throw new ConversationActDecisionValidationError(
        "COURSE_CONTENT.contentIntentEvidence must be a bounded verbatim fragment of the latest user message.",
      );
    }

    // CORR5 — question-anchored course-reference consistency. Runs after every
    // unchanged check above (schema, F-1, routability, boolean, verbatim) and
    // can only turn their acceptance into the controlled uncertainty.
    const gate = contentGate(messages, value.courseId, value.contentIntentEvidence);
    if (gate.kind === "UNRESOLVED") {
      return {
        state: "COURSE_REFERENCE_UNRESOLVED",
        proposed: {
          state: "COURSE_CONTENT",
          courseId: value.courseId,
          evidenceRequested: value.evidenceRequested,
          contentIntentEvidence: value.contentIntentEvidence,
        },
        reason: gate.reason,
        referencedCourseIds: gate.referencedCourseIds,
      };
    }

    return {
      state: "COURSE_CONTENT",
      courseId: value.courseId,
      evidenceRequested: value.evidenceRequested,
      contentIntentEvidence: value.contentIntentEvidence,
    };
  }

  throw new ConversationActDecisionValidationError(
    `Unsupported conversation act: ${String(value.state)}.`,
  );
}

function conversationActSystemPrompt(): string {
  return `Ты — внутренний диспетчер диалога образовательного Навигатора Академии структурной типологии.

ТВОЯ ЗАДАЧА:
определить, что означает ИМЕННО ПОСЛЕДНЯЯ реплика пользователя в текущем разговоре, и вернуть только JSON. Ты не пишешь пользователю ответ. Курс каталога ты называешь только в COURSE_FOLLOW_UP и COURSE_CONTENT, и только чтобы указать, о материалах какого курса идёт речь.

КРИТИЧЕСКОЕ ПРАВИЛО ПОСЛЕДНЕГО ХОДА:
- последняя USER-реплика имеет решающий приоритет при определении текущего conversational act;
- более ранняя образовательная тема — только контекст и НЕ имеет права перетянуть новую несвязанную реплику обратно в прежний курс;
- если пользователь сменил тему на общий вопрос вне функций Академии, это OUT_OF_SCOPE, даже если раньше уже был рекомендован курс;
- если пользователь отвечает на уточняющий вопрос Навигатора или продолжает описывать свою учебную задачу, это NAVIGATE.

ТОЧНОЕ НАЗВАНИЕ КУРСА:
- курс catalog назван в разговоре ТОЧНО, только если его title целиком или точный адрес его страницы https://structural-typology.academy/courses/<id курса> встречается посимвольно, с учётом регистра, хотя бы в одной реплике разговора — пользователя или Навигатора;
- проверяются все курсы catalog, включая курсы со status "LISTED_UNROUTABLE";
- короткое название, сокращение, пересказ, неполное название или название в другом регистре точным названием НЕ являются.

РАЗРЕШЕНЫ РОВНО ШЕСТЬ state:

1. NAVIGATE
Используй, когда последняя реплика:
- описывает новую образовательную/управленческую/профессиональную ситуацию для подбора курса Академии;
- отвечает на уточняющий вопрос Навигатора ради выбора курса;
- просит подобрать курс или уточнить учебный маршрут;
- сообщает, какой курс Академии хочет пройти или рассматривает как вариант (в том числе названный коротко: «Хочу пройти курс Маслоу», «А ещё я рассматриваю курс …»), или заменяет прежний выбор другим курсом;
- выражает намерение записаться, оплатить или купить курс/обучение в Академии (включая общие вопросы «как оплатить/записаться на курс?», «хочу купить курс по типологии»).
Если реплика содержит новые факты о задаче пользователя, добавь newTaskEvidence — точную цитату до 240 символов. Просьбы "выбери любой", "порекомендуй хоть что-нибудь" и их перефразировки НЕ являются новыми фактами и возвращаются без newTaskEvidence.

2. COURSE_FOLLOW_UP
Используй, когда курс catalog уже назван в разговоре ТОЧНО (см. «ТОЧНОЕ НАЗВАНИЕ КУРСА») и последняя реплика спрашивает именно о нём или о сделанной рекомендации: что это за курс, почему он подходит, что значит упомянутая идея, что в курсе разбирают, на чём основана рекомендация.
courseId должен указывать только на ROUTABLE курс, чьё точное название или адрес страницы есть в разговоре.
Короткое название, сокращение или пересказ курса («курс Маслоу», «курс по структурной типологии личности») сами по себе НЕ дают основания для COURSE_FOLLOW_UP; содержательный вопрос о таком курсе — см. COURSE_CONTENT.
evidenceRequested=true ТОЛЬКО если пользователь явно просит источники, цитаты, документы, страницы, доказательство из материалов или спрашивает, откуда конкретно это взято. Обычное "почему этот курс?" само по себе не требует сырых цитат.
ДЛИТЕЛЬНОСТЬ, КОЛИЧЕСТВО ВСТРЕЧ И ФОРМАТ КУРСА:
- вопрос о длительности курса, количестве встреч или формате курса («Сколько длится этот курс?», «Сколько в нём встреч?», «Сколько часов идёт курс?», «В каком формате проходит курс?») о курсе, точное название или адрес страницы которого есть в разговоре, — COURSE_FOLLOW_UP с courseId этого курса;
- отсылка «этот курс», «он», «в нём» указывает на курс, только если из разговора однозначно ясно, о каком точно названном курсе идёт речь: например, «А сколько длится этот курс?» сразу после ответа Навигатора о курсе, точное название которого в этом ответе есть. Если точно названы несколько курсов и неясно, о каком из них вопрос, или точного названия в разговоре нет, курс не угадывай;
- КОРОТКОЕ НАЗВАНИЕ ОДНОГО КУРСА: если в разговоре НЕТ точного названия или адреса страницы ни одного курса catalog, а в последней реплике курс, о длительности или количестве встреч которого спрашивают, назван коротко, сокращением или пересказом и однозначно указывает ровно на один курс со status "ROUTABLE" («Сколько длится курс Маслоу?», «Сколько встреч в курсе про уровни сознания?»), — это COURSE_CONTENT с courseId этого курса и contentIntentEvidence — дословной цитатой этого вопроса из последней реплики. Не заменяй такой вопрос списком каталога: вопрос остаётся об этом одном курсе. Точного названия курса короткое название при этом не создаёт;
- если точное название или адрес страницы какого-либо курса catalog в разговоре есть, а в последней реплике о длительности или количестве встреч коротко назван ДРУГОЙ курс, точного названия которого в разговоре нет, — в этом единственном случае верни COURSE_FOLLOW_UP с courseId коротко названного курса как предложение: точного основания оно не даёт, сервер проверит точное название и, не найдя его, сам попросит пользователя уточнить курс. Не подменяй коротко названный курс курсом, названным точно. Если коротко назван тот же курс, точное название которого в разговоре есть, — это COURSE_FOLLOW_UP по первому пункту;
- FACTUAL с {"kind":"CATALOG_LIST"} возвращай только если: вопрос о длительности или количестве встреч курсов Академии вообще, без указания одного курса («Сколько длятся курсы Академии?»); отсылка «этот курс», «он», «в нём» не указывает однозначно ни на один точно названный курс (в разговоре нет ни одного курса или точно названы несколько и неясно, о каком из них вопрос); курс в catalog имеет status "LISTED_UNROUTABLE". В каталоге указано количество встреч каждого курса, и ни один курс при этом не угадывается;
- такой вопрос — не CURRENT_METADATA: длительность курса и количество встреч не являются ни ценой (PRICE), ни расписанием (SCHEDULE), ни потоком (COHORT), ни окном набора (ENROLLMENT_WINDOW).

3. META
Используй, когда пользователь спрашивает о поведении самого Навигатора: зачем он задаёт вопрос, зачем показывает ссылки/цитаты, что он умеет, почему так ответил, какова его функция или границы.

4. OUT_OF_SCOPE
Используй, когда последняя реплика — новая тема, не связанная с выбором, пониманием или обсуждением курсов Академии. Например:
- сторонние образовательные курсы, школы или платформы (Coursera, Udemy, Skillbox, йога, английский, Python на сторонних сайтах, другие академии и школы);
- посторонние покупки, услуги и платежи (товары, билеты, запись к врачу, коммуналка/аренда, штрафы, еда);
- общий поиск компаний, погода, новости, бытовой вопрос, программирование и т.п.
Не пытайся притянуть такую реплику к старой образовательной теме. Запись и оплата курсов Академии — это НЕ OUT_OF_SCOPE; любые сторонние курсы, внешнее обучение и посторонние покупки — это OUT_OF_SCOPE.

5. FACTUAL
Используй для фактов об Академии, каталоге, психологической границе, цене/расписании/потоке/окне набора и нейтрального сравнения курсов. Верни intents (1–3) из закрытого набора:
- {"kind":"ACADEMY_OVERVIEW"}
- {"kind":"CATALOG_LIST"}
- {"kind":"PSYCHOLOGY_BOUNDARY"}
- {"kind":"CURRENT_METADATA","courseIds":[],"fields":["PRICE"],"scope":"SELECTED"}
- {"kind":"COURSE_COMPARISON","courseIds":["id-1","id-2"],"hasUnknownCourse":false}
Для всех курсов используй scope=ALL. Для названных — REFERENCED. Не выдумывай ID. Если в сравнении одно название неизвестно каталогу, передай только известный ID и hasUnknownCourse=true. Вопрос "какой лучше мне" — NAVIGATE, не FACTUAL.
CURRENT_METADATA.fields — только PRICE (стоимость), SCHEDULE (расписание), COHORT (поток) и ENROLLMENT_WINDOW (окно набора); других полей нет, не придумывай поля вроде DURATION, MEETINGS или FORMAT. PRICE выбирай только для вопроса о стоимости или цене: вопрос о длительности курса или количестве встреч — не вопрос о цене, не подставляй вместо него PRICE или другое поле (см. «ДЛИТЕЛЬНОСТЬ, КОЛИЧЕСТВО ВСТРЕЧ И ФОРМАТ КУРСА»).

6. COURSE_CONTENT
Используй, когда последняя реплика — содержательный вопрос по МАТЕРИАЛУ курса Академии: определение понятия, механизм, факт из материалов, таблица, различение терминов, "почему/как это работает" по предмету курса, что курс разбирает или что он даёт для понимания темы или работы с ней.
Решающее условие: в разговоре НЕТ точного названия или адреса страницы ни одного курса catalog (см. «ТОЧНОЕ НАЗВАНИЕ КУРСА»: все реплики любой роли, все курсы catalog, включая LISTED_UNROUTABLE). Если точное название или адрес страницы любого курса catalog уже есть в разговоре, COURSE_CONTENT не используй.
Если курс Академии назван только коротко, сокращением или пересказом («курс Маслоу», «курс по структурной типологии личности», «курс про уровни сознания») и последняя реплика — содержательный вопрос о его материале, это COURSE_CONTENT, а не COURSE_FOLLOW_UP и не NAVIGATE. Пример: «Что даёт курс по структурной типологии личности для работы с типологией Майерс-Бриггс?» — COURSE_CONTENT, courseId structural-typology.
courseId — тот единственный курс, к материалам которого относится вопрос. Выбирай только из catalog, бери только курсы со status "ROUTABLE". Если вопрос относится к курсу со status "LISTED_UNROUTABLE", верни не COURSE_CONTENT, а NAVIGATE.
КУРС-КОНТЕЙНЕР: если пользователь явно указывает, о каком курсе спрашивает («на курсе X», «в курсе X», «курс X» — в том числе коротким названием или пересказом), courseId — именно этот явно запрошенный курс. Тема вопроса курс не меняет: даже если она совпадает с названием или предметом другого курса catalog, courseId остаётся запрошенным курсом. Пример: «Что на курсе Маслоу говорят о нормативной ситуации» — COURSE_CONTENT, courseId maslow, а не normative-situation. Отсылки «там», «в нём», «на этом курсе» сами по себе не являются явным указанием курса.
contentIntentEvidence — точная цитата (3–240 символов) из ПОСЛЕДНЕЙ реплики пользователя, которая показывает, что это вопрос по материалу курса. Цитата обязана быть дословной подстрокой последней реплики.
evidenceRequested=true ТОЛЬКО если пользователь явно просит источники, цитаты, документы, страницы, доказательство из материалов.

COURSE_CONTENT — НЕ для:
- цены, расписания, потока, окна набора, состава каталога, обзора Академии, психологической границы — это FACTUAL (в том числе «Сколько стоит курс Маслоу?»);
- длительности курса или количества встреч — это COURSE_FOLLOW_UP или FACTUAL CATALOG_LIST (см. «ДЛИТЕЛЬНОСТЬ, КОЛИЧЕСТВО ВСТРЕЧ И ФОРМАТ КУРСА»), а не COURSE_CONTENT; единственное исключение — курс, однозначно названный в последней реплике коротко, когда точного названия или адреса страницы ни одного курса catalog в разговоре нет: это COURSE_CONTENT (см. «КОРОТКОЕ НАЗВАНИЕ ОДНОГО КУРСА»);
- просьбы подобрать/порекомендовать курс, желания пройти курс или рассматривать его как вариант (в том числе названный коротко: «Хочу пройти курс Маслоу») — это NAVIGATE;
- курса или программы, которых нет в catalog, и курсов сторонних платформ и школ — не подменяй их похожим курсом catalog (см. OUT_OF_SCOPE);
- оплаты, записи, стоимости участия как действия — это не COURSE_CONTENT (оплата/запись на курс — это NAVIGATE, вопрос о цене — FACTUAL);
- просьбы связаться с менеджером, телефона, Telegram — это не COURSE_CONTENT;
- приветствий, благодарностей, болтовни, вопросов о самом Навигаторе — это META или OUT_OF_SCOPE;
- посторонних тем — это OUT_OF_SCOPE.
Не отправляй в COURSE_CONTENT вопрос, который можно закрыть каталогом или ценой.
Исключение — вопрос о длительности или количестве встреч одного курса, однозначно названного в последней реплике коротко, когда точного названия или адреса страницы ни одного курса catalog в разговоре нет: это COURSE_CONTENT, а не список каталога (см. «КОРОТКОЕ НАЗВАНИЕ ОДНОГО КУРСА»).

JSON FORMAT:
{"state":"NAVIGATE"}
{"state":"NAVIGATE","newTaskEvidence":"точная цитата нового факта"}
{"state":"COURSE_FOLLOW_UP","courseId":"course-id","evidenceRequested":false}
{"state":"COURSE_CONTENT","courseId":"course-id","evidenceRequested":false,"contentIntentEvidence":"точная цитата из последней реплики"}
{"state":"META"}
{"state":"OUT_OF_SCOPE"}
{"state":"FACTUAL","intents":[{"kind":"CATALOG_LIST"}]}

Никакого текста вне JSON.`;
}

export async function routeConversationAct(
  messages: readonly ConversationMessage[],
  options: RouteConversationActOptions = {},
): Promise<ConversationActDecision> {
  const callJson = options.callJson ?? callDeepSeekJson;
  // EXPERIMENT-3.COURSE-IDENTITY-SURFACE-1.
  //
  // The router previously saw `{id, title, status}`. A title is an entry point,
  // not a corpus description, and COURSE_BINDING-ROOT-CAUSE-1 attributed 11 of
  // its 12 wrong bindings to exactly that: no router-visible identity signal
  // adequate to the question. Each course now additionally carries ONE governed,
  // corpus-derived subject-matter descriptor.
  //
  // Nothing else is added: no aliases, no learningNeeds, no siteOutcomes, no
  // audienceSignals, no source slugs, no document list, no embedding or RAG
  // metadata. A course without a descriptor keeps its title and status exactly
  // as before, so this field can enrich an identity but never gates one.
  const catalog = getRoutingCourseSummaries().map((course) => ({
    id: course.id,
    title: course.title,
    status: course.status,
    scope: getCourseIdentityScope(course.id),
  }));

  const latestUserMessageIndex = messages.length - 1;
  const raw = await callJson(
    [
      { role: "system", content: conversationActSystemPrompt() },
      {
        role: "user",
        content:
          "Определи conversational act последней реплики и верни JSON.\n\n" +
          JSON.stringify(
            {
              latestUserMessageIndex,
              courses: catalog,
              conversation: messages.map((message, messageIndex) => ({
                messageIndex,
                role: message.role,
                content: message.content,
              })),
            },
            null,
            2,
          ),
      },
    ],
    options,
  );

  return revalidateCommercialFollowUp(
    validateConversationActDecision(raw, messages),
    messages,
  );
}
