/**
 * NAVIGATOR-INTENT-RECOVERY-ARM-B.IMPLEMENTATION-1 — F-1 boundary, single
 * extraction, and coordination tests. All extraction responses are canned; no
 * provider call is possible on any path here.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationMessage } from "../../src/lib/chat-contract.ts";
import { DeepSeekClientError } from "../../src/lib/navigation/deepseek-client.ts";
import { ConversationActDecisionValidationError } from "../../src/lib/navigation/conversation-act-router.ts";
import {
  F1_COURSE_CONTENT_PRECONDITION_MESSAGE,
  PLAN_RECOVERY_TIMEOUT_MS,
  attemptIntentPlanRecovery,
  createIntentPlanRecoveryLog,
  extractTaskPlan,
  isF1CourseContentRejection,
  type SegmentDispatchResult,
} from "../../src/lib/navigation/intent-plan-recovery.ts";

const M = (role: "user" | "assistant", content: string): ConversationMessage => ({
  role,
  content,
});

const F1_MESSAGES = [
  M("user", "Меня зовут Тест. На «вы»."),
  M(
    "assistant",
    "В текущем каталоге Академии представлен курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow",
  ),
  M(
    "user",
    "Что даёт курс «Иерархия потребностей А. Маслоу: новая парадигма» для работы с мотивацией? Во сколько обойдётся участие?",
  ),
];

/** Real retained ARM-B plan (DEV record R1__ARM-B__S09__s1__a1.json). */
const S09_PLAN = {
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

const L2_MESSAGES = [
  M(
    "assistant",
    "В каталоге есть «Иерархия уровней сознания» — https://structural-typology.academy/courses/levels-of-consciousness",
  ),
  M(
    "user",
    "Как курс «Иерархия уровней сознания» помогает понять природу изменённых состояний сознания?",
  ),
];

const okDispatch = (overrides: Partial<SegmentDispatchResult> = {}): SegmentDispatchResult => ({
  bindingKind: "NONE",
  pendingConfirmation: false,
  answerOrigin: "CATALOG_AUTHORITY",
  message: "segment text",
  value: undefined,
  ...overrides,
});

test("the F-1 predicate accepts only the exact validator rejection", () => {
  assert.equal(
    isF1CourseContentRejection(
      new ConversationActDecisionValidationError(F1_COURSE_CONTENT_PRECONDITION_MESSAGE),
    ),
    true,
  );
  assert.equal(
    isF1CourseContentRejection(
      new ConversationActDecisionValidationError("COURSE_CONTENT cannot be used once a catalog course is present."),
    ),
    false,
  );
  assert.equal(
    isF1CourseContentRejection(new DeepSeekClientError("INVALID_RESPONSE", "x")),
    false,
  );
  assert.equal(isF1CourseContentRejection(new Error("other")), false);
  assert.equal(isF1CourseContentRejection(null), false);
});

test("extraction builds the frozen two-message request and honors the injected dependency", async () => {
  const seen: { messages: unknown; options: unknown } = { messages: null, options: null };
  const plan = await extractTaskPlan(F1_MESSAGES, { timeoutMs: 5 }, async (messages, options) => {
    seen.messages = messages;
    seen.options = options;
    return structuredClone(S09_PLAN);
  });
  assert.deepEqual(plan, S09_PLAN);
  const messages = seen.messages as { role: string; content: string }[];
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.ok(messages[1].content.startsWith("Разложи последнюю реплику пользователя"));
  assert.equal((seen.options as { timeoutMs: number }).timeoutMs, 5);
});

test("single-task plans execute one validated act exactly once", async () => {
  let dispatchCalls = 0;
  const outcome = await attemptIntentPlanRecovery({
    messages: L2_MESSAGES,
    extractionOptions: {},
    extraction: async () => ({
      tasks: [
        {
          type: "EDU",
          courseIds: ["levels-of-consciousness"],
          role: "ACTIVE",
          evidence:
            "Как курс «Иерархия уровней сознания» помогает понять природу изменённых состояний сознания",
        },
      ],
      mentions: [
        {
          courseId: "levels-of-consciousness",
          surface: "«Иерархия уровней сознания»",
          role: "ACTIVE",
        },
      ],
    }),
    dispatchSegment: async () => {
      dispatchCalls += 1;
      return okDispatch();
    },
  });
  assert.equal(outcome.disposition, "RECOVERED_SINGLE_ACT");
  assert.equal(outcome.disposition !== "RECOVERED_SINGLE_ACT" ? null : outcome.act?.state, "COURSE_FOLLOW_UP");
  assert.equal(dispatchCalls, 1);
});

test("multi-task plans execute read-only secondary then designated primary once", async () => {
  const dispatched: number[] = [];
  const outcome = await attemptIntentPlanRecovery({
    messages: F1_MESSAGES,
    extractionOptions: {},
    extraction: async () => structuredClone(S09_PLAN),
    dispatchSegment: async (_segment, index) => {
      dispatched.push(index);
      return okDispatch({ message: `text-${index}` });
    },
  });
  assert.equal(outcome.disposition, "RECOVERED_COMPOSED");
  if (outcome.disposition !== "RECOVERED_COMPOSED") return;
  // Two ACT segments (EDU + PRICE), dispatched in plan order.
  assert.deepEqual(dispatched, [1, 0]);
  // Neither dispatch is binding-changing → primary is the first segment.
  assert.equal(outcome.primarySegmentIndex, 0);
  assert.equal(outcome.primaryAct?.state, "COURSE_FOLLOW_UP");
  assert.deepEqual(outcome.activeTaskTypes, ["EDU", "PRICE"]);
});

test("a second binding-changing segment refuses the composition (BINDING_CONFLICT)", async () => {
  const outcome = await attemptIntentPlanRecovery({
    messages: F1_MESSAGES,
    extractionOptions: {},
    extraction: async () => ({
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
    }),
    dispatchSegment: async () => okDispatch({ bindingKind: "AMBIGUOUS" }),
  });
  assert.equal(outcome.disposition, "BINDING_CONFLICT");
});

test("an invalid plan is rejected without any dispatch", async () => {
  let dispatchCalls = 0;
  const outcome = await attemptIntentPlanRecovery({
    messages: F1_MESSAGES,
    extractionOptions: {},
    extraction: async () => ({ tasks: [] }),
    dispatchSegment: async () => {
      dispatchCalls += 1;
      return okDispatch();
    },
  });
  assert.equal(outcome.disposition, "PLAN_REJECTED");
  if (outcome.disposition !== "PLAN_REJECTED") return;
  assert.ok(outcome.problems.includes("TASK_COUNT"));
  assert.equal(dispatchCalls, 0);
});

test("an all-lines plan retains accepted tasks for explicit limitations", async () => {
  const outcome = await attemptIntentPlanRecovery({
    messages: L2_MESSAGES,
    extractionOptions: {},
    extraction: async () => ({
      tasks: [
        {
          type: "PAYMENT",
          courseIds: [],
          role: "ACTIVE",
          evidence:
            "Как курс «Иерархия уровней сознания» помогает понять природу изменённых состояний сознания",
        },
        {
          type: "RECOMMEND",
          courseIds: [],
          role: "ACTIVE",
          evidence:
            "Как курс «Иерархия уровней сознания» помогает понять природу изменённых состояний сознания",
        },
      ],
      mentions: [
        {
          courseId: "levels-of-consciousness",
          surface: "«Иерархия уровней сознания»",
          role: "ACTIVE",
        },
      ],
    }),
    dispatchSegment: async () => okDispatch(),
  });
  assert.equal(outcome.disposition, "RECOVERED_COMPOSED");
  if (outcome.disposition === "RECOVERED_COMPOSED") assert.equal(outcome.primarySegmentIndex, null);
});

test("extraction failures are closed with bounded reason codes — never retried", async () => {
  const transport = await attemptIntentPlanRecovery({
    messages: F1_MESSAGES,
    extractionOptions: {},
    extraction: async () => {
      throw new DeepSeekClientError("UPSTREAM_ERROR", "DeepSeek rejected the request.", 503);
    },
    dispatchSegment: async () => okDispatch(),
  });
  assert.deepEqual(transport, { disposition: "EXTRACTION_FAILED", reasonCode: "UPSTREAM_ERROR" });

  const aborted = await attemptIntentPlanRecovery({
    messages: F1_MESSAGES,
    extractionOptions: {},
    extraction: async () => {
      throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    },
    dispatchSegment: async () => okDispatch(),
  });
  assert.equal(aborted.disposition, "EXTRACTION_FAILED");
  assert.equal(aborted.disposition === "EXTRACTION_FAILED" && aborted.reasonCode, "ABORTED");

  const unknown = await attemptIntentPlanRecovery({
    messages: F1_MESSAGES,
    extractionOptions: {},
    extraction: async () => {
      throw new Error("boom");
    },
    dispatchSegment: async () => okDispatch(),
  });
  assert.equal(unknown.disposition === "EXTRACTION_FAILED" && unknown.reasonCode, "EXTRACTION_ERROR");

  // Malformed JSON reaching the plan slot is a deterministic plan rejection,
  // not a crash and not a retry.
  const malformed = await attemptIntentPlanRecovery({
    messages: F1_MESSAGES,
    extractionOptions: {},
    extraction: async () => "not json at all",
    dispatchSegment: async () => okDispatch(),
  });
  assert.equal(malformed.disposition, "PLAN_REJECTED");

  // A dispatch that throws leaves the segment unaccounted and refuses nothing:
  // the remaining segments still determine the primary.
  const dispatchFailure = await attemptIntentPlanRecovery({
    messages: F1_MESSAGES,
    extractionOptions: {},
    extraction: async () => structuredClone(S09_PLAN),
    dispatchSegment: async (_segment, index) => {
      if (index === 0) throw new Error("segment failed");
      return okDispatch();
    },
  });
  assert.equal(dispatchFailure.disposition, "RECOVERED_COMPOSED");
  if (dispatchFailure.disposition !== "RECOVERED_COMPOSED") return;
  assert.equal(dispatchFailure.dispatchResults[0], null);
});

test("a single failed dispatch remains present for limitation accounting", async () => {
  // Even a failed sole task is executed once and remains in the result partition.
  let dispatchCalls = 0;
  const outcome = await attemptIntentPlanRecovery({
    messages: L2_MESSAGES,
    extractionOptions: {},
    extraction: async () => ({
      tasks: [
        {
          type: "EDU",
          courseIds: ["levels-of-consciousness"],
          role: "ACTIVE",
          evidence:
            "Как курс «Иерархия уровней сознания» помогает понять природу изменённых состояний сознания",
        },
      ],
      mentions: [
        {
          courseId: "levels-of-consciousness",
          surface: "«Иерархия уровней сознания»",
          role: "ACTIVE",
        },
      ],
    }),
    dispatchSegment: async () => {
      dispatchCalls += 1;
      throw new Error("single dispatch failed");
    },
  });
  assert.equal(outcome.disposition, "RECOVERED_SINGLE_ACT");
  assert.equal(dispatchCalls, 1);
  if (outcome.disposition === "RECOVERED_SINGLE_ACT") assert.equal(outcome.dispatchResults[0], null);
});

test("the recovery timeout is bounded and strictly smaller than the client default", () => {
  assert.equal(PLAN_RECOVERY_TIMEOUT_MS, 30_000);
  assert.ok(PLAN_RECOVERY_TIMEOUT_MS < 45_000);
});

test("recovery logs are bounded to whitelisted fields", () => {
  const log = createIntentPlanRecoveryLog("req-7", {
    disposition: "RECOVERED_COMPOSED",
    activeTaskCount: 2,
    segments: [
      {
        kind: "ACT",
        taskIndices: [0],
        taskTypes: ["EDU"],
        evidenceSpan: "секретный текст студента — не должен попасть в лог",
        act: { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false },
      },
      {
        kind: "LINE",
        taskIndices: [1],
        taskTypes: ["PAYMENT"],
        evidenceSpan: "ещё секретный текст",
        lineKind: "PAYMENT",
        text: "строка",
        validatorRejection: null,
      },
    ],
    extractionCalls: true,
  });
  assert.equal(log.event, "NAVIGATOR_INTENT_PLAN_RECOVERY");
  assert.equal(log.originalAct, "COURSE_CONTENT");
  assert.equal(log.disposition, "RECOVERED_COMPOSED");
  assert.equal(log.activeTaskCount, 2);
  assert.deepEqual(log.segmentActStates, ["COURSE_FOLLOW_UP"]);
  assert.deepEqual(log.courseIds, ["maslow"]);
  assert.equal(log.extractionCalls, 1);
  const serialized = JSON.stringify(log);
  assert.equal(serialized.includes("секретный текст"), false);
  assert.equal(serialized.includes("ещё секретный текст"), false);
  // Problem codes are sanitized to their closed prefixes.
  const rejected = createIntentPlanRecoveryLog("req", {
    disposition: "PLAN_REJECTED",
    problems: ["TASK_TYPE:вражеский_текст"],
  });
  assert.equal(rejected.reasonCode, "TASK_TYPE");
  assert.equal(JSON.stringify(rejected).includes("вражеский"), false);
  const unknownCode = createIntentPlanRecoveryLog("req", {
    disposition: "PAYMENT_COMPOSITION_VETO",
    reasonCode: "not a safe code!",
  });
  assert.equal(unknownCode.reasonCode, null);
});

// FINAL-IMPLEMENTATION-1: the wrapper owns settlement and observes late errors.
test("noncooperative extraction is actually bounded and receives a joined aborted signal", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(extractTaskPlan(L2_MESSAGES, { timeoutMs: 10 }, async (_messages, options) => {
    signal = options.signal;
    return new Promise(() => {});
  }), (error: unknown) => error instanceof DeepSeekClientError && error.code === "ABORTED");
  assert.equal(signal?.aborted, true);
});

