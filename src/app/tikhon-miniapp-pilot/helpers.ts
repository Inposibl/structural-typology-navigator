import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CONVERSATION_MESSAGES,
  type AcademyContactCard,
  type ConversationMessage,
  type ConversationProfile,
} from "../../lib/chat-contract.ts";
import { getAcademyCourse } from "../../lib/academy/course-catalog.ts";
import {
  isConversationProfileComplete,
  normalizeConversationProfilePayload,
} from "../../lib/navigation/conversation-profile.ts";
import {
  isValidRequestId,
  normalizeConversationStatePayload,
  type ConversationState,
} from "../../lib/navigation/conversation-state.ts";

export interface PricingOption {
  id: string;
  title: string;
  price: number;
  description: string;
  base_price?: number | null;
  discount_percent?: number | null;
}

export interface Cohort {
  id: string;
  title: string;
  // PRODUCTION-SMOKE-1.CORR1.CORR1: запись листа ожидания — не поток;
  // публичная проекция легально опускает дату/расписание/емкость/места.
  start_date?: string | null;
  schedule?: string | null;
  is_active: boolean;
  has_canonical_sessions?: boolean;
  enrollment_status: string;
  is_enrollment_open: boolean;
  capacity?: number;
  enrolled_count?: number;
  available_seats?: number;
}

export interface Course {
  id: string;
  title: string;
  short_description: string;
  meetings_count: number;
  format_info: string;
  max_participants: number;
  pricing_options: PricingOption[];
  cohorts: Cohort[];
  course_page_url?: string | null;
  cadence?: string | null;
}

export interface ApiResponse {
  as_of: string;
  currency: string;
  currency_symbol: string;
  courses: Course[];
  source_updated_at?: string;
}

export interface StudentCourseStatus {
  paid_options: string[];
  legacy_history_unverified: boolean;
}

export interface StudentStatusResponse {
  is_authenticated: boolean;
  user_id?: number;
  subject_key?: string;
  courses?: Record<string, StudentCourseStatus>;
}

export function getMeetingWord(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return "встреча";
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100))
    return "встречи";
  return "встреч";
}

export function extractCadence(formatInfo: string): string {
  if (!formatInfo) return "";
  if (formatInfo.includes("2 раза в неделю")) return "Zoom · 2 раза в неделю";
  if (formatInfo.includes("1 раз в неделю (на выходных)"))
    return "Zoom · 1 раз в неделю (на выходных)";
  if (formatInfo.includes("1 раз в неделю")) return "Zoom · 1 раз в неделю";
  return "";
}

export function resolveDeepLinkCourseId(search: string, tgStartParam?: string): string | null {
  if (search) {
    const params = new URLSearchParams(search);
    const candidate = params.get("course") || params.get("startapp") || params.get("start");
    if (candidate) return candidate.trim().toLowerCase();
  }
  if (tgStartParam) {
    return tgStartParam.trim().toLowerCase();
  }
  return null;
}

export function isCohortAvailable(cohort: Cohort): boolean {
  return Boolean(cohort.is_enrollment_open) && cohort.enrollment_status === "AVAILABLE";
}

export function isCohortWaitingList(cohort: Cohort): boolean {
  return cohort.id === "waiting_list" || cohort.enrollment_status === "WAITING_LIST";
}

export function isCohortUnavailable(cohort: Cohort): boolean {
  return !isCohortAvailable(cohort) && !isCohortWaitingList(cohort);
}

export function getCohortBadgeText(cohort: Cohort): string {
  if (isCohortAvailable(cohort)) return "Открыт набор";
  if (isCohortWaitingList(cohort)) return "Лист ожидания";
  if (cohort.enrollment_status === "STARTED") return "Набор завершён";
  if (cohort.enrollment_status === "CAPACITY_REACHED") return "Мест нет";
  return "Набор закрыт";
}

export type OptionState = "ELIGIBLE" | "PAID" | "LOCKED" | "DISABLED_STARTED_STAGED";

