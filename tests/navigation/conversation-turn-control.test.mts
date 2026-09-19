import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareConversationTurn,
} from "../../src/lib/navigation/conversation-turn-control.ts";
import {
  createEmptyConversationProfile,
} from "../../src/lib/navigation/conversation-profile.ts";

test("ADDRESS_SETUP consumes multi-word name + mode and does not call routing on that turn", () => {
  const result = prepareConversationTurn(
    [{ role: "user", content: "Хуй с горы на ты" }],
    createEmptyConversationProfile(),
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.profile.displayName, "Хуй с горы");
  assert.equal(result.profile.addressMode, "TY");
  assert.equal(result.resetConversation, false);
});

test("clear educational task is held until required profile slots are complete", () => {
  const result = prepareConversationTurn(
    [{ role: "user", content: "я хочу учиться еба" }],
    createEmptyConversationProfile(),
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.profile.pendingUserRequest, "я хочу учиться еба");
  assert.equal(result.profile.displayName, null);
  assert.equal(result.profile.addressMode, null);
});

test("pending educational task is released only after final required slot is filled", () => {
  const result = prepareConversationTurn(
    [{ role: "user", content: "на ты" }],
    {
      displayName: "Иван",
      addressMode: null,
      nameDeclined: false,
      pendingUserRequest: "Мне нужен курс про мотивацию команды",
    },
  );

  assert.equal(result.state, "ROUTE");
  if (result.state !== "ROUTE") return;

  assert.equal(result.profile.addressMode, "TY");
  assert.equal(
    result.messages.at(-1)?.content,
    "Мне нужен курс про мотивацию команды",
  );
});

test("profile rename is consumed before conversation act router", () => {
  const result = prepareConversationTurn(
    [{ role: "user", content: "меня зовут Иван" }],
    {
      displayName: "Николай",
      addressMode: "TY",
      nameDeclined: false,
      pendingUserRequest: null,
    },
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.profile.displayName, "Иван");
  assert.equal(result.resetConversation, false);
});

test("dialog restart returns ADDRESS_SETUP and instructs client to clear old course context", () => {
  const result = prepareConversationTurn(
    [{ role: "user", content: "ну ладно ладно. давай сначала" }],
    {
      displayName: "Иван",
      addressMode: "TY",
      nameDeclined: false,
      pendingUserRequest: null,
    },
  );

  assert.equal(result.state, "RESPOND");
  if (result.state !== "RESPOND") return;

  assert.equal(result.resetConversation, true);
  assert.equal(result.profile.displayName, null);
  assert.equal(result.profile.addressMode, null);
  assert.match(result.message, /как к вам обращаться/u);
});

test("ordinary substantive message after completed profile proceeds to router unchanged", () => {
  const result = prepareConversationTurn(
    [{ role: "user", content: "я хочу учиться еба" }],
    {
      displayName: "Иван",
      addressMode: "TY",
      nameDeclined: false,
      pendingUserRequest: null,
    },
  );

  assert.equal(result.state, "ROUTE");
  if (result.state !== "ROUTE") return;

  assert.equal(
    result.messages.at(-1)?.content,
    "я хочу учиться еба",
  );
});
