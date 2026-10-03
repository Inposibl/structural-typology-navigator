"""Process-local capability for controlled benchmark execution.

An environment variable cannot mint this object. Only mint_controlled_context
can, and only after every startup proof is true. scenario_body_permitted
stays false until a later act calls permit_scenario_body. This act does not.
"""

from __future__ import annotations

import secrets
from typing import Any

REQUIRED_PROOFS = (
    "CONTROLLED_NEXT_MODE",
    "NODE_PRELOAD_ACTIVE",
    "POST_PATCH_SENTINEL_PASS",
    "NODE_LIFETIME_LEDGER_ACTIVE",
    "SUPABASE_LOOPBACK_ACTIVE",
    "PYTHON_ISOLATION_ACTIVE",
    "PD_F06_LIFECYCLE_ACTIVE",
    "OS_F04_PROCESS_STREAM_CAPTURE_ACTIVE",
    "PD_F04_ATTEMPT_OBSERVER_ACTIVE",
)

_SEAL = secrets.token_bytes(32)
_ACTIVE: "ControlledContext | None" = None


class ControlledContext:
    def __init__(self, seal: bytes, proofs: dict[str, bool]) -> None:
        self.seal = seal
        self.proofs = proofs
        self.scenario_body_permitted = False
        self.scenarios_executed = 0
        self.proof_identity: dict[str, Any] = {}
        # Product authority binds to this nonce and the proof generation.
        self.context_nonce = secrets.token_hex(16)

    def proof_flags(self) -> dict[str, bool]:
        return {name: self.proofs.get(name) is True for name in REQUIRED_PROOFS}


def mint_controlled_context(proofs: dict[str, Any]) -> ControlledContext:
    """Mint the one active context from live subsystem proofs.

    Any failure clears the previous context. A dict of True booleans is not
    accepted.
    """
    global _ACTIVE
    try:
        if not isinstance(proofs, dict):
            raise PermissionError("startup proofs must be a dict")
        from .startup_proofs import validate_live_proofs

        identity = validate_live_proofs(proofs)
    except Exception:
        _ACTIVE = None
        raise
    ctx = ControlledContext(
        seal=_SEAL,
        proofs={name: True for name in REQUIRED_PROOFS},
    )
    ctx.proof_identity = identity
    _ACTIVE = ctx
    return ctx


def require_controlled_context() -> ControlledContext | None:
    ctx = _ACTIVE
    if not isinstance(ctx, ControlledContext):
        return None
    if ctx.seal != _SEAL or ctx is not _ACTIVE:
        return None
    if not all(ctx.proofs.get(name) is True for name in REQUIRED_PROOFS):
        return None
    return ctx


def permit_scenario_body() -> ControlledContext:
    """Future act only. CORR1 must not call this."""
    ctx = require_controlled_context()
    if ctx is None:
        raise PermissionError("no controlled context")
    ctx.scenario_body_permitted = True
    return ctx


def clear_controlled_context() -> None:
    global _ACTIVE
    _ACTIVE = None
