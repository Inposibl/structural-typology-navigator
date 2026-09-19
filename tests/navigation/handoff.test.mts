/**
 * Package-B A23/A24 human handoff and handoff context (B-H1..B-H8).
 *
 * No handoff transport exists. The Navigator can prepare the handoff and give
 * the canonical contact path, and the public wording says exactly that: it
 * never claims that a human was notified, that a message was delivered, or that
 * a transfer happened.
 *
 * All canonical contact values come from the existing read-only contact
 * authority and are neither edited nor extended here.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationProfile } from "../../src/lib/chat-contract.ts";
import {
  ACADEMY_CONTACT_POLICY,
} from "../../src/lib/academy/contact-policy.ts";
import {
  prepareConversationTurn,
} from "../../src/lib/navigation/conversation-turn-control.ts";
import {
  MAX_HANDOFF_CONTEXT_LENGTH,
  createInitialConversationState,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import {
  buildHandoffContext,
  offerHandoff,
  prepareHandoff,
} from "../../src/lib/navigation/handoff.ts";
import { CLARIFICATION_BUDGET } from "../../src/lib/navigation/conversation-state.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

const COMPLETE_PROFILE: ConversationProfile = {
  displayName: "Анна",
  addressMode: "VY",
  nameDeclined: false,
  pendingUserRequest: null,
};

const PRIOR_ANSWER = {
  act: "NAVIGATE" as const,
  content:
    "По подтверждённым данным я не могу уверенно отнести запрос к одному текущему курсу.",
  courseId: null,
};

function stateWith(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return { ...createInitialConversationState(T0), ...overrides };
}

function turn(
  content: string,
  conversationState: ConversationState = createInitialConversationState(T0),
  profile: ConversationProfile = COMPLETE_PROFILE,
) {
  return prepareConversationTurn([{ role: "user", content }], profile, {
    conversationState,
    nowMs: T0,
  });
}

/**
 * Every URL the handoff message may quote is canonical, and the manager is
 * named from the canonical authority rather than addressed by a literal.
 */
function assertOnlyCanonicalContacts(message: string): void {
  const canonical = new Set<string>([
    ACADEMY_CONTACT_POLICY.contactsPage,
    ACADEMY_CONTACT_POLICY.fastTelegramUrl,
    ACADEMY_CONTACT_POLICY.manager.telegramUrl,
  ]);

  const urls = message.match(/https?:\/\/[^\s,;)]+/gu) ?? [];
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.ok(canonical.has(url), `non-canonical contact URL: ${url}`);
  }

  // The canonical name is rendered in the inflected form the canonical
  // templates use, so the invariant is asserted on its invariant stem.
  const nameStem = ACADEMY_CONTACT_POLICY.manager.name.split(" ").at(-1) ?? "";
  assert.ok(message.includes(nameStem));
  assert.ok(message.includes(ACADEMY_CONTACT_POLICY.manager.telegramUrl));
  assert.ok(message.includes(ACADEMY_CONTACT_POLICY.manager.phoneLabel));
}

test("B-H1: a direct human request enters the handoff path and never routes", () => {
  const result = turn("хочу поговорить с человеком", stateWith());

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.act, "HANDOFF_READY");
  assert.equal(result.conversationState.handoff.status, "READY");
  assert.equal(result.conversationState.handoff.reason, "DIRECT_REQUEST");
  // No forced bot clarification, no out-of-scope answer.
  assert.doesNotMatch(result.message, /как к вам обращаться|вне функции/iu);
});

test("B-H1b: 'позови человека' and 'дайте мне живого человека' take the same path", () => {
  for (const text of ["позови человека", "дайте мне живого человека"]) {
    const result = turn(text, stateWith());
    assert.equal(result.state, "RESPOND");
    if (result.state !== "RESPOND") return;
    assert.equal(result.act, "HANDOFF_READY");
  }
});

test("B-H2: a named handoff uses only the canonical contact authority", () => {
  const result = turn("хочу поговорить с Алексеем", stateWith());

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.act, "HANDOFF_READY");
  assert.equal(result.conversationState.handoff.status, "READY");
  assertOnlyCanonicalContacts(result.message);
});

test("B-H3: repeated repair failure offers handoff without routing", () => {
  const before = stateWith({
    lastAssistant: PRIOR_ANSWER,
    repair: { issueKey: "repair:general", attempts: 1 },
  });
  const result = turn("ответь нормально", before);

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.act, "HANDOFF_OFFERED");
  assert.equal(result.conversationState.handoff.status, "OFFERED");
  assert.equal(
    result.conversationState.handoff.reason,
    "REPEATED_REPAIR_FAILURE",
  );
  assertOnlyCanonicalContacts(result.message);
});

