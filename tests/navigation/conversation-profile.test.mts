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

test("multi-word display name is accepted during setup", () => {
  const result = advanceConversationProfile(
    createEmptyConversationProfile(),
    "Хуй с горы на ты",
  );

  assert.equal(result.complete, true);
  assert.equal(result.profile.displayName, "Хуй с горы");
  assert.equal(result.profile.addressMode, "TY");
  assert.equal(result.profile.pendingUserRequest, null);
  assert.equal(result.effectiveUserRequest, null);
  assert.match(result.response ?? "", /Хуй с горы/u);
});

test("multi-word name without mode is retained and only mode is requested", () => {
  const result = advanceConversationProfile(
    createEmptyConversationProfile(),
    "Доктор Хаус",
  );

  assert.equal(result.complete, false);
  assert.equal(result.profile.displayName, "Доктор Хаус");
  assert.equal(result.profile.addressMode, null);
  assert.equal(result.profile.pendingUserRequest, null);
  assert.match(result.response ?? "", /на «ты» или на «вы»/u);
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

test("substantive request without profile fields is retained but never mistaken for a name", () => {
  const result = advanceConversationProfile(
    createEmptyConversationProfile(),
    "я хочу учиться еба",
  );

  assert.equal(result.complete, false);
  assert.equal(result.profile.displayName, null);
  assert.equal(result.profile.addressMode, null);
  assert.equal(
    result.profile.pendingUserRequest,
    "я хочу учиться еба",
  );
  assert.equal(result.effectiveUserRequest, null);
});

test("name, mode and clearly separate task can arrive in the same turn", () => {
  const result = advanceConversationProfile(
    createEmptyConversationProfile(),
    "Иван, на ты. Хочу разобраться с мотивацией команды",
  );

  assert.equal(result.complete, true);
  assert.equal(result.profile.displayName, "Иван");
  assert.equal(result.profile.addressMode, "TY");
  assert.equal(result.profile.pendingUserRequest, null);
  assert.equal(
    result.effectiveUserRequest,
    "Хочу разобраться с мотивацией команды",
  );
});

test("unknown setup residue is not promoted to a pending educational request", () => {
  const result = advanceConversationProfile(
    {
      displayName: "Иван",
      addressMode: null,
      nameDeclined: false,
      pendingUserRequest: null,
    },
    "ты чё дебил?",
  );

  assert.equal(result.complete, false);
  assert.equal(result.profile.displayName, "Иван");
  assert.equal(result.profile.pendingUserRequest, null);
  assert.match(result.response ?? "", /на «ты» или на «вы»/u);
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

test("A03: the completed setup invitation follows the selected TY/VY mode", () => {
  const ty = advanceConversationProfile(createEmptyConversationProfile(), "Иван, на ты");
  const vy = advanceConversationProfile(createEmptyConversationProfile(), "Анна, на вы");

  assert.equal(ty.profile.addressMode, "TY");
  assert.match(ty.response ?? "", /Буду обращаться на «ты»\. Расскажи, с чем хочешь разобраться/u);
  assert.doesNotMatch(ty.response ?? "", /Расскажите/u);

  assert.equal(vy.profile.addressMode, "VY");
  assert.match(vy.response ?? "", /Буду обращаться на «вы»\. Расскажите, с чем хотите разобраться/u);
  assert.doesNotMatch(vy.response ?? "", /Расскажи,/u);
});

test("A26: the dialogue-local profile carries exactly the authorised fields", () => {
  const complete = advanceConversationProfile(
    createEmptyConversationProfile(),
    "Анна, на вы. Какой курс поможет лучше понимать свои реакции?",
  ).profile;

  // No durable biography field exists, so a sensitive narrative has nowhere to
  // be stored even when it arrives in the same turn as the setup answers.
  assert.deepEqual(Object.keys(complete).sort(), [
    "addressMode",
    "displayName",
    "nameDeclined",
    "pendingUserRequest",
  ]);
  assert.equal(complete.displayName, "Анна");
  assert.equal(complete.pendingUserRequest, null);
});
