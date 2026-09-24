import React from "react";
import styles from "./miniapp.module.css";
import {
  Course,
  Cohort,
  PricingOption,
  PayerTypeOption,
} from "./helpers.ts";
import {
  LegalEntityFormValues,
  LegalEntityFormField,
  LegalEntityFormValidation,
  LegalEntityEnrollmentDraft,
  EDO_OPTIONS,
} from "./legal-entity-helpers.ts";

export interface LegalEntityFlowProps {
  screen: "legal_entity_form" | "legal_entity_confirmation" | "legal_entity_next_stage";
  setScreen: (screen: "catalog" | "detail" | "payer" | "next_stage_stub" | "individual_form" | "individual_confirmation" | "individual_next_stage" | "legal_entity_form" | "legal_entity_confirmation" | "legal_entity_next_stage") => void;
  legalEntityStep: 1 | 2 | 3 | 4;
  setLegalEntityStep: (step: 1 | 2 | 3 | 4) => void;
  legalEntityForm: LegalEntityFormValues;
  updateLegalEntityField: (field: LegalEntityFormField, value: string) => void;
  markLegalEntityFieldTouched: (field: LegalEntityFormField) => void;
  legalEntityTouched: Partial<Record<LegalEntityFormField, boolean>>;
  setLegalEntityTouched: React.Dispatch<React.SetStateAction<Partial<Record<LegalEntityFormField, boolean>>>>;
  legalEntityContinueAttempted: Record<1 | 2 | 3 | 4, boolean>;
  legalEntityValidation: LegalEntityFormValidation;
  legalEntityDraft: LegalEntityEnrollmentDraft | null;
  selectedCourse: Course | null;
  selectedCohort: Cohort | null;
  selectedPricingOption: PricingOption | null;
  selectedPayerOption?: PayerTypeOption | null;
  handleStep1Continue: () => void;
  handleStep2Continue: () => void;
  handleStep3Continue: () => void;
  handleStep4Continue: () => void;
}

