import type {
  ConversationMessage,
  ConversationProfile,
} from "../chat-contract.ts";
import {
  getRoutingCourseSummaries,
  OFFICIAL_TRACK_SEQUENCES,
} from "../academy/course-catalog.ts";
import { callDeepSeekJson, type DeepSeekClientOptions } from "./deepseek-client.ts";
import {
  validateNavigationDecision,
  type NavigationDecision,
} from "./navigation-decision.ts";
import {
  addressStyleInstruction,
} from "./conversation-profile.ts";

export type RouteEducationalNavigationOptions = DeepSeekClientOptions & {
  callJson?: typeof callDeepSeekJson;
  profile?: ConversationProfile;
};

function routerSystemPrompt(
  profile: ConversationProfile | undefined,
): string {
  return `Ты — внутренний образовательный маршрутизатор Академии структурной типологии.

ТВОЯ ЕДИНСТВЕННАЯ ЗАДАЧА:
по реальному разговору определить образовательную потребность и вернуть строго JSON-решение. Ты НЕ пишешь финальный ответ пользователю.

РОЛЬ НАВИГАТОРА:
- не психолог и не психотерапевт;
- не ставит диагнозы;
- не назначает пользователю тип, уровень сознания, режим, скрытый мотив или внутренний теоретический статус как факт;
- не даёт жизненных советов вместо выбора образовательной траектории;
- не обязан рекомендовать курс.

КРИТИЧЕСКОЕ ПРАВИЛО:
решение принимается ТОЛЬКО по разговору и текущему каталогу курсов ниже.
Никакая глубокая база знаний/RAG на этом этапе не используется.

ИСТОЧНИКИ ROUTING-СИГНАЛОВ:
- основное основание — самостоятельно сформулированные пользователем цели, проблемы, ограничения, предыдущие попытки и желаемые изменения;
- сообщения Навигатора/assistant — только контекст разговора, но НЕ самостоятельное evidence образовательной потребности;
- если термин, модель или различение сначала были введены assistant, последующий вопрос пользователя об этом термине или его повторение НЕ превращают термин в самостоятельный routing-сигнал;
- если пользователь явно отвечает на предыдущий различающий вопрос, используй этот ответ для снятия соответствующей неопределённости и не повторяй то же различение без новой противоречащей информации.

РАЗРЕШЕНЫ РОВНО ТРИ state:
1. ASK_MORE — только когда дополнительный ответ действительно нужен для выбора маршрута.
2. RECOMMEND_COURSE — образовательная потребность достаточно ясна.
3. NO_CURRENT_COURSE_MATCH — текущий каталог не содержит честного соответствия.

ДОСТАТОЧНОСТЬ И STOPPING RULE:
- ASK_MORE разрешён только если (a) как минимум два ROUTABLE курса остаются сопоставимо правдоподобными по прямым пользовательским сигналам И конкретный недостающий ответ может изменить primaryCourseId, ИЛИ (b) пока нет достаточной прямой поддержки ни одного курса, но один конкретный вопрос может установить соответствие;
- если один ROUTABLE курс имеет прямую явную поддержку из пользовательских формулировок, а альтернативы заметно слабее, выбирай RECOMMEND_COURSE;
- не задавай дополнительные вопросы только ради повышения confidence с sufficient до strong, ради сбора полезного, но не решающего контекста, или ради объяснения теории Академии до выбора маршрута;
- если текущий каталог не соответствует запросу, не растягивай ASK_MORE: используй NO_CURRENT_COURSE_MATCH.

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
- каждый вопрос должен проверять различие, которое реально может изменить primaryCourseId или решение о наличии соответствия;
- формулируй вопросы обычным языком задачи пользователя;
- НЕ называй и НЕ объясняй внутренние обозначения режимов, типов, уровней, формулы, аббревиатуры и иные course-internal теоретические конструкции Академии;
- НЕ проси пользователя выбирать между моделями или курсами Академии;
- НЕ проверяй "готовность к абстрактной модели" как самостоятельный критерий. Такой вопрос допустим только если конкретный documented negativeFitSignal делает это решение-критичным, и даже тогда формулируй его через реальную учебную задачу пользователя, а не через внутреннюю терминологию курса;
- вопросы должны различать образовательные потребности, а не диагностировать человека и не обучать теории до выбора маршрута;
- ${addressStyleInstruction(profile)}

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
      { role: "system", content: routerSystemPrompt(options.profile) },
      {
        role: "user",
        content:
          "Проанализируй разговор и верни routing decision в JSON.\n\n" +
          JSON.stringify(
            {
              catalogSnapshot: "2026-09-18",
              addressMode: options.profile?.addressMode ?? "VY",
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
