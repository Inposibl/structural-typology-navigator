/**
 * Package-B A25 quality signal and failure capture (B-F1..B-F5).
 *
 * A negative-feedback signal and a material technical failure are represented
 * as structured, bounded evidence in session state. Package B creates the
 * candidate only: it performs no persistence, no cloud mutation, and it stores
 * no transcript, stack trace, token, or credential.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { ConversationProfile } from "../../src/lib/chat-contract.ts";
import {
  NavigatorStageError,
} from "../../src/lib/navigation/navigator-observability.ts";
import {
  createInitialConversationState,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import {
  prepareConversationTurn,
} from "../../src/lib/navigation/conversation-turn-control.ts";
import {
  handleChatRequest,
  type ChatRouteDependencies,
} from "../../src/app/api/chat/route.ts";

const T0 = Date.now();

const COMPLETE_PROFILE: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

const PRIOR_ANSWER = {
  act: "NAVIGATE" as const,
  content:
    "По подтверждённым данным я не могу уверенно отнести запрос к одному текущему курсу.",
  courseId: null,
};

/** The closed provenance a candidate is allowed to carry. */
const CANDIDATE_KEYS = [
  "courseId",
  "flowId",
  "handoffOffered",
  "lastAssistantAct",
  "occurredAt",
  "repairOffered",
  "requestId",
  "signalType",
  "stage",
  "trigger",
];

function stateWith(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return { ...createInitialConversationState(T0), ...overrides };
}

function turn(
  content: string,
  conversationState: ConversationState = createInitialConversationState(T0),
) {
  return prepareConversationTurn([{ role: "user", content }], COMPLETE_PROFILE, {
    conversationState,
    nowMs: T0,
  });
}

function chatRequest(
  body: unknown,
  dependencies?: ChatRouteDependencies,
): Promise<Response> {
  return handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    dependencies,
  );
}

test("B-F1: 'не помогло' is a quality signal, never OUT_OF_SCOPE", () => {
  const result = turn("не помогло", stateWith({ lastAssistant: PRIOR_ANSWER }));

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.notEqual(result.act, "OUT_OF_SCOPE");
  assert.equal(result.conversationState.qualitySignals.length, 1);

  const signal = result.conversationState.qualitySignals[0];
  assert.equal(signal?.signalType, "NEGATIVE_FEEDBACK");
  assert.equal(signal?.trigger, "FRUSTRATION");
  assert.match(signal?.occurredAt ?? "", /Z$/u);
});

