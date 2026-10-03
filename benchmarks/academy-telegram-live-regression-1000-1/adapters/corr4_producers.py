"""CORR4 calibration adapters.

These adapters do not publish provider or retrieval evidence. The Node
preload and the loopback handler publish what they observe. Unarmed
adapters clear request identity before the probe, so an event that fires
while the attempt is active has no request identity.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
from typing import Any

from harness.evidence import RawCapture

TEN_SECOND: dict[str, Any] = {}


def _post(url: str, payload: dict[str, Any], timeout: float = 8) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


def _control() -> str:
    state_path = os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"]
    state = json.loads(open(state_path, "r", encoding="utf-8").read())
    return f"http://127.0.0.1:{int(state['port'])}"


def _clear_request_identity() -> None:
    from execution_infrastructure.attempt_binding import disarm_request_identity

    disarm_request_identity()


def _probe_provider(mode: str) -> dict[str, Any]:
    return _post(_control() + "/probe-fetch", {
        "url": "https://api.deepseek.com/chat/completions",
        "method": "POST",
        "headers": {
            "content-type": "application/json",
            "x-academy-local-mode": mode,
        },
        "body": {"model": "local-stub", "messages": [{"role": "user", "content": "local"}]},
    }, timeout=8)


def _probe_retrieval() -> dict[str, Any]:
    loopback = os.environ["ACADEMY_CORR4_LOOPBACK_URL"]
    return _post(_control() + "/probe-fetch", {
        "url": loopback + "/rest/v1/rpc/match_course_knowledge_chunks",
        "method": "POST",
        "headers": {
            "content-type": "application/json",
            "apikey": "sb_secret_benchmark_placeholder",
        },
        "body": {
            "p_course_id": "levels-of-consciousness",
            "p_query_embedding": [0.0] * 1024,
            "p_match_count": 12,
            "p_match_threshold": -1,
        },
    })


def _success(symbol: str) -> RawCapture:
    return RawCapture(
        values={"act": "OUT_OF_SCOPE", "output": "synthetic-ok"},
        transcripts={"turn": {"role": "assistant", "content": "synthetic-ok"}},
        sut_path="adapters/corr4_producers.py",
        sut_symbol=symbol,
        outcome_class="OUT_OF_SCOPE",
        infra_failure=False,
        timeout_exceeded=False,
    )


class _Adapter:
    def __init__(self, *, request: Any = None, token: Any = None, spec: Any = None) -> None:
        self.request = request
        self.token = token
        self.spec = spec


class CleanSyntheticAdapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        return _success("CleanSyntheticAdapter.execute")


class ArmedProviderHttp500Adapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure.attempt_binding import arm_chat_request_for_active_attempt

        arm_chat_request_for_active_attempt("levels-of-consciousness")
        _probe_provider("http500")
        return _success("ArmedProviderHttp500Adapter.execute")


class ArmedRetrievalFailureAdapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure.attempt_binding import arm_chat_request_for_active_attempt

        arm_chat_request_for_active_attempt("levels-of-consciousness")
        _probe_retrieval()
        return _success("ArmedRetrievalFailureAdapter.execute")


class UnarmedDefaultDenyAdapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        _clear_request_identity()
        _post(_control() + "/probe-fetch", {
            "url": "https://api.telegram.org/bot",
            "method": "GET",
        })
        return _success("UnarmedDefaultDenyAdapter.execute")


class UnarmedProviderHttp500Adapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        _clear_request_identity()
        _probe_provider("http500")
        return _success("UnarmedProviderHttp500Adapter.execute")


class CancelledProductAdapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        import asyncio

        raise asyncio.CancelledError()


class TenSecondProductAdapter(_Adapter):
    """Real Alexey turn. The local transport pauses for about ten seconds.

    The turn is product-backed. A calibration label does not authorize it.
    """

    product_capabilities = (
        "ALEXEY_USER_TURN",
        "IMPORTS_CHATBOT_PRODUCT",
        "TIKHON_TEST_ROOT",
        "LEBEDEV_ADAPTER",
    )
    requires_authenticated_product_binding = True

    def execute(self, request: Any) -> RawCapture:
        from adapters.product import AlexeyUserTurnAdapter
        from execution_infrastructure.constants import CHATBOT_TEST_BASE
        from execution_infrastructure.product_capability import require_product_authority
        from harness.execution_request import build_execution_request

        require_product_authority(str(CHATBOT_TEST_BASE))

        spec = {
            "scenario_id": str(getattr(request, "scenario_id", "CORR4-ASYNC-10S")),
            "track": "ALEXEY_INBOUND",
            "execution_level": "L2",
            "adapter_id": "alexey_user_turn",
            "turns": [{"role": "user", "content": "local synthetic ten second turn"}],
            "preconditions": {
                "navigator_transport": "stubbed",
                "user_id": 701001,
                "message_id": 11,
                "concurrency_schedule": {"provider_pause_s": 10},
            },
            "provider_fixture": {"contention_schedule": {"provider_pause_s": 10}},
            "state_setup": {},
            "fault_schedule": [],
        }
        inner = build_execution_request(
            spec,
            adapter_id="alexey_user_turn",
            run_id=str(getattr(request, "run_id", "corr4-async")),
            attempt=int(getattr(request, "attempt", 1)),
            scenario_sha256="c" * 64,
            navigator_test_root=str(CHATBOT_TEST_BASE),
            tikhon_test_root=str(CHATBOT_TEST_BASE),
            execution_environment={},
        )
        started = time.monotonic()
        capture = AlexeyUserTurnAdapter().execute(inner)
        TEN_SECOND.clear()
        TEN_SECOND["elapsed_s"] = round(time.monotonic() - started, 3)
        TEN_SECOND["outcome_class"] = getattr(capture, "outcome_class", None)
        TEN_SECOND["capture_error"] = getattr(capture, "capture_error", None)
        return capture


class StaleWindowAdapter(_Adapter):
    """Join an in-flight attempt-A request while this attempt is B."""

    holder: dict[str, Any] = {}

    def execute(self, request: Any) -> RawCapture:
        _clear_request_identity()
        thread = self.holder.get("thread")
        if thread is not None:
            thread.join(timeout=8)
        return _success("StaleWindowAdapter.execute")


def corr4_spec(scenario_id: str, adapter_id: str) -> dict[str, Any]:
    return {
        "scenario_id": scenario_id,
        "track": "ALEXEY_INBOUND",
        "execution_level": "L2",
        "failure_class": "CORR4-SYNTHETIC",
        "seam_class": "RUNTIME",
        "seam_executable": True,
        "safe_to_execute": True,
        "adapter_id": adapter_id,
        "turns": [{"role": "user", "content": "synthetic infrastructure probe"}],
        "state_setup": {},
        "preconditions": {},
        "fault_schedule": [],
        "expected": {"act": "OUT_OF_SCOPE"},
        "oracle": [{"oracle": "act_equals", "params": {"expected_act": "OUT_OF_SCOPE"}}],
        "semantic_evaluation": {"required": False},
        "failure_mechanism": "corr4 infrastructure precedence",
        "trigger": "synthetic",
        "observable_effect": "infrastructure dominates or stays quiet",
        "why_this_scenario_tests_this_class": "CORR4 real producer reaches the runner verdict",
        "sut_binding": {"adapter_id": adapter_id, "symbols": ["synthetic"]},
    }


def corr4_registry() -> dict[str, Any]:
    rows = {
        "corr4_clean": "adapters.corr4_producers.CleanSyntheticAdapter",
        "corr4_armed_http500": "adapters.corr4_producers.ArmedProviderHttp500Adapter",
        "corr4_armed_retrieval": "adapters.corr4_producers.ArmedRetrievalFailureAdapter",
        "corr4_unarmed_deny": "adapters.corr4_producers.UnarmedDefaultDenyAdapter",
        "corr4_unarmed_http500": "adapters.corr4_producers.UnarmedProviderHttp500Adapter",
        "corr4_cancelled": "adapters.corr4_producers.CancelledProductAdapter",
        "corr4_ten_second": "adapters.corr4_producers.TenSecondProductAdapter",
        "corr4_stale_window": "adapters.corr4_producers.StaleWindowAdapter",
    }
    return {
        "adapters": {
            key: {
                "lane": "CALIBRATION",
                "implementation_class": value,
                "provenance_class": "SYNTHETIC_CALIBRATION",
                "native_observables": ["act"],
                "supported_failure_classes": ["CORR4-SYNTHETIC"],
                "real_fault_hooks": [],
            }
            for key, value in rows.items()
        }
    }
