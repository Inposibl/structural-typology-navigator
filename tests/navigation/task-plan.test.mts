/**
 * NAVIGATOR-INTENT-RECOVERY-ARM-B.IMPLEMENTATION-1 — task-plan schema,
 * frozen-identity and plan→segments mapping tests. Offline only: no provider
 * call exists on any path under test.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { ConversationMessage } from "../../src/lib/chat-contract.ts";
import {
  ARM_B_COMPOSITION_LINES,
  ARM_B_EXTRACTION_SYSTEM_PROMPT,
  ARM_B_USER_PREFIX,
  anyCourseLiteral,
  buildPlanExtractionUserContent,
  courseLiteralIn,
  mapPlanToRecoverySegments,
  namedCoursesInLatest,
  validateTaskPlan,
} from "../../src/lib/navigation/task-plan.ts";
import {
  validateConversationActDecision,
  ConversationActDecisionValidationError,
} from "../../src/lib/navigation/conversation-act-router.ts";

// Frozen DEV evidence identities (DEV_FREEZE.sha256, verified 609/609 OK).
const FROZEN_SHA = {
  systemPrompt:
    "9664648446ea97b827d1bae7b9868ae1ae2e31393a0a821e3c429ee25e9ccef3",
  userPrefix:
    "b4fbb162e8c4da4e99689866a36b72c995a1348f56fde8098a34f08c5d6bec3a",
  compositionLines:
    "437cfa5f009f25c48b3497f341a37cb4fe03460a7da3dbc57996119077ccac65",
};

const sha256OfConstant = (text: string): string =>
  createHash("sha256").update(text + "\n", "utf8").digest("hex");

const M = (role: "user" | "assistant", content: string): ConversationMessage => ({
  role,
  content,
});

test("frozen ARM-B prompt artifacts are byte-identical to the sealed DEV evidence", () => {
  assert.equal(sha256OfConstant(ARM_B_EXTRACTION_SYSTEM_PROMPT), FROZEN_SHA.systemPrompt);
  assert.equal(sha256OfConstant(ARM_B_USER_PREFIX), FROZEN_SHA.userPrefix);
  const compositionVerbatim = JSON.stringify(ARM_B_COMPOSITION_LINES, null, 2);
  // The parsed lines must re-render to the frozen file byte-for-byte.
  assert.equal(sha256OfConstant(compositionVerbatim), FROZEN_SHA.compositionLines);
});

test("the F-1 wording pinned for recovery is exactly the unchanged validator's", () => {
  const messages = [
    M("user", "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма»?"),
  ];
  assert.throws(
    () =>
      validateConversationActDecision(
        {
          state: "COURSE_CONTENT",
          courseId: "maslow",
          evidenceRequested: false,
          contentIntentEvidence: "Что даёт курс",
        },
        messages,
      ),
    (error: unknown) =>
      error instanceof ConversationActDecisionValidationError &&
      error.message ===
        "COURSE_CONTENT cannot be used once a catalog course is present in the conversation.",
  );
});

test("literal course presence helpers follow the exact title/URL rule", () => {
  const messages = [
    M("assistant", "Рекомендую «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow"),
    M("user", "А что даёт курс Маслоу для мотивации?"),
  ];
  assert.equal(courseLiteralIn("maslow", messages), true);
  assert.equal(courseLiteralIn("play-and-creativity", messages), false);
  assert.equal(anyCourseLiteral(messages), true);
  // Short-name only: no literal presence anywhere.
  const shortOnly = [M("user", "Что даёт курс Маслоу для мотивации?")];
  assert.equal(courseLiteralIn("maslow", shortOnly), false);
  assert.equal(anyCourseLiteral(shortOnly), false);
  assert.deepEqual(namedCoursesInLatest(messages), []);
  assert.deepEqual(namedCoursesInLatest([messages[0]]), ["maslow"]);
});

test("extraction payload carries the frozen prefix and the indexed conversation", () => {
  const messages = [M("user", "Первое"), M("assistant", "Ответ"), M("user", "Последнее")];
  const content = buildPlanExtractionUserContent(messages);
  assert.ok(content.startsWith(ARM_B_USER_PREFIX + "\n\n"));
  const payload = JSON.parse(content.slice(ARM_B_USER_PREFIX.length + 2));
  assert.equal(payload.latestUserMessageIndex, 2);
  assert.equal(payload.conversation.length, 3);
  assert.equal(payload.conversation[2].content, "Последнее");
  for (const course of payload.courses) {
    assert.deepEqual(Object.keys(course).sort(), ["id", "scope", "status", "title"]);
  }
});

// ---------------------------------------------------------------- validator

const S13_MESSAGES = [
  M("user", "Меня зовут Тест. На «вы»."),
  M(
    "assistant",
    "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии.",
  ),
  M(
    "user",
    "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией? Объясни, как самоактуализация связана с тревогой",
  ),
];

/** Real retained ARM-B plan (DEV record R1__ARM-B__S13__s1__a1.json). */
const S13_REAL_PLAN = {
  tasks: [
    {
      type: "EDU",
      courseIds: ["maslow"],
      role: "ACTIVE",
      evidence:
        "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией?",
    },
    {
      type: "EDU",
      courseIds: ["maslow"],
      role: "ACTIVE",
      evidence: "Объясни, как самоактуализация связана с тревогой",
    },
  ],
  mentions: [
    {
      courseId: "maslow",
      surface: "«Иерархия потребностей А. Маслоу: новая парадигма»",
      role: "ACTIVE",
    },
  ],
};

