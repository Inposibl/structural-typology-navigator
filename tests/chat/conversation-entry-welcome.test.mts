/**
 * NAVIGATOR-CONVERSATION-ENTRY-SIMPLIFICATION-1 — E1 / E11 UI entry.
 *
 * The main chat (`/`) and `/embed` render the same ChatInterface. A new
 * conversation shows the Owner-approved welcome as a visible assistant message,
 * once, with the composer ready, and never asks for a name or a ты/вы choice.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import Home from "../../src/app/page.tsx";
import EmbedPage from "../../src/app/embed/page.tsx";
import {
  ChatInterface,
  type ChatInterfaceProps,
} from "../../src/components/chat/chat-interface.tsx";
import * as profileApi from "../../src/lib/navigation/conversation-profile.ts";
import { INITIAL_ADDRESS_PROMPT } from "../../src/lib/navigation/conversation-profile.ts";

const OWNER_WELCOME =
  "Здравствуйте! Я — Навигатор Академии структурной типологии.\n" +
  "Помогу разобраться в образовательных программах, формате и условиях обучения, а также выбрать подходящий курс.\n" +
  "С чего вы хотели бы начать?";

const SETUP_QUESTION =
  /как\s+к\s+вам\s+обращаться|как\s+вас\s+(?:называть|зовут)|на\s+«ты»\s+или\s+на\s+«вы»|«ты»\s+или\s+«вы»|напишите\s+имя|прежде\s+чем\s+начн[её]м/iu;

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const SURFACES: Array<[string, () => string]> = [
  ["main page /", () => renderToStaticMarkup(React.createElement(Home))],
  ["/embed page", () => renderToStaticMarkup(React.createElement(EmbedPage))],
  ["ChatInterface standalone", () =>
    renderToStaticMarkup(
      React.createElement<ChatInterfaceProps>(ChatInterface, { variant: "standalone" }),
    )],
  ["ChatInterface embedded", () =>
    renderToStaticMarkup(
      React.createElement<ChatInterfaceProps>(ChatInterface, { variant: "embedded" }),
    )],
];

test("E1: the shared welcome constant is exactly the Owner-approved text", () => {
  assert.equal(profileApi.NAVIGATOR_WELCOME_MESSAGE, OWNER_WELCOME);
});

for (const [label, render] of SURFACES) {
  test(`E1/E11 ${label}: the welcome is the one visible assistant message, before any user input`, () => {
    const html = render();

    assert.equal(occurrences(html, OWNER_WELCOME), 1, label);
    assert.equal(occurrences(html, "message message--assistant"), 1, label);
    assert.equal(occurrences(html, "message message--user"), 0, label);
    assert.ok(
      html.includes(
        `<li class="message message--assistant"><p class="message__author">Навигатор</p><p class="message__content"><span>${OWNER_WELCOME}</span></p></li>`,
      ),
      label,
    );
    // The live region that announces additions also contains the welcome.
    assert.match(html, /<ol class="conversation__list" role="list" aria-live="polite" aria-relevant="additions"><li class="message message--assistant">/u);
  });

  test(`E1/E11 ${label}: no name or ты/вы question, and the composer is ready on «вы»`, () => {
    const html = render();

    assert.equal(html.includes(INITIAL_ADDRESS_PROMPT), false, label);
    assert.doesNotMatch(html, SETUP_QUESTION, label);
    assert.match(html, /<textarea id="chat-message" name="message"[^>]*placeholder="Напишите вопрос о материалах Академии"/u, label);
    assert.doesNotMatch(html, /<textarea[^>]*disabled/u, label);
    assert.equal(html.includes("Готовлю ответ…"), false, label);
    assert.equal(html.includes('role="alert"'), false, label);
  });
}

test("E11: main and embedded surfaces render the same entry, differing only by the header", () => {
  const standalone = renderToStaticMarkup(React.createElement(Home));
  const embedded = renderToStaticMarkup(React.createElement(EmbedPage));
  const conversation = (html: string) =>
    html.slice(html.indexOf('<section class="conversation"'));

  assert.equal(conversation(standalone), conversation(embedded));
  assert.ok(standalone.includes('<header class="chat-header">'));
  assert.equal(embedded.includes("<header"), false);
});
