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
  | { state: "ROUTER_DEGRADED" };

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

РАЗРЕШЕНЫ РОВНО ШЕСТЬ state:

1. NAVIGATE
Используй, когда последняя реплика:
- описывает новую образовательную/управленческую/профессиональную ситуацию для подбора курса Академии;
- отвечает на уточняющий вопрос Навигатора ради выбора курса;
- просит подобрать курс или уточнить учебный маршрут;
- выражает намерение записаться, оплатить или купить курс/обучение в Академии (включая общие вопросы «как оплатить/записаться на курс?», «хочу купить курс по типологии»).
Если реплика содержит новые факты о задаче пользователя, добавь newTaskEvidence — точную цитату до 240 символов. Просьбы "выбери любой", "порекомендуй хоть что-нибудь" и их перефразировки НЕ являются новыми фактами и возвращаются без newTaskEvidence.

2. COURSE_FOLLOW_UP
Используй, когда курс Академии уже реально упоминался в разговоре и последняя реплика спрашивает именно о нём или о сделанной рекомендации: что это за курс, почему он подходит, что значит упомянутая идея, что в курсе разбирают, на чём основана рекомендация.
courseId должен указывать только на реально упомянутый в разговоре ROUTABLE курс.
evidenceRequested=true ТОЛЬКО если пользователь явно просит источники, цитаты, документы, страницы, доказательство из материалов или спрашивает, откуда конкретно это взято. Обычное "почему этот курс?" само по себе не требует сырых цитат.

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

6. COURSE_CONTENT
Используй, когда последняя реплика — содержательный вопрос по МАТЕРИАЛУ курса Академии: определение понятия, механизм, факт из материалов, таблица, различение терминов, "почему/как это работает" по предмету курса. Решающее условие: НИ ОДИН курс каталога не назван в разговоре. Если курс уже назван в разговоре — это COURSE_FOLLOW_UP, а не COURSE_CONTENT.
courseId — тот единственный курс, к материалам которого относится вопрос. Выбирай только из catalog, бери только курсы со status "ROUTABLE". Если вопрос относится к курсу со status "LISTED_UNROUTABLE", верни не COURSE_CONTENT, а NAVIGATE.
contentIntentEvidence — точная цитата (3–240 символов) из ПОСЛЕДНЕЙ реплики пользователя, которая показывает, что это вопрос по материалу курса. Цитата обязана быть дословной подстрокой последней реплики.
evidenceRequested=true ТОЛЬКО если пользователь явно просит источники, цитаты, документы, страницы, доказательство из материалов.

COURSE_CONTENT — НЕ для:
- цены, расписания, потока, окна набора, состава каталога, обзора Академии, психологической границы — это FACTUAL;
- просьбы подобрать/порекомендовать курс — это NAVIGATE;
- оплаты, записи, стоимости участия как действия — это не COURSE_CONTENT (оплата/запись на курс — это NAVIGATE, вопрос о цене — FACTUAL);
- просьбы связаться с менеджером, телефона, Telegram — это не COURSE_CONTENT;
- приветствий, благодарностей, болтовни, вопросов о самом Навигаторе — это META или OUT_OF_SCOPE;
- посторонних тем — это OUT_OF_SCOPE.
Не отправляй в COURSE_CONTENT вопрос, который можно закрыть каталогом или ценой.

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

  return validateConversationActDecision(raw, messages);
}
