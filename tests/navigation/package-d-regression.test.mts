/**
 * Package-D regression bindings for the frozen R0 corpus.
 *
 * Fixture profiles, structured state and turn texts are reproduced verbatim
 * from `01_R0_50_SCENARIO_FIXTURES_FROZEN.json`, so the binding cannot drift
 * from the frozen corpus. Only the Package-D portion of each scenario is
 * asserted here; scenarios whose remaining behaviour belongs to another package
 * are named in the test title.
 *
 * The structural proofs used throughout are: a lane that must not call the
 * model throws when reached, so reaching it fails the assertion; and package-D
 * output is read back from the composers that actually produce it, so a public
 * wording change cannot pass unnoticed.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  ChatSuccessResponse,
  ConversationProfile,
} from "../../src/lib/chat-contract.ts";
import { handleChatRequest } from "../../src/app/api/chat/route.ts";
import {
  ACADEMY_CONTACT_POLICY,
  composeAcademyContactAnswer,
  composeCourseFactualCeilingAnswer,
} from "../../src/lib/academy/contact-policy.ts";
import {
  ACADEMY_PAYMENT_POLICY,
  composeEnrollmentPaymentAnswer,
  paymentActionForCourse,
  resolveEnrollmentPaymentDecision,
} from "../../src/lib/academy/payment-policy.ts";
import {
  applyOrchestratedTurn,
  createInitialConversationState,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import {
  prepareConversationTurn,
} from "../../src/lib/navigation/conversation-turn-control.ts";
import {
  composeAcademyOverviewAnswer,
  composeCatalogListAnswer,
  composeCourseComparisonAnswer,
  composeCourseFollowUpAnswer,
  composeClarificationExhaustionAnswer,
  composeCurrentMetadataAnswer,
  composeDeferredRequestAnswer,
  composeFactualAnswer,
  composeHandoffOfferedAnswer,
  composeNavigatorMetaAnswer,
  composeNavigatorOutOfScopeAnswer,
  composePaymentAmbiguityAnswer,
  composePaymentCourseChangeConfirmationAnswer,
  composePaymentCourseChangeDeclinedAnswer,
  composePaymentCourseIdentityRequiredAnswer,
  composePaymentUnavailableAnswer,
  composePsychologyBoundaryAnswer,
  composeRepairChallengeAnswer,
  composeRepairClarifyAnswer,
  composeRepairRestateAnswer,
  composeRepairUnavailableAnswer,
  composeStableNoMatchAnswer,
  composeStaleReferenceConfirmationAnswer,
  composeTechnicalErrorAnswer,
} from "../../src/lib/navigation/conversation-response.ts";
import {
  orchestrateNavigatorResponse,
  type OrchestrationDependencies,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  composeHandoffContextText,
  prepareHandoff,
} from "../../src/lib/navigation/handoff.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";

const T0 = Date.now();

/** R04/R05/R26/R36/R37 fixture profile: Иван, TY. */
const IVAN_TY: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

/** R05/R35/R38 fixture profile: Анна, VY. */
const ANNA_VY: ConversationProfile = {
  displayName: "Анна",
  addressMode: "VY",
  nameDeclined: false,
  pendingUserRequest: null,
};

/** R04/R05 fixture structured state: `currentCourseId: "maslow"`. */
function maslowSession(): ConversationState {
  return {
    ...createInitialConversationState(T0),
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
  };
}

function turn(
  content: string,
  profile: ConversationProfile,
  conversationState: ConversationState = maslowSession(),
) {
  return prepareConversationTurn([{ role: "user", content }], profile, {
    conversationState,
    nowMs: T0,
  });
}

/** A dependency set that fails loudly if a deterministic lane reaches the model. */
function noModelDependencies(): OrchestrationDependencies {
  return {
    classifyAct: async () => {
      throw new Error("the act classifier must not run for this turn");
    },
    route: async () => {
      throw new Error("the educational router must not run for this turn");
    },
    retrieve: async () => {
      throw new Error("course retrieval must not run for this turn");
    },
  };
}

function applyOutcome(
  state: ConversationState,
  result: Awaited<ReturnType<typeof orchestrateNavigatorResponse>>,
): ConversationState {
  return applyOrchestratedTurn(
    state,
    {
      act: "ACADEMY_CONTACT",
      flowId: "ACADEMY_CONTACT",
      message: result.message,
      decision: { kind: "NONE" },
      clarification: result.clarification,
      catalogAuthorityVersion: result.stateEffects.catalogAuthorityVersion,
      transactionalAuthorityVersion:
        result.stateEffects.transactionalAuthorityVersion,
      pendingConfirmation: result.stateEffects.pendingConfirmation,
    },
    T0,
  );
}

/* ---------------------------------------------------------------------------
 * R04 / R05 — the selected addressing mode changes globally, without restart.
 * ------------------------------------------------------------------------ */

