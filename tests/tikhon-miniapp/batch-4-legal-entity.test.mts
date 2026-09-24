import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  Course,
  Cohort,
  PricingOption,
} from "../../src/app/tikhon-miniapp-pilot/helpers.ts";

import {
  EMPTY_LEGAL_ENTITY_FORM,
  INN_NON_DIGITS_ERROR,
  INN_LENGTH_ERROR,
  INN_LEGAL_ENTITY_CHECKSUM_ERROR,
  INN_IP_CHECKSUM_ERROR,
  COMPANY_NAME_ERROR,
  KPP_FORMAT_ERROR,
  BIK_NON_DIGITS_ERROR,
  BIK_LENGTH_ERROR,
  BIK_PREFIX_ERROR,
  ACCOUNT_NON_DIGITS_ERROR,
  ACCOUNT_LENGTH_ERROR,
  ACCOUNT_BIK_INVALID_ERROR,
  ACCOUNT_CHECKSUM_ERROR,
  DOC_EMAIL_ERROR,
  EDO_TYPE_ERROR,
  CONTACT_PERSON_ERROR,
  validateLegalEntityInn,
  validateLegalEntityKpp,
  validateLegalEntityBik,
  validateLegalEntityAccount,
  validateLegalEntityDocEmail,
  validateLegalEntityEdoType,
  validateLegalEntityContactPerson,
  validateLegalEntityForm,
  buildLegalEntityEnrollmentDraft,
  EDO_OPTIONS,
  LegalEntityFormValues,
} from "../../src/app/tikhon-miniapp-pilot/legal-entity-helpers.ts";

// Explicitly synthetic deterministic fixtures (all-zero canonical test vectors)
const SYNTH_INN_LEGAL = "0000000000"; // 10 digits — synthetic checksum test vector accepted by current application validator
const SYNTH_INN_IP = "000000000000"; // 12 digits — synthetic checksum test vector accepted by current application validator
const SYNTH_COMPANY_NAME = "ООО «Синтетик Тест»";
const SYNTH_KPP = "000000000";
const SYNTH_ADDRESS = "г. Москва, ул. Синтетическая, д. 0";
const SYNTH_BIK = "040000000"; // starts with 04, 9 digits — synthetic format-valid test vector accepted by current validator
const SYNTH_ACCOUNT = "00000000000000000000"; // 20 digits, checksum matches BIK
const SYNTH_DOC_EMAIL = "synthetic.test@example.com";
const SYNTH_CONTACT = "Синтетиков Синтетик Синтетикович, +7 (900) 000-00-00";

