import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_PAYMENT_POLICY,
  hasAcademyIdentity,
  hasEnrollmentPaymentIntent,
  resolveEnrollmentPaymentAction,
  resolveEnrollmentPaymentDecision,
} from "../../src/lib/academy/payment-policy.ts";
import { orchestrateNavigatorResponse } from "../../src/lib/navigation/orchestrate-navigation.ts";

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

test("positive matrix: four canonical Academy payment cases resolve through real intended path", async () => {
  const positiveCases = [
    {
      query: "Как оплатить и записаться на курс?",
      expectedAction: {
        courseId: null,
        paymentUrl: "https://t.me/AST_payment_course_bot",
      },
      hasIdentity: false,
    },
    {
      query: "Хочу оплатить курс «Структурная типология личности». Как это сделать?",
      expectedAction: {
        courseId: "structural-typology",
        paymentUrl: "https://t.me/AST_payment_course_bot?start=structural_typology",
      },
      hasIdentity: true,
    },
    {
      query: "Хочу купить курс по типологии, где оплатить?",
      expectedAction: {
        courseId: null,
        paymentUrl: "https://t.me/AST_payment_course_bot",
      },
      hasIdentity: false,
    },
    {
      query: "Как оплатить курс Маслоу?",
      expectedAction: {
        courseId: "maslow",
        paymentUrl: "https://t.me/AST_payment_course_bot?start=maslow",
      },
      hasIdentity: true,
    },
  ];

  for (const { query, expectedAction, hasIdentity } of positiveCases) {
    assert.equal(
      hasAcademyIdentity(query),
      hasIdentity,
      `hasAcademyIdentity: ${query}`,
    );

    // Through the REAL intended routing path (NAVIGATE):
    assert.deepEqual(
      resolveEnrollmentPaymentAction(query, { state: "NAVIGATE" }),
      expectedAction,
      `NAVIGATE action: ${query}`,
    );

    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      {
        dependencies: {
          classifyAct: async () => ({ state: "NAVIGATE" }),
        },
      },
    );
    assert.equal(
      result.observability?.answerOrigin,
      "PAYMENT_POLICY",
      `origin: ${query}`,
    );
    assert.match(
      result.message,
      new RegExp(expectedAction.paymentUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
      `paymentUrl in message: ${query}`,
    );
    assert.match(result.message, /Тихон/u, `Tikhon branding: ${query}`);

    // For named Academy courses, OUT_OF_SCOPE safeguard also resolves the course action
    if (hasIdentity) {
      assert.deepEqual(
        resolveEnrollmentPaymentAction(query, { state: "OUT_OF_SCOPE" }),
        expectedAction,
        `OUT_OF_SCOPE course safeguard: ${query}`,
      );
    }
  }
});

test("negative matrix: external courses and unrelated requests stay outside Academy checkout under OUT_OF_SCOPE", async () => {
  const negativeCases = [
    "Хочу купить курс английского на Coursera, где оплатить?",
    "Как оплатить курс йоги в другой школе?",
    "Хочу купить обучение в Skillbox.",
    "Как оплатить программу другой академии?",
    "Где оплатить онлайн-курс по Python на стороннем сайте?",
    "Хочу оплатить онлайн-курс по Python на стороннем сайте.",
    "Как оплатить курс по программированию на Udemy?",
    "Куда перевести деньги за квартиру?",
    "Как записаться к врачу?",
    "Хочу купить билет на самолет.",
    "Оплатить штраф.",
    "Где купить пиццу?",
  ];

  for (const query of negativeCases) {
    assert.equal(
      hasAcademyIdentity(query),
      false,
      `hasAcademyIdentity false: ${query}`,
    );

    assert.deepEqual(
      resolveEnrollmentPaymentDecision(query, { state: "OUT_OF_SCOPE" }),
      { kind: "NONE" },
      `decision NONE: ${query}`,
    );

    assert.equal(
      resolveEnrollmentPaymentAction(query, { state: "OUT_OF_SCOPE" }),
      null,
      `action null: ${query}`,
    );

    const result = await orchestrateNavigatorResponse(
      [{ role: "user", content: query }],
      {
        dependencies: {
          classifyAct: async () => ({ state: "OUT_OF_SCOPE" }),
        },
      },
    );
    assert.notEqual(
      result.observability?.answerOrigin,
      "PAYMENT_POLICY",
      `origin not PAYMENT_POLICY: ${query}`,
    );
    assert.equal(
      result.observability?.answerOrigin,
      "OUT_OF_SCOPE",
      `origin OUT_OF_SCOPE: ${query}`,
    );
    assert.doesNotMatch(
      result.message,
      /t\.me\/AST_payment_course_bot/u,
      `no bot link: ${query}`,
    );
    assert.doesNotMatch(
      result.message,
      /t\.me\//u,
      `no t.me link: ${query}`,
    );
    assert.match(
      result.message,
      /вне функции Навигатора/u,
      `OOS decline: ${query}`,
    );
  }
});
