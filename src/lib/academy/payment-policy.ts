import type {
  AddressMode,
  ConversationProfile,
} from "../chat-contract.ts";
import type {
  ConversationActDecision,
} from "../navigation/conversation-act-router.ts";
import {
  resolveCourseReferences,
  type AcademyCourseId,
} from "./course-reference.ts";

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

export type PaymentResolutionContext = {
  selectedCourseId?: string | null;
  courseMatch?:
    | "UNKNOWN"
    | "MATCHED"
    | "NO_CURRENT_COURSE_MATCH"
    | "AMBIGUOUS";
  staleCourseReference?: boolean;
};

export type EnrollmentPaymentDecision =
  | { kind: "NONE" }
  | { kind: "ACTION"; action: EnrollmentPaymentAction }
  | { kind: "CLARIFY_MULTIPLE"; courseIds: readonly AcademyCourseId[] }
  | {
      kind: "CONFIRM_COURSE_CHANGE";
      currentCourseId: PaymentCourseId;
      requestedCourseId: PaymentCourseId;
    }
  | { kind: "REESTABLISH_COURSE" }
  | { kind: "PRESERVE_NO_MATCH" }
  | { kind: "COURSE_NOT_PAYABLE"; courseId: AcademyCourseId };

const ENROLLMENT_INTENT_PATTERNS: readonly RegExp[] = [
  /хочу\s+на\s+(?:этот\s+)?курс/iu,
  /хочу\s+(?:оплатить|записаться|купить|участвовать|оформить)/iu,
  /как\s+(?:записаться|оплатить|купить|оформить)/iu,
  /куда\s+(?:платить|оплачивать|перевести)/iu,
  /готов[а-я]*\s+(?:оплатить|записаться|идти\s+на\s+курс|участвовать)/iu,
  /(?:запишите|запиши)\s+меня/iu,
  /(?:пришлите|пришли)\s+(?:ссылку\s+)?(?:на\s+)?оплат/iu,
  // A bare imperative at the start of the message is itself an enrollment
  // request; the same words mid-sentence stay narrative, not a request.
  /(?:^|\n)\s*(?:оплатить|записаться|купить|оформить)(?![а-яё])/iu,
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
  const resolution = resolveCourseReferences(query);
  return resolution.kind === "ONE" && isPaymentCourseId(resolution.courseIds[0])
    ? resolution.courseIds[0]
    : null;
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
  context: PaymentResolutionContext = {},
): EnrollmentPaymentAction | null {
  const decision = resolveEnrollmentPaymentDecision(query, act, context);
  return decision.kind === "ACTION" ? decision.action : null;
}

export function paymentActionForCourse(
  courseId: PaymentCourseId,
): EnrollmentPaymentAction {
  return {
    courseId,
    paymentUrl: ACADEMY_PAYMENT_POLICY.courses[courseId].paymentUrl,
  };
}

export function resolveEnrollmentPaymentDecision(
  query: string,
  act: ConversationActDecision,
  context: PaymentResolutionContext = {},
): EnrollmentPaymentDecision {
  if (!hasEnrollmentPaymentIntent(query)) {
    return { kind: "NONE" };
  }

  if (act.state === "OUT_OF_SCOPE") {
    return { kind: "NONE" };
  }

  const references = resolveCourseReferences(query);
  if (references.kind === "MULTIPLE") {
    return {
      kind: "CLARIFY_MULTIPLE",
      courseIds: references.courseIds,
    };
  }

  const explicitCourseId = references.kind === "ONE"
    ? references.courseIds[0]
    : null;
  if (explicitCourseId !== null && !isPaymentCourseId(explicitCourseId)) {
    return { kind: "COURSE_NOT_PAYABLE", courseId: explicitCourseId };
  }

  const selectedCourseId =
    context.selectedCourseId && isPaymentCourseId(context.selectedCourseId)
      ? context.selectedCourseId
      : act.state === "COURSE_FOLLOW_UP" && isPaymentCourseId(act.courseId)
        ? act.courseId
        : null;

  if (explicitCourseId !== null && isPaymentCourseId(explicitCourseId)) {
    if (selectedCourseId !== null && selectedCourseId !== explicitCourseId) {
      return {
        kind: "CONFIRM_COURSE_CHANGE",
        currentCourseId: selectedCourseId,
        requestedCourseId: explicitCourseId,
      };
    }

    return { kind: "ACTION", action: paymentActionForCourse(explicitCourseId) };
  }

  if (context.staleCourseReference) {
    return { kind: "REESTABLISH_COURSE" };
  }

  if (context.courseMatch === "NO_CURRENT_COURSE_MATCH") {
    return { kind: "PRESERVE_NO_MATCH" };
  }

  if (selectedCourseId !== null) {
    return { kind: "ACTION", action: paymentActionForCourse(selectedCourseId) };
  }

  if (act.state !== "META") {
    return {
      kind: "ACTION",
      action: {
        courseId: null,
        paymentUrl: ACADEMY_PAYMENT_POLICY.generalUrl,
      },
    };
  }

  return { kind: "NONE" };
}

/**
 * Opening sentence of the enrollment answer (A03).
 *
 * The mode is the profile's and only the profile's. An unknown mode yields
 * address-free wording rather than an invented default, so a session that chose
 * «ты» can never be addressed with a «вы» imperative; nothing else about the
 * payment facts depends on it. Course titles, the payment destination and the
 * transaction identity are never inflected.
 */
function enrollmentOpeningSentence(
  action: EnrollmentPaymentAction,
  mode: AddressMode | null,
): string {
  if (action.courseId) {
    const course = ACADEMY_PAYMENT_POLICY.courses[action.courseId];

    if (mode === null) {
      return `Отлично! Оформление участия и оплаты курса «${course.title}» — через Помощника по оплате курсов в Telegram: ${action.paymentUrl}.`;
    }

    const verb = mode === "TY" ? "перейди" : "перейдите";
    return `Отлично! Для оформления участия и оплаты курса «${course.title}» ${verb} к Помощнику по оплате курсов в Telegram: ${action.paymentUrl}.`;
  }

  if (mode === null) {
    return `Запись и оплата — через Помощника по оплате курсов в Telegram: ${ACADEMY_PAYMENT_POLICY.generalUrl}.`;
  }

  const verb = mode === "TY" ? "открой" : "откройте";
  return `Для записи и оплаты ${verb} Помощника по оплате курсов в Telegram: ${ACADEMY_PAYMENT_POLICY.generalUrl}.`;
}

/**
 * Canonical enrollment/payment answer (Package C).
 *
 * Wording only: the payment destination, the course identity, the payment link
 * choice and the payment action are exactly what they were. The only thing the
 * profile influences here is the address mode of the one user-directed verb.
 */
export function composeEnrollmentPaymentAnswer(
  action: EnrollmentPaymentAction,
  profile?: ConversationProfile,
): string {
  return [
    enrollmentOpeningSentence(action, profile?.addressMode ?? null),
    action.courseId
      ? "Он за 1 минуту оформит заявку и пришлёт реквизиты или счёт для бухгалтерии."
      : "Там можно выбрать программу из каталога Академии.",
  ].join("\n\n");
}