/** Real retained ARM-B plan (DEV record R1__ARM-B__S09__s1__a1.json). */
const S09_REAL_PLAN = {
  tasks: [
    {
      type: "EDU",
      courseIds: ["maslow"],
      role: "ACTIVE",
      evidence:
        "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией?",
    },
    {
      type: "PRICE",
      courseIds: ["maslow"],
      role: "ACTIVE",
      evidence: "Во сколько обойдётся участие",
    },
  ],
  mentions: [
    {
      courseId: "maslow",
      surface: "«Иерархия потребностей А. Маслоу: новая парадигма»",
      role: "ACTIVE",
    },
  ],
};

/** The real S09 fixture message set (DEV_FIXTURES.json, scenario S09). */
const S09_MESSAGES = [
  M("user", "Меня зовут Тест. На «вы»."),
  M(
    "assistant",
    "Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии.",
  ),
  M(
    "user",
    "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией? Во сколько обойдётся участие?",
  ),
];

test("validator accepts the real retained DEV plans", () => {
  const s13 = validateTaskPlan(structuredClone(S13_REAL_PLAN), S13_MESSAGES);
  assert.equal(s13.ok, true);
  assert.deepEqual(s13.problems, []);
  assert.equal(s13.active.length, 2);
  assert.deepEqual(s13.detectedCourseIds, ["maslow"]);

  const s09 = validateTaskPlan(structuredClone(S09_REAL_PLAN), S09_MESSAGES);
  assert.equal(s09.ok, true);
  assert.deepEqual(s09.problems, []);
  assert.equal(s09.active.length, 2);
});

