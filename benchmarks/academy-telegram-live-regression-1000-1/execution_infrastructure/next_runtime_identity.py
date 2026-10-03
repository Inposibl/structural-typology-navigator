"""Next runtime attestation against the frozen authority.

The controlling identity is authority/FROZEN_NEXT_RUNTIME_AUTHORITY.json.
The Navigator node_modules directory is the origin under attestation. It is
not a trust root. A replica is attested against the same frozen artifact,
not against the origin, so an origin and a replica that carry the same
foreign bytes both fail.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .frozen_next_authority import (
    NextAuthorityError,
    attest_package_lock,
    compare_tree,
    load_frozen_authority,
)

AUTHORITY = "FROZEN_NEXT_RUNTIME_AUTHORITY"


def origin_navigator_root() -> Path:
    from .orchestrator import NAVIGATOR

    return Path(NAVIGATOR).resolve()


def trusted_node_modules() -> Path:
    """The origin installation location. It is attested, not trusted."""
    return (origin_navigator_root() / "node_modules").resolve()


def authority_relative_paths(origin: Path | None = None) -> list[str]:
    """Every frozen entry path, relative to node_modules. origin is ignored."""
    document = load_frozen_authority()
    return [item["path"] for item in document["runtime_surface"]["entries"]]


def _attest(navigator_root: Path, failure: str) -> dict[str, Any]:
    try:
        document = load_frozen_authority()
    except NextAuthorityError as exc:
        return {
            "ok": False,
            "classification": failure,
            "authority": AUTHORITY,
            "reason": str(exc),
            "mismatches": [],
            "mismatch_count": 0,
        }
    modules = Path(navigator_root) / "node_modules"
    tree = compare_tree(modules, document)
    lock = attest_package_lock(navigator_root, document)
    mismatches = list(tree["changed"]) + list(tree["missing"]) + list(tree["extra"]) + list(tree["irregular"])
    if not lock["ok"]:
        mismatches.append("<package-lock.json>")
    ok = bool(tree["ok"] and lock["ok"])
    return {
        "ok": ok,
        "classification": "TRUSTED_NEXT_RUNTIME" if ok else failure,
        "authority": AUTHORITY,
        "frozen_authority_sha256": document["_artifact_sha256"],
        "runtime_surface_aggregate_sha256": document["runtime_surface_aggregate_sha256"],
        "surface_aggregate_sha256": document["runtime_surface"]["aggregate_sha256"],
        "observed_surface_aggregate_sha256": tree.get("observed_aggregate_sha256"),
        "package_lock_sha256": lock.get("sha256"),
        "package_lock_ok": lock["ok"],
        "next_version": document["package"]["next_version"],
        "file_count": tree.get("entry_count"),
        "expected_entry_count": tree.get("expected_entry_count"),
        "changed": tree["changed"],
        "missing_count": len(tree["missing"]),
        "extra": tree["extra"],
        "irregular": tree["irregular"],
        "mismatch_count": len(mismatches),
        "mismatches": mismatches,
    }


def attest_origin_next_runtime(navigator_root: Path | None = None) -> dict[str, Any]:
    """FROZEN AUTHORITY == ORIGIN, checked before any replica is built."""
    root = Path(navigator_root).resolve() if navigator_root is not None else origin_navigator_root()
    result = _attest(root, "NEXT_ORIGIN_IDENTITY_MISMATCH")
    result["origin_relation"] = "ORIGIN"
    return result


def attest_replica_next_runtime(replica: Path) -> dict[str, Any]:
    """FROZEN AUTHORITY == REPLICA. The origin is not consulted.

    The replica node_modules must be its own directory. A replica that is
    the origin checkout, or whose node_modules resolves into it, is a
    mismatch.
    """
    replica_root = Path(replica).resolve()
    replica_modules = replica_root / "node_modules"
    origin_modules = trusted_node_modules()
    origin_is_replica = (
        replica_root == origin_navigator_root()
        or os.path.realpath(replica_modules) == str(origin_modules)
    )
    result = _attest(replica_root, "NEXT_RUNTIME_IDENTITY_MISMATCH")
    result["origin_relation"] = "REPLICA"
    result["replica_root"] = str(replica_root)
    result["origin_is_replica"] = origin_is_replica
    if origin_is_replica:
        result["ok"] = False
        result["classification"] = "NEXT_RUNTIME_IDENTITY_MISMATCH"
        result["mismatches"] = list(result.get("mismatches") or []) + ["<replica is origin>"]
        result["mismatch_count"] = len(result["mismatches"])
    return result
