import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_PAYMENT_POLICY,
  hasEnrollmentPaymentIntent,
  resolveEnrollmentPaymentAction,
} from "../../src/lib/academy/payment-policy.ts";

test("exact Owner-authorized payment deep links remain frozen", () => {
  assert.equal(
    ACADEMY_PAYMENT_POLICY.courses["structural-typology"].paymentUrl,
    "https://t.me/AST_payment_course_bot?start=structural_typology",
  );
  assert.equal(
    ACADEMY_PAYMENT_POLICY.courses["levels-of-consciousness"].paymentUrl,
    "https://t.me/AST_payment_course_bot?start=levels_of_consciousness",
  );
  assert.equal(
    ACADEMY_PAYMENT_POLICY.courses.maslow.paymentUrl,
    "https://t.me/AST_payment_course_bot?start=maslow",
  );
  assert.equal(
    ACADEMY_PAYMENT_POLICY.courses["normative-situation"].paymentUrl,
    "https://t.me/AST_payment_course_bot?start=normative_situation",
  );
  assert.equal(
    ACADEMY_PAYMENT_POLICY.courses["play-and-creativity"].paymentUrl,
    "https://t.me/AST_payment_course_bot?start=play_and_creativity",
  );
});

test("explicit enrollment intent resolves a named levels course from NAVIGATE", () => {
  const action = resolveEnrollmentPaymentAction(
    "Мне подходит курс по уровням сознания, хочу оплатить",
    { state: "NAVIGATE" },
  );

  assert.deepEqual(action, {
    courseId: "levels-of-consciousness",
    paymentUrl:
      "https://t.me/AST_payment_course_bot?start=levels_of_consciousness",
  });
});

test("this course enrollment uses the already bound follow-up course", () => {
  const action = resolveEnrollmentPaymentAction(
    "Хочу на этот курс",
    {
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: false,
    },
  );

  assert.deepEqual(action, {
    courseId: "maslow",
    paymentUrl: "https://t.me/AST_payment_course_bot?start=maslow",
  });
});

test("general enrollment without resolved course uses general bot", () => {
  const action = resolveEnrollmentPaymentAction(
    "Как записаться?",
    { state: "NAVIGATE" },
  );

  assert.deepEqual(action, {
    courseId: null,
    paymentUrl: "https://t.me/AST_payment_course_bot",
  });
});

test("mere price question does not trigger checkout", () => {
  assert.equal(
    hasEnrollmentPaymentIntent("Сколько стоит этот курс?"),
    false,
  );
  assert.equal(
    resolveEnrollmentPaymentAction(
      "Сколько стоит этот курс?",
      {
        state: "COURSE_FOLLOW_UP",
        courseId: "maslow",
        evidenceRequested: false,
      },
    ),
    null,
  );
});

test("out-of-scope appointment language cannot trigger Academy checkout", () => {
  assert.equal(
    resolveEnrollmentPaymentAction(
      "Как записаться к врачу?",
      { state: "OUT_OF_SCOPE" },
    ),
    null,
  );
});
