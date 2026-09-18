import { createHash } from "node:crypto";

const LOWERCASE_SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && LOWERCASE_SHA256_PATTERN.test(value);
}
