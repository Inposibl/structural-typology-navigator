"""Explicit handoff from each real infrastructure producer into the attempt.

The verifier can answer, for a producer, where its event is handed to the
active attempt. Registration is the handoff itself, not a side comment.
"""

from __future__ import annotations

from typing import Any


PRODUCERS: dict[str, dict[str, str]] = {
    "NODE_PROVIDER_OBSERVER": {
        "emits": "execution_infrastructure/node/academy-execution-preload.cjs recordProviderObservation",
        "handoff": "attempt_binding._collect_node_window normalizes provider_events into the active attempt",
    },
    "NODE_FETCH_DENY_OBSERVER": {
        "emits": "execution_infrastructure/node/academy-execution-preload.cjs fetch deny record()",
        "handoff": "attempt_binding._collect_node_window publishes material denies as attempt node evidence",
    },
    "SUPABASE_LOOPBACK": {
        "emits": "execution_infrastructure/pd_f05_loopback.py LoopbackSupabaseDouble.Handler",
        "handoff": "pd_f05_loopback.LoopbackSupabaseDouble._remember -> attempt_binding.publish_retrieval_evidence",
    },
    "PYTHON_ISOLATION": {
        "emits": "execution_infrastructure/pd_f06_isolation.py guarded socket and open",
        "handoff": "attempt_binding.finish_attempt copies new isolation denies into python_violations",
    },
    "PD_F06_LIFECYCLE": {
        "emits": "execution_infrastructure/pd_f06_lifecycle.py AttemptBoundary.finish",
        "handoff": "attempt_binding.finish_attempt stores boundary.finish as attempt lifecycle",
    },
    "OS_F04": {
        "emits": "execution_infrastructure/os_f04_streams.py process stderr tee",
        "handoff": "attempt_binding.finish_attempt stores os_f04_report_since on the attempt",
    },
    "GENERIC_TIMEOUT_TRANSPORT": {
        "emits": "runner wall budget and canonical provider timeout classification",
        "handoff": "attempt_binding.publish_timeout_evidence and normalize_provider_event",
    },
}

_HANDOFFS: list[dict[str, Any]] = []


def note_handoff(producer: str, detail: dict[str, Any] | None = None) -> None:
    if producer not in PRODUCERS:
        raise KeyError(producer)
    _HANDOFFS.append({"producer": producer, "detail": dict(detail or {})})


def handoffs() -> list[dict[str, Any]]:
    return list(_HANDOFFS)


def clear_handoffs() -> None:
    _HANDOFFS.clear()


def handoff_for(producer: str) -> dict[str, str]:
    return dict(PRODUCERS[producer])