export function getOptionEligibility(
  courseId: string,
  optionId: string,
  studentStatus?: StudentCourseStatus | null
): { state: OptionState; lockReason?: string } {
  if (!studentStatus) {
    return { state: "ELIGIBLE" };
  }

  const { paid_options = [], legacy_history_unverified = false } = studentStatus;

  // Если у студента не верифицированная история оплат (когорта 5)
  if (legacy_history_unverified && courseId === "structural_typology") {
    return {
      state: "LOCKED",
      lockReason:
        "Для продолжения оплаты следующего уровня требуется подтверждение истории предыдущих оплат",
    };
  }

  // Если полный курс уже оплачен (предоплата или все 3 уровня)
  const isFullPaid =
    paid_options.includes("full_prepayment") ||
    paid_options.includes("full_package") ||
    (paid_options.includes("level_1") &&
      paid_options.includes("level_2") &&
      paid_options.includes("level_3"));

  if (isFullPaid) {
    return { state: "PAID" };
  }

  // Проверка конкретной опции
  if (paid_options.includes(optionId)) {
    return { state: "PAID" };
  }

  if (courseId === "structural_typology") {
    const hasStagedPayment =
      paid_options.includes("level_1") || paid_options.includes("level_2");

    if (optionId === "full_prepayment" || optionId === "full_package") {
      if (hasStagedPayment) {
        return {
          state: "DISABLED_STARTED_STAGED",
          lockReason: "Недоступно: начата поэтапная оплата по уровням",
        };
      }
      return { state: "ELIGIBLE" };
    }

    if (optionId === "level_1") {
      return { state: "ELIGIBLE" };
    }

    if (optionId === "level_2") {
      if (paid_options.includes("level_1")) {
        return { state: "ELIGIBLE" };
      }
      return {
        state: "LOCKED",
        lockReason: "Доступно после оплаты 1-го уровня",
      };
    }

    if (optionId === "level_3") {
      if (paid_options.includes("level_1") && paid_options.includes("level_2")) {
        return { state: "ELIGIBLE" };
      }
      return {
        state: "LOCKED",
        lockReason: "Доступно после оплаты 2-го уровня",
      };
    }
  }

  return { state: "ELIGIBLE" };
}

/* ------------------------------------------------------------------ */
/* Batch 2: Pricing & Payer Selection                                  */
/* ------------------------------------------------------------------ */

export type MiniAppScreen =
  | "catalog"
  | "detail"
  | "payer"
  | "next_stage_stub"
  | "individual_form"
  | "individual_confirmation"
  | "individual_next_stage"
  | "legal_entity_form"
  | "legal_entity_confirmation"
  | "legal_entity_next_stage"
  | "submission_result"
  | "navigator_dialogue";

export const SUCCESS_COPY_VERBATIM =
  "Для выполнения оплаты свяжитесь с куратором курса Алексеем Лебедевым @Lebedev_AST. Спасибо";

// ENROLLMENT-AVAILABILITY-AND-WAITLIST-SEMANTICS-1 §4: канонический текст успеха
// листа ожидания. Точная формулировка Owner — не менять, не показывать вместо
// нее обычный enrollment/payment-текст успеха.
export const WAITLIST_SUCCESS_COPY = `Заявка в лист ожидания принята.

Как только откроется набор на следующий поток,
наш специалист свяжется с вами по указанным контактам
и сообщит условия участия.`;

export const WAITLIST_CTA_COPY = "Записаться в лист ожидания";
export const WAITLIST_SENDING_COPY = "Отправляем…";
export const WAITLIST_ERROR_COPY = "Не удалось отправить заявку. Попробуйте ещё раз.";
export const WAITLIST_RETRY_COPY = "Повторить отправку";

export const CANONICAL_CURATOR_USERNAME = "Lebedev_AST";
export const CANONICAL_CURATOR_TG_LINK = "https://t.me/Lebedev_AST";

export type SubmissionState = "idle" | "submitting" | "success" | "error";

export interface SubmissionResponse {
  status: "SUCCESS" | "FAILED" | "PARTIAL_OR_FAILED";
  application_id?: number;
  deliveries?: Record<string, string>;
  message?: string;
  error?: string;
}

export type PayerType = "individual" | "legal_entity";

export interface PayerTypeOption {
  value: PayerType;
  title: string;
  description: string;
}

/**
 * Canonical payer types (exactly two; IP remains within legal_entity).
 * Presentation copy only — carries no commercial or payment authority.
 */
export const PAYER_TYPE_OPTIONS: readonly PayerTypeOption[] = [
  {
    value: "individual",
    title: "Физическое лицо",
    description: "Оплата от физического лица.",
  },
  {
    value: "legal_entity",
    title: "ИП или юридическое лицо",
    description: "Оплата от ИП или организации с оформлением документов.",
  },
];

