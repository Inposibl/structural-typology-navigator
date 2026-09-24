"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import styles from "./miniapp.module.css";
import {
  Course,
  Cohort,
  PricingOption,
  ApiResponse,
  StudentCourseStatus,
  StudentStatusResponse,
  OptionState,
  MiniAppScreen,
  PayerType,
  PAYER_TYPE_OPTIONS,
  getOptionEligibility,
  getPublicAwareOptionEligibility,
  getSingleAutoPricingOption,
  canProceedToPayerSelection,
  getNextStageLabel,
  getMeetingWord,
  extractCadence,
  resolveDeepLinkCourseId,
  isCohortAvailable,
  isCohortWaitingList,
  isCohortUnavailable,
  getCohortBadgeText,
  IndividualFormValues,
  IndividualFormField,
  EMPTY_INDIVIDUAL_FORM,
  validateIndividualForm,
  buildIndividualEnrollmentDraft,
  IndividualEnrollmentDraft,
  SubmissionState,
} from "./helpers";
import {
  LegalEntityFormValues,
  LegalEntityFormField,
  EMPTY_LEGAL_ENTITY_FORM,
  validateLegalEntityForm,
  buildLegalEntityEnrollmentDraft,
  LegalEntityEnrollmentDraft,
} from "./legal-entity-helpers";
import { LegalEntityFlow } from "./legal-entity-flow";
import { submitTikhonApplication } from "./submission";
import { SubmissionResultScreen } from "./submission-screen";

export type { Course, Cohort, PricingOption, ApiResponse, StudentCourseStatus, StudentStatusResponse, OptionState, MiniAppScreen, PayerType, SubmissionState };
export {
  PAYER_TYPE_OPTIONS,
  getOptionEligibility,
  getPublicAwareOptionEligibility,
  getSingleAutoPricingOption,
  canProceedToPayerSelection,
  getNextStageLabel,
  getMeetingWord,
  extractCadence,
  resolveDeepLinkCourseId,
  isCohortAvailable,
  isCohortWaitingList,
  isCohortUnavailable,
  getCohortBadgeText,
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand?: () => void;
        close?: () => void;
        openLink?: (url: string) => void;
        openTelegramLink?: (url: string) => void;
        initData?: string;
        BackButton?: {
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
        };
        initDataUnsafe?: {
          start_param?: string;
          user?: {
            id?: number;
            first_name?: string;
            last_name?: string;
            username?: string;
          };
        };
        themeParams?: Record<string, string>;
      };
    };
  }
}

// CORR1: bounded retry for transient upstream entitlement-lookup failures
type StudentStatusCheck = "idle" | "ok" | "unauthorized" | "unavailable";
const STUDENT_STATUS_MAX_ATTEMPTS = 3;
const STUDENT_STATUS_RETRY_DELAY_MS = 700;

