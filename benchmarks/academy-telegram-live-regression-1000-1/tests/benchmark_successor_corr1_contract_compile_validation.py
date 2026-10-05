"""CORR1 compile-time contract validation tests — BENCHMARK-SUCCESSOR-
IMPLEMENTATION-1.CORR1.CONTRACT-COMPILE-VALIDATION-1.

Independent deterministic tests for the CORR1 blocking-IV1 correction: the
Owner-accepted successor contract requires a PRESENT non-mapping
expected_state to be rejected as a contract defect DURING COMPILATION — a
falsey malformed value can never escape through a truthiness fallback, and a
valid explicit mapping keeps predecessor precedence.

Every case invokes the ACTUAL compiler path (compile_scenario_contract on
complete specs derived from the real corpus seeds); no helper is tested in
isolation, no product runtime, no provider contact. Fully offline.

Results persist to the CORR1 evidence root as COMPILE_TIME_EXPECTED_STATE_
TESTS.json (override with argv[1]).
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

from harness.contract_compile import (  # noqa: E402
    MEASUREMENT_KINDS,
    AdapterCapability,
    compile_scenario_contract,
)

RESULTS: list[dict] = []


def test(name: str):
    def deco(fn):
        def wrapper():
            try:
                fn()
                RESULTS.append({"name": name, "pass": True, "detail": ""})
            except AssertionError as exc:
                RESULTS.append({"name": name, "pass": False,
                                "detail": f"AssertionError: {exc}"})
            except Exception as exc:  # noqa: BLE001
                RESULTS.append({"name": name, "pass": False,
                                "detail": f"{type(exc).__name__}: {exc}"})
        wrapper.__name__ = name
        TESTS.append(wrapper)
        return wrapper
    return deco


TESTS: list = []

CORR1_DEFECT = "non-mapping expected_state rejected at contract compilation"

# real corpus seed as the complete valid base spec
_BASE_SEED = None
for _line in (BENCH / "seeds" / "seeds_30_corrected.jsonl").read_text().splitlines():
    if _line.strip():
        _row = json.loads(_line)
        if _row["scenario_id"] == "B-0001":
            _BASE_SEED = _row
            break
assert _BASE_SEED is not None


def _base_spec() -> dict:
    return copy.deepcopy(_BASE_SEED)


def _state_subset_oracle(spec: dict) -> dict:
    for o in spec.get("oracle", []):
        if o.get("oracle") == "state_subset":
            return o
    raise AssertionError("base seed has no state_subset oracle")


def _compile(spec: dict, adapter_id: str | None = None):
    aid = adapter_id or spec.get("adapter_id") or "chatbot_l3_deep_link_start"
    return compile_scenario_contract(spec, AdapterCapability(aid))


def _rejects(spec: dict, label: str) -> None:
    cc = _compile(spec)
    assert not cc.compiled, f"{label}: compiled={cc.compiled} defects={cc.defects}"
    assert any(CORR1_DEFECT in d for d in cc.defects), \
        f"{label}: CORR1 defect missing from {cc.defects}"


# ---- family A: malformed non-mapping root rejection -------------------------

@test("A.malformed_non_mapping_roots_rejected_at_compile_time")
def _():
    for label, bad in (("nonempty_list", ["x"]), ("nonempty_string", "abc"),
                       ("float", 1.5), ("explicit_none", None),
                       ("integer_1", 1), ("true", True)):
        spec = _base_spec()
        _state_subset_oracle(spec)["params"]["expected_state"] = bad
        _rejects(spec, label)


# ---- family B: falsey malformed roots cannot escape the truthiness fallback --

@test("B.falsey_malformed_roots_rejected_at_compile_time")
def _():
    for label, bad in (("empty_list", []), ("empty_string", ""),
                       ("integer_0", 0), ("false", False), ("float_0", 0.0)):
        spec = _base_spec()
        _state_subset_oracle(spec)["params"]["expected_state"] = bad
        # every one of these is PRESENT and falsey: `value or {}` would convert
        # it into an empty mapping — compilation must still reject it
        _rejects(spec, label)


# ---- family C: valid nonempty mapping acceptance -----------------------------

@test("C.valid_nonempty_mapping_compiles")
def _():
    spec = _base_spec()
    cc = _compile(spec)
    assert cc.compiled, cc.defects
    assert not any(CORR1_DEFECT in d for d in cc.defects)


# ---- family D: valid empty mapping acceptance --------------------------------

@test("D.empty_mapping_expected_state_compiles")
def _():
    spec = _base_spec()
    spec["expected"] = {}
    _state_subset_oracle(spec)["params"]["expected_state"] = {}
    cc = _compile(spec)
    assert cc.compiled, cc.defects


# ---- family E: absent-state predecessor fallback -----------------------------

@test("E.absent_state_fallback_preserved")
def _():
    spec = _base_spec()
    spec["expected"] = {}
    _state_subset_oracle(spec)["params"].pop("expected_state", None)
    cc = _compile(spec)
    assert cc.compiled, cc.defects


# ---- family F: precedence — explicit value cannot be masked by a fallback ----

@test("F1.explicit_malformed_not_masked_by_valid_fallback")
def _():
    # §7 edge case: explicit expected_state = [] with a VALID fallback
    # spec.expected.state — the explicit malformed value must still be rejected
    spec = _base_spec()
    assert isinstance(spec["expected"]["state"], dict)  # valid fallback present
    _state_subset_oracle(spec)["params"]["expected_state"] = []
    _rejects(spec, "explicit_empty_list_with_valid_fallback")

    spec = _base_spec()
    _state_subset_oracle(spec)["params"]["expected_state"] = "malformed"
    _rejects(spec, "explicit_string_with_valid_fallback")

    spec = _base_spec()
    _state_subset_oracle(spec)["params"]["expected_state"] = None
    _rejects(spec, "explicit_none_with_valid_fallback")


@test("F2.explicit_valid_mapping_keeps_predecessor_precedence")
def _():
    # explicit valid mapping over an ABSENT fallback: the effective value is
    # the explicit mapping — no CORR1 defect, compilation succeeds
    spec = _base_spec()
    spec["expected"] = {}
    cc = _compile(spec)
    assert cc.compiled, cc.defects
    assert not any("must be a mapping" in d for d in cc.defects)


# ---- family G: metadata distinction unchanged --------------------------------

@test("G.metadata_distinction_unchanged")
def _():
    assert MEASUREMENT_KINDS["state_subset"] == "RECURSIVE_NESTED_MAPPING_SUBSET"
    assert MEASUREMENT_KINDS["concurrency_invariant"] == "SUBSET_EQUALITY"
    spec = _base_spec()
    cc = _compile(spec)
    kinds = {m["oracle_id"]: m["measurement_kind"] for m in cc.oracle_mapping}
    assert kinds["state_subset"] == "RECURSIVE_NESTED_MAPPING_SUBSET", kinds
    assert "concurrency_invariant" not in kinds or \
        kinds["concurrency_invariant"] == "SUBSET_EQUALITY"


# ---- family H: existing valid RC-B02 compilation still succeeds ---------------

@test("H.valid_rc_b02_shapes_still_compile")
def _():
    # nested mapping under the Tikhon base spec still compiles
    spec = _base_spec()
    spec["expected"] = {}
    _state_subset_oracle(spec)["params"]["expected_state"] = {
        "701100": {"selectedCourseId": "maslow"}}
    cc = _compile(spec)
    assert cc.compiled, cc.defects
    # mapping containing a LIST leaf still compiles
    spec = _base_spec()
    spec["expected"] = {}
    _state_subset_oracle(spec)["params"]["expected_state"] = {
        "catalogCourseContext": ["root", "maslow"]}
    cc = _compile(spec)
    assert cc.compiled, cc.defects
    # mapping containing a NULL leaf still compiles
    spec = _base_spec()
    spec["expected"] = {}
    _state_subset_oracle(spec)["params"]["expected_state"] = {"x": None}
    cc = _compile(spec)
    assert cc.compiled, cc.defects


def main() -> int:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        "/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/"
        "ACADEMY_TELEGRAM_BENCHMARK_SUCCESSOR_IMPLEMENTATION_1_CORR1")
    for fn in TESTS:
        fn()
    passed = sum(1 for r in RESULTS if r["pass"])
    (out_dir / "COMPILE_TIME_EXPECTED_STATE_TESTS.json").write_text(json.dumps({
        "schema": "CORR1_COMPILE_TIME_VALIDATION_TEST_RESULTS_V1",
        "families": ["A malformed non-mapping rejection",
                     "B falsey malformed rejection",
                     "C valid mapping acceptance",
                     "D empty mapping acceptance",
                     "E absent-state predecessor fallback",
                     "F precedence: explicit value cannot be masked",
                     "G metadata distinction unchanged",
                     "H valid RC-B02 shapes still compile"],
        "cases": RESULTS, "total": len(RESULTS), "passed": passed,
        "all_pass": passed == len(RESULTS)}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8")
    for r in RESULTS:
        print(("PASS " if r["pass"] else "FAIL ") + r["name"] +
              (f" — {r['detail']}" if r["detail"] else ""))
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
