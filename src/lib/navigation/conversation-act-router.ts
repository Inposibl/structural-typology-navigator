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

  throw new ConversationActDecisionValidationError(
    `Unsupported conversation act: ${String(value.state)}.`,
  );
}

function conversationActSystemPrompt(): string {
  return `Ты — внутренний диспетчер диалога образовательного Навигатора Академии структурной типологии.

ТВОЯ ЗАДАЧА:
определить, что означает ИМЕННО ПОСЛЕДНЯЯ реплика пользователя в текущем разговоре, и вернуть только JSON. Ты не выбираешь курс и не пишешь пользователю ответ.

КРИТИЧЕСКОЕ ПРАВИЛО ПОСЛЕДНЕГО ХОДА:
- последняя USER-реплика имеет решающий приоритет при определении текущего conversational act;
- более ранняя образовательная тема — только контекст и НЕ имеет права перетянуть новую несвязанную реплику обратно в прежний курс;
- если пользователь сменил тему на общий вопрос вне функций Академии, это OUT_OF_SCOPE, даже если раньше уже был рекомендован курс;
- если пользователь отвечает на уточняющий вопрос Навигатора или продолжает описывать свою учебную задачу, это NAVIGATE.

РАЗРЕШЕНЫ РОВНО ПЯТЬ state:

1. NAVIGATE
Используй, когда последняя реплика:
- описывает новую образовательную/управленческую/профессиональную ситуацию для подбора курса Академии;
- отвечает на уточняющий вопрос Навигатора ради выбора курса;
- просит подобрать курс или уточнить учебный маршрут.
Если реплика содержит новые факты о задаче пользователя, добавь newTaskEvidence — точную цитату до 240 символов. Просьбы "выбери любой", "порекомендуй хоть что-нибудь" и их перефразировки НЕ являются новыми фактами и возвращаются без newTaskEvidence.

2. COURSE_FOLLOW_UP
Используй, когда курс Академии уже реально упоминался в разговоре и последняя реплика спрашивает именно о нём или о сделанной рекомендации: что это за курс, почему он подходит, что значит упомянутая идея, что в курсе разбирают, на чём основана рекомендация.
courseId должен указывать только на реально упомянутый в разговоре ROUTABLE курс.
evidenceRequested=true ТОЛЬКО если пользователь явно просит источники, цитаты, документы, страницы, доказательство из материалов или спрашивает, откуда конкретно это взято. Обычное "почему этот курс?" само по себе не требует сырых цитат.

3. META
Используй, когда пользователь спрашивает о поведении самого Навигатора: зачем он задаёт вопрос, зачем показывает ссылки/цитаты, что он умеет, почему так ответил, какова его функция или границы.

4. OUT_OF_SCOPE
Используй, когда последняя реплика — новая тема, не связанная с выбором, пониманием или обсуждением курсов Академии. Например общий поиск компаний, погода, новости, бытовой вопрос, программирование, покупки и т.п.
Не пытайся притянуть такую реплику к старой образовательной теме.

5. FACTUAL
Используй для фактов об Академии, каталоге, психологической границе, цене/расписании/потоке/окне набора и нейтрального сравнения курсов. Верни intents (1–3) из закрытого набора:
- {"kind":"ACADEMY_OVERVIEW"}
- {"kind":"CATALOG_LIST"}
- {"kind":"PSYCHOLOGY_BOUNDARY"}
- {"kind":"CURRENT_METADATA","courseIds":[],"fields":["PRICE"],"scope":"SELECTED"}
- {"kind":"COURSE_COMPARISON","courseIds":["id-1","id-2"],"hasUnknownCourse":false}
Для всех курсов используй scope=ALL. Для названных — REFERENCED. Не выдумывай ID. Если в сравнении одно название неизвестно каталогу, передай только известный ID и hasUnknownCourse=true. Вопрос "какой лучше мне" — NAVIGATE, не FACTUAL.

JSON FORMAT:
{"state":"NAVIGATE"}
{"state":"NAVIGATE","newTaskEvidence":"точная цитата нового факта"}
{"state":"COURSE_FOLLOW_UP","courseId":"course-id","evidenceRequested":false}
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
  const catalog = getRoutingCourseSummaries().map((course) => ({
    id: course.id,
    title: course.title,
    status: course.status,
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
