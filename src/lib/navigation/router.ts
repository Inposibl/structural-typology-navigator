import type { ConversationMessage } from "../chat-contract.ts";
import {
  getRoutingCourseSummaries,
  OFFICIAL_TRACK_SEQUENCES,
} from "../academy/course-catalog.ts";
import { callDeepSeekJson, type DeepSeekClientOptions } from "./deepseek-client.ts";
import {
  validateNavigationDecision,
  type NavigationDecision,
} from "./navigation-decision.ts";

export type RouteEducationalNavigationOptions = DeepSeekClientOptions & {
  callJson?: typeof callDeepSeekJson;
};

function routerSystemPrompt(): string {
  return `Ты — внутренний образовательный маршрутизатор Академии структурной типологии.

ТВОЯ ЕДИНСТВЕННАЯ ЗАДАЧА:
по реальному разговору определить образовательную потребность и вернуть строго JSON-решение. Ты НЕ пишешь финальный ответ пользователю.

РОЛЬ НАВИГАТОРА:
- не психолог и не психотерапевт;
- не ставит диагнозы;
- не назначает пользователю тип, уровень сознания, S–O/S–S статус или скрытый мотив как факт;
- не даёт жизненных советов вместо выбора образовательной траектории;
- не обязан рекомендовать курс.

КРИТИЧЕСКОЕ ПРАВИЛО:
решение принимается ТОЛЬКО по разговору и текущему каталогу курсов ниже.
Никакая глубокая база знаний/RAG на этом этапе не используется.

РАЗРЕШЕНЫ РОВНО ТРИ state:
1. ASK_MORE — данных недостаточно, задай 1–3 различающих вопроса.
2. RECOMMEND_COURSE — образовательная потребность достаточно ясна.
3. NO_CURRENT_COURSE_MATCH — текущий каталог не содержит честного соответствия.

RECOMMEND_COURSE:
- primaryCourseId только из записей со status=ROUTABLE;
- LISTED_UNROUTABLE нельзя рекомендовать;
- secondaryCourseIds обычно [];
- несколько курсов можно вернуть только как непрерывную подпоследовательность официального трека;
- learningNeed — образовательная потребность, не психологический диагноз;
- confidence только "sufficient" или "strong";
- evidence — от 1 до 6 ДОСЛОВНЫХ цитат только из USER-сообщений;
- каждый evidence item обязан содержать messageIndex и quote;
- quote должен быть точной непрерывной подстрокой указанного USER-сообщения;
- нельзя использовать собственный вывод, сообщение Навигатора или перефразирование как evidence.

ASK_MORE:
- candidateCourseIds максимум 2;
- questions от 1 до 3;
- вопросы должны различать учебные маршруты, а не диагностировать человека.

JSON FORMAT — используй ровно один из шаблонов:

{"state":"ASK_MORE","candidateCourseIds":["course-id"],"questions":["..."],"rationale":"..."}
{"state":"RECOMMEND_COURSE","primaryCourseId":"course-id","secondaryCourseIds":[],"learningNeed":"...","evidence":[{"messageIndex":0,"quote":"дословная цитата пользователя"}],"confidence":"sufficient"}
{"state":"NO_CURRENT_COURSE_MATCH","rationale":"..."}

Никакого текста вне JSON.`;
}

export async function routeEducationalNavigation(
  messages: readonly ConversationMessage[],
  options: RouteEducationalNavigationOptions = {},
): Promise<NavigationDecision> {
  const callJson = options.callJson ?? callDeepSeekJson;
  const catalog = getRoutingCourseSummaries();

  const indexedConversation = messages.map((message, messageIndex) => ({
    messageIndex,
    role: message.role,
    content: message.content,
  }));

  const raw = await callJson(
    [
      { role: "system", content: routerSystemPrompt() },
      {
        role: "user",
        content:
          "Проанализируй разговор и верни routing decision в JSON.\n\n" +
          JSON.stringify(
            {
              catalogSnapshot: "2026-09-18",
              courses: catalog,
              officialTrackSequences: OFFICIAL_TRACK_SEQUENCES,
              conversation: indexedConversation,
            },
            null,
            2,
          ),
      },
    ],
    options,
  );

  return validateNavigationDecision(raw, messages);
}