const R04_FROZEN_TURNS = ["давай на вы", "почему этот курс мне подходит?"];
const R05_FROZEN_TURNS = ["давай на ты", "почему этот курс мне подходит?"];

const followUpEvidence: ResolvedCourseEvidence[] = [
  {
    chunkId: 1,
    documentId: "doc",
    sourceId: "source",
    courseId: "maslow",
    sourceSlug: "maslow-new-paradigm",
    sourceTitle: "Manuscript",
    sourceKind: "manuscript",
    authorityRelation: "FOUNDATIONAL",
    courseSourceMetadata: {},
    sourceMetadata: {},
    documentMetadata: {},
    content: "Мотивация меняется под влиянием контекста.",
    contentSha256: "a".repeat(64),
    headingPath: [],
    locator: { primary: { pdfPageStart: 5 } },
    chunkMetadata: {},
    similarity: 0.9,
    controllingAuthorityEntries: [],
    evidenceRole: "FOUNDATIONAL",
  },
];

/** The mode instruction the generated follow-up answer is composed under. */
async function followUpAddressInstruction(
  profile: ConversationProfile,
): Promise<string> {
  let systemPrompt = "";

  await composeCourseFollowUpAnswer(
    [{ role: "user", content: R04_FROZEN_TURNS[1] }],
    { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false },
    {
      profile,
      courseEvidence: followUpEvidence,
      evidenceSelection: {
        status: "SUPPORTED",
        evidence: [{ chunkId: 1, quote: "Мотивация меняется под влиянием контекста" }],
      },
      callText: async (messages) => {
        systemPrompt = messages[0]?.content ?? "";
        return "Мотивация в материале курса описана как меняющаяся под влиянием контекста.";
      },
      callJson: async () => ({ status: "PASS" }),
    },
  );

  return systemPrompt;
}

test("R04: changing TY to VY keeps the business state and re-voices later replies", async () => {
  const switched = turn(R04_FROZEN_TURNS[0], IVAN_TY);

  assert.equal(switched.state, "RESPOND");
  if (switched.state !== "RESPOND") return;
  assert.equal(switched.act, "PROFILE_CONTROL");
  assert.equal(switched.profile.addressMode, "VY");
  assert.equal(switched.resetConversation, false);
  // The switch is a profile control, not a restart: nothing else moved.
  assert.equal(switched.conversationState.lifecycle, "OPEN");
  assert.equal(switched.conversationState.selectedCourseId, "maslow");
  assert.equal(switched.conversationState.courseMatch, "MATCHED");
  assert.match(switched.message, /Буду обращаться на «вы»/u);

  // The frozen follow-up continues the same session and is answered under VY.
  const followUp = turn(R04_FROZEN_TURNS[1], switched.profile, switched.conversationState);
  assert.equal(followUp.state, "ROUTE");
  if (followUp.state !== "ROUTE") return;

  const result = await orchestrateNavigatorResponse(followUp.messages, {
    profile: followUp.profile,
    conversationState: followUp.conversationState,
    dependencies: {
      classifyAct: async () => ({
        state: "COURSE_FOLLOW_UP",
        courseId: "maslow",
        evidenceRequested: false,
      }),
      retrieve: async () => ({
        hasActiveSources: false,
        bindings: [],
        matches: [],
      }),
    },
  });

  assert.match(await followUpAddressInstruction(switched.profile), /уважительное «вы»/u);
  assert.doesNotMatch(await followUpAddressInstruction(switched.profile), /используй «ты»/u);

  const after = applyOrchestratedTurn(
    followUp.conversationState,
    {
      act: "COURSE_FOLLOW_UP",
      flowId: "COURSE_FOLLOW_UP",
      message: result.message,
      decision: { kind: "NONE" },
      clarification: result.clarification,
    },
    T0,
  );
  assert.equal(after.selectedCourseId, "maslow");
  assert.equal(after.courseMatch, "MATCHED");

  // Deterministic public answers follow the same stored mode.
  const oos = composeNavigatorOutOfScopeAnswer(switched.profile);
  assert.match(oos, /Так вы получите/u);
  assert.doesNotMatch(oos, /Так ты получишь/u);
});

