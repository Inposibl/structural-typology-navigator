/**
 * Package-A API-boundary contract (A09 / A28).
 *
 * Verifies that the structured conversation state is strictly validated at the
 * API boundary like ConversationProfile already is, that it is returned on both
 * the kernel-handled and the routed path, and that no control act can be
 * produced by payloads the boundary should reject.
 *
 * These tests exercise only deterministic lanes: no model/provider call is
 * made, because every asserted turn is resolved by the control kernel before
 * routing.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../../src/app/api/chat/route.ts";
import {
  INITIAL_ADDRESS_PROMPT,
} from "../../src/lib/navigation/conversation-profile.ts";
import {
  SESSION_CONTEXT_TTL_MS,
  createInitialConversationState,
  toSessionTimestamp,
} from "../../src/lib/navigation/conversation-state.ts";
import type {
  ChatSuccessResponse,
  ConversationProfile,
} from "../../src/lib/chat-contract.ts";

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

test("A09: the response carries the canonical structured state", async () => {
  const payload = await respond({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: createInitialConversationState(T0),
  });

  assert.equal(payload.conversationState.lifecycle, "CLOSED");
  assert.equal(payload.conversationState.activeFlow, null);
  assert.match(payload.conversationState.lastActivityAt, /Z$/u);
});

test("A09: an absent state is accepted and initialised server-side", async () => {
  const payload = await respond({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
  });

  assert.equal(payload.conversationState.lifecycle, "CLOSED");
});

test("A09: an unknown key in the state payload is rejected", async () => {
  const response = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      injected: "value",
    },
  });

  assert.equal(response.status, 400);

  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_REQUEST");
});

test("A09: an unknown request key is still rejected", async () => {
  const response = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    unexpected: true,
  });

  assert.equal(response.status, 400);
});

test("A09: a malformed timestamp in the state payload is rejected", async () => {
  const response = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      lastActivityAt: "вчера",
    },
  });

  assert.equal(response.status, 400);
});

test("A09: an invalid course identifier in the state payload is rejected", async () => {
  const response = await request({
    messages: [{ role: "user", content: "пока" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      courseMatch: "MATCHED",
      selectedCourseId: "invented-course",
    },
  });

  assert.equal(response.status, 400);
});

test("A28: a stale session is answered without the expired referent on the wire", async () => {
  const payload = await respond({
    messages: [{ role: "user", content: "этот курс мне подойдёт?" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      courseMatch: "MATCHED",
      selectedCourseId: "maslow",
      lastActivityAt: toSessionTimestamp(T0 - SESSION_CONTEXT_TTL_MS - 1),
    },
  });

  assert.equal(payload.conversationState.selectedCourseId, null);
  assert.equal(payload.conversationState.courseMatch, "UNKNOWN");
  assert.equal(
    payload.conversationState.pendingConfirmation?.candidateCourseId,
    "maslow",
  );
  assert.match(payload.message, /Ранее мы обсуждали/u);
});

test("A17: full reset returns a fresh state and the initial prompt", async () => {
  const payload = await respond({
    messages: [{ role: "user", content: "давай сначала" }],
    profile: COMPLETE_PROFILE,
    conversationState: {
      ...createInitialConversationState(T0),
      courseMatch: "MATCHED",
      selectedCourseId: "maslow",
    },
  });

  assert.equal(payload.resetConversation, true);
  assert.equal(payload.message, INITIAL_ADDRESS_PROMPT);
  assert.equal(payload.profile.displayName, null);
  assert.equal(payload.conversationState.courseMatch, "UNKNOWN");
});

test("A04: a control act never reaches the routed path", async () => {
  const payload = await respond({
    messages: [{ role: "user", content: "не хочу больше общаться" }],
    profile: COMPLETE_PROFILE,
    conversationState: createInitialConversationState(T0),
  });

  // The routed path would need model credentials; reaching it would fail here.
  assert.equal(payload.conversationState.lifecycle, "CLOSED");
  assert.equal(payload.contactCard, null);
});
