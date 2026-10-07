import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_PAYMENT_POLICY,
  hasEnrollmentPaymentIntent,
  resolveEnrollmentPaymentAction,
  resolveEnrollmentPaymentDecision,
} from "../../src/lib/academy/payment-policy.ts";
import { routeConversationAct } from "../../src/lib/navigation/conversation-act-router.ts";
import { createInitialConversationState } from "../../src/lib/navigation/conversation-state.ts";
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

test("unconsumed narrative payment framing returns no action from NAVIGATE", () => {
  const action = resolveEnrollmentPaymentAction(
    "Мне подходит курс по уровням сознания, хочу оплатить",
    { state: "NAVIGATE" },
  );

  assert.equal(action, null);
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

test("positive matrix: four accepted Academy payment forms resolve through the intended path", async () => {
  const positiveCases = [
    {
      query: "Как оплатить и записаться на курс?",
      expectedAction: {
        courseId: null,
        paymentUrl: "https://t.me/AST_payment_course_bot",
      },
    },
    {
      query: "Да, хочу оплатить «Структурную типологию личности»",
      expectedAction: {
        courseId: "structural-typology",
        paymentUrl: "https://t.me/AST_payment_course_bot?start=structural_typology",
      },
    },
    {
      query: "Хочу купить курс по типологии, где оплатить?",
      expectedAction: {
        courseId: null,
        paymentUrl: "https://t.me/AST_payment_course_bot",
      },
    },
    {
      query: "Как оплатить курс Маслоу?",
      expectedAction: {
        courseId: "maslow",
        paymentUrl: "https://t.me/AST_payment_course_bot?start=maslow",
      },
    },
  ];

  for (const { query, expectedAction } of positiveCases) {
    assert.deepEqual(
      resolveEnrollmentPaymentDecision(query, { state: "NAVIGATE" }),
      { kind: "ACTION", action: expectedAction },
      `NAVIGATE decision: ${query}`,
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

    // Only the complete qualified course forms may outrank OUT_OF_SCOPE.
    if (expectedAction.courseId !== null) {
      assert.deepEqual(
        resolveEnrollmentPaymentAction(query, { state: "OUT_OF_SCOPE" }),
        expectedAction,
        `OUT_OF_SCOPE course safeguard: ${query}`,
      );
    } else {
      assert.deepEqual(
        resolveEnrollmentPaymentDecision(query, { state: "OUT_OF_SCOPE" }),
        { kind: "NONE" },
        `generic OUT_OF_SCOPE decision: ${query}`,
      );
      assert.equal(
        resolveEnrollmentPaymentAction(query, { state: "OUT_OF_SCOPE" }),
        null,
        `generic OUT_OF_SCOPE action: ${query}`,
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

  const initial = createInitialConversationState(Date.UTC(2026, 9, 7));
  const contexts = [
    initial,
    { ...initial, selectedCourseId: "maslow", courseMatch: "MATCHED" as const },
  ];

  for (const context of contexts) {
    for (const query of negativeCases) {
      assert.deepEqual(
        resolveEnrollmentPaymentDecision(query, { state: "OUT_OF_SCOPE" }, context),
        { kind: "NONE" },
        `decision NONE: ${query}`,
      );

      assert.equal(
        resolveEnrollmentPaymentAction(query, { state: "OUT_OF_SCOPE" }, context),
        null,
        `action null: ${query}`,
      );

      const result = await orchestrateNavigatorResponse(
        [{ role: "user", content: query }],
        {
          conversationState: context,
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
  }
});

test("historical unqualified structural-typology request stays rejected without a Telegram handoff", async () => {
  // The nominative short object and the secondary "Как это сделать?" clause
  // do not satisfy the accepted closed fresh grammar.
  const query = "Хочу оплатить курс «Структурная типология личности». Как это сделать?";
  for (const state of ["NAVIGATE", "OUT_OF_SCOPE"] as const) {
    assert.deepEqual(resolveEnrollmentPaymentDecision(query, { state }), { kind: "NONE" });
    assert.equal(resolveEnrollmentPaymentAction(query, { state }), null);
  }

  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: query }],
    { dependencies: { classifyAct: async () => ({ state: "OUT_OF_SCOPE" }) } },
  );
  assert.equal(result.observability?.answerOrigin, "OUT_OF_SCOPE");
  assert.doesNotMatch(result.message, /t\.me\//u);
  assert.match(result.message, /вне функции Навигатора/u);
});

test("router prompt capture retains Academy payment guidance and latest-user external-topic priority", async () => {
  const messages = [
    { role: "user" as const, content: "Хочу понять мотивацию команды." },
    {
      role: "assistant" as const,
      content: "Курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow.",
    },
    { role: "user" as const, content: "Хочу купить курс английского на Coursera, где оплатить?" },
  ];
  let captured: readonly { role: string; content: string }[] | undefined;
  const result = await routeConversationAct(messages, {
    callJson: async (requestMessages) => {
      captured = requestMessages;
      // A transport fixture, not a live-model classification claim.
      return { state: "OUT_OF_SCOPE" };
    },
  });
  assert.deepEqual(result, { state: "OUT_OF_SCOPE" });
  assert.ok(captured);
  assert.equal(captured[0]?.role, "system");
  const prompt = captured[0]?.content ?? "";
  for (const guidance of [
    "1. NAVIGATE",
    "выражает намерение записаться, оплатить или купить курс/обучение в Академии",
    "сторонние образовательные курсы, школы или платформы (Coursera, Udemy, Skillbox, йога, английский, Python на сторонних сайтах, другие академии и школы)",
    "посторонние покупки, услуги и платежи (товары, билеты, запись к врачу, коммуналка/аренда, штрафы, еда)",
    "любые сторонние курсы, внешнее обучение и посторонние покупки — это OUT_OF_SCOPE",
    "оплата/запись на курс — это NAVIGATE, вопрос о цене — FACTUAL",
    "последняя USER-реплика имеет решающий приоритет",
    "НЕ имеет права перетянуть новую несвязанную реплику обратно в прежний курс",
  ]) {
    assert.ok(prompt.includes(guidance), guidance);
  }
  const request = captured[1]?.content ?? "";
  const envelope = JSON.parse(request.slice(request.indexOf("\n\n") + 2));
  assert.equal(envelope.latestUserMessageIndex, messages.length - 1);
  assert.deepEqual(
    envelope.conversation,
    messages.map((message, messageIndex) => ({ messageIndex, ...message })),
  );
});