test("validator rejects broken plans deterministically", () => {
  const latest = S13_MESSAGES;

  // Evidence not a verbatim substring.
  assert.ok(
    !validateTaskPlan(
      {
        tasks: [
          { type: "EDU", courseIds: ["maslow"], role: "ACTIVE", evidence: "такого нет в сообщении" },
        ],
      },
      latest,
    ).ok,
  );

  // Unknown course id.
  assert.ok(
    !validateTaskPlan(
      { tasks: [{ type: "EDU", courseIds: ["not-a-course"], role: "ACTIVE", evidence: "Что даёт курс" }] },
      latest,
    ).ok,
  );

  // EDU with two course ids.
  assert.ok(
    !validateTaskPlan(
      {
        tasks: [
          {
            type: "EDU",
            courseIds: ["maslow", "play-and-creativity"],
            role: "ACTIVE",
            evidence: "Что даёт курс",
          },
        ],
      },
      latest,
    ).ok,
  );

  // COMPARE with a single course.
  assert.ok(
    !validateTaskPlan(
      {
        tasks: [
          {
            type: "COMPARE",
            courseIds: ["maslow"],
            role: "ACTIVE",
            evidence: "Что даёт курс",
          },
        ],
      },
      latest,
    ).ok,
  );

  // No ACTIVE task.
  assert.ok(
    !validateTaskPlan(
      {
        tasks: [
          { type: "EDU", courseIds: ["maslow"], role: "BACKGROUND", evidence: "Что даёт курс" },
        ],
      },
      latest,
    ).ok,
  );

  // Payment cue in the message without an ACTIVE PAYMENT task. The cue is the
  // governed enrollment-intent pattern ("как оплатить"), not any payment word.
  const paymentMessages = [
    M(
      "user",
      "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией? Как оплатить участие?",
    ),
  ];
  const noPayment = validateTaskPlan(
    {
      tasks: [
        {
          type: "EDU",
          courseIds: ["maslow"],
          role: "ACTIVE",
          evidence: "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией?",
        },
      ],
    },
    paymentMessages,
  );
  assert.equal(noPayment.ok, false);
  assert.ok(noPayment.problems.includes("PAYMENT_CUE_WITHOUT_TASK"));

  // Price cue in the message without an ACTIVE PRICE task.
  const priceMessages = [
    M(
      "user",
      "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией? Во сколько обойдётся участие?",
    ),
  ];
  const noPrice = validateTaskPlan(
    {
      tasks: [
        {
          type: "EDU",
          courseIds: ["maslow"],
          role: "ACTIVE",
          evidence: "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией?",
        },
      ],
    },
    priceMessages,
  );
  assert.equal(noPrice.ok, false);
  assert.ok(noPrice.problems.includes("PRICE_CUE_WITHOUT_TASK"));

  // Unaccounted catalog course mention (maslow referenced, plan says play only).
  const unaccounted = validateTaskPlan(
    {
      tasks: [
        {
          type: "EDU",
          courseIds: ["play-and-creativity"],
          role: "ACTIVE",
          evidence: "Что даёт курс",
        },
      ],
      mentions: [],
    },
    [
      M(
        "user",
        "Что даёт курс Маслоу и курс «Игра и творчество в жизни взрослых людей»?",
      ),
    ],
  );
  assert.equal(unaccounted.ok, false);
  assert.ok(unaccounted.problems.includes("UNACCOUNTED_COURSE_MENTION"));

  // Unaccounted quoted non-catalog object.
  const quoted = validateTaskPlan(
    {
      tasks: [
        {
          type: "EDU",
          courseIds: ["maslow"],
          role: "ACTIVE",
          evidence: "Что даёт курс",
        },
      ],
    },
    [
      M(
        "user",
        "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» и программа «Совершенно чужая программа»?",
      ),
    ],
  );
  assert.equal(quoted.ok, false);
  assert.ok(quoted.problems.includes("UNACCOUNTED_QUOTED_OBJECT"));

  // Task count above the frozen ceiling.
  assert.ok(
    !validateTaskPlan(
      {
        tasks: [
          { type: "PRICE", courseIds: ["maslow"], role: "ACTIVE", evidence: "Что даёт курс" },
          { type: "SCHEDULE", courseIds: [], role: "ACTIVE", evidence: "Что даёт курс" },
          { type: "COHORT", courseIds: [], role: "ACTIVE", evidence: "Что даёт курс" },
          { type: "ENROLLMENT_WINDOW", courseIds: [], role: "ACTIVE", evidence: "Что даёт курс" },
          { type: "RECOMMEND", courseIds: [], role: "ACTIVE", evidence: "Что даёт курс" },
        ],
      },
      latest,
    ).ok,
  );

  // Duplicate course ids in one task.
  assert.ok(
    !validateTaskPlan(
      {
        tasks: [
          {
            type: "COMPARE",
            courseIds: ["maslow", "maslow"],
            role: "ACTIVE",
            evidence: "Что даёт курс",
          },
        ],
      },
      latest,
    ).ok,
  );

  // Non-catalog task type carrying course ids.
  assert.ok(
    !validateTaskPlan(
      {
        tasks: [
          { type: "FOREIGN", courseIds: ["maslow"], role: "ACTIVE", evidence: "Что даёт курс" },
        ],
      },
      latest,
    ).ok,
  );
});

// ---------------------------------------------------------------- mapping

test("mapping reproduces the frozen DEV segment structure for the real S09 plan", () => {
  const segments = mapPlanToRecoverySegments(
    validateTaskPlan(structuredClone(S09_REAL_PLAN), S13_MESSAGES).active,
    S13_MESSAGES,
  );
  assert.equal(segments.length, 2);
  const [edu, price] = segments as [
    Extract<(typeof segments)[number], { kind: "ACT" }>,
    Extract<(typeof segments)[number], { kind: "ACT" }>,
  ];
  assert.deepEqual(edu.act, {
    state: "COURSE_FOLLOW_UP",
    courseId: "maslow",
    evidenceRequested: false,
  });
  assert.equal(edu.evidenceSpan, S09_REAL_PLAN.tasks[0].evidence);
  assert.deepEqual(price.act, {
    state: "FACTUAL",
    intents: [
      {
        kind: "CURRENT_METADATA",
        courseIds: ["maslow"],
        fields: ["PRICE"],
        scope: "REFERENCED",
      },
    ],
  });
  // Segments carry their owning ACTIVE task indices for coverage accounting.
  assert.deepEqual(edu.taskIndices, [0]);
  assert.deepEqual(price.taskIndices, [1]);
});

