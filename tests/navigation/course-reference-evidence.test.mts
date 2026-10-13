/**
 * NAVIGATOR-ACT-ROUTER-ALIAS-CORRECTION-1.PRODUCTION-IMPLEMENTATION-1 —
 * recognizer contract of the Owner-accepted CORR5 course-reference evidence.
 *
 * The recognizer is a constraint source only: it can make a COURSE_CONTENT
 * proposal UNRESOLVED and decide whether a non-literal COURSE_FOLLOW_UP is a
 * controlled uncertainty or the unchanged rejection. It never accepts a
 * follow-up and never widens content.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationMessage } from "../../src/lib/chat-contract.ts";
import {
  COURSE_ANCHOR_STEMS,
  COURSE_REFERENCE_UNRESOLVED_REASONS,
  analyzeMessage,
  backReferences,
  classifyUrl,
  contentGate,
  followUpWithoutLiteral,
  questionRegion,
} from "../../src/lib/navigation/course-reference-evidence.ts";
import { NAVIGATOR_COURSE_REFERENCE_REASONS } from "../../src/lib/navigation/navigator-observability.ts";

const user = (content: string): ConversationMessage => ({ role: "user", content });
const assistant = (content: string): ConversationMessage => ({ role: "assistant", content });

function entities(text: string) {
  return analyzeMessage(user(text)).entities.map((e) => ({ kind: e.kind, ids: e.ids, family: e.family }));
}

function gate(messages: ConversationMessage[], courseId: string, q: string) {
  const result = contentGate(messages, courseId, q);
  return result.kind === "UNRESOLVED" ? `UNRESOLVED:${result.rule}` : `ACCEPT:${result.rule}`;
}

test("exact-origin URL classification is reference evidence only", () => {
  const cases: Array<[string, string, string | null]> = [
    ["https://structural-typology.academy/courses/maslow", "OFFICIAL_COURSE", "maslow"],
    ["http://structural-typology.academy/courses/maslow/", "OFFICIAL_COURSE", "maslow"],
    ["https://STRUCTURAL-TYPOLOGY.academy:443/courses/maslow", "OFFICIAL_COURSE", "maslow"],
    ["https://structural-typology.academy:444/courses/maslow", "NON_OFFICIAL_ORIGIN", null],
    ["structural-typology.academy:443/courses/maslow", "NON_OFFICIAL_ORIGIN", null],
    ["https://structural-typology.academy@evil.example/courses/maslow", "NON_OFFICIAL_ORIGIN", null],
    ["https://www.structural-typology.academy/courses/maslow", "NON_OFFICIAL_ORIGIN", null],
    ["https://structural-typology.academy.evil.example/courses/maslow", "NON_OFFICIAL_ORIGIN", null],
    ["ftp://structural-typology.academy/courses/maslow", "NON_OFFICIAL_ORIGIN", null],
    ["https://structural-typology.academy/courses/Maslow", "OFFICIAL_OTHER", null],
    ["https://structural-typology.academy/courses/invented", "OFFICIAL_OTHER", null],
    ["https://structural-typology.academy/about", "OFFICIAL_OTHER", null],
  ];
  for (const [raw, classification, courseId] of cases) {
    const info = classifyUrl(raw, 0);
    assert.ok(info, raw);
    assert.equal(info.classification, classification, raw);
    assert.equal(info.courseId, courseId, raw);
  }
  // Scheme-less text without a path is not a URL (abbreviations, «Vue.js»).
  assert.equal(classifyUrl("Vue.js", 0), null);
});

test("closed non-course senses of «курс» create no entity", () => {
  for (const text of [
    "Я буду в курсе дела.",
    "Держите меня в курсе событий.",
    "Какой сейчас курс доллара?",
    "Мы взяли курс на развитие.",
    "Это не курс, а книга.",
  ]) {
    assert.deepEqual(entities(text), [], text);
  }
});

test("course entities: resolved by the governed resolver, otherwise unresolved; demonstratives are anaphoric", () => {
  assert.deepEqual(entities("Расскажите про курс Маслоу."), [{ kind: "RESOLVED", ids: ["maslow"], family: "STRICT" }]);
  assert.deepEqual(entities("Прохожу курс алхимии."), [{ kind: "UNRESOLVED", ids: [], family: "STRICT" }]);
  assert.deepEqual(entities("Что изучают на этом курсе?"), [{ kind: "ANAPHORIC", ids: [], family: "STRICT" }]);
  assert.deepEqual(entities("Какие курсы есть?"), [{ kind: "GENERIC", ids: [], family: "STRICT" }]);
  assert.deepEqual(entities("Есть другой курс про это?").map((e) => e.kind), ["UNRESOLVED"]);
  // A list with a non-alias member stays unresolved (no partial acceptance).
  assert.equal(entities("Курсы Маслоу и алхимии.")[0]?.kind, "UNRESOLVED");
  assert.deepEqual(entities("Курсы Маслоу и уровней сознания.")[0]?.ids.sort(), ["levels-of-consciousness", "maslow"]);
});

test("CORR5 M2 constructions: framed event nouns, English pre-modifier, homoglyph pointers", () => {
  assert.equal(entities("Расскажите про программу алхимии")[0]?.kind, "UNRESOLVED");
  assert.equal(entities("Что было на классе алхимии")[0]?.kind, "UNRESOLVED");
  assert.equal(entities("Tell me about the alchemy program")[0]?.kind, "UNRESOLVED");
  assert.deepEqual(entities("Tell me about the Maslow course")[0], { kind: "RESOLVED", ids: ["maslow"], family: "STRICT" });
  assert.equal(entities("What is in the online course")[0]?.kind, "ANAPHORIC");
  // Plain-script control, then mixed-script pointers: Cyrillic «о» inside a
  // Latin word and Latin «c» inside a Cyrillic word.
  assert.equal(entities("Что на курсе алхимии")[0]?.kind, "UNRESOLVED");
  assert.equal(entities("What is in the cоurse of alchemy")[0]?.kind, "UNRESOLVED");
  assert.equal(entities("Что на курcе алхимии")[0]?.kind, "UNRESOLVED");
  // A bare framed event noun without a complement stays unrecognised.
  assert.deepEqual(entities("Что важно в обучении?"), []);
});

test("CORR5 M1 question region: closers, final abbreviations, quoted occurrences, detached clauses", () => {
  const region = (text: string, q: string) => {
    const latest = analyzeMessage(user(text));
    const r = questionRegion(latest, q);
    return latest.text.slice(r.from);
  };
  assert.equal(region("Обсуждали курс алхимии.) А что такое Тень", "А что такое Тень"), "А что такое Тень");
  assert.equal(region("Обсуждали курс алхимии и т. д. А что такое Тень", "А что такое Тень"), "А что такое Тень");
  // «т. е.» never ends a sentence.
  assert.match(region("Что изучают на курсе алхимии, т. е. что такое Тень", "что такое Тень"), /^Что изучают/u);
  // A quoted occurrence is reported speech when an unquoted one exists.
  assert.equal(
    region("На курсе алхимии спросили «что такое Тень»; сейчас спрашиваю: что такое Тень", "что такое Тень"),
    "сейчас спрашиваю: что такое Тень",
  );
  // Detached clause needs separator + «а/но» + interrogative + finite predicate.
  assert.equal(region("Я прошёл курс Маслоу, а что такое Тень", "а что такое Тень"), "а что такое Тень");
  assert.match(region("На курсе алхимии, а что такое Тень", "а что такое Тень"), /^На курсе/u);
  // The kernel strips terminal punctuation; the anchor does not move.
  assert.equal(region("Курс алхимии прошёл. Что такое Тень", "Что такое Тень?"), "Что такое Тень");
});

test("repeated evidence and no caps: references beyond any count still constrain", () => {
  const question = "Что такое архетип Тени";
  for (const n of [0, 1, 23, 24, 25, 26, 120]) {
    const prefix = "Курс алхимии хороший. ".repeat(n);
    assert.equal(gate([user(`${prefix}${question}`)], "structural-typology", question), "ACCEPT:C5-independent", `prefix ${n}`);
    const inQuestion = `${question} на курсе алхимии${" и на курсе алхимии".repeat(n)}`;
    assert.equal(gate([user(inQuestion)], "structural-typology", inQuestion), "UNRESOLVED:C1", `in-question ${n}`);
  }
});

test("back-references: closed classes with closed idiom exclusions", () => {
  const refs = (text: string) => {
    const a = analyzeMessage(user(text));
    return backReferences(a.toks, 0, a.toks.length).map((b) => `${b.token}:${b.kind}`);
  };
  assert.deepEqual(refs("Что там говорят?"), ["там:CONTAINER"]);
  assert.deepEqual(refs("Как это устроено?"), ["это:ETO"]);
  assert.deepEqual(refs("Что говорят про это?"), ["это:CONTAINER"]);
  assert.deepEqual(refs("При чём тут Тень?"), []);
  assert.deepEqual(refs("То есть это так?"), ["это:ETO"]);
  assert.deepEqual(refs("Тот же вопрос."), []);
  assert.deepEqual(refs("There is a question."), []);
});

test("subject anchors are derived from governed descriptors only and are permissive", () => {
  assert.ok(Object.values(COURSE_ANCHOR_STEMS).some((stems) => stems.length > 0));
  const history = [user("Прохожу курс алхимии."), assistant("Понятно.")];
  // C7 with a bare pronoun after an anchor (accepted P3-H behaviour).
  assert.equal(gate([...history, user("Что такое Тень и как её понять")], "structural-typology", "Что такое Тень и как её понять"), "ACCEPT:C7-intra-sentence-reference");
  // CORR5 M3-b/c: a locative or prepositional reference keeps the unresolved course.
  assert.equal(gate([...history, user("Что такое Тень и как там её объясняют")], "structural-typology", "Что такое Тень и как там её объясняют"), "UNRESOLVED:C11");
  assert.equal(gate([...history, user("Что такое Тень и что в нём говорят")], "structural-typology", "Что такое Тень и что в нём говорят"), "UNRESOLVED:C11");
});

test("follow-up gate: never accepts; F1/F2 clarify, otherwise the unchanged rejection", () => {
  assert.deepEqual(followUpWithoutLiteral([user("Курс Маслоу у блогера, что там?")], "maslow"), {
    kind: "UNRESOLVED", reason: "FOLLOW_UP_REFERENCE_NOT_ESTABLISHED", rule: "F1", referencedCourseIds: ["maslow"],
  });
  assert.equal(followUpWithoutLiteral([user("Курс алхимии — что там?")], "maslow").kind, "UNRESOLVED");
  assert.deepEqual(followUpWithoutLiteral([user("Почему именно этот курс?")], "maslow"), { kind: "ABSENT", rule: "F3-absent" });
  // Assistant alias prose is not a user mention.
  assert.deepEqual(followUpWithoutLiteral([assistant("Есть курс про Маслоу."), user("Расскажи подробнее")], "maslow"), { kind: "ABSENT", rule: "F3-absent" });
  for (const text of ["Ваш курс Маслоу — что там?", "Курс Маслоу в Академии — что там?", "Курс Маслоу"]) {
    assert.notEqual(followUpWithoutLiteral([user(text)], "maslow").kind, "ACCEPT", text);
  }
});

test("evaluation is deterministic and request-scoped (no cross-call carry-over)", () => {
  const messages = [user("Прохожу курс алхимии."), assistant("Понятно."), user("Как это устроено")];
  const first = contentGate(messages, "structural-typology", "Как это устроено");
  contentGate([user("Как это устроено")], "structural-typology", "Как это устроено");
  assert.deepEqual(contentGate(messages, "structural-typology", "Как это устроено"), first);
});

test("bounded linear cost at the API request limits (40 × 4,000 characters)", () => {
  const long = ("Курс алхимии, курс Маслоу и уровни сознания. " + "x".repeat(40)).repeat(46).slice(0, 3990);
  const messages: ConversationMessage[] = [];
  for (let i = 0; i < 39; i += 1) messages.push(i % 2 === 0 ? user(long) : assistant(long));
  messages.push(user(`${long.slice(0, 3900)} Что это`));
  const started = performance.now();
  followUpWithoutLiteral(messages, "maslow");
  contentGate(messages, "maslow", "Что это");
  assert.ok(performance.now() - started < 2_000);
});

test("the observability reason whitelist mirrors the validator's closed reason list", () => {
  assert.deepEqual([...NAVIGATOR_COURSE_REFERENCE_REASONS], [...COURSE_REFERENCE_UNRESOLVED_REASONS]);
});
