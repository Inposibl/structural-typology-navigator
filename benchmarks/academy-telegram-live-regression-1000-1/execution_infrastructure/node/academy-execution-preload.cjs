"use strict";

/**
 * Benchmark-owned Node preload.
 *
 * Install before Next patches globalThis.fetch. Cohere POST
 * https://api.cohere.com/v2/embed is answered here. The dns/socket ledger
 * stays installed for the whole process and is evidence plus deny, not a
 * response mechanism. Identity equality between global fetch and the
 * interposer is not a success condition.
 */

const http = require("http");
const dns = require("dns");
const net = require("net");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MARK = Symbol.for("academy.execution.preload.installed");
if (globalThis[MARK]) {
  module.exports = globalThis.__academyExecutionPreload;
} else {
  globalThis[MARK] = true;

  const COHERE_URL = "https://api.cohere.com/v2/embed";
  const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
  const SENTINEL_HEADER = "x-academy-harness-cohere-sentinel";
  const SENTINEL_VALUE = "CORR2-SENTINEL-1";
  const STOP_CLASS = "COHERE_INTERPOSITION_STARTUP_PROOF_FAILURE";
  const VECTOR_DIM = 1024;

  const ledger = [];
  const fetchDecisions = [];
  const providerEvents = [];
  const armed = {
    scenario_id: null,
    attempt_number: null,
    chat_request_ordinal: null,
    course_id: null,
  };
  const attemptGate = {
    open: false,
    scenario_id: null,
    attempt_number: null,
  };
  const runBind = { generation: null, nonce: null };
  const preloadInstanceId = crypto.randomBytes(16).toString("hex");
  const ledgerInstanceId = crypto.randomBytes(16).toString("hex");
  const sentinelChallenge = process.env.ACADEMY_SENTINEL_CHALLENGE || "";
  let requestGeneration = 0;
  let interposerInvocationCount = 0;

  function captureRequestIdentity() {
    requestGeneration += 1;
    if (!attemptGate.open) {
      return {
        scenario_id: null,
        attempt_number: null,
        chat_request_ordinal: null,
        request_generation: requestGeneration,
        request_start_classification: "NO_ACTIVE_ATTEMPT_AT_REQUEST_START",
      };
    }
    if (armed.scenario_id == null || armed.attempt_number == null) {
      return {
        scenario_id: null,
        attempt_number: null,
        chat_request_ordinal: null,
        request_generation: requestGeneration,
        request_start_classification: "UNARMED_DURING_ACTIVE_ATTEMPT",
      };
    }
    return {
      scenario_id: armed.scenario_id,
      attempt_number: armed.attempt_number,
      chat_request_ordinal: armed.chat_request_ordinal,
      request_generation: requestGeneration,
      request_start_classification: "ARMED",
    };
  }

  function redactText(value) {
    return String(value)
      .replace(/bearer\s+\S+/gi, "[REDACTED_BEARER]")
      .replace(/sb_secret_\S+/gi, "[REDACTED_SUPABASE_SECRET]")
      .replace(/\bBasic\s+[A-Za-z0-9+/=]{4,}/gi, "[REDACTED_BASIC]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED_SK]");
  }

  function redactEvent(event) {
    if (!event || typeof event !== "object") return event;
    const drop = /authorization|api[_-]?key|apikey|secret|token|password|bearer/i;
    const sensitive = /(host|model|model_identifier|thread|task)/i;
    const shaped = /secret|bearer\s|sb_secret_|authorization:\s*basic|\bsk-/i;
    const out = Array.isArray(event) ? [] : {};
    Object.keys(event).forEach((key) => {
      // authorization_present is a boolean flag, not a credential value.
      if (drop.test(key) && key !== "authorization_present") return;
      const value = event[key];
      if (typeof value === "string" && sensitive.test(key) && shaped.test(value)) {
        out[key] = "[REDACTED_SENSITIVE_TEXT]";
        return;
      }
      if (Array.isArray(value) && sensitive.test(key)) {
        out[key] = value.map((entry) => {
          if (typeof entry === "string" && shaped.test(entry)) return "[REDACTED_SENSITIVE_TEXT]";
          if (typeof entry === "string") return redactText(entry);
          if (entry && typeof entry === "object") return redactEvent(entry);
          return entry;
        });
        return;
      }
      if (typeof value === "string") out[key] = redactText(value);
      else if (value && typeof value === "object") out[key] = redactEvent(value);
      else out[key] = value;
    });
    return out;
  }

  function isNextServerProcess() {
    const argv = process.argv.map((item) => String(item));
    const hasStart = argv.indexOf("start") !== -1;
    const hasNext = argv.some((arg) => arg === "next" || arg.indexOf("/next") !== -1);
    return hasStart && hasNext;
  }

  function currentFetchIs(candidate) {
    return globalThis.fetch === candidate;
  }

  function classifyProvider(fields) {
    const timeout = Boolean(fields.timeout);
    const http = fields.http_status == null || Number.isNaN(Number(fields.http_status))
      ? null
      : Number(fields.http_status);
    const auth = Boolean(fields.auth_failure) || http === 401 || http === 403;
    const malformed = Boolean(fields.malformed_response);
    const transport = fields.transport_error_class || null;
    if (timeout) return "PROVIDER_TIMEOUT";
    if (auth) return "PROVIDER_AUTH_FAILURE";
    if (malformed) return "PROVIDER_MALFORMED_RESPONSE";
    if (http === 429) return "PROVIDER_HTTP_429";
    if (Number.isInteger(http) && http >= 400 && http < 500) return "PROVIDER_HTTP_4XX";
    if (Number.isInteger(http) && http >= 500 && http <= 599) return "PROVIDER_HTTP_5XX";
    if (transport) return "PROVIDER_CONNECTION_FAILURE";
    if (http === 200) return "PRODUCT_RESPONSE_OBSERVED";
    return "OTHER_INFRA_FAILURE";
  }

  function localStubBase() {
    const raw = process.env.ACADEMY_LOCAL_PROVIDER_STUB || "";
    if (!raw) return null;
    try {
      const parsed = new URL(raw);
      if (!isStrictLoopback(normalizeHost(parsed.hostname))) return null;
      return parsed.origin;
    } catch (_err) {
      return null;
    }
  }
  const fixturePath = path.join(__dirname, "..", "contracts", "frozen_retrieval_fixtures.json");
  let frozenFixtures = {};
  try {
    const parsedFixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    frozenFixtures = parsedFixtures.fixtures || {};
  } catch (_err) {
    frozenFixtures = {};
  }

  function frozenVector(kind) {
    const vector = new Array(VECTOR_DIM);
    const salt = kind === "sentinel" ? 3 : 1;
    for (let index = 0; index < VECTOR_DIM; index += 1) {
      vector[index] = ((index * 17 + salt) % 997) / 997;
    }
    return vector;
  }

  function vectorValid(vector) {
    return Array.isArray(vector)
      && vector.length === VECTOR_DIM
      && vector.every((value) => typeof value === "number" && Number.isFinite(value));
  }

  function normalizeHost(host) {
    if (host == null) return "";
    let text = String(host).trim().toLowerCase();
    if (text.endsWith(".")) text = text.slice(0, -1);
    if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
    return text;
  }

  function isStrictLoopback(normalized) {
    if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") {
      return true;
    }
    const kind = net.isIP(normalized);
    if (kind === 4) return normalized === "127.0.0.1";
    if (kind === 6) return normalized === "::1";
    return false;
  }

  function liveProvidersForbidden(policy) {
    if (policy && Object.prototype.hasOwnProperty.call(policy, "forbidLiveProviders")) {
      return Boolean(policy.forbidLiveProviders);
    }
    return process.env.ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS === "1";
  }

  function decideHost(host, policy) {
    const normalized = normalizeHost(host);
    if (normalized === "api.cohere.com") {
      return { allow: false, reason: "COHERE_REAL_SOCKET_DENY", normalized_host: normalized };
    }
    if (isStrictLoopback(normalized)) {
      return { allow: true, reason: "LOOPBACK", normalized_host: normalized };
    }
    if (normalized === "api.deepseek.com") {
      if (liveProvidersForbidden(policy)) {
        return { allow: false, reason: "LIVE_PROVIDER_FORBIDDEN_IN_THIS_ACT", normalized_host: normalized };
      }
      return { allow: true, reason: "DEEPSEEK_CHAT_COMPLETIONS", normalized_host: normalized };
    }
    return { allow: false, reason: "DEFAULT_DENY", normalized_host: normalized };
  }

  function flushLedger() {
    const target = process.env.ACADEMY_NODE_LEDGER_PATH;
    if (!target) return;
    const body = JSON.stringify({
      schema: "NODE_PRELOAD_DNS_LOOKUP_AND_SOCKET_CONNECT_LEDGER_V1",
      process_lifetime: true,
      pid: process.pid,
      preload_instance_id: preloadInstanceId,
      ledger_instance_id: ledgerInstanceId,
      events: ledger.map((event) => redactEvent(event)),
      provider_events: providerEvents.map((event) => redactEvent(event)),
    });
    writeAtomic(target, body);
  }

  // Readers poll these files. A rename publishes complete bytes only, so a
  // concurrent reader never parses a partial JSON document.
  function writeAtomic(target, body) {
    const staging = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(staging, body);
    fs.renameSync(staging, target);
  }

  function record(operation, host, extra) {
    const decision = extra.decision || decideHost(host);
    const identity = extra.identity || captureRequestIdentity();
    ledger.push(redactEvent({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      operation,
      host: host == null ? null : String(host),
      normalized_host: decision.normalized_host,
      port: extra.port == null ? null : extra.port,
      tls_servername: extra.servername || null,
      decision: decision.allow ? "allow" : "deny",
      reason: decision.reason,
      scenario_id: identity.scenario_id,
      attempt_number: identity.attempt_number,
      chat_request_ordinal: identity.chat_request_ordinal,
      request_generation: identity.request_generation,
      request_start_classification: identity.request_start_classification || null,
    }));
    flushLedger();
    return decision;
  }

  function deniedError(reason) {
    const error = new Error(reason);
    error.code = reason;
    return error;
  }

  function wrapLookup(operation, original) {
    return function wrappedLookup(hostname, options, callback) {
      let opts = options;
      let cb = callback;
      if (typeof opts === "function") {
        cb = opts;
        opts = undefined;
      }
      const decision = record(operation, hostname, {});
      if (!decision.allow) {
        const error = deniedError(decision.reason);
        if (typeof cb === "function") {
          process.nextTick(() => cb(error));
          return undefined;
        }
        throw error;
      }
      if (typeof cb === "function") {
        return opts === undefined
          ? original.call(this, hostname, cb)
          : original.call(this, hostname, opts, cb);
      }
      return opts === undefined ? original.call(this, hostname) : original.call(this, hostname, opts);
    };
  }

  function wrapResolve(operation, original) {
    return function wrappedResolve(hostname, options, callback) {
      let opts = options;
      let cb = callback;
      if (typeof opts === "function") {
        cb = opts;
        opts = undefined;
      }
      const decision = record(operation, hostname, {});
      if (!decision.allow) {
        const error = deniedError(decision.reason);
        if (typeof cb === "function") {
          process.nextTick(() => cb(error));
          return undefined;
        }
        return Promise.reject(error);
      }
      if (typeof cb === "function") {
        return opts === undefined
          ? original.call(this, hostname, cb)
          : original.call(this, hostname, opts, cb);
      }
      return opts === undefined ? original.call(this, hostname) : original.call(this, hostname, opts);
    };
  }

  function wrapPromiseResolve(operation, original) {
    return async function wrappedPromiseResolve(hostname, options) {
      const decision = record(operation, hostname, {});
      if (!decision.allow) throw deniedError(decision.reason);
      return original.call(this, hostname, options);
    };
  }

  function wrapResolverMethod(operation, prototype, name) {
    const original = prototype[name];
    if (typeof original !== "function") return;
    prototype[name] = function wrappedResolverMethod(hostname, options, callback) {
      let opts = options;
      let cb = callback;
      if (typeof opts === "function") {
        cb = opts;
        opts = undefined;
      }
      const decision = record(operation, hostname, {});
      if (!decision.allow) {
        const error = deniedError(decision.reason);
        if (typeof cb === "function") {
          process.nextTick(() => cb(error));
          return undefined;
        }
        return Promise.reject(error);
      }
      if (typeof cb === "function") {
        return opts === undefined
          ? original.call(this, hostname, cb)
          : original.call(this, hostname, opts, cb);
      }
      return opts === undefined ? original.call(this, hostname) : original.call(this, hostname, opts);
    };
  }

  const originalLookup = dns.lookup;
  const originalPromiseLookup = dns.promises.lookup.bind(dns.promises);
  const originalResolve = dns.resolve;
  const originalResolve4 = dns.resolve4;
  const originalResolve6 = dns.resolve6;
  const originalPromiseResolve = dns.promises.resolve.bind(dns.promises);
  const originalPromiseResolve4 = dns.promises.resolve4.bind(dns.promises);
  const originalPromiseResolve6 = dns.promises.resolve6.bind(dns.promises);
  dns.lookup = wrapLookup("dns.lookup", originalLookup);
  dns.promises.lookup = async function wrappedPromiseLookup(hostname, options) {
    const decision = record("dns.promises.lookup", hostname, {});
    if (!decision.allow) throw deniedError(decision.reason);
    return originalPromiseLookup(hostname, options);
  };
  dns.resolve = wrapResolve("dns.resolve", originalResolve);
  dns.resolve4 = wrapResolve("dns.resolve4", originalResolve4);
  dns.resolve6 = wrapResolve("dns.resolve6", originalResolve6);
  dns.promises.resolve = wrapPromiseResolve("dns.promises.resolve", originalPromiseResolve);
  dns.promises.resolve4 = wrapPromiseResolve("dns.promises.resolve4", originalPromiseResolve4);
  dns.promises.resolve6 = wrapPromiseResolve("dns.promises.resolve6", originalPromiseResolve6);
  for (const name of ["resolve", "resolve4", "resolve6"]) {
    wrapResolverMethod(`dns.Resolver.${name}`, dns.Resolver.prototype, name);
    if (dns.promises.Resolver && dns.promises.Resolver.prototype) {
      wrapResolverMethod(`dns.promises.Resolver.${name}`, dns.promises.Resolver.prototype, name);
    }
  }

  function wrapResidual(operation) {
    return function wrappedResidual(...args) {
      const host = args[0];
      const callback = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
      const decision = record(operation, host, {});
      if (!decision.allow) {
        const error = deniedError(decision.reason);
        if (callback) {
          process.nextTick(() => callback(error));
          return undefined;
        }
        throw error;
      }
      if (callback) {
        process.nextTick(() => callback(null, []));
        return undefined;
      }
      return [];
    };
  }

  function wrapResidualPromise(operation) {
    return async function wrappedResidualPromise(...args) {
      const decision = record(operation, args[0], {});
      if (!decision.allow) throw deniedError(decision.reason);
      return [];
    };
  }

  function wrapResidualResolver(operation, prototype, name) {
    if (!prototype || typeof prototype[name] !== "function") return;
    prototype[name] = wrapResidual(operation);
  }

  const RESIDUAL_DNS = [
    "resolveAny", "resolveTxt", "resolveMx", "resolveNs", "resolveCname",
    "resolveSrv", "resolveSoa", "resolvePtr", "resolveCaa", "resolveNaptr",
    "reverse", "lookupService",
  ];
  for (const name of RESIDUAL_DNS) {
    if (typeof dns[name] === "function") dns[name] = wrapResidual(`dns.${name}`);
    if (dns.promises && typeof dns.promises[name] === "function") {
      dns.promises[name] = wrapResidualPromise(`dns.promises.${name}`);
    }
    wrapResidualResolver(`dns.Resolver.${name}`, dns.Resolver.prototype, name);
    if (dns.promises && dns.promises.Resolver && dns.promises.Resolver.prototype) {
      wrapResidualResolver(`dns.promises.Resolver.${name}`, dns.promises.Resolver.prototype, name);
    }
  }

  function unwrapOptions(value) {
    let current = value;
    for (let depth = 0; depth < 3; depth += 1) {
      if (!Array.isArray(current) || current.length === 0) break;
      current = current[0];
    }
    return current;
  }

  function parseEndpoint(args) {
    let first = args[0];
    if (Array.isArray(first)) first = unwrapOptions(first);
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const host = first.host || first.hostname || null;
      return {
        host,
        port: first.port == null ? null : first.port,
        servername: first.servername || null,
        ipc: Boolean(first.path) && !host,
      };
    }
    if (typeof first === "string" && Number.isNaN(Number(first))) {
      return { host: null, port: null, servername: null, ipc: true };
    }
    return {
      host: args[1] || null,
      port: first == null ? null : first,
      servername: null,
      ipc: false,
    };
  }

  function flattenConnectArgs(args) {
    const first = args[0];
    if (!Array.isArray(first)) return args;
    let current = first;
    let callback = typeof args[1] === "function" ? args[1] : null;
    for (let depth = 0; depth < 3 && Array.isArray(current); depth += 1) {
      if (typeof current[1] === "function") callback = current[1];
      current = current[0];
    }
    if (current && typeof current === "object" && !Array.isArray(current)) {
      return callback ? [current, callback] : [current];
    }
    return args;
  }

  const originalSocketConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function wrappedSocketConnect(...args) {
    const endpoint = parseEndpoint(args);
    if (endpoint.ipc) {
      record("net.Socket.prototype.connect", null, {
        decision: { allow: true, reason: "LOCAL_IPC", normalized_host: "" },
      });
      return originalSocketConnect.apply(this, flattenConnectArgs(args));
    }
    const decision = record("net.Socket.prototype.connect", endpoint.host, {
      port: endpoint.port,
      servername: endpoint.servername,
    });
    if (!decision.allow) {
      const error = deniedError(decision.reason);
      this.destroy();
      process.nextTick(() => this.emit("error", error));
      return this;
    }
    return originalSocketConnect.apply(this, flattenConnectArgs(args));
  };

  const originalTlsConnect = tls.connect;
  tls.connect = function wrappedTlsConnect(...args) {
    const endpoint = parseEndpoint(args);
    const decision = record("tls.connect", endpoint.servername || endpoint.host, {
      port: endpoint.port,
      servername: endpoint.servername,
    });
    if (!decision.allow) {
      throw deniedError(decision.reason);
    }
    return originalTlsConnect.apply(this, args);
  };

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function requestMethod(input, init) {
    const method = (init && init.method) || (input && input.method) || "GET";
    return String(method).toUpperCase();
  }

  function headerValue(input, init, name) {
    try {
      const headers = new Headers((init && init.headers) || undefined);
      const found = headers.get(name);
      if (found) return found;
      if (input && typeof input.headers?.get === "function") return input.headers.get(name);
    } catch (_err) {
      return null;
    }
    return null;
  }

  function fixtureStorageKey() {
    const ordinal = armed.chat_request_ordinal == null ? "null" : String(armed.chat_request_ordinal);
    return `${armed.scenario_id}/${armed.attempt_number}/${ordinal}/${armed.course_id}`;
  }

  function selectQueryVector(sentinel) {
    if (sentinel) return { vector: frozenVector("sentinel"), error: null };
    if (!armed.scenario_id) return { vector: frozenVector("scenario"), error: null };
    if (!armed.course_id) return { vector: null, error: "FIXTURE_COURSE_NOT_OBSERVED" };
    const fixture = frozenFixtures[fixtureStorageKey()];
    const vector = fixture && fixture.query_vector;
    if (!vectorValid(vector)) return { vector: null, error: "FIXTURE_VECTOR_MISSING" };
    return { vector, error: null };
  }

  function cohereResponse(sentinel) {
    const selected = selectQueryVector(sentinel);
    if (selected.error) {
      const error = deniedError(selected.error);
      throw error;
    }
    const headers = { "content-type": "application/json" };
    const body = { embeddings: { float: [selected.vector] } };
    if (sentinel) {
      headers[SENTINEL_HEADER] = SENTINEL_VALUE;
      body.harness_sentinel = SENTINEL_VALUE;
    }
    return new Response(JSON.stringify(body), { status: 200, headers });
  }

  function rememberCourse(parsed) {
    if (!parsed || parsed.pathname !== "/rest/v1/academy_course_sources") return;
    const raw = parsed.searchParams.get("course_id") || "";
    const match = /^eq\.(.+)$/.exec(raw);
    if (match) armed.course_id = match[1];
  }

  function recordProviderObservation(fields) {
    const httpStatus = fields.http_status == null ? null : Number(fields.http_status);
    const http = Number.isFinite(httpStatus) ? httpStatus : null;
    const timeout = Boolean(fields.timeout);
    const transport = fields.transport_error_class || null;
    const authFailure = Boolean(fields.auth_failure) || http === 401 || http === 403;
    const malformed = Boolean(fields.malformed_response);
    const model = fields.model_identifier || fields.model || null;
    const raw = classifyProvider({
      timeout,
      http_status: http,
      auth_failure: authFailure,
      malformed_response: malformed,
      transport_error_class: transport,
    });
    const stickyScenario = Object.prototype.hasOwnProperty.call(fields, "scenario_id");
    const stickyAttempt = Object.prototype.hasOwnProperty.call(fields, "attempt_number");
    const scenarioId = stickyScenario ? fields.scenario_id : armed.scenario_id;
    const attemptNumber = stickyAttempt ? fields.attempt_number : armed.attempt_number;
    const ordinal = Object.prototype.hasOwnProperty.call(fields, "chat_request_ordinal")
      ? fields.chat_request_ordinal
      : armed.chat_request_ordinal;
    const generation = Object.prototype.hasOwnProperty.call(fields, "request_generation")
      ? fields.request_generation
      : null;
    const event = redactEvent({
      provider_class: fields.provider_class || "DEEPSEEK",
      destination_class: fields.destination_class || "DEEPSEEK_CHAT_COMPLETIONS",
      scenario_id: scenarioId,
      attempt_number: attemptNumber,
      chat_request_ordinal: ordinal,
      request_generation: generation,
      request_start_classification: fields.request_start_classification || null,
      http_status: http,
      transport_error_class: transport,
      timeout,
      auth_failure: authFailure,
      malformed_response: malformed,
      raw_infrastructure_outcome: raw,
      provider_request_id: fields.provider_request_id || null,
      model_identifier: model,
      request_started_at: fields.request_started_at || null,
      request_finished_at: fields.request_finished_at || null,
      elapsed_ms: fields.elapsed_ms == null ? null : fields.elapsed_ms,
      body_sha256: fields.body_sha256 || null,
      authorization_present: Boolean(fields.authorization_present),
      synthetic_transport: Boolean(fields.synthetic_transport),
      HTTP_status: http,
      benchmark_scenario_id: scenarioId,
      benchmark_attempt_number: attemptNumber,
      timeout_class: timeout ? "PROVIDER_TIMEOUT" : null,
      model,
    });
    providerEvents.push(event);
    flushLedger();
    return event;
  }

  function observeLocalProvider(input, init) {
    const mode = headerValue(input, init, "x-academy-local-mode") || "http500";
    const base = localStubBase();
    const identity = captureRequestIdentity();
    let target = base + "/http500";
    if (mode === "timeout") target = base + "/timeout";
    if (mode === "delay") target = base + "/delay";
    if (mode === "connection-failure") target = "http://127.0.0.1:1/connection-failure";
    fetchDecisions.push({
      url: DEEPSEEK_URL,
      decision: "LOCAL_PROVIDER_STUB",
      mode,
      scenario_id: armed.scenario_id,
      attempt_number: armed.attempt_number,
      chat_request_ordinal: armed.chat_request_ordinal,
    });
    const started = new Date();
    const startedMs = Date.now();
    let model = null;
    let bodySha = null;
    try {
      const rawBody = init && init.body != null ? String(init.body) : "";
      bodySha = crypto.createHash("sha256").update(rawBody).digest("hex");
      model = JSON.parse(rawBody).model || null;
    } catch (_err) {
      model = null;
    }
    const localInit = Object.assign({}, init || {});
    if (mode === "timeout") {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 250);
      localInit.signal = controller.signal;
    }
    const fields = Object.assign({
      model,
      body_sha256: bodySha,
      authorization_present: authorizationPresent(input, init),
      synthetic_transport: true,
      request_started_at: started.toISOString(),
    }, identity);
    return Promise.resolve(originalFetch(target, localInit)).then((response) => {
      recordProviderObservation(Object.assign({}, fields, {
        request_finished_at: new Date().toISOString(),
        elapsed_ms: Date.now() - startedMs,
        http_status: response.status,
        provider_request_id: response.headers.get("x-request-id"),
      }));
      return response;
    }, (error) => {
      const aborted = Boolean(error && (error.name === "AbortError" || error.name === "TimeoutError"));
      recordProviderObservation(Object.assign({}, fields, {
        request_finished_at: new Date().toISOString(),
        elapsed_ms: Date.now() - startedMs,
        transport_error_class: error && error.name ? error.name : "Error",
        timeout: mode === "timeout" || aborted,
      }));
      throw error;
    });
  }

  function authorizationPresent(input, init) {
    const headers = (init && init.headers) || (input && input.headers) || null;
    if (!headers) return false;
    if (typeof headers.get === "function") return Boolean(headers.get("authorization"));
    const names = Object.keys(headers);
    return names.some((name) => String(name).toLowerCase() === "authorization" && headers[name]);
  }

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") {
    throw new Error("global fetch is required before the Cohere interposer can be installed");
  }

  function interposer(input, init) {
    interposerInvocationCount += 1;
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_err) {
      parsed = null;
    }
    const exact = parsed ? `${parsed.origin}${parsed.pathname}` : "";
    if (method === "POST" && exact === COHERE_URL && !parsed.search && !parsed.hash) {
      const sentinel = headerValue(input, init, SENTINEL_HEADER) === SENTINEL_VALUE;
      fetchDecisions.push({
        url: COHERE_URL,
        decision: "LOCAL_INTERPOSITION",
        sentinel,
      });
      return Promise.resolve().then(() => cohereResponse(sentinel));
    }
    const loopback = parsed && isStrictLoopback(normalizeHost(parsed.hostname));
    const deepseek = Boolean(parsed) && method === "POST" && exact === DEEPSEEK_URL && !parsed.search;
    if (loopback) {
      rememberCourse(parsed);
      fetchDecisions.push({ url: exact, decision: "LOOPBACK_PASSTHROUGH" });
      return originalFetch(input, init);
    }
    if (deepseek && !liveProvidersForbidden()) {
      fetchDecisions.push({ url: exact, decision: "DEEPSEEK_PASSTHROUGH" });
      const started = new Date();
      const startedMs = Date.now();
      let model = null;
      let bodySha = null;
      try {
        const rawBody = init && init.body != null ? String(init.body) : "";
        bodySha = crypto.createHash("sha256").update(rawBody).digest("hex");
        model = JSON.parse(rawBody).model || null;
      } catch (_err) {
        model = null;
      }
      const identity = captureRequestIdentity();
      return Promise.resolve(originalFetch(input, init)).then((response) => {
        recordProviderObservation(Object.assign({
          request_started_at: started.toISOString(),
          request_finished_at: new Date().toISOString(),
          elapsed_ms: Date.now() - startedMs,
          http_status: response.status,
          model,
          provider_request_id: response.headers.get("x-request-id"),
          body_sha256: bodySha,
          authorization_present: authorizationPresent(input, init),
        }, identity));
        return response;
      }, (error) => {
        recordProviderObservation(Object.assign({
          request_started_at: started.toISOString(),
          request_finished_at: new Date().toISOString(),
          elapsed_ms: Date.now() - startedMs,
          transport_error_class: error && error.name ? error.name : "Error",
          timeout: Boolean(error && (error.name === "TimeoutError" || error.code === "UND_ERR_CONNECT_TIMEOUT")),
          model,
          body_sha256: bodySha,
          authorization_present: authorizationPresent(input, init),
        }, identity));
        throw error;
      });
    }
    if (deepseek && liveProvidersForbidden() && localStubBase()) {
      return observeLocalProvider(input, init);
    }
    const host = parsed ? parsed.hostname : String(url || "");
    const decided = decideHost(host);
    const reason = deepseek ? "LIVE_PROVIDER_FORBIDDEN_IN_THIS_ACT" : decided.reason;
    record("fetch", host, {
      decision: { allow: false, reason, normalized_host: decided.normalized_host },
      port: parsed && parsed.port ? Number(parsed.port) : null,
    });
    fetchDecisions.push({
      url: exact || url,
      decision: "deny",
      reason,
      scenario_id: armed.scenario_id,
      attempt_number: armed.attempt_number,
      chat_request_ordinal: armed.chat_request_ordinal,
    });
    return Promise.reject(deniedError(reason));
  }

  interposer.__academyInterposer = true;
  globalThis.fetch = interposer;

  function arm(body) {
    armed.scenario_id = body.scenario_id == null ? null : String(body.scenario_id);
    armed.attempt_number = body.attempt_number == null ? null : body.attempt_number;
    armed.chat_request_ordinal = body.chat_request_ordinal == null ? null : body.chat_request_ordinal;
    armed.course_id = body.course_id == null ? null : String(body.course_id);
  }

  function disarm() {
    armed.scenario_id = null;
    armed.attempt_number = null;
    armed.chat_request_ordinal = null;
    armed.course_id = null;
  }

  function openAttempt(body) {
    attemptGate.open = true;
    attemptGate.scenario_id = body && body.scenario_id == null ? null : String(body.scenario_id);
    attemptGate.attempt_number = body && body.attempt_number == null ? null : body.attempt_number;
  }

  function closeAttempt() {
    attemptGate.open = false;
    attemptGate.scenario_id = null;
    attemptGate.attempt_number = null;
  }

  function bindRun(body) {
    runBind.generation = body && Object.prototype.hasOwnProperty.call(body, "generation") ? body.generation : null;
    runBind.nonce = body && body.nonce == null ? null : String(body.nonce);
  }

  function sentinelFacts() {
    return {
      pid: process.pid,
      next_server: isNextServerProcess(),
      bound_generation: runBind.generation,
      bound_nonce: runBind.nonce,
      ledger_event_count: ledger.length,
      fetch_is_current: Boolean(globalThis.fetch && globalThis.fetch.__nextPatched === true),
    };
  }

  function sentinelChallengeProof(requestNonce) {
    return crypto.createHash("sha256")
      .update(`${sentinelChallenge}:${requestNonce}:${preloadInstanceId}`)
      .digest("hex");
  }

  async function runSentinelProof(requestNonce) {
    const current = globalThis.fetch;
    const hitsBefore = interposerInvocationCount;
    if (!current || current.__nextPatched !== true) {
      return Object.assign({
        ok: false,
        stop_class: STOP_CLASS,
        reason: "NEXT_PATCH_NOT_ACTIVE",
        identity_check_used: false,
      }, sentinelFacts());
    }
    const before = ledger.filter((event) => event.normalized_host === "api.cohere.com").length;
    const controller = new AbortController();
    let response;
    try {
      response = await current(COHERE_URL, {
        method: "POST",
        headers: {
          Authorization: "Bearer benchmark-placeholder-not-a-secret",
          "content-type": "application/json",
          [SENTINEL_HEADER]: SENTINEL_VALUE,
        },
        body: JSON.stringify({ texts: ["sentinel-not-a-scenario-vector"] }),
        signal: controller.signal,
      });
    } catch (error) {
      return {
        ok: false,
        stop_class: STOP_CLASS,
        reason: error && error.message ? error.message : "sentinel-fetch-threw",
        identity_check_used: false,
      };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch (_err) {
      payload = null;
    }
    const vector = payload && payload.embeddings && payload.embeddings.float
      ? payload.embeddings.float[0]
      : null;
    const header = response.headers.get(SENTINEL_HEADER);
    const after = ledger.filter((event) => event.normalized_host === "api.cohere.com").length;
    const ok = response.status === 200
      && header === SENTINEL_VALUE
      && payload
      && payload.harness_sentinel === SENTINEL_VALUE
      && vectorValid(vector)
      && after === before;
    if (!ok) {
      return {
        ok: false,
        stop_class: STOP_CLASS,
        reason: "SENTINEL_CONTRACT_MISMATCH",
        identity_check_used: false,
        fetch_is_interposer: current === interposer,
        cohere_socket_events: after - before,
      };
    }
    const interposerInvoked = interposerInvocationCount > hitsBefore;
    const challenged = Boolean(sentinelChallenge);
    const proof = challenged ? sentinelChallengeProof(String(requestNonce || "")) : null;
    const facts = sentinelFacts();
    facts.fetch_is_current = challenged
      ? Boolean(current.__nextPatched === true && interposerInvoked)
      : Boolean(current.__nextPatched === true);
    return Object.assign(facts, {
      ok: true,
      stop_class: null,
      identity_check_used: false,
      fetch_is_interposer: current === interposer,
      vector_length: vector.length,
      harness_sentinel: payload.harness_sentinel,
      response_header: header,
      cohere_socket_events: 0,
      preload_instance_id: preloadInstanceId,
      ledger_instance_id: ledgerInstanceId,
      request_nonce: requestNonce == null ? null : String(requestNonce),
      challenge_echo: challenged ? sentinelChallenge : null,
      challenge_proof: proof,
      interposer_current: Boolean(current.__nextPatched === true && interposerInvoked),
    });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  const control = http.createServer((req, res) => {
    const send = (status, payload) => {
      const raw = Buffer.from(JSON.stringify(payload));
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": String(raw.length),
      });
      res.end(raw);
    };
    if (req.method === "GET" && req.url === "/health") {
      send(200, {
        ok: true,
        pid: process.pid,
        fetch_patched: Boolean(globalThis.fetch && globalThis.fetch.__nextPatched === true),
        next_server: isNextServerProcess(),
        argv_has_start: process.argv.map((item) => String(item)).indexOf("start") !== -1,
        argv_has_next: process.argv.map((item) => String(item)).some((arg) => arg === "next" || arg.indexOf("/next") !== -1),
        bound_generation: runBind.generation,
        bound_nonce: runBind.nonce,
        armed,
      });
      return;
    }
    if (req.method === "GET" && req.url === "/ledger") {
      send(200, {
        events: ledger,
        fetch_decisions: fetchDecisions,
        provider_events: providerEvents,
        armed,
        bound_generation: runBind.generation,
        bound_nonce: runBind.nonce,
      });
      return;
    }
    if (req.method === "POST" && req.url === "/probe-fetch") {
      readBody(req).then(async (raw) => {
        let requestBody = {};
        try {
          requestBody = JSON.parse(raw.toString("utf8") || "{}");
        } catch (error) {
          send(400, { ok: false, reason: error.message });
          return;
        }
        const started = Date.now();
        try {
          const response = await globalThis.fetch(requestBody.url, {
            method: requestBody.method || "GET",
            headers: requestBody.headers || undefined,
            body: requestBody.body == null ? undefined : (
              typeof requestBody.body === "string" ? requestBody.body : JSON.stringify(requestBody.body)
            ),
          });
          const text = await response.text();
          send(200, {
            ok: true,
            status: response.status,
            elapsed_ms: Date.now() - started,
            body: text.length > 200000 ? null : text,
            body_sha256: crypto.createHash("sha256").update(text).digest("hex"),
            body_length: Buffer.byteLength(text),
          });
        } catch (error) {
          send(200, {
            ok: false,
            error_code: error && error.code ? error.code : null,
            error_message: error && error.message ? error.message : String(error),
            elapsed_ms: Date.now() - started,
          });
        }
      }).catch((error) => send(400, { ok: false, reason: error.message }));
      return;
    }
    if (req.method === "POST" && req.url === "/arm") {
      readBody(req).then((raw) => {
        arm(JSON.parse(raw.toString("utf8") || "{}"));
        send(200, { armed });
      }).catch((error) => send(400, { ok: false, reason: error.message }));
      return;
    }
    if (req.method === "POST" && req.url === "/disarm") {
      disarm();
      send(200, { armed });
      return;
    }
    if (req.method === "POST" && req.url === "/attempt-open") {
      readBody(req).then((raw) => {
        openAttempt(JSON.parse(raw.toString("utf8") || "{}"));
        send(200, { attempt_open: attemptGate.open, attempt: attemptGate });
      }).catch((error) => send(400, { ok: false, reason: error.message }));
      return;
    }
    if (req.method === "POST" && req.url === "/attempt-close") {
      closeAttempt();
      send(200, { attempt_open: false });
      return;
    }
    if (req.method === "POST" && req.url === "/bind-run") {
      readBody(req).then((raw) => {
        bindRun(JSON.parse(raw.toString("utf8") || "{}"));
        send(200, { bound_generation: runBind.generation, bound_nonce: runBind.nonce, pid: process.pid });
      }).catch((error) => send(400, { ok: false, reason: error.message }));
      return;
    }
    if (req.method === "POST" && req.url === "/sentinel") {
      readBody(req).then((raw) => {
        let requestNonce = null;
        try {
          const parsed = JSON.parse(raw.toString("utf8") || "{}");
          requestNonce = parsed.request_nonce == null ? null : parsed.request_nonce;
        } catch (_err) {
          requestNonce = null;
        }
        return runSentinelProof(requestNonce);
      }).then((result) => send(result.ok ? 200 : 503, result))
        .catch((error) => send(503, { ok: false, reason: error && error.message ? error.message : "sentinel-failed" }));
      return;
    }
    send(404, { ok: false, reason: "not_found" });
  });
  control.listen(0, "127.0.0.1", () => {
    const address = control.address();
    const state = {
      host: "127.0.0.1",
      port: address.port,
      pid: process.pid,
      cohere_response_mechanism: "GLOBAL_FETCH_INTERPOSITION",
      ledger: "NODE_PRELOAD_DNS_LOOKUP_AND_SOCKET_CONNECT_LEDGER",
    };
    if (process.env.ACADEMY_EXECUTION_PRELOAD_STATE) {
      writeAtomic(process.env.ACADEMY_EXECUTION_PRELOAD_STATE, JSON.stringify(state));
    }
  });

  process.on("beforeExit", flushLedger);

  const api = {
    interposer,
    originalFetch,
    runSentinelProof,
    arm,
    disarm,
    openAttempt,
    closeAttempt,
    bindRun,
    classifyProvider,
    isNextServerProcess,
    ledger,
    fetchDecisions,
    flushLedger,
    frozenVector,
    vectorValid,
    decideHost,
    parseEndpoint,
    isStrictLoopback,
    recordProviderObservation,
    providerEvents,
    selectQueryVector,
    control,
    STOP_CLASS,
    COHERE_URL,
  };
  globalThis.__academyExecutionPreload = api;
  module.exports = api;
}