test("mapping keeps two same-course EDU tasks as two task-scoped segments", () => {
  const segments = mapPlanToRecoverySegments(
    validateTaskPlan(structuredClone(S13_REAL_PLAN), S13_MESSAGES).active,
    S13_MESSAGES,
  );
  assert.equal(segments.length, 2);
  for (const segment of segments) {
    assert.equal(segment.kind, "ACT");
    assert.equal(segment.kind === "ACT" && segment.act.state, "COURSE_FOLLOW_UP");
  }
  const second = segments[1] as Extract<(typeof segments)[number], { kind: "ACT" }>;
  assert.equal(second.evidenceSpan, "Объясни, как самоактуализация связана с тревогой");
});

test("mapping demotes EDU about a non-literal course on the F-1 path to an explicit line", () => {
  // F-1 recovery requires a literal course somewhere; maslow here is only a
  // short-name reference, so its EDU task cannot dispatch and must demote,
  // while the literally named play course keeps its FOLLOW_UP segment.
  const messages = [
    M(
      "user",
      "Что даёт курс Маслоу для мотивации? А что даёт курс «Игра и творчество в жизни взрослых людей»?",
    ),
  ];
  const verdict = validateTaskPlan(
    {
      tasks: [
        {
          type: "EDU",
          courseIds: ["maslow"],
          role: "ACTIVE",
          evidence: "Что даёт курс Маслоу для мотивации?",
        },
        {
          type: "EDU",
          courseIds: ["play-and-creativity"],
          role: "ACTIVE",
          evidence: "А что даёт курс «Игра и творчество в жизни взрослых людей»?",
        },
      ],
    },
    messages,
  );
  assert.equal(verdict.ok, true);
  const segments = mapPlanToRecoverySegments(verdict.active, messages);
  assert.equal(segments.length, 2);
  const [maslowSegment, playSegment] = segments;
  assert.equal(maslowSegment.kind, "LINE");
  assert.equal(
    maslowSegment.kind === "LINE" && maslowSegment.validatorRejection,
    null,
  );
  assert.ok(
    maslowSegment.kind === "LINE" &&
      maslowSegment.lineKind === "UNDISPATCHED" &&
      maslowSegment.text.includes("Что даёт курс Маслоу для мотивации?"),
  );
  assert.equal(
    playSegment.kind === "ACT" && playSegment.act.state,
    "COURSE_FOLLOW_UP",
  );
});

test("single PAYMENT maps to NAVIGATE; in a composition it becomes the frozen limitation line", () => {
  const single = mapPlanToRecoverySegments(
    [{ type: "PAYMENT", courseIds: ["maslow"], role: "ACTIVE", evidence: "как оплатить курс" }],
    S13_MESSAGES,
  );
  assert.equal(single.length, 1);
  assert.deepEqual(single[0].kind === "ACT" && single[0].act, { state: "NAVIGATE" });

  const composed = mapPlanToRecoverySegments(
    [
      { type: "PAYMENT", courseIds: [], role: "ACTIVE", evidence: "как оплатить" },
      { type: "PRICE", courseIds: ["maslow"], role: "ACTIVE", evidence: "Что даёт курс" },
    ],
    S13_MESSAGES,
  );
  assert.equal(composed.length, 2);
  const line = composed.find((segment) => segment.kind === "LINE");
  assert.ok(line && line.kind === "LINE");
  assert.equal(line.lineKind, "PAYMENT");
  assert.equal(line.text, ARM_B_COMPOSITION_LINES.PAYMENT);
  assert.deepEqual(line.taskIndices, [0]);
});

test("COMPARE maps to a comparison intent; a one-course COMPARE is demoted", () => {
  const comparisonMessages = [
    M(
      "user",
      "Сравни «Иерархия потребностей А. Маслоу: новая парадигма» и «Нормативная ситуация»",
    ),
  ];
  const verdict = validateTaskPlan(
    {
      tasks: [
        {
          type: "COMPARE",
          courseIds: ["maslow", "normative-situation"],
          role: "ACTIVE",
          evidence: "Сравни «Иерархия потребностей А. Маслоу: новая парадигма» и «Нормативная ситуация»",
        },
      ],
    },
    comparisonMessages,
  );
  assert.equal(verdict.ok, true);
  const segments = mapPlanToRecoverySegments(verdict.active, comparisonMessages);
  assert.equal(segments.length, 1);
  const segment = segments[0];
  assert.equal(segment.kind, "ACT");
  if (segment.kind === "ACT") {
    assert.deepEqual(segment.act, {
      state: "FACTUAL",
      intents: [
        {
          kind: "COURSE_COMPARISON",
          courseIds: ["maslow", "normative-situation"],
          hasUnknownCourse: false,
        },
      ],
    });
  }

  const demoted = mapPlanToRecoverySegments(
    [{ type: "COMPARE", courseIds: ["maslow"], role: "ACTIVE", evidence: "x" }],
    S13_MESSAGES,
  );
  assert.equal(demoted.length, 1);
  assert.equal(demoted[0].kind, "LINE");
  assert.ok(
    demoted[0].kind === "LINE" &&
      demoted[0].validatorRejection === "FACTUAL_INTENT_UNREPRESENTABLE",
  );
});

