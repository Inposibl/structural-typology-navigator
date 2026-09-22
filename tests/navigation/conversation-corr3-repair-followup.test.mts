import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationProfile } from "../../src/lib/chat-contract.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";
import type { RetrieveCourseKnowledgeResult } from "../../src/lib/knowledge/retrieval/retrieve-course-knowledge.ts";
import {
  createInitialConversationState,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import {
  prepareConversationTurn,
} from "../../src/lib/navigation/conversation-turn-control.ts";
import {
  advanceAddressModeDecline,
  detectAddressPreferenceDecline,
} from "../../src/lib/navigation/conversation-profile.ts";
import {
  formulateFollowUpContentQuery,
} from "../../src/lib/navigation/follow-up-query.ts";
import {
  composeCourseFollowUpAnswer,
  isExplicitSourceAttributionRequest,
} from "../../src/lib/navigation/conversation-response.ts";
import {
  orchestrateNavigatorResponse,
} from "../../src/lib/navigation/orchestrate-navigation.ts";

/* ---------------------------------------------------------------------------
 * NAVIGATOR-PRODUCTION-DIALOGUE-CORR3.CONVERSATION-REPAIR-AND-FOLLOWUP-1
 *
 * Three owner-defined defects:
 *   D1 — explicit DECLINE TO CHOOSE the address mode ("не важно", "мне всё
 *        равно", "пропусти этот вопрос", "проигнорируй этот вопрос"): apply the
 *        authorized neutral default (вы), stop asking, resume any pending
 *        request. No human handoff.
 *   D2 — a semantic course-content follow-up that narrows/corrects a prior
 *        question must retrieve and evidence-select on the CLARIFIED question,
 *        keep the grounded path, and reach the factual ceiling only when no
 *        qualifying evidence exists — never a catalog shortcut.
 *   D3 — grounded answers use a direct teaching voice by default; source
 *        attribution ("курс говорит/заявляет") is reserved for an explicit
 *        source request.
 * ------------------------------------------------------------------------- */

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

const NAME_ONLY_PROFILE: ConversationProfile = {
  displayName: "Иван",
  addressMode: null,
  nameDeclined: false,
  pendingUserRequest: null,
};

function turn(
  text: string,
  profile: ConversationProfile,
  conversationState: ConversationState = createInitialConversationState(T0),
) {
  return prepareConversationTurn(
    [{ role: "user", content: text }],
    profile,
    { conversationState, nowMs: T0 },
  );
}

// ---------------------------------------------------------------------------
// D1 — explicit decline to choose the address mode
// ---------------------------------------------------------------------------

for (const phrase of [
  // Preserved from the original D1 closure.
  "не важно",
  "неважно",
  "мне всё равно",
  "мне все равно",
  "пропусти",
  "пропусти этот вопрос",
  "проигнорируй этот вопрос",
  // CORR1 (IV1): semantically explicit declines carrying a leading
  // demonstrative/dative must be recognised too.
  "это не важно",
  "это мне всё равно",
  "да это не важно",
  "ну это мне всё равно",
]) {
  test(`D1: "${phrase}" exits ADDRESS_SETUP on the authorized default (вы)`, () => {
    const result = turn(phrase, NAME_ONLY_PROFILE);

    assert.equal(result.state, "RESPOND", phrase);
    // Neutral authorized default applied; the address question is resolved.
    assert.equal(result.profile.addressMode, "VY", phrase);
    if (result.state !== "RESPOND") return;
    // No human-handoff / Telegram escape merely because the preference was declined.
    assert.doesNotMatch(result.message, /живым человеком|t\.me\//u);
  });
}

test("D1: a pending substantive request resumes after the decline", () => {
  const pendingProfile: ConversationProfile = {
    displayName: "Иван",
    addressMode: null,
    nameDeclined: false,
    pendingUserRequest: "расскажи про курс Маслоу",
  };

  const result = turn("проигнорируй этот вопрос", pendingProfile);

  assert.equal(result.state, "ROUTE");
  assert.equal(result.profile.addressMode, "VY");
  if (result.state !== "ROUTE") return;
  assert.equal(result.messages.at(-1)?.content, "расскажи про курс Маслоу");
});

test("D1/CORR1: a pending request resumes under VY after 'это не важно'", () => {
  const pendingProfile: ConversationProfile = {
    displayName: "Иван",
    addressMode: null,
    nameDeclined: false,
    pendingUserRequest: "расскажи про курс Маслоу",
  };

  const result = turn("это не важно", pendingProfile);

  assert.equal(result.state, "ROUTE");
  assert.equal(result.profile.addressMode, "VY");
  if (result.state !== "ROUTE") return;
  assert.equal(result.messages.at(-1)?.content, "расскажи про курс Маслоу");
});

test("D1/CORR1: a substantive sentence containing the phrase is NOT an address decline", () => {
  for (const phrase of [
    "это не важно для выбора курса",
    "мне всё равно какой курс, покажи варианты",
    "не важно, сколько встреч, расскажи содержание",
  ]) {
    assert.equal(detectAddressPreferenceDecline(phrase), false, phrase);

    // Through the real kernel the governed default must NOT be applied: the
    // address question is still outstanding.
    const result = turn(phrase, NAME_ONLY_PROFILE);
    assert.equal(result.profile.addressMode, null, phrase);
  }
});

test("D1: the next turn does not reopen the address question", () => {
  const first = turn("мне всё равно", NAME_ONLY_PROFILE);
  assert.equal(first.state, "RESPOND");
  if (first.state !== "RESPOND") return;

  const next = turn("расскажи про курс про мотивацию", first.profile);
  // A complete profile routes normally instead of re-asking TY/VY.
  assert.equal(next.state, "ROUTE");
});

test("D1: an explicit ты/вы still selects that mode", () => {
  const ty = turn("ты", NAME_ONLY_PROFILE);
  assert.equal(ty.profile.addressMode, "TY");

  const vy = turn("вы", NAME_ONLY_PROFILE);
  assert.equal(vy.profile.addressMode, "VY");
});

test("D1: genuinely ambiguous input still clarifies the address mode", () => {
  const result = turn("хм даже пока не решил", NAME_ONLY_PROFILE);

  assert.equal(result.state, "RESPOND");
  assert.equal(result.profile.addressMode, null);
  if (result.state !== "RESPOND") return;
  assert.match(result.message, /на «ты» или на «вы»/u);
});

test("D1: decline detection is whole-message, not embedded in a request", () => {
  assert.equal(detectAddressPreferenceDecline("не важно"), true);
  assert.equal(detectAddressPreferenceDecline("мне всё равно"), true);
  assert.equal(detectAddressPreferenceDecline("проигнорируй этот вопрос"), true);
  // CORR1 (IV1): demonstrative/dative prefixes in either order.
  assert.equal(detectAddressPreferenceDecline("это не важно"), true);
  assert.equal(detectAddressPreferenceDecline("это мне всё равно"), true);
  assert.equal(detectAddressPreferenceDecline("мне это всё равно"), true);
  assert.equal(detectAddressPreferenceDecline("да это не важно"), true);
  assert.equal(detectAddressPreferenceDecline("ну это мне всё равно"), true);
  // A substantive request that merely contains "всё равно" is NOT a decline.
  assert.equal(
    detectAddressPreferenceDecline("мне всё равно какой курс, подбери что-нибудь"),
    false,
  );
  // Declining both defaults to вы and treats the name as declined.
  const declined = advanceAddressModeDecline({
    displayName: null,
    addressMode: null,
    nameDeclined: false,
    pendingUserRequest: null,
  });
  assert.equal(declined.profile.addressMode, "VY");
  assert.equal(declined.profile.nameDeclined, true);
});

// ---------------------------------------------------------------------------
// D2 — semantic course-content follow-up keeps the grounded path
// ---------------------------------------------------------------------------

function resolvedEvidence(courseId = "maslow"): ResolvedCourseEvidence {
  return {
    chunkId: 17,
    documentId: "document-1",
    sourceId: "source-1",
    courseId,
    sourceSlug: "maslow-foundational",
    sourceTitle: "Synthetic source",
    sourceKind: "manuscript",
    authorityRelation: "FOUNDATIONAL",
    courseSourceMetadata: {},
    sourceMetadata: {},
    documentMetadata: {},
    content: "synthetic-private-chunk-content-never-log",
    contentSha256: "a".repeat(64),
    headingPath: [],
    locator: {},
    chunkMetadata: {},
    similarity: 0.9,
    controllingAuthorityEntries: [],
    evidenceRole: "FOUNDATIONAL",
  };
}

function courseKnowledge(courseId = "maslow"): RetrieveCourseKnowledgeResult {
  const evidence = resolvedEvidence(courseId);
  return {
    hasActiveSources: true,
    bindings: [{
      courseId,
      sourceId: "source-1",
      sourceSlug: evidence.sourceSlug,
      sourceTitle: evidence.sourceTitle,
      authorityRelation: "FOUNDATIONAL",
      metadata: {},
    }],
    matches: [evidence],
  };
}

const S_O_NARROWING = [
  {
    role: "user" as const,
    content: "что вообще такое язык субъект-объектных (S–O) отношений?",
  },
  { role: "assistant" as const, content: "Это про модель Маслоу." },
  {
    role: "user" as const,
    content: "я имею в виду именно субъект-объектные отношения",
  },
];

test("D2: formulateFollowUpContentQuery recovers the clarified question", () => {
  assert.equal(
    formulateFollowUpContentQuery(S_O_NARROWING),
    "субъект-объектные отношения",
  );
  assert.equal(
    formulateFollowUpContentQuery([
      { role: "user", content: "почему выбран этот курс?" },
      { role: "assistant", content: "..." },
      {
        role: "user",
        content: "я спросила именно про язык субъект-объектных отношений",
      },
    ]),
    "язык субъект-объектных отношений",
  );
  // An ordinary follow-up with no narrowing lead-in is unchanged.
  assert.equal(
    formulateFollowUpContentQuery([
      { role: "user", content: "Что такое замещение эмоций?" },
    ]),
    "Что такое замещение эмоций?",
  );
  // A bare referent falls back to the prior substantive user question.
  assert.equal(
    formulateFollowUpContentQuery([
      { role: "user", content: "что такое S–O отношения в этом курсе?" },
      { role: "assistant", content: "..." },
      { role: "user", content: "я имею в виду именно это" },
    ]),
    "что такое S–O отношения в этом курсе?",
  );
});

test("D2: a narrowing follow-up retrieves/selects on the clarified question and stays grounded", async () => {
  let retrieveQuery = "";
  let selectQuery = "";
  const evidence = resolvedEvidence();

  const result = await orchestrateNavigatorResponse(S_O_NARROWING, {
    dependencies: {
      classifyAct: async () => ({
        state: "COURSE_FOLLOW_UP" as const,
        courseId: "maslow",
        evidenceRequested: false,
      }),
      retrieve: async (_courseId: string, query: string) => {
        retrieveQuery = query;
        return courseKnowledge();
      },
      resolve: () => [evidence],
      selectEvidence: async (query: string) => {
        selectQuery = query;
        return {
          status: "SUPPORTED" as const,
          evidence: [{ chunkId: evidence.chunkId, quote: "S–O evidence" }],
        };
      },
      composeFollowUp: async (
        _messages: unknown,
        _act: unknown,
        options: { onOutcome?: (o: { answerOrigin: "RAG_EVIDENCE"; fallback: "NONE" }) => void },
      ) => {
        options.onOutcome?.({ answerOrigin: "RAG_EVIDENCE", fallback: "NONE" });
        return "Grounded S–O answer";
      },
    },
  });

  // The clarified substantive question drives retrieval and selection, not the
  // discourse phrase "я имею в виду ...".
  assert.equal(retrieveQuery, "субъект-объектные отношения");
  assert.equal(selectQuery, "субъект-объектные отношения");
  assert.equal(result.observability?.answerOrigin, "RAG_EVIDENCE");
});

test("D2 negative control: no qualifying evidence still ends at the factual ceiling", async () => {
  const evidence = resolvedEvidence();

  const result = await orchestrateNavigatorResponse(S_O_NARROWING, {
    dependencies: {
      classifyAct: async () => ({
        state: "COURSE_FOLLOW_UP" as const,
        courseId: "maslow",
        evidenceRequested: false,
      }),
      retrieve: async () => courseKnowledge(),
      resolve: () => [evidence],
      // The clarified question retrieves candidates, but none qualify.
      selectEvidence: async () => ({
        status: "INSUFFICIENT" as const,
        evidence: [],
      }),
    },
  });

  assert.equal(result.observability?.answerOrigin, "FACTUAL_CEILING");
  assert.equal(result.observability?.fallback, "FACTUAL_CEILING");
});

// ---------------------------------------------------------------------------
// D3 — direct teaching voice in the grounded composer
// ---------------------------------------------------------------------------

async function capturedComposerSystemPrompt(
  question: string,
  evidenceRequested = false,
): Promise<string> {
  const evidence = resolvedEvidence();
  let systemPrompt = "";

  await composeCourseFollowUpAnswer(
    [{ role: "user", content: question }],
    { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested },
    {
      courseEvidence: [evidence],
      evidenceSelection: {
        status: "SUPPORTED",
        evidence: [{ chunkId: evidence.chunkId, quote: "S–O quote" }],
      },
      callText: async (messages) => {
        systemPrompt = messages[0]?.content ?? "";
        return "ответ";
      },
      callJson: async () => ({ status: "PASS" }),
    },
  );

  return systemPrompt;
}

test("D3: an ordinary grounded question instructs a direct teaching voice", async () => {
  const prompt = await capturedComposerSystemPrompt(
    "что такое S–O активность в этом курсе?",
  );

  assert.match(prompt, /по умолчанию прямой обучающий/u);
  // The repetitive external-review narration is explicitly discouraged.
  assert.match(prompt, /«курс говорит»|«курс заявляет»/u);
  assert.doesNotMatch(prompt, /пользователь спрашивает про источник/u);
});

test("D3: an explicit source request keeps source attribution allowed", async () => {
  assert.equal(
    isExplicitSourceAttributionRequest(
      "что именно говорится в материалах курса о S–O?",
    ),
    true,
  );

  const prompt = await capturedComposerSystemPrompt(
    "что именно говорится в материалах курса о S–O?",
  );
  assert.match(prompt, /пользователь спрашивает про источник/u);
});

test("D3: the authority/grounding controls are unchanged", async () => {
  const prompt = await capturedComposerSystemPrompt(
    "что такое S–O активность?",
  );

  assert.match(prompt, /КРИТИЧЕСКАЯ ГРАНИЦА АВТОРИТЕТА/u);
  assert.match(prompt, /НЕ используй общие знания модели/u);
  assert.match(prompt, /используй только authorityPayload/u);
});
