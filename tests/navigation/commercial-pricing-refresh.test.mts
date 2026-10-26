import assert from "node:assert/strict";
import test from "node:test";
import type { AcademyCourseId } from "../../src/lib/academy/course-reference.ts";
import {
  ACADEMY_COMMERCIAL_AUTHORITY_ID,
  ACADEMY_COMMERCIAL_AUTHORITY_AS_OF,
} from "../../src/lib/academy/commercial-authority.ts";
import { ACADEMY_COMMERCIAL_AUTHORITY as SEPTEMBER_SNAPSHOT } from "../../src/lib/academy/commercial-authority-2026-09-19.ts";
import { ACADEMY_COMMERCIAL_POLICY_ADDENDUM } from "../../src/lib/academy/commercial-policy-addendum.ts";
import {
  composeCurrentMetadataAnswer,
  composePaymentIntentBoundaryAnswer,
} from "../../src/lib/navigation/conversation-response.ts";
import {
  composeCommercialConditionsAnswer,
  composeCourseOverviewWithPriceAnswer,
} from "../../src/lib/navigation/owner-service-lanes.ts";

const priceAnswer = (courseId: AcademyCourseId) => composeCurrentMetadataAnswer({
  kind: "CURRENT_METADATA", courseIds: [courseId], fields: ["PRICE"], scope: "REFERENCED",
}, null);
const rub = (value: number) => `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

test("commercial refresh: the active snapshot is dated 26 October and Normative Situation costs 60,000 RUB", () => {
  assert.equal(ACADEMY_COMMERCIAL_AUTHORITY_ID, "OWNER-COMMERCIAL-AUTHORITY-2026-10-26");
  assert.equal(ACADEMY_COMMERCIAL_AUTHORITY_AS_OF, "2026-10-26");
  for (const answer of [
    priceAnswer("normative-situation"),
    composePaymentIntentBoundaryAnswer("normative-situation"),
    composeCourseOverviewWithPriceAnswer("normative-situation", { status: "UNAVAILABLE", reason: "NETWORK" }),
  ]) {
    assert.match(answer, /26 октября 2026 года/u);
    assert.ok(answer.includes(rub(60_000)), answer);
    assert.ok(!answer.includes(rub(45_000)), answer);
    assert.ok(!answer.includes(rub(42_000)), answer);
  }
});

test("commercial refresh: every Structural Typology price surface distinguishes the base, full prepayment and three levels", () => {
  for (const answer of [
    priceAnswer("structural-typology"),
    composePaymentIntentBoundaryAnswer("structural-typology"),
    composeCourseOverviewWithPriceAnswer("structural-typology", { status: "UNAVAILABLE", reason: "NETWORK" }),
  ]) {
    for (const amount of [200_000, 160_000, 50_000, 100_000]) {
      assert.ok(answer.includes(rub(amount)), answer);
    }
    assert.match(answer, /базов/iu);
    assert.match(answer, /полной предоплат/iu);
    assert.match(answer, /20%/u);
    for (const title of ["Введение в теорию", "Основной курс", "Экспертный уровень"]) {
      assert.ok(answer.includes(title), answer);
    }
  }
});

test("commercial refresh: alumni discounts are a manual curator decision, never assigned by Tikhon", () => {
  const conditions = composeCommercialConditionsAnswer().message;
  assert.match(conditions, /20%/u);
  assert.doesNotMatch(conditions, /Её размер в подтверждённых данных Академии не указан/u);
  for (const answer of [conditions, composePaymentIntentBoundaryAnswer("normative-situation")]) {
    assert.match(answer, /вручную/u);
    assert.match(answer, /Алексей Лебедев/u);
    assert.match(answer, /Тихон.*не.*(?:назначает|предоставляет)/u);
    assert.doesNotMatch(answer, /42[\s\u00a0]*000|30%/u);
    assert.doesNotMatch(answer, /AST_payment_course_bot/u);
  }
});

test("commercial refresh: the absent sixth price remains unknown and known ordinary prices stay course-specific", () => {
  assert.match(priceAnswer("professional-development-stages"), /подтверждённой цены.*нет/u);
  assert.ok(priceAnswer("levels-of-consciousness").includes(rub(45_000)));
  for (const courseId of ["maslow", "play-and-creativity"] as const) {
    assert.ok(priceAnswer(courseId).includes(rub(60_000)));
  }
});


test("commercial refresh: the superseded snapshot remains dated September and manual discounts carry no automatic entitlement", () => {
  assert.equal(SEPTEMBER_SNAPSHOT.authorityId, "OWNER-COMMERCIAL-AUTHORITY-2026-09-19");
  assert.equal(SEPTEMBER_SNAPSHOT.asOfDate, "2026-09-19");
  assert.deepEqual(SEPTEMBER_SNAPSHOT.pricesRub["normative-situation"], { status: "SUPPORTED", value: 45_000 });
  const manual = ACADEMY_COMMERCIAL_POLICY_ADDENDUM.discretionaryAlumniDiscount;
  assert.equal(manual.approvalMode, "MANUAL");
  assert.equal(manual.tikhonAppliesAlumniDiscount, false);
  assert.equal(manual.automaticEligibilityDecision, false);
  assert.equal(manual.amount.status, "UNAVAILABLE");
  assert.deepEqual(ACADEMY_COMMERCIAL_POLICY_ADDENDUM.publicPrepaymentDiscount.amount, { status: "SUPPORTED", value: 40_000 });
});
