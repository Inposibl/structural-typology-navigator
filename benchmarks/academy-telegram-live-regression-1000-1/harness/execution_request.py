"""ExecutionRequest — the ONLY object an execution adapter receives (B-1).

Owner section 9: the execution adapter must NOT receive oracle expectations.
This dataclass is projected from the scenario specification by the runner
using an explicit field whitelist; there is no path from EXPECTED_* /
PASS_CONDITIONS / FAIL_CONDITIONS / oracle definitions into an
ExecutionRequest.

Fields an adapter may need:
  - user turns / request
  - state setup
  - fault schedule
  - safe-execution metadata
  - test-root handles
  - scenario identity (id + sha) for evidence labeling
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ExecutionRequest:
    scenario_id: str
    scenario_sha256: str
    track: str
    execution_level: str
    adapter_id: str
    run_id: str
    attempt: int

    turns: tuple[dict, ...] = ()
    state_setup: dict = field(default_factory=dict)
    preconditions: dict = field(default_factory=dict)
    fault_schedule: tuple[dict, ...] = ()
    aux_diagnostics_fields: tuple[str, ...] = ()
    # F06 (IV5): explicit benchmark-local PROVIDER FIXTURE — a controlled
    # native-schema provider response used ONLY as INPUT to the
    # component-under-test (Alexey/Tikhon consumption/persistence). It is
    # scenario STIMULUS material, never expectation/oracle material, and is
    # forbidden on scenarios whose claim depends on actual Navigator policy
    # generation (those declare FUTURE_LOCAL_NAVIGATOR_SERVER instead).
    provider_fixture: dict = field(default_factory=dict)

    # safe-execution metadata (no expectations)
    safe_to_execute: bool = True
    isolation_notes: str = ""
    concurrency_workers: int = 0  # scheduled worker count (execution metadata, not an expectation)

    # test-root handles (validated bindings, may be None in calibration runs)
    navigator_test_root: str | None = None
    tikhon_test_root: str | None = None
    # execution environment (e.g. attested local L2 base URL, log collector
    # path) — frozen, never contains expectations
    execution_environment: tuple = ()

    def __post_init__(self) -> None:
        """F16 (IV5): the TYPE upholds its advertised contract.

        The normal builder deep-freezes and type-checks every carrier, but the
        public dataclass constructor remained shallow: direct construction
        retained shared nested mutable values and accepted arbitrary carrier
        objects. Since CORR5 the constructor itself deep-validates /
        deep-freezes every carrier field — no public construction path can
        retain a shared nested mutable value, and unsupported carrier types
        are rejected consistently with the builder."""
        for name in ("turns", "state_setup", "preconditions", "fault_schedule",
                     "aux_diagnostics_fields", "provider_fixture",
                     "execution_environment"):
            object.__setattr__(self, name, _freeze_carrier(
                getattr(self, name), path=name))

    def to_json(self) -> dict:
        return {
            "scenario_id": self.scenario_id,
            "scenario_sha256": self.scenario_sha256,
            "track": self.track,
            "execution_level": self.execution_level,
            "adapter_id": self.adapter_id,
            "run_id": self.run_id,
            "attempt": self.attempt,
            "turns": list(self.turns),
            "state_setup": self.state_setup,
            "preconditions": self.preconditions,
            "fault_schedule": list(self.fault_schedule),
            "aux_diagnostics_fields": list(self.aux_diagnostics_fields),
            "provider_fixture": self.provider_fixture,
            "safe_to_execute": self.safe_to_execute,
            "isolation_notes": self.isolation_notes,
            "concurrency_workers": self.concurrency_workers,
            "navigator_test_root": self.navigator_test_root,
            "tikhon_test_root": self.tikhon_test_root,
            "execution_environment": dict(self.execution_environment),
        }


# Fields of the scenario spec projected INTO the ExecutionRequest. Anything
# not listed here (expected.*, oracle, pass/fail conditions, semantic claims,
# role invariants, why_* narrative) is OracleSpecification material and never
# reaches an adapter.
EXECUTION_REQUEST_FIELDS = frozenset(
    {
        "scenario_id",
        "track",
        "execution_level",
        "turns",
        "state_setup",
        "preconditions",
        "fault_schedule",
        "aux_diagnostics_fields",
        "provider_fixture",
        "safe_to_execute",
        "isolation_notes",
        "concurrency_workers",
        "execution_environment",
    }
)

FORBIDDEN_REQUEST_FIELDS = frozenset(
    {
        "expected",
        "expected_act",
        "expected_origin",
        "expected_state",
        "expected_link",
        "oracle",
        "pass_conditions",
        "fail_conditions",
        "role_invariant",
        "semantic_evaluation",
        "prohibited_output",
        "why_this_scenario_tests_this_class",
        "failure_mechanism",
    }
)


def build_execution_request(spec: dict, *, adapter_id: str, run_id: str, attempt: int,
                            scenario_sha256: str, navigator_test_root: str | None,
                            tikhon_test_root: str | None,
                            execution_environment: dict | None = None) -> ExecutionRequest:
    """Whitelist projection. Raises if a forbidden field is somehow requested."""
    kwargs = {
        "scenario_id": spec["scenario_id"],
        "scenario_sha256": scenario_sha256,
        "track": spec["track"],
        "execution_level": spec["execution_level"],
        "adapter_id": adapter_id,
        "run_id": run_id,
        "attempt": attempt,
        "navigator_test_root": navigator_test_root,
        "tikhon_test_root": tikhon_test_root,
    }
    for f in EXECUTION_REQUEST_FIELDS:
        if f in spec and f not in kwargs:
            kwargs[f] = spec[f]
    kwargs["execution_environment"] = tuple((execution_environment or {}).items())
    kwargs = freeze_request_fields(kwargs)
    req = ExecutionRequest(**kwargs)
    # structural guarantee: serialize and check no forbidden key materialized
    blob = req.to_json()
    for f in FORBIDDEN_REQUEST_FIELDS:
        if f in blob and blob[f] not in (None, (), {}, ""):
            raise RuntimeError(f"ExecutionRequest leakage: forbidden field {f!r} present")
    return req


def freeze_request_fields(kwargs: dict) -> dict:
    """Deep-copy + deep-freeze all request fields (owner section 8): no
    mutable object identity may be shared between the ExecutionRequest, the
    OracleSpecification, or the original scenario structure.

    M-01 (IV4): only explicitly serializable benchmark data types are accepted
    carriers. dict/list/tuple are frozen recursively; str/int/float/bool/None
    pass through; ANY other object type (set, closure, custom class,
    MappingProxy of unknown provenance, ...) is REJECTED at construction — no
    silently retained arbitrary shared mutable reference."""
    return {k: _freeze_carrier(v, path=k) for k, v in kwargs.items()}


def _freeze_carrier(v, path: str = "request"):
    """The single deep-freeze/deep-validate implementation shared by the
    builder AND the ExecutionRequest constructor itself (F16: the type upholds
    its own advertised contract — callers cannot forget their way past it).
    An already-frozen MappingProxyType carrier (produced by the builder) is
    re-frozen into a fresh immutable proxy — still no shared mutable
    identity; any other non-JSON object type is rejected."""
    from types import MappingProxyType

    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, MappingProxyType):
        return MappingProxyType({k: _freeze_carrier(x, f"{path}[{k!r}]")
                                 for k, x in v.items()})
    if isinstance(v, dict):
        return MappingProxyType({k: _freeze_carrier(x, f"{path}[{k!r}]") for k, x in v.items()})
    if isinstance(v, (list, tuple)):
        return tuple(_freeze_carrier(x, f"{path}[{i}]") for i, x in enumerate(v))
    raise TypeError(
        f"ExecutionRequest carrier at {path} has unsupported type "
        f"{type(v).__name__!r}: only JSON-serializable benchmark data types "
        "(dict/list/tuple/str/int/float/bool/None) are accepted"
    )


# ---------------------------------------------------------------------------
# Immutable -> native transport conversion (B-05)
# ---------------------------------------------------------------------------

def to_native(value: Any) -> Any:
    """Controlled conversion at the adapter boundary (IV4 B-05).

    The frozen ExecutionRequest keeps its trust boundary immutable
    (MappingProxyType / tuple). Native interfaces (json.dumps, native dict /
    isinstance(msg, dict) checks) require ordinary JSON data. This function
    produces the adapter-owned plain transport representation:

    - deep-copies (no shared identity with the frozen request);
    - preserves values exactly;
    - returns ordinary dict / list / scalars only;
    - never mutates and never weakens the ExecutionRequest;
    - never sees oracle material (request fields never carry expectations).
    """
    from types import MappingProxyType

    if isinstance(value, MappingProxyType) or isinstance(value, dict):
        return {k: to_native(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_native(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(
        f"native transport conversion cannot carry type {type(value).__name__!r} "
        "(only dict/list/tuple/str/int/float/bool/None are benchmark carriers)"
    )
