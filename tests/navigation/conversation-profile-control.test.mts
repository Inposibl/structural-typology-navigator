import assert from "node:assert/strict";
import test from "node:test";

import {
  applyConversationProfileControl,
} from "../../src/lib/navigation/conversation-profile-control.ts";

const completeProfile = {
  displayName: "Николай",
  addressMode: "TY" as const,
  nameDeclined: false,
  pendingUserRequest: null,
};

test("explicit rename updates dialogue profile and bypasses educational routing", () => {
  const result = applyConversationProfileControl(
    completeProfile,
    "меня зовут Иван",
  );

  assert.equal(result.handled, true);
  if (!result.handled) return;

  assert.equal(result.profile.displayName, "Иван");
  assert.equal(result.profile.addressMode, "TY");
  assert.equal(result.resetConversation, false);
  assert.match(result.message, /Иван/u);
});

test("explicit address-mode change updates TY/VY state", () => {
  const result = applyConversationProfileControl(
    completeProfile,
    "давай на вы",
  );

  assert.equal(result.handled, true);
  if (!result.handled) return;

  assert.equal(result.profile.addressMode, "VY");
  assert.match(result.message, /на «вы»/u);
});

test("user can stop name usage without resetting address mode", () => {
  const result = applyConversationProfileControl(
    completeProfile,
    "не называй меня по имени",
  );

  assert.equal(result.handled, true);
  if (!result.handled) return;

  assert.equal(result.profile.displayName, null);
  assert.equal(result.profile.nameDeclined, true);
  assert.equal(result.profile.addressMode, "TY");
});

test("natural restart phrasing resets profile and dialogue context", () => {
  const result = applyConversationProfileControl(
    completeProfile,
    "ну ладно ладно. давай сначала",
  );

  assert.equal(result.handled, true);
  if (!result.handled) return;

  assert.equal(result.resetConversation, true);
  assert.deepEqual(result.profile, {
    displayName: null,
    addressMode: null,
    nameDeclined: false,
    pendingUserRequest: null,
  });
  assert.match(result.message, /как к вам обращаться/u);
});

test("hostile or casual use of pronoun ты is not mistaken for an address-mode command", () => {
  const result = applyConversationProfileControl(
    completeProfile,
    "ты чё дебил?",
  );

  assert.deepEqual(result, { handled: false });
});

test("bare short content is not silently treated as a rename after setup", () => {
  const result = applyConversationProfileControl(
    completeProfile,
    "Иван",
  );

  assert.deepEqual(result, { handled: false });
});
