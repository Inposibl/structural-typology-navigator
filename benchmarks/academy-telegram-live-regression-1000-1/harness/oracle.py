"""Deterministic oracle engine v4 — CORR4 (B-02, B-06, B-18; IV4 owner
sections 9, 13-14, 21-22, 32-33).

- B-02 SPEC IDENTITY: every scoring entry point recomputes the controlling
  scenario specification SHA and requires equality with the scoring identity
  AND the frozen evidence identity BEFORE any oracle runs. A foreign
  specification, or a caller that altered expectations and reuses old
  evidence, fails inside the oracle layer. The mutation gate must present the
  ORIGINAL outcome lineage (base spec == frozen identity) to unlock mutation
  re-scoring.
- B-02 FIELD IDENTITY: structured field references must declare the exact
  FIELD_NAME being scored; a ref resolved against a different field fails
  before any oracle verdict.
- B-06 COMPLETE ADJUDICATION: expected.link requires an exact-link/no-link
  adjudicator; expected.courseIds requires actual course-ID adjudication
  (course_ids_match); Set C requires BOTH the concurrency proof and the state
  invariant; declared prohibited terms must be inside the scanner contract;
  expected.state requires a physically capable field adjudicator.
- B-18 CAUSAL CONTRACT IDENTITY: concurrency scoring compares the REQUESTED
  seam/schedule/participants with the MEASURED evidence and never falls back
  from native_operation_intervals to wrapper intervals; fault scoring binds
  the requested kind/target/point to a REGISTERED mechanism contract and the
  bound adapter's supported fault capability. Unsupported kind = measurement
  invalid, never a product verdict.
- Measurement-invalid remains a first-class outcome (invalid=True -> the
  runner routes to BENCHMARK_DEFECT, never product FAIL/PASS).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .evidence import (
    FrozenEvidence,
    UNOBSERVED,
    resolve_field_ref,
    sha256_canonical,
)
from .scanner import ScanTarget, scan_prohibited_output

EXECUTED_PROVENANCE = {
    "RUNTIME_FUNCTION_RETURN", "LIVE_API_RESPONSE", "ISOLATED_ADAPTER_OUTPUT",
    "ISOLATED_STATE_READ", "CONTROLLED_TELEGRAM_OBSERVATION",
    "FAULT_HARNESS_OBSERVATION", "DERIVED_FROM_OBSERVED_DATA",
}

ERROR_OUTCOME_CLASSES = frozenset(
    {"TECHNICAL_ERROR", "INFRA_OUTAGE", "HARNESS_ERROR", "UNRESOLVED_STATE"}
)

# B-18: REGISTERED fault mechanism contracts. Every supported fault kind has a
# validation contract; a nonempty arbitrary mechanism_evidence dictionary is
# not sufficient, and an unregistered kind is a measurement defect.
# F13 (IV5): the authoritative registry (with physical seam/point identity) is
# harness/mechanisms.py:FAULT_MECHANISMS; this table remains the kind-level
# evidence-schema contract used by non-registry (calibration/legacy) calls.
FAULT_MECHANISM_CONTRACTS: dict[str, tuple[str, ...]] = {
    "LOST_RESPONSE": ("durable_write_proven", "persisted_state_present",
                      "processing_completed", "response_dropped"),
    "TIMEOUT_AFTER_PROCESSING": ("deadline_exceeded",),
    "TIMEOUT_BEFORE_PROCESSING": ("raised",),
    "DEPENDENCY_429": ("raised",),
    "DEPENDENCY_500": ("raised",),
    "MALFORMED_DEPENDENCY_PAYLOAD": ("payload",),
    "PERSISTENCE_FAILURE": ("raised",),
    "IDEMPOTENCY_EXPIRY": ("ttl_expiry_mechanism",),
    "DELAYED_CALLBACK": ("delayed_callback_s",),
    "DUPLICATED_UPDATE": ("duplicate_delivery",),
    "REORDERED_UPDATE": ("reorder",),
    "SEND_FAILURE_AFTER_DURABLE_WRITE": ("durable_result_present",),
}


@dataclass
class OracleCheck:
    oracle_id: str
    required: bool
    satisfied: bool | None
    reason: str
    evidence_refs: list[str] = field(default_factory=list)
    invalid: bool = False  # measurement did not exercise the claimed mechanism


class OracleError(RuntimeError):
    pass


class ScoringIdentityRequired(TypeError):
    """Raised when a scoring entry point is called without a scoring identity."""


def _payload(evidence: dict) -> dict:
    if isinstance(evidence, dict) and "payload" in evidence and "actual" not in evidence:
        inner = evidence["payload"]
        if isinstance(inner, dict):
            merged = dict(inner)
            merged.setdefault("lane", "PRODUCT")
            # keep the WRAPPER identity available for field-ref resolution
            merged["identity"] = evidence.get("identity") or inner.get("identity")
            return merged
    return evidence


def _observed(evidence: dict, key: str) -> dict:
    evidence = _payload(evidence)
    block = evidence.get("actual")
    if not isinstance(block, dict) or key not in block:
        raise OracleError(f"frozen evidence lacks actual block {key!r}")
    return block[key]


def _check_field_ref(evidence: dict, key: str) -> None:
    evidence = _payload(evidence)
    block = _observed(evidence, key)
    if block.get("provenance") in (None, "UNOBSERVED"):
        return
    resolve_field_ref(evidence, key, block)


def _require_provenance(block: dict, oracle_id: str, families: set[str]) -> Any:
    prov = str(block.get("provenance", "UNOBSERVED"))
    if prov == "UNOBSERVED" or block.get("sentinel") == UNOBSERVED:
        raise OracleError(
            f"oracle {oracle_id} attempted to adjudicate an UNOBSERVED field"
        )
    from .provenance import PROVENANCE_FAMILY

    if PROVENANCE_FAMILY.get(prov) not in families:
        raise OracleError(
            f"oracle {oracle_id} refuses provenance {prov!r}: not admissible"
        )
    return block.get("value")


def _lane_families(ev: dict) -> set[str]:
    if ev.get("lane") == "CALIBRATION":
        return {"SYNTHETIC_CALIBRATION"}
    return {"EXECUTED", "DERIVED_FROM_EXECUTED"}


def _require_executed(ev: dict, block: dict, oracle_id: str) -> Any:
    return _require_provenance(block, oracle_id, _lane_families(_payload(ev)))


# ---------------------------------------------------------------------------
# Pre-execution validation: expectation consistency + semantic completeness
# ---------------------------------------------------------------------------

EXPECTED_TO_ORACLE = {
    "act": "act_equals",
    "origin": "origin_equals",
    "state": "state_subset",
    "link": "exact_link",
    "prohibited_output": "prohibited_output",
}

# B-06: oracle families that can physically adjudicate a declared expectation.
LINK_ADJUDICATORS = {"exact_link", "no_payment_link"}
STATE_ADJUDICATORS = {"state_subset", "concurrency_invariant", "catalog_fallback",
                      "gate_detection", "decision_kind", "course_reference_kind",
                      "course_ids_match"}
COURSE_ID_ADJUDICATORS = {"course_ids_match"}


def validate_expectation_consistency(spec: dict, native_observables: tuple[str, ...] = ()) -> list[str]:
    """ONE canonical expectation source (owner section 18) + COMPLETE
    adjudication coverage (IV4 B-06): every declared expectation must have a
    physically capable adjudicator. A declaration without an adjudicator, or a
    contradiction between expectation and oracle params, is a BENCHMARK_DEFECT
    with zero adapter calls."""
    defects: list[str] = []
    sid = spec.get("scenario_id", "?")
    expected = spec.get("expected") or {}
    oracles = spec.get("oracle") or []
    by_name: dict[str, dict] = {}
    for o in oracles:
        by_name.setdefault(o.get("oracle"), o)
    names = set(by_name)

    def param(key):
        o = by_name.get(EXPECTED_TO_ORACLE[key])
        return (o or {}).get("params", {}).get(
            {"act": "expected_act", "origin": "expected_origin",
             "state": "expected_state", "link": "expected_link",
             "prohibited_output": "prohibited"}.get(key)
        ) if o else None

    for key in ("act", "origin", "link"):
        if key in expected:
            p = param(key)
            if p is not None and p != expected[key]:
                defects.append(
                    f"{sid}: expected.{key}={expected[key]!r} contradicts oracle "
                    f"params {p!r} (canonical expectation source violated)"
                )
    if "state" in expected and isinstance(expected["state"], dict):
        p = param("state")
        if isinstance(p, dict):
            for k, v in expected["state"].items():
                if k in p and p[k] != v:
                    defects.append(
                        f"{sid}: expected.state.{k}={v!r} contradicts oracle params {p[k]!r}"
                    )
    if "prohibited_output" in expected:
        o = by_name.get("prohibited_output")
        if o is None:
            defects.append(f"{sid}: expected.prohibited_output present without a prohibited_output scanner oracle")
        else:
            declared = set(o.get("params", {}).get("prohibited") or [])
            missing = set(expected["prohibited_output"]) - declared
            if missing:
                defects.append(
                    f"{sid}: expected prohibited terms {sorted(missing)} are not in the scanner contract"
                )
    # ---- B-06 complete-adjudication requirements -----------------------------
    if "link" in expected and not (names & LINK_ADJUDICATORS):
        defects.append(
            f"{sid}: expected.link is declared without an exact link / no-payment-link adjudicator"
        )
    if "courseIds" in (expected.get("state") or {}) and not (names & COURSE_ID_ADJUDICATORS):
        defects.append(
            f"{sid}: expected.state.courseIds is declared without an actual course-ID "
            "adjudicator (course_reference_kind adjudicates refKind only)"
        )
    if "state" in expected and isinstance(expected["state"], dict) and expected["state"] \
            and not (names & STATE_ADJUDICATORS):
        defects.append(f"{sid}: expected.state is declared without a field adjudicator")
    # ---- F02 (IV5): a declared expected.state key must appear in the
    # CONTROLLING adjudicator's expected_state params — an adjudicator that
    # reads a DIFFERENT field (catalog_fallback reads state.flow) cannot stand
    # in for a declared fsm_state_literal expectation.
    if "state" in expected and isinstance(expected["state"], dict):
        SINGLE_FIELD_ORACLES = {
            "decision_kind": "decisionKind",
            "course_reference_kind": "refKind",
            "course_ids_match": "courseIds",
            "catalog_fallback": "flow",
        }
        adjudicated_keys: set[str] = set()
        for o in oracles:
            oname = o.get("oracle")
            if oname in SINGLE_FIELD_ORACLES:
                adjudicated_keys.add(SINGLE_FIELD_ORACLES[oname])
            elif oname == "gate_detection":
                req = (o.get("params") or {}).get("required_detections")
                if isinstance(req, list):
                    adjudicated_keys |= {str(d) for d in req}
            else:
                p = (o.get("params") or {}).get("expected_state")
                if oname in ("state_subset", "concurrency_invariant") \
                        and isinstance(p, dict):
                    adjudicated_keys |= set(p.keys())
        unadjudicated = [k for k in expected["state"] if k not in adjudicated_keys]
        if unadjudicated:
            defects.append(
                f"{sid}: expected.state keys {unadjudicated} are declared without "
                "appearing in any controlling field adjudicator's expected_state "
                "(an oracle reading a different field cannot adjudicate them; F02)"
            )
    # per-field state observables (owner section 19). Per-user wrapper keys
    # (concurrency rows) are legal when their INNER keys are native.
    if "state" in expected and isinstance(expected["state"], dict) and native_observables:
        for k, v in expected["state"].items():
            if isinstance(v, dict) and not isinstance(v, bool):
                inner_ok = any(ik in native_observables for ik in v)
                if not inner_ok:
                    defects.append(
                        f"{sid}: expected.state[{k!r}] has no native inner observable")
                continue
            if not any(k == n or k.startswith(n + ".") or n.startswith(k + ".") or k in n
                       for n in native_observables):
                defects.append(
                    f"{sid}: expected.state key {k!r} has no native observable on the bound adapter"
                )
    return defects


def validate_semantic_completeness(spec: dict, registry_entry: dict | None = None) -> list[str]:
    """Semantic (not merely structural) adjudicator completeness (owner §19;
    IV4 B-06: Set C requires BOTH the concurrency proof and the declared state
    invariant; CORR5 F03: a required static_config oracle can never be empty;
    CORR5 F12: replay C requires the TYPED concurrency proof oracle)."""
    defects: list[str] = []
    sid = spec.get("scenario_id", "?")
    oracles = spec.get("oracle") or []
    names = {o.get("oracle") for o in oracles}
    RUNTIME = {
        "act_equals", "origin_equals", "exact_link", "no_payment_link", "state_subset",
        "course_ids_match", "prohibited_output", "tool_call_absent", "tool_call_present",
        "state_mutation_absent", "exactly_once", "duplicate_write_absent", "idempotent_retry",
        "concurrency_overlap_proven", "concurrency_invariant",
        "same_user_serialization_proven", "different_user_independence_proven",
        "fault_confirmed_injected", "fault_reaction", "price_authority",
        "catalog_fallback", "outcome_class", "gate_detection", "decision_kind",
        "course_reference_kind",
    }
    if spec.get("role_invariant") and not (names & RUNTIME or "semantic_input_frozen" in names):
        defects.append(f"{sid}: ROLE_INVARIANT without any responsible adjudicator")
    if spec.get("expected", {}).get("prohibited_output") and "prohibited_output" not in names:
        defects.append(f"{sid}: PROHIBITED_OUTPUT without an actual-output scanner oracle")
    if spec.get("semantic_evaluation", {}).get("required") and "semantic_input_frozen" not in names:
        defects.append(f"{sid}: semantic_required without the semantic lifecycle oracle")
    if spec.get("seam_class") == "NO_SEAM" and names & RUNTIME:
        defects.append(f"{sid}: NO_SEAM with a runtime oracle")
    # F12 (IV5): Set C requires the TYPED concurrency proof oracle registered
    # for its mechanism (same-user serialization / different-user independence).
    CONCURRENCY_PROOF_ORACLES = {
        "concurrency_overlap_proven", "same_user_serialization_proven",
        "different_user_independence_proven",
    }
    if spec.get("replay_set") == "C" and not (names & CONCURRENCY_PROOF_ORACLES):
        defects.append(f"{sid}: concurrency replay without the concurrency-proof adjudicator")
    if spec.get("replay_set") == "C" and "concurrency_invariant" not in names:
        defects.append(f"{sid}: concurrency replay without the declared state invariant")
    if (spec.get("fault_schedule") or spec.get("replay_set") == "F") and not (
        {"fault_confirmed_injected", "fault_reaction"} & names
    ):
        defects.append(f"{sid}: fault scenario without fault-confirmation adjudicator")
    if "catalog_fallback" in names:
        has_flow = "expected_flow" in (spec.get("expected") or {}) or any(
            "expected_flow" in (o.get("params") or {}) for o in oracles
        )
        if not has_flow:
            defects.append(f"{sid}: catalog_fallback without expected_flow")
    # ---- F03 (IV5): NO VACUOUS STATIC ORACLE ---------------------------------
    # A required static_config oracle MUST contain at least one material
    # expectation; an empty assertion set is never a PASS oracle.
    for o in oracles:
        if o.get("oracle") == "static_config":
            expectations = (o.get("params") or {}).get("expectations")
            if not expectations:
                defects.append(
                    f"{sid}: required static_config oracle has an EMPTY expectation "
                    "set: a required static contract must assert at least one "
                    "material expectation derived from the scenario's declared "
                    "mechanism and registered static query (an empty assertion set "
                    "is never a PASS oracle; F03)"
                )
    return defects


# ---------------------------------------------------------------------------
# Oracle evaluators (identity-checked)
# ---------------------------------------------------------------------------

def oracle_act_equals(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "act")
    actual = _require_executed(ev, _observed(ev, "act"), "act_equals")
    _M = object()
    expected_act = params["expected_act"] if "expected_act" in params else spec.get("expected", {}).get("act", _M)
    if expected_act is _M:
        raise OracleError("act_equals requires an expected act specification")
    return OracleCheck("act_equals", bool(params.get("required", True)), actual == expected_act,
                       f"actual act {actual!r} vs specified {expected_act!r}", [frozen.sha256])


def oracle_origin_equals(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "origin")
    actual = _require_executed(ev, _observed(ev, "origin"), "origin_equals")
    _M = object()
    expected = params["expected_origin"] if "expected_origin" in params else spec.get("expected", {}).get("origin", _M)
    if expected is _M:
        raise OracleError("origin_equals requires an expected origin specification")
    return OracleCheck("origin_equals", bool(params.get("required", True)), actual == expected,
                       f"actual origin {actual!r} vs specified {expected!r}", [frozen.sha256])


def oracle_exact_link(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "link")
    actual = _require_executed(ev, _observed(ev, "link"), "exact_link")
    _M = object()
    expected = params["expected_link"] if "expected_link" in params else spec.get("expected", {}).get("link", _M)
    if expected is _M:
        raise OracleError("exact_link requires an expected link specification")
    if expected:
        generic = expected.split("?")[0]
        if actual == generic and actual != expected:
            return OracleCheck("exact_link", bool(params.get("required", True)), False,
                               f"generic link {actual!r} is not the exact payload link {expected!r}",
                               [frozen.sha256])
    return OracleCheck("exact_link", bool(params.get("required", True)), actual == expected,
                       f"actual link {actual!r} vs specified {expected!r}", [frozen.sha256])


def oracle_no_payment_link(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "output")
    output_text = _require_executed(ev, _observed(ev, "output"), "no_payment_link")
    links = re.findall(r"https?://t\.me/[^\s)\]]+", str(output_text or ""))
    payment = [l for l in links if "AST_payment_course_bot" in l]
    return OracleCheck("no_payment_link", bool(params.get("required", True)), not payment,
                       f"payment links present: {payment}" if payment else "no payment link in full output",
                       [frozen.sha256])


def oracle_state_subset(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "state")
    actual_state = _require_executed(ev, _observed(ev, "state"), "state_subset")
    expected_state = params.get("expected_state", spec.get("expected", {}).get("state")) or {}
    if not isinstance(actual_state, dict):
        return OracleCheck("state_subset", bool(params.get("required", True)), False,
                           f"actual state is not a mapping: {type(actual_state).__name__}", [frozen.sha256])
    mismatches = {}
    for k, v in expected_state.items():
        if k not in actual_state:
            mismatches[k] = {"expected": v, "actual": "<KEY_ABSENT> (presence required)"}
        elif actual_state[k] != v:
            mismatches[k] = {"expected": v, "actual": actual_state[k]}
    return OracleCheck("state_subset", bool(params.get("required", True)), not mismatches,
                       "actual state satisfies specified subset (presence + equality)" if not mismatches
                       else f"state mismatches: {mismatches}", [frozen.sha256])


def oracle_decision_kind(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    """Native payment-decision contract observable (navigator payment seam)."""
    ev = frozen.load()
    _check_field_ref(ev, "state")
    state = _require_executed(ev, _observed(ev, "state"), "decision_kind")
    _M = object()
    expected = params["expected_decision_kind"] if "expected_decision_kind" in params else (
        spec.get("expected", {}).get("decisionKind", _M))
    if expected is _M:
        raise OracleError("decision_kind requires expected_decision_kind")
    got = state.get("decisionKind") if isinstance(state, dict) else None
    ok = got == expected
    return OracleCheck("decision_kind", bool(params.get("required", True)), ok,
                       f"native decision kind {got!r} vs specified {expected!r}", [frozen.sha256])


def oracle_course_reference_kind(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    """Native course-reference resolution kind (ZERO/ONE/MULTIPLE)."""
    ev = frozen.load()
    _check_field_ref(ev, "state")
    state = _require_executed(ev, _observed(ev, "state"), "course_reference_kind")
    _M = object()
    expected = params["expected_kind"] if "expected_kind" in params else spec.get("expected", {}).get("refKind", _M)
    if expected is _M:
        raise OracleError("course_reference_kind requires expected_kind")
    got = state.get("refKind") if isinstance(state, dict) else None
    return OracleCheck("course_reference_kind", bool(params.get("required", True)), got == expected,
                       f"native resolution kind {got!r} vs specified {expected!r}", [frozen.sha256])


def oracle_course_ids_match(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    """B-06: actual COURSE-ID adjudication (expected.courseIds must be checked
    as the actual resolved course IDs, not only the resolution refKind)."""
    ev = frozen.load()
    _check_field_ref(ev, "state")
    state = _require_executed(ev, _observed(ev, "state"), "course_ids_match")
    _M = object()
    expected_ids = params["expected_course_ids"] if "expected_course_ids" in params else (
        (spec.get("expected", {}).get("state") or {}).get("courseIds", _M))
    if expected_ids is _M:
        raise OracleError("course_ids_match requires expected_course_ids")
    got = state.get("courseIds") if isinstance(state, dict) else None
    ok = isinstance(got, list) and sorted(got) == sorted(expected_ids)
    return OracleCheck("course_ids_match", bool(params.get("required", True)), ok,
                       f"actual course ids {got!r} vs specified {expected_ids!r}",
                       [frozen.sha256])


def oracle_prohibited_output(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "output")
    output_text = _require_executed(ev, _observed(ev, "output"), "prohibited_output")
    terms = params.get("prohibited", spec.get("expected", {}).get("prohibited_output")) or []
    target = params.get("target", ScanTarget.SYSTEM_OUTPUT.value)
    if target == ScanTarget.SYSTEM_OUTPUT.value:
        results = scan_prohibited_output(list(terms), system_output=str(output_text or ""))
    elif target == ScanTarget.TOOL_OUTPUT.value:
        results = scan_prohibited_output(list(terms), tool_output=str(output_text or ""))
    elif target == ScanTarget.EXTERNAL_OUTPUT.value:
        results = scan_prohibited_output(list(terms), external_output=str(output_text or ""))
    else:
        raise OracleError(f"prohibited_output target {target!r} is not an output stream")
    hits = [h for r in results for h in r.hits]
    return OracleCheck("prohibited_output", bool(params.get("required", True)), not hits,
                       f"prohibited terms present in {target}: {hits}" if hits else f"{target} free of prohibited terms",
                       [frozen.sha256])


def oracle_tool_call_absent(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "tool_api")
    tools = _require_executed(ev, _observed(ev, "tool_api"), "tool_call_absent")
    used = sorted({t for t in (tools or []) if t in (params.get("tool_names") or [])})
    return OracleCheck("tool_call_absent", bool(params.get("required", True)), not used,
                       f"forbidden tool calls observed: {used}" if used else "no forbidden tool calls",
                       [frozen.sha256])


def oracle_tool_call_present(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "tool_api")
    tools = _require_executed(ev, _observed(ev, "tool_api"), "tool_call_present")
    missing = [t for t in (params.get("tool_names") or []) if t not in (tools or [])]
    return OracleCheck("tool_call_present", bool(params.get("required", True)), not missing,
                       f"required tool calls missing: {missing}" if missing else "all required tool calls observed",
                       [frozen.sha256])


def oracle_state_mutation_absent(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "mutations")
    mutations = _require_executed(ev, _observed(ev, "mutations"), "state_mutation_absent")
    present = sorted({m for m in (mutations or []) if m in (params.get("mutation_targets") or [])})
    return OracleCheck("state_mutation_absent", bool(params.get("required", True)), not present,
                       f"forbidden mutations observed: {present}" if present else "no forbidden mutations",
                       [frozen.sha256])


def oracle_exactly_once(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "mutations")
    writes = _require_executed(ev, _observed(ev, "mutations"), "exactly_once")
    target = params.get("write_key")
    count = sum(1 for w in (writes or []) if target and w == target)
    return OracleCheck("exactly_once", bool(params.get("required", True)), count == 1,
                       f"write {target!r} occurred {count} time(s); exactly-once requires 1", [frozen.sha256])


def oracle_duplicate_write_absent(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "mutations")
    writes = _require_executed(ev, _observed(ev, "mutations"), "duplicate_write_absent")
    target = params.get("write_key")
    count = sum(1 for w in (writes or []) if target and w == target)
    return OracleCheck("duplicate_write_absent", bool(params.get("required", True)), count <= 1,
                       f"write {target!r} occurred {count} times" + ("" if count <= 1 else " (>1)"),
                       [frozen.sha256])


def oracle_idempotent_retry(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "mutations")
    writes = _require_executed(ev, _observed(ev, "mutations"), "idempotent_retry")
    target = params.get("write_key")
    count = sum(1 for w in (writes or []) if target and w == target)
    return OracleCheck("idempotent_retry", bool(params.get("required", True)), count <= 1,
                       f"{count} durable write(s) for retryable op {target!r}", [frozen.sha256])


def oracle_concurrency_overlap_proven(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    """Concurrency proof with MEASUREMENT-INVALID semantics and CAUSAL
    CONTRACT IDENTITY (owner §52; IV4 B-18):

    - the REQUESTED target seam / schedule ID / participant count (spec
      params) are compared against the MEASURED evidence — evidence for a
      different mechanism cannot satisfy this oracle;
    - native-operation concurrency requires native_operation_intervals;
      there is NO fallback to wrapper intervals when they are missing;
    - declared workers are compared against MEASURED participants from the
      raw evidence (oracle params cannot override raw evidence).

    Any invalid condition -> invalid=True (runner: BENCHMARK_DEFECT).
    """
    ev = frozen.load()
    overlap = _payload(ev).get("concurrency") or {}
    declared_workers = int(params.get("workers", 0)) or int(overlap.get("workers", 0) or 0)
    requested_seam = params.get("target_seam")
    requested_schedule = params.get("schedule_id")
    measured_workers = len(overlap.get("worker_ids") or [])
    intervals = overlap.get("intervals") or []
    native_intervals = overlap.get("native_operation_intervals")
    problems: list[str] = []
    invalid = False
    if declared_workers and measured_workers != declared_workers:
        invalid = True
        problems.append(
            f"declared {declared_workers} workers but {measured_workers} measured "
            "(raw evidence, not oracle params)"
        )
    if len(set(overlap.get("worker_ids") or [])) != measured_workers:
        invalid = True
        problems.append("duplicate worker identities in evidence")
    if not overlap.get("target_seam"):
        invalid = True
        problems.append("no target_seam recorded (overlap must be at the product operation)")
    if not overlap.get("schedule_id"):
        invalid = True
        problems.append("no schedule_id recorded")
    if requested_seam and str(overlap.get("target_seam")) != str(requested_seam):
        invalid = True
        problems.append(
            f"requested target seam {requested_seam!r} != measured {overlap.get('target_seam')!r} "
            "(evidence corresponds to a different mechanism)"
        )
    if requested_schedule:
        measured_schedule = str(overlap.get("schedule_id") or "")
        # measured schedule ids are attempt-scoped ({scenario_id}-A{attempt});
        # the requested scenario-scoped identity must match exactly or by that
        # documented attempt suffix — any other identity is a different run.
        if measured_schedule != str(requested_schedule) and \
                not measured_schedule.startswith(str(requested_schedule) + "-"):
            invalid = True
            problems.append(
                f"requested schedule {requested_schedule!r} != measured {overlap.get('schedule_id')!r}"
            )
    participants = overlap.get("participant_identities") or overlap.get("worker_ids") or []
    if measured_workers and len(participants) != measured_workers:
        invalid = True
        problems.append("recorded participant identities do not match the measured workers")
    if native_intervals is None or not native_intervals:
        # B-18: NO wrapper fallback — an oracle claiming native-operation
        # concurrency without native_operation_intervals is an invalid measurement.
        invalid = True
        problems.append(
            "native_operation_intervals missing: native-operation concurrency cannot "
            "be proven from wrapper intervals (no fallback)"
        )
    else:
        if len(intervals) != measured_workers or len(native_intervals) != measured_workers:
            invalid = True
            problems.append("interval count does not match measured workers")
        if not problems and measured_workers >= 2:
            if not (max(i[0] for i in native_intervals) < min(i[1] for i in native_intervals)):
                invalid = True
                problems.append(
                    "native operation intervals do not overlap (wrapper windows alone "
                    "do not prove operation overlap)"
                )
    return OracleCheck(
        "concurrency_overlap_proven", bool(params.get("required", True)),
        None if invalid else (not problems),
        "; ".join(problems) if problems else
        f"native-operation overlap proven at {overlap.get('target_seam')!r} across {measured_workers} workers",
        [frozen.sha256], invalid=invalid,
    )


def _concurrency_mechanism_record(spec: dict):
    """F12: the scenario must reference a REGISTERED concurrency mechanism;
    the typed oracle derives its proof obligations from the registry record,
    not from free-form scenario labels."""
    from .mechanisms import CONCURRENCY_MECHANISMS

    requested = None
    for entry in spec.get("concurrency_schedule") or []:
        if entry.get("mechanism_id"):
            requested = entry["mechanism_id"]
            break
    if requested is None:
        requested = spec.get("concurrency_mechanism_id")
    if requested is None:
        return None, None
    return requested, CONCURRENCY_MECHANISMS.get(requested)


def oracle_same_user_serialization_proven(frozen: FrozenEvidence, spec: dict,
                                          params: dict) -> OracleCheck:
    """F12 (IV5): serialization is not overlap.

    A same-user lock that works correctly SHOULD serialize critical sections,
    so simultaneous critical-section overlap must NOT be required as proof of
    correct same-user serialization. Required proof (registered mechanism
    ALEXEY.SAME_USER_SERIALIZATION):

      - two or more tasks attempted the same user;
      - the same lock identity was used;
      - each later task began waiting before the earlier holder released
        (contention evidence) or equivalent contention evidence;
      - critical sections do NOT overlap;
      - each task eventually acquires and completes release;
      - the declared state invariant holds after completion (checked by the
        separate concurrency_invariant adjudicator).
    """
    ev = frozen.load()
    overlap = _payload(ev).get("concurrency") or {}
    problems: list[str] = []
    invalid = False
    mechanism_id, record = _concurrency_mechanism_record(spec)
    if record is not None and record.oracle != "same_user_serialization_proven":
        invalid = True
        problems.append(
            f"registered concurrency mechanism {mechanism_id!r} is not a "
            "same-user serialization mechanism"
        )
    requested_seam = params.get("target_seam") or (
        record.physical_seam if record else None)
    workers = int(params.get("workers", 0)) or int(overlap.get("workers", 0) or 0)
    worker_ids = overlap.get("worker_ids") or []
    task_records = overlap.get("task_records") or []
    lock_user_ids = overlap.get("lock_user_ids") or []
    if not overlap.get("same_user_shared_lock"):
        invalid = True
        problems.append("tasks did not share ONE lock identity (not a same-user measurement)")
    # IV6-F12B symmetry: the SHARED lock identity must be evidenced per task
    same_lock_ids = [t.get("lock_identity") for t in task_records]
    if task_records and (any(li is None for li in same_lock_ids)
                         or len(set(map(str, same_lock_ids))) != 1):
        invalid = True
        problems.append(
            "per-task lock identities are not ONE shared identity: same-user "
            "serialization requires the measured tasks to contend on the same lock")
    if len(set(lock_user_ids)) != 1 or not lock_user_ids:
        invalid = True
        problems.append("tasks did not address the SAME user")
    if workers and len(worker_ids) != workers:
        invalid = True
        problems.append(f"declared {workers} workers but {len(worker_ids)} measured")
    if len(set(worker_ids)) != len(worker_ids):
        invalid = True
        problems.append("duplicate worker identities in evidence")
    if len(task_records) < 2:
        invalid = True
        problems.append(
            "fewer than two per-task records: single-task evidence cannot prove "
            "serialization under contention"
        )
    if not overlap.get("target_seam"):
        invalid = True
        problems.append("no target_seam recorded")
    elif requested_seam and str(overlap.get("target_seam")) != str(requested_seam):
        invalid = True
        problems.append(
            f"requested target seam {requested_seam!r} != measured {overlap.get('target_seam')!r}"
        )
    if not overlap.get("schedule_id"):
        invalid = True
        problems.append("no schedule_id recorded")
    # contention evidence: every non-first task began waiting before the
    # earlier holder's release completed (equivalent contention evidence:
    # a recorded positive acquire wait while the lock was held)
    if not overlap.get("contention_evidence"):
        invalid = True
        problems.append(
            "no contention evidence: no later task is proven to have begun waiting "
            "before the earlier holder released (overlap-free sequential tasks that "
            "never contended do not prove same-user serialization)"
        )
    else:
        ce = overlap["contention_evidence"]
        if ce.get("contention_proven") is not True:
            invalid = True
            problems.append(f"contention evidence not satisfied: {ce}")
        if ce.get("waiting_tasks") is not None and int(ce.get("waiting_tasks") or 0) < 1:
            invalid = True
            problems.append("zero tasks recorded waiting on the held lock")
    # serialization: critical sections must NOT overlap
    if overlap.get("critical_sections_non_overlapping") is not True:
        invalid = True
        problems.append("critical sections overlapped (same-user serialization violated)")
    # release completion for every task
    if not overlap.get("lock_release_completed_all"):
        invalid = True
        problems.append("not every task completed release")
    # per-task timing/identity records (F07): TASK_ID / USER_ID / WAIT_START /
    # ACQUIRED_AT / CRITICAL_END / RELEASE_COMPLETED must be present and
    # distinct per task
    required_task_keys = {"task_id", "user_id", "wait_start_ns", "acquired_at_ns",
                          "critical_end_ns", "release_completed"}
    for tr in task_records:
        missing = required_task_keys - set(tr)
        if missing:
            invalid = True
            problems.append(f"task record missing timing/identity fields {sorted(missing)}")
    task_ids = [tr.get("task_id") for tr in task_records]
    if len(set(map(str, task_ids))) != len(task_ids):
        invalid = True
        problems.append("duplicate task identities in per-task records")
    return OracleCheck(
        "same_user_serialization_proven", bool(params.get("required", True)),
        None if invalid else True,
        "; ".join(problems) if problems else
        f"same-user serialization proven at {overlap.get('target_seam')!r} across "
        f"{len(task_records)} contended tasks (contention + non-overlapping "
        "critical sections + full release)",
        [frozen.sha256], invalid=invalid,
    )


def oracle_different_user_independence_proven(frozen: FrozenEvidence, spec: dict,
                                              params: dict) -> OracleCheck:
    """F12 (IV5) + IV6-F12B: different-user independence must prove ACTUAL
    distinct lock identity — user-ID labels, interval counts and topology
    assertions are NOT proof. Required evidence:
      - USER_1 != USER_2 (distinct users addressed);
      - LOCK_IDENTITY_1 != LOCK_IDENTITY_2 recorded per task and distinct —
        a shared lock with serial intervals is REFUTED;
      - each native operation invoked, with per-task operation records bound
        to their actual tasks (task/user/lock identity consistent);
      - the controlled schedule permits simultaneous progress: native
        operation intervals overlap (independence evidence);
      - per-user state remains independent (separate concurrency_invariant
        adjudicator)."""
    ev = frozen.load()
    overlap = _payload(ev).get("concurrency") or {}
    problems: list[str] = []
    invalid = False
    mechanism_id, record = _concurrency_mechanism_record(spec)
    if record is not None and record.oracle != "different_user_independence_proven":
        invalid = True
        problems.append(
            f"registered concurrency mechanism {mechanism_id!r} is not a "
            "different-user independence mechanism"
        )
    requested_seam = params.get("target_seam") or (
        record.physical_seam if record else None)
    workers = int(params.get("workers", 0)) or int(overlap.get("workers", 0) or 0)
    worker_ids = overlap.get("worker_ids") or []
    lock_user_ids = overlap.get("lock_user_ids") or []
    native_intervals = overlap.get("native_operation_intervals")
    task_records = overlap.get("task_records") or []
    if overlap.get("same_user_shared_lock"):
        invalid = True
        problems.append("tasks shared ONE lock identity (not a different-user measurement)")
    if len(set(lock_user_ids)) != len(lock_user_ids) or len(lock_user_ids) < 2:
        invalid = True
        problems.append("tasks did not address DISTINCT users")
    if workers and len(worker_ids) != workers:
        invalid = True
        problems.append(f"declared {workers} workers but {len(worker_ids)} measured")
    # IV6-F12B core: actual DISTINCT lock identities, recorded per task
    lock_identities = [t.get("lock_identity") for t in task_records] \
        or overlap.get("lock_identities_by_task") or []
    if not lock_identities or any(li is None for li in lock_identities):
        invalid = True
        problems.append(
            "no per-task lock identity recorded: distinct-lock independence "
            "cannot be inferred from user IDs, labels or interval presence"
        )
    elif len(set(map(str, lock_identities))) != len(lock_identities):
        invalid = True
        problems.append(
            "tasks shared ONE actual lock identity — a shared lock with serial "
            "intervals is NOT different-user independence"
        )
    # Identity closure: each operation record's declared user, declared
    # worker/task, actual lock and actual interval are the same participant.
    # Set cardinality is not that binding. Unrelated task ids or users fail
    # even when timings, counts and distinct locks look correct.
    declared_tasks = {str(w) for w in worker_ids}
    declared_users = {str(u) for u in lock_user_ids}
    record_tasks = {str(t.get("task_id")) for t in task_records}
    record_users = {str(t.get("user_id")) for t in task_records}
    if task_records and declared_tasks and record_tasks != declared_tasks:
        invalid = True
        problems.append(
            "task records do not bind to the declared worker/task ids "
            f"(records {sorted(record_tasks)} vs declared {sorted(declared_tasks)})"
        )
    if task_records and declared_users and record_users != declared_users:
        invalid = True
        problems.append(
            "task records do not bind to the declared user ids "
            f"(records {sorted(record_users)} vs declared {sorted(declared_users)})"
        )
    interval_pairs = [tuple(pair) for pair in (native_intervals or [])]
    for tr in task_records:
        task_id = str(tr.get("task_id"))
        user_id = str(tr.get("user_id"))
        if declared_tasks and task_id not in declared_tasks:
            invalid = True
            problems.append(f"task record {task_id!r} is not a declared worker")
        if declared_users and user_id not in declared_users:
            invalid = True
            problems.append(f"task record user {user_id!r} is not a declared user")
        own_interval = (tr.get("acquired_at_ns"), tr.get("critical_end_ns"))
        if native_intervals and own_interval not in interval_pairs:
            invalid = True
            problems.append(
                f"task {task_id!r} interval is not that participant's native "
                "operation interval"
            )
        lock_id = str(tr.get("lock_identity") or "")
        if user_id and user_id not in lock_id:
            invalid = True
            problems.append(
                f"lock identity {lock_id!r} is not the lock of declared user {user_id}"
            )
    # per-task records bound to their actual tasks/users/locks
    if len(task_records) != len(worker_ids):
        invalid = True
        problems.append("per-task operation records do not match measured workers")
    else:
        user_lock_pairs = {(t.get("user_id"), t.get("lock_identity")) for t in task_records}
        if len(user_lock_pairs) != len({t.get("user_id") for t in task_records}):
            invalid = True
            problems.append("per-user lock identity is not consistent across tasks")
    if not overlap.get("target_seam"):
        invalid = True
        problems.append("no target_seam recorded")
    elif requested_seam and str(overlap.get("target_seam")) != str(requested_seam):
        invalid = True
        problems.append(
            f"requested target seam {requested_seam!r} != measured {overlap.get('target_seam')!r}"
        )
    if not overlap.get("schedule_id"):
        invalid = True
        problems.append("no schedule_id recorded")
    if not native_intervals:
        invalid = True
        problems.append(
            "native_operation_intervals missing: independence cannot be proven "
            "from wrapper intervals (no fallback)"
        )
    elif len(native_intervals) != len(worker_ids):
        invalid = True
        problems.append("interval count does not match measured workers")
    elif not (max(i[0] for i in native_intervals) < min(i[1] for i in native_intervals)):
        invalid = True
        problems.append(
            "native operation intervals do not overlap: the controlled schedule "
            "did not permit simultaneous independent progress (serial execution "
            "on distinct locks does not prove independence)"
        )
    if not overlap.get("lock_release_completed_all"):
        invalid = True
        problems.append("not every task completed release")
    return OracleCheck(
        "different_user_independence_proven", bool(params.get("required", True)),
        None if invalid else True,
        "; ".join(problems) if problems else
        f"different-user independence proven at {overlap.get('target_seam')!r} "
        f"across {len(worker_ids)} users with {len(set(map(str, lock_identities)))} "
        "distinct lock identities and overlapping native operations",
        [frozen.sha256], invalid=invalid,
    )


def oracle_concurrency_invariant(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "state")
    final_state = _require_executed(ev, _observed(ev, "state"), "concurrency_invariant")
    expected_state = params.get("expected_state", spec.get("expected", {}).get("state")) or {}
    per_user = params.get("per_user", False)
    mismatches: dict[str, Any] = {}
    if per_user:
        for user_id, exp in expected_state.items():
            user_actual = (final_state or {}).get(str(user_id))
            if not isinstance(user_actual, dict):
                mismatches[str(user_id)] = {"expected": exp, "actual": "<USER_ABSENT>"}
                continue
            for k, v in (exp or {}).items():
                if k not in user_actual:
                    mismatches[f"{user_id}.{k}"] = {"expected": v, "actual": "<KEY_ABSENT>"}
                elif user_actual[k] != v:
                    mismatches[f"{user_id}.{k}"] = {"expected": v, "actual": user_actual[k]}
    else:
        for k, v in expected_state.items():
            if k not in (final_state or {}):
                mismatches[k] = {"expected": v, "actual": "<KEY_ABSENT>"}
            elif (final_state or {})[k] != v:
                mismatches[k] = {"expected": v, "actual": (final_state or {})[k]}
    return OracleCheck("concurrency_invariant", bool(params.get("required", True)), not mismatches,
                       "post-interleaving invariant satisfied" if not mismatches else f"invariant violated: {mismatches}",
                       [frozen.sha256])


def oracle_fault_confirmed_injected(frozen: FrozenEvidence, spec: dict, params: dict,
                                     supported_fault_hooks: tuple[str, ...] | None = None) -> OracleCheck:
    """Fault contract (owner §54; IV4 B-18 + IV5 F13).

    Since CORR5 the scenario may reference a REGISTERED FAULT_MECHANISM_ID:
    the evidence kind/target/point must equal the REGISTRY record (the
    instrumentation derives them from the registered mechanism
    implementation, and the scenario expectation is checked against that
    registry identity — a scenario can no longer self-label arbitrary
    target/point/kind and have the instrumentation repeat those labels back
    as proof).

    Capability semantics (F13 §30): supported_fault_hooks is a KNOWN
    capability tuple — None means "capability unknown" (direct oracle calls
    skip the capability check); an EMPTY tuple means NO supported fault
    mechanism and disables nothing: any requested kind is invalid.

    Invalid conditions are measurement-invalid, not product FAIL. An
    unsupported kind yields NO product verdict."""
    from .mechanisms import FAULT_MECHANISMS

    ev = frozen.load()
    fault = _payload(ev).get("fault") or {}
    requested = (spec.get("fault_schedule") or [{}])[0]
    problems: list[str] = []
    invalid = False
    if fault.get("fault_confirmed_injected") is not True:
        invalid = True
        problems.append("injection not confirmed by the hook")
    mechanism = fault.get("mechanism_evidence") or {}
    kind = str(requested.get("kind") or fault.get("fault_kind") or "")
    mechanism_id = requested.get("mechanism_id") or fault.get("fault_mechanism_id")
    registry_record = FAULT_MECHANISMS.get(mechanism_id) if mechanism_id else None
    if mechanism_id and registry_record is None:
        invalid = True
        problems.append(
            f"requested FAULT_MECHANISM_ID {mechanism_id!r} is not registered "
            "(unknown mechanism identity: measurement invalid)"
        )
    if registry_record is not None:
        # F13: evidence identity is checked against the REGISTRY record, and
        # the kind-specific evidence schema is the registered one
        if str(fault.get("fault_mechanism_id")) != str(registry_record.mechanism_id):
            invalid = True
            problems.append(
                f"evidence mechanism id {fault.get('fault_mechanism_id')!r} != "
                f"registered {registry_record.mechanism_id!r}"
            )
        for label, evidence_value, registered_value in (
            ("kind", fault.get("fault_kind"), registry_record.kind),
            ("target", fault.get("fault_target"), registry_record.physical_fixture_seam),
            ("point", fault.get("fault_point"), registry_record.point),
        ):
            if str(evidence_value) != str(registered_value):
                invalid = True
                problems.append(
                    f"evidence fault {label} {evidence_value!r} != registered mechanism "
                    f"{label} {registered_value!r} (registry identity violated)"
                )
            # a scenario that ALSO declares free-form labels must agree with
            # the registry, or its contract is invalid
            declared = requested.get({"kind": "kind", "target": "target",
                                      "point": "point"}[label])
            if declared and str(declared) != str(registered_value):
                invalid = True
                problems.append(
                    f"scenario-declared fault {label} {declared!r} disagrees with the "
                    f"registered mechanism {label} {registered_value!r}"
                )
        required_keys = registry_record.evidence_schema
    else:
        if kind not in FAULT_MECHANISM_CONTRACTS:
            invalid = True
            problems.append(
                f"fault kind {kind!r} has no registered mechanism validation contract "
                "(unsupported kind: measurement invalid, never a product verdict)"
            )
            required_keys = ()
        else:
            required_keys = FAULT_MECHANISM_CONTRACTS[kind]
    if required_keys:
        missing_or_false = [k for k in required_keys
                            if not mechanism.get(k) or mechanism.get(k) is False]
        if missing_or_false:
            invalid = True
            problems.append(
                f"kind-specific mechanism evidence missing/unsatisfied for {missing_or_false}"
            )
    if supported_fault_hooks is not None and kind and kind not in supported_fault_hooks:
        invalid = True
        problems.append(
            f"requested fault kind {kind!r} is not a supported fault capability of the "
            "bound adapter registry entry"
        )
    if fault.get("operation_invoked") in (0, False, None) and requested:
        invalid = True
        problems.append(
            "the intended native operation was never invoked (B-11 reachability): a "
            "fault measurement cannot stand without the operation"
        )
    if requested.get("kind") and str(fault.get("fault_kind")) != str(requested["kind"]):
        invalid = True
        problems.append(
            f"requested fault kind {requested['kind']!r} but evidence reports {fault.get('fault_kind')!r}"
        )
    if registry_record is None:
        # legacy (non-registry) label agreement — the registry path above
        # already compared against the authoritative record
        if requested.get("target") and str(fault.get("fault_target")) != str(requested["target"]):
            invalid = True
            problems.append(f"requested target {requested['target']!r} != evidence {fault.get('fault_target')!r}")
        if requested.get("point") and str(fault.get("fault_point")) != str(requested["point"]):
            invalid = True
            problems.append(f"requested point {requested['point']!r} != evidence {fault.get('fault_point')!r}")
    if not mechanism:
        invalid = True
        problems.append("no kind-specific mechanism evidence recorded")
    else:
        if kind == "TIMEOUT_AFTER_PROCESSING" and (
                mechanism.get("deadline_exceeded") is not True or not (mechanism.get("delay_s") or 0) > 0):
            invalid = True
            problems.append("TIMEOUT without a measured deadline breach / positive delay")
        if kind == "LOST_RESPONSE" and mechanism.get("durable_write_proven") is not True:
            invalid = True
            problems.append(
                "LOST_RESPONSE without durable-write proof (durable processing "
                "cannot be inferred from return-value truthiness)"
            )
        if kind == "IDEMPOTENCY_EXPIRY" and mechanism.get("ttl_expiry_mechanism") is not True:
            invalid = True
            problems.append(
                "IDEMPOTENCY_EXPIRY without a controlled TTL/expiry mechanism "
                "(magic sentinel values are not expiry evidence)"
            )
        if kind == "LOST_RESPONSE" and mechanism.get("persisted_state_present") is False:
            invalid = True
            problems.append(
                "LOST_RESPONSE without post-turn persisted state: the native "
                "operation did not complete its normal persistence before the "
                "response was suppressed (F13 real-order contract)"
            )
    return OracleCheck(
        "fault_confirmed_injected", bool(params.get("required", True)),
        None if invalid else True,
        "; ".join(problems) if problems else
        f"fault {fault.get('fault_target')}/{fault.get('fault_point')} mechanism confirmed",
        [frozen.sha256], invalid=invalid,
    )


def oracle_fault_reaction(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "act")
    fault = _payload(ev).get("fault") or {}
    requested = (spec.get("fault_schedule") or [{}])[0]
    if (fault.get("fault_confirmed_injected") is not True or not (fault.get("mechanism_evidence") or {})
            or (requested.get("kind") and str(fault.get("fault_kind")) != str(requested["kind"]))):
        return OracleCheck("fault_reaction", bool(params.get("required", True)), None,
                           "fault not confirmed per contract: reaction cannot be adjudicated",
                           [frozen.sha256], invalid=True)
    reaction = _require_executed(ev, _observed(ev, "act"), "fault_reaction")
    acceptable = params.get("acceptable_reactions") or []
    return OracleCheck("fault_reaction", bool(params.get("required", True)), reaction in acceptable,
                       f"observed reaction {reaction!r} vs acceptable {acceptable}", [frozen.sha256])


def oracle_static_config(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = _payload(frozen.load())
    static_block = ev.get("static_inspection")
    if not isinstance(static_block, dict):
        return OracleCheck("static_config", bool(params.get("required", True)), False,
                           "frozen evidence lacks an authorized static inspection artifact", [frozen.sha256])
    queries = static_block.get("executed_queries") or []
    if not static_block.get("source_basis") or not queries:
        return OracleCheck("static_config", bool(params.get("required", True)), False,
                           "static artifact lacks derived queries/source basis", [frozen.sha256])
    expectations = params.get("expectations") or []
    facts = static_block.get("facts", {})
    failed = []
    for exp in expectations:
        got = facts.get(exp["path"], "<ABSENT>")
        if got != exp["value"]:
            failed.append({"query": exp["path"], "expected": exp["value"], "actual": got})
    return OracleCheck("static_config", bool(params.get("required", True)), not failed,
                       "authorized static queries hold" if not failed else f"static violations: {failed}",
                       [frozen.sha256])


def oracle_no_runtime_claim(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    """F09 (IV5): static is not runtime. no_runtime_claim rejects ONLY actual
    runtime-product assertions (provenance families EXECUTED /
    DERIVED_FROM_EXECUTED) on a NO_SEAM scenario. A legitimate
    STATIC_INSPECTION (or synthetic/semantic) fact is a different measurement
    provenance class, not a fabricated runtime claim — mandatory B-0004,
    B-0006 and C-0002 can produce authorized static facts while still proving
    that no PRODUCT_RUNTIME claim occurred."""
    from .provenance import is_runtime_product_provenance

    ev = _payload(frozen.load())
    runtime_keys = [
        k for k, v in (ev.get("actual") or {}).items()
        if isinstance(v, dict)
        and v.get("provenance") not in (None, "UNOBSERVED")
        and is_runtime_product_provenance(str(v.get("provenance")))
    ]
    return OracleCheck("no_runtime_claim", bool(params.get("required", True)), not runtime_keys,
                       "no fabricated runtime claim on a NO_SEAM scenario" if not runtime_keys
                       else f"AG-21 violation: runtime claims {runtime_keys} on a NO_SEAM scenario",
                       [frozen.sha256])


def oracle_price_authority(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "output")
    output_text = _require_executed(ev, _observed(ev, "output"), "price_authority")
    authorized = set(params.get("authorized_values") or [])
    numbers = re.findall(r"\d[\d\s\u00a0]{2,}(?=\s?(?:руб|RUB|\u20bd))", str(output_text or ""))
    normalized = {int(re.sub(r"[\s\u00a0]", "", n)) for n in numbers}
    invented = sorted(normalized - authorized)
    return OracleCheck("price_authority", bool(params.get("required", True)), not invented,
                       "all stated prices authorized" if not invented
                       else f"prices not in authorized set {sorted(authorized)}: {invented}", [frozen.sha256])


def oracle_semantic_input_frozen(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = _payload(frozen.load())
    sem = ev.get("semantic_input") or {}
    ok = (
        bool(sem.get("frozen")) and bool(sem.get("semantic_input_sha256"))
        and bool(sem.get("semantic_input_path"))
        and sem.get("raw_evidence_sha256") == frozen.sha256
        and re.fullmatch(r"[0-9a-f]{64}", str(sem.get("semantic_input_sha256", ""))) is not None
        and sem.get("attempt_index") == frozen.identity.attempt_index
    )
    return OracleCheck("semantic_input_frozen", bool(params.get("required", True)), ok,
                       "semantic package frozen, hash- and attempt-bound" if ok
                       else "semantic input not frozen / not bound to this observation", [frozen.sha256])


def oracle_catalog_fallback(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "state")
    state = _require_executed(ev, _observed(ev, "state"), "catalog_fallback")
    flow = state.get("flow") if isinstance(state, dict) else None
    expected_flow = params.get("expected_flow", spec.get("expected", {}).get("flow"))
    if expected_flow is None:
        raise OracleError("catalog_fallback requires an expected_flow specification")
    return OracleCheck("catalog_fallback", bool(params.get("required", True)), flow == expected_flow,
                       f"post-start flow {flow!r} vs expected native {expected_flow!r}", [frozen.sha256])


def oracle_outcome_class(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "act")
    outcome = _require_executed(ev, _observed(ev, "act"), "outcome_class")
    acceptable = params.get("acceptable_outcomes")
    forbidden = set(params.get("forbidden_outcomes") or ERROR_OUTCOME_CLASSES)
    ok = outcome not in forbidden and (acceptable is None or outcome in acceptable)
    return OracleCheck("outcome_class", bool(params.get("required", True)), ok,
                       f"observed outcome {outcome!r} vs acceptable={acceptable}", [frozen.sha256])


def oracle_gate_detection(frozen: FrozenEvidence, spec: dict, params: dict) -> OracleCheck:
    ev = frozen.load()
    _check_field_ref(ev, "state")
    detections = _require_executed(ev, _observed(ev, "state"), "gate_detection")
    required_detections = params.get("required_detections") or []
    if not isinstance(detections, dict):
        return OracleCheck("gate_detection", bool(params.get("required", True)), False,
                           "gate self-test did not produce a detection map", [frozen.sha256])
    missing = [d for d in required_detections if detections.get(d) is not True]
    return OracleCheck("gate_detection", bool(params.get("required", True)), not missing,
                       f"gates detected fixtures: {required_detections}" if not missing
                       else f"gate self-test failed to detect: {missing}", [frozen.sha256])


ORACLE_REGISTRY: dict[str, Any] = {
    "act_equals": oracle_act_equals,
    "origin_equals": oracle_origin_equals,
    "exact_link": oracle_exact_link,
    "no_payment_link": oracle_no_payment_link,
    "state_subset": oracle_state_subset,
    "decision_kind": oracle_decision_kind,
    "course_reference_kind": oracle_course_reference_kind,
    "course_ids_match": oracle_course_ids_match,
    "prohibited_output": oracle_prohibited_output,
    "tool_call_absent": oracle_tool_call_absent,
    "tool_call_present": oracle_tool_call_present,
    "state_mutation_absent": oracle_state_mutation_absent,
    "exactly_once": oracle_exactly_once,
    "duplicate_write_absent": oracle_duplicate_write_absent,
    "idempotent_retry": oracle_idempotent_retry,
    "concurrency_overlap_proven": oracle_concurrency_overlap_proven,
    "concurrency_invariant": oracle_concurrency_invariant,
    "same_user_serialization_proven": oracle_same_user_serialization_proven,
    "different_user_independence_proven": oracle_different_user_independence_proven,
    "fault_confirmed_injected": oracle_fault_confirmed_injected,
    "fault_reaction": oracle_fault_reaction,
    "static_config": oracle_static_config,
    "no_runtime_claim": oracle_no_runtime_claim,
    "price_authority": oracle_price_authority,
    "semantic_input_frozen": oracle_semantic_input_frozen,
    "catalog_fallback": oracle_catalog_fallback,
    "outcome_class": oracle_outcome_class,
    "gate_detection": oracle_gate_detection,
}

RUNTIME_ORACLES = set(ORACLE_REGISTRY) - {"static_config", "no_runtime_claim", "semantic_input_frozen"}
STATIC_ONLY_ORACLES = {"static_config"}
HARNESS_INTEGRITY_ORACLES = {"semantic_input_frozen", "no_runtime_claim"}

ORACLE_FIELD_NEEDS = {
    "act_equals": {"act"}, "origin_equals": {"origin"}, "exact_link": {"link"},
    "state_subset": {"state"}, "concurrency_invariant": {"state"},
    "catalog_fallback": {"state"}, "gate_detection": {"state"},
    "decision_kind": {"state"}, "course_reference_kind": {"state"},
    "course_ids_match": {"state"},
    "prohibited_output": {"output"}, "price_authority": {"output"},
    "no_payment_link": {"output"}, "tool_call_absent": {"tool_api"},
    "tool_call_present": {"tool_api"}, "state_mutation_absent": {"mutations"},
    "exactly_once": {"mutations"}, "duplicate_write_absent": {"mutations"},
    "idempotent_retry": {"mutations"}, "fault_reaction": {"act"},
    "outcome_class": {"act"},
}


def validate_oracle_completeness(spec: dict, native_observables: tuple[str, ...] = (),
                                 native_fault_hooks: tuple[str, ...] = ()) -> list[str]:
    """Pre-execution completeness = expectation consistency + adjudicator
    coverage (owner sections 17-19) + B-18 requested-fault-capability binding:
    a scenario requesting a fault kind the bound adapter does not support is a
    definition defect, not an executable measurement."""
    defects = validate_semantic_completeness(spec)
    defects += validate_expectation_consistency(spec, native_observables)
    oracles = spec.get("oracle") or []
    for o in oracles:
        if o.get("oracle") not in ORACLE_REGISTRY:
            defects.append(f"oracle {o.get('oracle')!r} is not registered")
    if native_fault_hooks:
        for fs in spec.get("fault_schedule") or []:
            kind = fs.get("kind")
            if kind and kind not in native_fault_hooks:
                defects.append(
                    f"requested fault kind {kind!r} is not a supported capability of "
                    "the bound adapter registry entry (target {fs.get('target')!r})"
                )
    return defects


class SpecIdentityMismatch(RuntimeError):
    """The specification presented for scoring is not the specification that
    produced the frozen evidence (IV4 B-02)."""


def evaluate_oracles(spec: dict, frozen: FrozenEvidence, *,
                     run_id: str, scenario_id: str, scenario_sha256: str,
                     observation_id: str, attempt_index: int,
                     supported_fault_hooks: tuple[str, ...] = (),
                     mutation_of_base_spec: dict | None = None) -> list[OracleCheck]:
    """SCORING ENTRY POINT — B-02 SPECIFICATION IDENTITY.

    The controlling scenario specification is bound to the evidence: the
    recomputed canonical SHA of the EXACT spec passed here must equal the
    scoring identity AND the frozen evidence identity. A different
    specification (foreign spec, altered expectations, changed oracles) can
    never be scored against frozen evidence.

    The semantic lifecycle oracle (semantic_input_frozen) is deferred to the
    post-package semantic path and skipped here so the spec passed to this
    entry point IS the complete controlling specification.

    The mutation gate must additionally present the ORIGINAL base spec
    (mutation_of_base_spec): its identity is verified against the frozen
    evidence first, which binds the mutation lineage to the authentic
    original observation (M-05). Only then may mutated specs be re-scored.
    """
    if mutation_of_base_spec is None:
        spec_sha = sha256_canonical(spec)
        if spec_sha != scenario_sha256:
            raise SpecIdentityMismatch(
                "specification identity mismatch: the spec presented for scoring "
                f"hashes to {spec_sha[:12]} but the scoring identity is "
                f"{str(scenario_sha256)[:12]} (foreign or altered specification)"
            )
    else:
        base_sha = sha256_canonical(mutation_of_base_spec)
        if base_sha != frozen.identity.scenario_sha256:
            raise SpecIdentityMismatch(
                "mutation lineage rejected: the presented BASE spec does not match "
                "the frozen evidence identity (mutations may only be re-scored "
                "against the authentic original observation)"
            )
    verified = frozen.verify_for(
        run_id=run_id, scenario_id=scenario_id, scenario_sha256=scenario_sha256,
        observation_id=observation_id, attempt_index=attempt_index,
    )
    del verified  # verification IS the gate; evaluators reload through the same check
    checks: list[OracleCheck] = []
    for entry in spec.get("oracle", []):
        name = entry.get("oracle")
        if name == "semantic_input_frozen":
            continue  # deferred to the semantic lifecycle path (post-package)
        fn = ORACLE_REGISTRY.get(name)
        if fn is None:
            checks.append(OracleCheck(name or "<missing>", bool(entry.get("required", True)),
                                      None, "oracle not registered: scenario/oracle invalid", invalid=True))
            continue
        if name == "fault_confirmed_injected":
            checks.append(fn(frozen, spec, entry.get("params", {}),
                             supported_fault_hooks=supported_fault_hooks))
        else:
            checks.append(fn(frozen, spec, entry.get("params", {})))
    return checks
