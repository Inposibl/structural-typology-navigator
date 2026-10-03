"""Synthetic calibration adapter for the CORR2 attempt-aggregation probe.

The product response is a clean observation. Infrastructure failures are
published through the real attempt evidence path during execute.
"""

from __future__ import annotations

import os
import socket
from typing import Any

from harness.evidence import RawCapture


def synthetic_spec() -> dict[str, Any]:
    return {
        "scenario_id": "CORR2-SYNTHETIC-AGGREGATION",
        "track": "ALEXEY_INBOUND",
        "execution_level": "L2",
        "failure_class": "CORR2-SYNTHETIC",
        "seam_class": "RUNTIME",
        "seam_executable": True,
        "safe_to_execute": True,
        "adapter_id": "corr2_synthetic_infra_probe",
        "turns": [{"role": "user", "content": "synthetic infrastructure probe"}],
        "state_setup": {},
        "preconditions": {},
        "fault_schedule": [],
        "expected": {"act": "OUT_OF_SCOPE"},
        "oracle": [{"oracle": "act_equals", "params": {"expected_act": "OUT_OF_SCOPE"}}],
        "semantic_evaluation": {"required": False},
        "failure_mechanism": "synthetic infrastructure aggregation",
        "trigger": "synthetic",
        "observable_effect": "infrastructure dominates a clean product observation",
        "why_this_scenario_tests_this_class": "CORR2 attempt evidence reaches the runner verdict",
        "sut_binding": {"adapter_id": "corr2_synthetic_infra_probe", "symbols": ["synthetic"]},
    }


def synthetic_registry() -> dict[str, Any]:
    return {
        "adapters": {
            "corr2_synthetic_infra_probe": {
                "lane": "CALIBRATION",
                "implementation_class": "adapters.corr2_synthetic.SyntheticInfraProbeAdapter",
                "provenance_class": "SYNTHETIC_CALIBRATION",
                "native_observables": ["act"],
                "supported_failure_classes": ["CORR2-SYNTHETIC"],
                "real_fault_hooks": [],
            }
        }
    }


class SyntheticInfraProbeAdapter:
    def __init__(self, *, request: Any = None, token: Any = None, spec: Any = None) -> None:
        self.request = request
        self.token = token
        self.spec = spec

    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure.pd_f04_provider_evidence import installed_observer
        from execution_infrastructure.attempt_binding import (
            publish_lifecycle_report,
            publish_retrieval_evidence,
        )

        os.write(2, b"--- Logging error ---\n")
        try:
            socket.getaddrinfo("example.com", 443)
        except PermissionError:
            pass
        publish_retrieval_evidence({
            "classification": "RETRIEVAL_INFRA_FAILURE",
            "reason": "SYNTHETIC_RETRIEVAL_CONTRACT_FAILURE",
        })
        publish_lifecycle_report({
            "fail_closed": True,
            "status": "REMAINING_TASK",
            "remaining_task_count": 1,
            "continue_to_next_scenario": False,
        })
        observer = installed_observer()
        if observer is not None:
            observer.observe_synthetic_transport(http_status=500)
        else:
            from execution_infrastructure.pd_f04_provider_evidence import build_native_evidence
            from execution_infrastructure.attempt_binding import active_attempt, publish_provider_evidence

            attempt = active_attempt() or {}
            evidence = build_native_evidence(
                provider_class="DEEPSEEK",
                destination_class="DEEPSEEK_CHAT_COMPLETIONS",
                raw_infrastructure_outcome="PROVIDER_HTTP_5XX",
                benchmark_scenario_id=attempt.get("scenario_id"),
                benchmark_attempt_number=attempt.get("attempt_number"),
                http_status=500,
            )
            evidence["scenario_id"] = attempt.get("scenario_id")
            evidence["attempt_number"] = attempt.get("attempt_number")
            publish_provider_evidence(evidence)
        return RawCapture(
            values={"act": "OUT_OF_SCOPE", "output": "synthetic-ok"},
            transcripts={"turn": {"role": "assistant", "content": "synthetic-ok"}},
            sut_path="adapters/corr2_synthetic.py",
            sut_symbol="SyntheticInfraProbeAdapter.execute",
            outcome_class="OUT_OF_SCOPE",
            infra_failure=False,
            timeout_exceeded=False,
        )
