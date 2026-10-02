"""Oracle mutation gate v5 — CORR5 (F14; IV4 M-05, owner section 55).

The mutation test consumes the SAME authoritative execution state as the
runner's initial verdict and the semantic recombination: the preserved
derivation record is rebuilt into an ExecutionState (from_state_dict), the
mutation applies the ONE legal deterministic-status transition
(with_deterministic_status from the recomputed oracle results), and the
verdict is derived by the ONE derivation function.

IV5 F14 root cause closed at the architectural level: the reconstruction can
no longer discard native error-outcome authority — an actual runner FAIL for
an unacceptable native error cannot be reconstructed as base/mutated PASS,
because native_outcome lives in the authoritative state and dominates every
deterministic recomputation.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

from ..evidence import FrozenEvidence
from ..execution_state import (
    BenchmarkStatus,
    DeterministicStatus,
    ExecutionEligibility,
    InfrastructureStatus,
    MissingAuthorityState,
    NativeOutcome,
    derive_verdict_from_execution_state,
    from_state_dict,
)
from ..oracle import evaluate_oracles
from ..verdicts import PrimaryVerdict


# authoritative execution state that mutation must preserve EXACTLY (M-05 +
# F14: the native-error authority fields are part of the preserved record)
PRESERVED_AUTHORITY_FIELDS = (
    "phase_execution_allowed", "safe_to_execute", "seam_class", "seam_executable",
    "sut_invoked", "sut_path_identified", "required_fields_observed",
    "provenance_valid", "harness_exception", "timeout_exceeded", "infra_failure",
    "oracle_registered", "semantic_status", "semantic_only",
    "error_outcome", "native_outcome",
    "raw_evidence_path", "raw_evidence_sha256",
)


@dataclass
class MutationResult:
    scenario_id: str
    invariant: str
    mutated_value: Any
    base_verdict: str
    mutated_verdict: str
    flipped: bool
    state_preserved: bool
    detail: str


def mutate_expected(spec: dict, invariant: str, value: Any) -> dict:
    """Change ONLY the targeted expectation/oracle input."""
    mutated = copy.deepcopy(spec)
    if invariant == "price":
        for o in mutated["oracle"]:
            if o.get("oracle") == "price_authority":
                o.setdefault("params", {})["authorized_values"] = value
        return mutated
    if invariant == "prohibited_output":
        for o in mutated["oracle"]:
            if o.get("oracle") == "prohibited_output":
                o.setdefault("params", {})["prohibited"] = [value]
        return mutated
    if invariant == "flow":
        for o in mutated["oracle"]:
            if o.get("oracle") == "catalog_fallback":
                o.setdefault("params", {})["expected_flow"] = value
        return mutated
    if invariant == "course_ids":
        for o in mutated["oracle"]:
            if o.get("oracle") == "course_ids_match":
                o.setdefault("params", {})["expected_course_ids"] = value
        return mutated
    keys = {"act": ["expected_act", "acceptable_reactions"],
            "origin": ["expected_origin"],
            "state": ["expected_state"],
            "link": ["expected_link"],
            "decision_kind": ["expected_decision_kind"],
            "ref_kind": ["expected_kind"]}.get(invariant, [])
    for o in mutated["oracle"]:
        params = o.setdefault("params", {})
        for key in keys:
            params[key] = value
    return mutated


def _recomputed_deterministic_status(spec: dict, frozen: FrozenEvidence, *,
                                     base_spec: dict | None,
                                     run_id: str, scenario_id: str,
                                     scenario_sha256: str, observation_id: str,
                                     attempt_index: int) -> tuple[DeterministicStatus, str]:
    """Re-score the (possibly mutated) spec against the SAME frozen evidence
    and reduce the checks to the deterministic-status component of the ONE
    execution state. Evaluation failure is a benchmark defect, not PASS."""
    try:
        checks = evaluate_oracles(
            spec, frozen, run_id=run_id, scenario_id=scenario_id,
            scenario_sha256=scenario_sha256,
            observation_id=observation_id, attempt_index=attempt_index,
            mutation_of_base_spec=base_spec)
    except Exception as exc:  # noqa: BLE001
        return DeterministicStatus.FAILED, f"oracle evaluation raised: {exc}"
    required = [c for c in checks if c.required]
    if not required:
        return DeterministicStatus.NOT_REQUIRED, ""
    if all(c.satisfied is True for c in required):
        return DeterministicStatus.SATISFIED, ""
    return DeterministicStatus.FAILED, ""


def _verdict_from_state(spec: dict, frozen: FrozenEvidence, state: dict, *,
                        base_spec: dict | None,
                        run_id: str, scenario_id: str, scenario_sha256: str,
                        observation_id: str, attempt_index: int) -> tuple[PrimaryVerdict, str]:
    """Recompute the verdict from the AUTHORITATIVE original execution state:
    rebuild ExecutionState from the preserved record (a missing authority
    field refuses recomputation), apply the ONE legal deterministic-status
    transition from the recomputed oracle results, derive via the ONE
    function. Native-error, infra/timeout/benchmark, eligibility and
    measurement authority are carried unchanged (F14)."""
    try:
        exec_state = from_state_dict(state)
    except MissingAuthorityState as exc:
        return PrimaryVerdict.BENCHMARK_DEFECT, (
            "original outcome did not preserve the authoritative execution state: "
            f"{exc}"
        )
    det, note = _recomputed_deterministic_status(
        spec, frozen, base_spec=base_spec, run_id=run_id, scenario_id=scenario_id,
        scenario_sha256=scenario_sha256, observation_id=observation_id,
        attempt_index=attempt_index)
    return derive_verdict_from_execution_state(exec_state.with_deterministic_status(det))


def run_oracle_mutation(original_outcome, base_spec: dict, frozen: FrozenEvidence,
                        mutations: list[tuple[str, Any]], *, lane: str = "") -> list[MutationResult]:
    from ..evidence import sha256_canonical

    state = original_outcome.derivation_state
    identity = frozen.identity
    # M-05/B-02 evidence-identity binding: the ORIGINAL outcome must carry the
    # frozen evidence identity it claims to re-score.
    if state.get("raw_evidence_sha256") not in (None, frozen.sha256):
        raise ValueError(
            "mutation refused: original outcome evidence identity "
            f"{state.get('raw_evidence_sha256')} != frozen evidence {frozen.sha256}"
        )
    if sha256_canonical(base_spec) != identity.scenario_sha256:
        raise ValueError(
            "mutation refused: base spec is not the controlling specification of "
            "the frozen observation (lineage unbound)"
        )
    results: list[MutationResult] = []
    base_verdict, _ = _verdict_from_state(
        base_spec, frozen, state, base_spec=None,
        run_id=identity.run_id, scenario_id=identity.scenario_id,
        scenario_sha256=identity.scenario_sha256,
        observation_id=identity.observation_id, attempt_index=identity.attempt_index)
    # honest state-preservation proof: the authority fields of the ORIGINAL
    # outcome are compared before and after every recomputation
    preserved_snapshot = {k: state.get(k) for k in PRESERVED_AUTHORITY_FIELDS}
    for invariant, value in mutations:
        spec2 = mutate_expected(base_spec, invariant, value)
        mut_verdict, reason = _verdict_from_state(
            spec2, frozen, state, base_spec=base_spec,
            run_id=identity.run_id, scenario_id=identity.scenario_id,
            scenario_sha256=identity.scenario_sha256,
            observation_id=identity.observation_id, attempt_index=identity.attempt_index)
        state_preserved = all(state.get(k) == v for k, v in preserved_snapshot.items())
        # an original observation carrying non-derivable failure authority
        # (ineligible / infra / timeout / harness error / unacceptable native
        # error) can never become PASS through a mutation (F14)
        try:
            st = from_state_dict(state)
            non_passable = (
                st.execution_eligibility != ExecutionEligibility.EXECUTED
                or st.infrastructure_status != InfrastructureStatus.OK
                or st.benchmark_status == BenchmarkStatus.BENCHMARK_DEFECT
                or st.native_outcome == NativeOutcome.UNACCEPTABLE_ERROR
            )
        except MissingAuthorityState:
            non_passable = True
        if non_passable:
            state_preserved = state_preserved and mut_verdict != PrimaryVerdict.PASS
        flipped = base_verdict == PrimaryVerdict.PASS and mut_verdict != PrimaryVerdict.PASS
        results.append(MutationResult(
            scenario_id=identity.scenario_id, invariant=invariant, mutated_value=value,
            base_verdict=base_verdict.value, mutated_verdict=mut_verdict.value,
            flipped=flipped, state_preserved=state_preserved,
            detail=f"[{lane}] {reason[:180]}"))
    return results


def gate_all_passed(results: list[MutationResult]) -> bool:
    return bool(results) and all(r.flipped and r.state_preserved for r in results)