export function LegalEntityFlow({
  screen,
  setScreen,
  legalEntityStep,
  setLegalEntityStep,
  legalEntityForm,
  updateLegalEntityField,
  markLegalEntityFieldTouched,
  legalEntityTouched,
  setLegalEntityTouched,
  legalEntityContinueAttempted,
  legalEntityValidation,
  legalEntityDraft,
  selectedCourse,
  selectedCohort,
  selectedPricingOption,
  selectedPayerOption,
  handleStep1Continue,
  handleStep2Continue,
  handleStep3Continue,
  handleStep4Continue,
}: LegalEntityFlowProps) {
  const legalEntityFieldError = (
    field: LegalEntityFormField,
    step: 1 | 2 | 3 | 4
  ): string | undefined =>
    legalEntityTouched[field] || legalEntityContinueAttempted[step]
      ? legalEntityValidation.errors[field]
      : undefined;

  if (screen === "legal_entity_form") {
    return (
      /* BATCH 4 — SCREEN 4: LEGAL ENTITY / IP FORM (LOCAL ONLY, 4 STEPS) */
      <>
        <nav className={styles.navBar}>
          <button
            type="button"
            className={styles.backBtn}
            onClick={() => {
              if (legalEntityStep === 4) setLegalEntityStep(3);
              else if (legalEntityStep === 3) setLegalEntityStep(2);
              else if (legalEntityStep === 2) setLegalEntityStep(1);
              else setScreen("payer");
            }}
          >
            {legalEntityStep === 1
              ? "← Тип плательщика"
              : legalEntityStep === 2
              ? "← Организация"
              : legalEntityStep === 3
              ? "← Банковские реквизиты"
              : "← Документы"}
          </button>
          <span className={styles.navTitle}>Реквизиты юрлица / ИП</span>
        </nav>

        <article className={styles.detailCard}>
          <div className={styles.stepperHeader}>
            <span className={styles.stepBadge}>Шаг {legalEntityStep} из 4</span>
          </div>

          {legalEntityStep === 1 ? (
            /* STEP 1: ОРГАНИЗАЦИЯ */
            <>
              <h1 className={styles.payerHeading}>Организация</h1>
              <p className={styles.payerSubheading}>
                ИП или юридическое лицо · для выставления счета и договора
              </p>

              <div className={styles.formFields}>
                <div className={styles.formField}>
                  <label htmlFor="legal-entity-inn" className={styles.formLabel}>
                    ИНН
                  </label>
                  <input
                    id="legal-entity-inn"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    enterKeyHint="next"
                    placeholder="10 цифр для юрлиц или 12 цифр для ИП"
                    className={`${styles.formInput} ${
                      legalEntityFieldError("inn", 1) ? styles.formInputInvalid : ""
                    }`}
                    value={legalEntityForm.inn}
                    onChange={(e) => updateLegalEntityField("inn", e.target.value)}
                    onBlur={() => markLegalEntityFieldTouched("inn")}
                    aria-invalid={Boolean(legalEntityFieldError("inn", 1))}
                    aria-describedby="legal-entity-inn-error"
                  />
                  {legalEntityValidation.entityType && (
                    <div className={styles.entityTypeBadge} data-testid="entity-type-badge">
                      {legalEntityValidation.entityType === "legal_entity"
                        ? "🏢 Юридическое лицо"
                        : "👤 Индивидуальный предприниматель"}
                    </div>
                  )}
                  {legalEntityFieldError("inn", 1) && (
                    <p id="legal-entity-inn-error" className={styles.formError} role="alert">
                      {legalEntityFieldError("inn", 1)}
                    </p>
                  )}
                </div>

                <div className={styles.formField}>
                  <label htmlFor="legal-entity-company-name" className={styles.formLabel}>
                    Наименование
                  </label>
                  <input
                    id="legal-entity-company-name"
                    type="text"
                    autoComplete="organization"
                    enterKeyHint="next"
                    placeholder="ООО «Вектор» или ИП Иванов И. И."
                    className={`${styles.formInput} ${
                      legalEntityFieldError("company_name", 1) ? styles.formInputInvalid : ""
                    }`}
                    value={legalEntityForm.company_name}
                    onChange={(e) => updateLegalEntityField("company_name", e.target.value)}
                    onBlur={() => markLegalEntityFieldTouched("company_name")}
                    aria-invalid={Boolean(legalEntityFieldError("company_name", 1))}
                    aria-describedby="legal-entity-company-name-error"
                  />
                  {legalEntityFieldError("company_name", 1) && (
                    <p
                      id="legal-entity-company-name-error"
                      className={styles.formError}
                      role="alert"
                    >
                      {legalEntityFieldError("company_name", 1)}
                    </p>
                  )}
                </div>

                {legalEntityValidation.entityType === "legal_entity" && (
                  <div className={styles.formField} data-testid="kpp-field-container">
                    <label htmlFor="legal-entity-kpp" className={styles.formLabel}>
                      КПП <span className={styles.formOptional}>(необязательно)</span>
                    </label>
                    <input
                      id="legal-entity-kpp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      enterKeyHint="next"
                      placeholder="9 цифр"
                      className={`${styles.formInput} ${
                        legalEntityFieldError("kpp", 1) ? styles.formInputInvalid : ""
                      }`}
                      value={legalEntityForm.kpp}
                      onChange={(e) => updateLegalEntityField("kpp", e.target.value)}
                      onBlur={() => markLegalEntityFieldTouched("kpp")}
                      aria-invalid={Boolean(legalEntityFieldError("kpp", 1))}
                      aria-describedby="legal-entity-kpp-error"
                    />
                    {legalEntityFieldError("kpp", 1) && (
                      <p id="legal-entity-kpp-error" className={styles.formError} role="alert">
                        {legalEntityFieldError("kpp", 1)}
                      </p>
                    )}
                  </div>
                )}

                <div className={styles.formField}>
                  <label htmlFor="legal-entity-address" className={styles.formLabel}>
                    Юридический адрес <span className={styles.formOptional}>(необязательно)</span>
                  </label>
                  <input
                    id="legal-entity-address"
                    type="text"
                    autoComplete="street-address"
                    enterKeyHint="done"
                    placeholder="г. Санкт-Петербург, Невский пр-кт, д. 1"
                    className={styles.formInput}
                    value={legalEntityForm.company_address}
                    onChange={(e) => updateLegalEntityField("company_address", e.target.value)}
                    onBlur={() => markLegalEntityFieldTouched("company_address")}
                  />
                </div>
              </div>

              <div className={styles.ctaBox}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleStep1Continue}
                >
                  Продолжить
                </button>
              </div>
            </>
          ) : legalEntityStep === 2 ? (
            /* STEP 2: БАНКОВСКИЕ РЕКВИЗИТЫ */
            <>
              <h1 className={styles.payerHeading}>Банковские реквизиты</h1>
              <p className={styles.payerSubheading}>
                Реквизиты расчетного счета в банке РФ
              </p>

              <div className={styles.formFields}>
                <div className={styles.formField}>
                  <label htmlFor="legal-entity-bik" className={styles.formLabel}>
                    БИК
                  </label>
                  <input
                    id="legal-entity-bik"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    enterKeyHint="next"
                    placeholder="9 цифр, начинается с 04"
                    className={`${styles.formInput} ${
                      legalEntityFieldError("bik", 2) ? styles.formInputInvalid : ""
                    }`}
                    value={legalEntityForm.bik}
                    onChange={(e) => updateLegalEntityField("bik", e.target.value)}
                    onBlur={() => markLegalEntityFieldTouched("bik")}
                    aria-invalid={Boolean(legalEntityFieldError("bik", 2))}
                    aria-describedby="legal-entity-bik-error"
                  />
                  {legalEntityFieldError("bik", 2) && (
                    <p id="legal-entity-bik-error" className={styles.formError} role="alert">
                      {legalEntityFieldError("bik", 2)}
                    </p>
                  )}
                </div>

                <div className={styles.formField}>
                  <label htmlFor="legal-entity-account" className={styles.formLabel}>
                    Расчетный счет
                  </label>
                  <input
                    id="legal-entity-account"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    enterKeyHint="done"
                    placeholder="20 цифр"
                    className={`${styles.formInput} ${
                      legalEntityFieldError("account", 2) ? styles.formInputInvalid : ""
                    }`}
                    value={legalEntityForm.account}
                    onChange={(e) => updateLegalEntityField("account", e.target.value)}
                    onBlur={() => markLegalEntityFieldTouched("account")}
                    aria-invalid={Boolean(legalEntityFieldError("account", 2))}
                    aria-describedby="legal-entity-account-error"
                  />
                  {legalEntityFieldError("account", 2) && (
                    <p id="legal-entity-account-error" className={styles.formError} role="alert">
                      {legalEntityFieldError("account", 2)}
                    </p>
                  )}
                </div>
              </div>

              <div className={styles.ctaBox}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleStep2Continue}
                >
                  Продолжить
                </button>
              </div>
            </>
          ) : legalEntityStep === 3 ? (
            /* STEP 3: ДОКУМЕНТЫ */
            <>
              <h1 className={styles.payerHeading}>Документы</h1>
              <p className={styles.payerSubheading}>
                Email бухгалтерии и способ обмена закрывающими документами
              </p>

              <div className={styles.formFields}>
                <div className={styles.formField}>
                  <label htmlFor="legal-entity-doc-email" className={styles.formLabel}>
                    Email бухгалтерии
                  </label>
                  <input
                    id="legal-entity-doc-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="done"
                    placeholder="buh@company.ru"
                    className={`${styles.formInput} ${
                      legalEntityFieldError("doc_email", 3) ? styles.formInputInvalid : ""
                    }`}
                    value={legalEntityForm.doc_email}
                    onChange={(e) => updateLegalEntityField("doc_email", e.target.value)}
                    onBlur={() => markLegalEntityFieldTouched("doc_email")}
                    aria-invalid={Boolean(legalEntityFieldError("doc_email", 3))}
                    aria-describedby="legal-entity-doc-email-hint legal-entity-doc-email-error"
                  />
                  <p id="legal-entity-doc-email-hint" className={styles.formHint}>
                    Сюда будет направлен счет на оплату и закрывающие акты
                  </p>
                  {legalEntityFieldError("doc_email", 3) && (
                    <p
                      id="legal-entity-doc-email-error"
                      className={styles.formError}
                      role="alert"
                    >
                      {legalEntityFieldError("doc_email", 3)}
                    </p>
                  )}
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel}>
                    Закрывающие документы (акты)
                  </label>
                  <div className={styles.edoGroup} role="radiogroup">
                    {EDO_OPTIONS.map((opt) => {
                      const isSelected = legalEntityForm.edo_type === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          className={`${styles.edoButton} ${
                            isSelected ? styles.edoButtonSelected : ""
                          }`}
                          onClick={() => {
                            updateLegalEntityField("edo_type", opt.value);
                            setLegalEntityTouched((prev) => ({ ...prev, edo_type: true }));
                          }}
                        >
                          <span>{opt.label}</span>
                          {isSelected && <span className={styles.edoCheck}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                  {legalEntityFieldError("edo_type", 3) && (
                    <p id="legal-entity-edo-error" className={styles.formError} role="alert">
                      {legalEntityFieldError("edo_type", 3)}
                    </p>
                  )}
                </div>
              </div>

              <div className={styles.ctaBox}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleStep3Continue}
                >
                  Продолжить
                </button>
              </div>
            </>
          ) : (
            /* STEP 4: КОНТАКТНОЕ ЛИЦО */
            <>
              <h1 className={styles.payerHeading}>Контактное лицо</h1>
              <p className={styles.payerSubheading}>
                ФИО и телефон контактного лица (слушателя или куратора обучения от компании)
              </p>

              <div className={styles.formFields}>
                <div className={styles.formField}>
                  <label htmlFor="legal-entity-contact-person" className={styles.formLabel}>
                    ФИО и телефон
                  </label>
                  <input
                    id="legal-entity-contact-person"
                    type="text"
                    autoComplete="name"
                    enterKeyHint="done"
                    placeholder="Иванов Иван Иванович, +7 999 123-45-67"
                    className={`${styles.formInput} ${
                      legalEntityFieldError("contact_person", 4) ? styles.formInputInvalid : ""
                    }`}
                    value={legalEntityForm.contact_person}
                    onChange={(e) => updateLegalEntityField("contact_person", e.target.value)}
                    onBlur={() => markLegalEntityFieldTouched("contact_person")}
                    aria-invalid={Boolean(legalEntityFieldError("contact_person", 4))}
                    aria-describedby="legal-entity-contact-person-error"
                  />
                  {legalEntityFieldError("contact_person", 4) && (
                    <p
                      id="legal-entity-contact-person-error"
                      className={styles.formError}
                      role="alert"
                    >
                      {legalEntityFieldError("contact_person", 4)}
                    </p>
                  )}
                </div>
              </div>

              <div className={styles.ctaBox}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleStep4Continue}
                >
                  Продолжить к проверке данных
                </button>
              </div>
            </>
          )}
        </article>

        <footer className={styles.footer}>
          <p className={styles.footerText}>
            Академия структурной типологии · Официальный Telegram-сервис
          </p>
        </footer>
      </>
    );
  }

  if (screen === "legal_entity_confirmation") {
    return (
      /* BATCH 4 — SCREEN 5: LEGAL ENTITY CONFIRMATION (local-only) */
      <>
        <nav className={styles.navBar}>
          <button
            type="button"
            className={styles.backBtn}
            onClick={() => {
              setScreen("legal_entity_form");
              setLegalEntityStep(4);
            }}
          >
            ← Контактное лицо
          </button>
          <span className={styles.navTitle}>Оформление участия</span>
        </nav>

        <article className={styles.detailCard}>
          <h1 className={styles.payerHeading}>Проверьте данные</h1>
          <p className={styles.payerSubheading}>Убедитесь, что все реквизиты указаны верно</p>

          {selectedCourse && selectedCohort && selectedPricingOption && legalEntityDraft && (
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
              <div className={styles.payerSummaryRow}>
                <span className={styles.payerSummaryLabel}>Форма</span>
                <span className={styles.payerSummaryValue}>
                  {legalEntityDraft.entity_type === "legal_entity"
                    ? "Юридическое лицо"
                    : "Индивидуальный предприниматель"}
                </span>
              </div>

              <div className={styles.confirmDivider} />

              <div className={styles.payerSummaryRow}>
                <span className={styles.payerSummaryLabel}>Организация</span>
                <span className={styles.payerSummaryValue}>{legalEntityDraft.company_name}</span>
              </div>
              <div className={styles.payerSummaryRow}>
                <span className={styles.payerSummaryLabel}>ИНН</span>
                <span className={styles.payerSummaryValue}>{legalEntityDraft.inn}</span>
              </div>
              {legalEntityDraft.kpp && (
                <div className={styles.payerSummaryRow}>
                  <span className={styles.payerSummaryLabel}>КПП</span>
                  <span className={styles.payerSummaryValue}>{legalEntityDraft.kpp}</span>
                </div>
              )}
              {legalEntityDraft.company_address && (
                <div className={styles.payerSummaryRow}>
                  <span className={styles.payerSummaryLabel}>Юр. адрес</span>
                  <span className={styles.payerSummaryValue}>
                    {legalEntityDraft.company_address}
                  </span>
                </div>
              )}

              <div className={styles.confirmDivider} />

              <div className={styles.payerSummaryRow}>
                <span className={styles.payerSummaryLabel}>БИК</span>
                <span className={styles.payerSummaryValue}>{legalEntityDraft.bik}</span>
              </div>
              <div className={styles.payerSummaryRow}>
                <span className={styles.payerSummaryLabel}>Расчетный счет</span>
                <span className={styles.payerSummaryValue}>{legalEntityDraft.account}</span>
              </div>

              <div className={styles.confirmDivider} />

              <div className={styles.payerSummaryRow}>
                <span className={styles.payerSummaryLabel}>Email бухгалтерии</span>
                <span className={styles.payerSummaryValue}>{legalEntityDraft.doc_email}</span>
              </div>
              <div className={styles.payerSummaryRow}>
                <span className={styles.payerSummaryLabel}>ЭДО</span>
                <span className={styles.payerSummaryValue}>
                  {legalEntityDraft.edo_type === "Диадок"
                    ? "Диадок (Контур)"
                    : legalEntityDraft.edo_type === "СБИС"
                    ? "СБИС (Тензор)"
                    : "Скан по Email (без ЭДО)"}
                </span>
              </div>
              <div className={styles.payerSummaryRow}>
                <span className={styles.payerSummaryLabel}>Контактное лицо</span>
                <span className={styles.payerSummaryValue}>
                  {legalEntityDraft.contact_person}
                </span>
              </div>

              <div className={styles.payerSummaryTotal}>
                <span className={styles.payerSummaryPrice}>
                  {selectedPricingOption.price.toLocaleString("ru-RU")} ₽
                </span>
              </div>
            </div>
          )}

          <div className={styles.personalDataNotice}>
            Указанные реквизиты будут использованы для выставления счета и закрывающих
            документов в соответствии с разделом 7{" "}
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
              disabled={!legalEntityDraft}
              onClick={() => {
                if (legalEntityDraft) setScreen("legal_entity_next_stage");
              }}
            >
              Продолжить
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => {
                setScreen("legal_entity_form");
                setLegalEntityStep(1);
              }}
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
    );
  }

  if (screen === "legal_entity_next_stage") {
    return (
      /* BATCH 4 — LEGAL ENTITY LOCAL NEXT-STAGE STUB */
      <>
        <nav className={styles.navBar}>
          <button
            type="button"
            className={styles.backBtn}
            onClick={() => setScreen("legal_entity_confirmation")}
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
              Следующий шаг оформления для ИП и юридических лиц станет доступен на
              следующем этапе. Введённые реквизиты хранятся только на этом экране
              и никуда не передаются.
            </p>
          </div>

          <div className={styles.ctaBox}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => setScreen("legal_entity_confirmation")}
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
    );
  }

  return null;
}
