import type {
  ConversationActDecision,
} from "../navigation/conversation-act-router.ts";

export const ACADEMY_PAYMENT_POLICY = {
  generalUrl: "https://t.me/AST_payment_course_bot",
  botHandle: "@AST_payment_course_bot",
  courses: {
    "structural-typology": {
      paymentUrl:
        "https://t.me/AST_payment_course_bot?start=structural_typology",
      title: "Структурная типология личности",
    },
    "levels-of-consciousness": {
      paymentUrl:
        "https://t.me/AST_payment_course_bot?start=levels_of_consciousness",
      title: "Иерархия уровней сознания",
    },
    maslow: {
      paymentUrl:
        "https://t.me/AST_payment_course_bot?start=maslow",
      title: "Иерархия потребностей А. Маслоу",
    },
    "normative-situation": {
      paymentUrl:
        "https://t.me/AST_payment_course_bot?start=normative_situation",
      title: "Нормативная ситуация",
    },
    "play-and-creativity": {
      paymentUrl:
        "https://t.me/AST_payment_course_bot?start=play_and_creativity",
      title: "Игра и творчество",
    },
  },
} as const;

export type PaymentCourseId =
  keyof typeof ACADEMY_PAYMENT_POLICY.courses;

export type EnrollmentPaymentAction = {
  courseId: PaymentCourseId | null;
  paymentUrl: string;
};

const ENROLLMENT_INTENT_PATTERNS: readonly RegExp[] = [
  /хочу\s+на\s+(?:этот\s+)?курс/iu,
  /хочу\s+(?:оплатить|записаться|купить|участвовать|оформить)/iu,
  /как\s+(?:записаться|оплатить|купить|оформить)/iu,
  /куда\s+(?:платить|оплачивать|перевести)/iu,
  /готов[а-я]*\s+(?:оплатить|записаться|идти\s+на\s+курс|участвовать)/iu,
  /(?:запишите|запиши)\s+меня/iu,
  /(?:пришлите|пришли)\s+(?:ссылку\s+)?(?:на\s+)?оплат/iu,
];

const EXPLICIT_COURSE_ALIASES: ReadonlyArray<{
  courseId: PaymentCourseId;
  patterns: readonly RegExp[];
}> = [
  {
    courseId: "structural-typology",
    patterns: [
      /структурн[а-я]*\s+типолог/iu,
      /типолог[а-я]*\s+личност/iu,
    ],
  },
  {
    courseId: "levels-of-consciousness",
    patterns: [
      /уровн[а-я]*\s+сознани/iu,
      /иерархи[а-я]*\s+уровн[а-я]*\s+сознани/iu,
    ],
  },
  {
    courseId: "maslow",
    patterns: [
      /маслоу/iu,
      /иерархи[а-я]*\s+потребност/iu,
    ],
  },
  {
    courseId: "normative-situation",
    patterns: [
      /нормативн[а-я]*\s+ситуац/iu,
    ],
  },
  {
    courseId: "play-and-creativity",
    patterns: [
      /игр[а-я]*\s+(?:и|&)\s+творчеств/iu,
      /творчеств[а-я]*\s+(?:и|&)\s+игр/iu,
    ],
  },
];

export function hasEnrollmentPaymentIntent(
  query: string,
): boolean {
  return ENROLLMENT_INTENT_PATTERNS.some((pattern) =>
    pattern.test(query),
  );
}

export function resolveExplicitPaymentCourseId(
  query: string,
): PaymentCourseId | null {
  for (const entry of EXPLICIT_COURSE_ALIASES) {
    if (entry.patterns.some((pattern) => pattern.test(query))) {
      return entry.courseId;
    }
  }

  return null;
}

function isPaymentCourseId(value: string): value is PaymentCourseId {
  return Object.prototype.hasOwnProperty.call(
    ACADEMY_PAYMENT_POLICY.courses,
    value,
  );
}

export function resolveEnrollmentPaymentAction(
  query: string,
  act: ConversationActDecision,
): EnrollmentPaymentAction | null {
  if (!hasEnrollmentPaymentIntent(query)) {
    return null;
  }

  const explicitCourseId = resolveExplicitPaymentCourseId(query);
  if (explicitCourseId) {
    return {
      courseId: explicitCourseId,
      paymentUrl:
        ACADEMY_PAYMENT_POLICY.courses[explicitCourseId].paymentUrl,
    };
  }

  if (
    act.state === "COURSE_FOLLOW_UP" &&
    isPaymentCourseId(act.courseId)
  ) {
    return {
      courseId: act.courseId,
      paymentUrl:
        ACADEMY_PAYMENT_POLICY.courses[act.courseId].paymentUrl,
    };
  }

  if (
    act.state === "NAVIGATE" ||
    act.state === "COURSE_FOLLOW_UP"
  ) {
    return {
      courseId: null,
      paymentUrl: ACADEMY_PAYMENT_POLICY.generalUrl,
    };
  }

  return null;
}

export function composeEnrollmentPaymentAnswer(
  action: EnrollmentPaymentAction,
): string {
  if (action.courseId) {
    const course = ACADEMY_PAYMENT_POLICY.courses[action.courseId];
    return [
      `Отлично! Для оформления участия, выбора удобного потока и оплаты курса «${course.title}» перейдите к Помощнику по оплате курсов в Telegram: ${action.paymentUrl}.`,
      "Он за 1 минуту оформит заявку и пришлёт реквизиты или счёт для бухгалтерии.",
    ].join("\n\n");
  }

  return [
    `Для записи и оплаты откройте Помощника по оплате курсов в Telegram: ${ACADEMY_PAYMENT_POLICY.generalUrl}.`,
    "Там можно выбрать программу из каталога Академии.",
  ].join("\n\n");
}
