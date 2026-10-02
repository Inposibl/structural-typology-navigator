"""Authenticated adapter factory + BindingToken — CORR3 (B-1/B-3, owner sections 6/7/15/16).

TRUST ROOT: PRODUCT-lane execution can never receive an adapter object from
the caller. The runner resolves the scenario's adapter_id through the
authenticated registry, and the FACTORY (harness-owned code) constructs the
adapter from the registry's IMPLEMENTATION_CLASS, passing:

  - the frozen ExecutionRequest
  - the authenticated BindingToken (harness-generated; never a caller dict)

CALIBRATION lane constructs adapters from the separate calibration registry;
CALIBRATION trust can never become PRODUCT trust (distinct provenance family,
distinct registry, lane-mismatch rejected pre-execution).

BindingToken: immutable, harness-generated, carries schema version, expected
identities, validated roots, manifest identities, timestamp/run and a digest
over its own body. Runner/ factory verify the digest before use.
"""

from __future__ import annotations

import copy
import dataclasses
import hashlib
import json
from dataclasses import dataclass
from typing import Any, Callable

from .evidence import canonical_json, sha256_canonical
from .execution_request import ExecutionRequest

BINDING_TOKEN_SCHEMA_VERSION = "CORR3-BINDING-TOKEN-1"

# Lane constants
LANE_PRODUCT = "PRODUCT"
LANE_CALIBRATION = "CALIBRATION"


class FactoryRejected(RuntimeError):
    """The factory refuses an execution request (pre-execution, zero calls)."""


def _deep_freeze(value: Any) -> Any:
    from types import MappingProxyType

    if isinstance(value, dict):
        return MappingProxyType({k: _deep_freeze(v) for k, v in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_deep_freeze(v) for v in value)
    return value


def _deep_plain(value: Any) -> Any:
    from types import MappingProxyType

    if isinstance(value, MappingProxyType) or isinstance(value, dict):
        return {k: _deep_plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_deep_plain(v) for v in value]
    return value


@dataclass(frozen=True)
class BindingToken:
    """Harness-generated authenticated binding authority (owner section 16).

    M-01 (IV4): the token body is DEEPLY immutable — nested identity mappings
    are frozen at mint time (MappingProxyType recursively), and the digest
    captured AT MINT TIME is retained. verify() compares the CURRENT body
    digest against that mint-time digest: a token whose body was changed after
    minting can never be treated as the original authority, and no mutable
    nested identity dictionary can ride inside a real token.
    """

    schema_version: str
    navigator_expected: dict
    tikhon_expected: dict
    navigator_root: str | None
    tikhon_root: str | None
    navigator_manifest_sha256: str | None
    tikhon_manifest_sha256: str | None
    created_at_utc: str
    run_id: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "navigator_expected", _deep_freeze(self.navigator_expected))
        object.__setattr__(self, "tikhon_expected", _deep_freeze(self.tikhon_expected))
        object.__setattr__(self, "minted_digest", sha256_canonical(self.body()))

    @property
    def digest(self) -> str:
        return sha256_canonical(self.body())

    def body(self) -> dict:
        return {
            "schema_version": self.schema_version,
            "navigator_expected": _deep_plain(self.navigator_expected),
            "tikhon_expected": _deep_plain(self.tikhon_expected),
            "navigator_root": self.navigator_root,
            "tikhon_root": self.tikhon_root,
            "navigator_manifest_sha256": self.navigator_manifest_sha256,
            "tikhon_manifest_sha256": self.tikhon_manifest_sha256,
            "created_at_utc": self.created_at_utc,
            "run_id": self.run_id,
        }

    def to_json(self) -> dict:
        return {"token_digest": self.digest, "body": self.body()}

    def verify(self) -> None:
        if self.schema_version != BINDING_TOKEN_SCHEMA_VERSION:
            raise FactoryRejected(
                f"binding token schema {self.schema_version!r} is not authorized"
            )
        if self.digest != getattr(self, "minted_digest", None):
            raise FactoryRejected(
                "binding token digest mismatch against mint-time digest: the token "
                "body was changed after minting (forged/mutated token)"
            )


@dataclass(frozen=True)
class AdapterSpec:
    """Registry-resolved adapter identity (never caller-supplied)."""

    adapter_id: str
    implementation_class: str  # dotted path inside the harness adapters package
    provenance_class: str
    lane: str
    repo: str = ""
    execution_level: str = ""
    supported_failure_classes: tuple[str, ...] = ()
    native_observables: tuple[str, ...] = ()
    native_fault_hooks: tuple[str, ...] = ()
    schedulable_operation: str | None = None
    requires_network: bool = False
    requires_real_telegram: bool = False
    requires_payment: bool = False
    requires_semantic_capability: bool = False
    native_symbols: tuple[str, ...] = ()
    module_path: str = ""