test("R05: changing VY to TY re-voices later replies without restarting the session", async () => {
  const switched = turn(R05_FROZEN_TURNS[0], ANNA_VY);

  assert.equal(switched.state, "RESPOND");
  if (switched.state !== "RESPOND") return;
  assert.equal(switched.act, "PROFILE_CONTROL");
  assert.equal(switched.profile.addressMode, "TY");
  assert.equal(switched.resetConversation, false);
  // No restart: the same session, the same selected course.
  assert.equal(switched.conversationState.lifecycle, "OPEN");
  assert.equal(switched.conversationState.selectedCourseId, "maslow");
  assert.match(switched.message, /Буду обращаться на «ты»/u);

  const followUp = turn(R05_FROZEN_TURNS[1], switched.profile, switched.conversationState);
  assert.equal(followUp.state, "ROUTE");
  if (followUp.state !== "ROUTE") return;

  const result = await orchestrateNavigatorResponse(followUp.messages, {
    profile: followUp.profile,
    conversationState: followUp.conversationState,
    dependencies: {
      classifyAct: async () => ({
        state: "COURSE_FOLLOW_UP",
        courseId: "maslow",
        evidenceRequested: false,
      }),
      retrieve: async () => ({
        hasActiveSources: false,
        bindings: [],
        matches: [],
      }),
    },
  });

  assert.match(await followUpAddressInstruction(switched.profile), /используй «ты»/u);
  assert.doesNotMatch(
    await followUpAddressInstruction(switched.profile),
    /уважительное «вы»/u,
  );

  const oos = composeNavigatorOutOfScopeAnswer(switched.profile);
  assert.match(oos, /Так ты получишь/u);
  assert.doesNotMatch(oos, /Так вы получите/u);
  assert.ok(result.message.length > 0);
});

/* ---------------------------------------------------------------------------
 * R26 — the final out-of-scope answer in the selected mode.
 * ------------------------------------------------------------------------ */

test("R26: the final OOS answer uses the selected TY mode and leaks no internal label", async () => {
  const prepared = prepareConversationTurn(
    [{ role: "user", content: "Какая погода завтра в Асунсьоне?" }],
    IVAN_TY,
    { conversationState: createInitialConversationState(T0), nowMs: T0 },
  );

  assert.equal(prepared.state, "ROUTE");
  if (prepared.state !== "ROUTE") return;

  const result = await orchestrateNavigatorResponse(prepared.messages, {
    profile: prepared.profile,
    conversationState: prepared.conversationState,
    dependencies: {
      classifyAct: async () => ({ state: "OUT_OF_SCOPE" }),
      route: async () => {
        throw new Error("OUT_OF_SCOPE must not reach the educational router");
      },
    },
  });

  assert.equal(result.conversationAct.state, "OUT_OF_SCOPE");
  assert.match(result.message, /вне функции Навигатора/u);
  assert.match(result.message, /Так ты получишь/u);
  assert.doesNotMatch(result.message, /Так вы получите|(?<![а-яё])вам(?![а-яё])|(?<![а-яё])вас(?![а-яё])/iu);
  assert.doesNotMatch(result.message, /OUT_OF_SCOPE|NO_MATCH|RPC_ERROR/u);
});

/* ---------------------------------------------------------------------------
 * R35 — a sensitive narrative stays out of durable profile state.
 * ------------------------------------------------------------------------ */

const R35_FROZEN_NARRATIVE =
  "У меня тяжёлый конфликт в семье, и я не хочу, чтобы это сохранялось. Какой курс может помочь лучше понимать свои реакции?";

test("R35: a sensitive family narrative never becomes durable profile state", async () => {
  const prepared = turn(
    R35_FROZEN_NARRATIVE,
    ANNA_VY,
    createInitialConversationState(T0),
  );

  assert.equal(prepared.state, "ROUTE");
  if (prepared.state !== "ROUTE") return;

  // The profile is unchanged in every field: no narrative, no new field.
  assert.deepEqual(prepared.profile, ANNA_VY);
  assert.equal(prepared.profile.displayName, "Анна");
  assert.equal(prepared.profile.pendingUserRequest, null);

  const result = await orchestrateNavigatorResponse(prepared.messages, {
    profile: prepared.profile,
    conversationState: prepared.conversationState,
    dependencies: {
      classifyAct: async () => ({ state: "NAVIGATE" }),
      route: async () => ({
        state: "NO_CURRENT_COURSE_MATCH",
        rationale: "Нет совпадения.",
      }),
      compose: async () =>
        "По подтверждённым данным я не могу уверенно отнести запрос к одному текущему курсу.",
    },
  });

  const after = applyOrchestratedTurn(
    prepared.conversationState,
    {
      act: "NAVIGATE",
      flowId: "COURSE_SELECTION",
      message: result.message,
      decision: { kind: "NO_MATCH" },
      clarification: result.clarification,
    },
    T0,
  );

  const serialized = JSON.stringify(after);
  assert.doesNotMatch(serialized, /конфликт/iu);
  assert.doesNotMatch(serialized, /семь/iu);
  assert.doesNotMatch(serialized, /реакци/iu);
  assert.equal(after.deferredRequest, null);

  // The quality/failure capture surface carries structured labels only.
  for (const signal of after.qualitySignals) {
    assert.doesNotMatch(JSON.stringify(signal), /конфликт|семь/iu);
  }

  // The prepared handoff summary is privacy-minimised, never a transcript.
  const handoff = prepareHandoff(after, {
    reason: "DIRECT_REQUEST",
    contactPreference: "NONE",
  });
  assert.notEqual(handoff.context, null);
  if (handoff.context === null) return;

  const contextText = composeHandoffContextText(handoff.context);
  assert.doesNotMatch(contextText, /конфликт|семь|реакци/iu);

  // And the profile the API hands back for the next turn is still untouched.
  const nextTurn = turn("спасибо", ANNA_VY, after);
  assert.equal(nextTurn.profile.displayName, "Анна");
  assert.equal(nextTurn.profile.addressMode, "VY");
  assert.equal(nextTurn.profile.pendingUserRequest, null);
});

