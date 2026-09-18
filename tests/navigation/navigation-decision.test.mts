import assert from "node:assert/strict";
import test from "node:test";

import {
  NavigationDecisionValidationError,
  validateNavigationDecision,
} from "../../src/lib/navigation/navigation-decision.ts";

const messages = [
  {
    role: "user" as const,
    content: "У нас правила не работают без моего постоянного контроля.",
  },
];

test("accepts ASK_MORE with up to two routable candidates and three questions", () => {
  const result = validateNavigationDecision({
    state: "ASK_MORE",
    candidateCourseIds: ["maslow", "normative-situation"],
    questions: ["Q1?", "Q2?"],
    rationale: "Need discrimination.",
  });

  assert.equal(result.state, "ASK_MORE");
});

test("rejects an unroutable or invented candidate", () => {
  for (const courseId of [
    "professional-development-stages",
    "invented-course",
  ]) {
    assert.throws(
      () =>
        validateNavigationDecision({
          state: "ASK_MORE",
          candidateCourseIds: [courseId],
          questions: ["Q?"],
          rationale: "Need more.",
        }),
      NavigationDecisionValidationError,
    );
  }
});

test("accepts a current course recommendation only with grounded user evidence", () => {
  const result = validateNavigationDecision(
    {
      state: "RECOMMEND_COURSE",
      primaryCourseId: "normative-situation",
      secondaryCourseIds: [],
      learningNeed: "Понять нормативную среду и ответственность.",
      evidence: [
        {
          messageIndex: 0,
          quote: "правила не работают без моего постоянного контроля",
        },
      ],
      confidence: "strong",
    },
    messages,
  );

  assert.equal(result.state, "RECOMMEND_COURSE");
});

test("rejects hallucinated or assistant-derived routing evidence", () => {
  assert.throws(
    () =>
      validateNavigationDecision(
        {
          state: "RECOMMEND_COURSE",
          primaryCourseId: "normative-situation",
          secondaryCourseIds: [],
          learningNeed: "Понять нормативную среду.",
          evidence: [
            {
              messageIndex: 0,
              quote: "люди саботируют изменения",
            },
          ],
          confidence: "strong",
        },
        messages,
      ),
    /not verbatim grounded/u,
  );

  const withAssistant = [
    ...messages,
    {
      role: "assistant" as const,
      content: "Возможно, проблема в сопротивлении изменениям.",
    },
  ];

  assert.throws(
    () =>
      validateNavigationDecision(
        {
          state: "RECOMMEND_COURSE",
          primaryCourseId: "normative-situation",
          secondaryCourseIds: [],
          learningNeed: "Понять нормативную среду.",
          evidence: [
            {
              messageIndex: 1,
              quote: "проблема в сопротивлении изменениям",
            },
          ],
          confidence: "strong",
        },
        withAssistant,
      ),
    /must reference a user message/u,
  );
});

test("accepts only contiguous official multi-course sequences", () => {
  assert.doesNotThrow(() =>
    validateNavigationDecision(
      {
        state: "RECOMMEND_COURSE",
        primaryCourseId: "levels-of-consciousness",
        secondaryCourseIds: ["maslow", "play-and-creativity"],
        learningNeed: "Последовательное обучение.",
        evidence: [
          {
            messageIndex: 0,
            quote: "правила не работают",
          },
        ],
        confidence: "sufficient",
      },
      messages,
    ),
  );

  assert.throws(
    () =>
      validateNavigationDecision(
        {
          state: "RECOMMEND_COURSE",
          primaryCourseId: "maslow",
          secondaryCourseIds: ["structural-typology"],
          learningNeed: "Invented sequence.",
          evidence: [
            {
              messageIndex: 0,
              quote: "правила не работают",
            },
          ],
          confidence: "sufficient",
        },
        messages,
      ),
    NavigationDecisionValidationError,
  );
});

test("rejects professional-development-stages as a recommendation", () => {
  assert.throws(
    () =>
      validateNavigationDecision(
        {
          state: "RECOMMEND_COURSE",
          primaryCourseId: "professional-development-stages",
          secondaryCourseIds: [],
          learningNeed: "Professional growth.",
          evidence: [
            {
              messageIndex: 0,
              quote: "правила не работают",
            },
          ],
          confidence: "sufficient",
        },
        messages,
      ),
    NavigationDecisionValidationError,
  );
});
