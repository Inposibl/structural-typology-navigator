/**
 * NAVIGATOR-INTENT-RECOVERY-ARM-B.IMPLEMENTATION-1 — deterministic outcome
 * accounting tests. The coverage guarantee is enforced here as a hard
 * invariant; the non-claim about extraction completeness is pinned as an
 * explicit constant.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  COVERAGE_GUARANTEE,
  COVERAGE_NON_CLAIM,
  accountTaskOutcomes,
  createTaskCoverageLog,
  assembleTaskResponse,
  isLimitationOutcome,
  outcomeForAnswerOrigin,
  outcomeForTask,
} from "../../src/lib/navigation/response-coverage.ts";

test("accounting enforces exactly one outcome per ACTIVE task", () => {
  const record = accountTaskOutcomes(["EDU", "PRICE"], [
    { taskIndex: 0, taskType: "EDU", outcome: "ANSWERED_FROM_EVIDENCE", reasonCode: "RAG_EVIDENCE" },
    { taskIndex: 1, taskType: "PRICE", outcome: "ANSWERED_FROM_AUTHORITY", reasonCode: "CATALOG_OR_COMMERCIAL_AUTHORITY" },
  ]);
  assert.equal(record.activeTaskCount, 2);
  assert.equal(record.limitationCount, 0);
  assert.equal(record.allTasksAccounted, true);
  assert.equal(record.outcomes.length, 2);
});

test("accounting throws on a missing, duplicated, or mistyped outcome", () => {
  assert.throws(() =>
    accountTaskOutcomes(["EDU", "PRICE"], [
      { taskIndex: 0, taskType: "EDU", outcome: "ANSWERED_FROM_EVIDENCE", reasonCode: "RAG_EVIDENCE" },
    ]),
  );
  assert.throws(() =>
    accountTaskOutcomes(["EDU"], [
      { taskIndex: 0, taskType: "EDU", outcome: "ANSWERED_FROM_EVIDENCE", reasonCode: "RAG_EVIDENCE" },
      { taskIndex: 0, taskType: "EDU", outcome: "ANSWERED_FROM_EVIDENCE", reasonCode: "RAG_EVIDENCE" },
    ]),
  );
  assert.throws(() =>
    accountTaskOutcomes(["EDU"], [
      { taskIndex: 0, taskType: "PRICE", outcome: "ANSWERED_FROM_AUTHORITY", reasonCode: "CATALOG_OR_COMMERCIAL_AUTHORITY" },
    ]),
  );
  assert.throws(() =>
    accountTaskOutcomes(["EDU"], [
      { taskIndex: 7, taskType: "EDU", outcome: "ANSWERED_FROM_EVIDENCE", reasonCode: "RAG_EVIDENCE" },
    ]),
  );
});

test("outcome mapping covers the closed answer-origin set", () => {
  assert.deepEqual(outcomeForAnswerOrigin("RAG_EVIDENCE"), {
    outcome: "ANSWERED_FROM_EVIDENCE",
    reasonCode: "RAG_EVIDENCE",
  });
  assert.equal(outcomeForAnswerOrigin("CATALOG_AUTHORITY").outcome, "ANSWERED_FROM_AUTHORITY");
  assert.equal(outcomeForAnswerOrigin("COMMERCIAL_AUTHORITY").outcome, "ANSWERED_FROM_AUTHORITY");
  assert.equal(outcomeForAnswerOrigin("FACTUAL_CEILING").outcome, "LIMITED_BY_FACTUAL_CEILING");
  assert.equal(outcomeForAnswerOrigin("OUT_OF_SCOPE").outcome, "LEGITIMATELY_UNRESOLVED");
  assert.equal(outcomeForAnswerOrigin("PAYMENT_POLICY").outcome, "NOT_SAFELY_EXECUTABLE");
  assert.equal(outcomeForAnswerOrigin("CONTACT_POLICY").outcome, "NOT_SAFELY_EXECUTABLE");
  assert.equal(outcomeForAnswerOrigin("DETERMINISTIC_CONTROL").outcome, "NOT_SAFELY_EXECUTABLE");
});

test("limitation counting and duplicate detection behave deterministically", () => {
  assert.equal(isLimitationOutcome("ANSWERED_FROM_EVIDENCE"), false);
  assert.equal(isLimitationOutcome("ANSWERED_FROM_AUTHORITY"), false);
  assert.equal(isLimitationOutcome("LIMITED_BY_FACTUAL_CEILING"), true);
  assert.equal(isLimitationOutcome("LEGITIMATELY_UNRESOLVED"), true);
  assert.equal(isLimitationOutcome("NOT_SAFELY_EXECUTABLE"), true);

  const shared = assembleTaskResponse([0, 1, 2, 3].map((taskIndex) => ({
    taskIndices: [taskIndex], courseIds: ["maslow"], comparison: false,
    answerOrigin: "CATALOG_AUTHORITY" as const,
    outcomeKinds: ["ANSWERED_FROM_AUTHORITY" as const], text: "Supported shared answer",
  })));
  assert.equal(shared.message, "Supported shared answer");
  assert.deepEqual(shared.blocks[0].taskIndices, [0, 1, 2, 3]);
});

test("coverage log carries only bounded counts", () => {
  const log = createTaskCoverageLog("req-1", {
    activeTaskCount: 2,
    outcomes: [],
    limitationCount: 1,
    allTasksAccounted: true,
  });
  assert.deepEqual(log, {
    event: "NAVIGATOR_INTENT_PLAN_COVERAGE",
    requestId: "req-1",
    activeTaskCount: 2,
    limitationCount: 1,
    allTasksAccounted: true,
  });
});

test("the coverage guarantee and its explicit non-claim are stated", () => {
  assert.match(COVERAGE_GUARANTEE, /every ACTIVE task/i);
  assert.match(COVERAGE_NON_CLAIM, /UNKNOWN/);
});

// FINAL-IMPLEMENTATION-1: factual outcomes are task-specific, not text-string scores.
test("supported price and unavailable cohort have separate attributed outcomes", () => {
  const price = { type: "PRICE" as const, courseIds: ["maslow"], role: "ACTIVE" as const, evidence: "Сколько стоит курс" };
  const cohort = { type: "COHORT" as const, courseIds: ["maslow"], role: "ACTIVE" as const, evidence: "Когда ближайший поток" };
  const tasks = [price, cohort];
  const entries = tasks.map((task, taskIndex) => outcomeForTask({ task, taskIndex, selectedCourseId: null, observation: { answerOrigin: "COMMERCIAL_AUTHORITY" } }));
  const record = accountTaskOutcomes(tasks, entries);
  assert.equal(record.limitationCount, 1);
  assert.deepEqual(record.outcomes.map((outcome) => outcome.outcome), ["ANSWERED_FROM_AUTHORITY", "LIMITED_BY_FACTUAL_CEILING"]);
  assert.deepEqual(record.outcomes.map((outcome) => outcome.taskId), ["task-1", "task-2"]);
  assert.equal(record.outcomes[0].facts?.[0].status, "SUPPORTED");
  assert.equal(record.outcomes[1].facts?.[0].status, "UNAVAILABLE");
  assert.deepEqual(record.outcomes[1].courseIds, ["maslow"]);
});

test("missing schedule/window and partially priced course set remain limitations", () => {
  for (const type of ["SCHEDULE", "ENROLLMENT_WINDOW"] as const) {
    const task = { type, courseIds: ["maslow"], role: "ACTIVE" as const, evidence: "Сведения о занятиях" };
    const outcome = outcomeForTask({ task, taskIndex: 0, selectedCourseId: null, observation: { answerOrigin: "COMMERCIAL_AUTHORITY" } });
    assert.equal(outcome.outcome, "LIMITED_BY_FACTUAL_CEILING");
    assert.equal(outcome.reasonCode, "MISSING_AUTHORITATIVE_FIELD");
  }
  const task = { type: "PRICE" as const, courseIds: ["maslow", "professional-development-stages"], role: "ACTIVE" as const, evidence: "Цена этих двух курсов" };
  const outcome = outcomeForTask({ task, taskIndex: 0, selectedCourseId: null, observation: { answerOrigin: "COMMERCIAL_AUTHORITY" } });
  assert.equal(outcome.outcome, "LIMITED_BY_FACTUAL_CEILING");
  assert.deepEqual(outcome.facts?.map((fact) => fact.status), ["SUPPORTED", "UNAVAILABLE"]);
});

test("descriptor accounting rejects wrong task attribution and contradictory support", () => {
  const task = { type: "PRICE" as const, courseIds: ["maslow"], role: "ACTIVE" as const, evidence: "Цена курса Маслоу" };
  const outcome = outcomeForTask({ task, taskIndex: 0, selectedCourseId: null, observation: { answerOrigin: "COMMERCIAL_AUTHORITY" } });
  assert.throws(() => accountTaskOutcomes([task], [{ ...outcome, courseIds: ["levels-of-consciousness"] }]));
  assert.throws(() => accountTaskOutcomes([task], [{ ...outcome, taskId: "task-2" }]));
  assert.throws(() => accountTaskOutcomes([task], [{ ...outcome, evidenceSpan: "Другая просьба" }]));
  assert.throws(() => accountTaskOutcomes([task], [{ ...outcome, taskIndex: NaN }]));
  assert.throws(() => accountTaskOutcomes([task], [{ ...outcome, facts: [{ courseId: "maslow", field: "PRICE", status: "UNAVAILABLE", authorityVersion: "test" }] }]));
});

test("paragraph sharing preserves overlap and does not merge different course authority", () => {
  const piece = { courseIds: ["maslow"], comparison: false, answerOrigin: "CATALOG_AUTHORITY" as const, outcomeKinds: ["ANSWERED_FROM_AUTHORITY" as const] };
  const joined = assembleTaskResponse([
    { ...piece, taskIndices: [0], text: "Шесть встреч.\n\nОбщие подтверждённые результаты." },
    { ...piece, taskIndices: [1], text: "Ссылка на курс.\n\nОбщие подтверждённые результаты." },
  ]);
  assert.equal(joined.message.split("Общие подтверждённые результаты.").length - 1, 1);
  assert.deepEqual(joined.blocks.find((block) => block.text.startsWith("Общие"))?.taskIndices, [0, 1]);
  const different = assembleTaskResponse([
    { ...piece, taskIndices: [0], text: "Одинаковая фраза." },
    { ...piece, courseIds: ["levels-of-consciousness"], taskIndices: [1], text: "Одинаковая фраза." },
  ]);
  assert.equal(different.blocks.length, 2);
  assert.match(different.message, /Иерархия уровней сознания/);
  assert.match(different.message, /Иерархия потребностей/);
});
