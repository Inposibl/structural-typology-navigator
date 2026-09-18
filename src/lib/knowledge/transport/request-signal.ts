export type ServerRequestSignal = {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
};

// The timer stays armed until cleanup, so the timeout also covers response
// body consumption rather than only the initial fetch resolution.
export function createRequestSignal(
  externalSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): ServerRequestSignal {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const abortFromExternalSignal = () => controller.abort();
  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternalSignal, {
      once: true,
    });
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    },
  };
}
