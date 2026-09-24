import {
  Course,
  Cohort,
  PricingOption,
} from "./helpers.ts";

/* ------------------------------------------------------------------ */
/* Batch 4: Legal entity & IP enrollment (UI + local validation only) */
/* ------------------------------------------------------------------ */

export type LegalEntityType = "legal_entity" | "individual_entrepreneur";
export type EdoType = "Диадок" | "СБИС" | "Email_Scan";

export interface LegalEntityFormValues {
  inn: string;
  company_name: string;
  kpp: string;
  company_address: string;
  bik: string;
  account: string;
  doc_email: string;
  edo_type: EdoType | "";
  contact_person: string;
}

export type LegalEntityFormField = keyof LegalEntityFormValues;

export const EMPTY_LEGAL_ENTITY_FORM: LegalEntityFormValues = {
  inn: "",
  company_name: "",
  kpp: "",
  company_address: "",
  bik: "",
  account: "",
  doc_email: "",
  edo_type: "",
  contact_person: "",
};

export const INN_NON_DIGITS_ERROR = "ИНН должен содержать только цифры.";
export const INN_LENGTH_ERROR =
  "Длина ИНН должна быть 10 (для юрлиц) или 12 цифр (для ИП).";
export const INN_LEGAL_ENTITY_CHECKSUM_ERROR =
  "Контрольная сумма ИНН юрлица не совпадает (опечатка в номере).";
export const INN_IP_CHECKSUM_ERROR =
  "Контрольная сумма ИНН ИП не совпадает (опечатка в номере).";

export const COMPANY_NAME_ERROR =
  "Пожалуйста, укажите наименование компании или ИП.";
export const KPP_FORMAT_ERROR = "КПП должен состоять ровно из 9 цифр.";

export const BIK_NON_DIGITS_ERROR = "БИК должен состоять только из цифр.";
export const BIK_LENGTH_ERROR =
  "Длина БИК должна составлять ровно 9 цифр.";
export const BIK_PREFIX_ERROR =
  "Российский БИК должен начинаться с кода РФ '04'.";

export const ACCOUNT_NON_DIGITS_ERROR =
  "Расчетный счет должен содержать только цифры.";
export const ACCOUNT_LENGTH_ERROR =
  "Расчетный счет должен состоять из 20 цифр.";
export const ACCOUNT_BIK_INVALID_ERROR =
  "Невозможно проверить расчетный счет с некорректным БИК.";
export const ACCOUNT_CHECKSUM_ERROR =
  "Контрольный ключ расчетного счета не сходится с БИК (проверьте номер счета и банк).";

export const DOC_EMAIL_ERROR =
  "Пожалуйста, введите корректный email бухгалтерии.";
export const EDO_TYPE_ERROR =
  "Пожалуйста, выберите способ получения закрывающих документов.";
export const CONTACT_PERSON_ERROR =
  "Пожалуйста, укажите ФИО и телефон контактного лица.";

export interface InnValidationResult {
  valid: boolean;
  entityType?: LegalEntityType;
  error?: string;
}

/**
 * Validates Russian INN (10 digits for legal entity, 12 digits for individual entrepreneur)
 * using application checksum validator algorithms (chatbot validators.validate_inn parity).
 */
export function validateLegalEntityInn(inn: string): InnValidationResult {
  const cleaned = inn.trim();
  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, error: INN_NON_DIGITS_ERROR };
  }
  if (cleaned.length !== 10 && cleaned.length !== 12) {
    return { valid: false, error: INN_LENGTH_ERROR };
  }

  const digits = cleaned.split("").map((d) => parseInt(d, 10));

  if (cleaned.length === 10) {
    const coefficients = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    const controlSum = coefficients.reduce(
      (sum, coeff, idx) => sum + coeff * digits[idx],
      0
    );
    const controlDigit = (controlSum % 11) % 10;
    if (controlDigit === digits[9]) {
      return { valid: true, entityType: "legal_entity" };
    }
    return { valid: false, error: INN_LEGAL_ENTITY_CHECKSUM_ERROR };
  }

  // 12 digits (ИП)
  const coeff11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const sum11 = coeff11.reduce((sum, coeff, idx) => sum + coeff * digits[idx], 0);
  const control11 = (sum11 % 11) % 10;

  const coeff12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const sum12 = coeff12.reduce((sum, coeff, idx) => sum + coeff * digits[idx], 0);
  const control12 = (sum12 % 11) % 10;

  if (control11 === digits[10] && control12 === digits[11]) {
    return { valid: true, entityType: "individual_entrepreneur" };
  }
  return { valid: false, error: INN_IP_CHECKSUM_ERROR };
}

