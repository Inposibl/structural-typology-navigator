import assert from "node:assert/strict";
import test from "node:test";

import {
  tokenizeMessageContent,
} from "../../src/components/chat/message-linkifier.ts";

test("course URL becomes a dedicated active-link token while sentence punctuation stays outside the href", () => {
  const segments = tokenizeMessageContent(
    "Курс — https://structural-typology.academy/courses/maslow.",
  );

  assert.deepEqual(segments, [
    {
      kind: "text",
      value: "Курс — ",
    },
    {
      kind: "link",
      value: "https://structural-typology.academy/courses/maslow",
      href: "https://structural-typology.academy/courses/maslow",
    },
    {
      kind: "text",
      value: ".",
    },
  ]);
});

test("multiple https links are tokenized without modifying surrounding text or line breaks", () => {
  const segments = tokenizeMessageContent(
    "Поиск: https://www.google.com\nДиалог: https://chatgpt.com",
  );

  assert.equal(
    segments.filter((segment) => segment.kind === "link").length,
    2,
  );

  assert.deepEqual(
    segments
      .filter((segment) => segment.kind === "link")
      .map((segment) => segment.href),
    ["https://www.google.com", "https://chatgpt.com"],
  );

  assert.equal(
    segments
      .filter((segment) => segment.kind === "text")
      .map((segment) => segment.value)
      .join(""),
    "Поиск: \nДиалог: ",
  );
});

test("plain text remains plain text and markdown or HTML parsing is not introduced", () => {
  const content = "Обычный ответ без ссылки.";
  assert.deepEqual(tokenizeMessageContent(content), [
    { kind: "text", value: content },
  ]);
});