test("pre-abort performs no extraction; mid-extraction abort settles even when ignored", async () => {
  const pre = new AbortController(); pre.abort(); let calls = 0;
  await assert.rejects(extractTaskPlan(L2_MESSAGES, { signal: pre.signal }, async () => { calls += 1; return {}; }));
  assert.equal(calls, 0);
  const active = new AbortController();
  const running = extractTaskPlan(L2_MESSAGES, { signal: active.signal }, async () => { calls += 1; return new Promise(() => {}); });
  await Promise.resolve(); active.abort();
  await assert.rejects(running, (error: unknown) => error instanceof DeepSeekClientError && error.code === "ABORTED");
  assert.equal(calls, 1);
});

test("late rejected dependency remains handled after the deadline", async () => {
  const unhandled: unknown[] = [];
  const sink = (error: unknown) => { unhandled.push(error); };
  process.on("unhandledRejection", sink);
  try {
    await assert.rejects(extractTaskPlan(L2_MESSAGES, { timeoutMs: 5 }, async () => {
      return new Promise((_resolve, reject) => setTimeout(() => reject(new Error("late dependency failure")), 20));
    }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(unhandled, []);
  } finally { process.off("unhandledRejection", sink); }
});

test("extraction timeout cannot be increased beyond the recovery bound", async () => {
  let seen = 0;
  await extractTaskPlan(L2_MESSAGES, { timeoutMs: 60_000 }, async (_messages, options) => { seen = options.timeoutMs!; return {}; });
  assert.equal(seen, PLAN_RECOVERY_TIMEOUT_MS);
  await assert.rejects(extractTaskPlan(L2_MESSAGES, { timeoutMs: -1 }, async () => ({})));
});


test("empty handler output becomes a failed segment rather than phantom coverage", async () => {
  const result = await attemptIntentPlanRecovery({
    messages: F1_MESSAGES, extractionOptions: {}, extraction: async () => S09_PLAN,
    dispatchSegment: async () => okDispatch({ message: "  " }),
  });
  assert.ok("dispatchResults" in result);
  assert.deepEqual(result.dispatchResults, [null, null]);
});