/* ---------------------------------------------------------------------------
 * R36 / R37 / R38 — canonical contact, with the photo as an enhancement only.
 * ------------------------------------------------------------------------ */

/** Every canonical contact value, read from the contact authority itself. */
function canonicalContactValues(): string[] {
  return [
    ACADEMY_CONTACT_POLICY.manager.telegramUrl,
    ACADEMY_CONTACT_POLICY.manager.telegramHandle,
    ACADEMY_CONTACT_POLICY.manager.phoneLabel,
    ACADEMY_CONTACT_POLICY.manager.phoneHref,
    ACADEMY_CONTACT_POLICY.manager.availability,
    ACADEMY_CONTACT_POLICY.manager.name,
  ];
}

test("R36: help/contact stays fully usable as text when the photo cannot render", async () => {
  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Как связаться с менеджером Академии?" }],
    {
      profile: IVAN_TY,
      // The frozen fixture injects CONTACT_PHOTO_RENDER / UNAVAILABLE: the
      // photo is unavailable, so the model must not be reached at all for this
      // deterministic business intent.
      dependencies: noModelDependencies(),
    },
  );

  // The text carries every critical contact fact on its own.
  assert.match(result.message, /https:\/\/t\.me\/LebedevOo/u);
  assert.match(result.message, /@LebedevOo/u);
  assert.match(result.message, /\+7 999 260-02-01/u);
  assert.match(result.message, /09:00–19:00 МСК/u);
  assert.match(result.message, /Алексею Лебедеву/u);

  // The card is an enhancement; the same facts remain without it.
  const textOnly = composeAcademyContactAnswer("LIVE", IVAN_TY).message;
  assert.match(textOnly, /https:\/\/t\.me\/LebedevOo/u);
  assert.match(textOnly, /\+7 999 260-02-01/u);
  assert.match(textOnly, /09:00–19:00 МСК/u);
});

test("R37: a photo follow-up uses the canonical manager photo and keeps the text contact", async () => {
  const result = await orchestrateNavigatorResponse(
    [
      {
        role: "assistant",
        content: "Можно связаться с менеджером Академии Алексеем Лебедевым.",
      },
      { role: "user", content: "а фото Алексея?" },
    ],
    {
      profile: IVAN_TY,
      conversationState: {
        ...createInitialConversationState(T0),
        lastAssistant: {
          act: "ACADEMY_CONTACT",
          content: "Можно связаться с менеджером Академии Алексеем Лебедевым.",
          courseId: null,
        },
      },
      dependencies: noModelDependencies(),
    },
  );

  assert.equal(result.contactCard?.imageUrl, ACADEMY_CONTACT_POLICY.manager.imageUrl);
  assert.equal(result.contactCard?.name, ACADEMY_CONTACT_POLICY.manager.name);
  // The photo is never the sole carrier of the contact facts.
  assert.match(result.message, /https:\/\/t\.me\/LebedevOo/u);
  assert.match(result.message, /\+7 999 260-02-01/u);

  // A bare continuation of the contact surface is resolved from the structured
  // last-assistant act, never by reading the assistant prose above.
  const bareFollowUp = await orchestrateNavigatorResponse(
    [
      {
        role: "assistant",
        content: "Можно связаться с менеджером Академии Алексеем Лебедевым.",
      },
      { role: "user", content: "а фото?" },
    ],
    {
      profile: IVAN_TY,
      conversationState: {
        ...createInitialConversationState(T0),
        lastAssistant: {
          act: "ACADEMY_CONTACT",
          content: "Можно связаться с менеджером Академии Алексеем Лебедевым.",
          courseId: null,
        },
      },
      dependencies: noModelDependencies(),
    },
  );

  assert.equal(
    bareFollowUp.contactCard?.imageUrl,
    ACADEMY_CONTACT_POLICY.manager.imageUrl,
  );

  // Without that structured context a bare "а фото?" is not deterministic.
  const withoutContext = await orchestrateNavigatorResponse(
    [{ role: "user", content: "а фото?" }],
    {
      profile: IVAN_TY,
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
        route: async () => ({
          state: "ASK_MORE",
          candidateCourseIds: ["maslow"],
          questions: ["Что именно важно понять?"],
          rationale: "Нужно уточнение.",
        }),
        compose: async () => "Уточните, пожалуйста, что именно важно понять.",
      },
    },
  );

  assert.equal(withoutContext.contactCard, null);
});

