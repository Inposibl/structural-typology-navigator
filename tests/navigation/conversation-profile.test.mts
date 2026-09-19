import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceConversationProfile,
  createEmptyConversationProfile,
  isConversationProfileComplete,
} from "../../src/lib/navigation/conversation-profile.ts";

test("complete name + TY setup is collected before routing", () => {
  const result = advanceConversationProfile(
    createEmptyConversationProfile(),
    "Николай, на ты",
  );

  assert.equal(result.complete, true);
  assert.equal(result.profile.displayName, "Николай");
  assert.equal(result.profile.addressMode, "TY");
  assert.equal(result.profile.pendingUserRequest, null);
  assert.equal(result.effectiveUserRequest, null);
  assert.match(result.response ?? "", /Буду обращаться на «ты»/u);
});

test("name-only answer asks only for address mode", () => {
  const result = advanceConversationProfile(
    createEmptyConversationProfile(),
    "Николай",
  );

  assert.equal(result.complete, false);
  assert.equal(result.profile.displayName, "Николай");
  assert.equal(result.profile.addressMode, null);
  assert.match(result.response ?? "", /на «ты» или на «вы»/u);
});

test("mode-only answer asks only for name", () => {
  const result = advanceConversationProfile(
    createEmptyConversationProfile(),
    "на вы",
  );

  assert.equal(result.complete, false);
  assert.equal(result.profile.displayName, null);
  assert.equal(result.profile.addressMode, "VY");
  assert.match(result.response ?? "", /как вас называть/u);
});

test("substantive request survives partial profile setup and routes after missing field arrives", () => {
  const first = advanceConversationProfile(
    createEmptyConversationProfile(),
    "Николай. Мне нужен курс про мотивацию команды",
  );

  assert.equal(first.complete, false);
  assert.equal(first.profile.displayName, "Николай");
  assert.equal(
    first.profile.pendingUserRequest,
    "Мне нужен курс про мотивацию команды",
  );

  const second = advanceConversationProfile(
    first.profile,
    "на ты",
  );

  assert.equal(second.complete, true);
  assert.equal(second.profile.addressMode, "TY");
  assert.equal(second.profile.pendingUserRequest, null);
  assert.equal(
    second.effectiveUserRequest,
    "Мне нужен курс про мотивацию команды",
  );
});

test("user may decline name while retaining a stable VY mode", () => {
  const result = advanceConversationProfile(
    createEmptyConversationProfile(),
    "без имени, на вы",
  );

  assert.equal(result.complete, true);
  assert.equal(result.profile.displayName, null);
  assert.equal(result.profile.nameDeclined, true);
  assert.equal(result.profile.addressMode, "VY");
  assert.equal(isConversationProfileComplete(result.profile), true);
});
