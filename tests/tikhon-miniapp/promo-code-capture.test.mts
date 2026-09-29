import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  EMPTY_INDIVIDUAL_FORM,
  INDIVIDUAL_PROMO_CODE_ERROR,
  PROMO_CODE_MAX_LENGTH,
  buildIndividualEnrollmentDraft,
  normalizePromoCode,
  validateIndividualForm,
  type Course,
  type Cohort,
  type PricingOption,
} from "../../src/app/tikhon-miniapp-pilot/helpers.ts";
import { readOptionalPromoCode } from "../../src/app/api/tikhon/submit-application/route.ts";

const pageSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/tikhon-miniapp-pilot/page.tsx"),
  "utf-8",
);
const routeSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/tikhon/submit-application/route.ts"),
  "utf-8",
);

function course(): Course {
  return {
    id: "maslow",
    title: "Synthetic Course",
    short_description: "Test",
    meetings_count: 4,
    format_info: "Zoom",
    max_participants: 24,
    pricing_options: [option()],
    cohorts: [cohort()],
  };
}
function cohort(): Cohort {
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
function option(): PricingOption {
  return { id: "single_payment", title: "Synthetic Option", price: 50000, description: "Test" };
}

function draft(promo: string | undefined) {
  return buildIndividualEnrollmentDraft({
    course: course(),
    cohort: cohort(),
    pricingOption: option(),
    values: {
      full_name: "Тестова Анна",
      phone: "",
      email: "synthetic.user@example.com",
      promo_code: promo,
    },
  });
}

describe("Tikhon promo-code capture", () => {
  test("participant section shows an optional promo field", () => {
    const formStart = pageSource.indexOf('screen === "individual_form" ? (');
    const confirmStart = pageSource.indexOf('screen === "individual_confirmation" ? (');
    const formRegion = pageSource.slice(formStart, confirmStart);
    assert.ok(formRegion.includes("Данные участника"));
    assert.ok(formRegion.includes("Введите промокод на скидку:"));
    const fieldStart = formRegion.indexOf('id="individual-promo-code"');
    assert.ok(fieldStart > 0);
    const field = formRegion.slice(fieldStart, formRegion.indexOf("/>", fieldStart));
    assert.equal(field.includes("required"), false);
    assert.equal(field.includes("maxLength={16}"), true);
    assert.equal(field.includes("maxLength={128}"), false);
    assert.equal(PROMO_CODE_MAX_LENGTH, 16);
    assert.equal(routeSource.includes("forwardPayload.promo_code = promoCode"), true);
    assert.equal(routeSource.includes("readOptionalPromoCode"), true);
    assert.equal(routeSource.includes("INVALID_PROMO_CODE"), true);
    const rejectAt = routeSource.indexOf("promo.tooLong");
    const fetchAt = routeSource.indexOf("fetch(russianServerUrl");
    assert.ok(rejectAt > 0 && fetchAt > rejectAt);
  });

  test("empty and whitespace promo codes leave the order draft unchanged", () => {
    const bare = draft(undefined);
    const empty = draft("");
    const spaces = draft("   ");
    assert.ok(bare && empty && spaces);
    assert.equal("promo_code" in bare, false);
    assert.equal("promo_code" in empty, false);
    assert.equal("promo_code" in spaces, false);
    assert.deepEqual(bare, empty);
    assert.deepEqual(empty, spaces);
    assert.equal(normalizePromoCode(null), null);
    assert.equal(normalizePromoCode(" \n\t "), null);
  });

  test("a non-empty promo code is preserved without commercial fields", () => {
    const priced = option();
    const withCode = buildIndividualEnrollmentDraft({
      course: course(),
      cohort: cohort(),
      pricingOption: priced,
      values: {
        full_name: "Тестова Анна",
        phone: "",
        email: "synthetic.user@example.com",
        promo_code: "  Student-Code 25  ",
      },
    });
    const withoutCode = draft("");
    assert.equal(withCode?.promo_code, "Student-Code 25");
    assert.equal(priced.price, 50000);
    assert.equal(withoutCode && "amount" in withoutCode, false);
    assert.equal(withCode && "amount" in withCode, false);
    assert.equal(withCode && "price" in withCode, false);
    assert.deepEqual(
      { ...withoutCode, promo_code: "Student-Code 25" },
      withCode,
    );
  });

  test("hostile markup and an arbitrary code do not block the participant form", () => {
    const hostile = draft("<b>FREE</b>");
    assert.equal(hostile?.promo_code, "<b>FREE</b>");
    const arbitrary = validateIndividualForm({
      ...EMPTY_INDIVIDUAL_FORM,
      full_name: "Тестова Анна",
      email: "synthetic.user@example.com",
      promo_code: "ANYTHING-123",
    });
    assert.equal(arbitrary.valid, true);
    assert.equal(arbitrary.errors.promo_code, undefined);
    const omitted = validateIndividualForm({
      full_name: "Тестова Анна",
      phone: "",
      email: "synthetic.user@example.com",
    });
    assert.equal(omitted.valid, true);
  });

  test("sixteen characters are accepted and seventeen are rejected without truncation", () => {
    const sixteen = "1234567890ABCDEF";
    const seventeen = "1234567890ABCDEFG";
    assert.equal(sixteen.length, 16);
    assert.equal(seventeen.length, 17);
    const accepted = draft(`  ${sixteen}  `);
    assert.equal(accepted?.promo_code, sixteen);
    assert.equal(option().price, 50000);
    const form = validateIndividualForm({
      ...EMPTY_INDIVIDUAL_FORM,
      full_name: "Тестова Анна",
      email: "synthetic.user@example.com",
      promo_code: `  ${seventeen}  `,
    });
    assert.equal(form.valid, false);
    assert.equal(form.errors.promo_code, INDIVIDUAL_PROMO_CODE_ERROR);
    assert.equal(draft(seventeen), null);
    assert.equal(normalizePromoCode(seventeen), seventeen);
    const gate = readOptionalPromoCode(seventeen);
    assert.deepEqual(gate, { code: null, tooLong: true });
    assert.equal(readOptionalPromoCode(`  ${sixteen}  `).code, sixteen);
    assert.equal(readOptionalPromoCode("   ").tooLong, false);
    assert.equal(readOptionalPromoCode("   ").code, null);
  });
});