/**
 * Validates KPP (optional; applies only to legal entities; 9 digits if non-empty).
 */
export function validateLegalEntityKpp(kpp: string): { valid: boolean; error?: string } {
  const cleaned = kpp.trim();
  if (!cleaned) return { valid: true };
  if (!/^\d{9}$/.test(cleaned)) {
    return { valid: false, error: KPP_FORMAT_ERROR };
  }
  return { valid: true };
}

/**
 * Validates Russian BIK (9 digits, starts with "04").
 */
export function validateLegalEntityBik(bik: string): { valid: boolean; error?: string } {
  const cleaned = bik.trim();
  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, error: BIK_NON_DIGITS_ERROR };
  }
  if (cleaned.length !== 9) {
    return { valid: false, error: BIK_LENGTH_ERROR };
  }
  if (!cleaned.startsWith("04")) {
    return { valid: false, error: BIK_PREFIX_ERROR };
  }
  return { valid: true };
}

/**
 * Validates 20-digit settlement account with weighted checksum against BIK
 * according to Central Bank of Russia rules (chatbot validators.validate_account parity).
 */
export function validateLegalEntityAccount(
  account: string,
  bik: string
): { valid: boolean; error?: string } {
  const cleanedAccount = account.trim();
  if (!/^\d+$/.test(cleanedAccount)) {
    return { valid: false, error: ACCOUNT_NON_DIGITS_ERROR };
  }
  if (cleanedAccount.length !== 20) {
    return { valid: false, error: ACCOUNT_LENGTH_ERROR };
  }

  const bikCheck = validateLegalEntityBik(bik);
  if (!bikCheck.valid) {
    return { valid: false, error: ACCOUNT_BIK_INVALID_ERROR };
  }

  const checkString = bik.trim().slice(-3) + cleanedAccount;
  const weights = [
    7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1,
  ];
  const checksum = weights.reduce(
    (sum, weight, idx) => sum + parseInt(checkString[idx], 10) * weight,
    0
  );

  if (checksum % 10 === 0) {
    return { valid: true };
  }
  return { valid: false, error: ACCOUNT_CHECKSUM_ERROR };
}

/** Validates document email (same regex as native, trim, case preserved). */
export function validateLegalEntityDocEmail(email: string): { valid: boolean; error?: string } {
  const trimmed = email.trim();
  if (!trimmed || !/^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(trimmed)) {
    return { valid: false, error: DOC_EMAIL_ERROR };
  }
  return { valid: true };
}

export const EDO_OPTIONS: readonly { value: EdoType; label: string }[] = [
  { value: "Диадок", label: "Диадок (Контур)" },
  { value: "СБИС", label: "СБИС (Тензор)" },
  { value: "Email_Scan", label: "Скан по Email (без ЭДО)" },
];

export function validateLegalEntityEdoType(edoType: string): edoType is EdoType {
  return edoType === "Диадок" || edoType === "СБИС" || edoType === "Email_Scan";
}

/** Validates contact person (free text string: name and phone). */
export function validateLegalEntityContactPerson(
  contactPerson: string
): { valid: boolean; error?: string } {
  const trimmed = contactPerson.trim();
  if (!trimmed) {
    return { valid: false, error: CONTACT_PERSON_ERROR };
  }
  return { valid: true };
}

export interface LegalEntityFormValidation {
  valid: boolean;
  entityType: LegalEntityType | null;
  step1Valid: boolean;
  step2Valid: boolean;
  step3Valid: boolean;
  step4Valid: boolean;
  errors: Partial<Record<LegalEntityFormField, string>>;
  normalized: {
    inn: string;
    entity_type: LegalEntityType;
    company_name: string;
    kpp?: string;
    company_address?: string;
    bik: string;
    account: string;
    doc_email: string;
    edo_type: EdoType;
    contact_person: string;
  } | null;
}

