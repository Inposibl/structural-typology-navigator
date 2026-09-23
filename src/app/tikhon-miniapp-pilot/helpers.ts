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
  start_date: string;
  schedule: string;
  is_active: boolean;
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