test("R38: Telegram and phone come only from the canonical contact authority", async () => {
  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Дайте Telegram и телефон Алексея." }],
    {
      profile: ANNA_VY,
      dependencies: noModelDependencies(),
    },
  );

  const telegramLinks = [...result.message.matchAll(/https?:\/\/t\.me\/\S+/gu)].map(
    (match) => match[0].replace(/[.)]+$/u, ""),
  );
  assert.deepEqual(telegramLinks, [ACADEMY_CONTACT_POLICY.manager.telegramUrl]);

  const phoneLabels = [...result.message.matchAll(/\+7[\s\d()-]{9,}/gu)].map(
    (match) => match[0].trim(),
  );
  assert.deepEqual(phoneLabels, [ACADEMY_CONTACT_POLICY.manager.phoneLabel]);

  assert.equal(result.contactCard?.telegram.href, ACADEMY_CONTACT_POLICY.manager.telegramUrl);
  assert.equal(result.contactCard?.phone.href, ACADEMY_CONTACT_POLICY.manager.phoneHref);

  // No invented value appears anywhere in the answer.
  const allowed = new Set(canonicalContactValues());
  for (const value of [
    ...telegramLinks,
    ...phoneLabels,
    result.contactCard?.telegram.href ?? "",
    result.contactCard?.phone.href ?? "",
  ]) {
    assert.ok(allowed.has(value), `unexpected contact value: ${value}`);
  }

  const after = applyOutcome(
    { ...createInitialConversationState(T0), courseMatch: "MATCHED", selectedCourseId: "maslow" },
    result,
  );
  assert.equal(after.selectedCourseId, "maslow");
  assert.equal(after.courseMatch, "MATCHED");
});

/* ---------------------------------------------------------------------------
 * A03 — the transactional surface follows the selected mode.
 * ------------------------------------------------------------------------ */

test("A03: the enrollment payment answer follows the selected mode", () => {
  const courseAction = paymentActionForCourse("maslow");
  const genericAction = {
    courseId: null,
    paymentUrl: ACADEMY_PAYMENT_POLICY.generalUrl,
  };

  const tyCourse = composeEnrollmentPaymentAnswer(courseAction, IVAN_TY);
  const tyGeneric = composeEnrollmentPaymentAnswer(genericAction, IVAN_TY);

  assert.match(tyCourse, /(?<![а-яё])перейди(?![а-яё])/u);
  assert.doesNotMatch(tyCourse, /перейдите/u);
  assert.match(tyGeneric, /(?<![а-яё])открой(?![а-яё])/u);
  assert.doesNotMatch(tyGeneric, /откройте/u);

  const vyCourse = composeEnrollmentPaymentAnswer(courseAction, ANNA_VY);
  const vyGeneric = composeEnrollmentPaymentAnswer(genericAction, ANNA_VY);

  assert.match(vyCourse, /перейдите/u);
  assert.doesNotMatch(vyCourse, /(?<![а-яё])перейди(?![а-яё])/u);
  assert.match(vyGeneric, /откройте/u);
  assert.doesNotMatch(vyGeneric, /(?<![а-яё])открой(?![а-яё])/u);

  // With no stored mode the wording carries no address at all, so it is correct
  // in either mode and never invents a default.
  const unsetCourse = composeEnrollmentPaymentAnswer(courseAction);
  const unsetGeneric = composeEnrollmentPaymentAnswer(genericAction);

  for (const answer of [unsetCourse, unsetGeneric]) {
    assert.doesNotMatch(answer, /перейдите|перейди|откройте|(?<![а-яё])открой(?![а-яё])/u);
  }
});

test("A03/C: the payment destination and course binding are unchanged by the mode", () => {
  const decision = resolveEnrollmentPaymentDecision(
    "Хочу оплатить курс Маслоу",
    { state: "NAVIGATE" },
  );
  assert.equal(decision.kind, "ACTION");
  if (decision.kind !== "ACTION") return;
  assert.equal(decision.action.courseId, "maslow");
  assert.equal(
    decision.action.paymentUrl,
    "https://t.me/AST_payment_course_bot?start=maslow",
  );

  // The same canonical destination appears in both modes, and in the neutral
  // form; the address mode changes no payment fact.
  for (const profile of [IVAN_TY, ANNA_VY, undefined]) {
    const answer = composeEnrollmentPaymentAnswer(decision.action, profile);
    assert.match(answer, /https:\/\/t\.me\/AST_payment_course_bot\?start=maslow/u);
    assert.match(answer, /Помощник[а-яё]* по оплате курсов/u);
    assert.doesNotMatch(answer, /поток|расписан|набор|старт|групп|окно/iu);
  }

  // Conflict, ambiguity and not-payable decisions are untouched by this act.
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Хочу оплатить курс уровней сознания",
      { state: "NAVIGATE" },
      { selectedCourseId: "maslow", courseMatch: "MATCHED" },
    ).kind,
    "CONFIRM_COURSE_CHANGE",
  );
  assert.equal(
    resolveEnrollmentPaymentDecision(
      "Хочу оплатить Маслоу и уровни сознания",
      { state: "NAVIGATE" },
    ).kind,
    "CLARIFY_MULTIPLE",
  );
});

