import type {
  AcademyContactCard,
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

const DIRECT_CONTACT_PATTERN =
  /(?:контакт|связаться|связь|поддержк|менеджер|телеграм|telegram|телефон|позвон|напис|задать\s+вопрос|спросить)/iu;
const PERSON_DISCUSSION_PATTERN =
  /(?:(?:с\s+кем|к\s+кому|у\s+кого|кому).{0,80}(?:обсуд|поговор|обрат|задать|спрос)|(?:обсуд|поговор|обрат|задать|спрос).{0,80}(?:с\s+кем|к\s+кому|у\s+кого|кому))/iu;
const ACADEMY_CONTEXT_PATTERN =
  /(?:академ|курс|обучен|программ)/iu;
const LIVE_PATTERN =
  /(?:вживую|жив(?:ое|ого)\s+общен|поговор|созвон|позвон|телефон|менеджер|человек|(?:с\s+кем|к\s+кому|у\s+кого|кому).{0,80}(?:обсуд|поговор|обрат|спрос))/iu;
const FAST_PATTERN =
  /(?:быстр|чат|телеграм|telegram|напис|письменн|задать\s+вопрос)/iu;

export function detectAcademyContactIntent(
  query: string,
  options: { hasCourseContext?: boolean } = {},
): AcademyContactIntent | null {
  const hasContactTopic =
    DIRECT_CONTACT_PATTERN.test(query) ||
    PERSON_DISCUSSION_PATTERN.test(query);

  if (!hasContactTopic) {
    return null;
  }

  if (
    !options.hasCourseContext &&
    !ACADEMY_CONTEXT_PATTERN.test(query)
  ) {
    return null;
  }

  if (LIVE_PATTERN.test(query)) {
    return "LIVE";
  }

  if (FAST_PATTERN.test(query)) {
    return "FAST_TEXT";
  }

  return "GENERAL";
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

export function composeAcademyContactAnswer(
  intent: AcademyContactIntent,
): {
  message: string;
  contactCard: AcademyContactCard | null;
} {
  if (intent === "FAST_TEXT") {
    return {
      message: [
        `Если нужен быстрый письменный ответ, напишите в чат Академии в Telegram: ${ACADEMY_CONTACT_POLICY.fastTelegramUrl} (${ACADEMY_CONTACT_POLICY.fastTelegramHandle}).`,
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
      `Если нужен быстрый письменный ответ, напишите в чат Академии в Telegram: ${ACADEMY_CONTACT_POLICY.fastTelegramUrl} (${ACADEMY_CONTACT_POLICY.fastTelegramHandle}).`,
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
