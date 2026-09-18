export const NAVIGATOR_FAILURE_STAGES = [
  "ROUTER",
  "BINDINGS",
  "COHERE",
  "COURSE_RPC",
  "AUTHORITY",
  "EVIDENCE_LLM",
  "COMPOSER",
] as const;

export type NavigatorFailureStage =
  (typeof NAVIGATOR_FAILURE_STAGES)[number];

export type NavigatorFailureProvider =
  | "DEEPSEEK"
  | "SUPABASE"
  | "COHERE"
  | "LOCAL"
  | "UNKNOWN";

type SafeErrorMetadata = {
  errorName: string;
  errorCode: string | null;
  status: number | null;
};

export type NavigatorFailureLog = SafeErrorMetadata & {
  event: "NAVIGATOR_FAILURE";
  requestId: string;
  stage: NavigatorFailureStage | "UNKNOWN";
  provider: NavigatorFailureProvider;
};

export type NavigatorDegradationLog = SafeErrorMetadata & {
  event: "NAVIGATOR_DEGRADATION";
  requestId: string;
  stage: "EVIDENCE_LLM";
  provider: "DEEPSEEK";
  fallback: "INSUFFICIENT";
};

const PROVIDER_BY_STAGE: Record<
  NavigatorFailureStage,
  Exclude<NavigatorFailureProvider, "UNKNOWN">
> = {
  ROUTER: "DEEPSEEK",
  BINDINGS: "SUPABASE",
  COHERE: "COHERE",
  COURSE_RPC: "SUPABASE",
  AUTHORITY: "LOCAL",
  EVIDENCE_LLM: "DEEPSEEK",
  COMPOSER: "LOCAL",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeIdentifier(
  value: unknown,
  fallback: string | null,
): string | null {
  if (typeof value !== "string") return fallback;

  const candidate = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/u.test(candidate)) {
    return fallback;
  }

  return candidate;
}

function safeStatus(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599
    ? Number(value)
    : null;
}

function readSafeErrorMetadata(error: unknown): SafeErrorMetadata {
  const record = isRecord(error) ? error : {};
  const errorName =
    safeIdentifier(
      error instanceof Error ? error.name : record.name,
      "UnknownError",
    ) ?? "UnknownError";
  const errorCode = safeIdentifier(record.code, null);
  const status = safeStatus(record.status ?? record.statusCode);

  return {
    errorName,
    errorCode,
    status,
  };
}

export class NavigatorStageError extends Error {
  readonly stage: NavigatorFailureStage;
  readonly errorName: string;
  readonly errorCode: string | null;
  readonly status: number | null;

  constructor(stage: NavigatorFailureStage, originalError: unknown) {
    super(`Navigator stage failed: ${stage}.`);
    this.name = "NavigatorStageError";
    this.stage = stage;

    const metadata = readSafeErrorMetadata(originalError);
    this.errorName = metadata.errorName;
    this.errorCode = metadata.errorCode;
    this.status = metadata.status;
  }
}

export function isRecoverableEvidenceSelectionFailure(
  error: unknown,
): error is NavigatorStageError {
  return (
    error instanceof NavigatorStageError &&
    error.stage === "EVIDENCE_LLM" &&
    error.errorName === "CourseEvidenceSelectionError" &&
    error.errorCode === "INVALID_COURSE_EVIDENCE_SELECTION" &&
    error.status === null
  );
}

export function createNavigatorDegradationLog(
  error: unknown,
  requestId: string,
): NavigatorDegradationLog {
  if (!isRecoverableEvidenceSelectionFailure(error)) {
    throw new Error(
      "Only invalid course evidence selections may degrade to INSUFFICIENT.",
    );
  }

  return {
    event: "NAVIGATOR_DEGRADATION",
    requestId,
    stage: "EVIDENCE_LLM",
    provider: "DEEPSEEK",
    fallback: "INSUFFICIENT",
    errorName: error.errorName,
    errorCode: error.errorCode,
    status: error.status,
  };
}

export async function withNavigatorStage<T>(
  stage: NavigatorFailureStage,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof NavigatorStageError) {
      throw error;
    }

    throw new NavigatorStageError(stage, error);
  }
}

export function createNavigatorFailureLog(
  error: unknown,
  requestId: string,
): NavigatorFailureLog {
  if (error instanceof NavigatorStageError) {
    return {
      event: "NAVIGATOR_FAILURE",
      requestId,
      stage: error.stage,
      provider: PROVIDER_BY_STAGE[error.stage],
      errorName: error.errorName,
      errorCode: error.errorCode,
      status: error.status,
    };
  }

  const metadata = readSafeErrorMetadata(error);
  return {
    event: "NAVIGATOR_FAILURE",
    requestId,
    stage: "UNKNOWN",
    provider: "UNKNOWN",
    ...metadata,
  };
}