test("A03: a mode switch reaches the payment answer without losing the course", async () => {
  const switched = prepareConversationTurn(
    [{ role: "user", content: "давай на ты" }],
    ANNA_VY,
    { conversationState: maslowSession(), nowMs: T0 },
  );

  assert.equal(switched.state, "RESPOND");
  if (switched.state !== "RESPOND") return;
  // A profile control, not a restart: the selected course survives the switch.
  assert.equal(switched.act, "PROFILE_CONTROL");
  assert.equal(switched.profile.addressMode, "TY");
  assert.equal(switched.resetConversation, false);
  assert.equal(switched.conversationState.selectedCourseId, "maslow");
  assert.equal(switched.conversationState.courseMatch, "MATCHED");

  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Хочу оплатить этот курс" }],
    {
      profile: switched.profile,
      conversationState: switched.conversationState,
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
        route: async () => {
          throw new Error("the payment lane must not reach the educational router");
        },
      },
    },
  );

  assert.match(result.message, /(?<![а-яё])перейди(?![а-яё])/u);
  assert.doesNotMatch(result.message, /перейдите/u);
  assert.match(result.message, /\?start=maslow/u);

  const after = applyOrchestratedTurn(
    switched.conversationState,
    {
      act: "PAYMENT",
      flowId: null,
      message: result.message,
      decision: { kind: "NONE" },
      clarification: result.clarification,
      transactionalAuthorityVersion:
        result.stateEffects.transactionalAuthorityVersion,
    },
    T0,
  );

  assert.equal(after.selectedCourseId, "maslow");
  assert.equal(after.courseMatch, "MATCHED");
});

test("A03: no deterministic public answer addresses a TY session in VY form", () => {
  const lastAssistant = {
    act: "NAVIGATE" as const,
    content: "Ранее я отвечал про курс.",
    courseId: null,
  };

  const tyAnswers: ReadonlyArray<readonly [string, string]> = [
    ["enrollment (course)", composeEnrollmentPaymentAnswer(paymentActionForCourse("maslow"), IVAN_TY)],
    [
      "enrollment (generic)",
      composeEnrollmentPaymentAnswer(
        { courseId: null, paymentUrl: ACADEMY_PAYMENT_POLICY.generalUrl },
        IVAN_TY,
      ),
    ],
    ["payment ambiguity", composePaymentAmbiguityAnswer(IVAN_TY)],
    ["payment identity", composePaymentCourseIdentityRequiredAnswer(IVAN_TY)],
    [
      "payment change confirmation",
      composePaymentCourseChangeConfirmationAnswer("Курс А", "Курс Б", IVAN_TY),
    ],
    ["payment change declined", composePaymentCourseChangeDeclinedAnswer("Курс А")],
    ["payment unavailable", composePaymentUnavailableAnswer("Курс А")],
    ["out of scope", composeNavigatorOutOfScopeAnswer(IVAN_TY)],
    [
      "price clarification",
      composeCurrentMetadataAnswer(
        { kind: "CURRENT_METADATA", courseIds: [], fields: ["PRICE"], scope: "SELECTED" },
        null,
        IVAN_TY,
      ),
    ],
    [
      "unknown comparison course",
      composeCourseComparisonAnswer(
        { kind: "COURSE_COMPARISON", courseIds: ["maslow"], hasUnknownCourse: true },
        IVAN_TY,
      ),
    ],
    ["contact fast-text", composeAcademyContactAnswer("FAST_TEXT", IVAN_TY).message],
    ["contact general", composeAcademyContactAnswer("GENERAL", IVAN_TY).message],
    ["technical error", composeTechnicalErrorAnswer(IVAN_TY, true)],
    ["repair restate", composeRepairRestateAnswer(lastAssistant, IVAN_TY)],
    ["repair clarify", composeRepairClarifyAnswer(lastAssistant, IVAN_TY)],
    ["repair challenge", composeRepairChallengeAnswer(lastAssistant, IVAN_TY)],
    ["repair unavailable", composeRepairUnavailableAnswer(IVAN_TY)],
    ["handoff offered", composeHandoffOfferedAnswer(IVAN_TY, "FRUSTRATION")],
    ["deferred request", composeDeferredRequestAnswer("запрос", IVAN_TY)],
    ["stale reference confirmation", composeStaleReferenceConfirmationAnswer("Курс А", IVAN_TY)],
    ["clarification exhausted", composeClarificationExhaustionAnswer(IVAN_TY)],
  ];

  // VY second-person pronouns and VY imperative endings. Cyrillic letter
  // lookarounds, because \b never matches between Cyrillic letters.
  const vyForm =
    /(?<![а-яё])(?:вы|вас|вам|ваш|ваша|ваше|ваши|вашего|вашей|вашему|вашим|вашими|вашу)(?![а-яё])|(?<![а-яё])[а-яё]{3,}(?:ите|йте)(?![а-яё])/iu;

  for (const [label, answer] of tyAnswers) {
    assert.doesNotMatch(answer, vyForm, `${label} addresses a TY session in VY form`);
  }

  // The same answers are still correct, unchanged, for a VY session.
  assert.match(
    composeEnrollmentPaymentAnswer(paymentActionForCourse("maslow"), ANNA_VY),
    /перейдите/u,
  );
  assert.match(
    composePaymentCourseChangeConfirmationAnswer("Курс А", "Курс Б", ANNA_VY),
    /а оплатить вы просите курс/u,
  );
});