test("B-H4: clear frustration is answered with an offer, not with an argument", () => {
  const result = turn(
    "Ты опять не понял. Это уже третий раз.",
    stateWith({ lastAssistant: PRIOR_ANSWER }),
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.act, "HANDOFF_OFFERED");
  assert.equal(result.conversationState.handoff.status, "OFFERED");
  assert.equal(result.conversationState.handoff.reason, "FRUSTRATION");
  // The user keeps a way to continue with the Navigator.
  assert.equal(result.conversationState.handoff.context, null);
});

test("B-H5: exhausted clarification offers handoff and does not reset the counter", () => {
  const before = stateWith({
    courseMatch: "AMBIGUOUS",
    clarification: {
      issueKey: "ask-more:maslow+play-and-creativity",
      attempts: CLARIFICATION_BUDGET,
      strategyKey: null,
    },
    lastAssistant: PRIOR_ANSWER,
  });
  const result = turn("Не знаю, я уже ответил как мог.", before);

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.act, "HANDOFF_OFFERED");
  assert.equal(result.conversationState.handoff.status, "OFFERED");
  assert.equal(
    result.conversationState.handoff.reason,
    "CLARIFICATION_EXHAUSTED",
  );
  // The clarification resource itself is untouched: no silent reset, and no
  // fourth semantically equivalent question.
  assert.deepEqual(result.conversationState.clarification, before.clarification);
});

test("B-H5b: the exhaustion offer is one-shot, so the user is never trapped", () => {
  const exhausted = stateWith({
    clarification: {
      issueKey: "ask-more:maslow+play-and-creativity",
      attempts: CLARIFICATION_BUDGET,
      strategyKey: null,
    },
  });

  const offered = turn("Не знаю, я уже ответил как мог.", exhausted);
  assert.equal(offered.state, "RESPOND");
  if (offered.state !== "RESPOND") return;

  const resumed = turn("Расскажи про курс Маслоу", offered.conversationState);
  assert.equal(resumed.state, "ROUTE");
});