test("B-F2: the quality signal references the prior assistant action structurally", () => {
  const result = turn(
    "не помогло",
    stateWith({
      lastAssistant: {
        act: "COURSE_FOLLOW_UP",
        content: "Курс помогает анализировать мотивацию.",
        courseId: "maslow",
      },
      courseMatch: "MATCHED",
      selectedCourseId: "maslow",
      activeFlow: { id: "COURSE_FOLLOW_UP", pendingQuestion: null },
      repair: { issueKey: "repair:course:maslow", attempts: 1 },
    }),
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  const signal = result.conversationState.qualitySignals[0];
  assert.equal(signal?.lastAssistantAct, "COURSE_FOLLOW_UP");
  assert.equal(signal?.courseId, "maslow");
  assert.equal(signal?.flowId, "COURSE_FOLLOW_UP");
  assert.equal(signal?.handoffOffered, true);
  // The recorded answer itself is never copied into the candidate.
  assert.equal(
    JSON.stringify(signal).includes("анализировать мотивацию"),
    false,
  );
});

test("B-F2b: an ordinary repair request records a repair signal, not a failure", () => {
  const result = turn(
    "что ты имел в виду?",
    stateWith({ lastAssistant: PRIOR_ANSWER }),
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  const signal = result.conversationState.qualitySignals.at(-1);
  assert.equal(signal?.signalType, "NEGATIVE_FEEDBACK");
  assert.equal(signal?.trigger, "REPAIR_CLARIFY");
  assert.equal(signal?.repairOffered, true);
});

test("B-F3: a material technical failure produces a bounded failure candidate", async () => {
  const state = stateWith({
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
    activeFlow: { id: "COURSE_FOLLOW_UP", pendingQuestion: null },
    lastAssistant: {
      act: "COURSE_FOLLOW_UP",
      content: "Курс помогает анализировать мотивацию.",
      courseId: "maslow",
    },
  });

  const response = await chatRequest(
    {
      messages: [{ role: "user", content: "Почему курс Маслоу подходит?" }],
      profile: COMPLETE_PROFILE,
      conversationState: state,
      requestId: "failure-1",
    },
    {
      orchestrate: () =>
        Promise.reject(
          new NavigatorStageError(
            "COURSE_RPC",
            Object.assign(new Error("rpc unavailable"), {
              code: "RPC_UNAVAILABLE",
            }),
          ),
        ),
    },
  );

  assert.notEqual(response.status, 200);
  const payload = (await response.json()) as {
    error: { conversationState: ConversationState };
  };

  const candidate = payload.error.conversationState.qualitySignals.at(-1);
  assert.notEqual(candidate, undefined);
  assert.equal(candidate?.signalType, "MATERIAL_FAILURE");
  assert.equal(candidate?.trigger, "DATA_ACCESS_FAILURE");
  assert.equal(candidate?.stage, "COURSE_RPC");
  assert.equal(candidate?.flowId, "COURSE_FOLLOW_UP");
  assert.equal(candidate?.lastAssistantAct, "COURSE_FOLLOW_UP");
  assert.equal(candidate?.courseId, "maslow");
  assert.equal(candidate?.requestId, "failure-1");
  assert.match(candidate?.occurredAt ?? "", /Z$/u);
});

test("B-F4: the candidate carries no stack trace, credential, token, or transcript", async () => {
  // Built at runtime rather than written as a literal, so no credential-shaped
  // string exists in the repository even as a fixture.
  const credentialProbe = ["sk", "live", "x".repeat(32)].join("-");
  const exceptionProbe = `Authorization: Bearer ${credentialProbe} failed at route.ts:88`;

  const response = await chatRequest(
    {
      messages: [
        {
          role: "user",
          content: "Расскажи про мою ситуацию с руководителем и командой.",
        },
      ],
      profile: COMPLETE_PROFILE,
      conversationState: stateWith({ selectedCourseId: null }),
    },
    {
      orchestrate: () =>
        Promise.reject(
          new NavigatorStageError(
            "ROUTER",
            Object.assign(new Error(exceptionProbe), {
              code: "UPSTREAM_ERROR",
              status: 500,
            }),
          ),
        ),
    },
  );

  const payload = (await response.json()) as {
    error: { message: string; conversationState: ConversationState };
  };
  const candidate = payload.error.conversationState.qualitySignals.at(-1);
  const serialized = JSON.stringify(candidate);

  assert.deepEqual(Object.keys(candidate ?? {}).sort(), CANDIDATE_KEYS);
  assert.ok(!serialized.includes(credentialProbe));
  assert.doesNotMatch(
    serialized,
    /bearer|api[_-]?key|secret|password|route\.ts|\.ts:\d+|Authorization|руководителем/iu,
  );
  // The public error text is cleaned of the same material.
  assert.ok(!payload.error.message.includes(credentialProbe));
  assert.doesNotMatch(payload.error.message, /bearer|route\.ts/iu);
  assert.ok(serialized.length < 1_200);
});

test("B-F5: Package B performs no persistence and no cloud mutation", () => {
  // The signal is created in session state only. Nothing in the Package-B
  // signal path may reach a database, a network client, or the environment.
  const packageBModules = [
    "conversation-repair.ts",
    "technical-error.ts",
    "handoff.ts",
    "failure-capture.ts",
    "execution-control.ts",
  ];

  const forbidden =
    /process\.env|\bfetch\s*\(|\bfs\b|node:fs|node:net|\bcreateClient\b|supabase|console\.(?:log|warn|error)|localStorage|sessionStorage/iu;

  for (const moduleName of packageBModules) {
    const filePath = path.join(
      process.cwd(),
      "src",
      "lib",
      "navigation",
      moduleName,
    );
    const source = readFileSync(filePath, "utf8");
    assert.doesNotMatch(
      source,
      forbidden,
      `${moduleName} must not perform persistence or cloud mutation`,
    );
  }
});

test("B-F5b: a quality signal never replaces or clears the navigation state", () => {
  const before = stateWith({
    courseMatch: "MATCHED",
    selectedCourseId: "maslow",
    activeFlow: { id: "COURSE_FOLLOW_UP", pendingQuestion: "Что уточнить?" },
    lastAssistant: PRIOR_ANSWER,
  });
  const result = turn("не помогло", before);

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  // The navigation state the signal was recorded against is untouched. Only
  // `lastAssistant` legitimately advances, because it records the newest
  // assistant action (A09) so that "повтори" can never repeat a stale answer.
  assert.equal(result.conversationState.selectedCourseId, "maslow");
  assert.equal(result.conversationState.courseMatch, "MATCHED");
  assert.deepEqual(result.conversationState.activeFlow, before.activeFlow);
  assert.deepEqual(
    result.conversationState.pendingConfirmation,
    before.pendingConfirmation,
  );
  assert.equal(result.conversationState.lastAssistant?.act, "HANDOFF_OFFERED");
});

test("B-F5c: the signal list is bounded, so unbounded evidence cannot accumulate", () => {
  let state = stateWith({ lastAssistant: PRIOR_ANSWER });

  for (let index = 0; index < 10; index += 1) {
    const result = turn("не помогло", state);
    assert.equal(result.state, "RESPOND");
    if (result.state !== "RESPOND") return;
    state = result.conversationState;
  }

  assert.ok(state.qualitySignals.length <= 3);
});
