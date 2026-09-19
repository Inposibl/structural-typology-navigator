/**
 * Package-B A22 busy / in-progress / duplicate safety (B-B1..B-B6).
 *
 * The guarantee this package can truthfully make is bounded and is stated
 * explicitly:
 *
 *   - the production client coalesces a second submission while a request is in
 *     flight, so a double submit cannot issue a second outbound chat request;
 *   - a request identity is carried and validated, so a replay of an already
 *     completed identity is recognised where the current state can prove it;
 *   - a contradictory execution state is rejected at the API boundary.
 *
 * It is NOT a distributed idempotency guarantee: there is no shared durable
 * server-side lock, and Package B does not pretend to have one.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  ConversationProfile,
  ChatSuccessResponse,
} from "../../src/lib/chat-contract.ts";
import {
  IDLE_EXECUTION,
  completeExecution,
  submitExecution,
  type ClientExecutionState,
  type SubmissionOutcome,
} from "../../src/lib/navigation/execution-control.ts";
import {
  createInitialConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import { POST } from "../../src/app/api/chat/route.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

const COMPLETE_PROFILE: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

function request(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function respond(body: unknown): Promise<ChatSuccessResponse> {
  const response = await request(body);
  assert.equal(response.status, 200);
  return (await response.json()) as ChatSuccessResponse;
}

type OutboundTurn = { requestId: string; text: string };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * The production submission handler, reduced to its decision logic.
 *
 * This mirrors `sendMessage` in `chat-interface.tsx`: the draft is cleared only
 * when the submission is actually accepted, and the outbound request is issued
 * only for an accepted submission.
 */
function createClientHarness(transport: (turn: OutboundTurn) => Promise<void>) {
  let execution: ClientExecutionState = IDLE_EXECUTION;
  let draft = "";
  const outbound: OutboundTurn[] = [];

  async function send(): Promise<void> {
    const decision: SubmissionOutcome = submitExecution(
      execution,
      draft,
      () => `req-${outbound.length + 1}`,
    );

    if (decision.status !== "ACCEPTED") {
      return;
    }

    const text = draft;
    execution = decision.execution;
    draft = "";

    const turn: OutboundTurn = { requestId: decision.requestId, text };
    outbound.push(turn);

    try {
      await transport(turn);
    } finally {
      execution = completeExecution(execution, decision.requestId);
    }
  }

  return {
    send,
    type(value: string): void {
      draft = value;
    },
    draft: (): string => draft,
    phase: (): ClientExecutionState["phase"] => execution.phase,
    outbound: (): readonly OutboundTurn[] => outbound,
  };
}

test("B-B1: a UI double submit before the first resolves issues one outbound execution", async () => {
  const gate = deferred();
  const client = createClientHarness(() => gate.promise);

  client.type("Мне нужен курс про мотивацию команды.");
  const first = client.send();
  const second = client.send();

  assert.equal(client.outbound().length, 1);
  assert.equal(client.phase(), "IN_PROGRESS");

  gate.resolve();
  await Promise.all([first, second]);

  assert.equal(client.outbound().length, 1);
  assert.equal(client.phase(), "IDLE");
});

test("B-B2: a second send while IN_PROGRESS is coalesced and keeps the typed text", async () => {
  const gate = deferred();
  const client = createClientHarness(() => gate.promise);

  client.type("Мне нужен курс про мотивацию команды.");
  const first = client.send();

  // R29: "ну?" while the first request is still executing.
  client.type("ну?");
  await client.send();

  assert.equal(client.outbound().length, 1);
  assert.equal(client.outbound()[0]?.text, "Мне нужен курс про мотивацию команды.");
  // The unrelated in-progress input is not silently discarded.
  assert.equal(client.draft(), "ну?");

  gate.resolve();
  await first;
  assert.equal(client.phase(), "IDLE");
});

test("B-B3: a successful execution returns the session to idle", async () => {
  const client = createClientHarness(() => Promise.resolve());

  client.type("первое");
  await client.send();

  assert.equal(client.phase(), "IDLE");

  client.type("второе");
  await client.send();

  assert.equal(client.outbound().length, 2);
  assert.equal(client.phase(), "IDLE");
});

test("B-B4: a failed execution does not leave the client permanently busy", async () => {
  let failNext = true;
  const client = createClientHarness(() =>
    failNext
      ? Promise.reject(new Error("transport failed"))
      : Promise.resolve(),
  );

  client.type("первое");
  await assert.rejects(() => client.send());
  assert.equal(client.phase(), "IDLE");

  failNext = false;
  client.type("второе");
  await client.send();

  assert.equal(client.outbound().length, 2);
  assert.equal(client.phase(), "IDLE");
});

test("B-B5: a replay of a completed request identity is duplicate-safe", async () => {
  const first = await respond({
    messages: [{ role: "user", content: "меня зовут Пётр" }],
    profile: COMPLETE_PROFILE,
    conversationState: createInitialConversationState(T0),
    requestId: "replay-1",
  });

  assert.equal(first.conversationState.execution.lastCompletedRequestId, "replay-1");
  assert.equal(first.conversationState.lastAssistant?.act, "PROFILE_CONTROL");

  // Same identity, different text: the state can prove this is a replay, so the
  // second submit must not execute as an independent fresh action.
  const replayed = await respond({
    messages: [{ role: "user", content: "пока" }],
    profile: first.profile,
    conversationState: first.conversationState,
    requestId: "replay-1",
  });

  assert.equal(replayed.message, first.message);
  assert.equal(replayed.conversationState.lifecycle, "OPEN");
  assert.deepEqual(replayed.conversationState.lastAssistant, first.conversationState.lastAssistant);
  assert.equal(
    replayed.conversationState.execution.lastCompletedRequestId,
    "replay-1",
  );

  // A genuinely new identity executes normally.
  const next = await respond({
    messages: [{ role: "user", content: "пока" }],
    profile: replayed.profile,
    conversationState: replayed.conversationState,
    requestId: "replay-2",
  });

  assert.equal(next.conversationState.lifecycle, "CLOSED");
});

test("B-B6: a contradictory execution state fails closed at the API boundary", async () => {
  const base = createInitialConversationState(T0);

  const inProgress = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...base,
      execution: {
        phase: "IN_PROGRESS",
        requestId: "x",
        lastCompletedRequestId: null,
      },
    },
  });
  assert.equal(inProgress.status, 400);

  const impossible = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...base,
      execution: {
        phase: "IN_PROGRESS",
        requestId: null,
        lastCompletedRequestId: null,
      },
    },
  });
  assert.equal(impossible.status, 400);

  const unknownKey = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...base,
      execution: {
        phase: "IDLE",
        requestId: null,
        lastCompletedRequestId: null,
        bogus: true,
      },
    },
  });
  assert.equal(unknownKey.status, 400);
});

test("B-B6b: a malformed request identity is rejected rather than trusted", async () => {
  const response = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: createInitialConversationState(T0),
    requestId: "not a valid id \u0000 with junk",
  });

  assert.equal(response.status, 400);
});

test("B-B6c: an absent request identity is accepted without claiming replay protection", async () => {
  const payload = await respond({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: createInitialConversationState(T0),
  });

  assert.equal(payload.conversationState.lifecycle, "CLOSED");
  assert.equal(payload.conversationState.execution.lastCompletedRequestId, null);
});
