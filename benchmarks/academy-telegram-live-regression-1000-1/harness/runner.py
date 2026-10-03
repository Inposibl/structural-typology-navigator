"""Runner v3 — order-of-operations engine (CORR3).

TRUST ARCHITECTURE (owner sections 6/7/15/16):

    load scenario
    -> completeness + expectation-consistency + semantic-completeness gates
    -> payment-lane boundary (ALL SEVEN NOT_PROVEN classes)
    -> phase / safety / level / L4 gates
    -> PRODUCT lane ONLY: runner calls the binding AUTHORITY itself,
       constructs the BindingToken, and the FACTORY creates the adapter
       (caller-supplied adapter objects are structurally impossible)
    -> frozen ExecutionRequest (no shared mutable identity)
    -> ADAPTER EXECUTION (RawCapture, no provenance)
    -> registry-assigned provenance -> sanitize -> atomic exclusive freeze
    -> identity-checked deterministic oracles (invalid = measurement invalid)
    -> semantic package (PENDING) -> verdict
    -> semantic result ingestion + integrated final recombination

No product PASS without authentic product observation; no observation without
an authenticated native adapter; no adapter without authenticated binding.
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from . import verdicts as vmod
from .evidence import (
    EvidenceIdentity,
    EvidenceImmutableViolation,
    EvidencePathError,
    Observation,
    ObservedFieldError,
    ObservedValue,
    ProvenanceViolation,
    RawCapture,
    UNOBSERVED,
    canonical_json,
    freeze_evidence,
    sanitize_obj,
    sha256_canonical,
    validate_meaningful_transcript,
)
from .execution_request import build_execution_request
from .execution_state import (
    BenchmarkStatus,
    DeterministicStatus,
    ExecutionEligibility,
    ExecutionState,
    InfrastructureStatus,
    MeasurementAvailability,
    NativeOutcome,
    ProvenanceStatus,
    derive_verdict_from_execution_state,
    from_state_dict,
    normalize_executed_state,
)
from .factory import (
    BindingToken,
    FactoryRejected,
    LANE_CALIBRATION,
    LANE_PRODUCT,
    _import_implementation,
    create_calibration_adapter,
    create_product_adapter,
    resolve_adapter_spec,
)
from .oracle import (
    ERROR_OUTCOME_CLASSES,
    ORACLE_FIELD_NEEDS,
    OracleCheck,
    evaluate_oracles,
    validate_oracle_completeness,
)
from .provenance import ProvenanceKind
from .seams import sut_binding
from .semantic_eval import prepare_semantic_input
from .verdicts import (
    PrimaryVerdict,
    SemanticStatus,
    StabilityLabel,
    VerdictDerivation,
    derive_primary_verdict,
    derive_stability_label,
)

TRANSCRIPT_REQUIRED_CLASSES = frozenset(
    {
        "AG-01", "AG-02", "AG-03", "AG-04", "AG-05", "AG-06", "AG-07", "AG-08",
        "AG-09", "AG-10", "AG-11", "AG-12", "AG-13", "AG-17", "AG-20",
        "ST-08", "ST-09", "ST-14", "ST-15", "OUT-06", "OUT-07",
    }
)

# ALL SEVEN controlling NOT_PROVEN payment classes (owner section 17)
PAYMENT_NOT_PROVEN_CLASSES = frozenset(
    {"PAY-06", "PAY-07", "PAY-08", "PAY-09", "PAY-10", "PAY-11", "PAY-14"}
)

RUNTIME_ORACLE_NAMES = {
    "act_equals", "origin_equals", "exact_link", "no_payment_link", "state_subset",
    "decision_kind", "course_reference_kind", "prohibited_output", "tool_call_absent",
    "tool_call_present", "state_mutation_absent", "exactly_once",
    "duplicate_write_absent", "idempotent_retry", "concurrency_overlap_proven",
    "concurrency_invariant", "fault_confirmed_injected", "fault_reaction",
    "price_authority", "catalog_fallback", "outcome_class", "gate_detection",
}


class PreExecutionRefusal(Exception):
    def __init__(self, verdict: PrimaryVerdict, reason: str) -> None:
        super().__init__(reason)
        self.verdict = verdict
        self.reason = reason


@dataclass
class ScenarioOutcome:
    scenario_id: str
    run_id: str
    observation_id: str
    scenario_sha256: str
    observation: Any
    checks: list[OracleCheck]
    verdict: PrimaryVerdict
    verdict_reason: str
    stability_label: StabilityLabel
    semantic_input_path: str | None
    adapter_invocations: int = 0
    # preserved execution-state for mutation/recombination (owner section 55)
    derivation_state: dict = field(default_factory=dict)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _spec_definition_valid(spec: dict) -> bool:
    for k in ("scenario_id", "failure_class", "track", "execution_level"):
        if k not in spec:
            return False
    for key in ("failure_mechanism", "trigger", "observable_effect", "oracle",
                "why_this_scenario_tests_this_class"):
        if not spec.get(key):
            return False
    return True


def _required_fields(spec: dict) -> list[str]:
    needed: set[str] = set()
    for entry in spec.get("oracle", []):
        needed |= ORACLE_FIELD_NEEDS.get(entry.get("oracle"), set())
    return sorted(needed)


def _load_registry_for_lane(lane: str, calibration_registry: dict | None) -> dict:
    if lane == LANE_CALIBRATION:
        return calibration_registry if calibration_registry is not None else {}
    from adapters.registry import load_registry
    return load_registry()


def _controlled_gate_outcome(
    spec: dict,
    *,
    run_id: str,
    attempt: int,
    scenario_sha: str,
    observation_id: str,
    infrastructure: InfrastructureStatus,
    eligibility: ExecutionEligibility,
    reason: str,
    continue_to_next: bool,
    called_once: bool,
) -> ScenarioOutcome:
    """Fail closed from the execution state. refusal() cannot emit INFRA_FAILURE."""
    scenario_id = str(spec.get("scenario_id", "UNKNOWN"))
    state = ExecutionState(
        execution_eligibility=eligibility,
        measurement_availability=MeasurementAvailability.SUT_NOT_INVOKED,
        native_outcome=NativeOutcome.NORMAL,
        deterministic_status=DeterministicStatus.NOT_REQUIRED,
        semantic_status=SemanticStatus.NOT_REQUIRED,
        infrastructure_status=infrastructure,
        benchmark_status=BenchmarkStatus.OK,
        provenance_status=ProvenanceStatus.NOT_ASSESSED,
    )
    verdict, _derived = derive_verdict_from_execution_state(state)
    obs = Observation(
        scenario_id=scenario_id,
        failure_class=spec.get("failure_class", "?"),
        track=spec.get("track", "?"),
        execution_level=spec.get("execution_level", "?"),
        seam_class=spec.get("seam_class", "?"),
        run_id=run_id,
        observation_id=observation_id,
        attempt=attempt,
        input_identity={"scenario_sha256": scenario_sha, "controlled_gate": reason},
        timestamp=_now_iso(),
    )
    obs.primary_verdict = verdict.value
    obs.verdict_reason = reason
    obs.reproduction_trace = ["adapter_invocations=0 (controlled-execution gate)"]
    return ScenarioOutcome(
        scenario_id, run_id, observation_id, scenario_sha, obs, [],
        verdict, reason, StabilityLabel.NONE, None, 0,
        derivation_state={
            **state.to_state_dict(),
            "continue_to_next_scenario": continue_to_next,
            "adapter_invocations": 0,
            "scenarios_executed": 0,
            "called_run_scenario_once": called_once,
            "controlled_gate": reason,
        },
    )


def _controlled_execution_gate(
    spec: dict,
    *,
    run_id: str,
    attempt: int,
    scenario_sha: str,
    observation_id: str,
    called_once: bool,
) -> ScenarioOutcome | None:
    from execution_infrastructure.controlled_context import require_controlled_context

    ctx = require_controlled_context()
    if ctx is None:
        return _controlled_gate_outcome(
            spec, run_id=run_id, attempt=attempt, scenario_sha=scenario_sha,
            observation_id=observation_id,
            infrastructure=InfrastructureStatus.INFRA_FAILURE,
            eligibility=ExecutionEligibility.NOT_EXECUTED,
            reason="CONTROLLED_CONTEXT_ABSENT",
            continue_to_next=False,
            called_once=called_once,
        )
    if not ctx.scenario_body_permitted:
        return _controlled_gate_outcome(
            spec, run_id=run_id, attempt=attempt, scenario_sha=scenario_sha,
            observation_id=observation_id,
            infrastructure=InfrastructureStatus.OK,
            eligibility=ExecutionEligibility.NOT_EXECUTED,
            reason="SCENARIO_BODY_NOT_PERMITTED",
            continue_to_next=False,
            called_once=called_once,
        )
    return None


def _cancellation_outcome(
    spec: dict,
    *,
    run_id: str,
    attempt: int,
    scenario_sha: str,
    observation_id: str,
    adapter_invocations: int,
    precedence: dict | None = None,
) -> ScenarioOutcome:
    """Infrastructure cancellation becomes a verdict. It does not escape."""
    scenario_id = spec.get("scenario_id", "UNKNOWN")
    precedence = precedence or {}
    infra = bool(precedence.get("infra_failure", True))
    timeout = bool(precedence.get("timeout_exceeded", False)) and not infra
    infrastructure = (
        InfrastructureStatus.TIMEOUT if timeout and not infra else InfrastructureStatus.INFRA_FAILURE
    )
    state = ExecutionState(
        execution_eligibility=ExecutionEligibility.EXECUTED,
        measurement_availability=(
            MeasurementAvailability.AVAILABLE if adapter_invocations
            else MeasurementAvailability.SUT_NOT_INVOKED
        ),
        native_outcome=NativeOutcome.NORMAL,
        deterministic_status=DeterministicStatus.NOT_REQUIRED,
        semantic_status=SemanticStatus.NOT_REQUIRED,
        infrastructure_status=infrastructure,
        benchmark_status=BenchmarkStatus.OK,
        provenance_status=ProvenanceStatus.NOT_ASSESSED,
        sut_path_identified=True,
        oracle_registered=True,
        harness_exception=False,
    )
    verdict, _derived = derive_verdict_from_execution_state(state)
    reason = str(sanitize_obj("lifecycle cancellation contained; infrastructure outcome recorded"))
    obs = Observation(
        scenario_id=scenario_id, failure_class=spec.get("failure_class", "?"),
        track=spec.get("track", "?"), execution_level=spec.get("execution_level", "?"),
        seam_class=spec.get("seam_class", "?"), run_id=run_id,
        observation_id=observation_id, attempt=attempt,
        input_identity={"scenario_sha256": scenario_sha, "cancelled_error_contained": True},
        timestamp=_now_iso(),
    )
    obs.primary_verdict = verdict.value
    obs.verdict_reason = reason
    obs.raw_evidence_path = None
    return ScenarioOutcome(
        scenario_id, run_id, observation_id, scenario_sha, obs, [],
        verdict, reason, StabilityLabel.NONE, None, adapter_invocations,
        derivation_state={
            **state.to_state_dict(),
            "continue_to_next_scenario": False,
            "infra_failure": infra,
            "timeout_exceeded": timeout,
            "cancelled_error_contained": True,
            "infrastructure_precedence": precedence.get("aggregate"),
            "adapter_invocations": adapter_invocations,
            "raw_evidence_path": None,
            "attempt_evidence_id": f"{scenario_id}:{attempt}",
        },
    )


def run_scenario_once(
    spec: dict,
    *,
    run_id: str,
    attempt: int,
    evidence_root: str,
    lane: str = LANE_PRODUCT,
    phase_execution_allowed: bool = True,
    wall_budget_s: float = 60.0,
    execution_environment: dict | None = None,
    calibration_registry: dict | None = None,
) -> ScenarioOutcome:
    """Execute one authorized attempt. NO adapter parameter exists: PRODUCT
    lane adapters are created by the authenticated factory against a
    BindingToken the runner itself obtains."""
    try:
        scenario_id = spec["scenario_id"]
        scenario_sha = sha256_canonical(spec)
        observation_id = f"{scenario_id}_A{attempt}"
        adapter_invocations = 0
        blocked = _controlled_execution_gate(
            spec, run_id=run_id, attempt=attempt, scenario_sha=scenario_sha,
            observation_id=observation_id, called_once=True,
        )
        if blocked is not None:
            return blocked

        def refusal(verdict: PrimaryVerdict, reason: str) -> ScenarioOutcome:
            reason = str(sanitize_obj(reason))  # B-17: persisted text is sanitized
            obs = Observation(
                scenario_id=scenario_id, failure_class=spec.get("failure_class", "?"),
                track=spec.get("track", "?"), execution_level=spec.get("execution_level", "?"),
                seam_class=spec.get("seam_class", "?"), run_id=run_id,
                observation_id=observation_id, attempt=attempt,
                input_identity={"scenario_sha256": scenario_sha, "refusal": reason},
                timestamp=_now_iso(),
            )
            # CORR5: even refusals derive from the ONE state machine (Rule C) —
            # the requested verdict must equal the derivation for the refused
            # state, or the refusal contract itself is broken.
            refusal_state = ExecutionState(
                execution_eligibility=ExecutionEligibility.NOT_EXECUTED
                if verdict != PrimaryVerdict.SKIPPED_UNSAFE else ExecutionEligibility.SKIPPED_UNSAFE,
                measurement_availability=MeasurementAvailability.SUT_NOT_INVOKED,
                native_outcome=NativeOutcome.NORMAL,
                deterministic_status=DeterministicStatus.NOT_REQUIRED,
                semantic_status=vmod.SemanticStatus.NOT_REQUIRED,
                infrastructure_status=InfrastructureStatus.OK,
                benchmark_status=(BenchmarkStatus.BENCHMARK_DEFECT
                                  if verdict == PrimaryVerdict.BENCHMARK_DEFECT else BenchmarkStatus.OK),
                provenance_status=ProvenanceStatus.NOT_ASSESSED,
            )
            derived, _dr = derive_verdict_from_execution_state(refusal_state)
            if derived != verdict:
                verdict = derived
            obs.primary_verdict = verdict.value
            obs.verdict_reason = reason
            obs.reproduction_trace = ["adapter_invocations=0 (pre-execution refusal)"]
            return ScenarioOutcome(scenario_id, run_id, observation_id, scenario_sha, obs, [],
                                   verdict, reason, StabilityLabel.NONE, None, 0,
                                   derivation_state={
                                       "refused": True,
                                       "phase_execution_allowed": False,
                                       "safe_to_execute": bool(spec.get("safe_to_execute", True)),
                                       "seam_class": spec.get("seam_class", "RUNTIME"),
                                       "seam_executable": spec.get("seam_executable", True),
                                       "harness_exception": verdict == PrimaryVerdict.BENCHMARK_DEFECT,
                                       "timeout_exceeded": False,
                                       "infra_failure": False,
                                       "sut_invoked": False,
                                       "sut_path_identified": True,
                                       "required_fields_observed": True,  # not applicable: never executed
                                       "provenance_valid": True,
                                       "deterministic_status": "NOT_REQUIRED",
                                       "deterministic_satisfied": True,
                                       "deterministic_failures": 0,
                                       "semantic_status": "NOT_REQUIRED",
                                       "error_outcome": None,
                                       "native_outcome": "NORMAL",
                                       "oracle_registered": True,
                                   })

        # ---- 1. definition + completeness + consistency gates ------------------
        if not _spec_definition_valid(spec):
            return refusal(PrimaryVerdict.BENCHMARK_DEFECT, "scenario definition invalid")
        reg = _load_registry_for_lane(lane, calibration_registry)
        try:
            adapter_spec = resolve_adapter_spec(
                spec.get("adapter_id") or (spec.get("sut_binding") or {}).get("adapter_id", ""),
                reg, lane,
            )
        except FactoryRejected as exc:
            return refusal(PrimaryVerdict.BENCHMARK_DEFECT, str(exc))
        try:
            implementation = _import_implementation(adapter_spec.implementation_class)
        except FactoryRejected as exc:
            return refusal(PrimaryVerdict.BENCHMARK_DEFECT, str(exc))
        from execution_infrastructure.product_capability import (
            ProductBindingRequired,
            begin_runner_product_attempt,
            end_runner_product_attempt,
            install_product_authority,
            is_product_backed,
        )

        product_backed = is_product_backed(implementation)
        defects = validate_oracle_completeness(
            spec, adapter_spec.native_observables, adapter_spec.native_fault_hooks)
        if defects:
            return refusal(PrimaryVerdict.BENCHMARK_DEFECT,
                           "oracle-completeness/consistency defects: " + "; ".join(defects))
        # ---- 2. payment boundary: ALL SEVEN lanes (owner section 17) -----------
        if spec.get("failure_class") in PAYMENT_NOT_PROVEN_CLASSES and _spec_has_runtime_oracle(spec):
            return refusal(
                PrimaryVerdict.BENCHMARK_DEFECT,
                f"{spec['failure_class']} is a controlling NOT_PROVEN payment lane: no runtime "
                "product coverage may exist without a separately discovered physical mechanism "
                "and Owner-governed authority (owner section 17)",
            )
        # ---- 3. phase / safety / level / L4 -------------------------------------
        if not phase_execution_allowed:
            return refusal(PrimaryVerdict.NOT_EXECUTED, "the phase/gate did not permit execution")
        if not spec.get("safe_to_execute", True):
            return refusal(PrimaryVerdict.SKIPPED_UNSAFE,
                           f"safety boundary forbids execution ({spec.get('safety_boundary') or 'unsafe'})")
        if spec.get("execution_level") == "L4":
            return refusal(PrimaryVerdict.SKIPPED_UNSAFE,
                           "L4 requires a sanctioned controlled live Telegram identity which is ABSENT")
        # ---- 4. binding authority (product capability, not the lane label) -----
        token: BindingToken | None = None
        if lane == LANE_PRODUCT or product_backed:
            binding = sut_binding.bind_test_bases_with_token(run_id=run_id)
            if not binding.token_ok:
                if lane == LANE_PRODUCT:
                    reason = (
                        "PRODUCT lane requires authenticated TEST_BASE binding; the binding "
                        "authority refused: " + ("; ".join(binding.reasons) or "unbound")
                    )
                else:
                    reason = "PRODUCT_BINDING_REQUIRED: " + ("; ".join(binding.reasons) or "unbound")
                return refusal(PrimaryVerdict.NOT_EXECUTED, reason)
            token = binding.token
            if token is not None and not isinstance(token, BindingToken):
                return refusal(
                    PrimaryVerdict.NOT_EXECUTED,
                    "PRODUCT_BINDING_REQUIRED: binding authority returned a non-token object",
                )
        # ---- 5. frozen ExecutionRequest (no adapter object exists yet) ----------
        request = build_execution_request(
            spec, adapter_id=adapter_spec.adapter_id, run_id=run_id, attempt=attempt,
            scenario_sha256=scenario_sha,
            navigator_test_root=token.navigator_root if token else None,
            tikhon_test_root=token.tikhon_root if token else None,
            execution_environment=execution_environment or {},
        )
        # ---- 6. FACTORY constructs the adapter (B-1) ----------------------------
        try:
            if lane == LANE_PRODUCT:
                adapter, _spec = create_product_adapter(request, token, reg)
            elif product_backed:
                adapter = implementation(request=request, token=token, spec=adapter_spec)
                _spec = adapter_spec
            else:
                adapter, _spec = create_calibration_adapter(request, reg, calibration_registry)
        except FactoryRejected as exc:
            return refusal(PrimaryVerdict.BENCHMARK_DEFECT, f"adapter factory refused: {exc}")

        # ---- 7. EXECUTION --------------------------------------------------------
        # Permitted only after the controlled gate above. begin_attempt,
        # finish_attempt, and apply_infrastructure_precedence run before
        # normalize_executed_state so infrastructure evidence dominates.
        from execution_infrastructure.attempt_binding import (
            apply_infrastructure_precedence,
            begin_attempt,
            collected_evidence,
            finish_attempt,
        )
        boundary = begin_attempt(scenario_id, attempt, require_product=(lane != LANE_CALIBRATION))
        # CORR6: the one product-authority installation path. It runs here,
        # inside the open attempt, after the controlled gate and the binding
        # token. Chatbot and Navigator TEST_BASE bytes are attested again at
        # this point; the authority expires when this attempt closes.
        if token is not None:
            product_attempt = None
            try:
                product_attempt = begin_runner_product_attempt(
                    scenario_id=scenario_id, attempt_number=attempt, run_id=run_id,
                )
                install_product_authority(token, product_attempt)
            except ProductBindingRequired as exc:
                end_runner_product_attempt(product_attempt)
                try:
                    finish_attempt()
                except asyncio.CancelledError:
                    pass
                return refusal(PrimaryVerdict.NOT_EXECUTED, f"PRODUCT_BINDING_REQUIRED: {exc}")
        boundary.work_budget_s = float(wall_budget_s)
        boundary.cleanup_budget_s = float(boundary.join_timeout)
        start = time.monotonic()
        capture: RawCapture | None = None
        adapter_protocol_error: str | None = None
        lifecycle_report: dict = {}
        try:
            try:
                raw = adapter.execute(request)
                adapter_invocations = 1
                if isinstance(raw, RawCapture):
                    capture = raw
                else:
                    adapter_protocol_error = (
                        f"adapter returned {type(raw).__name__}; RawCapture with registry-assigned "
                        "provenance is the only accepted adapter output"
                    )
            except asyncio.CancelledError as exc:
                adapter_protocol_error = f"adapter raised CancelledError: {exc}"
                adapter_invocations = max(adapter_invocations, 1)
            except Exception as exc:  # noqa: BLE001 — harness condition, never product FAIL
                from execution_infrastructure.product_capability import ProductBindingRequired

                if isinstance(exc, ProductBindingRequired):
                    adapter_protocol_error = f"PRODUCT_BINDING_REQUIRED: {exc}"
                else:
                    adapter_protocol_error = f"adapter raised {type(exc).__name__}: {exc}"
        finally:
            try:
                lifecycle_report = finish_attempt()
            except asyncio.CancelledError as exc:
                lifecycle_report = {
                    "fail_closed": True,
                    "status": "LIFECYCLE_FAIL_CLOSED",
                    "cancelled_error_contained": True,
                    "reason": type(exc).__name__,
                }
        wall = time.monotonic() - start
        if adapter_protocol_error and adapter_protocol_error.startswith("PRODUCT_BINDING_REQUIRED"):
            return refusal(PrimaryVerdict.NOT_EXECUTED, adapter_protocol_error)
        if (
            "CancelledError" in (adapter_protocol_error or "")
            or bool(lifecycle_report.get("cancelled_error_contained"))
        ):
            evidence_now = collected_evidence(scenario_id, attempt) or {}
            precedence = apply_infrastructure_precedence(
                infra_failure=True,
                timeout_exceeded=bool(evidence_now.get("timeout_exceeded")),
                lifecycle_report=evidence_now.get("lifecycle") or lifecycle_report,
                provider_evidence=evidence_now.get("provider_evidence"),
                retrieval_evidence=evidence_now.get("retrieval_evidence"),
                os_f04=evidence_now.get("os_f04"),
                python_violations=evidence_now.get("python_violations"),
                node_events=evidence_now.get("node_events"),
                timeout_evidence=evidence_now.get("timeout_evidence"),
                generic_infra_failure=evidence_now.get("generic_infra_failure"),
            )
            return _cancellation_outcome(
                spec, run_id=run_id, attempt=attempt, scenario_sha=scenario_sha,
                observation_id=observation_id, adapter_invocations=adapter_invocations,
                precedence=precedence,
            )
        timeout_exceeded = bool(capture and capture.timeout_exceeded) or wall > wall_budget_s
        infra_failure = bool(capture and capture.infra_failure)

        # ---- 8. provenance assignment -> sanitize -> atomic freeze --------------
        evidence_ref_identity = EvidenceIdentity(
            run_id=run_id, scenario_id=scenario_id, scenario_sha256=scenario_sha,
            observation_id=observation_id, attempt_index=attempt, evidence_type="RAW_OBSERVATION",
        )
        harness_exception: str | None = (
            adapter_protocol_error
            or (capture.adapter_protocol_error if capture else None)
            or (capture.capture_error if capture else None)
        )
        if capture is not None and harness_exception is None:
            try:
                from .evidence import observed_fields_from_capture

                actual_block = observed_fields_from_capture(
                    capture, adapter_spec.provenance_class, evidence_ref_identity)
            except (ObservedFieldError, ProvenanceViolation) as exc:
                harness_exception = str(exc)
                actual_block = _unobserved_block()
        else:
            actual_block = _unobserved_block()

        sanitized_input_turns = sanitize_obj(spec.get("turns", []))
        sanitized_capture = {
            "values": sanitize_obj(capture.values) if capture else {},
            "transcripts": sanitize_obj(capture.transcripts) if capture else {},
            "concurrency": sanitize_obj(capture.concurrency) if capture else {},
            "fault": sanitize_obj(capture.fault) if capture else {},
            "static_inspection": sanitize_obj(capture.static_inspection) if capture and capture.static_inspection is not None else None,
            "auxiliary_diagnostics": sanitize_obj(capture.auxiliary_diagnostics) if capture else {},
            "sut": {"path": sanitize_obj(capture.sut_path) if capture else None,
                    "symbol": sanitize_obj(capture.sut_symbol) if capture else None},
            "outcome_class": capture.outcome_class if capture else None,
            "capture_error": sanitize_obj(capture.capture_error) if capture else None,
            "adapter_protocol_error": sanitize_obj(adapter_protocol_error),
            "infra_failure": bool(capture and capture.infra_failure),
            "timeout_exceeded": bool(capture and capture.timeout_exceeded),
        }
        raw_payload: dict[str, Any] = {
            "capture": sanitized_capture,
            "concurrency": sanitized_capture["concurrency"],
            "fault": sanitized_capture["fault"],
            "static_inspection": sanitized_capture["static_inspection"],
            "actual": {k: v.to_json() for k, v in actual_block.items()},
            "field_evidence_refs": {
                k: v.evidence_ref for k, v in actual_block.items() if v.evidence_ref
            },
            "input": {"scenario_sha256": scenario_sha, "turns": sanitized_input_turns},
            "preconditions": sanitize_obj(spec.get("preconditions", {})),
            "execution": {"wall_seconds": wall, "adapter_id": adapter_spec.adapter_id,
                          "provenance_class": adapter_spec.provenance_class},
            "lane": lane,
        }
        try:
            frozen = freeze_evidence(evidence_ref_identity, evidence_root, raw_payload)
        except (EvidenceImmutableViolation, EvidencePathError, OSError, TypeError, ValueError, RuntimeError) as exc:
            evidence = collected_evidence(scenario_id, attempt) or {}
            precedence = apply_infrastructure_precedence(
                infra_failure=bool((capture and capture.infra_failure) or evidence.get("infra_failure")),
                timeout_exceeded=bool((capture and capture.timeout_exceeded) or evidence.get("timeout_exceeded") or (time.monotonic() - start) > wall_budget_s),
                lifecycle_report=evidence.get("lifecycle") or lifecycle_report,
                provider_evidence=evidence.get("provider_evidence"),
                retrieval_evidence=evidence.get("retrieval_evidence"),
                os_f04=evidence.get("os_f04"),
                python_violations=evidence.get("python_violations"),
                node_events=evidence.get("node_events"),
                timeout_evidence=evidence.get("timeout_evidence"),
                generic_infra_failure=evidence.get("generic_infra_failure"),
            )
            dominates = bool((precedence.get("aggregate") or {}).get("dominates"))
            infra_flag = bool(precedence["infra_failure"])
            timeout_flag = bool(precedence["timeout_exceeded"])
            if dominates and timeout_flag and not infra_flag:
                infra_status = InfrastructureStatus.TIMEOUT
                benchmark_status = BenchmarkStatus.OK
            elif dominates:
                infra_status = InfrastructureStatus.INFRA_FAILURE
                benchmark_status = BenchmarkStatus.OK
            else:
                infra_status = InfrastructureStatus.OK
                benchmark_status = BenchmarkStatus.BENCHMARK_DEFECT
            freeze_state = ExecutionState(
                execution_eligibility=ExecutionEligibility.EXECUTED,
                measurement_availability=(
                    MeasurementAvailability.AVAILABLE if adapter_invocations
                    else MeasurementAvailability.SUT_NOT_INVOKED
                ),
                native_outcome=NativeOutcome.NORMAL,
                deterministic_status=DeterministicStatus.NOT_REQUIRED,
                semantic_status=SemanticStatus.NOT_REQUIRED,
                infrastructure_status=infra_status,
                benchmark_status=benchmark_status,
                provenance_status=ProvenanceStatus.NOT_ASSESSED,
                sut_path_identified=True,
                oracle_registered=True,
                harness_exception=not dominates,
            )
            verdict, derived_reason = derive_verdict_from_execution_state(freeze_state)
            reason = (
                "evidence freeze failed; recorded infrastructure evidence kept precedence"
                if dominates else
                f"evidence identity/immutability violation: {exc}"
            )
            if not dominates and derived_reason:
                reason = derived_reason
            reason = str(sanitize_obj(reason))
            obs = Observation(
                scenario_id=scenario_id, failure_class=spec.get("failure_class", "?"),
                track=spec.get("track", "?"), execution_level=spec.get("execution_level", "?"),
                seam_class=spec.get("seam_class", "?"), run_id=run_id,
                observation_id=observation_id, attempt=attempt,
                input_identity={"scenario_sha256": scenario_sha, "freeze_failure": type(exc).__name__},
                timestamp=_now_iso(),
            )
            obs.primary_verdict = verdict.value
            obs.verdict_reason = reason
            obs.raw_evidence_path = None
            return ScenarioOutcome(
                scenario_id, run_id, observation_id, scenario_sha, obs, [],
                verdict, reason, StabilityLabel.NONE, None, adapter_invocations,
                derivation_state={
                    **freeze_state.to_state_dict(),
                    "continue_to_next_scenario": False,
                    "infrastructure_precedence": precedence["aggregate"],
                    "freeze_failure": type(exc).__name__,
                    "infra_failure": infra_flag or dominates,
                    "timeout_exceeded": timeout_flag,
                    "adapter_invocations": adapter_invocations,
                    "raw_evidence_path": None,
                    "attempt_evidence_id": f"{scenario_id}:{attempt}",
                },
            )

        # ---- 9. deterministic oracles (identity-checked; B-02: the COMPLETE
        #         controlling spec is bound to the frozen evidence identity; the
        #         semantic lifecycle oracle is deferred inside the oracle layer) --
        checks: list[OracleCheck] = []
        if harness_exception is None:
            try:
                checks = evaluate_oracles(
                    spec, frozen, run_id=run_id, scenario_id=scenario_id,
                    scenario_sha256=scenario_sha, observation_id=observation_id,
                    attempt_index=attempt,
                    supported_fault_hooks=adapter_spec.native_fault_hooks,
                )
            except Exception as exc:  # noqa: BLE001
                checks = [OracleCheck("<evaluation>", True, None,
                                      f"oracle/evidence evaluation raised {type(exc).__name__}: {exc}",
                                      invalid=True)]
                harness_exception = f"evidence/oracle error: {exc}"

        # ---- 10. semantic package (owner §20/§21) -------------------------------
        semantic_required = bool(spec.get("semantic_evaluation", {}).get("required"))
        semantic_status = SemanticStatus.NOT_REQUIRED
        semantic_input_path: str | None = None
        if semantic_required:
            try:
                semantic_input_path = prepare_semantic_input(
                    spec, frozen, checks,
                    out_dir=os.path.join(evidence_root, run_id, scenario_id),
                )
                semantic_status = SemanticStatus.PREPARED_PENDING
            except Exception as exc:  # noqa: BLE001
                harness_exception = harness_exception or f"semantic package error: {exc}"
                semantic_status = SemanticStatus.PREPARED_PENDING

        # meaningful transcript (owner section 14)
        transcript_ok, transcript_reason = (True, "")
        if semantic_required or spec.get("failure_class") in TRANSCRIPT_REQUIRED_CLASSES:
            transcript_ok, transcript_reason = validate_meaningful_transcript(
                sanitized_capture["transcripts"], sanitized_capture["values"].get("output", UNOBSERVED))
        missing_transcript = not transcript_ok

        # ---- 11. verdict — ONE authoritative execution state (CORR5 F04) --------
        invalid_measurement = any(c.required and c.invalid for c in checks)
        required_fields = _required_fields(spec)
        required_observed = all(
            actual_block.get(f) is not None and actual_block[f].provenance != ProvenanceKind.UNOBSERVED.value
            for f in required_fields
        )
        deterministic_failures = sum(1 for c in checks if c.required and c.satisfied is False)
        all_required_satisfied = all(c.satisfied is True for c in checks if c.required)

        # B-07: deterministic status is an explicit three-state model. Semantics:
        #   NOT_REQUIRED — no controlling deterministic oracles (semantic-only
        #                  scenario: HOLD before evaluation, PASS/FAIL after);
        #   SATISFIED    — deterministic oracles present and all satisfied;
        #   FAILED       — deterministic oracles present and at least one failed.
        semantic_only = semantic_required and not any(
            o.get("oracle") != "semantic_input_frozen" for o in spec.get("oracle", [])
        )
        has_required_deterministic = any(c.required for c in checks)
        if not has_required_deterministic:
            deterministic_status = "NOT_REQUIRED"
        elif all_required_satisfied:
            deterministic_status = "SATISFIED"
        else:
            deterministic_status = "FAILED"
        effective_failures = 0 if deterministic_status == "NOT_REQUIRED" else deterministic_failures

        oracle_registered = bool(spec.get("oracle")) and all(
            c.satisfied is not None or "not registered" in c.reason for c in checks
        )
        sut_invoked = adapter_invocations > 0 and spec.get("seam_class") not in ("STATIC", "NO_SEAM")
        if spec.get("seam_class") == "STATIC" and capture is not None and capture.static_inspection:
            sut_invoked = True

        error_outcome = None
        if capture is not None and capture.outcome_class in ERROR_OUTCOME_CLASSES:
            expects_error = any(
                (o.get("params") or {}).get("acceptable_outcomes")
                and capture.outcome_class in o["params"]["acceptable_outcomes"]
                for o in spec.get("oracle", [])
            ) or (spec.get("expected", {}).get("act") == capture.outcome_class)
            if not expects_error:
                error_outcome = capture.outcome_class

        # measurement-invalid routing (owner §52/§54) and evidence completeness
        # are ENCODED IN THE STATE (never post-derivation verdict surgery), so
        # recombination and mutation derive the identical verdict later.
        sut_path_identified = bool(
            capture and (capture.sut_path or capture.static_inspection is not None)
        ) or spec.get("seam_class") in ("STATIC", "NO_SEAM")
        measurement_defect = (invalid_measurement
                              or not required_observed
                              or (missing_transcript and deterministic_status != "FAILED"
                                  and error_outcome is None))
        evidence = collected_evidence(scenario_id, attempt) or {}
        precedence = apply_infrastructure_precedence(
            infra_failure=bool(infra_failure or evidence.get("infra_failure")),
            timeout_exceeded=bool(timeout_exceeded or evidence.get("timeout_exceeded")),
            lifecycle_report=evidence.get("lifecycle") or lifecycle_report,
            provider_evidence=evidence.get("provider_evidence"),
            retrieval_evidence=evidence.get("retrieval_evidence"),
            os_f04=evidence.get("os_f04"),
            python_violations=evidence.get("python_violations"),
            node_events=evidence.get("node_events"),
            timeout_evidence=evidence.get("timeout_evidence"),
            generic_infra_failure=evidence.get("generic_infra_failure"),
        )
        infra_failure = bool(precedence["infra_failure"])
        timeout_exceeded = bool(precedence["timeout_exceeded"])
        exec_state = normalize_executed_state(
            deterministic_status=DeterministicStatus(deterministic_status),
            native_outcome=(NativeOutcome.UNACCEPTABLE_ERROR if error_outcome
                            else NativeOutcome.NORMAL),
            execution_eligibility=(
                ExecutionEligibility.NOT_OBSERVABLE
                if spec.get("seam_class") == "NO_SEAM" and not spec.get("seam_executable", True)
                else ExecutionEligibility.EXECUTED),
            semantic_status=semantic_status,
            infrastructure_status=(
                InfrastructureStatus.INFRA_FAILURE if infra_failure
                else (InfrastructureStatus.TIMEOUT if timeout_exceeded
                      else InfrastructureStatus.OK)
            ),
            benchmark_status=(
                BenchmarkStatus.BENCHMARK_DEFECT
                if (measurement_defect or bool(harness_exception) or not oracle_registered
                    or not sut_path_identified)
                else BenchmarkStatus.OK
            ),
            provenance_status=(ProvenanceStatus.VALID if required_observed
                               else ProvenanceStatus.INVALID),
            measurement_availability=(MeasurementAvailability.AVAILABLE if sut_invoked
                                      else MeasurementAvailability.SUT_NOT_INVOKED)
            if required_observed else MeasurementAvailability.REQUIRED_FIELDS_UNOBSERVED,
            sut_path_identified=sut_path_identified,
            oracle_registered=oracle_registered,
            harness_exception=bool(harness_exception),
        )
        verdict, reason = derive_verdict_from_execution_state(exec_state)
        if invalid_measurement and verdict == PrimaryVerdict.BENCHMARK_DEFECT:
            reason = "measurement invalid: the claimed mechanism was not actually exercised (" + \
                     "; ".join(c.reason for c in checks if c.required and c.invalid)[:300] + ")"
        if missing_transcript and verdict == PrimaryVerdict.BENCHMARK_DEFECT \
                and not invalid_measurement and not harness_exception:
            reason = f"evidence completeness failure: {transcript_reason} (PASS/HOLD forbidden)"
        # F04 normalization is total: the preserved record can no longer carry the
        # inconsistent SATISFIFIED-despite-failure subset IV5 demonstrated.
        if error_outcome:
            deterministic_status = "FAILED"
            effective_failures += 1

        # B-17: every persisted human/machine-visible text surface is sanitized.
        verdict_reason = str(sanitize_obj(reason))
        sut_path_s = str(sanitize_obj(capture.sut_path)) if capture else None
        sut_symbol_s = str(sanitize_obj(capture.sut_symbol)) if capture else None

        observation = Observation(
            scenario_id=scenario_id, failure_class=spec["failure_class"], track=spec["track"],
            execution_level=spec["execution_level"], seam_class=spec.get("seam_class", "RUNTIME"),
            run_id=run_id, observation_id=observation_id, attempt=attempt,
            input_identity={"scenario_sha256": scenario_sha},
            preconditions=sanitize_obj(spec.get("preconditions", {})),
            expected_invariant_refs={"oracle_refs": [o.get("oracle") for o in spec.get("oracle", [])]},
            timestamp=_now_iso(),
            semantic_evaluation={"required": semantic_required, "status": semantic_status.value,
                                 "input_path": semantic_input_path, "evaluator": None},
        )
        observation.deterministic_oracles = [
            {**c.__dict__, "invalid": c.invalid} for c in checks
        ]
        observation.primary_verdict = verdict.value
        observation.verdict_reason = verdict_reason
        observation.stability_label = StabilityLabel.NONE.value
        observation.raw_evidence_path = frozen.path
        observation.raw_evidence_sha256 = frozen.sha256
        observation.reproduction_trace = [
            f"scenario_sha256={scenario_sha}", f"raw_evidence={frozen.path}",
            f"raw_evidence_sha256={frozen.sha256}", f"adapter_id={adapter_spec.adapter_id}",
            f"adapter_invocations={adapter_invocations}",
            f"provenance_class={adapter_spec.provenance_class}",
            f"lane={lane}", f"error_outcome={error_outcome}",
            f"missing_transcript={missing_transcript}",
            f"deterministic_status={deterministic_status}",
        ]
        return ScenarioOutcome(
            scenario_id=scenario_id, run_id=run_id, observation_id=observation_id,
            scenario_sha256=scenario_sha, observation=observation, checks=checks,
            verdict=verdict, verdict_reason=verdict_reason, stability_label=StabilityLabel.NONE,
            semantic_input_path=semantic_input_path, adapter_invocations=adapter_invocations,
            derivation_state={
                # CORR6 IV6-F04-F14: the SERIALIZED authoritative ExecutionState is
                # THE wire authority. Later semantic recombination and oracle
                # mutation consume THIS block (from_state_dict prefers it); the
                # flat keys below remain as a read-only inspection mirror. No
                # later stage may reconstruct authority from the flat subset —
                # every dimension (incl. benchmark_status produced by the
                # meaningful-transcript validation) survives serialization.
                **exec_state.to_state_dict(),
                "lane": lane,
                "phase_execution_allowed": True,
                "safe_to_execute": bool(spec.get("safe_to_execute", True)),
                "seam_class": spec.get("seam_class", "RUNTIME"),
                "seam_executable": spec.get("seam_executable", True),
                "harness_exception": bool(harness_exception),
                "timeout_exceeded": timeout_exceeded,
                "infra_failure": infra_failure,
                "sut_invoked": sut_invoked,
                "sut_path_identified": sut_path_identified,
                "required_fields_observed": required_observed,
                "provenance_valid": required_observed,
                "deterministic_status": deterministic_status,
                "deterministic_satisfied": deterministic_status in ("NOT_REQUIRED", "SATISFIED"),
                "deterministic_failures": effective_failures,
                "semantic_status": semantic_status.value,
                "semantic_only": semantic_only,
                "error_outcome": error_outcome,
                "native_outcome": exec_state.native_outcome.value,
                "missing_transcript": bool(missing_transcript),
                "oracle_registered": oracle_registered,
                "raw_evidence_path": frozen.path,
                "raw_evidence_sha256": frozen.sha256,
                "continue_to_next_scenario": bool(precedence["continue_to_next_scenario"]),
                "infrastructure_precedence": precedence["aggregate"],
                "attempt_evidence_id": f"{scenario_id}:{attempt}",
            },
        )

    except asyncio.CancelledError:
        return _cancellation_outcome(
            spec,
            run_id=run_id,
            attempt=attempt,
            scenario_sha=locals().get("scenario_sha", ""),
            observation_id=locals().get("observation_id", f"{spec.get('scenario_id', 'UNKNOWN')}_A{attempt}"),
            adapter_invocations=locals().get("adapter_invocations", 0),
        )
    finally:
        from execution_infrastructure.product_capability import (
            clear_product_authority as _clear_product_authority,
        )

        _clear_product_authority()


from execution_infrastructure.product_capability import (  # noqa: E402
    register_runner_entry as _register_runner_entry,
)

_register_runner_entry(run_scenario_once.__code__)


def _unobserved_block() -> dict[str, ObservedValue]:
    return {name: ObservedValue() for name in ("act", "origin", "state", "link", "output", "tool_api", "mutations")}


def _spec_has_runtime_oracle(spec: dict) -> bool:
    return any(o.get("oracle") in RUNTIME_ORACLE_NAMES for o in spec.get("oracle", []))


# ---------------------------------------------------------------------------
# Repeats + aggregation (owner section 50)
# ---------------------------------------------------------------------------

def run_scenario_repeat_set(
    spec: dict, *, run_id: str, evidence_root: str, repeats: int,
    lane: str = LANE_PRODUCT, phase_execution_allowed: bool = True,
    execution_environment: dict | None = None,
    calibration_registry: dict | None = None,
) -> tuple[list[ScenarioOutcome], StabilityLabel, PrimaryVerdict]:
    """Authorized repeats -> observation verdicts + SCENARIO AGGREGATE.

    Aggregation precedence (owner section 50):
      any INFRA_FAILURE -> aggregate INFRA_FAILURE (an incomplete repeat set
      can never authorize PASS);
      any TIMEOUT (without an authorized retry replacement) -> TIMEOUT;
      materially disagreeing complete product observations -> NONDETERMINISTIC;
      only complete comparable product observations may yield PASS/FAIL and
      STABLE_PASS.
    """
    scenario_sha = sha256_canonical(spec)
    blocked = _controlled_execution_gate(
        spec, run_id=run_id, attempt=0, scenario_sha=scenario_sha,
        observation_id=f"{spec.get('scenario_id', 'UNKNOWN')}_AREPEAT",
        called_once=False,
    )
    if blocked is not None:
        return [blocked], StabilityLabel.NONE, blocked.verdict
    outcomes: list[ScenarioOutcome] = []
    for attempt in range(1, repeats + 1):
        outcome = run_scenario_once(
            spec, run_id=run_id, attempt=attempt, evidence_root=evidence_root,
            lane=lane, phase_execution_allowed=phase_execution_allowed,
            execution_environment=execution_environment,
            calibration_registry=calibration_registry,
        )
        outcomes.append(outcome)
        if outcome.derivation_state.get("continue_to_next_scenario") is False:
            break
    verdicts = [o.verdict for o in outcomes]
    for o in outcomes:
        o.observation.stability_label = derive_stability_label(verdicts).value

    aggregate = aggregate_repeat_verdicts(verdicts)
    for o in outcomes:
        o.observation.scenario_aggregate_verdict = aggregate.value
    return outcomes, derive_stability_label(verdicts), aggregate


def aggregate_repeat_verdicts(verdicts: list) -> "PrimaryVerdict":
    """B-16 deterministic precedence for incomplete repeat sets.

    A required repeat set can aggregate PASS only when EVERY required attempt
    is a completed comparable product observation. Precedence (first match
    wins):

      any BENCHMARK_DEFECT          -> BENCHMARK_DEFECT
      any unresolved INFRA_FAILURE  -> INFRA_FAILURE
      any unresolved TIMEOUT        -> TIMEOUT
      any required NOT_EXECUTED     -> NOT_EXECUTED
      any required HOLD / pending   -> HOLD
      any required NOT_OBSERVABLE   -> NOT_OBSERVABLE
      any required SKIPPED_UNSAFE   -> SKIPPED_UNSAFE

    Only after every required observation is a comparable product PASS/FAIL
    may stable PASS / stable FAIL / NONDETERMINISTIC be computed.
    """
    present = set(verdicts)
    for marker in (
        PrimaryVerdict.BENCHMARK_DEFECT,
        PrimaryVerdict.INFRA_FAILURE,
        PrimaryVerdict.TIMEOUT,
        PrimaryVerdict.NOT_EXECUTED,
        PrimaryVerdict.HOLD,
        PrimaryVerdict.NOT_OBSERVABLE,
        PrimaryVerdict.SKIPPED_UNSAFE,
    ):
        if marker in present:
            return marker
    product_obs = [v for v in verdicts
                   if v in (PrimaryVerdict.PASS, PrimaryVerdict.FAIL, PrimaryVerdict.NONDETERMINISTIC)]
    distinct = set(product_obs)
    if len(verdicts) != len(product_obs):
        # remaining non-comparable states were not in the marker list
        return PrimaryVerdict.BENCHMARK_DEFECT
    if len(distinct) == 1:
        return verdicts[0]
    return PrimaryVerdict.NONDETERMINISTIC


# ---------------------------------------------------------------------------
# Integrated semantic recombination (owner sections 23/24)
# ---------------------------------------------------------------------------

def apply_semantic_result(
    outcome: ScenarioOutcome,
    result: dict,
    *,
    evidence_root: str,
    evaluator_allowlist: tuple[str, ...] = ("CODEX SOL 6.1",),
    calibration_evaluators: tuple[str, ...] = (),
) -> ScenarioOutcome:
    """FINAL RECOMBINATION inside the runner lifecycle — CORR5 F04.

    Consumes the SAME authoritative execution state as the initial verdict
    and the mutation gate: the preserved derivation record is rebuilt into an
    ExecutionState (from_state_dict), receives the ONE legal semantic
    transition (with_semantic_status), and the verdict is derived by the ONE
    derivation function. Reconstructed-from-partial-booleans eligibility is
    structurally impossible: an unacceptable native error, deterministic FAIL,
    INFRA/TIMEOUT/BENCHMARK_DEFECT authority preserved in the state can never
    become PASS through a semantic result."""
    from .semantic_eval import ingest_semantic_result
    from .evidence import FrozenEvidence
    from .verdicts import SemanticStatus as _SemStatus

    state = outcome.derivation_state
    identity = EvidenceIdentity(
        run_id=outcome.run_id, scenario_id=outcome.scenario_id,
        scenario_sha256=outcome.scenario_sha256,
        observation_id=outcome.observation_id, attempt_index=outcome.observation.attempt,
        evidence_type="RAW_OBSERVATION",
    )
    frozen = FrozenEvidence(identity, state["raw_evidence_path"], state["raw_evidence_sha256"])
    allowlist = tuple(evaluator_allowlist) + tuple(
        calibration_evaluators if state.get("lane") == LANE_CALIBRATION else ())
    result_frozen = ingest_semantic_result(
        result, frozen, evidence_root,
        semantic_input_path=outcome.semantic_input_path,
        scenario_sha256=outcome.scenario_sha256,
        attempt_index=outcome.observation.attempt,
        evaluator_allowlist=allowlist,
    )
    evaluation = result["evaluation_result"]

    # THE authoritative state: rebuilt from the preserved record, advanced by
    # the one legal semantic transition, derived by the one function.
    exec_state = from_state_dict(state)
    new_semantic = _SemStatus.COMPLETED_SATISFIED if evaluation == "SEMANTIC_SATISFIED" \
        else _SemStatus.COMPLETED_VIOLATED
    final_state = exec_state.with_semantic_status(new_semantic)
    final, reason = derive_verdict_from_execution_state(final_state)
    if final == PrimaryVerdict.FAIL and exec_state.native_outcome == NativeOutcome.UNACCEPTABLE_ERROR:
        reason = ("unacceptable native error FAIL preserved: semantic satisfaction "
                  "cannot rescue it")

    outcome.verdict = final
    outcome.verdict_reason = str(sanitize_obj(reason))  # B-17
    outcome.observation.primary_verdict = final.value
    outcome.observation.verdict_reason = outcome.verdict_reason
    outcome.observation.semantic_evaluation["status"] = new_semantic.value
    outcome.observation.semantic_evaluation["evaluator"] = result.get("evaluator_id")
    outcome.observation.semantic_evaluation["result_evidence"] = result_frozen.path
    outcome.derivation_state["semantic_status"] = new_semantic.value
    outcome.derivation_state["native_outcome"] = exec_state.native_outcome.value
    # CORR6: the serialized authoritative state advances by the SAME legal
    # transition — the wire block stays the single source later consumers read
    outcome.derivation_state.update(final_state.to_state_dict())
    return outcome


def _aggregate_for_test(verdicts):
    """Aggregation precedence extracted for direct verification (canary M-2).
    B-16: incomplete repeat sets can never aggregate PASS."""
    return aggregate_repeat_verdicts(list(verdicts))


def write_machine_report(outcomes: list[ScenarioOutcome], path: str) -> dict:
    records = []
    counts: dict[str, int] = {}
    for o in outcomes:
        rec = {
            "observation_id": o.observation.observation_id,
            "scenario_id": o.scenario_id, "run_id": o.run_id,
            "failure_class": o.observation.failure_class, "track": o.observation.track,
            "execution_level": o.observation.execution_level,
            "seam_class": o.observation.seam_class, "attempt": o.observation.attempt,
            "primary_verdict": o.observation.primary_verdict,
            "scenario_aggregate_verdict": o.observation.scenario_aggregate_verdict,
            "verdict_reason": o.observation.verdict_reason,
            "stability_label": o.observation.stability_label,
            "adapter_invocations": o.adapter_invocations,
            "raw_evidence_sha256": o.observation.raw_evidence_sha256,
            "raw_evidence_path": o.observation.raw_evidence_path,
            "deterministic_oracles": sanitize_obj(o.observation.deterministic_oracles),
            "semantic_evaluation": sanitize_obj(o.observation.semantic_evaluation),
            "timestamp": o.observation.timestamp,
            "reproduction_trace": sanitize_obj(o.observation.reproduction_trace),
        }
        # B-17: machine report values pass the mandatory sanitizer; a synthetic
        # sensitive marker can never persist in the authoritative report.
        rec = sanitize_obj(rec)
        counts[rec["primary_verdict"]] = counts.get(rec["primary_verdict"], 0) + 1
        records.append(rec)
    report = {
        "schema": "CORR4_MACHINE_REPORT_V4",
        "generated_at": _now_iso(),
        "run_id": outcomes[0].run_id if outcomes else "empty",
        "total_observations": len(records),
        "verdict_counts": counts,
        "records": records,
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(canonical_json(report))
    return report
