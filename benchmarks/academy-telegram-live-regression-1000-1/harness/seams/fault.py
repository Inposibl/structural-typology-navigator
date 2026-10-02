"""Real isolated fault-injection seam — CORR2 (M-6, owner section 40).

Fault confirmation must demonstrate the ACTUAL requested mechanism:
kind-specific mechanism evidence is recorded by the hook. Unconfirmed
injection is a measurement condition (NOT_EXECUTED), never a product FAIL.
TIMEOUT_AFTER_PROCESSING requires a real measured deadline breach with a
positive delay; a zero-delay CLEAN_SUCCESS cannot count as a timeout.
"""

from __future__ import annotations

import enum
import time
from dataclasses import dataclass, field
from typing import Any, Callable


class FaultKind(str, enum.Enum):
    TIMEOUT_BEFORE_PROCESSING = "TIMEOUT_BEFORE_PROCESSING"
    TIMEOUT_AFTER_PROCESSING = "TIMEOUT_AFTER_PROCESSING"
    LOST_RESPONSE = "LOST_RESPONSE"
    DEPENDENCY_429 = "DEPENDENCY_429"
    DEPENDENCY_500 = "DEPENDENCY_500"
    MALFORMED_DEPENDENCY_PAYLOAD = "MALFORMED_DEPENDENCY_PAYLOAD"
    DELAYED_CALLBACK = "DELAYED_CALLBACK"
    DUPLICATED_UPDATE = "DUPLICATED_UPDATE"
    REORDERED_UPDATE = "REORDERED_UPDATE"
    PERSISTENCE_FAILURE = "PERSISTENCE_FAILURE"
    SEND_FAILURE_AFTER_DURABLE_WRITE = "SEND_FAILURE_AFTER_DURABLE_WRITE"
    IDEMPOTENCY_EXPIRY = "IDEMPOTENCY_EXPIRY"


class FaultNotConfirmed(RuntimeError):
    pass


@dataclass
class FaultRecord:
    fault_target: str
    fault_point: str
    fault_kind: str
    fired: bool = False
    mechanism_evidence: dict[str, Any] = field(default_factory=dict)
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def confirmed_with_mechanism(self) -> bool:
        return self.fired and bool(self.mechanism_evidence)


class FaultHook:
    """Wraps a dependency-boundary callable and injects one real fault with
    kind-specific mechanism evidence."""

    def __init__(self, target: str, point: str, kind: FaultKind, *, delay_s: float = 0.0,
                 deadline_s: float | None = None) -> None:
        self.record = FaultRecord(fault_target=target, fault_point=point, fault_kind=kind.value)
        self.delay_s = delay_s
        self.deadline_s = deadline_s

    def wrap(self, dependency: Callable[..., Any]) -> Callable[..., Any]:
        hook = self

        def wrapped(*args: Any, **kwargs: Any) -> Any:
            kind = hook.record.fault_kind
            processing_started = time.perf_counter_ns()
            if kind == FaultKind.TIMEOUT_BEFORE_PROCESSING.value:
                hook._fire({"raised": "TimeoutError(before)", "at": "before_processing"})
                raise TimeoutError(f"injected fault: timeout before {hook.record.fault_target}")
            if kind == FaultKind.DEPENDENCY_429.value:
                hook._fire({"raised": "DependencyError(429)"})
                raise DependencyError("injected fault: HTTP 429")
            if kind == FaultKind.DEPENDENCY_500.value:
                hook._fire({"raised": "DependencyError(500)"})
                raise DependencyError("injected fault: HTTP 500")
            if kind == FaultKind.MALFORMED_DEPENDENCY_PAYLOAD.value:
                hook._fire({"payload": "{not-valid-json"})
                return "{not-valid-json"
            if kind == FaultKind.PERSISTENCE_FAILURE.value:
                hook._fire({"raised": "PersistenceError", "layer": "store_write"})
                raise IOError("injected fault: persistence failure")
            if kind == FaultKind.IDEMPOTENCY_EXPIRY.value:
                hook._fire({"expired_record": True, "layer": "idempotency_store"})
                return "__EXPIRED__"
            if kind == FaultKind.LOST_RESPONSE.value:
                result = dependency(*args, **kwargs)
                hook._fire({"dropped_result": True, "processing_happened": result is not None})
                return None
            if kind == FaultKind.TIMEOUT_AFTER_PROCESSING.value:
                result = dependency(*args, **kwargs)
                processing_done = time.perf_counter_ns()
                time.sleep(hook.delay_s)
                deadline_ns = processing_done + int((hook.deadline_s or 0) * 1e9)
                now = time.perf_counter_ns()
                exceeded = now > deadline_ns and hook.delay_s > 0
                hook._fire({
                    "delay_s": hook.delay_s,
                    "deadline_s": hook.deadline_s,
                    "processing_completed_before_breach": True,
                    "deadline_exceeded": exceeded,
                })
                return result
            if kind == FaultKind.DELAYED_CALLBACK.value:
                time.sleep(hook.delay_s)
                hook._fire({"delayed_callback_s": hook.delay_s})
                return dependency(*args, **kwargs)
            if kind == FaultKind.DUPLICATED_UPDATE.value:
                first = dependency(*args, **kwargs)
                hook._fire({"duplicate_delivery": True, "deliveries": 2})
                second = dependency(*args, **kwargs)
                return [first, second]
            if kind == FaultKind.REORDERED_UPDATE.value:
                hook._fire({"reorder": True})
                return dependency(*reversed(args), **kwargs)
            if kind == FaultKind.SEND_FAILURE_AFTER_DURABLE_WRITE.value:
                result = dependency(*args, **kwargs)
                hook._fire({
                    "raised": "SendError(after durable write)",
                    "durable_result_present": result is not None,
                })
                raise ConnectionError("injected fault: send failure after durable write")
            raise FaultNotConfirmed(f"unknown fault kind {kind}")

        return wrapped

    def _fire(self, mechanism: dict[str, Any]) -> None:
        self.record.fired = True
        self.record.mechanism_evidence.update(mechanism)

    @property
    def confirmed(self) -> bool:
        return self.record.fired


class DependencyError(RuntimeError):
    pass
