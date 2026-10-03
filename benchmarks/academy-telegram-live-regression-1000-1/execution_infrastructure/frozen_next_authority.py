"""Frozen Next runtime authority.

The controlling identity of the Next runtime is a static artifact in this
benchmark tree: authority/FROZEN_NEXT_RUNTIME_AUTHORITY.json. It was written
once, from the accepted dependency installation, by
freeze_next_runtime_authority.py. Execution-time code in this module only
reads it and compares bytes with it. Nothing here writes, refreshes, or
repairs the artifact, and nothing here derives an expected hash from the
directory being attested.

Identity is path independent. Entries are keyed by the path relative to
node_modules. A file entry is type, byte count, executable bit, and SHA256.
A symlink entry is type and the stored link text. Absolute filesystem paths
appear only as the explicit Node launch location, which section 9 of the
CORR6 act requires to be bound.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

AUTHORITY_SCHEMA = "ACADEMY_FROZEN_NEXT_RUNTIME_AUTHORITY_V1"
AUTHORITY_DIR = Path(__file__).resolve().parent / "authority"
AUTHORITY_PATH = AUTHORITY_DIR / "FROZEN_NEXT_RUNTIME_AUTHORITY.json"
AUTHORITY_SIDECAR = AUTHORITY_DIR / "FROZEN_NEXT_RUNTIME_AUTHORITY.sha256"
BENCH_ROOT = Path(__file__).resolve().parents[1]

# SHA256 of the frozen artifact bytes. The JSON, its sidecar, and this pin
# must agree. A rewritten artifact with a matching rewritten sidecar still
# fails here.
FROZEN_NEXT_RUNTIME_AUTHORITY_SHA256 = "940abbc4221913c9ae37a8d38decc6dad68a9f8c353acf9a53d0e005d0796138"

_HASH_WORKERS = 8


class NextAuthorityError(PermissionError):
    """Attestation against the frozen Next runtime authority failed."""


def canonical_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path | str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def surface_aggregate(entries: list[dict[str, Any]]) -> str:
    """Digest of the sorted relative entries. No absolute path enters it."""
    ordered = sorted(entries, key=lambda item: item["path"])
    return sha256_bytes(canonical_json(ordered).encode("utf-8"))


def scan_tree(root: Path) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """Return {relative path: entry} for every file and symlink under root.

    Files are hashed. Symlinks are recorded by link text and never
    followed. Anything that is not a directory, a regular file, or a
    symlink is reported as an irregular entry.
    """
    root = Path(root)
    files: list[tuple[str, str, int, bool]] = []
    entries: dict[str, dict[str, Any]] = {}
    irregular: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        kept = []
        for name in dirnames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if os.path.islink(full):
                entries[rel] = {"path": rel, "type": "symlink", "target": os.readlink(full)}
            else:
                kept.append(name)
        dirnames[:] = kept
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            info = os.lstat(full)
            if stat.S_ISLNK(info.st_mode):
                entries[rel] = {"path": rel, "type": "symlink", "target": os.readlink(full)}
            elif stat.S_ISREG(info.st_mode):
                files.append((rel, full, int(info.st_size), bool(info.st_mode & stat.S_IXUSR)))
            else:
                irregular.append(rel)
    with ThreadPoolExecutor(max_workers=_HASH_WORKERS) as pool:
        digests = list(pool.map(lambda row: sha256_file(row[1]), files))
    for (rel, _full, size, executable), digest in zip(files, digests):
        entries[rel] = {
            "path": rel,
            "type": "file",
            "bytes": size,
            "executable": executable,
            "sha256": digest,
        }
    return entries, sorted(irregular)


def load_frozen_authority(path: Path | None = None, sidecar_path: Path | None = None) -> dict[str, Any]:
    """Read the static artifact and check it against the sidecar and the pin.

    The pin is a source constant. A different path can be read, for a
    negative control, but it must still carry the pinned bytes.
    """
    try:
        raw = Path(path or AUTHORITY_PATH).read_bytes()
        sidecar = Path(sidecar_path or AUTHORITY_SIDECAR).read_text(encoding="utf-8").split()
    except OSError as exc:
        raise NextAuthorityError("FROZEN_NEXT_AUTHORITY_MISSING") from exc
    digest = sha256_bytes(raw)
    if not sidecar or sidecar[0] != digest:
        raise NextAuthorityError("FROZEN_NEXT_AUTHORITY_SIDECAR_MISMATCH")
    if digest != FROZEN_NEXT_RUNTIME_AUTHORITY_SHA256:
        raise NextAuthorityError("FROZEN_NEXT_AUTHORITY_PIN_MISMATCH")
    document = json.loads(raw.decode("utf-8"))
    if document.get("schema") != AUTHORITY_SCHEMA:
        raise NextAuthorityError("FROZEN_NEXT_AUTHORITY_SCHEMA_MISMATCH")
    surface = document.get("runtime_surface") or {}
    entries = surface.get("entries") or []
    if surface_aggregate(entries) != surface.get("aggregate_sha256"):
        raise NextAuthorityError("FROZEN_NEXT_AUTHORITY_SURFACE_DIGEST_MISMATCH")
    if runtime_identity_aggregate(document) != document.get("runtime_surface_aggregate_sha256"):
        raise NextAuthorityError("FROZEN_NEXT_AUTHORITY_AGGREGATE_MISMATCH")
    document["_artifact_sha256"] = digest
    return document


def runtime_identity_aggregate(document: dict[str, Any]) -> str:
    """Path-independent digest over every frozen identity component."""
    lock = document.get("package_lock") or {}
    node = document.get("node_executable") or {}
    preload = document.get("preload") or {}
    body = {
        "schema": document.get("schema"),
        "package_lock_sha256": lock.get("sha256"),
        "package_lock_bytes": lock.get("bytes"),
        "next_version": (document.get("package") or {}).get("next_version"),
        "surface_aggregate_sha256": (document.get("runtime_surface") or {}).get("aggregate_sha256"),
        "surface_entry_count": (document.get("runtime_surface") or {}).get("entry_count"),
        "node_sha256": node.get("sha256"),
        "node_bytes": node.get("bytes"),
        "node_version": node.get("version"),
        "preload_relative_path": preload.get("benchmark_relative_path"),
        "preload_sha256": preload.get("sha256"),
        "preload_bytes": preload.get("bytes"),
    }
    return sha256_bytes(canonical_json(body).encode("utf-8"))


def compare_tree(root: Path, document: dict[str, Any]) -> dict[str, Any]:
    """Compare an installed node_modules tree with the frozen entries."""
    root = Path(root)
    surface = document["runtime_surface"]
    expected = {item["path"]: item for item in surface["entries"]}
    if not root.is_dir() or root.is_symlink():
        return {
            "ok": False,
            "reason": "NODE_MODULES_NOT_A_DIRECTORY",
            "missing": sorted(expected),
            "extra": [],
            "changed": [],
            "irregular": [],
        }
    actual, irregular = scan_tree(root)
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    changed = sorted(
        rel for rel in set(expected) & set(actual) if expected[rel] != actual[rel]
    )
    observed = surface_aggregate(list(actual.values()))
    ok = not missing and not extra and not changed and not irregular
    return {
        "ok": ok,
        "reason": None if ok else "RUNTIME_SURFACE_MISMATCH",
        "entry_count": len(actual),
        "expected_entry_count": len(expected),
        "observed_aggregate_sha256": observed,
        "expected_aggregate_sha256": surface["aggregate_sha256"],
        "missing": missing,
        "extra": extra,
        "changed": changed,
        "irregular": irregular,
    }


def attest_package_lock(navigator_root: Path, document: dict[str, Any]) -> dict[str, Any]:
    lock = document["package_lock"]
    path = Path(navigator_root) / lock["relative_path"]
    try:
        digest = sha256_file(path)
        size = path.stat().st_size
    except OSError:
        return {"ok": False, "reason": "PACKAGE_LOCK_MISSING"}
    ok = digest == lock["sha256"] and size == lock["bytes"]
    return {
        "ok": ok,
        "reason": None if ok else "PACKAGE_LOCK_MISMATCH",
        "sha256": digest,
        "expected_sha256": lock["sha256"],
    }


def attest_node_executable(document: dict[str, Any], candidate: str | Path | None = None) -> dict[str, Any]:
    """The launch binary is the frozen absolute Node path, verified by bytes.

    A candidate is a caller's proposed executable. It must resolve to the
    accepted path and carry the accepted bytes. PATH is never consulted.
    """
    node = document["node_executable"]
    accepted = node["realpath"]
    proposed = os.path.realpath(str(candidate)) if candidate is not None else accepted
    if proposed != accepted:
        return {
            "ok": False,
            "reason": "NODE_EXECUTABLE_IDENTITY_MISMATCH",
            "proposed": proposed,
            "accepted_realpath": accepted,
        }
    try:
        digest = sha256_file(accepted)
        size = os.stat(accepted).st_size
    except OSError:
        return {"ok": False, "reason": "NODE_EXECUTABLE_MISSING", "accepted_realpath": accepted}
    ok = digest == node["sha256"] and size == node["bytes"]
    return {
        "ok": ok,
        "reason": None if ok else "NODE_EXECUTABLE_IDENTITY_MISMATCH",
        "realpath": accepted,
        "sha256": digest,
        "bytes": size,
    }


def attest_preload(document: dict[str, Any], candidate: str | Path) -> dict[str, Any]:
    preload = document["preload"]
    try:
        digest = sha256_file(candidate)
        size = os.stat(candidate).st_size
    except OSError:
        return {"ok": False, "reason": "PRELOAD_MISSING"}
    ok = digest == preload["sha256"] and size == preload["bytes"]
    return {
        "ok": ok,
        "reason": None if ok else "PRELOAD_IDENTITY_MISMATCH",
        "sha256": digest,
        "bytes": size,
        "expected_sha256": preload["sha256"],
    }


def summarize_tree(result: dict[str, Any], limit: int = 20) -> dict[str, Any]:
    """Proof-sized view of compare_tree. Counts are complete."""
    return {
        "ok": result.get("ok"),
        "reason": result.get("reason"),
        "entry_count": result.get("entry_count"),
        "expected_entry_count": result.get("expected_entry_count"),
        "observed_aggregate_sha256": result.get("observed_aggregate_sha256"),
        "expected_aggregate_sha256": result.get("expected_aggregate_sha256"),
        "missing_count": len(result.get("missing") or []),
        "extra_count": len(result.get("extra") or []),
        "changed_count": len(result.get("changed") or []),
        "irregular_count": len(result.get("irregular") or []),
        "missing": list(result.get("missing") or [])[:limit],
        "extra": list(result.get("extra") or [])[:limit],
        "changed": list(result.get("changed") or [])[:limit],
    }
