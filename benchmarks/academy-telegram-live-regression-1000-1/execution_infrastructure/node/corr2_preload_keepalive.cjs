"use strict";

process.env.ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS = "1";
require("./academy-execution-preload.cjs");

const dns = require("dns");
const interposer = global.fetch;

function nextPatchedFetch(input, init) {
  return interposer(input, init);
}

nextPatchedFetch.__nextPatched = true;
nextPatchedFetch.__corr2DelegatingPatch = true;
global.fetch = nextPatchedFetch;

dns.lookup("example.com", () => {});