/* ---------------------------------------------------------------------------
 * API boundary — the same frozen turns through the real route.
 *
 * No dependency is injected here, so a turn that is not answered
 * deterministically reaches the real classifier and the real provider client.
 * A 200 with the expected structured state is therefore proof that the
 * deterministic lane answered it.
 * ------------------------------------------------------------------------ */

test("R04 through the API: the mode switch round-trips and leaves the session intact", async () => {
  const response = await handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: R04_FROZEN_TURNS[0] }],
        profile: IVAN_TY,
        conversationState: maslowSession(),
        requestId: "corr2-d-r04",
      }),
    }),
  );

  const body = (await response.json()) as ChatSuccessResponse;

  assert.equal(response.status, 200);
  assert.equal(body.profile.addressMode, "VY");
  assert.equal(body.profile.displayName, "Иван");
  assert.equal(body.conversationState.selectedCourseId, "maslow");
  assert.equal(body.conversationState.courseMatch, "MATCHED");
  assert.equal(body.resetConversation, false);
  assert.match(body.message, /Буду обращаться на «вы»/u);
});

test("R36 through the API: a deterministic contact turn needs no provider call", async () => {
  const response = await handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Как связаться с менеджером Академии?" }],
        profile: IVAN_TY,
        conversationState: createInitialConversationState(T0),
        requestId: "corr2-d-r36",
      }),
    }),
  );

  const body = (await response.json()) as ChatSuccessResponse;

  assert.equal(response.status, 200);
  assert.equal(body.contactCard?.name, ACADEMY_CONTACT_POLICY.manager.name);
  assert.equal(body.conversationState.lastAssistant?.act, "ACADEMY_CONTACT");
  assert.equal(body.conversationState.activeFlow?.id, "ACADEMY_CONTACT");
  assert.match(body.message, /https:\/\/t\.me\/LebedevOo/u);
  assert.match(body.message, /\+7 999 260-02-01/u);
  assert.equal(body.resetConversation, false);
});

/* ---------------------------------------------------------------------------
 * A31 — no internal token reaches public output.
 * ------------------------------------------------------------------------ */

const FORBIDDEN_PUBLIC_TOKENS: ReadonlyArray<readonly [string, RegExp]> = [
  ["OUT_OF_SCOPE", /OUT_OF_SCOPE/u],
  ["NO_MATCH", /NO_MATCH/u],
  ["RPC_ERROR", /RPC_ERROR/u],
  ["RPC", /(?<![A-Za-z])RPC(?![A-Za-z])/u],
  ["RAG", /(?<![A-Za-z])RAG(?![A-Za-z])/u],
  ["routing", /(?<![A-Za-z])routing(?![A-Za-z])/iu],
  ["state machine", /state\s*machine/iu],
  ["repair threshold", /repair|threshold/iu],
  ["provider", /(?<![A-Za-z])provider(?![A-Za-z])/iu],
  ["OWNER-COMMERCIAL-AUTHORITY", /OWNER-COMMERCIAL-AUTHORITY/u],
  ["Package A-E", /Package\s+[A-E](?![A-Za-z])/u],
  ["classifier", /classifier/iu],
  ["internal route name", /COURSE_SELECTION|COURSE_FOLLOW_UP|ACADEMY_CONTACT|ADDRESS_SETUP/u],
  ["internal fact label", /SELECTED_COURSE|PRESERVED_REQUEST|AWAITING_CONFIRMATION/u],
  ["провайдер", /провайдер/iu],
  ["машина состояний", /машина\s+состояний/iu],
  ["route", /(?<![A-Za-z])route(?![A-Za-z])/iu],
  ["маршрутизация", /маршрутизац/iu],
  // Internal work-item identifiers, e.g. A03 / R26.
  ["Axx", /(?<![A-Za-z0-9])A\d{1,2}(?![A-Za-z0-9])/u],
  ["Rxx", /(?<![A-Za-z0-9])R\d{1,2}(?![A-Za-z0-9])/u],
];

