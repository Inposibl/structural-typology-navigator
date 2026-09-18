import assert from "node:assert/strict";
import test from "node:test";

import {
  callDeepSeekJson,
  callDeepSeekText,
} from "../../src/lib/navigation/deepseek-client.ts";

const TEST_ENV = {
  DEEPSEEK_API_KEY: "deepseek-test-key",
};

function jsonResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

test("DeepSeek JSON calls explicitly disable thinking mode", async () => {
  const bodies: Array<Record<string, unknown>> = [];

  const result = await callDeepSeekJson(
    [{ role: "user", content: "return JSON" }],
    {
      env: TEST_ENV,
      fetch: async (_input, init) => {
        bodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        return jsonResponse('{"ok":true}');
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(bodies.length, 1);

  const body = bodies[0];
  assert.equal(body.model, "deepseek-flash");
  assert.equal(body.stream, false);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.deepEqual(body.response_format, {
    type: "json_object",
  });
});

test("DeepSeek text calls explicitly disable thinking mode", async () => {
  const bodies: Array<Record<string, unknown>> = [];

  const result = await callDeepSeekText(
    [{ role: "user", content: "return text" }],
    {
      env: TEST_ENV,
      fetch: async (_input, init) => {
        bodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        return jsonResponse("ok");
      },
    },
  );

  assert.equal(result, "ok");
  assert.equal(bodies.length, 1);

  const body = bodies[0];
  assert.equal(body.model, "deepseek-flash");
  assert.equal(body.stream, false);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.response_format, undefined);
});
