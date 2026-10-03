"use strict";

const http = require("http");
const net = require("net");
const dns = require("dns");
const fs = require("fs");
const path = require("path");

const resultsPath = process.argv[2];
if (!resultsPath) {
  process.stderr.write("usage: corr1_loopback_probe.cjs <results>\n");
  process.exit(2);
}

process.env.ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS = "1";
process.env.NEXT_OTEL_FETCH_DISABLED = "1";

const results = [];

function finish(error) {
  const payload = {
    tests: results,
    error: error ? String(error && error.stack ? error.stack : error) : null,
  };
  fs.writeFileSync(resultsPath, JSON.stringify(payload, null, 2));
  const failed = results.filter((item) => !item.pass).length;
  process.stdout.write(`corr1_node pass=${results.length - failed} fail=${failed}\n`);
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
  const preload = require(path.join(__dirname, "academy-execution-preload.cjs"));
  const fixtures = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "contracts", "frozen_retrieval_fixtures.json"),
    "utf8",
  ));
  const fixtureKey = "A-0005/1/1/levels-of-consciousness";
  const expected = fixtures.fixtures[fixtureKey].query_vector;

  await check("strict_loopback_policy", async () => {
    if (preload.decideHost("127.iv-bypass.invalid").allow) throw new Error("prefix host allowed");
    if (preload.decideHost("127.0.0.2").allow) throw new Error("127.0.0.2 allowed");
    if (!preload.decideHost("127.0.0.1").allow) throw new Error("127.0.0.1 denied");
    if (!preload.decideHost("::1").allow) throw new Error("::1 denied");
    if (!preload.decideHost("localhost").allow) throw new Error("localhost denied");
    const future = preload.decideHost("api.deepseek.com", { forbidLiveProviders: false });
    if (!future.allow || future.reason !== "DEEPSEEK_CHAT_COMPLETIONS") throw new Error(JSON.stringify(future));
    if (preload.decideHost("api.deepseek.com").allow) throw new Error("live deepseek allowed during CORR1");
    const missing = preload.parseEndpoint([{ port: 9 }]);
    if (missing.host) throw new Error("missing host was invented");
    if (preload.decideHost(missing.host).allow) throw new Error("null host allowed");
    const normalized = preload.parseEndpoint([[{ host: "127.0.0.1", port: 9 }, null]]);
    if (normalized.host !== "127.0.0.1" || Number(normalized.port) !== 9) {
      throw new Error(JSON.stringify(normalized));
    }
  });

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("loopback-ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  await check("real_fetch_loopback", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/fetch`);
    const text = await response.text();
    if (response.status !== 200 || text !== "loopback-ok") {
      throw new Error(`${response.status} ${text}`);
    }
  });

  await check("http_get_loopback", async () => {
    await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/get`, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200 || text !== "loopback-ok") reject(new Error(text));
          else resolve();
        });
      });
      req.setTimeout(3000, () => {
        req.destroy();
        reject(new Error("http.get timed out"));
      });
      req.on("error", reject);
    });
  });

  await check("normalized_socket_connect_loopback", async () => {
    await new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", reject);
      socket.connect([{ host: "127.0.0.1", port }]);
    });
  });

  await check("prefix_host_denied_before_dns", async () => {
    await new Promise((resolve, reject) => {
      dns.lookup("127.iv-bypass.invalid", (error) => {
        if (!error) reject(new Error("prefix host lookup was allowed"));
        else if (error.code !== "DEFAULT_DENY") reject(error);
        else resolve();
      });
    });
  });

  await check("dns_resolver_resolve4_denied", async () => {
    const resolver = new dns.Resolver();
    await new Promise((resolve, reject) => {
      resolver.resolve4("example.com", (error) => {
        if (!error) reject(new Error("Resolver.resolve4 was allowed"));
        else if (error.code !== "DEFAULT_DENY") reject(error);
        else resolve();
      });
    });
  });

  await check("dns_promises_resolve4_denied", async () => {
    await dns.promises.resolve4("example.com").then(
      () => { throw new Error("promises.resolve4 was allowed"); },
      (error) => {
        if (error.code !== "DEFAULT_DENY") throw error;
      },
    );
  });

  await check("non_loopback_connect_denied", async () => {
    await new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.once("error", (error) => {
        if (error.code !== "DEFAULT_DENY") reject(error);
        else resolve();
      });
      socket.connect(80, "example.com");
    });
  });

  await check("armed_fixture_vector_not_global", async () => {
    preload.arm({ scenario_id: "A-0005", attempt_number: 1, chat_request_ordinal: 1 });
    const unobserved = preload.selectQueryVector(false);
    if (unobserved.error !== "FIXTURE_COURSE_NOT_OBSERVED") throw new Error(JSON.stringify(unobserved));
    const bindings = await fetch(
      `http://127.0.0.1:${port}/rest/v1/academy_course_sources?course_id=eq.levels-of-consciousness&is_active=eq.true`,
    );
    if (bindings.status !== 200) throw new Error("bindings fetch failed");
    await bindings.text();
    const selected = preload.selectQueryVector(false);
    if (!preload.vectorValid(selected.vector)) throw new Error(selected.error || "vector invalid");
    if (JSON.stringify(selected.vector) !== JSON.stringify(expected)) {
      throw new Error("armed vector is not the fixture vector");
    }
    const cohere = await fetch("https://api.cohere.com/v2/embed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts: ["local"], model: "embed-multilingual-v3.0" }),
    });
    const payload = await cohere.json();
    if (payload.harness_sentinel) throw new Error("armed response carried the sentinel");
    if (JSON.stringify(payload.embeddings.float[0]) !== JSON.stringify(expected)) {
      throw new Error("cohere interposer did not return the armed fixture vector");
    }
    preload.arm({ scenario_id: "A-0005", attempt_number: 1, chat_request_ordinal: 1 });
    const cleared = preload.selectQueryVector(false);
    if (cleared.error !== "FIXTURE_COURSE_NOT_OBSERVED") throw new Error("arm did not clear course_id");
  });

  await check("provider_observation_keeps_no_secret", async () => {
    const event = preload.recordProviderObservation({
      http_status: 200,
      elapsed_ms: 4,
      model: "deepseek-chat",
      provider_request_id: "req-synthetic",
      body_sha256: "abc",
      authorization_present: true,
    });
    const encoded = JSON.stringify(event);
    if (encoded.includes("Bearer ") || encoded.includes("Authorization") || encoded.includes("sb_secret_")) {
      throw new Error(encoded);
    }
    if (event.authorization_present !== true || event.provider_request_id !== "req-synthetic") {
      throw new Error(encoded);
    }
  });

  server.close();
  if (preload.control) preload.control.close();
  finish(null);
}

main().catch((error) => finish(error));
