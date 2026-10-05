"""CORR2 scope-and-F02-preservation tests — BENCHMARK-SUCCESSOR-IMPLEMENTATION-1.
CORR2.SCOPE-AND-F02-PRESERVATION-1.

Closes the two CORR1 test-design gaps identified by the Owner and reattests
the corrected scope, entirely at the ACTUAL compiler path
(compile_scenario_contract on complete specs derived from the real corpus
seeds). No helper is tested in isolation, no product runtime, no provider
contact, fully offline.

Coverage contract (Owner act sections 8-11):
  family A/B  state_subset malformed roots (incl. falsey) -> compile-time
              defect, never TypeError, never an `or {}` escape (sections 3, 11)
  family C    state_subset valid shapes compile (section 11)
  family D    GENUINE precedence competition: explicit valid mapping vs a
              DIFFERENT valid fallback mapping, both present, distinguishable
              keys/values (section 8 / test-gap 1). The fallback is never
              removed to make the test pass.
  family E    metadata PRESENCE and exact value for state_subset AND
              concurrency_invariant (section 9 / test-gap 2) — absence is a
              failure, not a skip.
  family F    unrelated state-adjudicator families keep failed-predecessor
              behavior: the IV1 malformed-root probe (params.expected_state=1)
              raises TypeError exactly (section 10)
  family G    guard-scope contrast: the same malformed root is a compile-time
              defect on state_subset but a TypeError on decision_kind

Results persist to the CORR2 evidence root (override with argv[1]):
  CORR2_TEST_RESULTS.json, EXPLICIT_VALID_MAPPING_PRECEDENCE_TEST.json,
  METADATA_PRESENCE_TEST.json, UNRELATED_STATE_ADJUDICATOR_PRESERVATION.json
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
PRECEDENCE: list[dict] = []
METADATA: list[dict] = []
UNRELATED: list[dict] = []
TESTS: list = []

CORR1_DEFECT = "non-mapping expected_state rejected at contract compilation"
PREDECESSOR_TYPEERROR = "'int' object is not iterable"

_SEEDS: dict[str, dict] = {}
for _line in (BENCH / "seeds" / "seeds_30_corrected.jsonl").read_text().splitlines():
    if _line.strip():
        _row = json.loads(_line)
        _SEEDS[_row["scenario_id"]] = _row
assert "B-0001" in _SEEDS and "A-0011" in _SEEDS


def _base_spec(sid: str = "B-0001") -> dict:
    return copy.deepcopy(_SEEDS[sid])


def _oracle(spec: dict, family: str) -> dict:
    for o in spec.get("oracle", []):
        if o.get("oracle") == family:
            return o
    raise AssertionError(f"spec has no {family} oracle")


def _compile(spec: dict):
    aid = spec.get("adapter_id") or "chatbot_l3_deep_link_start"
    return compile_scenario_contract(spec, AdapterCapability(aid))


def test(name: str, bucket: list = None):
    target = bucket if bucket is not None else RESULTS

    def deco(fn):
        def wrapper():
            try:
                fn()
                target.append({"name": name, "pass": True, "detail": ""})
            except AssertionError as exc:
                target.append({"name": name, "pass": False,
                               "detail": f"AssertionError: {exc}"})
            except Exception as exc:  # noqa: BLE001
                target.append({"name": name, "pass": False,
                               "detail": f"{type(exc).__name__}: {exc}"})
        wrapper.__name__ = name
        TESTS.append(wrapper)
        return wrapper
    return deco


# ---- family A: state_subset malformed roots rejected at compile time ---------

@test("A.state_subset_malformed_roots_rejected_at_compile_time")
def _():
    for label, bad in (("empty_list", []), ("nonempty_list", ["x"]),
                       ("empty_string", ""), ("scalar_string", "scalar"),
                       ("int_0", 0), ("int_1", 1), ("float_0_0", 0.0),
                       ("float_1_5", 1.5), ("false", False), ("true", True),
                       ("explicit_null", None)):
        spec = _base_spec()
        _oracle(spec, "state_subset")["params"]["expected_state"] = bad
        cc = _compile(spec)
        assert not cc.compiled, f"{label}: compiled=True defects={cc.defects}"
        assert any(CORR1_DEFECT in d for d in cc.defects), \
            f"{label}: compile-time defect missing from {cc.defects}"


# ---- family B: falsey malformed roots cannot escape a truthiness fallback ----

@test("B.falsey_roots_never_escape_or_fallback")
def _():
    for label, bad in (("empty_list", []), ("empty_string", ""), ("int_0", 0),
                       ("float_0_0", 0.0), ("false", False),
                       ("explicit_null", None)):
        spec = _base_spec()
        _oracle(spec, "state_subset")["params"]["expected_state"] = bad
        # every value here is PRESENT and falsey: `value or {}` would silently
        # convert it to an empty mapping — compilation must still reject it
        cc = _compile(spec)
        assert not cc.compiled and any(CORR1_DEFECT in d for d in cc.defects), \
            f"{label}: falsey root escaped: compiled={cc.compiled} {cc.defects}"


# ---- family C: state_subset valid shapes still compile (section 11) ----------

@test("C.state_subset_valid_shapes_compile")
def _():
    # absent on BOTH sources (explicit params value and expected.state
    # fallback) retains the predecessor empty-mapping behavior — same
    # construction as the historical CORR1 test family E
    spec = _base_spec()
    spec["expected"] = {}
    _oracle(spec, "state_subset")["params"].pop("expected_state", None)
    cc = _compile(spec)
    assert cc.compiled, f"absent expected_state: {cc.defects}"

    for label, es in (("empty_mapping", {}), ("nonempty_mapping",
                                                {"catalogCourseContext": "root"}),
                      ("nested_mapping", {"701100": {"selectedCourseId": "maslow"}}),
                      ("null_leaf", {"x": None}),
                      ("list_leaf", {"catalogCourseContext": ["root", "maslow"]})):
        spec = _base_spec()
        spec["expected"] = {}
        _oracle(spec, "state_subset")["params"]["expected_state"] = copy.deepcopy(es)
        cc = _compile(spec)
        assert cc.compiled, f"{label}: {cc.defects}"
        assert not any(CORR1_DEFECT in d for d in cc.defects)


# ---- family D: GENUINE explicit-vs-fallback precedence competition (§8) ------

@test("D1.explicit_valid_mapping_wins_over_different_valid_fallback")
def _():
    # explicit params.expected_state = A, fallback spec.expected.state = B;
    # A and B have distinguishable keys AND values; BOTH remain present.
    spec = _base_spec()
    fallback = {"beta_declared": 2}
    explicit = {"alpha_explicit": 1}
    spec["expected"]["state"] = copy.deepcopy(fallback)
    _oracle(spec, "state_subset")["params"]["expected_state"] = copy.deepcopy(explicit)
    # the fallback MUST stay present — the competition is meaningless without it
    assert spec["expected"]["state"] == {"beta_declared": 2}
    assert _oracle(spec, "state_subset")["params"]["expected_state"] == \
        {"alpha_explicit": 1}

    cc = _compile(spec)
    # the compiler adjudicated through the EXPLICIT mapping: the declared
    # fallback key finds no adjudicator and is reported as such
    assert not cc.compiled, f"expected F02 failure, got compiled=True {cc.defects}"
    assert any("expected.state.beta_declared compiles to NO adjudicator" in d
               for d in cc.defects), f"fallback key not unadjudicated: {cc.defects}"
    assert any("['beta_declared']" in d for d in cc.defects), cc.defects
    # the explicit winning key never appears as a defect
    assert not any("alpha_explicit" in d for d in cc.defects), cc.defects
    # the explicit value was ACCEPTED as the effective expectation (a valid
    # mapping is never rejected); precedence, not validation, decided this run
    assert not any(CORR1_DEFECT in d for d in cc.defects), cc.defects
    PRECEDENCE.append({
        "case": "disjoint_explicit_alpha_over_fallback_beta",
        "explicit_params_expected_state": {"alpha_explicit": 1},
        "fallback_spec_expected_state": {"beta_declared": 2},
        "fallback_removed_to_make_test_pass": False,
        "compiled": bool(cc.compiled),
        "defects": list(cc.defects),
        "explicit_wins_evidence":
            "declared fallback key beta_declared compiles to NO adjudicator "
            "because the F02 walk consumed the explicit mapping",
        "pass": True})


@test("D2.explicit_superset_over_fallback_compiles_without_false_rejection")
def _():
    spec = _base_spec()
    explicit = {"catalogCourseContext": None,
                "fsm_state_literal": "OrderFlow.choosing_course",
                "stateCleared": True,
                "zzz_explicit_extra": 1}
    # fallback (seed expected.state) stays present and differs from explicit
    assert spec["expected"]["state"] == {
        "catalogCourseContext": None, "fsm_state_literal": "OrderFlow.choosing_course",
        "stateCleared": True}
    _oracle(spec, "state_subset")["params"]["expected_state"] = copy.deepcopy(explicit)
    cc = _compile(spec)
    assert cc.compiled, f"{cc.defects}"
    assert not any(CORR1_DEFECT in d for d in cc.defects), cc.defects
    PRECEDENCE.append({
        "case": "explicit_superset_over_seed_fallback",
        "explicit_params_expected_state": explicit,
        "fallback_spec_expected_state": spec["expected"]["state"],
        "fallback_removed_to_make_test_pass": False,
        "compiled": True, "defects": list(cc.defects),
        "explicit_wins_evidence":
            "declared fallback keys are all adjudicated through the explicit "
            "superset mapping; the explicit-only extra key is not rejected",
        "pass": True})


# ---- family E: metadata PRESENCE and exact value (§9) -------------------------

@test("E1.metadata_entries_exist_with_exact_values")
def _():
    assert MEASUREMENT_KINDS["state_subset"] == "RECURSIVE_NESTED_MAPPING_SUBSET"
    assert MEASUREMENT_KINDS["concurrency_invariant"] == "SUBSET_EQUALITY"
    # one compiled contract carrying BOTH families
    spec = _base_spec()
    spec["oracle"].append({"oracle": "concurrency_invariant",
                           "params": {"expected_state": {}}, "required": True})
    cc = _compile(spec)
    assert cc.compiled, cc.defects
    kinds = {m["oracle_id"]: m["measurement_kind"] for m in cc.oracle_mapping}
    # PRESENCE is mandatory: a missing entry is a failure, not a skip
    assert "state_subset" in kinds, f"state_subset metadata entry ABSENT: {kinds}"
    assert kinds["state_subset"] == "RECURSIVE_NESTED_MAPPING_SUBSET", kinds
    assert "concurrency_invariant" in kinds, \
        f"concurrency_invariant metadata entry ABSENT: {kinds}"
    assert kinds["concurrency_invariant"] == "SUBSET_EQUALITY", kinds
    METADATA.append({
        "case": "combined_state_subset_and_concurrency_invariant",
        "compiled": True, "kinds": kinds,
        "state_subset_entry_exists": True,
        "state_subset_value": kinds["state_subset"],
        "concurrency_invariant_entry_exists": True,
        "concurrency_invariant_value": kinds["concurrency_invariant"],
        "pass": True})


@test("E2.real_concurrency_seed_metadata_entry_exists")
def _():
    spec = _base_spec("A-0011")
    assert any(o["oracle"] == "concurrency_invariant" for o in spec["oracle"])
    cc = _compile(spec)
    assert cc.compiled, cc.defects
    kinds = {m["oracle_id"]: m["measurement_kind"] for m in cc.oracle_mapping}
    assert "concurrency_invariant" in kinds, \
        f"concurrency_invariant metadata entry ABSENT: {kinds}"
    assert kinds["concurrency_invariant"] == "SUBSET_EQUALITY", kinds
    METADATA.append({
        "case": "seed_A_0011_concurrency_invariant",
        "compiled": True, "kinds": kinds,
        "concurrency_invariant_entry_exists": True,
        "concurrency_invariant_value": kinds["concurrency_invariant"],
        "pass": True})


# ---- family F: unrelated families keep failed-predecessor behavior (§10) -----

def _iv1_probe(family: str) -> dict:
    """The CORR1.IV1 malformed-root probe construction: the state_subset oracle
    of the B-0001 seed is REPLACED by the target family carrying the same
    malformed root params {'expected_state': 1}; expected.state emptied."""
    spec = _base_spec()
    spec["expected"] = {}
    new_oracles = []
    for o in spec["oracle"]:
        if o["oracle"] == "state_subset":
            new_oracles.append({"oracle": family,
                                "params": {"expected_state": 1},
                                "required": True})
        else:
            new_oracles.append(o)
    spec["oracle"] = new_oracles
    return spec


@test("F.unrelated_state_adjudicators_keep_predecessor_typeerror")
def _():
    for family in ("concurrency_invariant", "course_ids_match",
                   "course_reference_kind", "decision_kind", "gate_detection",
                   "catalog_fallback"):
        spec = _iv1_probe(family)
        raised = None
        try:
            _compile(spec)
        except TypeError as exc:
            raised = str(exc)
        assert raised is not None, \
            f"{family}: no TypeError — predecessor semantics NOT preserved"
        assert raised == PREDECESSOR_TYPEERROR, \
            f"{family}: {raised!r} != {PREDECESSOR_TYPEERROR!r}"
        UNRELATED.append({
            "family": family,
            "probe": "state_subset oracle replaced by family with params "
                     "{'expected_state': 1}; expected.state emptied (CORR1.IV1 "
                     "other_state_adjudicator_probes construction)",
            "predecessor_outcome": f"TypeError: {PREDECESSOR_TYPEERROR}",
            "corr1_outcome": "TypeError swallowed by broadened isinstance guard",
            "corr2_outcome": f"TypeError: {PREDECESSOR_TYPEERROR}",
            "corr2_matches_predecessor": True,
            "pass": True})


# ---- family G: guard-scope contrast in one view -------------------------------

@test("G.guard_scope_state_subset_only_contrast")
def _():
    # state_subset: malformed root -> compile-time defect, NO exception
    spec = _base_spec()
    _oracle(spec, "state_subset")["params"]["expected_state"] = 1
    cc = _compile(spec)
    assert not cc.compiled and any(CORR1_DEFECT in d for d in cc.defects), cc.defects
    # decision_kind: the SAME malformed root keeps predecessor TypeError
    spec = _iv1_probe("decision_kind")
    try:
        _compile(spec)
        raise AssertionError("decision_kind: TypeError expected but not raised")
    except TypeError as exc:
        assert str(exc) == PREDECESSOR_TYPEERROR, str(exc)


def main() -> int:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        "/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/"
        "ACADEMY_TELEGRAM_BENCHMARK_SUCCESSOR_IMPLEMENTATION_1_CORR2")
    for fn in TESTS:
        fn()
    passed = sum(1 for r in RESULTS if r["pass"])
    all_pass = passed == len(RESULTS)

    def dump(name: str, schema: str, rows: list, extra: dict | None = None):
        doc = {"schema": schema, "cases": rows,
               "total": len(rows), "passed": sum(1 for r in rows if r["pass"]),
               "all_pass": all(r["pass"] for r in rows)}
        if extra:
            doc.update(extra)
        (out_dir / name).write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n",
                                    encoding="utf-8")

    dump("CORR2_TEST_RESULTS.json", "CORR2_SCOPE_F02_PRESERVATION_TEST_RESULTS_V1",
         RESULTS, {"status": "PASS" if all_pass else "FAIL"})
    dump("EXPLICIT_VALID_MAPPING_PRECEDENCE_TEST.json",
         "CORR2_EXPLICIT_VALID_MAPPING_PRECEDENCE_TEST_V1", PRECEDENCE,
         {"EXPLICIT_VALID_MAPPING_PRECEDENCE_TEST_VALID":
          "YES" if all(r["pass"] for r in PRECEDENCE) else "NO"})
    dump("METADATA_PRESENCE_TEST.json", "CORR2_METADATA_PRESENCE_TEST_V1", METADATA,
         {"METADATA_PRESENCE_AND_VALUE_TEST_VALID":
          "YES" if all(r["pass"] for r in METADATA) else "NO"})
    dump("UNRELATED_STATE_ADJUDICATOR_PRESERVATION.json",
         "CORR2_UNRELATED_STATE_ADJUDICATOR_PRESERVATION_V1", UNRELATED,
         {"UNRELATED_STATE_ADJUDICATORS_MATCH_PREDECESSOR":
          "YES" if all(r["pass"] for r in UNRELATED) else "NO"})
    for r in RESULTS:
        print(("PASS " if r["pass"] else "FAIL ") + r["name"] +
              (f" — {r['detail']}" if r["detail"] else ""))
    print(f"total={len(RESULTS)} passed={passed}")
    return 0 if all_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