export function isValidPayerType(value: unknown): value is PayerType {
  return value === "individual" || value === "legal_entity";
}

/**
 * Local-only next-stage label for the Batch-2 bounded transition stub.
 * Does not create an application, invoice, or any persistence record.
 */
export function getNextStageLabel(payerType: PayerType): string {
  return payerType === "individual"
    ? "Данные участника"
    : "Реквизиты ИП или организации";
}

/**
 * Batch 2 §7: a course with exactly one source-provided pricing option
 * is auto-selected from the course object. Multi-option courses (Structural
 * Typology) return null — explicit user choice is required (§8).
 */
export function getSingleAutoPricingOption(
  course: Course | null | undefined
): PricingOption | null {
  if (!course || !Array.isArray(course.pricing_options)) return null;
  if (course.pricing_options.length === 1) return course.pricing_options[0];
  return null;
}

/**
 * Batch 2 §10: display-level eligibility that never infers personalized
 * entitlement without an authenticated identity. Structural Typology gated
 * stages (level_2 / level_3) remain locked in public-browser mode while
 * public pricing stays viewable. Authenticated evaluation is delegated
 * unchanged to the Batch-1 helper (no progression recomputation).
 */
export function getPublicAwareOptionEligibility(
  courseId: string,
  optionId: string,
  studentStatus: StudentCourseStatus | null | undefined,
  isAuthenticated: boolean
): { state: OptionState; lockReason?: string } {
  const base = getOptionEligibility(courseId, optionId, studentStatus);
  if (
    !isAuthenticated &&
    courseId === "structural_typology" &&
    (optionId === "level_2" || optionId === "level_3") &&
    base.state === "ELIGIBLE"
  ) {
    return {
      state: "LOCKED",
      lockReason:
        optionId === "level_2"
          ? "Доступно после оплаты 1-го уровня"
          : "Доступно после оплаты 2-го уровня",
    };
  }
  return base;
}

export type PayerGateReason =
  | "missing_selection"
  | "auth_required"
  | "not_eligible";

export type PayerGateResult =
  | { allowed: true }
  | { allowed: false; reason: PayerGateReason };

/**
 * Batch 2 §12: Screen 2 -> Screen 3 gate. Requires a selected course, a
 * selected cohort, a selected pricing option, an authenticated identity
 * (public-browser mode is public pricing only), and — for Structural
 * Typology — a currently ELIGIBLE pricing option. Navigational only:
 * performs zero persistence, payment, or mutation side effects.
 */
export function canProceedToPayerSelection(input: {
  course: Course | null;
  cohort: Cohort | null;
  pricingOption: PricingOption | null;
  studentCourseStatus?: StudentCourseStatus | null;
  isAuthenticated: boolean;
}): PayerGateResult {
  if (!input.course || !input.cohort || !input.pricingOption) {
    return { allowed: false, reason: "missing_selection" };
  }
  if (!input.isAuthenticated) {
    return { allowed: false, reason: "auth_required" };
  }
  const eligibility = getOptionEligibility(
    input.course.id,
    input.pricingOption.id,
    input.studentCourseStatus ?? null
  );
  if (eligibility.state !== "ELIGIBLE") {
    return { allowed: false, reason: "not_eligible" };
  }
  return { allowed: true };
}

/* ------------------------------------------------------------------ */
/* Batch 3: Individual enrollment (UI + local validation only)         */
/* ------------------------------------------------------------------ */

/**
 * Raw values of the individual form. Held in React memory only: never
 * persisted, logged, or transmitted (Batch 3 is CASE A, no persistence).
 */
export interface IndividualFormValues {
  full_name: string;
  phone: string;
  email: string;
  /** Optional informational code. Empty means the customer entered none. */
  promo_code?: string;
}

export type IndividualFormField = keyof IndividualFormValues;

export const EMPTY_INDIVIDUAL_FORM: IndividualFormValues = {
  full_name: "",
  phone: "",
  email: "",
  promo_code: "",
};

export const INDIVIDUAL_FULL_NAME_ERROR =
  "Пожалуйста, укажите как минимум Имя и Фамилию через пробел.";
export const INDIVIDUAL_PHONE_ERROR =
  "Укажите российский номер (+7XXXXXXXXXX) или оставьте поле пустым.";
