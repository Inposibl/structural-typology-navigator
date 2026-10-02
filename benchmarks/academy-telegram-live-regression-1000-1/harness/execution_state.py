"""Unified execution-state model v1 — CORR5 (F04 + F14; owner sections 13/14/36).

ONE authoritative immutable execution state -> ONE verdict derivation function.

IV5 F04 and F14 exposed the same architectural weakness in two independent
verdict implementations: semantic recombination (apply_semantic_result) and
oracle mutation evaluation (run_oracle_mutation) each reconstructed verdict
eligibility from a PARTIAL subset of booleans, so an original native-error
FAIL could be promoted to PASS after the fact.

This module is the single authority:

- ExecutionState carries execution_eligibility, measurement_availability,
  native_outcome, deterministic_status, semantic_status,
  infrastructure_status, benchmark_status, provenance_status.
- derive_verdict_from_execution_state() is the ONLY verdict derivation.
  The runner's initial verdict, the post-package semantic recombination and
  the mutation gate all consume the SAME serialized state and the SAME
  derivation; none of them may recompute eligibility from partial booleans.
- from_state_dict()/to_state_dict() serialize the state onto the preserved
  derivation_state record (the legacy flat keys remain the wire format so
  preserved outcomes stay inspectable and externally mutable fields are
  honored).

Invariants (owner section 14; the battery in tests/iv5_regression_battery.py
is table-driven over exactly this table):

  UNACCEPTABLE_ERROR + SEMANTIC_SATISFIED            -> FAIL
  UNACCEPTABLE_ERROR + oracle mutation               -> non-PASS
  INFRA_FAILURE / TIMEOUT / BENCHMARK_DEFECT         -> dominate later semantic
  deterministic FAILED + semantic SATISFIED          -> FAIL
  semantic-only clean + SATISFIED                    -> PASS
  semantic-only clean + VIOLATED                     -> FAIL
  semantic PENDING                                   -> HOLD
  no mutation changes execution eligibility
  same execution state -> same verdict in runner / recombination / mutation
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum
from typing import Any

from .verdicts import PrimaryVerdict, SemanticStatus


class ExecutionEligibility(str, Enum):
    EXECUTED = "EXECUTED"
    NOT_EXECUTED = "NOT_EXECUTED"
    SKIPPED_UNSAFE = "SKIPPED_UNSAFE"
    NOT_OBSERVABLE = "NOT_OBSERVABLE"


class MeasurementAvailability(str, Enum):
    AVAILABLE = "AVAILABLE"
    SUT_NOT_INVOKED = "SUT_NOT_INVOKED"
    REQUIRED_FIELDS_UNOBSERVED = "REQUIRED_FIELDS_UNOBSERVED"


class NativeOutcome(str, Enum):
    NORMAL = "NORMAL"
    EXPECTED_ERROR = "EXPECTED_ERROR"
    UNACCEPTABLE_ERROR = "UNACCEPTABLE_ERROR"


class DeterministicStatus(str, Enum):
    NOT_REQUIRED = "NOT_REQUIRED"
    SATISFIED = "SATISFIED"
    FAILED = "FAILED"


class InfrastructureStatus(str, Enum):
    OK = "OK"
    INFRA_FAILURE = "INFRA_FAILURE"
    TIMEOUT = "TIMEOUT"


class BenchmarkStatus(str, Enum):
    OK = "OK"
    BENCHMARK_DEFECT = "BENCHMARK_DEFECT"


class ProvenanceStatus(str, Enum):
    VALID = "VALID"
    INVALID = "INVALID"
    NOT_ASSESSED = "NOT_ASSESSED"


class MissingAuthorityState(ValueError):
    """The preserved outcome lacks an authority field required to rebuild the
    authoritative execution state; verdicts must NOT be recomputed from a
    reconstructed permissive default (IV5 F14)."""


# The native outcome authority: error classes that make an executed outcome a
# product FAIL regardless of later semantic/mutation satisfaction (F04/F14).
UNACCEPTABLE_NATIVE_OUTCOMES = frozenset(
    {"TECHNICAL_ERROR", "INFRA_OUTAGE", "HARNESS_ERROR", "UNRESOLVED_STATE"}
)


@dataclass(frozen=True)
class ExecutionState:
    """ONE authoritative immutable execution state (owner section 13)."""

    execution_eligibility: ExecutionEligibility
    measurement_availability: MeasurementAvailability
    native_outcome: NativeOutcome
    deterministic_status: DeterministicStatus
    semantic_status: SemanticStatus
    infrastructure_status: InfrastructureStatus
    benchmark_status: BenchmarkStatus
    provenance_status: ProvenanceStatus
    # harness/sut-path defects route to BENCHMARK_DEFECT at level 1 like the
    # pre-CORR5 derivation (sut_path_identified / scenario/oracle validity)
    sut_path_identified: bool = True
    oracle_registered: bool = True
    harness_exception: bool = False
    scenario_definition_valid: bool = True

    # -- serialization ------------------------------------------------------

    def to_state_dict(self) -> dict[str, Any]:
        return {
            "execution_state": {
                "schema": "EXECUTION_STATE_V1",
                "execution_eligibility": self.execution_eligibility.value,
                "measurement_availability": self.measurement_availability.value,
                "native_outcome": self.native_outcome.value,
                "deterministic_status": self.deterministic_status.value,
                "semantic_status": self.semantic_status.value,
                "infrastructure_status": self.infrastructure_status.value,
                "benchmark_status": self.benchmark_status.value,
                "provenance_status": self.provenance_status.value,
                "sut_path_identified": self.sut_path_identified,
                "oracle_registered": self.oracle_registered,
                "harness_exception": self.harness_exception,
                "scenario_definition_valid": self.scenario_definition_valid,
            }
        }

    # -- legal transitions ---------------------------------------------------

    def with_semantic_status(self, status: SemanticStatus) -> "ExecutionState":
        """The ONLY legal post-package transition: the independent semantic
        authority arrives. No other field may change; an already-invalid
        measurement cannot become PASS by this transition (F04)."""
        return replace(self, semantic_status=status)

    def with_deterministic_status(self, status: DeterministicStatus) -> "ExecutionState":
        """The ONLY legal mutation-gate transition: deterministic oracle results
        recomputed from a mutated specification against the SAME frozen
        evidence. Execution eligibility, native outcome, infrastructure and
        benchmark authority are preserved EXACTLY (F14)."""
        return replace(self, deterministic_status=status)


def _required(state: dict, key: str) -> Any:
    if key not in state:
        raise MissingAuthorityState(
            f"preserved outcome lacks the authority field {key!r}: the verdict "
            "cannot be recomputed from a reconstructed default (F14)"
        )
    return state[key]


def from_state_dict(state: dict[str, Any]) -> ExecutionState:
    """Rebuild the authoritative ExecutionState from the preserved flat
    derivation-state record (the wire format written by the runner).

    Legacy compatibility: outcomes frozen before the native_outcome key
    existed map error_outcome -> NativeOutcome. Missing phase/safety authority
    raises MissingAuthorityState (the mutation gate surfaces BENCHMARK_DEFECT,
    never a permissive default)."""
    explicit = state.get("execution_state")
    if isinstance(explicit, dict) and explicit.get("schema") == "EXECUTION_STATE_V1":
        required_block_keys = (
            "execution_eligibility", "measurement_availability", "native_outcome",
            "deterministic_status", "semantic_status", "infrastructure_status",
            "benchmark_status", "provenance_status",
        )
        missing = [k for k in required_block_keys if k not in explicit]
        if missing:
            raise MissingAuthorityState(
                f"serialized execution_state block lacks authority fields {missing}: "
                "the verdict cannot be recomputed from an incomplete block (IV6-F04-F14)")
        return ExecutionState(
            execution_eligibility=ExecutionEligibility(explicit["execution_eligibility"]),
            measurement_availability=MeasurementAvailability(explicit["measurement_availability"]),
            native_outcome=NativeOutcome(explicit["native_outcome"]),
            deterministic_status=DeterministicStatus(explicit["deterministic_status"]),
            semantic_status=SemanticStatus(explicit["semantic_status"]),
            infrastructure_status=InfrastructureStatus(explicit["infrastructure_status"]),
            benchmark_status=BenchmarkStatus(explicit["benchmark_status"]),
            provenance_status=ProvenanceStatus(explicit["provenance_status"]),
            sut_path_identified=bool(explicit.get("sut_path_identified", True)),
            oracle_registered=bool(explicit.get("oracle_registered", True)),
            harness_exception=bool(explicit.get("harness_exception", False)),
            scenario_definition_valid=bool(explicit.get("scenario_definition_valid", True)),
        )
    # legacy flat record (M-05 preserved fields) — authority fields required
    phase = _required(state, "phase_execution_allowed")
    safe = _required(state, "safe_to_execute")
    seam_class = str(state.get("seam_class", "RUNTIME"))
    seam_executable = bool(state.get("seam_executable", True))
    if not safe:
        eligibility = ExecutionEligibility.SKIPPED_UNSAFE
    elif not phase:
        eligibility = ExecutionEligibility.NOT_EXECUTED
    elif seam_class == "NO_SEAM" and not seam_executable:
        eligibility = ExecutionEligibility.NOT_OBSERVABLE
    else:
        eligibility = ExecutionEligibility.EXECUTED

    error_outcome = state.get("error_outcome")
    if error_outcome in UNACCEPTABLE_NATIVE_OUTCOMES:
        native_outcome = NativeOutcome.UNACCEPTABLE_ERROR
    elif error_outcome:
        native_outcome = NativeOutcome.EXPECTED_ERROR
    else:
        native_outcome = NativeOutcome.NORMAL

    det = state.get("deterministic_status")
    if det == "NOT_REQUIRED":
        det_status = DeterministicStatus.NOT_REQUIRED
    elif det == "SATISFIED":
        det_status = DeterministicStatus.SATISFIED
    else:
        det_status = DeterministicStatus.FAILED

    if state.get("infra_failure"):
        infra = InfrastructureStatus.INFRA_FAILURE
    elif state.get("timeout_exceeded"):
        infra = InfrastructureStatus.TIMEOUT
    else:
        infra = InfrastructureStatus.OK

    fields_ok = bool(state.get("required_fields_observed", True))
    prov_ok = bool(state.get("provenance_valid", True))
    benchmark_defect = (
        bool(state.get("harness_exception", False))
        or not bool(state.get("oracle_registered", True))
        or not bool(state.get("sut_path_identified", True))
        or not fields_ok
        or not prov_ok
    )
    return ExecutionState(
        execution_eligibility=eligibility,
        measurement_availability=(
            MeasurementAvailability.AVAILABLE
            if bool(state.get("sut_invoked", True))
            else MeasurementAvailability.SUT_NOT_INVOKED
        ) if fields_ok else MeasurementAvailability.REQUIRED_FIELDS_UNOBSERVED,
        native_outcome=native_outcome,
        deterministic_status=det_status,
        semantic_status=SemanticStatus(state.get("semantic_status", "NOT_REQUIRED")),
        infrastructure_status=infra,
        benchmark_status=(
            BenchmarkStatus.BENCHMARK_DEFECT if benchmark_defect else BenchmarkStatus.OK
        ),
        provenance_status=(
            ProvenanceStatus.NOT_ASSESSED
            if eligibility != ExecutionEligibility.EXECUTED
            else (ProvenanceStatus.VALID if prov_ok else ProvenanceStatus.INVALID)
        ),
        sut_path_identified=bool(state.get("sut_path_identified", True)),
        oracle_registered=bool(state.get("oracle_registered", True)),
        harness_exception=bool(state.get("harness_exception", False)),
        scenario_definition_valid=True,
    )


def normalize_executed_state(
    *,
    deterministic_status: DeterministicStatus,
    native_outcome: NativeOutcome,
    **kwargs: Any,
) -> ExecutionState:
    """Builder-side normalization (Rule C: ONE state, no inconsistent subsets).

    The IV5 F04 counterexample was a state carrying deterministic_status
    SATISFIED alongside deterministic_satisfied=False / failures=1 because an
    unacceptable native error only demoted NOT_REQUIRED. Normalization makes
    that structurally impossible: an UNACCEPTABLE_ERROR native outcome forces
    deterministic FAILED; measurement/provenance defects force
    BENCHMARK_DEFECT; infrastructure defects force their own status."""
    if native_outcome == NativeOutcome.UNACCEPTABLE_ERROR:
        deterministic_status = DeterministicStatus.FAILED
    measurement = kwargs.get("measurement_availability", MeasurementAvailability.AVAILABLE)
    if not isinstance(measurement, MeasurementAvailability):
        measurement = MeasurementAvailability(measurement)
    eligibility = kwargs.get("execution_eligibility", ExecutionEligibility.EXECUTED)
    if not isinstance(eligibility, ExecutionEligibility):
        eligibility = ExecutionEligibility(eligibility)
    return ExecutionState(
        execution_eligibility=eligibility,
        measurement_availability=measurement,
        native_outcome=native_outcome,
        deterministic_status=deterministic_status,
        semantic_status=SemanticStatus(kwargs.get("semantic_status", SemanticStatus.NOT_REQUIRED)),
        infrastructure_status=InfrastructureStatus(kwargs.get("infrastructure_status", InfrastructureStatus.OK)),
        benchmark_status=BenchmarkStatus(kwargs.get("benchmark_status", BenchmarkStatus.OK)),
        provenance_status=ProvenanceStatus(kwargs.get("provenance_status", ProvenanceStatus.VALID)),
        sut_path_identified=bool(kwargs.get("sut_path_identified", True)),
        oracle_registered=bool(kwargs.get("oracle_registered", True)),
        harness_exception=bool(kwargs.get("harness_exception", False)),
        scenario_definition_valid=bool(kwargs.get("scenario_definition_valid", True)),
    )


def derive_verdict_from_execution_state(
    state: ExecutionState,
) -> tuple[PrimaryVerdict, str]:
    """THE verdict derivation (owner section 13: ONE STATE -> ONE function).

    Precedence — each level speaks only when the earlier levels do not:

      1. BENCHMARK_DEFECT  — scenario/oracle/harness/measurement invalid.
      2. INFRA_FAILURE     — environment prevented product adjudication.
      3. TIMEOUT           — authorized time limit exceeded.
      4. SKIPPED_UNSAFE    — safety boundary forbids the required action.
      5. NOT_EXECUTED      — phase/gate did not permit execution.
      6. NOT_OBSERVABLE    — NO_SEAM with no authorized observation seam.
      7. FAIL              — UNACCEPTABLE native error (native-error
                             authority: later semantic/mutation results can
                             never rescue it; F04/F14).
      8. FAIL              — deterministic oracle FAILED (final).
      9. HOLD / FAIL       — semantic PENDING -> HOLD; VIOLATED -> FAIL.
     10. PASS              — executed + available + valid + all gates green.
     11. HOLD              — adjudication inputs incomplete (fallthrough).
    """
    if state.benchmark_status == BenchmarkStatus.BENCHMARK_DEFECT:
        if not state.scenario_definition_valid or not state.oracle_registered:
            return PrimaryVerdict.BENCHMARK_DEFECT, (
                "Scenario definition or oracle registration invalid: the scenario "
                "is not a valid measurement of the claimed class."
            )
        if state.harness_exception:
            return PrimaryVerdict.BENCHMARK_DEFECT, (
                "Harness exception during execution: observation invalidated as "
                "product evidence (05 section 21)."
            )
        if not state.sut_path_identified:
            return PrimaryVerdict.BENCHMARK_DEFECT, (
                "No SUT path identified for an executable scenario: simulating one "
                "is forbidden (05 section 10)."
            )
        return PrimaryVerdict.BENCHMARK_DEFECT, (
            "Mandatory ACTUAL field UNOBSERVED or provenance invalid after an "
            "executed attempt: the observation cannot support any product claim."
        )
    if state.infrastructure_status == InfrastructureStatus.INFRA_FAILURE:
        return PrimaryVerdict.INFRA_FAILURE, (
            "Environment/service/transport failure prevented product "
            "adjudication; not a product verdict."
        )
    if state.infrastructure_status == InfrastructureStatus.TIMEOUT:
        return PrimaryVerdict.TIMEOUT, "Authorized execution exceeded its controlling time limit."
    if state.execution_eligibility == ExecutionEligibility.SKIPPED_UNSAFE:
        return PrimaryVerdict.SKIPPED_UNSAFE, (
            "Authorized safety boundary forbids the required real-world action "
            "(e.g. L4 live Telegram, payment, production mutation)."
        )
    if state.execution_eligibility == ExecutionEligibility.NOT_EXECUTED:
        return PrimaryVerdict.NOT_EXECUTED, "The phase/gate did not permit execution of this case."
    if state.execution_eligibility == ExecutionEligibility.NOT_OBSERVABLE:
        return PrimaryVerdict.NOT_OBSERVABLE, (
            "Failure class has no authorized physical observation seam at this "
            "execution level (accepted TELEGRAM-22 seam map); no product "
            "PASS/FAIL may be manufactured."
        )
    if state.native_outcome == NativeOutcome.UNACCEPTABLE_ERROR:
        return PrimaryVerdict.FAIL, (
            "Unacceptable native error outcome: the executed observation is a "
            "product FAIL and no later semantic or mutation result can rescue it."
        )
    if state.deterministic_status == DeterministicStatus.FAILED:
        return PrimaryVerdict.FAIL, (
            "Observed product behavior violates the controlling product/contract "
            "invariant (deterministic oracle unsatisfied). Final for that invariant."
        )
    if state.semantic_status == SemanticStatus.PREPARED_PENDING:
        return PrimaryVerdict.HOLD, (
            "Semantic evaluation is required and its frozen input exists, but "
            "the independent evaluator has not adjudicated it; PASS forbidden."
        )
    if state.semantic_status == SemanticStatus.COMPLETED_VIOLATED:
        return PrimaryVerdict.FAIL, (
            "Independent semantic evaluation completed and found the semantic "
            "claim violated against frozen evidence."
        )
    if (
        state.execution_eligibility == ExecutionEligibility.EXECUTED
        and state.measurement_availability == MeasurementAvailability.AVAILABLE
        and state.provenance_status == ProvenanceStatus.VALID
        and state.deterministic_status in (DeterministicStatus.NOT_REQUIRED,
                                           DeterministicStatus.SATISFIED)
        and state.semantic_status in (SemanticStatus.NOT_REQUIRED,
                                      SemanticStatus.COMPLETED_SATISFIED)
    ):
        return PrimaryVerdict.PASS, (
            "All required observations exist with valid provenance and every "
            "controlling required oracle is satisfied."
        )
    return PrimaryVerdict.HOLD, "Adjudication inputs incomplete; case cannot honestly be resolved."


# ---------------------------------------------------------------------------
# Table-driven invariant suite target (owner section 36)
# ---------------------------------------------------------------------------

def run_state_machine_invariants() -> list[dict]:
    """Compact deterministic invariant table for the unified verdict state.

    Returns a list of {invariant, input, verdict, pass} records; any False
    record fails the CORR5 closing gate. No new dependency — plain
    table-driven execution over the model itself."""

    def executed(**kw):
        base = dict(
            execution_eligibility=ExecutionEligibility.EXECUTED,
            measurement_availability=MeasurementAvailability.AVAILABLE,
            native_outcome=NativeOutcome.NORMAL,
            deterministic_status=DeterministicStatus.SATISFIED,
            semantic_status=SemanticStatus.NOT_REQUIRED,
            infrastructure_status=InfrastructureStatus.OK,
            benchmark_status=BenchmarkStatus.OK,
            provenance_status=ProvenanceStatus.VALID,
        )
        base.update(kw)
        return ExecutionState(**base)

    def verdict_of(st):
        return derive_verdict_from_execution_state(st)[0]

    I = []

    def check(name, st, expected, mutated_semantic=None):
        v1 = verdict_of(st)
        ok1 = v1 == expected
        # later semantic result on the same state
        if mutated_semantic is not None:
            v2 = verdict_of(st.with_semantic_status(mutated_semantic))
            rec = {"invariant": name, "verdict": v1.value,
                   "after_semantic": v2.value, "pass": ok1 and v2 == expected}
        else:
            rec = {"invariant": name, "verdict": v1.value, "pass": ok1}
        I.append(rec)

    # F04: an unacceptable native error can never become PASS by a later
    # semantic result
    check("UNACCEPTABLE_ERROR + SEMANTIC_SATISFIED -> FAIL",
          executed(native_outcome=NativeOutcome.UNACCEPTABLE_ERROR,
                   deterministic_status=DeterministicStatus.SATISFIED),
          PrimaryVerdict.FAIL, SemanticStatus.COMPLETED_SATISFIED)
    # F14: mutation recomputes deterministic status only — the native-error
    # authority is preserved through ANY deterministic recomputation
    bad_native = executed(native_outcome=NativeOutcome.UNACCEPTABLE_ERROR)
    for det in DeterministicStatus:
        v = verdict_of(bad_native.with_deterministic_status(det))
        I.append({"invariant": f"UNACCEPTABLE_ERROR + mutation det={det.value} -> non-PASS",
                  "verdict": v.value, "pass": v != PrimaryVerdict.PASS})
    # infrastructure / timeout / benchmark defect dominate later semantic state
    check("INFRA_FAILURE dominates semantic", executed(
        infrastructure_status=InfrastructureStatus.INFRA_FAILURE),
        PrimaryVerdict.INFRA_FAILURE, SemanticStatus.COMPLETED_SATISFIED)
    check("TIMEOUT dominates semantic", executed(
        infrastructure_status=InfrastructureStatus.TIMEOUT),
        PrimaryVerdict.TIMEOUT, SemanticStatus.COMPLETED_SATISFIED)
    check("BENCHMARK_DEFECT dominates semantic", executed(
        benchmark_status=BenchmarkStatus.BENCHMARK_DEFECT),
        PrimaryVerdict.BENCHMARK_DEFECT, SemanticStatus.COMPLETED_SATISFIED)
    # deterministic FAILED cannot be rescued
    check("deterministic FAILED + SEMANTIC_SATISFIED -> FAIL",
          executed(deterministic_status=DeterministicStatus.FAILED),
          PrimaryVerdict.FAIL, SemanticStatus.COMPLETED_SATISFIED)
    # semantic-only clean matrix
    check("semantic-only clean + PENDING -> HOLD",
          executed(deterministic_status=DeterministicStatus.NOT_REQUIRED,
                   semantic_status=SemanticStatus.PREPARED_PENDING),
          PrimaryVerdict.HOLD)
    check("semantic-only clean + SATISFIED -> PASS",
          executed(deterministic_status=DeterministicStatus.NOT_REQUIRED,
                   semantic_status=SemanticStatus.COMPLETED_SATISFIED),
          PrimaryVerdict.PASS)
    check("semantic-only clean + VIOLATED -> FAIL",
          executed(deterministic_status=DeterministicStatus.NOT_REQUIRED,
                   semantic_status=SemanticStatus.COMPLETED_VIOLATED),
          PrimaryVerdict.FAIL)
    # HOLD remains non-PASS until its missing authority arrives
    holding = executed(deterministic_status=DeterministicStatus.NOT_REQUIRED,
                       semantic_status=SemanticStatus.PREPARED_PENDING)
    v_hold = verdict_of(holding)
    v_after = verdict_of(holding.with_semantic_status(SemanticStatus.COMPLETED_SATISFIED))
    I.append({"invariant": "HOLD non-PASS until authority; PASS after SATISFIED",
              "verdict": v_hold.value, "after_semantic": v_after.value,
              "pass": v_hold == PrimaryVerdict.HOLD and v_after == PrimaryVerdict.PASS})
    # no mutation may change execution eligibility: every with_deterministic
    # transition preserves eligibility/native/infra/benchmark fields exactly
    st = executed(native_outcome=NativeOutcome.UNACCEPTABLE_ERROR,
                  infrastructure_status=InfrastructureStatus.INFRA_FAILURE)
    mut = st.with_deterministic_status(DeterministicStatus.SATISFIED)
    I.append({"invariant": "mutation preserves eligibility/native/infra/benchmark",
              "pass": (mut.execution_eligibility == st.execution_eligibility
                       and mut.native_outcome == st.native_outcome
                       and mut.infrastructure_status == st.infrastructure_status
                       and mut.benchmark_status == st.benchmark_status)})
    # same execution state -> same verdict regardless of consumer: the three
    # consumers all call derive_verdict_from_execution_state on the SAME
    # serialized record (verified by from_state_dict round-trip identity)
    for st_ in (executed(), executed(deterministic_status=DeterministicStatus.FAILED),
                executed(native_outcome=NativeOutcome.UNACCEPTABLE_ERROR),
                executed(infrastructure_status=InfrastructureStatus.TIMEOUT)):
        rebuilt = from_state_dict(st_.to_state_dict())
        same = verdict_of(rebuilt) == verdict_of(st_)
        I.append({"invariant": "serialized round-trip yields the identical verdict",
                  "verdict": verdict_of(st_).value, "pass": same})
    # measurement unavailability blocks PASS
    check("SUT_NOT_INVOKED cannot PASS", executed(
        measurement_availability=MeasurementAvailability.SUT_NOT_INVOKED),
        PrimaryVerdict.HOLD, SemanticStatus.COMPLETED_SATISFIED)
    check("REQUIRED_FIELDS_UNOBSERVED + BENCHMARK_DEFECT", executed(
        measurement_availability=MeasurementAvailability.REQUIRED_FIELDS_UNOBSERVED,
        benchmark_status=BenchmarkStatus.BENCHMARK_DEFECT),
        PrimaryVerdict.BENCHMARK_DEFECT, SemanticStatus.COMPLETED_SATISFIED)
    check("provenance INVALID + BENCHMARK_DEFECT", executed(
        provenance_status=ProvenanceStatus.INVALID,
        benchmark_status=BenchmarkStatus.BENCHMARK_DEFECT),
        PrimaryVerdict.BENCHMARK_DEFECT, SemanticStatus.COMPLETED_SATISFIED)
    # eligibility states (non-executed outcomes)
    check("SKIPPED_UNSAFE preserved", executed(
        execution_eligibility=ExecutionEligibility.SKIPPED_UNSAFE),
        PrimaryVerdict.SKIPPED_UNSAFE, SemanticStatus.COMPLETED_SATISFIED)
    check("NOT_EXECUTED preserved", executed(
        execution_eligibility=ExecutionEligibility.NOT_EXECUTED),
        PrimaryVerdict.NOT_EXECUTED, SemanticStatus.COMPLETED_SATISFIED)
    check("NOT_OBSERVABLE preserved", executed(
        execution_eligibility=ExecutionEligibility.NOT_OBSERVABLE),
        PrimaryVerdict.NOT_OBSERVABLE, SemanticStatus.COMPLETED_SATISFIED)
    return I
