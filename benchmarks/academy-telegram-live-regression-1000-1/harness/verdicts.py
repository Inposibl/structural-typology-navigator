"""Primary verdict + stability model for ACADEMY-TELEGRAM-LIVE-REGRESSION-1000-1.

Owner decision (BENCHMARK-HARNESS-CORR1 prompt section 11) fixes the canonical
primary verdict vocabulary at EXACTLY these ten values. Semantics are binding;
derive_primary_verdict() is the single deterministic derivation point so no
runner branch can invent a verdict or silently promote an unobserved case.
"""

from __future__ import annotations

from enum import Enum


class PrimaryVerdict(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    HOLD = "HOLD"
    TIMEOUT = "TIMEOUT"
    NONDETERMINISTIC = "NONDETERMINISTIC"
    INFRA_FAILURE = "INFRA_FAILURE"
    SKIPPED_UNSAFE = "SKIPPED_UNSAFE"
    BENCHMARK_DEFECT = "BENCHMARK_DEFECT"
    NOT_EXECUTED = "NOT_EXECUTED"
    NOT_OBSERVABLE = "NOT_OBSERVABLE"


class StabilityLabel(str, Enum):
    NONE = "NONE"
    STABLE_PASS = "STABLE_PASS"
    FLAP = "FLAP"


class SemanticStatus(str, Enum):
    NOT_REQUIRED = "NOT_REQUIRED"
    PREPARED_PENDING = "PREPARED_PENDING"
    COMPLETED_SATISFIED = "COMPLETED_SATISFIED"
    COMPLETED_VIOLATED = "COMPLETED_VIOLATED"


VERDICT_SEMANTICS = {
    "PASS": (
        "Required observations exist, every controlling required deterministic "
        "oracle is satisfied, provenance is valid, semantic evaluation (when "
        "required) is completed and satisfied, and no harness exception occurred."
    ),
    "FAIL": (
        "An observed product behavior violates the controlling product/contract "
        "invariant. A deterministic FAIL is final for that invariant and cannot "
        "be converted to PASS by any later semantic or narrative act."
    ),
    "HOLD": (
        "Required evidence or authority needed for adjudication is unavailable "
        "and the case cannot honestly be resolved in the current phase."
    ),
    "TIMEOUT": "The authorized execution exceeded its controlling time limit.",
    "NONDETERMINISTIC": (
        "Repeated authorized executions materially disagree without an "
        "explained infrastructure cause."
    ),
    "INFRA_FAILURE": (
        "Environment, service, or transport failure prevents product "
        "adjudication. Never a product verdict."
    ),
    "SKIPPED_UNSAFE": (
        "Execution deliberately not performed because the authorized safety "
        "boundary forbids the required real-world action (e.g. L4 live "
        "Telegram with no sanctioned identity)."
    ),
    "BENCHMARK_DEFECT": (
        "The scenario, oracle, or harness itself is invalid for the claimed "
        "measurement; the observation says nothing about the product."
    ),
    "NOT_EXECUTED": "The case was not run because the phase/gate did not permit execution.",
    "NOT_OBSERVABLE": (
        "The failure class has no authorized physical observation seam at the "
        "relevant execution level. No product PASS/FAIL may be manufactured."
    ),
}

ALLOWED_VERDICT_STRINGS = frozenset(v.value for v in PrimaryVerdict)


class VerdictDerivation:
    """Machine-checkable inputs consumed by derive_primary_verdict()."""

    def __init__(
        self,
        *,
        phase_execution_allowed: bool,
        safe_to_execute: bool,
        seam_class: str,
        seam_authorized_and_executable: bool,
        scenario_definition_valid: bool,
        oracle_registered: bool,
        harness_exception: bool | None,
        timeout_exceeded: bool,
        infra_failure: bool,
        sut_invoked: bool,
        sut_path_identified: bool,
        required_fields_observed: bool,
        provenance_valid: bool,
        deterministic_oracles_satisfied: bool,
        deterministic_oracle_failures: int,
        semantic_status: SemanticStatus,
        repeat_outcomes: list[str] | None = None,
    ) -> None:
        self.phase_execution_allowed = phase_execution_allowed
        self.safe_to_execute = safe_to_execute
        self.seam_class = seam_class
        self.seam_authorized_and_executable = seam_authorized_and_executable
        self.scenario_definition_valid = scenario_definition_valid
        self.oracle_registered = oracle_registered
        self.harness_exception = harness_exception
        self.timeout_exceeded = timeout_exceeded
        self.infra_failure = infra_failure
        self.sut_invoked = sut_invoked
        self.sut_path_identified = sut_path_identified
        self.required_fields_observed = required_fields_observed
        self.provenance_valid = provenance_valid
        self.deterministic_oracles_satisfied = deterministic_oracles_satisfied
        self.deterministic_oracle_failures = deterministic_oracle_failures
        self.semantic_status = semantic_status
        self.repeat_outcomes = repeat_outcomes or []

    def no_seam(self) -> bool:
        return self.seam_class == "NO_SEAM"


def derive_primary_verdict(d: VerdictDerivation) -> tuple[PrimaryVerdict, str]:
    """Deterministically derive the primary verdict.

    Precedence order (each level only speaks when the earlier levels do not):

    1. BENCHMARK_DEFECT — scenario/oracle/harness invalid or the runner threw.
    2. INFRA_FAILURE    — environment prevented product adjudication.
    3. TIMEOUT          — authorized time limit exceeded.
    4. SKIPPED_UNSAFE   — safety boundary forbids the required real action.
    5. NOT_EXECUTED     — phase/gate did not permit execution.
    6. NOT_OBSERVABLE   — NO_SEAM class with no authorized runtime observation.
    7. NONDETERMINISTIC — authorized repeats materially disagree.
    8. FAIL             — any required deterministic oracle unsatisfied.
    9. HOLD             — semantic evaluation required but not completed.
    10. PASS            — every hard-pass condition of 05 section 25 holds.

    UNOBSERVED cannot reach PASS: it can only enter via
    required_fields_observed=False, which is routed to BENCHMARK_DEFECT when it
    indicates a harness/oracle gap and otherwise blocks PASS into HOLD.
    """

    # 1 — benchmark/harness defects stop their own claims.
    if not d.scenario_definition_valid or not d.oracle_registered:
        return PrimaryVerdict.BENCHMARK_DEFECT, (
            "Scenario definition or oracle registration invalid: the scenario "
            "is not a valid measurement of the claimed class."
        )
    if d.harness_exception is True:
        return PrimaryVerdict.BENCHMARK_DEFECT, (
            "Harness exception during execution: observation invalidated as "
            "product evidence (05 section 21)."
        )
    if not d.sut_path_identified:
        return PrimaryVerdict.BENCHMARK_DEFECT, (
            "No SUT path identified for an executable scenario: simulating one "
            "is forbidden (05 section 10)."
        )
    if not d.required_fields_observed or not d.provenance_valid:
        return PrimaryVerdict.BENCHMARK_DEFECT, (
            "Mandatory ACTUAL field UNOBSERVED or provenance invalid after an "
            "executed attempt: the observation cannot support any product claim."
        )

    # 2 — infrastructure.
    if d.infra_failure:
        return PrimaryVerdict.INFRA_FAILURE, (
            "Environment/service/transport failure prevented product "
            "adjudication; not a product verdict."
        )

    # 3 — timeout.
    if d.timeout_exceeded:
        return PrimaryVerdict.TIMEOUT, "Authorized execution exceeded its controlling time limit."

    # 4 — safety.
    if not d.safe_to_execute:
        return PrimaryVerdict.SKIPPED_UNSAFE, (
            "Authorized safety boundary forbids the required real-world action "
            "(e.g. L4 live Telegram, payment, production mutation)."
        )

    # 5 — phase gate.
    if not d.phase_execution_allowed:
        return PrimaryVerdict.NOT_EXECUTED, (
            "The phase/gate did not permit execution of this case."
        )

    # 6 — honest unobservability.
    if d.no_seam() and not d.seam_authorized_and_executable:
        return PrimaryVerdict.NOT_OBSERVABLE, (
            "Failure class has no authorized physical observation seam at this "
            "execution level (accepted TELEGRAM-22 seam map); no product "
            "PASS/FAIL may be manufactured."
        )

    # 7 — nondeterminism across authorized repeats.
    if d.repeat_outcomes:
        distinct = set(d.repeat_outcomes)
        if len(distinct) > 1:
            return PrimaryVerdict.NONDETERMINISTIC, (
                "Repeated authorized executions materially disagree without an "
                "explained infrastructure cause."
            )

    # 8 — deterministic FAIL is final.
    if not d.deterministic_oracles_satisfied or d.deterministic_oracle_failures > 0:
        return PrimaryVerdict.FAIL, (
            "Observed product behavior violates the controlling product/contract "
            "invariant (deterministic oracle unsatisfied). Final for that invariant."
        )

    # 9 — semantic evaluation is required but has not been completed.
    if d.semantic_status == SemanticStatus.PREPARED_PENDING:
        return PrimaryVerdict.HOLD, (
            "Semantic evaluation is required and its frozen input exists, but "
            "the independent evaluator has not adjudicated it; PASS forbidden."
        )
    if d.semantic_status == SemanticStatus.COMPLETED_VIOLATED:
        return PrimaryVerdict.FAIL, (
            "Independent semantic evaluation completed and found the semantic "
            "claim violated against frozen evidence."
        )

    # 10 — hard-pass gate (05 section 25).
    if (
        d.sut_invoked
        and d.required_fields_observed
        and d.provenance_valid
        and d.deterministic_oracles_satisfied
        and d.semantic_status in (SemanticStatus.NOT_REQUIRED, SemanticStatus.COMPLETED_SATISFIED)
    ):
        return PrimaryVerdict.PASS, (
            "All required observations exist with valid provenance and every "
            "controlling required oracle is satisfied."
        )

    return PrimaryVerdict.HOLD, "Adjudication inputs incomplete; case cannot honestly be resolved."


def derive_stability_label(verdicts: list[PrimaryVerdict]) -> StabilityLabel:
    """Stability labels are NOT primary verdicts (owner section 12).

    STABLE_PASS only when every authorized repeat is PASS. FLAP when outcomes
    materially mix. Never substitutes for FAIL/NONDETERMINISTIC semantics.
    """
    if not verdicts:
        return StabilityLabel.NONE
    if all(v == PrimaryVerdict.PASS for v in verdicts):
        return StabilityLabel.STABLE_PASS
    if len(set(verdicts)) > 1 and PrimaryVerdict.PASS in verdicts:
        return StabilityLabel.FLAP
    return StabilityLabel.NONE
