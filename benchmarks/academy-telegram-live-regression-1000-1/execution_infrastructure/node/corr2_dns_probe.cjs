"use strict";

const dns = require("dns");
const fs = require("fs");

const resultsPath = process.argv[2];
if (!resultsPath) {
  process.stderr.write("usage: corr2_dns_probe.cjs <results>\n");
  process.exit(2);
}

process.env.ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS = "1";
require("./academy-execution-preload.cjs");

const NAMES = [
  "resolveAny", "resolveTxt", "resolveMx", "resolveNs", "resolveCname",
  "resolveSrv", "resolveSoa", "resolvePtr", "resolveCaa", "resolveNaptr",
  "reverse", "lookupService",
];

const results = [];

function finish(error) {
  const payload = {
    tests: results,
    error: error ? String(error && error.stack ? error.stack : error) : null,
  };
  fs.writeFileSync(resultsPath, JSON.stringify(payload));
  const failed = results.filter((item) => !item.pass).length;
  process.stdout.write(`corr2_dns pass=${results.length - failed} fail=${failed}\n`);
  process.exit(failed || error ? 1 : 0);
}

function hostFor(name) {
  if (name === "lookupService" || name === "reverse") return "8.8.8.8";
  return "example.com";
}

function callArgs(name, host) {
  if (name === "lookupService") return [host, 53];
  return [host];
}

function expectDeny(operation, fn) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ pass: false, detail: "timed out; original DNS may have been called" });
    }, 1000);
    Promise.resolve()
      .then(fn)
      .then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ pass: false, detail: "call was allowed" });
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const code = error && (error.code || error.message);
        const elapsed = Date.now() - started;
        resolve({
          pass: code === "DEFAULT_DENY" && elapsed < 1000,
          detail: `${operation} code=${code} elapsed_ms=${elapsed}`,
        });
      });
  });
}

async function main() {
  for (const name of NAMES) {
    if (typeof dns[name] !== "function") {
      results.push({ name: `module.${name}`, pass: false, detail: "missing" });
    } else {
      const host = hostFor(name);
      const outcome = await expectDeny(`dns.${name}`, () => dns[name](...callArgs(name, host)));
      results.push({ name: `module.${name}`, pass: outcome.pass, detail: outcome.detail });
    }
    if (!dns.promises || typeof dns.promises[name] !== "function") {
      results.push({ name: `promises.${name}`, pass: true, detail: "unsupported" });
    } else {
      const host = hostFor(name);
      const outcome = await expectDeny(`dns.promises.${name}`, () => dns.promises[name](...callArgs(name, host)));
      results.push({ name: `promises.${name}`, pass: outcome.pass, detail: outcome.detail });
    }
    const prototype = dns.Resolver && dns.Resolver.prototype;
    if (!prototype || typeof prototype[name] !== "function") {
      results.push({ name: `resolver.${name}`, pass: true, detail: "unsupported" });
    } else {
      const host = hostFor(name);
      const resolver = new dns.Resolver();
      const outcome = await expectDeny(`dns.Resolver.${name}`, () => resolver[name](...callArgs(name, host)));
      results.push({ name: `resolver.${name}`, pass: outcome.pass, detail: outcome.detail });
    }
  }
  finish(null);
}

main().catch((error) => finish(error));
