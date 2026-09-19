/**
 * Package-B A21 technical-failure taxonomy.
 *
 * A runtime, provider, or data-access failure is classified coarsely and
 * recorded in structured state so a later turn can retry or hand off with the
 * conversation intact. The classification is internal: no label defined here is
 * ever rendered to the user, and none of them is a semantic verdict.
 */

import {
  MAX_TECHNICAL_ERROR_STAGE_LENGTH,
  toSessionTimestamp,
  type TechnicalErrorState,
  type TechnicalFailureClass,
} from "./conversation-state.ts";
import { NavigatorStageError } from "./navigator-observability.ts";

export type TechnicalFailureClassification = {
  failureClass: TechnicalFailureClass;
  retryable: boolean;
  stage: string;
};

const RETRYABLE: Record<TechnicalFailureClass, boolean> = {
  PROVIDER_TIMEOUT: true,
  PROVIDER_UNAVAILABLE: true,
  CONFIGURATION_FAILURE: false,
  DATA_ACCESS_FAILURE: true,
  INTERNAL_RUNTIME_FAILURE: true,
  UNKNOWN_TECHNICAL_FAILURE: true,
};

/**
 * Provider client codes mapped to their coarse class. These are the codes the
 * existing bounded provider abstraction raises; no new provider integration is
 * introduced here.
 */
const PROVIDER_CODE_CLASSES: Record<string, TechnicalFailureClass> = {
  ABORTED: "PROVIDER_TIMEOUT",
  NETWORK_ERROR: "PROVIDER_UNAVAILABLE",
  UPSTREAM_ERROR: "PROVIDER_UNAVAILABLE",
  INVALID_RESPONSE: "PROVIDER_UNAVAILABLE",
  CONFIGURATION_ERROR: "CONFIGURATION_FAILURE",
};

const TIMEOUT_CODE_PATTERN = /abort|timeout|timedout|etimedout/iu;
/**
 * Transport-level codes only. Deliberately narrow: a data-stage code such as
 * `RPC_UNAVAILABLE` must not be read as a provider outage.
 */
const NETWORK_CODE_PATTERN =
  /network|econnrefused|econnreset|enotfound|ehostunreach|eai_again|socket|dns|fetch\s*failed/iu;

/** Stages whose failures are data-access rather than provider failures. */
const DATA_STAGES = new Set(["BINDINGS", "COURSE_RPC"]);

/** Unauthorized/forbidden upstream responses are configuration, not load. */
const AUTH_STATUSES = new Set([401, 403]);

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function readCode(error: unknown): string | null {
  for (const candidate of [asRecord(error).code, asRecord(error).errorCode]) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate.slice(0, MAX_TECHNICAL_ERROR_STAGE_LENGTH);
    }
  }

  return null;
}

function readStatus(error: unknown): number | null {
  const record = asRecord(error);
  const status = record.status ?? record.statusCode;

  return Number.isInteger(status) ? Number(status) : null;
}

function readStage(error: unknown): string {
  const record = asRecord(error);
  const stage = record.stage;

  if (typeof stage === "string" && stage.length > 0) {
    return stage.slice(0, MAX_TECHNICAL_ERROR_STAGE_LENGTH);
  }

  const name = error instanceof Error ? error.name : record.name;
  return typeof name === "string" && name.length > 0
    ? name.slice(0, MAX_TECHNICAL_ERROR_STAGE_LENGTH)
    : "UNKNOWN";
}

/**
 * Coarse classification of one failure (A21). Only the failure's own identity
 * is consulted — never its message, which may carry provider or credential
 * material that must not be copied into state.
 */
export function classifyTechnicalFailure(
  error: unknown,
): TechnicalFailureClassification {
  const code = readCode(error);
  const stage = readStage(error);

  const finish = (
    failureClass: TechnicalFailureClass,
  ): TechnicalFailureClassification => ({
    failureClass,
    retryable: RETRYABLE[failureClass],
    stage,
  });

  if (code !== null) {
    const mapped = PROVIDER_CODE_CLASSES[code];
    if (mapped !== undefined) {
      const status = readStatus(error);
      if (
        mapped === "PROVIDER_UNAVAILABLE" &&
        status !== null &&
        AUTH_STATUSES.has(status)
      ) {
        return finish("CONFIGURATION_FAILURE");
      }

      return finish(mapped);
    }

    if (TIMEOUT_CODE_PATTERN.test(code)) return finish("PROVIDER_TIMEOUT");
    if (NETWORK_CODE_PATTERN.test(code)) return finish("PROVIDER_UNAVAILABLE");
  }

  if (error instanceof NavigatorStageError) {
    return finish(
      DATA_STAGES.has(stage) ? "DATA_ACCESS_FAILURE" : "INTERNAL_RUNTIME_FAILURE",
    );
  }

  if (error instanceof Error) return finish("INTERNAL_RUNTIME_FAILURE");

  return finish("UNKNOWN_TECHNICAL_FAILURE");
}

export function buildTechnicalErrorState(
  error: unknown,
  nowMs: number,
): TechnicalErrorState {
  const classification = classifyTechnicalFailure(error);

  return {
    failureClass: classification.failureClass,
    occurredAt: toSessionTimestamp(nowMs),
    retryable: classification.retryable,
    stage: classification.stage,
  };
}
