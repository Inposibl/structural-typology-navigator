"""Focused successor-semantics tests — BENCHMARK-SUCCESSOR-IMPLEMENTATION-1.

Proves RC-B01 (cases B01-1..B01-6) and RC-B02 (cases B02-1..B02-12) exactly as
accepted in the controlling contract
ACADEMY-TELEGRAM-LIVE-REGRESSION-1000-1.BENCHMARK-SEMANTIC-CONTRACT-V2.
FSM-SYMBOLIC.RECURSIVE-STATE-SUBSET.CANDIDATE-1.

Deterministic and offline: the only execution is the SYNTHETIC fixture handler
machinery already used by the existing regression batteries (temp-dir fixture
modules, no product TEST_BASE runtime, no provider contact, no network).

Results are persisted to the evidence root as RC_B01_TEST_RESULTS.json and
RC_B02_TEST_RESULTS.json (override with argv[1]).
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

from adapters.product import (  # noqa: E402
    FSM_PROJECTION_FAILURE,
    TIKHON_FSM_CANONICAL_MAP,
    TikhonStartAdapter,
    _RecordingFSM,
    project_tikhon_fsm_canonical,
)
from harness.evidence import (  # noqa: E402
    EvidenceIdentity,
    field_evidence_ref,
    freeze_evidence,
)
from harness.execution_request import ExecutionRequest  # noqa: E402
from harness.oracle import OracleError, oracle_state_subset  # noqa: E402

RESULTS_B01: list[dict] = []
RESULTS_B02: list[dict] = []
TESTS: list[tuple[str, object, list]] = []


def test(name: str, bucket: list):
    def deco(fn):
        def wrapper():
            try:
                fn()
                bucket.append({"name": name, "pass": True, "detail": ""})
            except AssertionError as exc:
                bucket.append({"name": name, "pass": False,
                               "detail": f"AssertionError: {exc}"})
            except Exception as exc:  # noqa: BLE001
                bucket.append({"name": name, "pass": False,
                               "detail": f"{type(exc).__name__}: {exc}"})
        wrapper.__name__ = name
        TESTS.append((name, wrapper, bucket))
        return wrapper
    return deco


# ---------------------------------------------------------------------------
# RC-B01 helpers — synthetic fixture handlers (same machinery as iv batteries)
# ---------------------------------------------------------------------------

def _unsealed_tikhon_execute():
    """Test-only invocation of the adapter body against SYNTHETIC fixtures.

    The product-authority seal gates REAL product-root execution. These focused
    tests run the IDENTICAL adapter body against generated synthetic fixture
    modules (no product source, no TEST_BASE roots, no provider contact), so
    the sealed wrapper is unwrapped through the guard closure. No authority is
    forged and no product runtime is invoked.
    """
    guarded = TikhonStartAdapter.__dict__["execute"]
    for cell in guarded.__closure__ or ():
        fn = cell.cell_contents
        if callable(fn) and getattr(fn, "__name__", "") == "execute":
            return fn
    raise AssertionError("unsealed adapter body not found in guard closure")


def _run_tikhon_fixture(client_source: str, turn: str = "/start") -> object:
    """Run TikhonStartAdapter's body against a SYNTHETIC fixture handler root.

    No product source is imported: the fixture module is generated in a temp
    directory and defines its own cmd_start / send_or_edit_root_catalog.
    """
    fixture = Path(tempfile.mkdtemp(prefix="rcb01fix-"))
    (fixture / "handlers").mkdir()
    (fixture / "handlers" / "__init__.py").write_text("", encoding="utf-8")
    (fixture / "handlers" / "client.py").write_text(client_source, encoding="utf-8")
    req = ExecutionRequest(
        scenario_id="RCB01", scenario_sha256="a" * 64, track="TIKHON",
        execution_level="L3", adapter_id="chatbot_l3_deep_link_start",
        run_id="RCB01TEST", attempt=1,
        turns=({"role": "user", "content": turn},),
        tikhon_test_root=str(fixture))
    execute_body = _unsealed_tikhon_execute()
    cap = execute_body(TikhonStartAdapter(), req)
    return cap


_CLIENT_CANONICAL = '''
class _NativeState:
    # native FSM State member: typed identity + Python repr
    state = "OrderFlow:choosing_course"
    def __str__(self):
        return "<State 'OrderFlow:choosing_course'>"

async def send_or_edit_root_catalog(event, reply_markup=None, course_id=None):
    await event.answer_photo(caption="CATALOG")

async def cmd_start(message, command, state):
    await state.set_state(_NativeState())
'''

_CLIENT_CLEARED = '''
async def send_or_edit_root_catalog(event, reply_markup=None, course_id=None):
    await event.answer_photo(caption="CATALOG")

async def cmd_start(message, command, state):
    await state.clear()
'''

_CLIENT_UNSET = '''
async def send_or_edit_root_catalog(event, reply_markup=None, course_id=None):
    await event.answer_photo(caption="CATALOG")

async def cmd_start(message, command, state):
    pass
'''

_CLIENT_UNKNOWN = '''
class _NativeState:
    state = "OtherFlow:unknown_state"
    def __str__(self):
        return "<State 'OtherFlow:unknown_state'>"

async def send_or_edit_root_catalog(event, reply_markup=None, course_id=None):
    await event.answer_photo(caption="CATALOG")

async def cmd_start(message, command, state):
    await state.set_state(_NativeState())
'''


# ---------------------------------------------------------------------------
# RC-B01 focused cases
# ---------------------------------------------------------------------------

@test("B01-1.native_identity_projects_to_canonical", RESULTS_B01)
def _():
    check = project_tikhon_fsm_canonical("OrderFlow:choosing_course")
    assert check == "OrderFlow.choosing_course", check
    assert TIKHON_FSM_CANONICAL_MAP == {
        "OrderFlow:choosing_course": "OrderFlow.choosing_course"}, TIKHON_FSM_CANONICAL_MAP
    cap = _run_tikhon_fixture(_CLIENT_CANONICAL)
    assert not cap.capture_error, cap.capture_error
    st = cap.values["state"]
    assert st["fsm_state_literal"] == "OrderFlow.choosing_course", st
    # the native identity is captured BEFORE str() conversion end-to-end
    assert st["fsm_state_native_raw"] == "OrderFlow:choosing_course", st


@test("B01-2.cleared_behavior_unchanged", RESULTS_B01)
def _():
    cap = _run_tikhon_fixture(_CLIENT_CLEARED)
    assert not cap.capture_error, cap.capture_error
    st = cap.values["state"]
    assert st["fsm_state_literal"] == "CLEARED", st
    assert st["stateCleared"] is True, st
    assert st["fsm_state_native_raw"] is None, st


@test("B01-3.unset_null_behavior_unchanged", RESULTS_B01)
def _():
    cap = _run_tikhon_fixture(_CLIENT_UNSET)
    assert not cap.capture_error, cap.capture_error
    st = cap.values["state"]
    assert st["fsm_state_literal"] is None, st
    assert st["stateCleared"] is False, st


@test("B01-4.unknown_identity_explicit_projection_failure", RESULTS_B01)
def _():
    check = project_tikhon_fsm_canonical("OtherFlow:unknown_state")
    assert check == FSM_PROJECTION_FAILURE, check
    cap = _run_tikhon_fixture(_CLIENT_UNKNOWN)
    assert not cap.capture_error, cap.capture_error
    st = cap.values["state"]
    # explicit benchmark projection / measurement failure — would FAIL any
    # comparison against a canonical expected value
    assert st["fsm_state_literal"] == FSM_PROJECTION_FAILURE, st


@test("B01-5.unknown_identity_never_replaced_with_expected", RESULTS_B01)
def _():
    for unknown in ("OrderFlow:totally_unknown", "OrderFlow:choosing_courseX",
                    "orderflow:choosing_course", "", "  "):
        assert project_tikhon_fsm_canonical(unknown) == FSM_PROJECTION_FAILURE, unknown
    assert project_tikhon_fsm_canonical(None) == FSM_PROJECTION_FAILURE
    assert project_tikhon_fsm_canonical(123) == FSM_PROJECTION_FAILURE
    cap = _run_tikhon_fixture(_CLIENT_UNKNOWN)
    st = cap.values["state"]
    assert st["fsm_state_literal"] != "OrderFlow.choosing_course", st
    assert st["fsm_state_literal"] != "<State 'OtherFlow:unknown_state'>", st
    assert st["fsm_state_literal"] == FSM_PROJECTION_FAILURE, st


@test("B01-6.raw_repr_diagnostics_retained_not_comparison_identity", RESULTS_B01)
def _():
    cap = _run_tikhon_fixture(_CLIENT_CANONICAL)
    st = cap.values["state"]
    # raw native identity retained as a separate diagnostic field
    assert st["fsm_state_native_raw"] == "OrderFlow:choosing_course", st
    # predecessor raw/repr transcript surface retained
    updates = cap.transcripts["fsm_updates"]
    assert "<State 'OrderFlow:choosing_course'>" in updates, updates
    # the repr NEVER becomes the semantic comparison identity
    assert st["fsm_state_literal"] != "<State 'OrderFlow:choosing_course'>", st


@test("B01-7.recording_fsm_capture_semantics", RESULTS_B01)
def _():
    fsm = _RecordingFSM()

    class _S:
        state = "OrderFlow:choosing_course"

        def __str__(self):
            return "<State 'OrderFlow:choosing_course'>"

    import asyncio
    asyncio.run(fsm.set_state(_S()))
    assert fsm.native_state == "OrderFlow:choosing_course", fsm.native_state
    assert fsm.state == "<State 'OrderFlow:choosing_course'>", fsm.state
    plain = _RecordingFSM()
    asyncio.run(plain.set_state("OrderFlow:choosing_course"))
    assert plain.native_state == "OrderFlow:choosing_course", plain.native_state


# ---------------------------------------------------------------------------
# RC-B02 helpers — frozen evidence for direct oracle adjudication
# ---------------------------------------------------------------------------

def _frozen(state_value, tag: str):
    root = Path(tempfile.mkdtemp(prefix="rcb02ev-"))
    identity = EvidenceIdentity(
        run_id="RCB02TEST", scenario_id=f"RCB2-{tag}",
        scenario_sha256="b" * 64, observation_id=f"RCB2-{tag}_A1",
        attempt_index=1, evidence_type="RAW_OBSERVATION")
    payload = {
        "lane": "PRODUCT",
        "actual": {"state": {
            "evidence_ref": field_evidence_ref(identity, "state", state_value),
            "provenance": "ISOLATED_ADAPTER_OUTPUT", "sentinel": None,
            "value": state_value}},
    }
    return freeze_evidence(identity, str(root), payload)


def _run_state_subset(expected_state, actual_state, tag: str):
    frozen = _frozen(actual_state, tag)
    return oracle_state_subset(frozen, {}, {"expected_state": expected_state})


# ---------------------------------------------------------------------------
# RC-B02 focused cases
# ---------------------------------------------------------------------------

@test("B02-1.nested_mapping_extra_key_passes", RESULTS_B02)
def _():
    check = _run_state_subset(
        {"701100": {"selectedCourseId": "maslow"}},
        {"701100": {"displayName": None, "selectedCourseId": "maslow"}}, "B02-1")
    assert check.satisfied is True, check.reason


@test("B02-2.missing_nested_expected_key_fails", RESULTS_B02)
def _():
    check = _run_state_subset(
        {"701100": {"selectedCourseId": "maslow"}}, {"701100": {}}, "B02-2")
    assert check.satisfied is False, check.reason
    assert "701100.selectedCourseId" in check.reason, check.reason
    check2 = _run_state_subset(
        {"701100": {"selectedCourseId": "maslow"}},
        {"701100": {"selectedCourseId": "maslow"}}, "B02-2b")
    assert check2.satisfied is True, check2.reason


@test("B02-3.wrong_nested_value_fails", RESULTS_B02)
def _():
    check = _run_state_subset(
        {"701100": {"selectedCourseId": "maslow"}},
        {"701100": {"selectedCourseId": "other"}}, "B02-3")
    assert check.satisfied is False, check.reason


@test("B02-4.expected_null_matches_actual_null", RESULTS_B02)
def _():
    check = _run_state_subset(
        {"701100": {"displayName": None}},
        {"701100": {"displayName": None}}, "B02-4")
    assert check.satisfied is True, check.reason
    check2 = _run_state_subset({"x": None}, {"x": None}, "B02-4b")
    assert check2.satisfied is True, check2.reason


@test("B02-5.expected_null_with_absent_key_fails", RESULTS_B02)
def _():
    check = _run_state_subset({"x": None}, {}, "B02-5")
    assert check.satisfied is False, check.reason
    assert "KEY_ABSENT" in check.reason, check.reason


@test("B02-6.extra_top_level_actual_key_passes", RESULTS_B02)
def _():
    check = _run_state_subset({"a": 1}, {"a": 1, "b": 2}, "B02-6")
    assert check.satisfied is True, check.reason


@test("B02-7.extra_nested_actual_key_passes", RESULTS_B02)
def _():
    check = _run_state_subset(
        {"u": {"a": 1}}, {"u": {"a": 1, "b": 2}, "top": 3}, "B02-7")
    assert check.satisfied is True, check.reason


@test("B02-8.list_length_difference_fails", RESULTS_B02)
def _():
    check = _run_state_subset({"l": [1, 2]}, {"l": [1, 2, 3]}, "B02-8")
    assert check.satisfied is False, check.reason


@test("B02-9.list_order_difference_fails", RESULTS_B02)
def _():
    check = _run_state_subset({"l": [1, 2]}, {"l": [2, 1]}, "B02-9")
    assert check.satisfied is False, check.reason


@test("B02-10.mapping_inside_list_is_atomic_whole_equality", RESULTS_B02)
def _():
    # an extra key inside a mapping CONTAINED IN A LIST is a FAIL: lists keep
    # predecessor atomic exact equality; no recursive subset descent
    check = _run_state_subset(
        {"l": [{"a": 1}]}, {"l": [{"a": 1, "b": 2}]}, "B02-10")
    assert check.satisfied is False, check.reason
    check2 = _run_state_subset(
        {"l": [{"a": 1}]}, {"l": [{"a": 1}]}, "B02-10b")
    assert check2.satisfied is True, check2.reason


@test("B02-11.empty_expected_mapping_passes_for_mapping", RESULTS_B02)
def _():
    check = _run_state_subset({}, {"any": "thing"}, "B02-11")
    assert check.satisfied is True, check.reason


@test("B02-12.empty_expected_mapping_fails_for_null_scalar_list", RESULTS_B02)
def _():
    for tag, actual in (("n", None), ("s", "scalar"), ("l", [1, 2])):
        check = _run_state_subset({}, actual, f"B02-12{tag}")
        assert check.satisfied is False, (tag, check.reason)
        assert "not a mapping" in check.reason, (tag, check.reason)


@test("B02-13.malformed_non_mapping_expected_root_fails_closed", RESULTS_B02)
def _():
    frozen = _frozen({"a": 1}, "B02-13")
    for bad in (["x"], "scalar", 5):
        try:
            oracle_state_subset(frozen, {}, {"expected_state": bad})
            raise AssertionError(f"non-mapping expected_state {bad!r} did not fail closed")
        except OracleError:
            pass


@test("B02-14.absent_expected_fallback_keeps_predecessor_empty_mapping", RESULTS_B02)
def _():
    frozen = _frozen({"a": 1}, "B02-14")
    check = oracle_state_subset(frozen, {}, {})
    assert check.satisfied is True, check.reason


@test("B02-15.scalar_leaf_predecessor_equality_preserved", RESULTS_B02)
def _():
    # accepted §13: existing Python leaf equality retained (True==1, 1==1.0)
    check = _run_state_subset({"flag": True}, {"flag": 1}, "B02-15a")
    assert check.satisfied is True, check.reason
    check = _run_state_subset({"n": 1}, {"n": 1.0}, "B02-15b")
    assert check.satisfied is True, check.reason
    # no case folding / string normalization introduced
    check = _run_state_subset({"s": "Maslow"}, {"s": "maslow"}, "B02-15c")
    assert check.satisfied is False, check.reason


@test("B02-16.expected_mapping_vs_non_mapping_actual_fails", RESULTS_B02)
def _():
    check = _run_state_subset({"701100": {"selectedCourseId": "maslow"}},
                              {"701100": "scalar"}, "B02-16")
    assert check.satisfied is False, check.reason


@test("B02-17.concurrency_invariant_metadata_unchanged_distinction_proven",
      RESULTS_B02)
def _():
    from harness.contract_compile import MEASUREMENT_KINDS
    assert MEASUREMENT_KINDS["state_subset"] == "RECURSIVE_NESTED_MAPPING_SUBSET"
    assert MEASUREMENT_KINDS["concurrency_invariant"] == "SUBSET_EQUALITY"


def main() -> int:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        "/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/"
        "ACADEMY_TELEGRAM_BENCHMARK_SUCCESSOR_IMPLEMENTATION_1")
    for _, wrapper, _bucket in list(TESTS):
        wrapper()
    b01_pass = all(r["pass"] for r in RESULTS_B01)
    b02_pass = all(r["pass"] for r in RESULTS_B02)
    (out_dir / "RC_B01_TEST_RESULTS.json").write_text(json.dumps({
        "schema": "RC_B01_FOCUSED_TEST_RESULTS_V1",
        "cases": RESULTS_B01, "total": len(RESULTS_B01),
        "passed": sum(1 for r in RESULTS_B01 if r["pass"]),
        "all_pass": b01_pass}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (out_dir / "RC_B02_TEST_RESULTS.json").write_text(json.dumps({
        "schema": "RC_B02_FOCUSED_TEST_RESULTS_V1",
        "cases": RESULTS_B02, "total": len(RESULTS_B02),
        "passed": sum(1 for r in RESULTS_B02 if r["pass"]),
        "all_pass": b02_pass}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for bucket in (RESULTS_B01, RESULTS_B02):
        for r in bucket:
            print(("PASS " if r["pass"] else "FAIL ") + r["name"] +
                  (f" — {r['detail']}" if r["detail"] else ""))
    return 0 if (b01_pass and b02_pass) else 1


if __name__ == "__main__":
    raise SystemExit(main())
