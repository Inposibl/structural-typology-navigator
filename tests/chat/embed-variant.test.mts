import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  GET as getReleaseIdentity,
  readReleaseIdentity,
} from "../../src/app/api/release/route.ts";
import EmbedPage, {
  metadata as embedMetadata,
  viewport as embedViewport,
} from "../../src/app/embed/page.tsx";
import {
  ChatInterface,
  type ChatInterfaceProps,
} from "../../src/components/chat/chat-interface.tsx";
import nextConfig from "../../next.config.ts";

const EMBED_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://structural-typology.academy https://*.structural-typology.academy;";

const HEADER =
  '<header class="chat-header"><h1>Навигатор</h1></header>';

test("standalone variant is the default and keeps the Navigator header", () => {
  const implicit = renderToStaticMarkup(React.createElement(ChatInterface));
  const explicit = renderToStaticMarkup(
    React.createElement<ChatInterfaceProps>(ChatInterface, {
      variant: "standalone",
    }),
  );

  for (const html of [implicit, explicit]) {
    assert.ok(html.includes('data-variant="standalone"'));
    assert.ok(html.includes(HEADER));
    assert.ok(html.includes('class="conversation"'));
    assert.ok(html.includes('class="composer-region"'));
    assert.ok(html.includes("<textarea"));
  }
});

test("embedded variant omits the header and marks the shell", () => {
  const html = renderToStaticMarkup(
    React.createElement<ChatInterfaceProps>(ChatInterface, {
      variant: "embedded",
    }),
  );

  assert.equal(html.includes("<header"), false);
  assert.equal(html.includes("<h1>Навигатор</h1>"), false);
  assert.ok(html.includes('data-variant="embedded"'));
  assert.ok(html.includes('class="conversation"'));
  assert.ok(html.includes('class="composer-region"'));
  assert.ok(html.includes('id="chat-message"'));
});

test("embed route renders the current embedded ChatInterface", () => {
  const html = renderToStaticMarkup(React.createElement(EmbedPage));

  assert.ok(html.includes('data-variant="embedded"'));
  assert.equal(html.includes(HEADER), false);
  assert.equal(embedMetadata.title, "Навигатор");
  assert.deepEqual(embedMetadata.robots, { index: false, follow: false });
  assert.equal(embedViewport.interactiveWidget, "resizes-content");
});

test("embed frame policy allows only the Academy origins", async () => {
  assert.equal(typeof nextConfig.headers, "function");
  const headersList = await nextConfig.headers!();
  assert.equal(headersList.length, 1);
  assert.equal(headersList[0]?.source, "/embed");

  const frameDenial = headersList[0]?.headers.find(
    (header) => header.key.toLowerCase() === "x-frame-options",
  );
  assert.equal(frameDenial, undefined);

  const csp = headersList[0]?.headers.find(
    (header) => header.key.toLowerCase() === "content-security-policy",
  );
  assert.ok(csp);
  assert.equal(csp.value, EMBED_FRAME_ANCESTORS);
  assert.equal(csp.value.includes("frame-ancestors *"), false);
  assert.equal(csp.value.includes("https://framer.com"), false);
});

test("offer rewrite stays intact beside the embed header", async () => {
  assert.equal(typeof nextConfig.rewrites, "function");
  const rewrites = await nextConfig.rewrites!();
  assert.deepEqual(rewrites, [
    {
      source: "/offer",
      destination: "/offer.html",
    },
  ]);
});

test("embedded shell fills the iframe without a third grid row", () => {
  const css = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../src/app/globals.css"),
    "utf8",
  );

  assert.ok(css.includes('.chat-shell[data-variant="embedded"]'));
  assert.ok(
    css.includes(
      "grid-template-rows: minmax(0, 1fr) auto;",
    ),
  );
  assert.ok(css.includes("height: 100%;"));
  assert.ok(css.includes("min-height: 100%;"));
  assert.ok(css.includes("max-height: 100%;"));
  assert.ok(
    css.includes('.chat-shell[data-variant="embedded"] .manager-card'),
  );
  assert.ok(
    css.includes('.chat-shell[data-variant="embedded"] .composer-region'),
  );
  assert.ok(
    css.includes('.chat-shell[data-variant="embedded"] .composer textarea'),
  );
  assert.ok(css.includes("html:has(.chat-shell[data-variant=\"embedded\"])"));
});

test("chat requests stay on the relative same-origin endpoint", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../src/lib/chat-api.ts"),
    "utf8",
  );

  assert.match(source, /fetch\("\/api\/chat"/);
  assert.equal(source.includes("structural-typology-navigator"), false);
  assert.equal(source.includes("https://"), false);
});

test("release identity exposes only a verified SHA and deployment id", async () => {
  assert.deepEqual(
    readReleaseIdentity({
      VERCEL_GIT_COMMIT_SHA: "AABBCCDDEEFF00112233445566778899AABBCCDD",
      VERCEL_DEPLOYMENT_ID: " dpl_4qcvuVSWngmYY9yS9pGfhJg3mxiW ",
    }),
    {
      gitCommitSha: "aabbccddeeff00112233445566778899aabbccdd",
      vercelDeploymentId: "dpl_4qcvuVSWngmYY9yS9pGfhJg3mxiW",
    },
  );
  assert.deepEqual(readReleaseIdentity({}), {
    gitCommitSha: null,
    vercelDeploymentId: null,
  });
  assert.deepEqual(
    readReleaseIdentity({
      VERCEL_GIT_COMMIT_SHA: "36b11247",
      VERCEL_DEPLOYMENT_ID: "dpl_",
    }),
    {
      gitCommitSha: null,
      vercelDeploymentId: null,
    },
  );
  assert.deepEqual(
    readReleaseIdentity({
      VERCEL_GIT_COMMIT_SHA: "not-a-commit",
      VERCEL_DEPLOYMENT_ID: "https://example.invalid/secret",
    }),
    {
      gitCommitSha: null,
      vercelDeploymentId: null,
    },
  );

  const previousSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const previousDeploymentId = process.env.VERCEL_DEPLOYMENT_ID;
  process.env.VERCEL_GIT_COMMIT_SHA =
    "AABBCCDDEEFF00112233445566778899AABBCCDD";
  process.env.VERCEL_DEPLOYMENT_ID = "dpl_4qcvuVSWngmYY9yS9pGfhJg3mxiW";

  try {
    const response = await getReleaseIdentity();
    const payload: unknown = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(payload, {
      gitCommitSha: "aabbccddeeff00112233445566778899aabbccdd",
      vercelDeploymentId: "dpl_4qcvuVSWngmYY9yS9pGfhJg3mxiW",
    });

    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_DEPLOYMENT_ID;
    const missing = await getReleaseIdentity();
    assert.deepEqual(await missing.json(), {
      gitCommitSha: null,
      vercelDeploymentId: null,
    });
  } finally {
    if (previousSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previousSha;
    if (previousDeploymentId === undefined) {
      delete process.env.VERCEL_DEPLOYMENT_ID;
    } else {
      process.env.VERCEL_DEPLOYMENT_ID = previousDeploymentId;
    }
  }
});
