"""Provenance model — CORR2.

Owner sections 9/10 (B-1):

1. Provenance is NOT self-asserted. Adapters return RAW capture without
   provenance; the runner assigns provenance from the registered adapter/seam
   operation (ADAPTER_REGISTRY). No adapter string can manufacture trust.

2. Synthetic calibration data MUST NOT use the same trust class as real
   product execution: SYNTHETIC_CALIBRATION is its own family and never
   satisfies a runtime product oracle.

3. STATIC_INSPECTION never satisfies a runtime product oracle (it has its own
   family and only the static_config oracle accepts it).

4. The six forbidden classes from 05 section 4 remain rejected outright.
"""

from __future__ import annotations

from enum import Enum


class ProvenanceKind(str, Enum):
    # ---- real executed product observation (assigned by the harness boundary
    #      from the registered adapter operation; never by adapter strings) ----
    RUNTIME_FUNCTION_RETURN = "RUNTIME_FUNCTION_RETURN"
    LIVE_API_RESPONSE = "LIVE_API_RESPONSE"
    ISOLATED_ADAPTER_OUTPUT = "ISOLATED_ADAPTER_OUTPUT"
    ISOLATED_STATE_READ = "ISOLATED_STATE_READ"
    CONTROLLED_TELEGRAM_OBSERVATION = "CONTROLLED_TELEGRAM_OBSERVATION"
    FAULT_HARNESS_OBSERVATION = "FAULT_HARNESS_OBSERVATION"
    DERIVED_FROM_OBSERVED_DATA = "DERIVED_FROM_OBSERVED_DATA"
    # ---- static adjudication seam (accepted seam map STATIC rows only) ----
    STATIC_INSPECTION = "STATIC_INSPECTION"
    # ---- synthetic calibration fixtures (canaries/self-tests; NEVER product evidence) ----
    SYNTHETIC_CALIBRATION = "SYNTHETIC_CALIBRATION"
    # ---- semantic lane ----
    SEMANTIC_EVALUATION = "SEMANTIC_EVALUATION"
    # ---- sentinel ----
    UNOBSERVED = "UNOBSERVED"


PROVENANCE_FAMILY = {
    "RUNTIME_FUNCTION_RETURN": "EXECUTED",
    "LIVE_API_RESPONSE": "EXECUTED",
    "ISOLATED_ADAPTER_OUTPUT": "EXECUTED",
    "ISOLATED_STATE_READ": "EXECUTED",
    "CONTROLLED_TELEGRAM_OBSERVATION": "EXECUTED",
    "FAULT_HARNESS_OBSERVATION": "EXECUTED",
    "DERIVED_FROM_OBSERVED_DATA": "DERIVED_FROM_EXECUTED",
    "STATIC_INSPECTION": "STATIC_INSPECTION",
    "SYNTHETIC_CALIBRATION": "SYNTHETIC_CALIBRATION",
    "SEMANTIC_EVALUATION": "SEMANTIC_EVALUATION",
    "UNOBSERVED": "UNOBSERVED",
}

FORBIDDEN_PROVENANCE = frozenset(
    {
        "EXPECTED_VALUE",
        "SCENARIO_METADATA",
        "HARDCODED_ASSUMPTION",
        "AUTHOR_INFERENCE",
        "DEFAULT_PASS",
        "NARRATIVE_INFERENCE",
    }
)

# Provenance families that may satisfy RUNTIME product oracles.
RUNTIME_ORACLE_FAMILIES = frozenset({"EXECUTED", "DERIVED_FROM_EXECUTED"})

# Every family a value may legally carry.
ALLOWED_FAMILIES = frozenset(PROVENANCE_FAMILY.values())


def is_allowed_provenance(kind: str) -> bool:
    return kind in PROVENANCE_FAMILY


def is_forbidden_provenance(kind: str) -> bool:
    return kind in FORBIDDEN_PROVENANCE


def is_runtime_product_provenance(kind: str) -> bool:
    """True only for real executed product observation families.

    STATIC_INSPECTION and SYNTHETIC_CALIBRATION are deliberately EXCLUDED:
    static facts must never satisfy a runtime equality oracle, and synthetic
    calibration fixtures must never be mistaken for product evidence.
    """
    return PROVENANCE_FAMILY.get(kind) in RUNTIME_ORACLE_FAMILIES


def is_static_provenance(kind: str) -> bool:
    return PROVENANCE_FAMILY.get(kind) == "STATIC_INSPECTION"


def is_synthetic_provenance(kind: str) -> bool:
    return PROVENANCE_FAMILY.get(kind) == "SYNTHETIC_CALIBRATION"


def provenance_for_adapter(adapter_id: str, registry: dict) -> str:
    """Assign provenance from the registered physical operation.

    The registry entry (validated against the real source topology) — not the
    adapter's own claim — decides which provenance family this adapter's raw
    capture receives. Unregistered adapters get no provenance at all.
    """
    entry = registry.get("adapters", {}).get(adapter_id)
    if entry is None:
        raise ValueError(f"adapter {adapter_id!r} is not registered: no provenance can be assigned")
    return entry["provenance_class"]
