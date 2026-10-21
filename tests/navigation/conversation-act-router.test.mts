import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { ConversationMessage } from "../../src/lib/chat-contract.ts";
import { getAcademyCourse } from "../../src/lib/academy/course-catalog.ts";
import {
  routeConversationAct,
  validateConversationActDecision,
} from "../../src/lib/navigation/conversation-act-router.ts";

const history = [
  {
    role: "user" as const,
    content: "Хочу понять мотивацию команды.",
  },
  {
    role: "assistant" as const,
    content:
      "В текущем каталоге Академии ей соответствует курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow.",
  },
];

test("conversation-act classifier gives the latest user turn decisive priority", async () => {
  const messages = [
    ...history,
    {
      role: "user" as const,
      content: "Какая самая известная дизайн студия в Москве?",
    },
  ];

  let captured:
    | readonly { role: string; content: string }[]
    | undefined;

  const result = await routeConversationAct(messages, {
    callJson: async (requestMessages) => {
      captured = requestMessages;
      return { state: "OUT_OF_SCOPE" };
    },
  });

  assert.deepEqual(result, { state: "OUT_OF_SCOPE" });
  assert.ok(captured);

  const systemPrompt = captured[0]?.content ?? "";
  assert.ok(
    systemPrompt.includes(
      "последняя USER-реплика имеет решающий приоритет",
    ),
  );
  assert.ok(
    systemPrompt.includes(
      "НЕ имеет права перетянуть новую несвязанную реплику обратно в прежний курс",
    ),
  );

  const request = captured[1]?.content ?? "";
  assert.match(request, /Какая самая известная дизайн студия в Москве/u);
  assert.match(
    request,
    /Иерархия потребностей А\. Маслоу: новая парадигма/u,
  );
});

test("course follow-up must bind to a course that actually appeared in the conversation", () => {
  const messages = [
    ...history,
    {
      role: "user" as const,
      content: "Почему именно этот курс?",
    },
  ];

  assert.deepEqual(
    validateConversationActDecision(
      {
        state: "COURSE_FOLLOW_UP",
        courseId: "maslow",
        evidenceRequested: false,
      },
      messages,
    ),
    {
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: false,
    },
  );

  assert.throws(
    () =>
      validateConversationActDecision(
        {
          state: "COURSE_FOLLOW_UP",
          courseId: "normative-situation",
          evidenceRequested: false,
        },
        messages,
      ),
    /absent from the conversation/u,
  );
});

test("raw evidence is opt-in only for explicit source requests", async () => {
  const messages = [
    ...history,
    {
      role: "user" as const,
      content: "Покажи, откуда именно это взято и на какой странице.",
    },
  ];

  const result = await routeConversationAct(messages, {
    callJson: async () => ({
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: true,
    }),
  });

  assert.deepEqual(result, {
    state: "COURSE_FOLLOW_UP",
    courseId: "maslow",
    evidenceRequested: true,
  });
});

/* ---------------------------------------------------------------------------
 * NAVIGATOR-ACT-ROUTER-ALIAS-CORRECTION-1.PRODUCTION-IMPLEMENTATION-1
 *
 * Validator-level contract of the Owner-accepted CORR5 design under the frozen
 * P1–P8 policy. Fixtures are the exact retained inputs of the original incident
 * (R1–R7), the CORR5 author focused run (CORR4.IV1 M1/M2/M3 counterexamples,
 * Codex's own controls, limitations, author pairs) and the CORR5.IV1 audit
 * witnesses. Expected values are the RECORDED spec/audit outcomes, not values
 * recomputed by this implementation.
 * ------------------------------------------------------------------------ */

type Decision = Record<string, unknown>;
type FocusedCase = {
  id: string;
  group: string;
  messages: ConversationMessage[];
  decision: Decision;
  expected: string;
  rule: string | null;
};
type WitnessCase = {
  id: string;
  family: string;
  messages: ConversationMessage[];
  decision: Decision;
  expected: Record<string, unknown>;
  retrieved: string[];
};
type MismatchCase = {
  id: string;
  messages: ConversationMessage[];
  decision: Decision;
  corr4Reason: string;
  expected: Record<string, unknown>;
};
type ROutcome = {
  id: string;
  history: string;
  input: Decision;
  recorded: { accepted: boolean; errorMessage?: string; returned?: unknown; [field: string]: unknown };
};

/** The same tag format the CORR5 author run recorded. */
function validatorTag(decision: Decision, messages: readonly ConversationMessage[]): string {
  try {
    const value = validateConversationActDecision(structuredClone(decision), messages);
    return value.state === "COURSE_REFERENCE_UNRESOLVED"
      ? `UNRESOLVED:${value.reason}`
      : `ACCEPT:${value.state}`;
  } catch (error) {
    return `REJECT:${String((error as Error).message).slice(0, 60)}`;
  }
}

function validated(decision: Decision, messages: readonly ConversationMessage[]) {
  return validateConversationActDecision(structuredClone(decision), messages);
}