export const INDIVIDUAL_EMAIL_ERROR =
  "Пожалуйста, введите корректный адрес электронной почты (например: name@mail.ru).";
export const INDIVIDUAL_PROMO_CODE_ERROR =
  "Промокод не должен быть длиннее 16 символов.";
/** Owner maximum after edge trim. Count is JavaScript String.length (UTF-16 code units). */
export const PROMO_CODE_MAX_LENGTH = 16;

/**
 * Native parity (chatbot client.py msg_ind_full_name): at least two
 * whitespace-separated parts after trimming. No charset, length or
 * patronymic rule. Returns the trimmed value, or null when invalid.
 */
export function validateIndividualFullName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.split(/\s+/).length >= 2 ? trimmed : null;
}

/**
 * Owner policy: Russia +7 only; international numbers are not supported.
 * Native parity (chatbot validators.normalize_phone): strip everything except
 * digits and "+", then accept +7XXXXXXXXXX, 8XXXXXXXXXX, 7XXXXXXXXXX or
 * 9XXXXXXXXX. Output is always canonical +7XXXXXXXXXX; otherwise null.
 */
export function normalizeIndividualPhone(value: string): string | null {
  const cleaned = value.trim().replace(/[^0-9+]/g, "");
  let m = /^\+7(\d{10})$/.exec(cleaned);
  if (m) return `+7${m[1]}`;
  m = /^[78](\d{10})$/.exec(cleaned);
  if (m) return `+7${m[1]}`;
  m = /^(9\d{9})$/.exec(cleaned);
  if (m) return `+7${m[1]}`;
  return null;
}

/**
 * Informational only. Surrounding whitespace decides emptiness.
 * A non-empty value keeps its case and internal spaces.
 * This function does not truncate. Length is enforced separately with
 * String.length of the trimmed value (UTF-16 code units). Ordinary ASCII
 * matches the chatbot gate, which uses Python len() (Unicode code points).
 */
export function normalizePromoCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Native parity (chatbot validators.validate_email) after trim; case preserved. */
export function validateIndividualEmail(value: string): string | null {
  const trimmed = value.trim();
  return /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(trimmed)
    ? trimmed
    : null;
}

export interface IndividualFormValidation {
  valid: boolean;
  errors: Partial<Record<IndividualFormField, string>>;
  normalized: { full_name: string; phone: string | null; email: string } | null;
}

/**
 * Form validity: full_name and email required; phone optional. An empty
 * phone is valid and stays null (never a fabricated value); a non-empty
 * phone must satisfy the Russia +7-only rule.
 */
export function validateIndividualForm(
  values: IndividualFormValues
): IndividualFormValidation {
  const errors: Partial<Record<IndividualFormField, string>> = {};
  const fullName = validateIndividualFullName(values.full_name);
  if (!fullName) errors.full_name = INDIVIDUAL_FULL_NAME_ERROR;

  const phoneProvided = values.phone.trim() !== "";
  const phone = phoneProvided ? normalizeIndividualPhone(values.phone) : null;
  if (phoneProvided && !phone) errors.phone = INDIVIDUAL_PHONE_ERROR;

  const email = validateIndividualEmail(values.email);
  if (!email) errors.email = INDIVIDUAL_EMAIL_ERROR;

  const promoCode = normalizePromoCode(values.promo_code);
  if (promoCode && promoCode.length > PROMO_CODE_MAX_LENGTH) {
    errors.promo_code = INDIVIDUAL_PROMO_CODE_ERROR;
  }

  if (!fullName || !email || (phoneProvided && !phone) || errors.promo_code) {
    return { valid: false, errors, normalized: null };
  }
  return { valid: true, errors, normalized: { full_name: fullName, phone, email } };
}

/**
 * Local, non-authoritative Batch-3 → Batch-5 handoff draft. Never transmitted
 * or persisted in Batch 3; Batch 5 must revalidate every field server-side.
 */
export interface IndividualEnrollmentDraft {
  course_id: string;
  cohort_id: string;
  pricing_option_id: string;
  payer_type: "individual";
  full_name: string;
  phone: string | null;
  email: string;
  promo_code?: string;
}