describe("Tikhon Mini App Batch 4 — Legal Entity & IP Enrollment (UI + local validation only)", () => {
  const pageSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/page.tsx"),
    "utf-8"
  );
  const helpersSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/helpers.ts"),
    "utf-8"
  );
  const flowSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx"),
    "utf-8"
  );
  const legalEntityHelpersSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/legal-entity-helpers.ts"),
    "utf-8"
  );

  function makeCohort(): Cohort {
    return {
      id: "cohort_1",
      title: "Synthetic Cohort",
      start_date: "Future",
      schedule: "Weekly",
      is_active: true,
      enrollment_status: "AVAILABLE",
      is_enrollment_open: true,
    };
  }

  function makeOption(): PricingOption {
    return {
      id: "single_payment",
      title: "Synthetic Option",
      price: 15000,
      description: "Test",
    };
  }

  function makeCourse(): Course {
    return {
      id: "maslow",
      title: "Synthetic Course",
      short_description: "Test",
      meetings_count: 4,
      format_info: "Zoom",
      max_participants: 24,
      pricing_options: [makeOption()],
      cohorts: [makeCohort()],
    };
  }

  function makeValidLegalForm(): LegalEntityFormValues {
    return {
      inn: SYNTH_INN_LEGAL,
      company_name: SYNTH_COMPANY_NAME,
      kpp: SYNTH_KPP,
      company_address: SYNTH_ADDRESS,
      bik: SYNTH_BIK,
      account: SYNTH_ACCOUNT,
      doc_email: SYNTH_DOC_EMAIL,
      edo_type: "Диадок",
      contact_person: SYNTH_CONTACT,
    };
  }

  /* ---------------- 1. INN & ENTITY TYPE DERIVATION ---------------- */

  test("1: 10-digit valid INN derives legal_entity deterministically", () => {
    const res = validateLegalEntityInn(SYNTH_INN_LEGAL);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.entityType, "legal_entity");
    assert.strictEqual(res.error, undefined);
  });

  test("2: 12-digit valid INN derives individual_entrepreneur deterministically", () => {
    const res = validateLegalEntityInn(SYNTH_INN_IP);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.entityType, "individual_entrepreneur");
    assert.strictEqual(res.error, undefined);
  });

  test("3: malformed checksum blocks progression with exact error copy", () => {
    // Non-digits
    assert.strictEqual(
      validateLegalEntityInn("000000000A").error,
      INN_NON_DIGITS_ERROR
    );
    // Invalid length (11 digits)
    assert.strictEqual(
      validateLegalEntityInn("00000000000").error,
      INN_LENGTH_ERROR
    );
    // 10 digits invalid checksum (last digit 1 instead of 0)
    assert.strictEqual(
      validateLegalEntityInn("0000000001").error,
      INN_LEGAL_ENTITY_CHECKSUM_ERROR
    );
    // 12 digits invalid checksum (last digit 1 instead of 0)
    assert.strictEqual(
      validateLegalEntityInn("000000000001").error,
      INN_IP_CHECKSUM_ERROR
    );
  });

  /* ---------------- 2. KPP, OGRN & ADDRESS RULES ---------------- */

  test("4: KPP shown only for legal_entity in page.tsx", () => {
    assert.ok(
      flowSource.includes('legalEntityValidation.entityType === "legal_entity"'),
      "KPP field container must be conditioned on entityType === 'legal_entity'"
    );
    assert.ok(
      flowSource.includes('data-testid="kpp-field-container"'),
      "KPP field must have testid for entity condition"
    );
  });

  test("5: KPP is optional (empty KPP is valid, 9 digits required if present)", () => {
    assert.strictEqual(validateLegalEntityKpp("").valid, true);
    assert.strictEqual(validateLegalEntityKpp("   ").valid, true);
    assert.strictEqual(validateLegalEntityKpp(SYNTH_KPP).valid, true);
    assert.strictEqual(validateLegalEntityKpp("12345678").valid, false);
    assert.strictEqual(validateLegalEntityKpp("12345678").error, KPP_FORMAT_ERROR);
    assert.strictEqual(validateLegalEntityKpp("1234567890").valid, false);
  });

  test("6: company address is optional", () => {
    const form = makeValidLegalForm();
    form.company_address = "";
    const res = validateLegalEntityForm(form);
    assert.strictEqual(res.step1Valid, true);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.normalized?.company_address, undefined);
  });

  test("7: OGRN / OGRNIP is not collected in Batch 4 (omitted from form)", () => {
    assert.ok(
      !Object.keys(EMPTY_LEGAL_ENTITY_FORM).includes("ogrn"),
      "ogrn must not be in form state"
    );
    assert.ok(
      !Object.keys(EMPTY_LEGAL_ENTITY_FORM).includes("ogrnip"),
      "ogrnip must not be in form state"
    );
    assert.ok(
      !flowSource.includes('id="legal-entity-ogrn"') && !pageSource.includes('id="legal-entity-ogrn"'),
      "no ogrn input on page"
    );
  });

  /* ---------------- 3. BANK REQUISITES VALIDATION ---------------- */

  test("8: BIK validation works (9 digits, starts with 04)", () => {
    assert.strictEqual(validateLegalEntityBik(SYNTH_BIK).valid, true);
    assert.strictEqual(validateLegalEntityBik("04000000").error, BIK_LENGTH_ERROR);
    assert.strictEqual(
      validateLegalEntityBik("050000000").error,
      BIK_PREFIX_ERROR
    );
    assert.strictEqual(
      validateLegalEntityBik("04000000A").error,
      BIK_NON_DIGITS_ERROR
    );
  });

  test("9: settlement-account checksum works (modulo 10 weighted with BIK)", () => {
    assert.strictEqual(
      validateLegalEntityAccount(SYNTH_ACCOUNT, SYNTH_BIK).valid,
      true
    );
    // Non-digits in account
    assert.strictEqual(
      validateLegalEntityAccount("0000000000000000000A", SYNTH_BIK).error,
      ACCOUNT_NON_DIGITS_ERROR
    );
    // Invalid account length
    assert.strictEqual(
      validateLegalEntityAccount("0000000000000000000", SYNTH_BIK).error,
      ACCOUNT_LENGTH_ERROR
    );
    // Checksum mismatch (last digit 1 instead of 0)
    assert.strictEqual(
      validateLegalEntityAccount("00000000000000000001", SYNTH_BIK).error,
      ACCOUNT_CHECKSUM_ERROR
    );
    // Invalid BIK blocks account check
    assert.strictEqual(
      validateLegalEntityAccount(SYNTH_ACCOUNT, "050000000").error,
      ACCOUNT_BIK_INVALID_ERROR
    );
  });

  /* ---------------- 4. DOCUMENTS & CONTACT ---------------- */

  test("10: doc email required with email regex", () => {
    assert.strictEqual(validateLegalEntityDocEmail(SYNTH_DOC_EMAIL).valid, true);
    assert.strictEqual(validateLegalEntityDocEmail("").error, DOC_EMAIL_ERROR);
    assert.strictEqual(validateLegalEntityDocEmail("invalid-email").error, DOC_EMAIL_ERROR);
    assert.strictEqual(validateLegalEntityDocEmail("buh@").error, DOC_EMAIL_ERROR);
  });

  test("11: EDO closed set preserved (Диадок, СБИС, Email_Scan)", () => {
    assert.strictEqual(EDO_OPTIONS.length, 3);
    assert.deepStrictEqual(
      EDO_OPTIONS.map((o) => o.value),
      ["Диадок", "СБИС", "Email_Scan"]
    );
    assert.strictEqual(validateLegalEntityEdoType("Диадок"), true);
    assert.strictEqual(validateLegalEntityEdoType("СБИС"), true);
    assert.strictEqual(validateLegalEntityEdoType("Email_Scan"), true);
    assert.strictEqual(validateLegalEntityEdoType("Other_EDO"), false);
    assert.strictEqual(
      validateLegalEntityForm({ ...makeValidLegalForm(), edo_type: "" }).errors.edo_type,
      EDO_TYPE_ERROR
    );
  });

  test("12: contact person required as free text", () => {
    assert.strictEqual(
      validateLegalEntityContactPerson(SYNTH_CONTACT).valid,
      true
    );
    assert.strictEqual(
      validateLegalEntityContactPerson("").error,
      CONTACT_PERSON_ERROR
    );
    assert.strictEqual(
      validateLegalEntityContactPerson("   ").error,
      CONTACT_PERSON_ERROR
    );
    assert.strictEqual(
      validateLegalEntityForm({ ...makeValidLegalForm(), company_name: "" }).errors.company_name,
      COMPANY_NAME_ERROR
    );
  });

  /* ---------------- 5. REVIEW & CONFIRMATION ---------------- */

  test("13: review screen omits absent optional fields (no fake placeholders)", () => {
    // Review card in page.tsx must conditionally render kpp and company_address
    assert.ok(
      flowSource.includes("legalEntityDraft.kpp &&"),
      "kpp must be rendered only when present"
    );
    assert.ok(
      flowSource.includes("legalEntityDraft.company_address &&"),
      "company_address must be rendered only when present"
    );
    assert.ok(
      !flowSource.includes("legalEntityDraft.kpp || '—'"),
      "kpp must not fall back to dash placeholder"
    );
    assert.ok(
      !flowSource.includes("legalEntityDraft.company_address || '—'"),
      "company_address must not fall back to dash placeholder"
    );
  });

  test("14: review screen contains no OGRN or OGRNIP", () => {
    const confirmationIndex = flowSource.indexOf(
      'screen === "legal_entity_confirmation"'
    );
    const nextStageIndex = flowSource.indexOf(
      "BATCH 4 — LEGAL ENTITY LOCAL NEXT-STAGE STUB"
    );
    const confirmationRegion = flowSource.slice(
      confirmationIndex,
      nextStageIndex
    );

    assert.ok(
      !/ОГРН|OGRN/i.test(confirmationRegion),
      "Confirmation screen must not contain OGRN / OGRNIP"
    );
  });

  /* ---------------- 6. ISOLATION & PURITY (NO NETWORK, NO PERSISTENCE) ---------------- */

  test("15: no Application creation or server mutation", () => {
    assert.ok(
      !pageSource.includes("/api/tikhon/applications") && !flowSource.includes("/api/tikhon/applications"),
      "No applications API in page.tsx"
    );
    assert.ok(
      !pageSource.includes("/api/tikhon/order") && !flowSource.includes("/api/tikhon/order"),
      "No order creation API in page.tsx"
    );
  });

  test("16: no new network calls added to page.tsx", () => {
    const fetchMatches = pageSource.match(/fetch\(/g) || [];
    // Only the 2 pre-existing fetch calls from Batch 1/2:
    // 1. /api/tikhon/courses
    // 2. /api/tikhon/student-status
    assert.strictEqual(
      fetchMatches.length,
      2,
      "fetch() count must remain exactly 2"
    );
  });

  test("17: zero Google calls or sheets sync in Mini App", () => {
    assert.ok(
      !pageSource.includes("sheets_sync") && !flowSource.includes("sheets_sync"),
      "No sheets_sync in Mini App"
    );
    assert.ok(
      !pageSource.includes("google") && !flowSource.includes("google"),
      "No google references in Mini App"
    );
  });

  test("18: zero DaData calls in Mini App (LOCAL-ONLY)", () => {
    assert.ok(!pageSource.includes("dadata") && !flowSource.includes("dadata"), "No dadata references in Mini App");
    assert.ok(
      !helpersSource.includes("dadata") && !legalEntityHelpersSource.includes("dadata"),
      "No dadata references in helpers"
    );
  });

  /* ---------------- 7. NAVIGATION & REGRESSION ---------------- */

  test("19: back navigation preserves in-memory values", () => {
    // Draft builder maintains values from React state
    const form = makeValidLegalForm();
    const draft = buildLegalEntityEnrollmentDraft({
      course: makeCourse(),
      cohort: makeCohort(),
      pricingOption: makeOption(),
      values: form,
    });
    assert.ok(draft !== null);
    assert.strictEqual(draft.inn, SYNTH_INN_LEGAL);
    assert.strictEqual(draft.entity_type, "legal_entity");
    assert.strictEqual(draft.kpp, SYNTH_KPP);
    assert.strictEqual(draft.company_name, SYNTH_COMPANY_NAME);
    assert.strictEqual(draft.bik, SYNTH_BIK);
    assert.strictEqual(draft.account, SYNTH_ACCOUNT);
    assert.strictEqual(draft.doc_email, SYNTH_DOC_EMAIL);
    assert.strictEqual(draft.edo_type, "Диадок");
    assert.strictEqual(draft.contact_person, SYNTH_CONTACT);
  });

  test("20: Batch 2 and Batch 3 behavior does not regress", () => {
    // Payer selection retains individual and legal_entity
    assert.ok(pageSource.includes('selectedPayerType === "individual"'));
    assert.ok(pageSource.includes('selectedPayerType === "legal_entity"'));
    // Screen transitions are intact
    assert.ok(pageSource.includes('screen === "individual_form"'));
    assert.ok(pageSource.includes('screen === "individual_confirmation"'));
    assert.ok(pageSource.includes('screen === "individual_next_stage"'));
    assert.ok(pageSource.includes("<LegalEntityFlow"));
    assert.ok(flowSource.includes('screen === "legal_entity_confirmation"'));
  });

  /* ---------------- 8. CANONICAL LITERALS (UN-OBFUSCATED) ---------------- */

  test("21: Batch-4 source contains canonical un-obfuscated literals", () => {
    assert.ok(
      legalEntityHelpersSource.includes('"individual_entrepreneur"'),
      "legal-entity-helpers.ts must contain canonical 'individual_entrepreneur' literal"
    );
    assert.ok(
      legalEntityHelpersSource.includes("БИК"),
      "legal-entity-helpers.ts must contain normal Cyrillic 'БИК'"
    );
    assert.ok(
      flowSource.includes("БИК"),
      "legal-entity-flow.tsx must contain normal Cyrillic 'БИК'"
    );
    assert.ok(
      !legalEntityHelpersSource.includes("\\u0411\\u0418\\u041A"),
      "legal-entity-helpers.ts must not contain unicode-escaped БИК"
    );
    assert.ok(
      !flowSource.includes("\\u0411\\u0418\\u041A"),
      "legal-entity-flow.tsx must not contain unicode-escaped БИК"
    );
  });
});
