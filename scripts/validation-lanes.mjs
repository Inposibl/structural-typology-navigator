import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Deliberately exclude NODE_OPTIONS, npm config, provider and application variables.
export const SAFE_RUNTIME_KEYS = Object.freeze([
  "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME", "SHELL",
  "LANG", "LC_ALL", "LC_CTYPE", "CI",
]);

export function createSafeEnvironment(source = process.env) {
  const env = {};
  for (const key of SAFE_RUNTIME_KEYS) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  env.NEXT_TELEMETRY_DISABLED = "1";
  return env;
}

export function assertNoRuntimeEnvFiles(root = repositoryRoot) {
  // Only this documented template is exempt. Inspect names, never file values.
  const forbidden = fs.readdirSync(root).filter(
    (name) => name.startsWith(".env") && name !== ".env.example",
  ).sort();
  if (forbidden.length > 0) {
    throw new Error(`Runtime env file forbidden: ${forbidden.map((name) => path.join(root, name)).join(", ")}`);
  }
}

export function createLiveEnvironment(source = process.env) {
  const env = createSafeEnvironment(source);
  const required = [
    ["SUPABASE_URL"],
    ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    ["TELEGRAM_BOT_TOKEN", "BOT_TOKEN"],
    ["ENTITLEMENT_SUBJECT_SECRET"],
  ];
  for (const alternatives of required) {
    const key = alternatives.find((name) => source[name]?.trim());
    if (!key) throw new Error(`Missing live-smoke credential: ${alternatives.join(" or ")}`);
    env[key] = source[key];
  }
  return env;
}

function runChild(command, args, env) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, env, stdio: "inherit" });
  if (result.error) {
    console.error("Validation child could not start.");
    return 1;
  }
  if (result.signal) {
    console.error(`Validation child terminated by ${result.signal}.`);
    return 1;
  }
  return result.status ?? 1;
}

function main(mode) {
  if (mode === "canonical") {
    assertNoRuntimeEnvFiles();
    const env = createSafeEnvironment();
    for (const stage of ["typecheck", "test", "lint", "build"]) {
      const status = runChild("npm", ["run", stage], env);
      if (status !== 0) return status;
    }
    return 0;
  }
  if (mode === "live-smoke") {
    return runChild(process.execPath, [
      "--import", "tsx", "--test", "tests/live-smoke/tikhon-projection.live.mts",
    ], createLiveEnvironment());
  }
  throw new Error("Expected validation lane: canonical or live-smoke.");
}

// Imports let the intrinsic security build reuse the same boundary without running a lane.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Validation lane failed closed.");
    process.exitCode = 1;
  }
}
