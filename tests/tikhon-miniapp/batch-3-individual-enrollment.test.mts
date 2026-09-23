import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  EMPTY_INDIVIDUAL_FORM,
  INDIVIDUAL_FULL_NAME_ERROR,
  INDIVIDUAL_EMAIL_ERROR,
  INDIVIDUAL_PHONE_ERROR,
  validateIndividualFullName,
  normalizeIndividualPhone,
  validateIndividualEmail,
  validateIndividualForm,
  buildIndividualEnrollmentDraft,
  getNextStageLabel,
  Course,
  Cohort,
  PricingOption,
} from "../../src/app/tikhon-miniapp-pilot/helpers.ts";

// All personal values below are synthetic test fixtures (no real people).
const SYNTH_NAME = "Тестова Анна";
const SYNTH_EMAIL = "synthetic.user@example.com";
const SYNTH_PHONE_RAW = "+7 (900) 000-00-01";
const SYNTH_PHONE = "+79000000001";

describe("Tikhon Mini App Batch 3 — Individual Enrollment (UI + local validation only)", () => {
  const pageSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/page.tsx"),
    "utf-8",
  );
  const helpersSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/helpers.ts"),
    "utf-8",
  );

  const legalStubStart = pageSource.indexOf("LOCAL-ONLY NEXT-STAGE STUB");
  const formStart = pageSource.indexOf('screen === "individual_form" ? (');
  const confirmStart = pageSource.indexOf('screen === "individual_confirmation" ? (');
  const indStubStart = pageSource.indexOf("INDIVIDUAL LOCAL NEXT-STAGE STUB");
  const modalsStart = pageSource.indexOf("Bounded Telegram-auth-required state");
  assert.ok(
    legalStubStart > 0 &&
      formStart > legalStubStart &&
      confirmStart > formStart &&
      indStubStart > confirmStart &&
      modalsStart > indStubStart,
    "page.tsx must contain legal stub, form, confirmation and individual stub branches in order",
  );
  const legalStubRegion = pageSource.slice(legalStubStart, formStart);
  const formRegion = pageSource.slice(formStart, confirmStart);
  const confirmRegion = pageSource.slice(confirmStart, indStubStart);
  const indStubRegion = pageSource.slice(indStubStart, modalsStart);
  const batch3Region = pageSource.slice(formStart, modalsStart);
  const batch3Helpers = helpersSource.slice(helpersSource.indexOf("Batch 3: Individual enrollment"));

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
    return { id: "single_payment", title: "Synthetic Option", price: 1, description: "Test" };
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

  /* ---------------- FIELDS ---------------- */

  test("A: exact field set is full_name / phone / email only", () => {
    assert.deepStrictEqual(Object.keys(EMPTY_INDIVIDUAL_FORM), ["full_name", "phone", "email"]);
    const inputs = formRegion.match(/<input\b/g) || [];
    assert.strictEqual(inputs.length, 3, "Screen 4 must render exactly three inputs");
    for (const id of ["individual-full-name", "individual-phone", "individual-email"]) {
      assert.ok(formRegion.includes(`id="${id}"`), `missing input ${id}`);
    }
    assert.ok(formRegion.includes("Данные участника"));
    assert.ok(formRegion.includes("Фамилия и имя"));
    assert.ok(formRegion.includes("(необязательно)"), "phone label must state optionality");
    assert.ok(!/Отчеств/i.test(formRegion), "patronymic must not be required");
    assert.ok(formRegion.includes('type="tel"') && formRegion.includes('type="email"'));
  });

  test("B: full-name native parity (>= 2 whitespace-separated parts, trimmed)", () => {
    assert.strictEqual(validateIndividualFullName("Анна"), null);
    assert.strictEqual(validateIndividualFullName(""), null);
    assert.strictEqual(validateIndividualFullName("   "), null);
    assert.strictEqual(validateIndividualFullName("Анна Тестова"), "Анна Тестова");
    assert.strictEqual(validateIndividualFullName("  Анна Тестова  "), "Анна Тестова");
    assert.strictEqual(validateIndividualFullName("Тестова Анна Сергеевна"), "Тестова Анна Сергеевна");
    // Native rule has no charset restriction: Latin and digits are accepted
    assert.strictEqual(validateIndividualFullName("Anna Test"), "Anna Test");
    assert.strictEqual(validateIndividualFullName("Anna 2"), "Anna 2");
    assert.strictEqual(
      INDIVIDUAL_FULL_NAME_ERROR,
      "Пожалуйста, укажите как минимум Имя и Фамилию через пробел.",
    );
  });

  /* ---------------- PHONE (Russia +7 only, optional) ---------------- */

  test("C: accepted Russian phone vectors", () => {
    assert.strictEqual(normalizeIndividualPhone("+79000000001"), SYNTH_PHONE);
    assert.strictEqual(normalizeIndividualPhone("89000000001"), SYNTH_PHONE);
    assert.strictEqual(normalizeIndividualPhone("79000000001"), SYNTH_PHONE);
    assert.strictEqual(normalizeIndividualPhone("9000000001"), SYNTH_PHONE);
    assert.strictEqual(normalizeIndividualPhone(SYNTH_PHONE_RAW), SYNTH_PHONE);
    assert.strictEqual(normalizeIndividualPhone("8 900 000 00 01"), SYNTH_PHONE);
  });

  test("D: rejected phone vectors (international, too short, too long, invalid prefix)", () => {
    const rejected = [
      "+595981000000", // Paraguay
      "+14155550100", // US
      "+4930000000", // DE
      "+380500000000", // UA
      "12345",
      "900000000", // 9 digits
      "+790000000012", // too long
      "890000000012",
      "6900000000", // invalid prefix
      "59000000001",
      "+7900+000001", // stray "+"
      "abc",
    ];
    for (const v of rejected) {
      assert.strictEqual(normalizeIndividualPhone(v), null, `must reject ${v}`);
    }
  });

  test("E: phone normalization always yields +7XXXXXXXXXX", () => {
    for (const v of ["+7 900 000-00-01", "8(900)000-00-01", "7 900 0000001", "900.000.00.01"]) {
      const out = normalizeIndividualPhone(v);
      assert.ok(out && /^\+7\d{10}$/.test(out), `${v} -> ${out}`);
    }
  });

  test("G: no international-phone expansion", () => {
    assert.ok(!/E\.164/.test(batch3Helpers), "must not claim generic E.164 support");
    assert.ok(/Russia \+7 only/.test(batch3Helpers), "policy must be documented at the helper");
    assert.ok(!/libphonenumber|country ?code/i.test(batch3Helpers + batch3Region));
    assert.ok(INDIVIDUAL_PHONE_ERROR.includes("+7"));
  });

  test("Amendment: phone optional — empty phone valid, never fabricated", () => {
    for (const phone of ["", "   "]) {
      const r = validateIndividualForm({ full_name: SYNTH_NAME, phone, email: SYNTH_EMAIL });
      assert.strictEqual(r.valid, true, `phone ${JSON.stringify(phone)} must be accepted as empty`);
      assert.strictEqual(r.normalized?.phone, null, "empty phone must stay null");
      assert.strictEqual(r.errors.phone, undefined);
    }
    const withPhone = validateIndividualForm({
      full_name: SYNTH_NAME,
      phone: SYNTH_PHONE_RAW,
      email: SYNTH_EMAIL,
    });
    assert.strictEqual(withPhone.valid, true);
    assert.strictEqual(withPhone.normalized?.phone, SYNTH_PHONE);
    const badPhone = validateIndividualForm({
      full_name: SYNTH_NAME,
      phone: "+14155550100",
      email: SYNTH_EMAIL,
    });
    assert.strictEqual(badPhone.valid, false, "non-empty invalid phone blocks the form");
    assert.strictEqual(badPhone.errors.phone, INDIVIDUAL_PHONE_ERROR);
    assert.strictEqual(badPhone.normalized, null);
  });

  /* ---------------- EMAIL ---------------- */

  test("F: email native-regex parity (trim, case preserved)", () => {
    const accepted = [
      "user@example.com",
      "User.Name+tag@Example.RU",
      "a_b-c@sub-domain.example.co",
      "x@y.z",
      "  synthetic.user@example.com  ",
    ];
    for (const v of accepted) {
      assert.strictEqual(validateIndividualEmail(v), v.trim(), `must accept ${v}`);
    }
    const rejected = [
      "",
      "plain",
      "@example.com",
      "user@",
      "user@example",
      "user@@example.com",
      "user name@example.com",
      "пользователь@example.com",
      "user@exa_mple.com",
    ];
    for (const v of rejected) {
      assert.strictEqual(validateIndividualEmail(v), null, `must reject ${v}`);
    }
    assert.ok(INDIVIDUAL_EMAIL_ERROR.length > 0);
  });

  test("Amendment: email remains required", () => {
    const noEmail = validateIndividualForm({ full_name: SYNTH_NAME, phone: SYNTH_PHONE, email: "" });
    assert.strictEqual(noEmail.valid, false);
    assert.strictEqual(noEmail.errors.email, INDIVIDUAL_EMAIL_ERROR);
    const badEmail = validateIndividualForm({ full_name: SYNTH_NAME, phone: "", email: "bad" });
    assert.strictEqual(badEmail.valid, false);
  });

  /* ---------------- TRANSITIONS ---------------- */

  test("H: form -> confirmation requires all fields valid", () => {
    assert.strictEqual(validateIndividualForm(EMPTY_INDIVIDUAL_FORM).valid, false);
    assert.strictEqual(
      validateIndividualForm({ full_name: "Анна", phone: "", email: SYNTH_EMAIL }).valid,
      false,
    );
    const continueStart = pageSource.indexOf("const handleIndividualFormContinue = () => {");
    const continueBody = pageSource.slice(continueStart, pageSource.indexOf("\n  };", continueStart));
    const guardIdx = continueBody.indexOf("if (!individualValidation.valid || !individualDraft) {");
    const advanceIdx = continueBody.indexOf('setScreen("individual_confirmation")');
    assert.ok(continueStart > 0 && guardIdx > 0 && advanceIdx > guardIdx);
    assert.ok(continueBody.slice(guardIdx, advanceIdx).includes("return;"));
    assert.ok(formRegion.includes("onClick={handleIndividualFormContinue}"));
    // Errors only after interaction (blur) or a Continue attempt
    assert.ok(pageSource.includes("individualTouched[field] || individualContinueAttempted"));
  });

  test("I: confirmation displays normalized phone and works without phone", () => {
    const base = { course: makeCourse(), cohort: makeCohort(), pricingOption: makeOption() };
    const withPhone = buildIndividualEnrollmentDraft({
      ...base,
      values: { full_name: ` ${SYNTH_NAME} `, phone: SYNTH_PHONE_RAW, email: ` ${SYNTH_EMAIL} ` },
    });
    assert.deepStrictEqual(withPhone, {
      course_id: "maslow",
      cohort_id: "cohort_1",
      pricing_option_id: "single_payment",
      payer_type: "individual",
      full_name: SYNTH_NAME,
      phone: SYNTH_PHONE,
      email: SYNTH_EMAIL,
    });
    const noPhone = buildIndividualEnrollmentDraft({
      ...base,
      values: { full_name: SYNTH_NAME, phone: "", email: SYNTH_EMAIL },
    });
    assert.strictEqual(noPhone?.phone, null);
    assert.strictEqual(
      buildIndividualEnrollmentDraft({ ...base, course: null, values: EMPTY_INDIVIDUAL_FORM }),
      null,
    );
    // Rendering: phone row only when provided; values come from the normalized draft
    assert.ok(confirmRegion.includes("{individualDraft.phone && ("));
    assert.ok(confirmRegion.includes("{individualDraft.phone}"));
    assert.ok(!confirmRegion.includes("individualForm.phone"), "raw phone input must not be displayed");
    assert.ok(confirmRegion.includes("{individualDraft.full_name}"));
    assert.ok(confirmRegion.includes("{individualDraft.email}"));
    assert.ok(confirmRegion.includes("Проверьте данные"));
    // Commercial values from source objects only
    for (const bound of [
      "selectedCourse.title",
      "selectedPricingOption.title",
      "selectedCohort.title",
      "selectedCohort.schedule",
      "selectedPricingOption.price",
      "selectedPayerOption?.title",
    ]) {
      assert.ok(confirmRegion.includes(bound), `confirmation must bind ${bound}`);
    }
    for (const pat of [/\b\d{2,3}\s?000\s?₽/, /\b45\s?000\b/, /\b160\s?000\b/]) {
      assert.ok(!pat.test(batch3Region), `hardcoded price ${pat} in Batch-3 region`);
    }
  });

  test("J: confirmation contains the canonical Offer link (informational, §7)", () => {
    assert.ok(confirmRegion.includes('href="/offer"'));
    assert.ok(confirmRegion.includes("window.Telegram.WebApp.openLink("));
    assert.ok(confirmRegion.includes("`${window.location.origin}/offer`"));
    assert.ok(confirmRegion.includes("разделом 7"));
    assert.ok(confirmRegion.includes("после отправки заявки на следующем этапе"));
  });

  test("K: no consent checkbox or consent acceptance action", () => {
    assert.ok(!/type="checkbox"/.test(batch3Region));
    for (const phrase of [
      "Согласен",
      "Согласна",
      "Я согласен",
      "Я принимаю",
      "Подтвердить согласие",
      "Подать заявку",
      "Отправить заявку",
      "Оплатить",
      "Получить реквизиты",
    ]) {
      assert.ok(!batch3Region.includes(phrase), `forbidden acceptance/submit copy: ${phrase}`);
    }
  });

  /* ---------------- NETWORK / PRIVACY ---------------- */

  test("L: no new fetch call introduced by Batch 3", () => {
    assert.strictEqual((pageSource.match(/\bfetch\(/g) || []).length, 2);
    assert.strictEqual((batch3Region.match(/\bfetch\(/g) || []).length, 0);
    assert.ok(!/\bfetch\(/.test(helpersSource));
  });

  test("M: no POST / PUT / PATCH / DELETE or other transport", () => {
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(pageSource));
    for (const api of ["XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "sendData("]) {
      assert.ok(!pageSource.includes(api), `page.tsx must not use ${api}`);
    }
    assert.ok(!batch3Region.includes("requestContact"), "WebApp.requestContact is forbidden");
  });

  test("N / R: no localStorage / sessionStorage / draft persistence", () => {
    for (const store of ["localStorage", "sessionStorage", "indexedDB", "document.cookie", "CloudStorage"]) {
      assert.ok(!pageSource.includes(store), `page.tsx must not use ${store}`);
      assert.ok(!helpersSource.includes(store), `helpers.ts must not use ${store}`);
    }
    // Initial state is always empty — refresh / new session loses values
    assert.ok(pageSource.includes("useState<IndividualFormValues>(EMPTY_INDIVIDUAL_FORM)"));
  });

  test("O: no PII in URL / query / hash construction", () => {
    assert.ok(!/<form\b/.test(batch3Region), "no <form> element (no implicit GET submission)");
    assert.ok(!/\sname="/.test(formRegion), "inputs must not carry name attributes");
    for (const sink of [
      "URLSearchParams",
      "location.hash",
      "location.search",
      "history.pushState",
      "history.replaceState",
      "encodeURIComponent",
      "console.",
    ]) {
      assert.ok(!batch3Region.includes(sink), `Batch-3 region must not use ${sink}`);
    }
    assert.ok(!batch3Helpers.includes("console."));
    // openLink only targets the static Offer route
    const openLinks = batch3Region.match(/openLink\(\s*[^)]*\)/g) || [];
    assert.ok(openLinks.length > 0);
    for (const call of openLinks) {
      assert.ok(call.includes("/offer"), `unexpected openLink target: ${call}`);
    }
  });

  test("P: no Application / payment / invoice side effect", () => {
    for (const token of [
      "application_id",
      "createApplication",
      "invoice",
      "СБП",
      "реквизиты",
      "Заявка создана",
      "Заявка отправлена",
      "заявка создана",
      "заявка отправлена",
    ]) {
      assert.ok(!batch3Region.includes(token), `Batch-3 region must not contain ${token}`);
    }
  });

  /* ---------------- NAVIGATION ---------------- */

  test("Q: Back routes preserve in-memory values", () => {
    for (const route of [
      'screen === "individual_form") setScreen("payer")',
      'screen === "individual_confirmation") setScreen("individual_form")',
      'screen === "individual_next_stage") setScreen("individual_confirmation")',
    ]) {
      assert.ok(pageSource.includes(route), `Telegram BackButton route missing: ${route}`);
    }
    assert.ok(formRegion.includes('onClick={() => setScreen("payer")}'));
    assert.ok(confirmRegion.includes('onClick={() => setScreen("individual_form")}'));
    assert.ok(indStubRegion.includes('onClick={() => setScreen("individual_confirmation")}'));
    // Values are never reset by navigation: only per-field edits and blur-trim write them
    const writes = pageSource.match(/setIndividualForm\(/g) || [];
    assert.strictEqual(writes.length, 2, "only updateIndividualField and blur-trim write the form");
    assert.ok(!pageSource.includes("setIndividualForm(EMPTY_INDIVIDUAL_FORM)"));
  });

  test("S: legal_entity path remains on the Batch-2 local stub without individual PII", () => {
    assert.ok(
      pageSource.includes(
        'if (selectedPayerType === "individual") setScreen("individual_form");\n                  else if (selectedPayerType) setScreen("next_stage_stub");',
      ),
    );
    assert.strictEqual(getNextStageLabel("legal_entity"), "Реквизиты ИП или организации");
    assert.ok(legalStubRegion.includes("getNextStageLabel(selectedPayerOption.value)"));
    assert.ok(legalStubRegion.includes('setScreen("payer")'));
    for (const pii of ["individualForm", "individualDraft", "full_name", "email"]) {
      assert.ok(!legalStubRegion.includes(pii), `legal stub must not reference ${pii}`);
    }
  });

  test("T: Batch-2 auth / error behavior preserved; no new status request", () => {
    assert.strictEqual((pageSource.match(/fetch\("\/api\/tikhon\/student-status"/g) || []).length, 1);
    assert.ok(pageSource.includes("if (res.status === 401) {"));
    assert.ok(pageSource.includes('if (hasTelegramInitData && studentStatusCheck === "unavailable") {'));
    assert.ok(pageSource.includes("const isAuthenticated = studentStatus?.is_authenticated === true;"));
    assert.ok(!batch3Region.includes("loadStudentStatus"));
    assert.ok(!batch3Region.includes("initData"));
  });

  test("U: individual next-stage stub does not claim submission success", () => {
    assert.ok(indStubRegion.includes("Оформление заявки"));
    assert.ok(indStubRegion.includes("станет доступен на следующем этапе"));
    for (const claim of ["успешно", "создана", "отправлена", "принята", "Спасибо", "#"]) {
      assert.ok(!indStubRegion.includes(claim), `stub must not claim success: ${claim}`);
    }
  });
});