export function validateLegalEntityForm(
  values: LegalEntityFormValues
): LegalEntityFormValidation {
  const errors: Partial<Record<LegalEntityFormField, string>> = {};

  // Step 1: Organization
  const innRes = validateLegalEntityInn(values.inn);
  if (!innRes.valid) {
    errors.inn = innRes.error;
  }
  const entityType = innRes.entityType || null;

  const trimmedName = values.company_name.trim();
  if (!trimmedName) {
    errors.company_name = COMPANY_NAME_ERROR;
  }

  let kppValid = true;
  if (entityType === "legal_entity") {
    const kppRes = validateLegalEntityKpp(values.kpp);
    if (!kppRes.valid) {
      errors.kpp = kppRes.error;
      kppValid = false;
    }
  }

  const step1Valid = Boolean(innRes.valid && trimmedName && kppValid);

  // Step 2: Bank details
  const bikRes = validateLegalEntityBik(values.bik);
  if (!bikRes.valid) {
    errors.bik = bikRes.error;
  }

  const accountRes = validateLegalEntityAccount(values.account, values.bik);
  if (!accountRes.valid) {
    errors.account = accountRes.error;
  }

  const step2Valid = Boolean(bikRes.valid && accountRes.valid);

  // Step 3: Documents
  const emailRes = validateLegalEntityDocEmail(values.doc_email);
  if (!emailRes.valid) {
    errors.doc_email = emailRes.error;
  }

  const edoValid = validateLegalEntityEdoType(values.edo_type);
  if (!edoValid) {
    errors.edo_type = EDO_TYPE_ERROR;
  }

  const step3Valid = Boolean(emailRes.valid && edoValid);

  // Step 4: Contact person
  const contactRes = validateLegalEntityContactPerson(values.contact_person);
  if (!contactRes.valid) {
    errors.contact_person = contactRes.error;
  }

  const step4Valid = Boolean(contactRes.valid);

  const allValid = step1Valid && step2Valid && step3Valid && step4Valid;

  const normalized =
    allValid && entityType
      ? {
          inn: values.inn.trim(),
          entity_type: entityType,
          company_name: trimmedName,
          kpp:
            entityType === "legal_entity" && values.kpp.trim()
              ? values.kpp.trim()
              : undefined,
          company_address: values.company_address.trim() || undefined,
          bik: values.bik.trim(),
          account: values.account.trim(),
          doc_email: values.doc_email.trim(),
          edo_type: values.edo_type as EdoType,
          contact_person: values.contact_person.trim(),
        }
      : null;

  return {
    valid: allValid,
    entityType,
    step1Valid,
    step2Valid,
    step3Valid,
    step4Valid,
    errors,
    normalized,
  };
}

export interface LegalEntityEnrollmentDraft {
  course_id: string;
  cohort_id: string;
  pricing_option_id: string;
  payer_type: "legal_entity";
  entity_type: LegalEntityType;
  inn: string;
  company_name: string;
  kpp?: string;
  company_address?: string;
  bik: string;
  account: string;
  doc_email: string;
  edo_type: EdoType;
  contact_person: string;
}

export function buildLegalEntityEnrollmentDraft(input: {
  course: Course | null;
  cohort: Cohort | null;
  pricingOption: PricingOption | null;
  values: LegalEntityFormValues;
}): LegalEntityEnrollmentDraft | null {
  if (!input.course || !input.cohort || !input.pricingOption) return null;
  const { normalized } = validateLegalEntityForm(input.values);
  if (!normalized) return null;
  return {
    course_id: input.course.id,
    cohort_id: input.cohort.id,
    pricing_option_id: input.pricingOption.id,
    payer_type: "legal_entity",
    entity_type: normalized.entity_type,
    inn: normalized.inn,
    company_name: normalized.company_name,
    kpp: normalized.kpp,
    company_address: normalized.company_address,
    bik: normalized.bik,
    account: normalized.account,
    doc_email: normalized.doc_email,
    edo_type: normalized.edo_type,
    contact_person: normalized.contact_person,
  };
}