def resolve_adapter_spec(adapter_id: str, registry: dict, lane: str) -> AdapterSpec:
    """Resolve + lane-check an adapter through the AUTHENTICATED registry.

    The scenario may name an adapter_id; everything else comes from the
    registry. A PRODUCT-lane scenario naming a calibration adapter (or vice
    versa) is rejected here, before any construction.
    """
    entry = (registry.get("adapters") or {}).get(adapter_id)
    if entry is None:
        raise FactoryRejected(
            f"adapter {adapter_id!r} is not in the authenticated {lane} registry"
        )
    entry_lane = entry.get("lane") or (
        LANE_PRODUCT if entry.get("provenance_class") != "SYNTHETIC_CALIBRATION" else LANE_CALIBRATION
    )
    if entry_lane != lane:
        raise FactoryRejected(
            f"adapter {adapter_id!r} belongs to lane {entry_lane!r}, not {lane!r}: "
            "cross-lane trust is rejected"
        )
    return AdapterSpec(
        adapter_id=adapter_id,
        implementation_class=entry["implementation_class"],
        provenance_class=entry["provenance_class"],
        lane=entry_lane,
        repo=entry.get("repo", ""),
        execution_level=entry.get("execution_level", ""),
        supported_failure_classes=tuple(entry.get("supported_failure_classes", [])),
        native_observables=tuple(entry.get("native_observables", [])),
        native_fault_hooks=tuple(entry.get("real_fault_hooks", [])),
        schedulable_operation=entry.get("schedulable_operation"),
        requires_network=bool(entry.get("requires_network")),
        requires_real_telegram=bool(entry.get("requires_real_telegram")),
        requires_payment=bool(entry.get("requires_payment")),
        requires_semantic_capability=bool(entry.get("requires_semantic_evaluation")),
        native_symbols=tuple(entry.get("native_symbols", [])),
        module_path=entry.get("module_path", ""),
    )


def _import_implementation(dotted: str) -> type:
    """Import an adapter implementation from the HARNESS-OWNED adapters package.

    The implementation identity comes from the registry, and the import is
    anchored to the benchmark tree — a caller cannot register an arbitrary
    class object or module path outside the harness.
    """
    import importlib

    if not dotted.startswith("adapters."):
        raise FactoryRejected(
            f"implementation {dotted!r} is outside the harness adapters package"
        )
    try:
        module_path, _, cls_name = dotted.rpartition(".")
        module = importlib.import_module(module_path)
        cls = getattr(module, cls_name)
    except (ImportError, AttributeError) as exc:
        raise FactoryRejected(f"implementation {dotted!r} unavailable: {exc}") from exc
    if not callable(cls):
        raise FactoryRejected(f"implementation {dotted!r} is not a callable class")
    return cls


def create_product_adapter(
    request: ExecutionRequest,
    token: BindingToken,
    registry: dict,
) -> tuple[Any, AdapterSpec]:
    """PRODUCT lane: factory constructs the adapter. Zero caller authority.

    M-01 (IV4) trust checks enforced here, before construction:
      - token must be the REAL BindingToken type (duck-typed fixture tokens and
        caller dicts are rejected);
      - token.verify() proves the body still matches its mint-time digest;
      - the token's run identity must correspond to this request's run;
      - the registry entry must be a PRODUCT-lane entry;
      - the implementation must live in the harness adapters namespace;
      - the registered product side (repo) must have a validated TEST_BASE root
        on the token (a Navigator-side adapter cannot run on a Tikhon-only
        binding and vice versa).
    Factory rejection happens BEFORE execution (the runner counts
    adapter_invocations=0 on FactoryRejected).
    """
    if not isinstance(token, BindingToken):
        raise FactoryRejected(
            f"product adapter construction requires a real BindingToken, got "
            f"{type(token).__name__!r} (duck-typed/dict tokens are not authority)"
        )
    token.verify()
    if token.run_id != request.run_id:
        raise FactoryRejected(
            f"binding token run identity {token.run_id!r} does not correspond to "
            f"request run {request.run_id!r}"
        )
    spec = resolve_adapter_spec(request.adapter_id, registry, LANE_PRODUCT)
    if token.navigator_root is None and token.tikhon_root is None:
        raise FactoryRejected(
            "product adapter construction requires an authenticated BindingToken "
            "with at least one validated TEST_BASE root; no valid token, no adapter"
        )
    if spec.repo == "NAVIGATOR" and token.navigator_root is None:
        raise FactoryRejected(
            f"adapter {spec.adapter_id!r} is Navigator-side but the token carries "
            "no validated Navigator TEST_BASE root (side correspondence violated)"
        )
    if spec.repo == "TIKHON" and token.tikhon_root is None:
        raise FactoryRejected(
            f"adapter {spec.adapter_id!r} is Tikhon-side but the token carries "
            "no validated Tikhon TEST_BASE root (side correspondence violated)"
        )
    cls = _import_implementation(spec.implementation_class)
    adapter = cls(request=request, token=token, spec=spec)
    return adapter, spec


def create_calibration_adapter(
    request: ExecutionRequest,
    registry: dict,
    fixture_registry: dict | None = None,
) -> tuple[Any, AdapterSpec]:
    """CALIBRATION lane: fixtures come from the calibration registry only.

    The fixture registry maps calibration adapter IDs to harness-owned
    fixture classes. A calibration request naming a PRODUCT adapter ID is
    rejected: calibration trust can never ride product identity.
    """
    reg = fixture_registry or registry
    spec = resolve_adapter_spec(request.adapter_id, reg, LANE_CALIBRATION)
    cls = _import_implementation(spec.implementation_class)
    adapter = cls(request=request, token=None, spec=spec)
    return adapter, spec


def freeze_value(value: Any) -> Any:
    """Deep-freeze a value into immutable structures (owner section 8).

    dicts -> MappingProxyType over frozen values; lists/tuples -> tuples;
    everything else passes through (str/int/float/bool/None are immutable).
    Guarantees no mutable object identity is shared between the
    ExecutionRequest, the OracleSpecification, or the original spec.
    """
    from types import MappingProxyType

    if isinstance(value, dict):
        return MappingProxyType({k: freeze_value(v) for k, v in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(freeze_value(v) for v in value)
    return value


def deep_copy_value(value: Any) -> Any:
    return copy.deepcopy(value)


def projection_identity_fingerprint(request: ExecutionRequest) -> str:
    """Stable fingerprint of the frozen request (identity tests use this)."""
    return sha256_canonical(request.to_json())
