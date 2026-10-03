"use strict";

const fs = require("fs");
const path = require("path");
const dns = require("dns");

const ledgerPath = process.argv[2];
const resultsPath = process.argv[3];
if (!ledgerPath || !resultsPath) {
  process.stderr.write("usage: post_patch_sentinel_selftest.cjs <ledger> <results>\n");
  process.exit(2);
}

process.env.ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS = "1";
process.env.ACADEMY_NODE_LEDGER_PATH = ledgerPath;
process.env.NEXT_OTEL_FETCH_DISABLED = "1";

const results = [];

function finish(error) {
  const payload = {
    tests: results,
    error: error ? String(error && error.stack ? error.stack : error) : null,
  };
  fs.writeFileSync(resultsPath, JSON.stringify(payload, null, 2));
  const failed = results.filter((item) => !item.pass).length;
  process.stdout.write(`node_tests pass=${results.length - failed} fail=${failed}\n`);
  process.exit(failed || error ? 1 : 0);
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true, detail: "" });
  } catch (error) {
    results.push({
      name,
      pass: false,
      detail: error && error.stack ? error.stack : String(error),
    });
  }
}

async function main() {
  const fetchCalls = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    fetchCalls.push(String(input && input.url ? input.url : input));
    return new Response("stub", { status: 200 });
  };
  let lookupCalls = 0;
  const originalLookup = dns.lookup;
  dns.lookup = function countedLookup(...args) {
    lookupCalls += 1;
    return originalLookup.apply(this, args);
  };

  const preloadPath = path.join(__dirname, "academy-execution-preload.cjs");
  const source = fs.readFileSync(preloadPath, "utf8");
  const preload = require(preloadPath);

  await check("retired_identity_check_absent", async () => {
    if (source.includes("globalThis.fetch === interposer") || source.includes("globalThis.fetch === harness")) {
      throw new Error("retired fetch identity check is present");
    }
  });

  await check("vector_1024_contract_enforced", async () => {
    const good = preload.frozenVector("scenario");
    if (!preload.vectorValid(good)) throw new Error("frozen scenario vector is invalid");
    if (preload.vectorValid([1, 2, 3])) throw new Error("short vector was accepted");
    if (preload.vectorValid(new Array(1024).fill(Number.NaN))) throw new Error("non-finite vector was accepted");
  });

  await check("sentinel_failure_before_next_patch", async () => {
    const result = await preload.runSentinelProof();
    if (result.ok) throw new Error("sentinel passed before Next patched fetch");
    if (result.stop_class !== preload.STOP_CLASS) throw new Error(result.stop_class);
    if (result.reason !== "NEXT_PATCH_NOT_ACTIVE") throw new Error(result.reason);
  });

  await check("cohere_intercepted_locally_before_patch", async () => {
    const response = await globalThis.fetch(preload.COHERE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts: ["local-fixture"] }),
    });
    const payload = await response.json();
    const vector = payload.embeddings.float[0];
    if (response.status !== 200 || !preload.vectorValid(vector)) {
      throw new Error("cohere interposer did not return one 1024-vector");
    }
    if (payload.harness_sentinel) throw new Error("ordinary interposition carried the sentinel field");
    if (fetchCalls.some((url) => url.includes("api.cohere.com"))) {
      throw new Error("cohere request reached the original fetch");
    }
  });

  await check("non_allowlisted_fetch_fails_closed", async () => {
    const before = fetchCalls.length;
    await globalThis.fetch("https://example.com/outside").then(
      () => { throw new Error("example.com was allowed"); },
      (error) => {
        if (error.code !== "DEFAULT_DENY") throw error;
      },
    );
    if (fetchCalls.length !== before) throw new Error("denied fetch called the original fetch");
  });

  await check("live_deepseek_forbidden_during_implementation_tests", async () => {
    const before = fetchCalls.length;
    await globalThis.fetch("https://api.deepseek.com/chat/completions", { method: "POST" }).then(
      () => { throw new Error("deepseek was forwarded"); },
      (error) => {
        if (error.code !== "LIVE_PROVIDER_FORBIDDEN_IN_THIS_ACT") throw error;
      },
    );
    if (fetchCalls.length !== before) throw new Error("deepseek reached original fetch");
  });

  await check("loopback_fetch_passthrough_does_not_leave_stub_boundary", async () => {
    const response = await globalThis.fetch("http://127.0.0.1:9/rest/v1/academy_course_sources");
    if (response.status !== 200) throw new Error("loopback passthrough did not reach the stub");
    if (!fetchCalls.some((url) => url.startsWith("http://127.0.0.1:9/"))) {
      throw new Error("loopback URL was not passed through");
    }
  });

  await check("post_next_patch_sentinel_success", async () => {
    const { patchFetch } = require(path.join(
      process.env.NAVIGATOR_ROOT,
      "node_modules/next/dist/server/lib/patch-fetch.js",
    ));
    patchFetch({
      workAsyncStorage: { getStore() { return undefined; } },
      workUnitAsyncStorage: { getStore() { return undefined; } },
    });
    if (globalThis.fetch.__nextPatched !== true) throw new Error("Next patch marker is absent");
    if (globalThis.fetch === preload.interposer) {
      throw new Error("patched fetch is still the raw interposer; the retired check would be meaningless");
    }
    const result = await preload.runSentinelProof();
    if (!result.ok) throw new Error(JSON.stringify(result));
    if (result.fetch_is_interposer !== false) throw new Error("success required fetch identity");
    if (result.identity_check_used !== false) throw new Error("identity check was used");
    if (result.vector_length !== 1024 || result.cohere_socket_events !== 0) {
      throw new Error(JSON.stringify(result));
    }
    if (fetchCalls.some((url) => url.includes("api.cohere.com"))) {
      throw new Error("sentinel reached the original fetch");
    }
  });

  await check("sentinel_failure_when_response_omits_contract", async () => {
    const fake = async () => new Response(JSON.stringify({
      embeddings: { float: [new Array(3).fill(0.2)] },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    fake.__nextPatched = true;
    globalThis.fetch = fake;
    const result = await preload.runSentinelProof();
    if (result.ok) throw new Error("incomplete sentinel response passed");
    if (result.stop_class !== "COHERE_INTERPOSITION_STARTUP_PROOF_FAILURE") {
      throw new Error(result.stop_class || result.reason);
    }
  });

  await check("real_cohere_socket_attempt_denied", async () => {
    const before = lookupCalls;
    await new Promise((resolve, reject) => {
      dns.lookup("API.COHERE.COM.", (error) => {
        if (!error) reject(new Error("cohere lookup was allowed"));
        else if (error.code !== "COHERE_REAL_SOCKET_DENY") reject(error);
        else resolve();
      });
    });
    if (lookupCalls !== before) throw new Error("denied lookup called the original dns.lookup");
    await dns.promises.lookup("api.cohere.com").then(
      () => { throw new Error("promise lookup was allowed"); },
      (error) => {
        if (error.code !== "COHERE_REAL_SOCKET_DENY") throw error;
      },
    );
    await new Promise((resolve, reject) => {
      const socket = new (require("net").Socket)();
      socket.once("error", (error) => {
        if (error.code !== "COHERE_REAL_SOCKET_DENY") reject(error);
        else resolve();
      });
      socket.connect(443, "api.cohere.com");
    });
  });

  await check("ledger_covers_events_outside_the_sentinel_window", async () => {
    preload.flushLedger();
    const persisted = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    if (persisted.schema !== "NODE_PRELOAD_DNS_LOOKUP_AND_SOCKET_CONNECT_LEDGER_V1") {
      throw new Error("ledger schema");
    }
    if (persisted.process_lifetime !== true) throw new Error("ledger is not marked process-lifetime");
    const cohere = persisted.events.filter((event) => event.normalized_host === "api.cohere.com");
    if (cohere.length < 2) throw new Error(`expected cohere deny events, saw ${cohere.length}`);
    if (cohere.some((event) => event.decision !== "deny")) throw new Error("cohere ledger event was allowed");
    const hosts = new Set(cohere.map((event) => event.host));
    if (!hosts.has("API.COHERE.COM.")) throw new Error("trailing-dot host was not recorded");
  });

  if (nativeFetch) {
    // The stub remains the origin under the interposer. Do not restore a live fetch.
  }
  finish(null);
}

main().catch((error) => finish(error));
