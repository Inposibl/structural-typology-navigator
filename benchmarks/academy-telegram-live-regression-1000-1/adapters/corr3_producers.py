"""Calibration adapters that exercise real infrastructure producers.

Provider and retrieval evidence are not published from this module.
The Node preload and the loopback handler publish them.
"""

from __future__ import annotations

import json
import os
import socket
import threading
import time
import urllib.request
from typing import Any

from harness.evidence import RawCapture


def _post(url: str, payload: dict[str, Any], timeout: float = 10) -> dict[str, Any]:
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


def _arm() -> None:
    from execution_infrastructure.attempt_binding import arm_chat_request_for_active_attempt

    arm_chat_request_for_active_attempt("levels-of-consciousness")


def _probe_provider(mode: str, *, arm: bool = True) -> dict[str, Any]:
    if arm:
        _arm()
    return _post(_control() + "/probe-fetch", {
        "url": "https://api.deepseek.com/chat/completions",
        "method": "POST",
        "headers": {
            "content-type": "application/json",
            "x-academy-local-mode": mode,
        },
        "body": {"model": "local-stub", "messages": [{"role": "user", "content": "local"}]},
    }, timeout=8)


def _probe_retrieval(*, arm: bool = True) -> dict[str, Any]:
    if arm:
        _arm()
    loopback = os.environ["ACADEMY_CORR3_LOOPBACK_URL"]
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
        sut_path="adapters/corr3_producers.py",
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


class RealProviderHttp500Adapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        _probe_provider("http500")
        return _success("RealProviderHttp500Adapter.execute")


class RealProviderTimeoutAdapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        _probe_provider("timeout")
        return _success("RealProviderTimeoutAdapter.execute")


class RealProviderConnectionAdapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        _probe_provider("connection-failure")
        return _success("RealProviderConnectionAdapter.execute")


class RealRetrievalFailureAdapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        _probe_retrieval()
        return _success("RealRetrievalFailureAdapter.execute")


class RealFetchDenyAdapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        _arm()
        _post(_control() + "/probe-fetch", {
            "url": "https://api.telegram.org/bot",
            "method": "GET",
        })
        return _success("RealFetchDenyAdapter.execute")


class RealMultiFailureAdapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        os.write(2, b"--- Logging error ---\n")
        try:
            socket.getaddrinfo("example.com", 443)
        except PermissionError:
            pass
        _arm()
        _probe_provider("http500", arm=False)
        _probe_retrieval(arm=False)
        worker = threading.Thread(target=lambda: time.sleep(3), name="product-attempt-worker", daemon=False)
        worker.start()
        return _success("RealMultiFailureAdapter.execute")


class CleanSyntheticAdapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        return _success("CleanSyntheticAdapter.execute")


class RealFreezeInfraAdapter(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        os.write(2, b"--- Logging error ---\n")
        try:
            socket.getaddrinfo("example.com", 443)
        except PermissionError:
            pass
        return _success("RealFreezeInfraAdapter.execute")


def corr3_spec(scenario_id: str, adapter_id: str) -> dict[str, Any]:
    return {
        "scenario_id": scenario_id,
        "track": "ALEXEY_INBOUND",
        "execution_level": "L2",
        "failure_class": "CORR3-SYNTHETIC",
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
        "failure_mechanism": "real producer infrastructure aggregation",
        "trigger": "synthetic",
        "observable_effect": "infrastructure dominates or stays quiet",
        "why_this_scenario_tests_this_class": "CORR3 real producer reaches the runner verdict",
        "sut_binding": {"adapter_id": adapter_id, "symbols": ["synthetic"]},
    }


def corr3_registry() -> dict[str, Any]:
    rows = {
        "corr3_provider_http500": "adapters.corr3_producers.RealProviderHttp500Adapter",
        "corr3_provider_timeout": "adapters.corr3_producers.RealProviderTimeoutAdapter",
        "corr3_provider_connection": "adapters.corr3_producers.RealProviderConnectionAdapter",
        "corr3_retrieval_failure": "adapters.corr3_producers.RealRetrievalFailureAdapter",
        "corr3_fetch_deny": "adapters.corr3_producers.RealFetchDenyAdapter",
        "corr3_multi_failure": "adapters.corr3_producers.RealMultiFailureAdapter",
        "corr3_clean": "adapters.corr3_producers.CleanSyntheticAdapter",
        "corr3_freeze_infra": "adapters.corr3_producers.RealFreezeInfraAdapter",
    }
    return {
        "adapters": {
            key: {
                "lane": "CALIBRATION",
                "implementation_class": value,
                "provenance_class": "SYNTHETIC_CALIBRATION",
                "native_observables": ["act"],
                "supported_failure_classes": ["CORR3-SYNTHETIC"],
                "real_fault_hooks": [],
            }
            for key, value in rows.items()
        }
    }