test("B-H6: the handoff summary carries the canonical course and open choice", () => {
  const result = turn(
    "Передайте это Алексею, пожалуйста.",
    stateWith({
      courseMatch: "MATCHED",
      selectedCourseId: "maslow",
      activeFlow: { id: "COURSE_FOLLOW_UP", pendingQuestion: null },
    }),
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  const context = result.conversationState.handoff.context;
  assert.notEqual(context, null);
  assert.equal(context?.courseId, "maslow");
  assert.equal(context?.flowId, "COURSE_FOLLOW_UP");
  assert.equal(context?.blockingProblem, "DIRECT_REQUEST");
  assert.ok(context?.facts.includes("SELECTED_COURSE"));
  // The canonical catalog title is rendered from the catalog, not stored.
  assert.match(result.message, /Маслоу/u);
});

test("B-H6b: an unresolved course choice is represented structurally", () => {
  const context = buildHandoffContext({
    goal: "COURSE_SELECTION",
    courseId: null,
    courseMatch: "NO_CURRENT_COURSE_MATCH",
    flowId: "COURSE_SELECTION",
    reason: "REPEATED_REPAIR_FAILURE",
    clarificationPending: false,
    pendingConfirmation: false,
    deferredRequest: false,
    technicalFailure: false,
    repairInProgress: true,
    contactPreference: "NONE",
  });

  assert.equal(context.unresolvedChoice, "NOT_MATCHED");
  assert.equal(context.courseId, null);
  assert.ok(context.facts.includes("NO_CURRENT_COURSE_MATCH"));
  assert.ok(context.facts.includes("REPAIR_IN_PROGRESS"));
});

test("B-H7: the summary is bounded and never dumps the transcript", () => {
  const longNarrative = "личная история ".repeat(40);
  const result = turn(
    "хочу поговорить с человеком",
    stateWith({
      courseMatch: "MATCHED",
      selectedCourseId: "maslow",
      deferredRequest: longNarrative,
      lastAssistant: { act: "NAVIGATE", content: longNarrative, courseId: null },
      clarification: {
        issueKey: "ask-more:maslow",
        attempts: 2,
        strategyKey: "ask-more-2",
      },
    }),
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  const context = result.conversationState.handoff.context;
  assert.notEqual(context, null);
  if (!context) return;

  assert.ok(!result.message.includes(longNarrative.trim()));
  assert.ok(!result.message.includes("личная история личная история"));

  // Every structured field is closed and bounded by construction.
  assert.ok(context.facts.length <= 6);
  for (const fact of context.facts) {
    assert.match(fact, /^[A-Z_]+$/u);
  }
  assert.ok(context.unresolvedChoice.length > 0);
  assert.ok(context.blockingProblem.length > 0);

  const responseMessage = result.message;
  assert.ok(
    responseMessage.length <= MAX_HANDOFF_CONTEXT_LENGTH + 1_200,
    "handoff message must stay bounded",
  );
});

test("B-H8: with no transport, the wording never claims a human was reached", () => {
  const ready = turn("хочу поговорить с Алексеем", stateWith());
  assert.equal(ready.state, "RESPOND");
  if (ready.state !== "RESPOND") return;

  const sentClaim =
    /уже получил|уже передал|уже отправил|передал(?:и)? Алексею|отправил(?:и)? Алексею|сообщение (?:передано|отправлено)|Алексей получил|вас соединили/iu;

  assert.doesNotMatch(ready.message, sentClaim);
  assert.equal(ready.conversationState.handoff.status, "READY");

  const offered = turn("Ты опять не понял.", stateWith({ lastAssistant: PRIOR_ANSWER }));
  assert.equal(offered.state, "RESPOND");
  if (offered.state !== "RESPOND") return;
  assert.doesNotMatch(offered.message, sentClaim);
});

test("B-H9: an accepted offer prepares the handoff, and never a confirmation", () => {
  const offered = offerHandoff("FRUSTRATION");
  const result = turn(
    "да",
    stateWith({
      handoff: offered,
      courseMatch: "MATCHED",
      selectedCourseId: "maslow",
    }),
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.act, "HANDOFF_READY");
  assert.equal(result.conversationState.handoff.status, "READY");
  assert.equal(result.conversationState.handoff.context?.courseId, "maslow");
});

test("B-H11: every required direct-request phrasing reaches the handoff path", () => {
  const required = [
    "хочу поговорить с человеком",
    "позови человека",
    "дайте мне живого человека",
    "хочу поговорить с Алексеем",
    "соедини с Алексеем",
    "Хочу поговорить с менеджером Академии Алексеем.",
    "Передайте это Алексею, пожалуйста.",
    "мне нужен оператор",
  ];

  for (const text of required) {
    const result = turn(text, stateWith());
    // RESPOND is the structural proof that the routing layer is not reached.
    assert.equal(result.state, "RESPOND", text);
    if (result.state !== "RESPOND") return;
    assert.equal(result.act, "HANDOFF_READY", text);
  }
});

test("B-H12: an information request about a person is not a handoff request", () => {
  const ordinary = [
    "дайте мне курс про мотивацию",
    "расскажи про Алексея Лебедева",
    "где почитать про фотографию?",
  ];

  for (const text of ordinary) {
    const result = turn(text, stateWith({ lastAssistant: PRIOR_ANSWER }));
    assert.notEqual(result.state, "RESPOND");
  }
});

test("B-H13: only a bare affirmative accepts an outstanding offer", () => {
  const offered = offerHandoff("FRUSTRATION");

  for (const text of ["да", "давай", "давайте", "ага", "ок", "да, давайте"]) {
    const result = turn(text, stateWith({ handoff: offered }));
    assert.equal(result.state, "RESPOND", text);
    if (result.state !== "RESPOND") return;
    assert.equal(result.act, "HANDOFF_READY", text);
  }

  // A yes followed by new business text is not a bare acceptance.
  const notBare = turn("да, и расскажи про курс", stateWith({ handoff: offered }));
  assert.notEqual(notBare.state, "RESPOND");
});

test("B-H14: an open confirmation keeps the yes/no for itself", () => {
  const offered = offerHandoff("FRUSTRATION");
  const result = turn(
    "да",
    stateWith({
      handoff: offered,
      pendingConfirmation: {
        confirmationKey: "stale-course:maslow",
        kind: "STALE_COURSE_REFERENCE",
        prompt: "Ранее мы обсуждали курс «Маслоу». Ты имеешь в виду его?",
        candidateCourseId: "maslow",
      },
    }),
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;
  // The confirmation owns the answer, so the handoff is not silently accepted.
  assert.equal(result.act, "PENDING_CONFIRMATION_RESOLVED");
});

test("B-H10: the Package-C authority hook is a primitive, not a detection path", () => {
  // The primitive exists so a later package can invoke it...
  const state = prepareHandoff(
    stateWith({ courseMatch: "UNKNOWN" }),
    {
      reason: "INSUFFICIENT_AUTHORITY",
      goal: "COURSE_SELECTION",
      flowId: null,
      contactPreference: "NONE",
    },
  );

  assert.equal(state.status, "READY");
  assert.equal(state.reason, "INSUFFICIENT_AUTHORITY");

  // ...but Package B itself never produces that reason from user text.
  for (const text of [
    "хочу поговорить с человеком",
    "ответь нормально",
    "не помогло",
    "сколько стоит курс?",
  ]) {
    const result = turn(text, stateWith({ lastAssistant: PRIOR_ANSWER }));
    if (result.state !== "RESPOND") continue;
    assert.notEqual(result.conversationState.handoff.reason, "INSUFFICIENT_AUTHORITY");
  }
});
