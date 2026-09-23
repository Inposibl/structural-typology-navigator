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
  getOptionEligibility,
  getMeetingWord,
  extractCadence,
  resolveDeepLinkCourseId,
  isCohortAvailable,
  isCohortWaitingList,
  isCohortUnavailable,
  getCohortBadgeText,
} from "./helpers";

export type { Course, Cohort, PricingOption, ApiResponse, StudentCourseStatus, StudentStatusResponse, OptionState };
export {
  getOptionEligibility,
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

export default function TikhonMiniAppPilotPage() {
  const [screen, setScreen] = useState<"catalog" | "detail">("catalog");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedCohortId, setSelectedCohortId] = useState<string | null>(null);
  const [selectedPricingOptionId, setSelectedPricingOptionId] = useState<string | null>(null);
  const [showNoticeModal, setShowNoticeModal] = useState(false);

  // Live data state from authoritative Supabase-backed API
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Student authenticated status (Batch 1 CORR1: Private Entitlements)
  const [studentStatus, setStudentStatus] = useState<StudentStatusResponse | null>(null);

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
  useEffect(() => {
    async function loadStudentStatus() {
      if (typeof window === "undefined") return;
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) return;
      try {
        const res = await fetch("/api/tikhon/student-status", {
          headers: {
            "x-telegram-init-data": initData,
          },
        });
        if (res.ok) {
          const data: StudentStatusResponse = await res.json();
          setStudentStatus(data);
        }
      } catch (e) {
        console.error("Failed to load student status:", e);
      }
    }
    loadStudentStatus();
  }, []);

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

        if (screen === "detail") {
          tg.BackButton?.show();
          const handleBack = () => setScreen("catalog");
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
  }, [screen]);

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

  // Auto-select initial eligible pricing option when course or student status changes
  useEffect(() => {
    if (!selectedCourse?.pricing_options || selectedCourse.pricing_options.length === 0) {
      setSelectedPricingOptionId(null);
      return;
    }

    const firstEligible = selectedCourse.pricing_options.find((opt) => {
      const { state } = getOptionEligibility(
        selectedCourse.id,
        opt.id,
        currentStudentCourseStatus
      );
      return state === "ELIGIBLE";
    });

    if (firstEligible) {
      setSelectedPricingOptionId(firstEligible.id);
    } else {
      setSelectedPricingOptionId(selectedCourse.pricing_options[0].id);
    }
  }, [selectedCourse, currentStudentCourseStatus]);

  const selectedCohort = useMemo(() => {
    if (!selectedCourse?.cohorts) return null;
    return selectedCourse.cohorts.find((ch) => ch.id === selectedCohortId) || selectedCourse.cohorts[0] || null;
  }, [selectedCourse, selectedCohortId]);

  const selectedPricingOption = useMemo(() => {
    if (!selectedCourse?.pricing_options) return null;
    return selectedCourse.pricing_options.find((opt) => opt.id === selectedPricingOptionId) || selectedCourse.pricing_options[0] || null;
  }, [selectedCourse, selectedPricingOptionId]);

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
      ) : (
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
                    const eligibility = getOptionEligibility(
                      selectedCourse.id,
                      opt.id,
                      currentStudentCourseStatus
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
                    getOptionEligibility(
                      selectedCourse.id,
                      selectedPricingOptionId,
                      currentStudentCourseStatus
                    ).state !== "ELIGIBLE"
                  }
                  onClick={() => setShowNoticeModal(true)}
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
                  Выбор тарифа и потока фиксируется в Mini App · Завершение оформления в Telegram-боте
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
      )}

      {/* Non-trapping informational bottom sheet for Batch 1 */}
      {showNoticeModal && (
        <div
          className={styles.pilotModalOverlay}
          onClick={() => setShowNoticeModal(false)}
        >
          <div
            className={styles.pilotModal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalTitle}>Выбор зафиксирован</div>
            <p className={styles.modalText}>
              Вы выбрали курс <strong>«{selectedCourse?.title}»</strong>
              {selectedCohort ? `, поток: «${selectedCohort.title}»` : ""}
              {selectedPricingOption
                ? `, тариф: «${selectedPricingOption.title}» (${selectedPricingOption.price.toLocaleString("ru-RU")} ₽)`
                : ""}.
              <br />
              <br />
              Онлайн-оплата (Screen 3) подключается на следующем этапе.
              Чтобы получить ссылку на оплату прямо сейчас, перейдите в чат с секретарем Тихоном.
            </p>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                setShowNoticeModal(false);
                if (window.Telegram?.WebApp?.close) {
                  window.Telegram.WebApp.close();
                } else {
                  setScreen("catalog");
                }
              }}
            >
              Перейти в диалог бота
            </button>
            <button
              type="button"
              className={styles.modalCloseBtn}
              style={{ marginTop: "8px" }}
              onClick={() => setShowNoticeModal(false)}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