export default function TikhonMiniAppPilotPage() {
  const [screen, setScreen] = useState<MiniAppScreen>("catalog");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedCohortId, setSelectedCohortId] = useState<string | null>(null);
  const [selectedPricingOptionId, setSelectedPricingOptionId] = useState<string | null>(null);
  // Batch 2: payer type is navigational client state only (never commercial,
  // entitlement, or payment authority)
  const [selectedPayerType, setSelectedPayerType] = useState<PayerType | null>(null);
  // Batch 3: individual form values live in React memory only — never
  // persisted, logged, or transmitted; lost on refresh or Mini App close
  const [individualForm, setIndividualForm] =
    useState<IndividualFormValues>(EMPTY_INDIVIDUAL_FORM);
  const [individualTouched, setIndividualTouched] = useState<
    Partial<Record<IndividualFormField, boolean>>
  >({});
  const [individualContinueAttempted, setIndividualContinueAttempted] = useState(false);
  // Batch 4: Legal entity & IP form state (React memory only, never persisted)
  const [legalEntityStep, setLegalEntityStep] = useState<1 | 2 | 3 | 4>(1);
  const [legalEntityForm, setLegalEntityForm] =
    useState<LegalEntityFormValues>(EMPTY_LEGAL_ENTITY_FORM);
  const [legalEntityTouched, setLegalEntityTouched] = useState<
    Partial<Record<LegalEntityFormField, boolean>>
  >({});
  const [legalEntityContinueAttempted, setLegalEntityContinueAttempted] = useState<
    Record<1 | 2 | 3 | 4, boolean>
  >({
    1: false,
    2: false,
    3: false,
    4: false,
  });
  const [showAuthRequiredModal, setShowAuthRequiredModal] = useState(false);
  const [hasTelegramInitData, setHasTelegramInitData] = useState(false);
  const [studentStatusResolved, setStudentStatusResolved] = useState(false);
  // CORR1: outcome of the student-status check for a Telegram session.
  // "unavailable" (5xx / network) must never be reported as a missing Telegram
  // login; access stays fail-closed until the server confirms the session.
  const [studentStatusCheck, setStudentStatusCheck] = useState<StudentStatusCheck>("idle");
  const [showStatusUnavailableModal, setShowStatusUnavailableModal] = useState(false);

  // Live data state from authoritative Supabase-backed API
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Student authenticated status (Batch 1 CORR1: Private Entitlements)
  const [studentStatus, setStudentStatus] = useState<StudentStatusResponse | null>(null);

  // Batch 5: Application submission state
  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionAppId, setSubmissionAppId] = useState<number | null>(null);

  const handleExecuteSubmission = useCallback(
    async (
      draft: IndividualEnrollmentDraft | LegalEntityEnrollmentDraft,
      payerType: "individual" | "legal_entity"
    ) => {
      setSubmissionState("submitting");
      setSubmissionError(null);
      setScreen("submission_result");

      const result = await submitTikhonApplication(draft, payerType);
      if (result.ok && result.status === "SUCCESS") {
        setSubmissionState("success");
        setSubmissionAppId(result.application_id ?? null);
      } else {
        setSubmissionState("error");
        setSubmissionError(
          result.message ||
            "Не удалось завершить оформление заявки. Пожалуйста, повторите попытку."
        );
        if (result.application_id) {
          setSubmissionAppId(result.application_id);
        }
      }
    },
    []
  );

  const fetchCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tikhon/courses");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: ApiResponse = await res.json();
      if (Array.isArray(data.courses) && data.courses.length > 0) {
        setCourses(data.courses);
      } else {
        throw new Error("No courses returned from projection");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Failed to load live courses:", msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  // Load student authenticated status via Telegram WebApp initData HMAC
  const loadStudentStatus = useCallback(async () => {
    if (typeof window === "undefined") return;
    const initData = window.Telegram?.WebApp?.initData;
    setHasTelegramInitData(Boolean(initData));
    if (!initData) {
      // Public-browser mode: no identity is fabricated (Batch 2 §10)
      setStudentStatusResolved(true);
      return;
    }
    setStudentStatusResolved(false);
    let outcome: StudentStatusCheck = "unavailable";
    for (let attempt = 0; attempt < STUDENT_STATUS_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, STUDENT_STATUS_RETRY_DELAY_MS * attempt));
      }
      try {
        const res = await fetch("/api/tikhon/student-status", {
          headers: {
            "x-telegram-init-data": initData,
          },
        });
        if (res.ok) {
          const data: StudentStatusResponse = await res.json();
          setStudentStatus(data);
          outcome = "ok";
          break;
        }
        if (res.status === 401) {
          // Signature rejected by the server: genuinely unauthenticated
          outcome = "unauthorized";
          break;
        }
        // 5xx: entitlement lookup failed upstream; retry (CORR1)
      } catch (e) {
        console.error("Failed to load student status:", e);
      }
    }
    setStudentStatusCheck(outcome);
    setStudentStatusResolved(true);
  }, []);

  useEffect(() => {
    loadStudentStatus();
  }, [loadStudentStatus]);

  // Deep linking resolution on initial mount and when courses arrive
  useEffect(() => {
    if (typeof window === "undefined" || courses.length === 0) return;

    const tgParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    const targetCourseId = resolveDeepLinkCourseId(window.location.search, tgParam);

    if (targetCourseId) {
      const matched = courses.find((c) => c.id.toLowerCase() === targetCourseId);
      if (matched) {
        setSelectedCourseId(matched.id);
        setScreen("detail");
      }
    }
  }, [courses]);

  // Telegram WebApp lifecycle & native BackButton management
  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      try {
        tg.ready();
        tg.expand?.();

        if (screen !== "catalog") {
          tg.BackButton?.show();
          const handleBack = () => {
            if (screen === "detail") setScreen("catalog");
            else if (screen === "payer") setScreen("detail");
            else if (screen === "next_stage_stub") setScreen("payer");
            else if (screen === "individual_form") setScreen("payer");
            else if (screen === "individual_confirmation") setScreen("individual_form");
            else if (screen === "individual_next_stage") setScreen("individual_confirmation");
            else if (screen === "legal_entity_form") {
              if (legalEntityStep === 4) setLegalEntityStep(3);
              else if (legalEntityStep === 3) setLegalEntityStep(2);
              else if (legalEntityStep === 2) setLegalEntityStep(1);
              else setScreen("payer");
            } else if (screen === "legal_entity_confirmation") {
              setScreen("legal_entity_form");
              setLegalEntityStep(4);
            } else if (screen === "legal_entity_next_stage") {
              setScreen("legal_entity_confirmation");
            } else if (screen === "submission_result") {
              if (submissionState === "success") {
                setScreen("catalog");
              } else if (selectedPayerType === "legal_entity") {
                setScreen("legal_entity_confirmation");
              } else {
                setScreen("individual_confirmation");
              }
            }
          };
          tg.BackButton?.onClick(handleBack);
          return () => {
            tg.BackButton?.offClick(handleBack);
          };
        } else {
          tg.BackButton?.hide();
        }
      } catch (err) {
        console.error("Telegram WebApp initialization error:", err);
      }
    }
  }, [screen, legalEntityStep, selectedPayerType, submissionState]);

  // Active course resolution
  const selectedCourse = useMemo(() => {
    if (!courses || courses.length === 0) return null;
    if (selectedCourseId) {
      const found = courses.find((c) => c.id === selectedCourseId);
      if (found) return found;
    }
    return courses[0];
  }, [courses, selectedCourseId]);

  // Student course status for active course
  const currentStudentCourseStatus = useMemo<StudentCourseStatus | null>(() => {
    if (!selectedCourse || !studentStatus?.courses) return null;
    return studentStatus.courses[selectedCourse.id] || null;
  }, [selectedCourse, studentStatus]);

  // Auto-select initial cohort when course changes or loads
  useEffect(() => {
    if (!selectedCourse || !selectedCourse.cohorts || selectedCourse.cohorts.length === 0) {
      setSelectedCohortId(null);
      return;
    }

    const openAvailable = selectedCourse.cohorts.find(
      (ch) => ch.is_enrollment_open && ch.enrollment_status === "AVAILABLE" && ch.id !== "waiting_list"
    );
    if (openAvailable) {
      setSelectedCohortId(openAvailable.id);
    } else {
      const firstActive = selectedCourse.cohorts.find((ch) => ch.is_active && ch.id !== "waiting_list");
      setSelectedCohortId(firstActive ? firstActive.id : selectedCourse.cohorts[0].id);
    }
  }, [selectedCourse]);

  // Batch 2 §7/§8: single-option courses auto-select their only source-provided
  // pricing option; multi-option courses (Structural Typology) require an
  // explicit user choice and are never auto-selected
  useEffect(() => {
    if (!selectedCourse?.pricing_options || selectedCourse.pricing_options.length === 0) {
      setSelectedPricingOptionId(null);
      return;
    }

    const singleAuto = getSingleAutoPricingOption(selectedCourse);
    if (singleAuto) {
      setSelectedPricingOptionId(singleAuto.id);
      return;
    }

    setSelectedPricingOptionId((prev) =>
      prev && selectedCourse.pricing_options.some((opt) => opt.id === prev)
        ? prev
        : null
    );
  }, [selectedCourse]);

  // Authenticated identity is strictly server-derived (Batch 2 §10)
  const isAuthenticated = studentStatus?.is_authenticated === true;

  // Batch 2 §12: a selected pricing option that is not currently ELIGIBLE can
  // never be carried into payer selection (PAID / LOCKED / staged-disabled)
  useEffect(() => {
    if (!selectedCourse || !selectedPricingOptionId) return;
    const { state } = getPublicAwareOptionEligibility(
      selectedCourse.id,
      selectedPricingOptionId,
      currentStudentCourseStatus,
      isAuthenticated
    );
    if (state !== "ELIGIBLE") {
      setSelectedPricingOptionId(null);
    }
  }, [selectedCourse, selectedPricingOptionId, currentStudentCourseStatus, isAuthenticated]);

  // Payer choice belongs to a single course context
  useEffect(() => {
    setSelectedPayerType(null);
  }, [selectedCourseId]);

  const selectedCohort = useMemo(() => {
    if (!selectedCourse?.cohorts) return null;
    return selectedCourse.cohorts.find((ch) => ch.id === selectedCohortId) || selectedCourse.cohorts[0] || null;
  }, [selectedCourse, selectedCohortId]);

  const selectedPricingOption = useMemo(() => {
    if (!selectedCourse?.pricing_options) return null;
    return selectedCourse.pricing_options.find((opt) => opt.id === selectedPricingOptionId) || selectedCourse.pricing_options[0] || null;
  }, [selectedCourse, selectedPricingOptionId]);

  const selectedPayerOption = useMemo(() => {
    if (!selectedPayerType) return null;
    return PAYER_TYPE_OPTIONS.find((opt) => opt.value === selectedPayerType) || null;
  }, [selectedPayerType]);

  // Batch 3: local validation and non-authoritative draft (never transmitted)
  const individualValidation = useMemo(
    () => validateIndividualForm(individualForm),
    [individualForm]
  );
  const individualDraft = useMemo(
    () =>
      buildIndividualEnrollmentDraft({
        course: selectedCourse,
        cohort: selectedCohort,
        pricingOption: selectedPricingOption,
        values: individualForm,
      }),
    [selectedCourse, selectedCohort, selectedPricingOption, individualForm]
  );

  const updateIndividualField = (field: IndividualFormField, value: string) => {
    setIndividualForm((prev) => ({ ...prev, [field]: value }));
  };

  const markIndividualFieldTouched = (field: IndividualFormField) => {
    setIndividualTouched((prev) => ({ ...prev, [field]: true }));
    setIndividualForm((prev) => ({ ...prev, [field]: prev[field].trim() }));
  };

  // Errors appear only after the field was left or Continue was attempted
  const individualFieldError = (field: IndividualFormField): string | undefined =>
    individualTouched[field] || individualContinueAttempted
      ? individualValidation.errors[field]
      : undefined;

  const handleIndividualFormContinue = () => {
    if (!individualValidation.valid || !individualDraft) {
      setIndividualContinueAttempted(true);
      return;
    }
    setScreen("individual_confirmation");
  };

  // Batch 4: local validation and non-authoritative draft (never transmitted)
  const legalEntityValidation = useMemo(
    () => validateLegalEntityForm(legalEntityForm),
    [legalEntityForm]
  );
  const legalEntityDraft = useMemo(
    () =>
      buildLegalEntityEnrollmentDraft({
        course: selectedCourse,
        cohort: selectedCohort,
        pricingOption: selectedPricingOption,
        values: legalEntityForm,
      }),
    [selectedCourse, selectedCohort, selectedPricingOption, legalEntityForm]
  );

  const updateLegalEntityField = (field: LegalEntityFormField, value: string) => {
    setLegalEntityForm((prev) => ({ ...prev, [field]: value }));
  };

  const markLegalEntityFieldTouched = (field: LegalEntityFormField) => {
    setLegalEntityTouched((prev) => ({ ...prev, [field]: true }));
    setLegalEntityForm((prev) => ({ ...prev, [field]: prev[field].trim() }));
  };

  const handleLegalEntityStep1Continue = () => {
    if (!legalEntityValidation.step1Valid) {
      setLegalEntityContinueAttempted((prev) => ({ ...prev, 1: true }));
      return;
    }
    setLegalEntityStep(2);
  };

  const handleLegalEntityStep2Continue = () => {
    if (!legalEntityValidation.step2Valid) {
      setLegalEntityContinueAttempted((prev) => ({ ...prev, 2: true }));
      return;
    }
    setLegalEntityStep(3);
  };

  const handleLegalEntityStep3Continue = () => {
    if (!legalEntityValidation.step3Valid) {
      setLegalEntityContinueAttempted((prev) => ({ ...prev, 3: true }));
      return;
    }
    setLegalEntityStep(4);
  };

  const handleLegalEntityStep4Continue = () => {
    if (!legalEntityValidation.step4Valid || !legalEntityDraft) {
      setLegalEntityContinueAttempted((prev) => ({ ...prev, 4: true }));
      return;
    }
    setScreen("legal_entity_confirmation");
  };

  // Batch 2 §12: Screen 2 -> Screen 3 transition gate. Local-only navigation;
  // unauthenticated public-browser mode receives a bounded Telegram-auth state
  // instead of a fabricated personalized enrollment session (§10).
  const handleProceedToPayer = () => {
    if (hasTelegramInitData && !studentStatusResolved) return;
    if (hasTelegramInitData && studentStatusCheck === "unavailable") {
      setShowStatusUnavailableModal(true);
      return;
    }
    const gate = canProceedToPayerSelection({
      course: selectedCourse,
      cohort: selectedCohort,
      pricingOption: selectedPricingOption,
      studentCourseStatus: currentStudentCourseStatus,
      isAuthenticated,
    });
    if (gate.allowed) {
      setScreen("payer");
    } else if (gate.reason === "auth_required") {
      setShowAuthRequiredModal(true);
    }
  };

  return (
    <main className={styles.container}>
      {screen === "catalog" ? (
        /* SCREEN 1: ACADEMY CATALOG / PROGRAMS (TIKHON-UX-001, 002, 003) */
        <>
          {/* Subtle Top Brand Header */}
          <header className={styles.topHeader}>
            <div className={styles.brandGroup}>
              <Image
                src="/academy/Tikhon_avatar.jpg"
                alt="Академия структурной типологии"
                width={36}
                height={36}
                priority
                className={styles.subtleAvatar}
              />
              <div className={styles.brandInfo}>
                <h1 className={styles.brandTitle}>
                  Академия структурной типологии
                </h1>
                <p className={styles.brandSubtitle}>
                  Официальный сервис секретаря Тихона
                </p>
              </div>
            </div>
          </header>

          {/* Welcome Card (§2: Owner-accepted verbatim welcome block) */}
          <section className={styles.welcomeCard}>
            <h2 className={styles.welcomeHeading}>Добро пожаловать!</h2>
            <p className={styles.welcomeText}>
              Здесь вы можете оформить участие в образовательных программах,
              выбрать удобный поток и получить счет на оплату (для физлиц через
              СБП или для юрлиц/ИП с закрывающими документами).
            </p>
          </section>

          {/* Section Header */}
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Образовательные программы</h2>
          </div>

          {loading ? (
            <div className={styles.loadingBox}>
              <div className={styles.spinner} />
              <span>Загрузка расписания и программ...</span>
            </div>
          ) : error && courses.length === 0 ? (
            <div className={styles.errorBox}>
              <div className={styles.errorTitle}>Актуальные данные временно недоступны</div>
              <p className={styles.errorText}>
                Не удалось подключиться к расписанию Академии.
              </p>
              <button
                type="button"
                className={styles.retryBtn}
                onClick={fetchCourses}
              >
                Повторить
              </button>
            </div>
          ) : (
            <div className={styles.courseList}>
              {courses.map((course) => {
                const hasOpenCohort = course.cohorts?.some(
                  (ch) => Boolean(ch.is_enrollment_open) && ch.enrollment_status === "AVAILABLE"
                );
                const hasWaitingList = course.cohorts?.some(
                  (ch) => ch.id === "waiting_list" || ch.enrollment_status === "WAITING_LIST"
                );

                const primaryPrice = course.pricing_options?.[0]?.price;
                const cadenceText = extractCadence(course.format_info);

                return (
                  <article
                    key={course.id}
                    className={`${styles.courseCard} ${styles.courseCardActive}`}
                    onClick={() => {
                      setSelectedCourseId(course.id);
                      setScreen("detail");
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Открыть курс ${course.title}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedCourseId(course.id);
                        setScreen("detail");
                      }
                    }}
                  >
                    <div className={styles.cardMetaTop}>
                      {hasOpenCohort ? (
                        <span className={styles.statusBadge}>Открыт набор</span>
                      ) : (
                        <span className={styles.statusBadge}>
                          {hasWaitingList ? "Лист ожидания" : "Набор закрыт"}
                        </span>
                      )}
                      <span className={styles.meetingsCount}>
                        {course.meetings_count}{" "}
                        {getMeetingWord(course.meetings_count)}
                      </span>
                    </div>

                    <h3 className={styles.courseTitle}>{course.title}</h3>

                    <p className={styles.courseDesc}>
                      {course.short_description}
                    </p>

                    <div className={styles.specsRow}>
                      {cadenceText ? (
                        <div className={styles.specItem}>
                          <span className={styles.specBullet}>•</span>
                          <span>{cadenceText}</span>
                        </div>
                      ) : null}
                      <div className={styles.specItem}>
                        <span className={styles.specBullet}>•</span>
                        <span>
                          Лимит группы · {course.max_participants} человек
                        </span>
                      </div>
                    </div>

                    <div className={styles.cardFooter}>
                      {typeof primaryPrice === "number" ? (
                        <span className={styles.priceTag}>
                          {course.id === "structural_typology"
                            ? `от ${primaryPrice.toLocaleString("ru-RU")} ₽`
                            : `${primaryPrice.toLocaleString("ru-RU")} ₽`}
                        </span>
                      ) : (
                        <span className={styles.priceTag}>По запросу</span>
                      )}
                      <span className={styles.openAction}>Подробнее →</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <footer className={styles.footer}>
            <p className={styles.footerText}>
              Академия структурной типологии · Официальный Telegram-сервис
            </p>
          </footer>
        </>
      ) : screen === "detail" ? (
        /* SCREEN 2: COURSE DETAIL, COHORT SELECTION & PRICING PROGRESSION */
        <>
          <nav className={styles.navBar}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => setScreen("catalog")}
            >
              ← Все программы
            </button>
            <span className={styles.navTitle}>Карточка курса</span>
          </nav>

          {selectedCourse && (
            <article className={styles.detailCard}>
              <div className={styles.detailBadgeRow}>
                {selectedCohort &&
                selectedCohort.is_enrollment_open &&
                selectedCohort.enrollment_status === "AVAILABLE" ? (
                  <span className={styles.statusBadge}>Открыт набор</span>
                ) : (
                  <span className={styles.statusBadge}>
                    {selectedCohort?.id === "waiting_list" ||
                    selectedCohort?.enrollment_status === "WAITING_LIST"
                      ? "Лист ожидания"
                      : "Набор закрыт"}
                  </span>
                )}
                <span className={styles.meetingsCount}>
                  {selectedCourse.meetings_count}{" "}
                  {getMeetingWord(selectedCourse.meetings_count)}
                </span>
              </div>

              <h1 className={styles.detailTitle}>{selectedCourse.title}</h1>

              <p className={styles.detailDesc}>
                {selectedCourse.short_description}
              </p>

              <div className={styles.metaGrid}>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Формат обучения</span>
                  <span className={styles.metaValue}>
                    {selectedCourse.format_info}
                  </span>
                </div>

                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Лимит группы</span>
                  <span className={styles.metaValue}>
                    Лимит группы · {selectedCourse.max_participants} человек
                  </span>
                </div>
              </div>

              {/* COHORT SELECTOR (§9, §10, §11) */}
              <section className={styles.cohortSection}>
                <h2 className={styles.cohortSectionTitle}>Выбор потока</h2>
                <p className={styles.cohortSectionSubtitle}>
                  Выберите подходящие даты занятий
                </p>

                <div className={styles.cohortList} role="radiogroup" aria-label="Потоки курса">
                  {selectedCourse.cohorts?.map((cohort) => {
                    const available = isCohortAvailable(cohort);
                    const waitingList = isCohortWaitingList(cohort);
                    const unavailable = isCohortUnavailable(cohort);
                    const isSelected = selectedCohort?.id === cohort.id;

                    return (
                      <div
                        key={cohort.id}
                        role="radio"
                        aria-checked={isSelected}
                        aria-disabled={unavailable}
                        tabIndex={unavailable ? -1 : 0}
                        className={`${styles.cohortCard} ${
                          isSelected ? styles.cohortCardSelected : ""
                        } ${unavailable ? styles.cohortCardDisabled : ""} ${
                          waitingList ? styles.cohortCardWaitingList : ""
                        }`}
                        onClick={() => {
                          if (!unavailable) {
                            setSelectedCohortId(cohort.id);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (!unavailable && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            setSelectedCohortId(cohort.id);
                          }
                        }}
                      >
                        <div className={styles.cohortTopRow}>
                          <div className={styles.cohortRadioGroup}>
                            <div className={styles.cohortRadioIndicator}>
                              {isSelected && <div className={styles.cohortRadioDot} />}
                            </div>
                            <span className={styles.cohortTitleText}>{cohort.title}</span>
                          </div>

                          {available && (
                            <span className={`${styles.cohortBadge} ${styles.badgeOpen}`}>
                              Открыт набор
                            </span>
                          )}
                          {waitingList && (
                            <span className={`${styles.cohortBadge} ${styles.badgeWaiting}`}>
                              Лист ожидания
                            </span>
                          )}
                          {unavailable && (
                            <span className={`${styles.cohortBadge} ${styles.badgeClosed}`}>
                              {cohort.enrollment_status === "STARTED"
                                ? "Набор завершён"
                                : cohort.enrollment_status === "CAPACITY_REACHED"
                                ? "Мест нет"
                                : "Набор закрыт"}
                            </span>
                          )}
                        </div>

                        <div className={styles.cohortMetaList}>
                          {cohort.start_date && (
                            <div className={styles.cohortMetaLine}>
                              Старт: {cohort.start_date}
                            </div>
                          )}
                          {cohort.schedule && (
                            <div className={styles.cohortMetaLine}>
                              График: {cohort.schedule}
                            </div>
                          )}
                          {typeof cohort.available_seats === "number" && typeof cohort.capacity === "number" && (
                            <div className={styles.cohortMetaSeats}>
                              {available
                                ? `Свободных мест: ${cohort.available_seats} из ${cohort.capacity}`
                                : `Свободных мест: 0 из ${cohort.capacity}`}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* STAGED PRICING & PAYMENT PROGRESSION (Batch 1 CORR1) */}
              <section className={styles.pricingSection}>
                <h2 className={styles.pricingSectionTitle}>Тарифы и этапы оплаты</h2>
                <p className={styles.pricingSectionSubtitle}>
                  {selectedCourse.id === "structural_typology"
                    ? "Выберите полный курс со скидкой или текущий уровень"
                    : "Выберите удобный вариант участия"}
                </p>

                {/* Legacy Cohort 5 Warning Callout */}
                {selectedCourse.id === "structural_typology" &&
                  currentStudentCourseStatus?.legacy_history_unverified && (
                    <div className={styles.legacyWarningBox}>
                      <div className={styles.legacyWarningTitle}>
                        История обучения требует подтверждения
                      </div>
                      <p className={styles.legacyWarningText}>
                        Для продолжения оплаты следующего уровня требуется подтверждение истории предыдущих оплат.
                      </p>
                      <a
                        href="https://t.me/structural_typology_manager"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.curatorLink}
                        onClick={(e) => {
                          if (window.Telegram?.WebApp?.openTelegramLink) {
                            e.preventDefault();
                            window.Telegram.WebApp.openTelegramLink("https://t.me/structural_typology_manager");
                          }
                        }}
                      >
                        Связаться с куратором →
                      </a>
                    </div>
                  )}

                <div className={styles.pricingList} role="radiogroup" aria-label="Варианты оплаты">
                  {selectedCourse.pricing_options?.map((opt) => {
                    const eligibility = getPublicAwareOptionEligibility(
                      selectedCourse.id,
                      opt.id,
                      currentStudentCourseStatus,
                      isAuthenticated
                    );
                    const isSelected = selectedPricingOptionId === opt.id;
                    const isEligible = eligibility.state === "ELIGIBLE";
                    const isPaid = eligibility.state === "PAID";
                    const isLocked =
                      eligibility.state === "LOCKED" ||
                      eligibility.state === "DISABLED_STARTED_STAGED";

                    return (
                      <div
                        key={opt.id}
                        role="radio"
                        aria-checked={isSelected}
                        aria-disabled={!isEligible}
                        tabIndex={isEligible ? 0 : -1}
                        className={`${styles.pricingCard} ${
                          isSelected && isEligible ? styles.pricingCardSelected : ""
                        } ${isPaid ? styles.pricingCardPaid : ""} ${
                          isLocked ? styles.pricingCardDisabled : ""
                        }`}
                        onClick={() => {
                          if (isEligible) {
                            setSelectedPricingOptionId(opt.id);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (isEligible && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            setSelectedPricingOptionId(opt.id);
                          }
                        }}
                      >
                        <div className={styles.pricingTopRow}>
                          <div className={styles.pricingTitleGroup}>
                            <div className={styles.cohortRadioIndicator}>
                              {isSelected && isEligible && <div className={styles.cohortRadioDot} />}
                              {isPaid && (
                                <span style={{ color: "#16a34a", fontSize: "11px", fontWeight: "bold" }}>
                                  ✓
                                </span>
                              )}
                            </div>
                            <span className={styles.pricingOptionTitle}>{opt.title}</span>
                            {typeof opt.discount_percent === "number" && (
                              <span className={styles.discountBadge}>
                                -{opt.discount_percent}%
                              </span>
                            )}
                          </div>

                          <div className={styles.pricingPriceGroup}>
                            {typeof opt.base_price === "number" && (
                              <span className={styles.basePriceStrikethrough}>
                                {opt.base_price.toLocaleString("ru-RU")} ₽
                              </span>
                            )}
                            <span className={styles.pricingPriceText}>
                              {opt.price.toLocaleString("ru-RU")} ₽
                            </span>
                            {isPaid && <span className={styles.paidBadge}>✓ Оплачено</span>}
                            {isLocked && <span className={styles.lockedBadge}>Недоступно</span>}
                          </div>
                        </div>

                        {opt.description && (
                          <div className={styles.pricingOptionDesc}>{opt.description}</div>
                        )}

                        {eligibility.lockReason && (
                          <div className={styles.pricingLockReason}>{eligibility.lockReason}</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Canonical Public Offer Notice (§0, §1) */}
                <div className={styles.offerNoticeBox}>
                  Условия оплаты и возврата указаны в{" "}
                  <a
                    href="/offer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.offerLink}
                    onClick={(e) => {
                      if (window.Telegram?.WebApp?.openLink) {
                        e.preventDefault();
                        window.Telegram.WebApp.openLink(
                          `${window.location.origin}/offer`
                        );
                      }
                    }}
                  >
                    Публичной оферте
                  </a>
                </div>
              </section>

              {/* Primary Action and Canonical Course Link */}
              <div className={styles.ctaBox}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={
                    !selectedPricingOptionId ||
                    getPublicAwareOptionEligibility(
                      selectedCourse.id,
                      selectedPricingOptionId,
                      currentStudentCourseStatus,
                      isAuthenticated
                    ).state !== "ELIGIBLE"
                  }
                  onClick={handleProceedToPayer}
                >
                  Оформить участие
                </button>

                {selectedCourse.course_page_url && (
                  <a
                    href={selectedCourse.course_page_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.coursePageBtn}
                    onClick={(e) => {
                      if (window.Telegram?.WebApp?.openLink) {
                        e.preventDefault();
                        window.Telegram.WebApp.openLink(selectedCourse.course_page_url!);
                      }
                    }}
                  >
                    Подробнее о курсе ↗
                  </a>
                )}

                <p className={styles.pilotNotice}>
                  Далее — выбор типа плательщика · Данные и оплата оформляются на следующих шагах
                </p>
              </div>
            </article>
          )}

          <footer className={styles.footer}>
            <p className={styles.footerText}>
              Академия структурной типологии · Официальный Telegram-сервис
            </p>
          </footer>
        </>
      ) : screen === "payer" ? (
        /* SCREEN 3: PAYER SELECTION (Batch 2 — UI only, zero persistence) */
        <>
          <nav className={styles.navBar}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => setScreen("detail")}
            >
              ← Тарифы и поток
            </button>
            <span className={styles.navTitle}>Оформление участия</span>
          </nav>

          <article className={styles.detailCard}>
            <h1 className={styles.payerHeading}>Кто будет оплачивать?</h1>
            <p className={styles.payerSubheading}>Выберите тип плательщика</p>

            {/* Source-backed selection summary — no hardcoded commercial facts (§19) */}
            {selectedCourse && selectedCohort && selectedPricingOption && (
              <div className={styles.payerSummaryCard}>
                <div className={styles.payerSummaryRow}>
                  <span className={styles.payerSummaryLabel}>Программа</span>
                  <span className={styles.payerSummaryValue}>
                    {selectedCourse.title}
                  </span>
                </div>
                <div className={styles.payerSummaryRow}>
                  <span className={styles.payerSummaryLabel}>Поток</span>
                  <span className={styles.payerSummaryValue}>
                    {selectedCohort.title}
                    {selectedCohort.start_date
                      ? ` · Старт: ${selectedCohort.start_date}`
                      : ""}
                  </span>
                </div>
                <div className={styles.payerSummaryRow}>
                  <span className={styles.payerSummaryLabel}>Тариф</span>
                  <span className={styles.payerSummaryValue}>
                    {selectedPricingOption.title}
                  </span>
                </div>
                <div className={styles.payerSummaryTotal}>
                  {typeof selectedPricingOption.base_price === "number" && (
                    <span className={styles.basePriceStrikethrough}>
                      {selectedPricingOption.base_price.toLocaleString("ru-RU")} ₽
                    </span>
                  )}
                  <span className={styles.payerSummaryPrice}>
                    {selectedPricingOption.price.toLocaleString("ru-RU")} ₽
                  </span>
                  {typeof selectedPricingOption.discount_percent === "number" && (
                    <span className={styles.discountBadge}>
                      -{selectedPricingOption.discount_percent}%
                    </span>
                  )}
                </div>
              </div>
            )}

            <div
              className={styles.payerList}
              role="radiogroup"
              aria-label="Тип плательщика"
            >
              {PAYER_TYPE_OPTIONS.map((opt) => {
                const isSelected = selectedPayerType === opt.value;
                return (
                  <div
                    key={opt.value}
                    role="radio"
                    aria-checked={isSelected}
                    tabIndex={0}
                    className={`${styles.payerCard} ${
                      isSelected ? styles.payerCardSelected : ""
                    }`}
                    onClick={() => setSelectedPayerType(opt.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedPayerType(opt.value);
                      }
                    }}
                  >
                    <div className={styles.cohortRadioGroup}>
                      <div className={styles.cohortRadioIndicator}>
                        {isSelected && <div className={styles.cohortRadioDot} />}
                      </div>
                      <span className={styles.payerCardTitle}>{opt.title}</span>
                    </div>
                    <div className={styles.payerCardDesc}>{opt.description}</div>
                  </div>
                );
              })}
            </div>

            {/* Canonical Public Offer Notice (Batch 2 §18) */}
            <div className={styles.offerNoticeBox}>
              Условия оплаты и возврата указаны в{" "}
              <a
                href="/offer"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.offerLink}
                onClick={(e) => {
                  if (window.Telegram?.WebApp?.openLink) {
                    e.preventDefault();
                    window.Telegram.WebApp.openLink(
                      `${window.location.origin}/offer`
                    );
                  }
                }}
              >
                Публичной оферте
              </a>
            </div>

            <div className={styles.ctaBox}>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={!selectedPayerType}
                onClick={() => {
                  if (selectedPayerType === "legal_entity") {
                    setScreen("legal_entity_form");
                    setLegalEntityStep(1);
                    return;
                  }
                  if (selectedPayerType === "individual") setScreen("individual_form");
                  else if (selectedPayerType) setScreen("next_stage_stub");
                }}
              >
                Продолжить
              </button>
            </div>
          </article>

          <footer className={styles.footer}>
            <p className={styles.footerText}>
              Академия структурной типологии · Официальный Telegram-сервис
            </p>
          </footer>
        </>
      ) : screen === "next_stage_stub" ? (
        /* LOCAL-ONLY NEXT-STAGE STUB (Batch 2 §16 — no forms, no persistence) */
        <>
          <nav className={styles.navBar}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => setScreen("payer")}
            >
              ← Тип плательщика
            </button>
            <span className={styles.navTitle}>Оформление участия</span>
          </nav>

          <article className={styles.detailCard}>
            <h1 className={styles.payerHeading}>Следующий этап</h1>
            <p className={styles.payerSubheading}>
              Локальный предпросмотр перехода — данные не отправляются
            </p>

            {selectedPayerOption && (
              <div className={styles.stubStageCard}>
                <div className={styles.stubStageLabel}>
                  {getNextStageLabel(selectedPayerOption.value)}
                </div>
                <p className={styles.stubStageText}>
                  Форма подключается на следующем этапе. На этом шаге заявка не
                  создаётся, оплата не инициируется и никакие данные не
                  сохраняются.
                </p>
              </div>
            )}

            {selectedCourse &&
              selectedCohort &&
              selectedPricingOption &&
              selectedPayerOption && (
                <div className={styles.payerSummaryCard}>
                  <div className={styles.payerSummaryRow}>
                    <span className={styles.payerSummaryLabel}>Программа</span>
                    <span className={styles.payerSummaryValue}>
                      {selectedCourse.title}
                    </span>
                  </div>
                  <div className={styles.payerSummaryRow}>
                    <span className={styles.payerSummaryLabel}>Поток</span>
                    <span className={styles.payerSummaryValue}>
                      {selectedCohort.title}
                    </span>
                  </div>
                  <div className={styles.payerSummaryRow}>
                    <span className={styles.payerSummaryLabel}>Тариф</span>
                    <span className={styles.payerSummaryValue}>
                      {selectedPricingOption.title} ·{" "}
                      {selectedPricingOption.price.toLocaleString("ru-RU")} ₽
                    </span>
                  </div>
                  <div className={styles.payerSummaryRow}>
                    <span className={styles.payerSummaryLabel}>Плательщик</span>
                    <span className={styles.payerSummaryValue}>
                      {selectedPayerOption.title}
                    </span>
                  </div>
                </div>
              )}

            <div className={styles.ctaBox}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => setScreen("payer")}
              >
                Вернуться к выбору плательщика
              </button>
            </div>
          </article>

          <footer className={styles.footer}>
            <p className={styles.footerText}>
              Академия структурной типологии · Официальный Telegram-сервис
            </p>
          </footer>
        </>
      ) : screen === "individual_form" ? (
        /* BATCH 3 — SCREEN 4: INDIVIDUAL PARTICIPANT FORM
           Local-only: values live in React memory; no network, no persistence. */
        <>
          <nav className={styles.navBar}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => setScreen("payer")}
            >
              ← Тип плательщика
            </button>
            <span className={styles.navTitle}>Оформление участия</span>
          </nav>

          <article className={styles.detailCard}>
            <h1 className={styles.payerHeading}>Данные участника</h1>
            <p className={styles.payerSubheading}>
              Физическое лицо · для договора-оферты и списка группы
            </p>

            <div className={styles.formFields}>
              <div className={styles.formField}>
                <label htmlFor="individual-full-name" className={styles.formLabel}>
                  Фамилия и имя
                </label>
                <input
                  id="individual-full-name"
                  type="text"
                  autoComplete="name"
                  autoCapitalize="words"
                  enterKeyHint="next"
                  placeholder="Иванова Анна"
                  className={`${styles.formInput} ${
                    individualFieldError("full_name") ? styles.formInputInvalid : ""
                  }`}
                  value={individualForm.full_name}
                  onChange={(e) => updateIndividualField("full_name", e.target.value)}
                  onBlur={() => markIndividualFieldTouched("full_name")}
                  aria-invalid={Boolean(individualFieldError("full_name"))}
                  aria-describedby="individual-full-name-error"
                />
                {individualFieldError("full_name") && (
                  <p id="individual-full-name-error" className={styles.formError} role="alert">
                    {individualFieldError("full_name")}
                  </p>
                )}
              </div>

              <div className={styles.formField}>
                <label htmlFor="individual-phone" className={styles.formLabel}>
                  Телефон <span className={styles.formOptional}>(необязательно)</span>
                </label>
                <input
                  id="individual-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="next"
                  placeholder="+7 999 123-45-67"
                  className={`${styles.formInput} ${
                    individualFieldError("phone") ? styles.formInputInvalid : ""
                  }`}
                  value={individualForm.phone}
                  onChange={(e) => updateIndividualField("phone", e.target.value)}
                  onBlur={() => markIndividualFieldTouched("phone")}
                  aria-invalid={Boolean(individualFieldError("phone"))}
                  aria-describedby="individual-phone-hint individual-phone-error"
                />
                <p id="individual-phone-hint" className={styles.formHint}>
                  Только российские номера, формат +7XXXXXXXXXX
                </p>
                {individualFieldError("phone") && (
                  <p id="individual-phone-error" className={styles.formError} role="alert">
                    {individualFieldError("phone")}
                  </p>
                )}
              </div>

              <div className={styles.formField}>
                <label htmlFor="individual-email" className={styles.formLabel}>
                  Email
                </label>
                <input
                  id="individual-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="done"
                  placeholder="name@mail.ru"
                  className={`${styles.formInput} ${
                    individualFieldError("email") ? styles.formInputInvalid : ""
                  }`}
                  value={individualForm.email}
                  onChange={(e) => updateIndividualField("email", e.target.value)}
                  onBlur={() => markIndividualFieldTouched("email")}
                  aria-invalid={Boolean(individualFieldError("email"))}
                  aria-describedby="individual-email-hint individual-email-error"
                />
                <p id="individual-email-hint" className={styles.formHint}>
                  Для чека и ссылки на онлайн-встречи
                </p>
                {individualFieldError("email") && (
                  <p id="individual-email-error" className={styles.formError} role="alert">
                    {individualFieldError("email")}
                  </p>
                )}
              </div>
            </div>

            <div className={styles.ctaBox}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleIndividualFormContinue}
              >
                Продолжить
              </button>
            </div>
          </article>

          <footer className={styles.footer}>
            <p className={styles.footerText}>
              Академия структурной типологии · Официальный Telegram-сервис
            </p>
          </footer>
        </>
      ) : screen === "individual_confirmation" ? (
        /* BATCH 3 — SCREEN 5: INDIVIDUAL CONFIRMATION (local-only; no consent act) */
        <>
          <nav className={styles.navBar}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => setScreen("individual_form")}
            >
              ← Данные участника
            </button>
            <span className={styles.navTitle}>Оформление участия</span>
          </nav>

          <article className={styles.detailCard}>
            <h1 className={styles.payerHeading}>Проверьте данные</h1>
            <p className={styles.payerSubheading}>Убедитесь, что всё указано верно</p>

            {selectedCourse && selectedCohort && selectedPricingOption && individualDraft && (
              <div className={`${styles.payerSummaryCard} ${styles.confirmCard}`}>
                <div className={styles.payerSummaryRow}>
                  <span className={styles.payerSummaryLabel}>Программа</span>
                  <span className={styles.payerSummaryValue}>{selectedCourse.title}</span>
                </div>
                <div className={styles.payerSummaryRow}>
                  <span className={styles.payerSummaryLabel}>Тариф</span>
                  <span className={styles.payerSummaryValue}>
                    {selectedPricingOption.title}
                  </span>
                </div>
                <div className={styles.payerSummaryRow}>
                  <span className={styles.payerSummaryLabel}>Поток</span>
                  <span className={styles.payerSummaryValue}>{selectedCohort.title}</span>
                </div>
                {(selectedCohort.schedule || selectedCohort.start_date) && (
                  <div className={styles.payerSummaryRow}>
                    <span className={styles.payerSummaryLabel}>Расписание</span>
                    <span className={styles.payerSummaryValue}>
                      {[
                        selectedCohort.schedule,
                        selectedCohort.start_date ? `Старт: ${selectedCohort.start_date}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                )}
                <div className={styles.payerSummaryRow}>
                  <span className={styles.payerSummaryLabel}>Плательщик</span>
                  <span className={styles.payerSummaryValue}>
                    {selectedPayerOption?.title}
                  </span>
                </div>

                <div className={styles.confirmDivider} />

                <div className={styles.payerSummaryRow}>
                  <span className={styles.payerSummaryLabel}>Участник</span>
                  <span className={styles.payerSummaryValue}>{individualDraft.full_name}</span>
                </div>
                {individualDraft.phone && (
                  <div className={styles.payerSummaryRow}>
                    <span className={styles.payerSummaryLabel}>Телефон</span>
                    <span className={styles.payerSummaryValue}>{individualDraft.phone}</span>
                  </div>
                )}
                <div className={styles.payerSummaryRow}>
                  <span className={styles.payerSummaryLabel}>Email</span>
                  <span className={styles.payerSummaryValue}>{individualDraft.email}</span>
                </div>

                <div className={styles.payerSummaryTotal}>
                  <span className={styles.payerSummaryPrice}>
                    {selectedPricingOption.price.toLocaleString("ru-RU")} ₽
                  </span>
                </div>
              </div>
            )}

            {/* Informational only (Offer §7) — no consent is captured at this step */}
            <div className={styles.personalDataNotice}>
              Указанные данные будут обрабатываться в соответствии с разделом 7{" "}
              <a
                href="/offer"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.offerLink}
                onClick={(e) => {
                  if (window.Telegram?.WebApp?.openLink) {
                    e.preventDefault();
                    window.Telegram.WebApp.openLink(
                      `${window.location.origin}/offer`
                    );
                  }
                }}
              >
                Публичной оферты
              </a>{" "}
              после отправки заявки на следующем этапе. Сейчас данные никуда не
              передаются.
            </div>

            <div className={styles.ctaBox}>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={!individualDraft || submissionState === "submitting"}
                onClick={() => {
                  if (individualDraft) {
                    handleExecuteSubmission(individualDraft, "individual");
                  }
                }}
              >
                Оформить заявку
              </button>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setScreen("individual_form")}
              >
                Изменить данные
              </button>
            </div>
          </article>

          <footer className={styles.footer}>
            <p className={styles.footerText}>
              Академия структурной типологии · Официальный Telegram-сервис
            </p>
          </footer>
        </>
      ) : screen === "individual_next_stage" ? (
        /* BATCH 3 — INDIVIDUAL LOCAL NEXT-STAGE STUB (future submission/payment stage) */
        <>
          <nav className={styles.navBar}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => setScreen("individual_confirmation")}
            >
              ← Проверка данных
            </button>
            <span className={styles.navTitle}>Оформление участия</span>
          </nav>

          <article className={styles.detailCard}>
            <h1 className={styles.payerHeading}>Оформление заявки</h1>
            <p className={styles.payerSubheading}>Следующий этап</p>

            <div className={styles.stubStageCard}>
              <div className={styles.stubStageLabel}>Скоро будет доступно</div>
              <p className={styles.stubStageText}>
                Следующий шаг оформления станет доступен на следующем этапе.
                Введённые данные хранятся только на этом экране и никуда не
                передаются.
              </p>
            </div>

            <div className={styles.ctaBox}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => setScreen("individual_confirmation")}
              >
                Вернуться к проверке данных
              </button>
            </div>
          </article>

          <footer className={styles.footer}>
            <p className={styles.footerText}>
              Академия структурной типологии · Официальный Telegram-сервис
            </p>
          </footer>
        </>
      ) : null}

      {/* Bounded Telegram-auth-required state (Batch 2 §10) */}
      {showAuthRequiredModal && (
        <div
          className={styles.pilotModalOverlay}
          onClick={() => setShowAuthRequiredModal(false)}
        >
          <div
            className={styles.pilotModal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalTitle}>Требуется вход через Telegram</div>
            <p className={styles.modalText}>
              Каталог, потоки и тарифы доступны для просмотра. Чтобы продолжить
              оформление участия и выбрать плательщика, откройте Mini App внутри
              Telegram — это необходимо для безопасной персональной проверки.
            </p>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => setShowAuthRequiredModal(false)}
            >
              Понятно
            </button>
          </div>
        </div>
      )}

      {/* CORR1: Telegram session present, but participation status could not be loaded */}
      {showStatusUnavailableModal && (
        <div
          className={styles.pilotModalOverlay}
          onClick={() => setShowStatusUnavailableModal(false)}
        >
          <div
            className={styles.pilotModal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalTitle}>Не удалось проверить статус участия</div>
            <p className={styles.modalText}>
              Сервис проверки временно не ответил. Каталог, потоки и тарифы
              доступны для просмотра. Чтобы продолжить оформление участия,
              повторите проверку.
            </p>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                setShowStatusUnavailableModal(false);
                loadStudentStatus();
              }}
            >
              Повторить проверку
            </button>
          </div>
        </div>
      )}
      {/* BATCH 4 — LEGAL ENTITY / IP FLOW */}
      <LegalEntityFlow
        screen={screen as "legal_entity_form" | "legal_entity_confirmation" | "legal_entity_next_stage"}
        setScreen={setScreen}
        legalEntityStep={legalEntityStep}
        setLegalEntityStep={setLegalEntityStep}
        legalEntityForm={legalEntityForm}
        updateLegalEntityField={updateLegalEntityField}
        markLegalEntityFieldTouched={markLegalEntityFieldTouched}
        legalEntityTouched={legalEntityTouched}
        setLegalEntityTouched={setLegalEntityTouched}
        legalEntityContinueAttempted={legalEntityContinueAttempted}
        legalEntityValidation={legalEntityValidation}
        legalEntityDraft={legalEntityDraft}
        selectedCourse={selectedCourse}
        selectedCohort={selectedCohort}
        selectedPricingOption={selectedPricingOption}
        selectedPayerOption={selectedPayerOption}
        handleStep1Continue={handleLegalEntityStep1Continue}
        handleStep2Continue={handleLegalEntityStep2Continue}
        handleStep3Continue={handleLegalEntityStep3Continue}
        handleStep4Continue={handleLegalEntityStep4Continue}
        submissionState={submissionState}
        onSubmitApplication={() => {
          if (legalEntityDraft) {
            handleExecuteSubmission(legalEntityDraft, "legal_entity");
          }
        }}
      />

      {/* BATCH 5 — SUBMISSION RESULT & SUCCESS SCREEN */}
      {screen === "submission_result" && (
        <SubmissionResultScreen
          submissionState={submissionState}
          submissionError={submissionError}
          submissionAppId={submissionAppId}
          onRetry={() => {
            if (selectedPayerType === "legal_entity" && legalEntityDraft) {
              handleExecuteSubmission(legalEntityDraft, "legal_entity");
            } else if (individualDraft) {
              handleExecuteSubmission(individualDraft, "individual");
            }
          }}
          onBack={() => {
            if (selectedPayerType === "legal_entity") {
              setScreen("legal_entity_confirmation");
            } else {
              setScreen("individual_confirmation");
            }
          }}
          onGoCatalog={() => {
            setScreen("catalog");
            setSubmissionState("idle");
          }}
        />
      )}

    </main>
  );
}
