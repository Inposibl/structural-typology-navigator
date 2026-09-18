import assert from "node:assert/strict";
import test from "node:test";

import {
  createNavigatorFailureLog,
  NavigatorStageError,
  withNavigatorStage,
} from "../../src/lib/navigation/navigator-observability.ts";

test("navigator failure log contains only bounded safe metadata", async () => {
  const secretMarker = "synthetic-sensitive-marker-never-log";
  const upstream = Object.assign(
    new Error(`provider response contained ${secretMarker}`),
    {
      code: "UPSTREAM_ERROR",
      status: 401,
      responseBody: secretMarker,
    },
  );

  let captured: unknown;
  try {
    await withNavigatorStage("COHERE", async () => {
      throw upstream;
    });
  } catch (error) {
    captured = error;
  }

  assert.ok(captured instanceof NavigatorStageError);

  const log = createNavigatorFailureLog(captured, "request-123");
  assert.deepEqual(log, {
    event: "NAVIGATOR_FAILURE",
    requestId: "request-123",
    stage: "COHERE",
    provider: "COHERE",
    errorName: "Error",
    errorCode: "UPSTREAM_ERROR",
    status: 401,
  });

  const serialized = JSON.stringify(log);
  assert.equal(serialized.includes(secretMarker), false);
  assert.equal(serialized.includes("provider response contained"), false);
  assert.equal(serialized.includes("responseBody"), false);
});

test("unsafe error code text is discarded instead of logged", () => {
  const log = createNavigatorFailureLog(
    {
      name: "ProviderError",
      code: "secret value should never become a code",
      status: 502,
      message: "sensitive provider body",
    },
    "request-456",
  );

  assert.deepEqual(log, {
    event: "NAVIGATOR_FAILURE",
    requestId: "request-456",
    stage: "UNKNOWN",
    provider: "UNKNOWN",
    errorName: "ProviderError",
    errorCode: null,
    status: 502,
  });
});

test("outer stage wrapper preserves an already-classified inner stage", async () => {
  await assert.rejects(
    () =>
      withNavigatorStage("COURSE_RPC", () =>
        withNavigatorStage("BINDINGS", async () => {
          throw Object.assign(new Error("hidden"), {
            code: "UPSTREAM_ERROR",
            status: 503,
          });
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof NavigatorStageError);
      assert.equal(error.stage, "BINDINGS");
      assert.equal(error.errorCode, "UPSTREAM_ERROR");
      assert.equal(error.status, 503);
      return true;
    },
  );
});
