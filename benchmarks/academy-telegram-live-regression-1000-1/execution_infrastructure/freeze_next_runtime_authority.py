"""One-time writer for the frozen Next runtime authority.

Run once, in the authorized CORR6 act, against the accepted dependency
installation. It refuses to run when the artifact already exists, so it
cannot refresh, repair, or replace the authority. Execution-time modules do
not import this file.

Usage (from the benchmark root):

    python3 -B -m execution_infrastructure.freeze_next_runtime_authority \
        --navigator-root <accepted Navigator checkout> --node <absolute node>
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from .frozen_next_authority import (
    AUTHORITY_DIR,
    AUTHORITY_PATH,
    AUTHORITY_SCHEMA,
    AUTHORITY_SIDECAR,
    BENCH_ROOT,
    runtime_identity_aggregate,
    scan_tree,
    sha256_bytes,
    sha256_file,
    surface_aggregate,
)

ACT = (
    "ACADEMY-TELEGRAM-LIVE-REGRESSION-1000-1."
    "EXECUTION-INFRASTRUCTURE-CLOSURE-1.IMPLEMENTATION-1.CORR6"
)
PRELOAD_RELATIVE = "execution_infrastructure/node/academy-execution-preload.cjs"
LOCK_PACKAGES = ("node_modules/next", "node_modules/@next/env")


def _lock_provenance(lock: dict) -> dict:
    packages = lock.get("packages") or {}
    rows = {}
    for key, value in sorted(packages.items()):
        if key in LOCK_PACKAGES or key.startswith("node_modules/@next/swc-"):
            rows[key] = {
                "version": value.get("version"),
                "integrity": value.get("integrity"),
                "resolved": value.get("resolved"),
                "optional": bool(value.get("optional")),
                "os": value.get("os"),
                "cpu": value.get("cpu"),
            }
    return rows


def build_document(navigator_root: Path, node: Path) -> dict:
    navigator_root = navigator_root.resolve()
    modules = navigator_root / "node_modules"
    lock_path = navigator_root / "package-lock.json"
    lock_bytes = lock_path.read_bytes()
    lock = json.loads(lock_bytes.decode("utf-8"))
    provenance = _lock_provenance(lock)
    next_version = json.loads((modules / "next" / "package.json").read_text(encoding="utf-8"))["version"]
    installed_swc = sorted(
        child.name for child in (modules / "@next").iterdir()
        if child.is_dir() and child.name.startswith("swc-")
    )
    for name in ("next", "@next/env", *[f"@next/{item}" for item in installed_swc]):
        package = json.loads((modules / name / "package.json").read_text(encoding="utf-8"))
        locked = provenance.get(f"node_modules/{name}") or {}
        if package.get("version") != locked.get("version"):
            raise SystemExit(f"installed {name} {package.get('version')} != lock {locked.get('version')}")
    entries, irregular = scan_tree(modules)
    if irregular:
        raise SystemExit(f"irregular entries in accepted node_modules: {irregular[:5]}")
    absolute_links = [item["path"] for item in entries.values() if item["type"] == "symlink" and item["target"].startswith("/")]
    if absolute_links:
        raise SystemExit(f"absolute symlink targets are path dependent: {absolute_links[:5]}")
    ordered = sorted(entries.values(), key=lambda item: item["path"])
    node_real = os.path.realpath(str(node))
    version = subprocess.run(
        [node_real, "--version"], check=True, capture_output=True, text=True, timeout=30,
    ).stdout.strip()
    preload = BENCH_ROOT / PRELOAD_RELATIVE
    document = {
        "schema": AUTHORITY_SCHEMA,
        "authority_version": 1,
        "act": ACT,
        "created_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "origin_description": (
            "Accepted Navigator dependency installation at Navigator HEAD "
            "a1d40e678fc4a5f4ff11f8490a84e6d899788e02. The origin path is not "
            "part of the identity."
        ),
        "package_lock": {
            "relative_path": "package-lock.json",
            "sha256": sha256_bytes(lock_bytes),
            "bytes": len(lock_bytes),
            "lockfile_version": lock.get("lockfileVersion"),
        },
        "package": {
            "next_version": next_version,
            "installed_swc_packages": [f"@next/{item}" for item in installed_swc],
            "lock_integrity": provenance,
            "integrity_semantics": (
                "PROVENANCE_ONLY. npm integrity covers the registry tarball. It is "
                "not verified against installed files here. The per-file SHA256 "
                "entries below are the controlling identity."
            ),
        },
        "runtime_surface": {
            "root": "node_modules",
            "coverage": "FULL_NODE_MODULES_TREE",
            "coverage_reason": (
                "Next build and start load next, @next/env, @next/swc, react, "
                "react-dom, styled-jsx, @swc/helpers, postcss, typescript, and "
                "the application dependencies through Node resolution. Every "
                "regular file and symlink under node_modules is frozen, and an "
                "added, missing, or changed entry is a mismatch."
            ),
            "excluded": [],
            "entry_count": len(ordered),
            "file_count": sum(1 for item in ordered if item["type"] == "file"),
            "symlink_count": sum(1 for item in ordered if item["type"] == "symlink"),
            "total_file_bytes": sum(item.get("bytes", 0) for item in ordered),
            "aggregate_sha256": surface_aggregate(ordered),
            "entries": ordered,
        },
        "node_executable": {
            "realpath": node_real,
            "sha256": sha256_file(node_real),
            "bytes": os.stat(node_real).st_size,
            "version": version,
            "launch_rule": "Next is launched as <realpath> <replica>/node_modules/next/dist/bin/next. PATH is not consulted.",
        },
        "preload": {
            "benchmark_relative_path": PRELOAD_RELATIVE,
            "sha256": sha256_file(preload),
            "bytes": preload.stat().st_size,
        },
    }
    document["runtime_surface_aggregate_sha256"] = runtime_identity_aggregate(document)
    return document


def main(argv: list[str] | None = None) -> int:
    sys.dont_write_bytecode = True
    parser = argparse.ArgumentParser()
    parser.add_argument("--navigator-root", required=True)
    parser.add_argument("--node", required=True)
    args = parser.parse_args(argv)
    if AUTHORITY_PATH.exists() or AUTHORITY_SIDECAR.exists():
        print(json.dumps({"ok": False, "reason": "FROZEN_NEXT_AUTHORITY_ALREADY_EXISTS"}))
        return 1
    document = build_document(Path(args.navigator_root), Path(args.node))
    AUTHORITY_DIR.mkdir(parents=True, exist_ok=True)
    body = (json.dumps(document, ensure_ascii=False, sort_keys=True, indent=1) + "\n").encode("utf-8")
    AUTHORITY_PATH.write_bytes(body)
    digest = sha256_bytes(body)
    AUTHORITY_SIDECAR.write_text(f"{digest}  {AUTHORITY_PATH.name}\n", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "path": str(AUTHORITY_PATH),
        "sha256": digest,
        "bytes": len(body),
        "entry_count": document["runtime_surface"]["entry_count"],
        "aggregate_sha256": document["runtime_surface"]["aggregate_sha256"],
        "runtime_surface_aggregate_sha256": document["runtime_surface_aggregate_sha256"],
        "package_lock_sha256": document["package_lock"]["sha256"],
        "node_sha256": document["node_executable"]["sha256"],
        "preload_sha256": document["preload"]["sha256"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
