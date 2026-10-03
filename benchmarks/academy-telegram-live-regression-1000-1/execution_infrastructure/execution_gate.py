"""Future controlled-execution gate.

This act implements the gate and refuses to run it. Scenario execution,
exact30, and full924 stay unauthorized. Parallel scenario execution is not
introduced.
"""

from __future__ import annotations

from . import PARALLEL_SCENARIO_EXECUTION, SCENARIO_EXECUTION_AUTHORIZED
from .controlled_next_mode import evaluate_commands
from .pd_f04_provider_evidence import adjudicate


class ScenarioExecutionForbidden(RuntimeError):
    pass


def execute_controlled(request: dict) -> dict:
    if request.get("run_scenario") or request.get("scenario_id"):
        raise ScenarioExecutionForbidden(
            "IMPLEMENTATION-1 does not execute benchmark scenarios, exact30, or full924"
        )
    if PARALLEL_SCENARIO_EXECUTION:
        raise ScenarioExecutionForbidden("parallel scenario execution is out of scope")
    mode = evaluate_commands(list(request.get("next_commands") or []))
    if not mode["ok"]:
        return {"status": "HOLD", "mode": mode, "adjudication": None}
    adjudication = adjudicate(
        request.get("native_evidence"),
        request.get("product_projection"),
    )
    return {
        "status": "GATE_ONLY",
        "scenarios_executed": 0,
        "parallel": False,
        "mode": mode,
        "adjudication": adjudication,
        "scenario_execution_authorized": SCENARIO_EXECUTION_AUTHORIZED,
    }
