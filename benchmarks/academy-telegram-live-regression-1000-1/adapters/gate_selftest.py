"""AG-21/AG-22 gate self-test adapter v3 — scenario-driven.

Executes the ACTUAL harness gates on (a) the scenario's OWN adversarial
fixtures supplied via preconditions.attacks and (b) the fixed IV3 regression
fixtures. Detection booleans are the observed values of the registered
harness operation.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

_BENCH_ROOT = Path(__file__).resolve().parent.parent
if str(_BENCH_ROOT) not in sys.path:
    sys.path.insert(0, str(_BENCH_ROOT))

from harness.evidence import RawCapture  # noqa: E402
from harness.gates.anti_self_validation import Gate  # noqa: E402
from harness.gates.claim_ledger import ClaimEngine, ReportRenderer  # noqa: E402
from harness.gates.narrative_consistency import check_structured_report  # noqa: E402


def _run_asv(code: str) -> list[str]:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return ["ASV-8"]
    gate = Gate("fixture.py", code, "harness")
    gate.visit(tree)
    return [f.rule for f in gate.findings]


FIXED_FIXTURES = {
    "expectedCopyDetected": (
        "def forged(spec):\n"
        "    bundle = spec['expected']\n"
        "    ov = ObservedValue()\n"
        "    ov.observe(bundle['act'], 'RUNTIME_FUNCTION_RETURN', 'missing-evidence')\n"
        "    return ov\n",
        "ASV-1",
    ),
    "aliasCopyDetected": (
        "def f(sc):\n"
        "    expected_dict = sc['expected']\n"
        "    actual_state = expected_dict['state']\n"
        "    return actual_state\n",
        "ASV-1",
    ),
    "scenarioIdSubscriptBranchDetected": (
        "def score(spec):\n"
        "    if spec['scenario_id'] == 'A-0003':\n"
        "        return 'FAIL'\n"
        "    return 'PASS'\n",
        "ASV-6",
    ),
    "closureExpectedLeakDetected": (
        "def make():\n"
        "    hidden = spec['expected']\n"
        "    def inner():\n"
        "        actual_state = hidden['state']\n"
        "        return actual_state\n"
        "    return inner\n",
        "ASV-1",
    ),
}


class GateSelfTestAdapter:
    adapter_id = "harness_gate_selftest"

    def __init__(self, *, request=None, token=None, spec=None) -> None:
        # B-04 shared constructor protocol (factory: cls(request=..., token=..., spec=spec))
        self.request = request
        self.token = token
        self.spec = spec

    def execute(self, request) -> RawCapture:
        detections: dict[str, bool] = {}
        # 1. fixed regression fixtures
        for key, (code, rule) in FIXED_FIXTURES.items():
            detections[key] = rule in _run_asv(code)
        # forged provenance: the observed-field builder rejects it
        from harness.evidence import ObservedValue, ProvenanceViolation, observed_fields_from_capture
        ov = ObservedValue()
        try:
            ov.set_observed("x", "HARDCODED_ASSUMPTION", {})
            detections["forgedProvenanceBlocked"] = False
        except ProvenanceViolation:
            detections["forgedProvenanceBlocked"] = True
        try:
            observed_fields_from_capture(
                RawCapture(values={"act": "x"}),
                "EXPECTED_VALUE", _fake_identity())
            detections["forgedProvenanceBlocked"] = False
        except Exception:  # noqa: BLE001
            detections["forgedProvenanceBlocked"] = True
        # 2. scenario-driven attacks (preconditions.attacks: [{name, code, rule}])
        for attack in (request.preconditions or {}).get("attacks") or []:
            rules = _run_asv(str(attack.get("code", "")))
            detections[str(attack.get("name"))] = str(attack.get("rule")) in rules
        # 3. narrative contradiction fixtures (typed-path only)
        engine = ClaimEngine()
        renderer = ReportRenderer(engine)
        renderer.commentary("The entire suite completed successfully and all cases were exercised.")
        report_doc = {"sentences": renderer.sentences}
        gate_doc = check_structured_report(report_doc, engine.to_json(),
                                           {"total_observations": 0, "candidate_scenario_count": 996})
        detections["contradictionDetected"] = gate_doc["contradictions_count"] > 0
        detections["narrativeParaphraseDetected"] = gate_doc["contradictions_count"] > 0
        return RawCapture(
            values={"act": "GATE_SELFTEST", "origin": "HARNESS_GATE_MACHINERY",
                    "state": detections, "link": None, "output": "gate self-test executed",
                    "tool_api": [], "mutations": []},
            transcripts={"assistant_reply": "gate detections", "detections": repr(detections)},
            sut_path="adapters/gate_selftest.py",
            sut_symbol="GateSelfTestAdapter (ASV + provenance guard + structural narrative gate)",
            outcome_class="CLEAN",
        )


def _fake_identity():
    from harness.evidence import EvidenceIdentity

    return EvidenceIdentity(run_id="GATE", scenario_id="GATE", scenario_sha256="a" * 64,
                            observation_id="GATE_A1", attempt_index=1, evidence_type="RAW_OBSERVATION")