// Source: CORR5 author focused run attempt-01 results.json sha256 1d77bba09b4f2c15502e11c59e6808ab066d8efedcfcf8aa47907ffedc07ef95
// expected = the recorded CORR5 spec validator tag (REJECT messages truncated to 60 chars as recorded).
const CORR5_FOCUSED: ReadonlyArray<FocusedCase> = [
  {"id": "C-colon", "group": "M1", "messages": [{"role": "user", "content": "На курсе английского обсуждали уровни сознания: А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-comma", "group": "M1", "messages": [{"role": "user", "content": "На курсе английского обсуждали уровни сознания, А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-dash", "group": "M1", "messages": [{"role": "user", "content": "На курсе английского обсуждали уровни сознания — А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-parenthesis", "group": "M1", "messages": [{"role": "user", "content": "(На курсе английского обсуждали уровни сознания.) А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-parenthesis-colon", "group": "M1", "messages": [{"role": "user", "content": "(Я обсуждал курс английского): А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "sentence-boundary-7", "group": "M1", "messages": [{"role": "user", "content": "(На курсе английского обсуждали уровни сознания.) А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "sentence-boundary-8", "group": "M1", "messages": [{"role": "user", "content": "«На курсе английского обсуждали уровни сознания.» А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-abbr-tail", "group": "M1", "messages": [{"role": "user", "content": "На курсе английского были уровни сознания и т. д. А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-abbr-mixed", "group": "M1", "messages": [{"role": "user", "content": "На курсе английского обсуждали уровни сознания, etc. А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-q-repeated", "group": "M1", "messages": [{"role": "user", "content": "На курсе английского задали вопрос «Что такое архетип Тени?»; сейчас отдельно спрашиваю: Что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое архетип Тени?"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-repeat-two-effective-occurrences", "group": "M1", "messages": [{"role": "user", "content": "На курсе английского задали вопрос «Что такое архетип Тени»; сейчас отдельно спрашиваю: Что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "A2-1-normative-situation", "group": "M2", "messages": [{"role": "user", "content": "Расскажите про программу по астрологии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про программу по астрологии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-1-maslow", "group": "M2", "messages": [{"role": "user", "content": "Расскажите про программу по астрологии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про программу по астрологии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-2-normative-situation", "group": "M2", "messages": [{"role": "user", "content": "Расскажите про программу алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про программу алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-2-maslow", "group": "M2", "messages": [{"role": "user", "content": "Расскажите про программу алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про программу алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-3-normative-situation", "group": "M2", "messages": [{"role": "user", "content": "What do they teach in the alchemy class"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "What do they teach in the alchemy class"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-3-maslow", "group": "M2", "messages": [{"role": "user", "content": "What do they teach in the alchemy class"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "What do they teach in the alchemy class"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-4-normative-situation", "group": "M2", "messages": [{"role": "user", "content": "Что в программе обучения по алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что в программе обучения по алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-4-maslow", "group": "M2", "messages": [{"role": "user", "content": "Что в программе обучения по алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что в программе обучения по алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-6-normative-situation", "group": "M2", "messages": [{"role": "user", "content": "Tell me about the alchemy program"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Tell me about the alchemy program"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-6-maslow", "group": "M2", "messages": [{"role": "user", "content": "Tell me about the alchemy program"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Tell me about the alchemy program"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-9-normative-situation", "group": "M2", "messages": [{"role": "user", "content": "Что изучают на классе алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на классе алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-9-maslow", "group": "M2", "messages": [{"role": "user", "content": "Что изучают на классе алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на классе алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-10-normative-situation", "group": "M2", "messages": [{"role": "user", "content": "Что изучают в обучении алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают в обучении алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-10-maslow", "group": "M2", "messages": [{"role": "user", "content": "Что изучают в обучении алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают в обучении алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-11-normative-situation", "group": "M2", "messages": [{"role": "user", "content": "Что изучают на cоurse алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на cоurse алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-11-maslow", "group": "M2", "messages": [{"role": "user", "content": "Что изучают на cоurse алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на cоurse алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-12-normative-situation", "group": "M2", "messages": [{"role": "user", "content": "Что изучают на курcе алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курcе алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-12-maslow", "group": "M2", "messages": [{"role": "user", "content": "Что изучают на курcе алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курcе алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-13-normative-situation", "group": "M2", "messages": [{"role": "user", "content": "Что изучают в курсовой программе алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают в курсовой программе алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-13-maslow", "group": "M2", "messages": [{"role": "user", "content": "Что изучают в курсовой программе алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают в курсовой программе алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "anchor-any-course-structural-typology", "group": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень и как там её объясняют"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и как там её объясняют"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "anchor-any-course-maslow", "group": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень и как там её объясняют"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и как там её объясняют"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "anchor-any-course-levels-of-consciousness", "group": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень и как там её объясняют"}], "decision": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и как там её объясняют"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "anchor-any-course-play-and-creativity", "group": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень и как там её объясняют"}], "decision": {"state": "COURSE_CONTENT", "courseId": "play-and-creativity", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и как там её объясняют"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "anchor-any-course-normative-situation", "group": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень и как там её объясняют"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и как там её объясняют"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "A2-history-228", "group": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень и как там её объясняют"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и как там её объясняют"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "A2-history-229", "group": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Как теория Маслоу объясняется там"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Как теория Маслоу объясняется там"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "A2-history-230", "group": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Как архетип Тени объясняют в нём"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как архетип Тени объясняют в нём"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "A2-history-231", "group": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Как Маслоу связан с этим"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Как Маслоу связан с этим"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "C8-topic-is-not-reference", "group": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что там говорят о Маслоу"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что там говорят о Маслоу"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "A2-25-normative-situation", "group": "M3", "messages": [{"role": "user", "content": "Что на курсе Маслоу говорят о нормативной ситуации"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что на курсе Маслоу говорят о нормативной ситуации"}, "expected": "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES", "rule": "C3"},
  {"id": "A2-26-levels-of-consciousness", "group": "M3", "messages": [{"role": "user", "content": "Что на курсе Маслоу говорят об уровнях сознания"}], "decision": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Что на курсе Маслоу говорят об уровнях сознания"}, "expected": "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES", "rule": "C3"},
  {"id": "C3-explicit-excluded-topic", "group": "M3", "messages": [{"role": "user", "content": "Что на курсе Маслоу говорят об уровнях сознания? Не отвечайте по другому курсу"}], "decision": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Что на курсе Маслоу говорят об уровнях сознания?"}, "expected": "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES", "rule": "C3"},
  {"id": "C-pronoun-155", "group": "LIMITATION", "messages": [{"role": "user", "content": "Прохожу курс английского."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое эмпатия и как её развить"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое эмпатия и как её развить"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "C-pronoun-156", "group": "LIMITATION", "messages": [{"role": "user", "content": "Прохожу курс английского."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Как понять свой тип личности и как его развивать"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как понять свой тип личности и как его развивать"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "sentence-boundary-9", "group": "LIMITATION", "messages": [{"role": "user", "content": "На курсе английского обсуждали уровни сознания А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "sentence-boundary-10", "group": "LIMITATION", "messages": [{"role": "user", "content": "На курсе английского обсуждали уровни сознания А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "C-owner-dot", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "На курсе английского обсуждали уровни сознания. А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-semicolon", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "На курсе английского обсуждали уровни сознания; А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-newline", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "На курсе английского обсуждали уровни сознания\nА что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-quoted", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Друг сказал: «Прохожу курс английского». А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-unknown", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Я прошёл курс алхимии. А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-known-alias", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Я прошёл курс Маслоу. А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-abbr-im", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "На курсе английского в школе им. А. Х. Джонсона обсуждали уровни сознания. А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-abbr-te", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "На курсе английского обсуждали уровни сознания, т. е. их классификацию. А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-course-after", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "А что такое архетип Тени? До этого я проходил курс английского"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени?"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-fragments", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Курс английского.\nАрхетип Тени — что это"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Архетип Тени — что это"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C7-intra-sentence-reference"},
  {"id": "C-quote-reference", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "«Курс английского» — это чужое объявление. А что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "А что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-history-154", "group": "CODEX_CONTROL", "messages": [{"role": "assistant", "content": "Рекомендую курс про Маслоу."}, {"role": "user", "content": "Что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "C-pronoun-157", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Прохожу курс английского."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что означает бессознательное для человека"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что означает бессознательное для человека"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "A2-0-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-0-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-5-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "What do they teach in the alchemy course"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "What do they teach in the alchemy course"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-5-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "What do they teach in the alchemy course"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "What do they teach in the alchemy course"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-7-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на программе по алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на программе по алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-7-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на программе по алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на программе по алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-8-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на программе алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на программе алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-8-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на программе алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на программе алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-14-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите о курсах алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите о курсах алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-14-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите о курсах алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Расскажите о курсах алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-15-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на программе про алхимию"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на программе про алхимию"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-15-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на программе про алхимию"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на программе про алхимию"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-16-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "What is taught in the program about alchemy"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "What is taught in the program about alchemy"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-16-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "What is taught in the program about alchemy"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "What is taught in the program about alchemy"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-17-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс «Маслоу и алхимия»"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс «Маслоу и алхимия»"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-17-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс «Маслоу и алхимия»"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс «Маслоу и алхимия»"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-18-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс Маслоу и алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс Маслоу и алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-18-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс Маслоу и алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс Маслоу и алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-19-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс Маслоу и другую программу алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс Маслоу и другую программу алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-19-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс Маслоу и другую программу алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс Маслоу и другую программу алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-20-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс Маслоу и курс Гарварда"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс Маслоу и курс Гарварда"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-20-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс Маслоу и курс Гарварда"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс Маслоу и курс Гарварда"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-21-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс Маслоу и стадии профессионального развития"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс Маслоу и стадии профессионального развития"}, "expected": "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES", "rule": "C3"},
  {"id": "A2-22-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Сравните Маслоу и уровни сознания"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Сравните Маслоу и уровни сознания"}, "expected": "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_SUBJECTS", "rule": "C4"},
  {"id": "A2-23-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе им. А. Х. Маслоу"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе им. А. Х. Маслоу"}, "expected": "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES", "rule": "C3"},
  {"id": "A2-23-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе им. А. Х. Маслоу"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе им. А. Х. Маслоу"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C3-member"},
  {"id": "A2-24-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе про Маслоу в институте Эврика"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе про Маслоу в институте Эврика"}, "expected": "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES", "rule": "C3"},
  {"id": "A2-24-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе про Маслоу в институте Эврика"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе про Маслоу в институте Эврика"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C3-member"},
  {"id": "A2-27-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Расскажите про курс Маслоу; уровни сознания я не выбираю"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс Маслоу; уровни сознания я не выбираю"}, "expected": "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES", "rule": "C3"},
  {"id": "A2-28-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе Академии по алхи"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе Академии по алхи"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-28-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе Академии по алхи"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе Академии по алхи"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-29-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе «алхимия»"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе «алхимия»"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-29-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе «алхимия»"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе «алхимия»"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-30-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Если бы я выбрал курс алхимии, что бы там изучал"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Если бы я выбрал курс алхимии, что бы там изучал"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-30-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Если бы я выбрал курс алхимии, что бы там изучал"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Если бы я выбрал курс алхимии, что бы там изучал"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-31-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе https://foreign.edu/courses/alchemy"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе https://foreign.edu/courses/alchemy"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-31-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе https://foreign.edu/courses/alchemy"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе https://foreign.edu/courses/alchemy"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-32-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе HTTP://STRUCTURAL-TYPOLOGY.ACADEMY:80/courses/maslow"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе HTTP://STRUCTURAL-TYPOLOGY.ACADEMY:80/courses/maslow"}, "expected": "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES", "rule": "C3"},
  {"id": "A2-32-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе HTTP://STRUCTURAL-TYPOLOGY.ACADEMY:80/courses/maslow"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе HTTP://STRUCTURAL-TYPOLOGY.ACADEMY:80/courses/maslow"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C3-member"},
  {"id": "A2-33-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе HTTPS://STRUCTURAL-TYPOLOGY.ACADEMY:444/courses/maslow"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе HTTPS://STRUCTURAL-TYPOLOGY.ACADEMY:444/courses/maslow"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-33-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе HTTPS://STRUCTURAL-TYPOLOGY.ACADEMY:444/courses/maslow"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе HTTPS://STRUCTURAL-TYPOLOGY.ACADEMY:444/courses/maslow"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "A2-34-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе https://structural-typology.academy/courses/maslow"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе https://structural-typology.academy/courses/maslow"}, "expected": "REJECT:COURSE_CONTENT cannot be used once a catalog course is prese", "rule": null},
  {"id": "A2-34-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе https://structural-typology.academy/courses/maslow"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе https://structural-typology.academy/courses/maslow"}, "expected": "REJECT:COURSE_CONTENT cannot be used once a catalog course is prese", "rule": null},
  {"id": "A2-35-normative-situation", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе https://structural-typology.academy/courses/maslow-extra"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе https://structural-typology.academy/courses/maslow-extra"}, "expected": "REJECT:COURSE_CONTENT cannot be used once a catalog course is prese", "rule": null},
  {"id": "A2-35-maslow", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Что изучают на курсе https://structural-typology.academy/courses/maslow-extra"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что изучают на курсе https://structural-typology.academy/courses/maslow-extra"}, "expected": "REJECT:COURSE_CONTENT cannot be used once a catalog course is prese", "rule": null},
  {"id": "A2-history-232", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Как это устроено"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как это устроено"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "A2-history-233", "group": "CODEX_CONTROL", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что из этого полезно"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что из этого полезно"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "P-indep-after-unknown", "group": "AUTHOR+", "messages": [{"role": "user", "content": "Прохожу курс алхимии"}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "P-bare-pronoun-anchor", "group": "AUTHOR+", "messages": [{"role": "user", "content": "Прохожу курс алхимии"}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень и как её понять"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и как её понять"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C7-intra-sentence-reference"},
  {"id": "P-C3-requested-course", "group": "AUTHOR+", "messages": [{"role": "user", "content": "Что на курсе Маслоу говорят о нормативной ситуации"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что на курсе Маслоу говорят о нормативной ситуации"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C3-member"},
  {"id": "P-C3-list-member", "group": "AUTHOR+", "messages": [{"role": "user", "content": "Расскажите про курс Маслоу и уровни сознания"}], "decision": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про курс Маслоу и уровни сознания"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C3-member"},
  {"id": "P-C9-resolved-there", "group": "AUTHOR+", "messages": [{"role": "user", "content": "Прохожу курс Маслоу"}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что там говорят о самоактуализации"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что там говорят о самоактуализации"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C9-antecedent-member"},
  {"id": "P-program-alias", "group": "AUTHOR+", "messages": [{"role": "user", "content": "Расскажите про программу Маслоу"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Расскажите про программу Маслоу"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C3-member"},
  {"id": "P-detached-comma-maslow-prior", "group": "AUTHOR+", "messages": [{"role": "user", "content": "Я прошёл курс Маслоу, а что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "а что такое архетип Тени"}, "expected": "ACCEPT:COURSE_CONTENT", "rule": "C5-independent"},
  {"id": "N-comma-frame-no-predicate", "group": "AUTHOR-", "messages": [{"role": "user", "content": "На курсе алхимии, что такое Тень"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "что такое Тень"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "N-comma-frame-a-no-predicate", "group": "AUTHOR-", "messages": [{"role": "user", "content": "На курсе алхимии, а что такое Тень"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "а что такое Тень"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "N-complement-clause", "group": "AUTHOR-", "messages": [{"role": "user", "content": "На курсе алхимии обсуждали, что такое Тень"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "что такое Тень"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "N-course-after-detached", "group": "AUTHOR-", "messages": [{"role": "user", "content": "Обсуждали уровни сознания, а что такое Тень на курсе алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "а что такое Тень на курсе алхимии"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "N-only-quoted-occurrence", "group": "AUTHOR-", "messages": [{"role": "user", "content": "На курсе алхимии спросили «что такое Тень»"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "что такое Тень"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "N-te-interior", "group": "AUTHOR-", "messages": [{"role": "user", "content": "Что изучают на курсе алхимии, т. е. что такое Тень"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "что такое Тень"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "N-C8-container-resolved-ant", "group": "AUTHOR-", "messages": [{"role": "user", "content": "Прохожу курс уровней сознания"}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что там говорят о Маслоу"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что там говорят о Маслоу"}, "expected": "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED", "rule": "C11"},
  {"id": "N-the-alchemy-course-after-maslow", "group": "AUTHOR-", "messages": [{"role": "user", "content": "I take the Maslow course"}, {"role": "assistant", "content": "OK."}, {"role": "user", "content": "What do they teach in the alchemy course"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "What do they teach in the alchemy course"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "COST-in-adult-education", "group": "COST", "messages": [{"role": "user", "content": "Как применяется типология в обучении взрослых"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как применяется типология в обучении взрослых"}, "expected": "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "rule": "C1"},
  {"id": "COST-cross-preposition-comparison", "group": "COST", "messages": [{"role": "user", "content": "Сравните курс Маслоу с уровнями сознания"}], "decision": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Сравните курс Маслоу с уровнями сознания"}, "expected": "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES", "rule": "C3"},
];

// Source: CORR5.IV1 targeted-commercial-results.json sha256 fd2945d2421f44eeaa73c36c9defab40f33a376f31f72a6ba307c4fd185b8559
// expected = Codex's recorded CORR5 API validation of the effective message (accepted residual behaviour).
const CORR5_IV1_WITNESSES: ReadonlyArray<WitnessCase> = [
  {"id": "M1-course-asked-colon", "family": "M1", "messages": [{"role": "user", "content": "На курсе алхимии спросили: а что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "а что такое архетип Тени"}, "expected": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "а что такое архетип Тени"}, "retrieved": ["structural-typology"]},
  {"id": "M1-course-discussed-colon", "family": "M1", "messages": [{"role": "user", "content": "На курсе алхимии обсуждали: а что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "а что такое архетип Тени"}, "expected": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "а что такое архетип Тени"}, "retrieved": ["structural-typology"]},
  {"id": "M1-course-theme-colon", "family": "M1", "messages": [{"role": "user", "content": "На курсе алхимии была тема: а что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "а что такое архетип Тени"}, "expected": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "а что такое архетип Тени"}, "retrieved": ["structural-typology"]},
  {"id": "M1-independent-present", "family": "M1", "messages": [{"role": "user", "content": "На курсе английского обсуждают уровни сознания: а что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "а что такое архетип Тени"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "а что такое архетип Тени"}, "reason": "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "referencedCourseIds": []}, "retrieved": []},
  {"id": "M1-independent-no-conj", "family": "M1", "messages": [{"role": "user", "content": "На курсе английского обсуждали уровни сознания: Что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое архетип Тени"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое архетип Тени"}, "reason": "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "referencedCourseIds": []}, "retrieved": []},
  {"id": "M1-independent-short", "family": "M1", "messages": [{"role": "user", "content": "Прохожу курс английского. Что такое архетип Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое архетип Тени"}, "expected": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое архетип Тени"}, "retrieved": ["structural-typology"]},
  {"id": "M1-reported-plus-sign", "family": "M1", "messages": [{"role": "user", "content": "На курсе алхимии задали вопрос «Что такое Тень?»; на доске записали: Что такое Тень"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень?"}, "expected": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень?"}, "retrieved": ["structural-typology"]},
  {"id": "M1-quoted-independent", "family": "M1", "messages": [{"role": "user", "content": "На курсе алхимии спросили «Что такое Тень?»; сейчас я отдельно спрашиваю: Что такое Тень"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень?"}, "expected": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень?"}, "retrieved": ["structural-typology"]},
  {"id": "M2-adult-learning", "family": "M2", "messages": [{"role": "user", "content": "Как применяется типология в обучении взрослых"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как применяется типология в обучении взрослых"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как применяется типология в обучении взрослых"}, "reason": "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "referencedCourseIds": []}, "retrieved": []},
  {"id": "M2-children-learning", "family": "M2", "messages": [{"role": "user", "content": "Как типология помогает в обучении детей"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как типология помогает в обучении детей"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как типология помогает в обучении детей"}, "reason": "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "referencedCourseIds": []}, "retrieved": []},
  {"id": "M2-study-program", "family": "M2", "messages": [{"role": "user", "content": "Как Тень трактуется в программе исследования сознания"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как Тень трактуется в программе исследования сознания"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как Тень трактуется в программе исследования сознания"}, "reason": "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "referencedCourseIds": []}, "retrieved": []},
  {"id": "M2-school-class", "family": "M2", "messages": [{"role": "user", "content": "Как объяснить архетип Тени в классе взрослых"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как объяснить архетип Тени в классе взрослых"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Как объяснить архетип Тени в классе взрослых"}, "reason": "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "referencedCourseIds": []}, "retrieved": []},
  {"id": "M2-alchemy-an-program", "family": "M2", "messages": [{"role": "user", "content": "Tell me about an alchemy program"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Tell me about an alchemy program"}, "expected": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Tell me about an alchemy program"}, "retrieved": ["normative-situation"]},
  {"id": "M2-alchemy-an-course", "family": "M2", "messages": [{"role": "user", "content": "What does an alchemy course teach"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "What does an alchemy course teach"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "What does an alchemy course teach"}, "reason": "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "referencedCourseIds": []}, "retrieved": []},
  {"id": "M2-alchemy-two-adjectives", "family": "M2", "messages": [{"role": "user", "content": "Расскажите о новой учебной программе алхимии"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите о новой учебной программе алхимии"}, "expected": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Расскажите о новой учебной программе алхимии"}, "retrieved": ["normative-situation"]},
  {"id": "M2-alchemy-the-program", "family": "M2", "messages": [{"role": "user", "content": "Tell me about the alchemy program"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Tell me about the alchemy program"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "Tell me about the alchemy program"}, "reason": "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "referencedCourseIds": []}, "retrieved": []},
  {"id": "M3-maslow-topic-loc", "family": "M3", "messages": [{"role": "user", "content": "Что на курсе Маслоу говорят об уровнях сознания"}], "decision": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Что на курсе Маслоу говорят об уровнях сознания"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Что на курсе Маслоу говорят об уровнях сознания"}, "reason": "CONTENT_OUTSIDE_QUESTION_REFERENCES", "referencedCourseIds": ["maslow"]}, "retrieved": []},
  {"id": "M3-maslow-course", "family": "M3", "messages": [{"role": "user", "content": "Что на курсе Маслоу говорят об уровнях сознания"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что на курсе Маслоу говорят об уровнях сознания"}, "expected": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что на курсе Маслоу говорят об уровнях сознания"}, "retrieved": ["maslow"]},
  {"id": "M3-alchemy-he-price", "family": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень и сколько он стоит"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и сколько он стоит"}, "expected": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и сколько он стоит"}, "retrieved": ["structural-typology"]},
  {"id": "M3-alchemy-he-teaches", "family": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень и чему он учит"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и чему он учит"}, "expected": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и чему он учит"}, "retrieved": ["structural-typology"]},
  {"id": "M3-alchemy-he-duration", "family": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень и сколько он длится"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и сколько он длится"}, "expected": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и сколько он длится"}, "retrieved": ["structural-typology"]},
  {"id": "M3-alchemy-he-starts", "family": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что такое Тень и когда он начинается"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и когда он начинается"}, "expected": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что такое Тень и когда он начинается"}, "retrieved": ["structural-typology"]},
  {"id": "M3-alchemy-there", "family": "M3", "messages": [{"role": "user", "content": "Прохожу курс алхимии."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что там говорят о Маслоу"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что там говорят о Маслоу"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "Что там говорят о Маслоу"}, "reason": "CONTENT_BACK_REFERENCE_UNRESOLVED", "referencedCourseIds": []}, "retrieved": []},
  {"id": "M3-known-there", "family": "M3", "messages": [{"role": "user", "content": "Прохожу курс Маслоу."}, {"role": "assistant", "content": "Понятно."}, {"role": "user", "content": "Что там говорят о Тени"}], "decision": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что там говорят о Тени"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "structural-typology", "evidenceRequested": false, "contentIntentEvidence": "Что там говорят о Тени"}, "reason": "CONTENT_BACK_REFERENCE_UNRESOLVED", "referencedCourseIds": ["maslow"]}, "retrieved": []},
  {"id": "M3-comparison-topic", "family": "M3", "messages": [{"role": "user", "content": "Сравните курс Маслоу с уровнями сознания"}], "decision": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Сравните курс Маслоу с уровнями сознания"}, "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Сравните курс Маслоу с уровнями сознания"}, "reason": "CONTENT_OUTSIDE_QUESTION_REFERENCES", "referencedCourseIds": ["maslow"]}, "retrieved": []},
  {"id": "M3-comparison-two-courses", "family": "M3", "messages": [{"role": "user", "content": "Сравните курс Маслоу с курсом уровней сознания"}], "decision": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Сравните курс Маслоу с курсом уровней сознания"}, "expected": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Сравните курс Маслоу с курсом уровней сознания"}, "retrieved": ["levels-of-consciousness"]},
];

const A2_5_MISMATCH: ReadonlyArray<MismatchCase> = [
  {"id": "A2-5-normative-situation", "messages": [{"role": "user", "content": "What do they teach in the alchemy course"}], "decision": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "What do they teach in the alchemy course"}, "corr4Reason": "CONTENT_ANAPHORIC_REFERENCE_UNRESOLVED", "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "normative-situation", "evidenceRequested": false, "contentIntentEvidence": "What do they teach in the alchemy course"}, "reason": "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "referencedCourseIds": []}},
  {"id": "A2-5-maslow", "messages": [{"role": "user", "content": "What do they teach in the alchemy course"}], "decision": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "What do they teach in the alchemy course"}, "corr4Reason": "CONTENT_ANAPHORIC_REFERENCE_UNRESOLVED", "expected": {"state": "COURSE_REFERENCE_UNRESOLVED", "proposed": {"state": "COURSE_CONTENT", "courseId": "maslow", "evidenceRequested": false, "contentIntentEvidence": "What do they teach in the alchemy course"}, "reason": "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION", "referencedCourseIds": []}},
];

// Source: CORR2.IV1 original-r1-r7.json sha256 ebf7adb30184c0504b9170be0945e6941d22a79aa3db4ea7b1ac2e07e44ab027
const R_INCIDENT_HISTORY: ConversationMessage[] = [{"role": "assistant", "content": "Здравствуйте. Прежде чем начнём, скажите, пожалуйста, как к вам обращаться? Напишите имя и выберите: на «ты» или на «вы»."}, {"role": "user", "content": "меня зовут Николай, можно на ты, так как я тебя сделал"}, {"role": "assistant", "content": "Спасибо, Николай, можно , так как я тебя сделал. Буду обращаться на «ты». Расскажи, с чем хочешь разобраться — я помогу сориентироваться в курсах и материалах Академии."}, {"role": "user", "content": "Когда команда попадает под давление дедлайна, люди начинают говорить друг с другом как будто на разных языках. Как это объясняется на курсе про уровни сознания?"}];
const R_CONTROL_CHANGE = {"changedMessageIndex": 2, "appendedText": " Мы обсуждаем курс «Иерархия уровней сознания»."};
const R_OUTCOMES: ReadonlyArray<ROutcome> = [
  {"id": "R1", "history": "incident", "input": {"state": "COURSE_FOLLOW_UP", "courseId": "levels-of-consciousness", "evidenceRequested": false}, "recorded": {"accepted": false, "errorName": "ConversationActDecisionValidationError", "errorCode": "INVALID_CONVERSATION_ACT_DECISION", "errorMessage": "COURSE_FOLLOW_UP cannot bind to a course that is absent from the conversation.", "instanceOfImportedValidationError": true}},
  {"id": "R2", "history": "incident", "input": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Как это объясняется на курсе про уровни сознания?"}, "recorded": {"accepted": true, "returned": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Как это объясняется на курсе про уровни сознания?"}}},
  {"id": "R3", "history": "incident", "input": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Объясните уровни сознания под стрессом"}, "recorded": {"accepted": false, "errorName": "ConversationActDecisionValidationError", "errorCode": "INVALID_CONVERSATION_ACT_DECISION", "errorMessage": "COURSE_CONTENT.contentIntentEvidence must be a bounded verbatim fragment of the latest user message.", "instanceOfImportedValidationError": true}},
  {"id": "R4", "history": "incident", "input": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false}, "recorded": {"accepted": false, "errorName": "ConversationActDecisionValidationError", "errorCode": "INVALID_CONVERSATION_ACT_DECISION", "errorMessage": "COURSE_CONTENT.contentIntentEvidence must be a bounded verbatim fragment of the latest user message.", "instanceOfImportedValidationError": true}},
  {"id": "R5", "history": "canonical-title-control", "input": {"state": "COURSE_FOLLOW_UP", "courseId": "levels-of-consciousness", "evidenceRequested": false}, "recorded": {"accepted": true, "returned": {"state": "COURSE_FOLLOW_UP", "courseId": "levels-of-consciousness", "evidenceRequested": false}}},
  {"id": "R6", "history": "canonical-title-control", "input": {"state": "COURSE_CONTENT", "courseId": "levels-of-consciousness", "evidenceRequested": false, "contentIntentEvidence": "Как это объясняется на курсе про уровни сознания?"}, "recorded": {"accepted": false, "errorName": "ConversationActDecisionValidationError", "errorCode": "INVALID_CONVERSATION_ACT_DECISION", "errorMessage": "COURSE_CONTENT cannot be used once a catalog course is present in the conversation.", "instanceOfImportedValidationError": true}},
  {"id": "R7", "history": "incident", "input": {"state": "NAVIGATE", "newTaskEvidence": "Когда команда попадает под давление дедлайна, люди начинаю"}, "recorded": {"accepted": true, "returned": {"state": "NAVIGATE", "newTaskEvidence": "Когда команда попадает под давление дедлайна, люди начинаю"}}},
];

const user = (content: string): ConversationMessage => ({ role: "user", content });
const assistant = (content: string): ConversationMessage => ({ role: "assistant", content });
const content = (courseId: string, evidence: string): Decision => ({
  state: "COURSE_CONTENT",
  courseId,
  evidenceRequested: false,
  contentIntentEvidence: evidence,
});
const followUp = (courseId: string): Decision => ({
  state: "COURSE_FOLLOW_UP",
  courseId,
  evidenceRequested: false,
});

test("R1–R7: the original incident decisions keep their accepted CORR4/CORR5 outcomes", () => {
  const control = R_INCIDENT_HISTORY.map((message, index) =>
    index === R_CONTROL_CHANGE.changedMessageIndex
      ? { ...message, content: message.content + R_CONTROL_CHANGE.appendedText }
      : message,
  );
  const expected: Record<string, string> = {
    // R1 was a technical rejection; it is now the controlled clarification.
    R1: "UNRESOLVED:FOLLOW_UP_REFERENCE_NOT_ESTABLISHED",
    R2: "ACCEPT:COURSE_CONTENT",
    R3: "REJECT:COURSE_CONTENT.contentIntentEvidence must be a bounded verba",
    R4: "REJECT:COURSE_CONTENT.contentIntentEvidence must be a bounded verba",
    R5: "ACCEPT:COURSE_FOLLOW_UP",
    // P8-A: F-1 is retained — a literal title still rejects COURSE_CONTENT.
    R6: "REJECT:COURSE_CONTENT cannot be used once a catalog course is prese",
    R7: "ACCEPT:NAVIGATE",
  };

  for (const outcome of R_OUTCOMES) {
    const messages = outcome.history === "incident" ? R_INCIDENT_HISTORY : control;
    assert.equal(validatorTag(outcome.input, messages), expected[outcome.id], outcome.id);
    if (outcome.recorded.accepted) {
      assert.deepEqual(validated(outcome.input, messages), outcome.recorded.returned, outcome.id);
    } else if (outcome.id !== "R1") {
      assert.throws(() => validated(outcome.input, messages), { message: outcome.recorded.errorMessage }, outcome.id);
    }
  }
});

test("CORR5 focused run: every recorded spec outcome is reproduced (M1/M2/M3, controls, limitations, author pairs)", () => {
  const groups = new Map<string, number>();
  for (const row of CORR5_FOCUSED) {
    assert.equal(validatorTag(row.decision, row.messages), row.expected, `${row.group} ${row.id}`);
    groups.set(row.group, (groups.get(row.group) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(groups), {
    M1: 11,
    M2: 20,
    M3: 13,
    LIMITATION: 4,
    CODEX_CONTROL: 60,
    "AUTHOR+": 7,
    "AUTHOR-": 8,
    COST: 2,
  });
});

test("M1 (CORR4.IV1): the 11 colon/comma/dash/closer/abbreviation/repeated-evidence questions are accepted for their own course", () => {
  for (const row of CORR5_FOCUSED.filter((r) => r.group === "M1")) {
    const value = validated(row.decision, row.messages);
    assert.equal(value.state, "COURSE_CONTENT", row.id);
    assert.equal(row.rule, "C5-independent", row.id);
  }
});

test("M2/M3 (CORR4.IV1): unknown educational constructions and subject anchors never bind an Academy course", () => {
  for (const row of CORR5_FOCUSED.filter((r) => r.group === "M2" || r.group === "M3")) {
    const value = validated(row.decision, row.messages);
    assert.equal(value.state, "COURSE_REFERENCE_UNRESOLVED", row.id);
    assert.ok(!("courseId" in value), `${row.id}: no top-level course binding`);
  }
});

test("A2-5: the two former author-runner mismatches carry the approved CORR5 reason with unchanged safety", () => {
  for (const row of A2_5_MISMATCH) {
    // Historical record: CORR4 classified these as an anaphoric reference; the
    // CORR5 author run exited 1 on this reason-string change. CORR5 approves
    // the explicit unknown-entity reason; the safety consequence is identical.
    assert.equal(row.corr4Reason, "CONTENT_ANAPHORIC_REFERENCE_UNRESOLVED");
    const value = validated(row.decision, row.messages);
    assert.deepEqual(value, row.expected, row.id);
    assert.equal(value.state, "COURSE_REFERENCE_UNRESOLVED");
    if (value.state !== "COURSE_REFERENCE_UNRESOLVED") return;
    assert.equal(value.reason, "CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION");
    assert.deepEqual(value.referencedCourseIds, []);
  }
});

test("CORR5.IV1 witnesses: production reproduces the audited behaviour, including the Owner-accepted residuals", () => {
  for (const row of CORR5_IV1_WITNESSES) {
    assert.deepEqual(validated(row.decision, row.messages), row.expected, `${row.family} ${row.id}`);
  }
});

test("ACCEPTED LIMITATION (M1, IV1): a past-tense course frame before «: а что …» is detached and binds the proposed course", () => {
  // Owner-accepted MINOR. Not a claim of semantic correctness: these course-scoped
  // reported questions should arguably stay constrained to the alchemy course.
  for (const text of [
    "На курсе алхимии спросили: а что такое архетип Тени",
    "На курсе алхимии обсуждали: а что такое архетип Тени",
    "На курсе алхимии была тема: а что такое архетип Тени",
  ]) {
    assert.equal(
      validatorTag(content("structural-typology", "а что такое архетип Тени"), [user(text)]),
      "ACCEPT:COURSE_CONTENT",
      text,
    );
  }
});

test("ACCEPTED LIMITATION (M1, IV1): present-tense or conjunction-less independent questions still clarify", () => {
  for (const [text, evidence] of [
    ["На курсе английского обсуждают уровни сознания: а что такое архетип Тени", "а что такое архетип Тени"],
    ["На курсе английского обсуждали уровни сознания: Что такое архетип Тени", "Что такое архетип Тени"],
    ["На курсе английского обсуждали уровни сознанияА что такое архетип Тени", "А что такое архетип Тени"],
  ] as const) {
    assert.equal(
      validatorTag(content("structural-typology", evidence), [user(text)]),
      "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION",
      text,
    );
  }
  // The sentence-separated form is answered.
  assert.equal(
    validatorTag(content("structural-typology", "Что такое архетип Тени"), [user("Прохожу курс английского. Что такое архетип Тени")]),
    "ACCEPT:COURSE_CONTENT",
  );
});

test("ACCEPTED LIMITATION (M2, IV1): two unsupported constructions bind; ordinary «обучение» topics clarify", () => {
  // Unsupported constructions (residual arbitrary binding, Owner-accepted):
  for (const text of ["Tell me about an alchemy program", "Расскажите о новой учебной программе алхимии"]) {
    assert.equal(validatorTag(content("normative-situation", text), [user(text)]), "ACCEPT:COURSE_CONTENT", text);
  }
  // Their supported neighbours clarify:
  for (const text of ["Tell me about the alchemy program", "What does an alchemy course teach"]) {
    assert.equal(
      validatorTag(content("normative-situation", text), [user(text)]),
      "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION",
      text,
    );
  }
  // Availability cost (Owner-accepted): subject-application questions clarify.
  for (const text of ["Как применяется типология в обучении взрослых", "Как типология помогает в обучении детей"]) {
    assert.equal(
      validatorTag(content("structural-typology", text), [user(text)]),
      "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION",
      text,
    );
  }
});

test("ACCEPTED LIMITATION (M3, IV1): a bare pronoun over an unresolved course antecedent passes through a subject anchor", () => {
  const history = [user("Прохожу курс алхимии."), assistant("Понятно.")];
  for (const text of ["Что такое Тень и сколько он длится", "Что такое Тень и когда он начинается"]) {
    assert.equal(
      validatorTag(content("structural-typology", text), [...history, user(text)]),
      "ACCEPT:COURSE_CONTENT",
      text,
    );
  }
  // Locative and prepositional references keep the unresolved course.
  for (const [text, courseId] of [
    ["Что там говорят о Маслоу", "maslow"],
    ["Что такое Тень и как там её объясняют", "structural-typology"],
  ] as const) {
    assert.equal(
      validatorTag(content(courseId, text), [...history, user(text)]),
      "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED",
      text,
    );
  }
});

test("P1-0: FOLLOW_UP acceptance stays the literal title/URL predicate; aliases never accept", () => {
  const course = getAcademyCourse("maslow");
  assert.ok(course?.url);
  // Literal title and canonical URL accept exactly as before.
  for (const text of [`Расскажите про «${course.title}».`, `Что на ${course.url}?`]) {
    assert.deepEqual(validated(followUp("maslow"), [user(text)]), {
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: false,
    });
  }
  // An alias, an Academy-marked alias, a non-literal URL form: never acceptance.
  for (const text of [
    "Расскажите про курс Маслоу.",
    "Расскажите про ваш курс про Маслоу.",
    "Что на https://structural-typology.academy:443/courses/maslow ?",
    "Я прохожу курс Маслоу у блогера, что там разбирают?",
  ]) {
    const value = validated(followUp("maslow"), [user(text)]);
    assert.equal(value.state, "COURSE_REFERENCE_UNRESOLVED", text);
    assert.ok(!("courseId" in value), text);
  }
  // No named reference at all: the unchanged technical rejection.
  assert.throws(
    () => validated(followUp("maslow"), [user("А что там дальше?")]),
    /absent from the conversation/u,
  );
});

test("FOLLOW_UP uncertainty: F1 names the proposed course, F2 any other named course reference", () => {
  const f1 = validated(followUp("maslow"), [user("Курс Маслоу на Coursera — что там?")]);
  assert.deepEqual(f1, {
    state: "COURSE_REFERENCE_UNRESOLVED",
    proposed: { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false },
    reason: "FOLLOW_UP_REFERENCE_NOT_ESTABLISHED",
    referencedCourseIds: ["maslow"],
  });
  const f2 = validated(followUp("maslow"), [user("Прохожу курс алхимии. Что там разбирают?")]);
  assert.equal(f2.state, "COURSE_REFERENCE_UNRESOLVED");
  if (f2.state !== "COURSE_REFERENCE_UNRESOLVED") return;
  assert.equal(f2.reason, "FOLLOW_UP_UNRESOLVED_COURSE_REFERENCE");
  assert.deepEqual(f2.referencedCourseIds, []);
});

test("COURSE_REFERENCE_UNRESOLVED is model-unselectable", () => {
  assert.throws(
    () =>
      validated(
        {
          state: "COURSE_REFERENCE_UNRESOLVED",
          proposed: followUp("maslow"),
          reason: "FOLLOW_UP_REFERENCE_NOT_ESTABLISHED",
          referencedCourseIds: ["maslow"],
        },
        [user("Курс Маслоу — что там?")],
      ),
    /Unsupported conversation act: COURSE_REFERENCE_UNRESOLVED/u,
  );
});

test("unchanged guards run before the content gate: routability/PDS, booleans, closed schema, verbatim evidence, F-1", () => {
  const messages = [user("Что такое архетип Тени?")];
  assert.throws(
    () => validated(content("professional-development-stages", "Что такое архетип Тени?"), messages),
    /current routable course/u,
  );
  assert.throws(
    () => validated(followUp("professional-development-stages"), [user("Курс стадий профессионального развития — что там?")]),
    /current routable course/u,
  );
  assert.throws(
    () => validated({ ...content("structural-typology", "Что такое архетип Тени?"), evidenceRequested: "no" }, messages),
    /must be boolean/u,
  );
  assert.throws(
    () => validated({ ...content("structural-typology", "Что такое архетип Тени?"), extra: true }, messages),
    /unsupported fields/u,
  );
  assert.throws(
    () => validated(content("structural-typology", "Что такое архетип Тени в курсе?"), messages),
    /bounded verbatim fragment/u,
  );
  const title = getAcademyCourse("maslow")?.title ?? "";
  assert.throws(
    () => validated(content("structural-typology", "Что такое архетип Тени?"), [assistant(`Рекомендую «${title}».`), user("Что такое архетип Тени?")]),
    /once a catalog course is present/u,
  );
});

test("no arbitrary third-course membership through topic aliases (C3 / C4)", () => {
  const text = "Что на курсе Маслоу говорят об уровнях сознания";
  assert.equal(validatorTag(content("maslow", text), [user(text)]), "ACCEPT:COURSE_CONTENT");
  assert.equal(
    validatorTag(content("levels-of-consciousness", text), [user(text)]),
    "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES",
  );
  assert.equal(
    validatorTag(content("normative-situation", text), [user(text)]),
    "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES",
  );
  // P5-A: explicitly coordinated course members are accepted, never a third one.
  const list = "Расскажите про курс Маслоу и уровни сознания";
  assert.equal(validatorTag(content("levels-of-consciousness", list), [user(list)]), "ACCEPT:COURSE_CONTENT");
  assert.equal(
    validatorTag(content("structural-typology", list), [user(list)]),
    "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES",
  );
  const subjects = "Чем Маслоу отличается от уровней сознания";
  assert.equal(
    validatorTag(content("normative-situation", subjects), [user(subjects)]),
    "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_SUBJECTS",
  );
});

test("unresolved historical course references constrain dependent questions only", () => {
  const history = [user("Прохожу курс алхимии."), assistant("Понятно.")];
  assert.equal(
    validatorTag(content("structural-typology", "Как это устроено"), [...history, user("Как это устроено")]),
    "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED",
  );
  // A topic switch without a back-reference is independent.
  assert.equal(
    validatorTag(content("structural-typology", "Что такое архетип Тени"), [...history, user("Что такое архетип Тени")]),
    "ACCEPT:COURSE_CONTENT",
  );
  // A resolved antecedent admits its own course (C9).
  const maslow = [user("Прохожу курс Маслоу."), assistant("Понятно.")];
  assert.equal(
    validatorTag(content("maslow", "Что там говорят о самоактуализации"), [...maslow, user("Что там говорят о самоактуализации")]),
    "ACCEPT:COURSE_CONTENT",
  );
  // Assistant prose never contributes antecedent entities.
  assert.equal(
    validatorTag(
      content("structural-typology", "Как это устроено"),
      [assistant("Многие проходят курс алхимии."), user("Как это устроено")],
    ),
    "ACCEPT:COURSE_CONTENT",
  );
});

test("router prompt digest is the D-1 re-baseline and the catalog payload is byte-identical to the pre-correction baseline", async () => {
  let captured: readonly { role: string; content: string }[] = [];
  await routeConversationAct([user("Что такое архетип Тени?")], {
    callJson: async (requestMessages) => {
      captured = requestMessages;
      return { state: "META" };
    },
  });
  const digest = (text: string) => createHash("sha256").update(text).digest("hex");
  // System prompt: Owner-authorized CORR1 re-baseline
  // (NAVIGATOR-CONVERSATION-ENTRY-SIMPLIFICATION-1.CORR1.ROUTER-FAILURE-CORRECTION-1.CORR1),
  // literal digest of the CORR1 prompt (IV1-01 short-name destination; still insert-only
  // against f5aa968e). IV1-audited FIX-4 value
  // (NAVIGATOR-CONVERSATION-ENTRY-SIMPLIFICATION-1.CORR1.ROUTER-FAILURE-CORRECTION-1):
  // 0f776e6d8ce3e85c7442280bcfc61e8fb20d8d47de1cac3060ad75e5614ccb3f.
  // Previous Owner D-1 re-baseline
  // (NAVIGATOR-PRODUCTION-SMOKE-1.C1C2-IMPLEMENTATION-1), pinned at f5aa968e:
  // 26593e3b3f3220f0771b00e5b1fd6666b2a30a74cb3d26824dd1aae2280b838a.
  // Historical pre-C1 value, recorded from HEAD 12384565 and still pinned at 9b486ff5:
  // a1fbf1a77b2debe9fc8ea846ab0ff05272042348ea220c7844aa321ee089fbdc.
  assert.equal(digest(captured[0]?.content ?? ""), "a5368d8d6a77603ea8a6f284a77fa1c5929c2a1a210fde609247b946b775897d");
  // User payload: unchanged since HEAD 12384565 with the same input.
  assert.equal(digest(captured[1]?.content ?? ""), "50046da18c07a53b719a17770dd37e949168419194a21316487f1879c79e4310");
});

/* ---------------------------------------------------------------------------
 * NAVIGATOR-PRODUCTION-SMOKE-1.C1C2-IMPLEMENTATION-1 — C1 classifier alignment.
 *
 * The prompt now states the validator's own F-1/P8-A literal-presence semantics
 * and the CORR4/CORR5 container rule. The validator is unchanged and remains
 * the final authority; the locks below pin its outcomes for the smoke inputs.
 * ------------------------------------------------------------------------ */

const SMOKE_SETUP: ConversationMessage[] = [
  user("Меня зовут Тест. На «вы»."),
  assistant("Спасибо, Тест. Буду обращаться на «вы». Расскажите, с чем хотите разобраться — я помогу сориентироваться в курсах и материалах Академии."),
];
const T04_Q = "Что даёт курс по структурной типологии личности для работы с типологией Майерс-Бриггс?";
const T09_Q = "Что на курсе Маслоу говорят о нормативной ситуации";

async function capturedSystemPrompt(): Promise<string> {
  let captured: readonly { role: string; content: string }[] = [];
  await routeConversationAct([user("Что такое архетип Тени?")], {
    callJson: async (requestMessages) => {
      captured = requestMessages;
      return { state: "META" };
    },
  });
  return captured[0]?.content ?? "";
}

test("C1 prompt: the CONTENT/FOLLOW_UP contradiction is removed and the literal boundary matches F-1/P8-A", async () => {
  const prompt = await capturedSystemPrompt();
  // The contradictory pre-C1 sentences are gone.
  assert.ok(!prompt.includes("Решающее условие: НИ ОДИН курс каталога не назван в разговоре."));
  assert.ok(!prompt.includes("Если курс уже назван в разговоре — это COURSE_FOLLOW_UP, а не COURSE_CONTENT."));
  assert.ok(!prompt.includes("курс Академии уже реально упоминался в разговоре"));
  // Literal presence: whole title or exact page URL, case-sensitive substring, any role, whole catalog.
  for (const clause of [
    "курс catalog назван в разговоре ТОЧНО, только если его title целиком или точный адрес его страницы https://structural-typology.academy/courses/<id курса> встречается посимвольно, с учётом регистра, хотя бы в одной реплике разговора — пользователя или Навигатора",
    "проверяются все курсы catalog, включая курсы со status \"LISTED_UNROUTABLE\"",
    "короткое название, сокращение, пересказ, неполное название или название в другом регистре точным названием НЕ являются",
    "Если точное название или адрес страницы любого курса catalog уже есть в разговоре, COURSE_CONTENT не используй.",
  ]) {
    assert.ok(prompt.includes(clause), clause);
  }
  // FOLLOW_UP needs the proposed course's own literal; short names do not grant it.
  assert.ok(prompt.includes("courseId должен указывать только на ROUTABLE курс, чьё точное название или адрес страницы есть в разговоре."));
  assert.ok(prompt.includes("сами по себе НЕ дают основания для COURSE_FOLLOW_UP"));
  // Short-name substantive questions are CONTENT; the container course is the one explicitly requested.
  assert.ok(prompt.includes("это COURSE_CONTENT, а не COURSE_FOLLOW_UP и не NAVIGATE"));
  assert.ok(prompt.includes(`Пример: «${T04_Q}» — COURSE_CONTENT, courseId structural-typology.`));
  assert.ok(prompt.includes(`Пример: «${T09_Q}» — COURSE_CONTENT, courseId maslow, а не normative-situation.`));
  assert.ok(prompt.includes("Отсылки «там», «в нём», «на этом курсе» сами по себе не являются явным указанием курса."));
  // Retained boundaries: selection/consideration → NAVIGATE, price → FACTUAL, unknown/foreign → not CONTENT.
  assert.ok(prompt.includes("сообщает, какой курс Академии хочет пройти или рассматривает как вариант"));
  assert.ok(prompt.includes("(в том числе названный коротко: «Хочу пройти курс Маслоу») — это NAVIGATE;"));
  assert.ok(prompt.includes("это FACTUAL (в том числе «Сколько стоит курс Маслоу?»)"));
  assert.ok(prompt.includes("курса или программы, которых нет в catalog, и курсов сторонних платформ и школ — не подменяй их похожим курсом catalog (см. OUT_OF_SCOPE)"));
  assert.ok(prompt.includes("любые сторонние курсы, внешнее обучение и посторонние покупки — это OUT_OF_SCOPE"));
  assert.ok(prompt.includes("Если вопрос относится к курсу со status \"LISTED_UNROUTABLE\", верни не COURSE_CONTENT, а NAVIGATE."));
  // The six states and the JSON templates are unchanged.
  assert.ok(prompt.includes("РАЗРЕШЕНЫ РОВНО ШЕСТЬ state:"));
  assert.ok(prompt.includes('{"state":"COURSE_CONTENT","courseId":"course-id","evidenceRequested":false,"contentIntentEvidence":"точная цитата из последней реплики"}'));
});

test("C1 T04/T09 (A1/A2): the exact smoke histories accept CONTENT for the requested container course only", async () => {
  for (const [question, courseId] of [[T04_Q, "structural-typology"], [T09_Q, "maslow"]] as const) {
    const messages = [...SMOKE_SETUP, user(question)];
    const decision = await routeConversationAct(messages, { callJson: async () => content(courseId, question) });
    assert.deepEqual(decision, content(courseId, question), question);
    // P1-0: the short name grants no literal FOLLOW_UP authority.
    const followUpValue = validated(followUp(courseId), messages);
    assert.equal(followUpValue.state, "COURSE_REFERENCE_UNRESOLVED", question);
    assert.ok(!("courseId" in followUpValue), question);
  }
  // HI (B2): the topic course is never a valid container for T09.
  assert.deepEqual(validated(content("normative-situation", T09_Q), [...SMOKE_SETUP, user(T09_Q)]), {
    state: "COURSE_REFERENCE_UNRESOLVED",
    proposed: content("normative-situation", T09_Q),
    reason: "CONTENT_OUTSIDE_QUESTION_REFERENCES",
    referencedCourseIds: ["maslow"],
  });
});

test("C1 A3–A5: other short-name container questions bind their own course; the reversed topic never binds", () => {
  const rows = [
    ["Чему учит курс Маслоу про мотивацию?", "maslow", "ACCEPT:COURSE_CONTENT"],
    ["Что на курсе по уровням сознания говорят о стрессе?", "levels-of-consciousness", "ACCEPT:COURSE_CONTENT"],
    ["Что на курсе по нормативной ситуации говорят о Маслоу?", "normative-situation", "ACCEPT:COURSE_CONTENT"],
    ["Что на курсе по нормативной ситуации говорят о Маслоу?", "maslow", "UNRESOLVED:CONTENT_OUTSIDE_QUESTION_REFERENCES"],
  ] as const;
  for (const [question, courseId, expected] of rows) {
    assert.equal(validatorTag(content(courseId, question), [...SMOKE_SETUP, user(question)]), expected, `${question} / ${courseId}`);
  }
});

test("C1 negative preservation: F-1 literal history (any role, URL, unroutable), case-sensitivity, C11, selection, price and unknown programs", () => {
  const F1 = "REJECT:COURSE_CONTENT cannot be used once a catalog course is prese";
  const T10_ASSISTANT = `В текущем каталоге Академии ей соответствует курс «${getAcademyCourse("maslow")?.title}» — https://structural-typology.academy/courses/maslow.`;
  // B4–B7: any literal title/URL anywhere keeps COURSE_CONTENT unavailable.
  assert.equal(validatorTag(content("maslow", "Что на курсе Маслоу говорят о мотивации?"), [user("Иерархия уровней сознания"), assistant("Понятно."), user("Что на курсе Маслоу говорят о мотивации?")]), F1);
  assert.equal(validatorTag(content("normative-situation", "А что на курсе по нормативной ситуации говорят о правилах?"), [user("Хочу пройти курс Маслоу."), assistant(T10_ASSISTANT), user("А что на курсе по нормативной ситуации говорят о правилах?")]), F1);
  assert.equal(validatorTag(content("structural-typology", T04_Q), [user("https://structural-typology.academy/courses/maslow"), assistant("Понятно."), user(T04_Q)]), F1);
  assert.equal(validatorTag(content("structural-typology", T04_Q), [user("Стадии профессионального развития взрослого человека"), assistant("Понятно."), user(T04_Q)]), F1);
  // B8: the latest literal container keeps literal FOLLOW_UP authority.
  assert.equal(validatorTag(followUp("normative-situation"), [user("Хочу пройти курс Маслоу."), assistant(T10_ASSISTANT), user("А что на курсе «Нормативная ситуация» говорят о правилах?")]), "ACCEPT:COURSE_FOLLOW_UP");
  // B9: exact case-sensitive substring semantics (not semantic / origin matching).
  const lower = "А что на курсе «нормативная ситуация» говорят о правилах?";
  assert.equal(validatorTag(followUp("normative-situation"), [...SMOKE_SETUP, user(lower)]), "UNRESOLVED:FOLLOW_UP_REFERENCE_NOT_ESTABLISHED");
  assert.equal(validatorTag(content("normative-situation", lower), [...SMOKE_SETUP, user(lower)]), "ACCEPT:COURSE_CONTENT");
  assert.equal(validatorTag(followUp("normative-situation"), [...SMOKE_SETUP, user("А что на курсе \"Нормативная ситуация\" говорят о правилах?")]), "ACCEPT:COURSE_FOLLOW_UP");
  // B1 / C11: an unresolved container antecedent never yields CONTENT.
  assert.equal(validatorTag(content("maslow", "Что там говорят о Маслоу"), [user("Прохожу курс уровней сознания"), assistant("Понятно."), user("Что там говорят о Маслоу")]), "UNRESOLVED:CONTENT_BACK_REFERENCE_UNRESOLVED");
  // B10/B11: selection and price keep their own acts.
  assert.equal(validatorTag({ state: "NAVIGATE", newTaskEvidence: "Хочу пройти курс Маслоу" }, [...SMOKE_SETUP, user("Хочу пройти курс Маслоу.")]), "ACCEPT:NAVIGATE");
  assert.equal(validatorTag({ state: "FACTUAL", intents: [{ kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: ["PRICE"], scope: "REFERENCED" }] }, [...SMOKE_SETUP, user("Сколько стоит курс Маслоу?")]), "ACCEPT:FACTUAL");
  // C1 (T07): an unknown program never binds an Academy course.
  assert.equal(validatorTag(content("normative-situation", "Расскажите про программу алхимии."), [...SMOKE_SETUP, user("Расскажите про программу алхимии.")]), "UNRESOLVED:CONTENT_UNRESOLVED_REFERENCE_IN_QUESTION");
});