test("UNKNOWN_COURSE, FOREIGN and OUT_OF_SCOPE merge into one OUT_OF_SCOPE act", () => {
  const segments = mapPlanToRecoverySegments(
    [
      { type: "FOREIGN", courseIds: [], role: "ACTIVE", evidence: "про курс Coursera" },
      { type: "UNKNOWN_COURSE", courseIds: [], role: "ACTIVE", evidence: "про чужую программу" },
    ],
    S13_MESSAGES,
  );
  assert.equal(segments.length, 1);
  const segment = segments[0];
  assert.equal(segment.kind, "ACT");
  assert.deepEqual(segment.kind === "ACT" && segment.act, { state: "OUT_OF_SCOPE" });
  assert.deepEqual(segment.kind === "ACT" && segment.taskIndices, [0, 1]);
});

// FINAL-IMPLEMENTATION-1: task cardinality and lossless successor mapping.
test("successor merges compatible metadata while retaining every task index", () => {
  const text = "Сколько стоит курс Маслоу; когда поток; какое расписание; до какого числа набор";
  const messages = [M("assistant", "Иерархия потребностей А. Маслоу: новая парадигма"), M("user", text)];
  const tasks = (["PRICE", "COHORT", "SCHEDULE", "ENROLLMENT_WINDOW"] as const).map((type) => ({
    type, courseIds: ["maslow"], role: "ACTIVE" as const, evidence: text,
  }));
  const segments = mapPlanToRecoverySegments(tasks, messages);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].taskIndices, [0, 1, 2, 3]);
  assert.equal(segments[0].kind, "ACT");
  if (segments[0].kind !== "ACT" || segments[0].act.state !== "FACTUAL") return;
  const metadata = segments[0].act.intents[0];
  assert.equal(metadata.kind, "CURRENT_METADATA");
  if (metadata.kind === "CURRENT_METADATA") assert.deepEqual(metadata.fields, ["PRICE", "COHORT", "SCHEDULE", "ENROLLMENT_WINDOW"]);
});

test("successor does not cross-product metadata course scopes", () => {
  const text = "Цена Маслоу и расписание уровней сознания";
  const segments = mapPlanToRecoverySegments([
    { type: "PRICE", courseIds: ["maslow"], role: "ACTIVE", evidence: text },
    { type: "SCHEDULE", courseIds: ["levels-of-consciousness"], role: "ACTIVE", evidence: text },
  ], [M("user", text)]);
  assert.equal(segments.length, 2);
  for (const [index, segment] of segments.entries()) {
    assert.deepEqual(segment.taskIndices, [index]);
    assert.equal(segment.kind, "ACT");
  }
});

test("successor retains two independent comparison payloads", () => {
  const text = "Сравните Маслоу с уровнями сознания и Маслоу с игрой и творчеством";
  const segments = mapPlanToRecoverySegments([
    { type: "COMPARE", courseIds: ["maslow", "levels-of-consciousness"], role: "ACTIVE", evidence: text },
    { type: "COMPARE", courseIds: ["maslow", "play-and-creativity"], role: "ACTIVE", evidence: text },
  ], [M("user", text)]);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map((segment) => segment.taskIndices), [[0], [1]]);
  assert.deepEqual(segments.map((segment) => segment.kind === "ACT" && segment.act.state === "FACTUAL" ? segment.act.intents : null), [
    [{ kind: "COURSE_COMPARISON", courseIds: ["maslow", "levels-of-consciousness"], hasUnknownCourse: false }],
    [{ kind: "COURSE_COMPARISON", courseIds: ["maslow", "play-and-creativity"], hasUnknownCourse: false }],
  ]);
});

test("identical EDU work can serve two stable tasks without repeated dispatch", () => {
  const task = { type: "EDU" as const, courseIds: ["maslow"], role: "ACTIVE" as const, evidence: "Чему учит курс" };
  const segments = mapPlanToRecoverySegments([task, { ...task }], [
    M("assistant", "Иерархия потребностей А. Маслоу: новая парадигма"), M("user", task.evidence),
  ]);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].taskIndices, [0, 1]);
});
