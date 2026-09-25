import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import nextConfig from "../../next.config.ts";
import EmbedPage, {
  metadata as embedMetadata,
  viewport as embedViewport,
} from "../../src/app/embed/page.tsx";
import {
  ChatInterface,
  type ChatInterfaceProps,
} from "../../src/components/chat/chat-interface.tsx";

test("1. Standalone preserves header 'Навигатор'", () => {
  const html = renderToStaticMarkup(
    React.createElement<ChatInterfaceProps>(ChatInterface, {
      variant: "standalone",
    }),
  );
  assert.ok(
    html.includes('<header class="chat-header"><h1>Навигатор</h1></header>'),
    "Standalone must render chat header with 'Навигатор'",
  );
});

test("2. Embedded variant does not render header", () => {
  const html = renderToStaticMarkup(
    React.createElement<ChatInterfaceProps>(ChatInterface, {
      variant: "embedded",
    }),
  );
  assert.ok(
    !html.includes('<header class="chat-header">'),
    "Embedded variant must not render chat header",
  );
  assert.ok(
    !html.includes("<h1>Навигатор</h1>"),
    "Embedded variant must not render 'Навигатор' title in header",
  );
});

test("3. Embedded has explicit presentation marker data-variant='embedded'", () => {
  const html = renderToStaticMarkup(
    React.createElement<ChatInterfaceProps>(ChatInterface, {
      variant: "embedded",
    }),
  );
  assert.ok(
    html.includes('data-variant="embedded"'),
    "Embedded markup must contain data-variant=\"embedded\"",
  );
});

test("4. Route /embed exists and renders embedded ChatInterface with correct metadata and viewport", () => {
  const html = renderToStaticMarkup(React.createElement(EmbedPage));
  assert.ok(
    html.includes('data-variant="embedded"'),
    "EmbedPage must render embedded variant",
  );
  assert.ok(
    !html.includes('<header class="chat-header">'),
    "EmbedPage must not render header",
  );
  assert.equal(embedMetadata.title, "Навигатор");
  assert.deepEqual(embedMetadata.robots, { index: false, follow: false });
  assert.equal(embedViewport?.interactiveWidget, "resizes-content");
});

test("5. CSP for /embed in next.config.ts allows structural-typology.academy", async () => {
  assert.ok(typeof nextConfig.headers === "function");
  const headersList = await nextConfig.headers();
  const embedConfig = headersList.find((entry) => entry.source === "/embed");
  assert.ok(embedConfig, "next.config.ts must have a headers entry for /embed");

  const cspHeader = embedConfig.headers.find(
    (h) => h.key.toLowerCase() === "content-security-policy",
  );
  assert.ok(cspHeader, "Headers for /embed must include Content-Security-Policy");
  assert.ok(
    cspHeader.value.includes("frame-ancestors"),
    "CSP value must specify frame-ancestors",
  );
  assert.ok(
    cspHeader.value.includes("'self'"),
    "CSP value must include 'self'",
  );
  assert.ok(
    cspHeader.value.includes("https://structural-typology.academy"),
    "CSP value must include https://structural-typology.academy",
  );
  assert.ok(
    !cspHeader.value.includes("https://framer.com"),
    "CSP must not automatically include framer.com without authorization",
  );
});

test("6. Embedded styling in globals.css contains two-row grid minmax(0, 1fr) auto and border/resize overrides", () => {
  const cssPath = path.resolve(
    import.meta.dirname,
    "../../src/app/globals.css",
  );
  const cssContent = fs.readFileSync(cssPath, "utf-8");

  assert.ok(
    cssContent.includes(".chat-shell[data-variant=\"embedded\"]"),
    "globals.css must contain rules for .chat-shell[data-variant=\"embedded\"]",
  );
  assert.ok(
    cssContent.includes("grid-template-rows: minmax(0, 1fr) auto;"),
    "globals.css must specify 2-row grid minmax(0, 1fr) auto for embedded mode",
  );
  assert.ok(
    cssContent.includes(".chat-shell[data-variant=\"embedded\"] .manager-card"),
    "globals.css must contain rule for manager card in embed mode",
  );
  assert.ok(
    cssContent.includes(".chat-shell[data-variant=\"embedded\"] .composer-region"),
    "globals.css must contain rule for composer region in embed mode",
  );
  assert.ok(
    cssContent.includes(".chat-shell[data-variant=\"embedded\"] .composer textarea"),
    "globals.css must contain rule for composer textarea in embed mode",
  );
});

test("7. Standalone default variant remains standalone", () => {
  const html = renderToStaticMarkup(React.createElement(ChatInterface));
  assert.ok(
    html.includes('data-variant="standalone"'),
    "Default ChatInterface must have data-variant=\"standalone\"",
  );
  assert.ok(
    html.includes('<header class="chat-header"><h1>Навигатор</h1></header>'),
    "Default ChatInterface must render header",
  );
});
