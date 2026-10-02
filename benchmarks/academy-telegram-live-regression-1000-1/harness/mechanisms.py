"""Registered causal mechanism registries v1 — CORR5 (F12 + F13; owner
sections 21-22, 28-30).

F12 (IV5): serialization is not overlap. A same-user lock that works correctly
SHOULD serialize critical sections, so simultaneous critical-section overlap
must NOT be required as proof of correct same-user serialization. Concurrency
contracts are split BY MECHANISM: SAME_USER_SERIALIZATION (contention +
serialization + state invariant) and DIFFERENT_USER_INDEPENDENCE (independent
locks may execute concurrently; overlap is relevant there). Scenarios
reference a CONCURRENCY_MECHANISM_ID, not free-form proof labels; evidence
derives its proof obligations from the registered record.

F13 (IV5): a scenario must not self-label arbitrary target/point/kind and
have the instrumentation repeat those labels back as proof. Every physically
representable fault mechanism is REGISTERED with KIND / PHYSICAL_FIXTURE_SEAM
/ POINT / IMPLEMENTATION / SUPPORTED_ADAPTER / EVIDENCE_SCHEMA; scenarios
reference FAULT_MECHANISM_ID and evidence derives kind/target/point from the
registered mechanism implementation, checked against the registry identity.
LOST_RESPONSE represents REAL ORDER since CORR5: the native
process_user_turn completes its normal persistence FIRST, and only then is
delivery of the returned response suppressed by the benchmark fixture.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ConcurrencyMechanism:
    mechanism_id: str
    mechanism: str
    physical_seam: str
    supported_adapter: str
    proof_contract: tuple[str, ...]
    oracle: str
    evidence_fields: tuple[str, ...] = field(default_factory=tuple)


CONCURRENCY_MECHANISMS: dict[str, ConcurrencyMechanism] = {
    "ALEXEY.SAME_USER_SERIALIZATION": ConcurrencyMechanism(
        mechanism_id="ALEXEY.SAME_USER_SERIALIZATION",
        mechanism="SAME_USER_SERIALIZATION",
        physical_seam="LebedevNavigatorAdapter.get_user_lock",
        supported_adapter="alexey_user_turn",
        proof_contract=(
            "REQUIRED PARTICIPANTS: two or more same-loop tasks attempting the SAME user",
            "LOCK RELATION: every task records the SAME actual lock identity",
            "SCHEDULE CONTRACT: a deterministic benchmark-controlled async pause at "
            "the awaited provider boundary (contention_schedule.provider_pause_s) "
            "holds the first task inside the critical section while the later task "
            "attempts the lock — a scheduling fixture only, never a product claim",
            "REQUIRED EVIDENCE: a later task began waiting while the earlier holder "
            "was active (contention evidence) and acquired strictly after its release",
            "STATE INVARIANT: critical sections do NOT overlap; each task completes "
            "release; the declared state invariant holds after completion",
            "SUCCESS CONDITION: contention + serialization + invariant proven "
            "(simultaneous critical-section overlap is NOT required and NOT valid "
            "proof for same-user serialization)",
        ),
        oracle="same_user_serialization_proven",
        evidence_fields=(
            "workers", "worker_ids", "task_records", "lock_user_ids",
            "same_user_shared_lock", "lock_identity", "contention_evidence",
            "critical_sections_non_overlapping", "lock_release_completed_all",
            "controlled_schedule", "target_seam", "schedule_id",
        ),
    ),
    "ALEXEY.DIFFERENT_USER_INDEPENDENCE": ConcurrencyMechanism(
        mechanism_id="ALEXEY.DIFFERENT_USER_INDEPENDENCE",
        mechanism="DIFFERENT_USER_INDEPENDENCE",
        physical_seam="LebedevNavigatorAdapter.get_user_lock",
        supported_adapter="alexey_user_turn",
        proof_contract=(
            "REQUIRED PARTICIPANTS: two or more same-loop tasks addressing DISTINCT users",
            "LOCK RELATION: per-task ACTUAL lock identities are recorded and DISTINCT "
            "(user IDs, labels and interval counts alone are not proof)",
            "SCHEDULE CONTRACT: the controlled schedule permits simultaneous "
            "progress (benchmark-controlled provider pause at the awaited boundary)",
            "REQUIRED EVIDENCE: each native operation invoked with per-task records "
            "bound to their actual tasks; native-operation intervals OVERLAP",
            "STATE INVARIANT: per-user state remains independent after completion",
            "SUCCESS CONDITION: distinct locks + overlapping native operations + "
            "full release + per-user state independence",
        ),
        oracle="different_user_independence_proven",
        evidence_fields=(
            "workers", "worker_ids", "task_records", "lock_user_ids",
            "same_user_shared_lock", "lock_identity", "lock_identities_by_task",
            "native_operation_intervals", "lock_release_completed_all",
            "controlled_schedule", "target_seam", "schedule_id",
        ),
    ),
}


@dataclass(frozen=True)
class FaultMechanism:
    mechanism_id: str
    kind: str
    physical_fixture_seam: str
    point: str
    implementation: str
    supported_adapter: str
    evidence_schema: tuple[str, ...]


FAULT_MECHANISMS: dict[str, FaultMechanism] = {
    # F13/§29: LOST_RESPONSE represents REAL ORDER — native process_user_turn
    # completes its normal persistence through the native store path, and only
    # THEN is delivery of the returned user-facing response suppressed by the
    # benchmark fixture. A pre-persistence write is never labeled durable
    # processed state.
    "ALEXEY.LOST_RESPONSE.AFTER_PERSISTENCE": FaultMechanism(
        mechanism_id="ALEXEY.LOST_RESPONSE.AFTER_PERSISTENCE",
        kind="LOST_RESPONSE",
        physical_fixture_seam="alexey_process_user_turn_response_delivery",
        point="after_persistence_before_delivery",
        implementation=(
            "wraps the native process_user_turn: the original operation runs to "
            "completion (its normal store.save_session persistence observed by a "
            "counting wrapper), then the wrapper suppresses the returned reply"
        ),
        supported_adapter="alexey_user_turn",
        evidence_schema=(
            "durable_write_proven",      # >=1 native save_session during the turn
            "persisted_state_present",   # store state after completion is non-null
            "processing_completed",      # native operation returned normally
            "response_dropped",          # delivery suppressed by the fixture
        ),
    ),
    "ALEXEY.DEPENDENCY_500.NAVIGATOR_TRANSPORT": FaultMechanism(
        mechanism_id="ALEXEY.DEPENDENCY_500.NAVIGATOR_TRANSPORT",
        kind="DEPENDENCY_500",
        physical_fixture_seam="navigator_transport",
        point="before_response",
        implementation="replaces the transport callable and raises a 500 dependency error",
        supported_adapter="alexey_user_turn",
        evidence_schema=("raised",),
    ),
    "ALEXEY.DEPENDENCY_429.NAVIGATOR_TRANSPORT": FaultMechanism(
        mechanism_id="ALEXEY.DEPENDENCY_429.NAVIGATOR_TRANSPORT",
        kind="DEPENDENCY_429",
        physical_fixture_seam="navigator_transport",
        point="before_response",
        implementation="replaces the transport callable and raises a 429 dependency error",
        supported_adapter="alexey_user_turn",
        evidence_schema=("raised",),
    ),
    "ALEXEY.TIMEOUT_BEFORE_PROCESSING.NAVIGATOR_TRANSPORT": FaultMechanism(
        mechanism_id="ALEXEY.TIMEOUT_BEFORE_PROCESSING.NAVIGATOR_TRANSPORT",
        kind="TIMEOUT_BEFORE_PROCESSING",
        physical_fixture_seam="navigator_transport",
        point="before_processing",
        implementation="replaces the transport callable and raises TimeoutError before processing",
        supported_adapter="alexey_user_turn",
        evidence_schema=("raised",),
    ),
    "ALEXEY.TIMEOUT_AFTER_PROCESSING.NAVIGATOR_TRANSPORT": FaultMechanism(
        mechanism_id="ALEXEY.TIMEOUT_AFTER_PROCESSING.NAVIGATOR_TRANSPORT",
        kind="TIMEOUT_AFTER_PROCESSING",
        physical_fixture_seam="navigator_transport",
        point="after_processing",
        implementation="replaces the transport callable; delays the response past the deadline",
        supported_adapter="alexey_user_turn",
        evidence_schema=("deadline_exceeded",),
    ),
    "ALEXEY.MALFORMED_PAYLOAD.NAVIGATOR_TRANSPORT": FaultMechanism(
        mechanism_id="ALEXEY.MALFORMED_PAYLOAD.NAVIGATOR_TRANSPORT",
        kind="MALFORMED_DEPENDENCY_PAYLOAD",
        physical_fixture_seam="navigator_transport",
        point="before_response",
        implementation="replaces the transport callable and returns a malformed payload",
        supported_adapter="alexey_user_turn",
        evidence_schema=("payload",),
    ),
}


def fault_mechanism_for_kind(kind: str) -> FaultMechanism | None:
    """The registered mechanism implementing a fault kind on the native
    Alexey/navigator-transport seam (there is exactly one per kind)."""
    for rec in FAULT_MECHANISMS.values():
        if rec.kind == kind:
            return rec
    return None


def mechanism_doc() -> dict:
    """Serializable registry document for the artifact JSON files."""
    return {
        "schema": "MECHANISM_REGISTRY_V1",
        "concurrency_mechanisms": {
            cid: {
                "mechanism_id": c.mechanism_id,
                "mechanism": c.mechanism,
                "physical_seam": c.physical_seam,
                "supported_adapter": c.supported_adapter,
                "proof_contract": list(c.proof_contract),
                "oracle": c.oracle,
                "evidence_fields": list(c.evidence_fields),
            }
            for cid, c in CONCURRENCY_MECHANISMS.items()
        },
        "fault_mechanisms": {
            mid: {
                "mechanism_id": f.mechanism_id,
                "kind": f.kind,
                "physical_fixture_seam": f.physical_fixture_seam,
                "point": f.point,
                "implementation": f.implementation,
                "supported_adapter": f.supported_adapter,
                "evidence_schema": list(f.evidence_schema),
            }
            for mid, f in FAULT_MECHANISMS.items()
        },
    }