export function buildIndividualEnrollmentDraft(input: {
  course: Course | null;
  cohort: Cohort | null;
  pricingOption: PricingOption | null;
  values: IndividualFormValues;
}): IndividualEnrollmentDraft | null {
  if (!input.course || !input.cohort || !input.pricingOption) return null;
  const { normalized } = validateIndividualForm(input.values);
  if (!normalized) return null;
  const promoCode = normalizePromoCode(input.values.promo_code);
  return {
    course_id: input.course.id,
    cohort_id: input.cohort.id,
    pricing_option_id: input.pricingOption.id,
    payer_type: "individual",
    full_name: normalized.full_name,
    phone: normalized.phone,
    email: normalized.email,
    ...(promoCode ? { promo_code: promoCode } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Embedded Navigator dialogue                                        */
/* Explicit Tikhon course ids only. Canonical titles come from the    */
/* current Academy catalog. Underscores are not rewritten in general. */
/* ------------------------------------------------------------------ */

export const NAVIGATOR_ASK_LABEL = "Задать вопрос Навигатору";
export const NAVIGATOR_EXIT_LABEL = "Завершить диалог";
export const NAVIGATOR_RETRY_LABEL = "Повторить";
export const NAVIGATOR_SEND_LABEL = "Отправить";
export const NAVIGATOR_PENDING_LABEL = "Навигатор отвечает…";
export const NAVIGATOR_UNAVAILABLE_COPY =
  "Диалог с Навигатором для этого курса недоступен.";
export const NAVIGATOR_DIALOGUE_HEADING = "Навигатор";

/** Same declared limit as POST /api/chat (MAX_REQUEST_BYTES). */
export const EMBEDDED_NAVIGATOR_MAX_BODY_BYTES = 200_000;

/**
 * Client ceiling for one hung same-origin turn. A content turn can outlast
 * a single provider call, so this is not that call's own timeout.
 */
export const EMBEDDED_NAVIGATOR_TIMEOUT_MS = 120_000;

export const TIKHON_NAVIGATOR_COURSE_IDS = {
  structural_typology: "structural-typology",
  levels_of_consciousness: "levels-of-consciousness",
  maslow: "maslow",
  normative_situation: "normative-situation",
  play_and_creativity: "play-and-creativity",
} as const;

export type TikhonNavigatorCourse = {
  tikhonCourseId: keyof typeof TIKHON_NAVIGATOR_COURSE_IDS;
  navigatorCourseId: string;
  title: string;
  url: string;
};

export function listMappedTikhonCourseIds(): readonly string[] {
  return Object.keys(TIKHON_NAVIGATOR_COURSE_IDS);
}

export function resolveTikhonNavigatorCourse(
  tikhonCourseId: string,
): TikhonNavigatorCourse | null {
  if (
    !Object.prototype.hasOwnProperty.call(
      TIKHON_NAVIGATOR_COURSE_IDS,
      tikhonCourseId,
    )
  ) {
    return null;
  }

  const navigatorCourseId =
    TIKHON_NAVIGATOR_COURSE_IDS[
      tikhonCourseId as keyof typeof TIKHON_NAVIGATOR_COURSE_IDS
    ];
  const course = getAcademyCourse(navigatorCourseId);
  if (
    course === null ||
    course.id !== navigatorCourseId ||
    course.status !== "ROUTABLE" ||
    course.url === null ||
    course.title.length === 0
  ) {
    return null;
  }

  return {
    tikhonCourseId: tikhonCourseId as keyof typeof TIKHON_NAVIGATOR_COURSE_IDS,
    navigatorCourseId: course.id,
    title: course.title,
    url: course.url,
  };
}

export function decideNavigatorEntry(
  tikhonCourseId: string,
): "open" | "unavailable" {
  return resolveTikhonNavigatorCourse(tikhonCourseId) === null
    ? "unavailable"
    : "open";
}

export function createEmbeddedNavigatorProfile(): ConversationProfile {
  return normalizeConversationProfilePayload({
    displayName: null,
    addressMode: "VY",
    nameDeclined: true,
    pendingUserRequest: null,
  });
}

export function buildNavigatorCourseOpening(canonicalTitle: string): string {
  return `Я готов ответить на ваши вопросы по курсу «${canonicalTitle}».`;
}

export function buildEmbeddedResetOpening(canonicalTitle: string): string {
  return `Диалог начат заново. ${buildNavigatorCourseOpening(canonicalTitle)}`;
}

export type EmbeddedDialogueMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

export type EmbeddedDialoguePhase = "ready" | "pending" | "error";

export type EmbeddedNavigatorFailureKind =
  | "network"
  | "timeout"
  | "http"
  | "malformed";

export type EmbeddedDialogueSession = {
  generation: number;
  tikhonCourseId: string;
  navigatorCourseId: string;
  canonicalTitle: string;
  messages: EmbeddedDialogueMessage[];
  profile: ConversationProfile;
  conversationState: ConversationState | null;
  phase: EmbeddedDialoguePhase;
  pendingRequestId: string | null;
  errorMessage: string | null;
  errorKind: EmbeddedNavigatorFailureKind | null;
  errorRetryable: boolean;
  nextId: number;
};

export type EmbeddedNavigatorChatBody = {
  messages: ConversationMessage[];
  profile: ConversationProfile;
  requestId: string;
  conversationState?: ConversationState;
};

export type EmbeddedTurnRejectReason =
  | "pending"
  | "empty"
  | "too_long"
  | "too_large"
  | "invalid_request"
  | "not_retryable";

export type EmbeddedTurnDecision =
  | {
      status: "ACCEPTED";
      session: EmbeddedDialogueSession;
      body: EmbeddedNavigatorChatBody;
      requestId: string;
    }
  | {
      status: "REJECTED";
      reason: EmbeddedTurnRejectReason;
    };

export type EmbeddedNavigatorSuccess = {
  message: string;
  profile: ConversationProfile;
  conversationState: ConversationState;
  resetConversation: boolean;
};

export type EmbeddedNavigatorFailure = {
  kind: EmbeddedNavigatorFailureKind;
  message: string;
  retryable: boolean;
  conversationState: ConversationState | null;
};

export type EmbeddedTurnToken = {
  generation: number;
  requestId: string;
};

export type EmbeddedNavigatorChatResult =
  | { ok: true; success: EmbeddedNavigatorSuccess }
  | { ok: false; failure: EmbeddedNavigatorFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addressRetry(profile: ConversationProfile, lead: string): string {
  return profile.addressMode === "TY"
    ? `${lead} Попробуй ещё раз.`
    : `${lead} Попробуйте ещё раз.`;
}

function technicalRetryMessage(profile: ConversationProfile): string {
  return addressRetry(profile, "Не удалось получить ответ Навигатора.");
}

export function navigatorTransportFailure(
  kind: "network" | "timeout",
  profile: ConversationProfile,
): EmbeddedNavigatorFailure {
  const message =
    kind === "timeout"
      ? addressRetry(profile, "Навигатор не ответил вовремя.")
      : technicalRetryMessage(profile);
  return {
    kind,
    message,
    retryable: true,
    conversationState: null,
  };
}

export function malformedNavigatorFailure(
  profile: ConversationProfile,
): EmbeddedNavigatorFailure {
  return {
    kind: "malformed",
    message: technicalRetryMessage(profile),
    retryable: true,
    conversationState: null,
  };
}

export function openEmbeddedNavigatorDialogue(
  tikhonCourseId: string,
): EmbeddedDialogueSession | null {
  const course = resolveTikhonNavigatorCourse(tikhonCourseId);
  if (course === null) return null;

  const profile = createEmbeddedNavigatorProfile();
  if (!isConversationProfileComplete(profile) || profile.pendingUserRequest !== null) {
    return null;
  }

  return {
    generation: 1,
    tikhonCourseId: course.tikhonCourseId,
    navigatorCourseId: course.navigatorCourseId,
    canonicalTitle: course.title,
    messages: [
      {
        id: "opening",
        role: "assistant",
        content: buildNavigatorCourseOpening(course.title),
      },
    ],
    profile,
    conversationState: null,
    phase: "ready",
    pendingRequestId: null,
    errorMessage: null,
    errorKind: null,
    errorRetryable: false,
    nextId: 1,
  };
}

export function embeddedNavigatorExitGeneration(liveGeneration: number): number {
  return liveGeneration + 1;
}

function toContractMessages(
  messages: readonly EmbeddedDialogueMessage[],
): ConversationMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export function boundDialogueMessages<T>(messages: readonly T[]): T[] {
  if (messages.length <= MAX_CONVERSATION_MESSAGES) {
    return [...messages];
  }
  const head = messages[0];
  if (head === undefined) return [];
  const tailCount = MAX_CONVERSATION_MESSAGES - 1;
  return [head, ...messages.slice(messages.length - tailCount)];
}

function assembleChatBody(
  messages: readonly EmbeddedDialogueMessage[],
  profile: ConversationProfile,
  conversationState: ConversationState | null,
  requestId: string,
): EmbeddedNavigatorChatBody {
  const body: EmbeddedNavigatorChatBody = {
    messages: toContractMessages(messages),
    profile,
    requestId,
  };
  if (conversationState !== null) {
    body.conversationState = conversationState;
  }
  return body;
}

export function navigatorChatBodyByteLength(
  body: EmbeddedNavigatorChatBody,
): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

function fitDialogueMessages(
  messages: readonly EmbeddedDialogueMessage[],
  profile: ConversationProfile,
  conversationState: ConversationState | null,
  requestId: string,
): { messages: EmbeddedDialogueMessage[]; body: EmbeddedNavigatorChatBody } | null {
  let current = boundDialogueMessages(messages);
  while (current.length > 0) {
    const body = assembleChatBody(
      current,
      profile,
      conversationState,
      requestId,
    );
    if (navigatorChatBodyByteLength(body) <= EMBEDDED_NAVIGATOR_MAX_BODY_BYTES) {
      const last = body.messages.at(-1);
      if (last === undefined || last.role !== "user") return null;
      if (
        body.messages.some(
          (message) => message.content.length > MAX_CHAT_MESSAGE_LENGTH,
        )
      ) {
        return null;
      }
      return { messages: current, body };
    }
    if (current.length <= 2) return null;
    const head = current[0];
    if (head === undefined) return null;
    current = [head, ...current.slice(2)];
  }
  return null;
}

function rejectRequestId(requestId: string): EmbeddedTurnDecision | null {
  if (!isValidRequestId(requestId)) {
    return { status: "REJECTED", reason: "invalid_request" };
  }
  return null;
}

export function submitEmbeddedNavigatorTurn(
  session: EmbeddedDialogueSession,
  draft: string,
  requestId: string,
): EmbeddedTurnDecision {
  if (session.phase === "pending") {
    return { status: "REJECTED", reason: "pending" };
  }
  const invalid = rejectRequestId(requestId);
  if (invalid) return invalid;

  const text = draft.trim();
  if (text.length === 0) return { status: "REJECTED", reason: "empty" };
  if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
    return { status: "REJECTED", reason: "too_long" };
  }

  const fitted = fitDialogueMessages(
    [
      ...session.messages,
      { id: `m${session.nextId}`, role: "user", content: text },
    ],
    session.profile,
    session.conversationState,
    requestId,
  );
  if (fitted === null) return { status: "REJECTED", reason: "too_large" };

  return {
    status: "ACCEPTED",
    requestId,
    body: fitted.body,
    session: {
      ...session,
      messages: fitted.messages,
      nextId: session.nextId + 1,
      phase: "pending",
      pendingRequestId: requestId,
      errorMessage: null,
      errorKind: null,
      errorRetryable: false,
    },
  };
}

export function retryEmbeddedNavigatorTurn(
  session: EmbeddedDialogueSession,
  requestId: string,
): EmbeddedTurnDecision {
  if (session.phase !== "error" || !session.errorRetryable) {
    return { status: "REJECTED", reason: "not_retryable" };
  }
  const last = session.messages.at(-1);
  if (last === undefined || last.role !== "user") {
    return { status: "REJECTED", reason: "not_retryable" };
  }
  const invalid = rejectRequestId(requestId);
  if (invalid) return invalid;

  const fitted = fitDialogueMessages(
    session.messages,
    session.profile,
    session.conversationState,
    requestId,
  );
  if (fitted === null) return { status: "REJECTED", reason: "too_large" };

  return {
    status: "ACCEPTED",
    requestId,
    body: fitted.body,
    session: {
      ...session,
      messages: fitted.messages,
      phase: "pending",
      pendingRequestId: requestId,
      errorMessage: null,
      errorKind: null,
      errorRetryable: false,
    },
  };
}

function isContactCard(value: unknown): value is AcademyContactCard | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    value.kind === "ACADEMY_MANAGER" &&
    typeof value.name === "string" &&
    typeof value.role === "string" &&
    typeof value.availability === "string" &&
    typeof value.imageUrl === "string" &&
    isRecord(value.telegram) &&
    typeof value.telegram.label === "string" &&
    typeof value.telegram.href === "string" &&
    isRecord(value.phone) &&
    typeof value.phone.label === "string" &&
    typeof value.phone.href === "string"
  );
}

function isPublicErrorText(text: string): boolean {
  if (text.length === 0 || text.length > 500) return false;
  if (/[\r\n]/u.test(text)) return false;
  if (text.includes("node_modules")) return false;
  if (/\bat\s+\S+\s+\(/u.test(text)) return false;
  if (/^(?:Error|TypeError|ReferenceError|SyntaxError)\b/u.test(text)) {
    return false;
  }
  return true;
}

function readPreservedState(
  payload: unknown,
  nowMs: number,
): ConversationState | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  if (!Object.prototype.hasOwnProperty.call(payload.error, "conversationState")) {
    return null;
  }
  const candidate = payload.error.conversationState;
  if (candidate === null || candidate === undefined) return null;
  try {
    return normalizeConversationStatePayload(candidate, nowMs);
  } catch {
    return null;
  }
}

export function interpretNavigatorChatResponse(
  httpOk: boolean,
  payload: unknown,
  profile: ConversationProfile,
  nowMs: number,
): EmbeddedNavigatorChatResult {
  if (!httpOk) {
    const httpMessage =
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === "string" &&
      isPublicErrorText(payload.error.message.trim())
        ? payload.error.message.trim()
        : technicalRetryMessage(profile);
    const retryable =
      !isRecord(payload) ||
      !isRecord(payload.error) ||
      payload.error.retryable !== false;
    return {
      ok: false,
      failure: {
        kind: "http",
        message: httpMessage,
        retryable,
        conversationState: readPreservedState(payload, nowMs),
      },
    };
  }

  if (
    !isRecord(payload) ||
    typeof payload.message !== "string" ||
    payload.message.trim().length === 0 ||
    typeof payload.resetConversation !== "boolean" ||
    !isContactCard(payload.contactCard)
  ) {
    return { ok: false, failure: malformedNavigatorFailure(profile) };
  }

  let nextProfile: ConversationProfile;
  let nextState: ConversationState;
  try {
    nextProfile = normalizeConversationProfilePayload(payload.profile);
    nextState = normalizeConversationStatePayload(payload.conversationState, nowMs);
  } catch {
    return { ok: false, failure: malformedNavigatorFailure(profile) };
  }

  return {
    ok: true,
    success: {
      message: payload.message,
      profile: nextProfile,
      conversationState: nextState,
      resetConversation: payload.resetConversation,
    },
  };
}

function turnIsCurrent(
  session: EmbeddedDialogueSession,
  liveGeneration: number,
  turn: EmbeddedTurnToken,
): boolean {
  return (
    liveGeneration === turn.generation &&
    session.generation === turn.generation &&
    session.phase === "pending" &&
    session.pendingRequestId === turn.requestId
  );
}

export function applyEmbeddedNavigatorSuccess(
  session: EmbeddedDialogueSession,
  liveGeneration: number,
  turn: EmbeddedTurnToken,
  success: EmbeddedNavigatorSuccess,
): EmbeddedDialogueSession | "IGNORED" {
  if (!turnIsCurrent(session, liveGeneration, turn)) return "IGNORED";

  const reset = success.resetConversation;
  const assistant: EmbeddedDialogueMessage = {
    id: `m${session.nextId}`,
    role: "assistant",
    content: reset
      ? buildEmbeddedResetOpening(session.canonicalTitle)
      : success.message,
  };
  const messages = reset
    ? [assistant]
    : boundDialogueMessages([...session.messages, assistant]);

  return {
    ...session,
    messages,
    profile: reset ? createEmbeddedNavigatorProfile() : success.profile,
    conversationState: success.conversationState,
    phase: "ready",
    pendingRequestId: null,
    errorMessage: null,
    errorKind: null,
    errorRetryable: false,
    nextId: session.nextId + 1,
  };
}

export function applyEmbeddedNavigatorFailure(
  session: EmbeddedDialogueSession,
  liveGeneration: number,
  turn: EmbeddedTurnToken,
  failure: EmbeddedNavigatorFailure,
): EmbeddedDialogueSession | "IGNORED" {
  if (!turnIsCurrent(session, liveGeneration, turn)) return "IGNORED";

  return {
    ...session,
    profile: session.profile,
    conversationState: failure.conversationState ?? session.conversationState,
    phase: "error",
    pendingRequestId: null,
    errorMessage: failure.message,
    errorKind: failure.kind,
    errorRetryable: failure.retryable,
  };
}