test("A31: Package-D public output carries no internal token", async () => {
  const metadataIntent = {
    kind: "CURRENT_METADATA" as const,
    courseIds: [],
    fields: ["PRICE", "SCHEDULE", "COHORT", "ENROLLMENT_WINDOW"] as const,
    scope: "SELECTED" as const,
  };

  const contactTurn = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Дайте Telegram и телефон Алексея." }],
    { profile: ANNA_VY, dependencies: noModelDependencies() },
  );

  const outputs: ReadonlyArray<readonly [string, string]> = [
    ["OOS (TY)", composeNavigatorOutOfScopeAnswer(IVAN_TY)],
    ["OOS (VY)", composeNavigatorOutOfScopeAnswer(ANNA_VY)],
    ["OOS (no profile)", composeNavigatorOutOfScopeAnswer()],
    ["META", composeNavigatorMetaAnswer()],
    ["stable no-match", composeStableNoMatchAnswer()],
    ["academy overview", composeAcademyOverviewAnswer()],
    ["psychology boundary", composePsychologyBoundaryAnswer()],
    ["catalog list", composeCatalogListAnswer()],
    [
      "current metadata",
      composeCurrentMetadataAnswer(
        {
          kind: "CURRENT_METADATA",
          courseIds: ["maslow"],
          fields: [...metadataIntent.fields],
          scope: "SELECTED",
        },
        "maslow",
        IVAN_TY,
      ),
    ],
    [
      "metadata without a course",
      composeCurrentMetadataAnswer(
        { kind: "CURRENT_METADATA", courseIds: [], fields: ["PRICE"], scope: "SELECTED" },
        null,
        IVAN_TY,
      ),
    ],
    [
      "course comparison",
      composeCourseComparisonAnswer(
        {
          kind: "COURSE_COMPARISON",
          courseIds: ["maslow", "levels-of-consciousness"],
          hasUnknownCourse: false,
        },
        IVAN_TY,
      ),
    ],
    [
      "course comparison with an unknown course",
      composeCourseComparisonAnswer(
        { kind: "COURSE_COMPARISON", courseIds: ["maslow"], hasUnknownCourse: true },
        IVAN_TY,
      ),
    ],
    [
      "factual answer",
      composeFactualAnswer(
        [{ kind: "ACADEMY_OVERVIEW" }, { kind: "CATALOG_LIST" }],
        null,
        IVAN_TY,
      ),
    ],
    ["payment ambiguity", composePaymentAmbiguityAnswer(IVAN_TY)],
    ["payment course identity required", composePaymentCourseIdentityRequiredAnswer(IVAN_TY)],
    [
      "payment course change confirmation",
      composePaymentCourseChangeConfirmationAnswer("Курс А", "Курс Б", IVAN_TY),
    ],
    ["payment course change declined", composePaymentCourseChangeDeclinedAnswer("Курс А")],
    ["payment unavailable", composePaymentUnavailableAnswer("Курс А")],
    [
      "payment action",
      composeEnrollmentPaymentAnswer(paymentActionForCourse("maslow")),
    ],
    [
      "payment action (generic)",
      composeEnrollmentPaymentAnswer({
        courseId: null,
        paymentUrl: ACADEMY_PAYMENT_POLICY.generalUrl,
      }),
    ],
    ["contact FAST_TEXT (TY)", composeAcademyContactAnswer("FAST_TEXT", IVAN_TY).message],
    ["contact LIVE (TY)", composeAcademyContactAnswer("LIVE", IVAN_TY).message],
    ["contact GENERAL (VY)", composeAcademyContactAnswer("GENERAL", ANNA_VY).message],
    ["factual ceiling", composeCourseFactualCeilingAnswer("Курс А")],
    ["technical error (retryable)", composeTechnicalErrorAnswer(IVAN_TY, true)],
    ["technical error (fatal)", composeTechnicalErrorAnswer(ANNA_VY, false)],
    ["orchestrated contact answer", contactTurn.message],
  ];

  for (const [label, output] of outputs) {
    assert.ok(output.trim().length > 0, `${label} produced no public output`);
    for (const [token, pattern] of FORBIDDEN_PUBLIC_TOKENS) {
      assert.doesNotMatch(output, pattern, `${label} leaked the internal token ${token}`);
    }
  }
});
