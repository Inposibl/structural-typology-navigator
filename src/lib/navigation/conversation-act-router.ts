import type { ConversationMessage } from "../chat-contract.ts";
import {
  getAcademyCourse,
  getRoutingCourseSummaries,
  isRecommendableCourseId,
} from "../academy/course-catalog.ts";
import {
  callDeepSeekJson,
  type DeepSeekClientOptions,
} from "./deepseek-client.ts";

export type ConversationActDecision =
  | { state: "NAVIGATE" }
  | { state: "META" }
  | { state: "OUT_OF_SCOPE" }
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

export function validateConversationActDecision(
  value: unknown,
  messages: readonly ConversationMessage[],
): ConversationActDecision {
  if (!isRecord(value) || typeof value.state !== "string") {
    throw new ConversationActDecisionValidationError(
      "Conversation act decision must be an object with a state.",
    );
  }

  if (
    value.state === "NAVIGATE" ||
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

РАЗРЕШЕНЫ РОВНО ЧЕТЫРЕ state:

1. NAVIGATE
Используй, когда последняя реплика:
- описывает новую образовательную/управленческую/профессиональную ситуацию для подбора курса Академии;
- отвечает на уточняющий вопрос Навигатора ради выбора курса;
- просит подобрать курс или уточнить учебный маршрут.

2. COURSE_FOLLOW_UP
Используй, когда курс Академии уже реально упоминался в разговоре и последняя реплика спрашивает именно о нём или о сделанной рекомендации: что это за курс, почему он подходит, что значит упомянутая идея, что в курсе разбирают, на чём основана рекомендация.
courseId должен указывать только на реально упомянутый в разговоре ROUTABLE курс.
evidenceRequested=true ТОЛЬКО если пользователь явно просит источники, цитаты, документы, страницы, доказательство из материалов или спрашивает, откуда конкретно это взято. Обычное "почему этот курс?" само по себе не требует сырых цитат.

3. META
Используй, когда пользователь спрашивает о поведении самого Навигатора: зачем он задаёт вопрос, зачем показывает ссылки/цитаты, что он умеет, почему так ответил, какова его функция или границы.

4. OUT_OF_SCOPE
Используй, когда последняя реплика — новая тема, не связанная с выбором, пониманием или обсуждением курсов Академии. Например общий поиск компаний, погода, новости, бытовой вопрос, программирование, покупки и т.п.
Не пытайся притянуть такую реплику к старой образовательной теме.

JSON FORMAT:
{"state":"NAVIGATE"}
{"state":"COURSE_FOLLOW_UP","courseId":"course-id","evidenceRequested":false}
{"state":"META"}
{"state":"OUT_OF_SCOPE"}

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
