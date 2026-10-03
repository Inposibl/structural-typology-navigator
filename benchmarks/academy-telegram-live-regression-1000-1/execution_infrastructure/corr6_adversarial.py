"""CORR6 adversarial Next probes in disposable paths.

1. Trust-root poisoning, reproduced the way CORR5.IV1 did it: a disposable
   Navigator copy A whose node_modules carries a fake next entrypoint, with
   the benchmark code itself running from inside A, and a replica B built
   from A. The same control is run against the CORR5 source bytes (taken
   read-only from the CORR5 replica) to show the control detects the CORR5
   defect.
2. A launch-level tamper matrix against one copy-on-write clone: every
   mutation must stop launch_controlled_next before a build.

The accepted origin node_modules is never written. No build or start runs
on a mutated tree. No provider is contacted.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

BENCH = Path(__file__).resolve().parents[1]
BENCH_RELATIVE = "benchmarks/academy-telegram-live-regression-1000-1"
CORR5_REPLICA_BENCH = Path(
    "/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/"
    "ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1_CORR5/navigator-replica/"
) / BENCH_RELATIVE
FAKE_NEXT = (
    "#!/usr/bin/env node\n"
    "const fs = require('fs');\n"
    "if (process.argv[2] === 'build') {\n"
    "  process.stdout.write('Creating an optimized production build\\nCompiled successfully\\n');\n"
    "  fs.mkdirSync('.next', { recursive: true });\n"
    "  fs.writeFileSync('.next/BUILD_ID', 'fake-build\\n');\n"
    "  process.exit(0);\n"
    "}\n"
)
HIJACK = "/* corr6 adversarial */ try { require.cache; } catch (e) {}\n"


def _origin() -> Path:
    return BENCH.parents[1]


def _clone_tree(navigator: Path) -> None:
    origin = _origin()
    subprocess.run(["cp", "-cR", str(origin / "node_modules"), str(navigator / "node_modules")], check=True)
    shutil.copy2(origin / "package-lock.json", navigator / "package-lock.json")
    shutil.copy2(origin / "package.json", navigator / "package.json")


def _replace(path: Path, data: bytes) -> None:
    path.unlink()
    path.write_bytes(data)


def _copy_code(source_bench: Path, navigator: Path) -> Path:
    target = navigator / BENCH_RELATIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["rsync", "-a", "--exclude", "__pycache__", str(source_bench) + "/", str(target) + "/"],
        check=True,
    )
    return target


def _run_in(code_root: Path, script: str, *args: str) -> dict[str, Any]:
    env = {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": tempfile.mkdtemp(prefix="academy-corr6-adv-home-"),
        "TMPDIR": tempfile.gettempdir(),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    completed = subprocess.run(
        [sys.executable, "-B", "-c", script, str(code_root), *args],
        capture_output=True, text=True, timeout=600, env=env, cwd=str(code_root), check=False,
    )
    lines = [line for line in completed.stdout.strip().splitlines() if line.startswith("{")]
    if not lines:
        return {"error": (completed.stderr or completed.stdout)[-1500:], "returncode": completed.returncode}
    return json.loads(lines[-1])


CORR6_POISON_SCRIPT = r"""
import json, os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from execution_infrastructure import orchestrator
from execution_infrastructure.next_runtime_identity import attest_origin_next_runtime, attest_replica_next_runtime
from execution_infrastructure.next_authority import launch_controlled_next, current_capability
from execution_infrastructure.controlled_context import mint_controlled_context, permit_scenario_body, require_controlled_context, REQUIRED_PROOFS
from execution_infrastructure.constants import PRELOAD_PATH
replica_b = Path(sys.argv[2])
dest = Path(sys.argv[3])
out = {"navigator_resolves_to": str(orchestrator.NAVIGATOR)}
origin = attest_origin_next_runtime()
out["origin_classification"] = origin["classification"]
out["origin_changed"] = origin["changed"][:5]
rep = attest_replica_next_runtime(replica_b)
out["replica_classification"] = rep["classification"]
out["replica_changed"] = rep["changed"][:5]
try:
    orchestrator.build_sanitized_replica(dest)
    out["build_sanitized_replica"] = "BUILT"
except PermissionError as exc:
    out["build_sanitized_replica"] = str(exc)
out["dest_created"] = dest.exists()
try:
    launch_controlled_next(replica=replica_b, profile_path=replica_b / "deny.sb", port=9, env={},
        build_log=replica_b / "b.log", start_log=replica_b / "s.log", state_path=replica_b / "st.json",
        ledger_path=replica_b / "l.json", preload_path=PRELOAD_PATH)
    out["launch"] = "LAUNCHED"
except PermissionError as exc:
    out["launch"] = str(exc)
out["capability"] = current_capability() is not None
out["build_id_written"] = (replica_b / ".next" / "BUILD_ID").exists()
try:
    mint_controlled_context({name: True for name in REQUIRED_PROOFS})
    out["context_minted"] = True
except PermissionError:
    out["context_minted"] = require_controlled_context() is not None
try:
    permit_scenario_body()
    out["scenario_body_permitted"] = True
except PermissionError:
    out["scenario_body_permitted"] = False
print(json.dumps(out))
"""

CORR5_POISON_SCRIPT = r"""
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from execution_infrastructure import orchestrator
from execution_infrastructure.next_runtime_identity import attest_replica_next_runtime
replica_b = Path(sys.argv[2])
result = attest_replica_next_runtime(replica_b)
print(json.dumps({
    "navigator_resolves_to": str(orchestrator.NAVIGATOR),
    "classification": result.get("classification"),
    "ok": result.get("ok"),
    "file_count": result.get("file_count"),
    "mismatch_count": result.get("mismatch_count"),
}))
"""


def poisoning_probe(base: Path) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for label, source, script in (
        ("corr6", BENCH, CORR6_POISON_SCRIPT),
        ("corr5_control", CORR5_REPLICA_BENCH, CORR5_POISON_SCRIPT),
    ):
        for variant in ("entrypoint", "picocolors"):
            navigator = base / f"{label}-{variant}-navA"
            navigator.mkdir(parents=True)
            _clone_tree(navigator)
            if variant == "entrypoint":
                entry = navigator / "node_modules" / "next" / "dist" / "bin" / "next"
                _replace(entry, FAKE_NEXT.encode("utf-8"))
                entry.chmod(0o755)
            else:
                target = navigator / "node_modules" / "next" / "dist" / "lib" / "picocolors.js"
                _replace(target, HIJACK.encode("utf-8") + (_origin() / "node_modules/next/dist/lib/picocolors.js").read_bytes())
            code = _copy_code(source, navigator)
            replica = base / f"{label}-{variant}-replicaB"
            replica.mkdir()
            subprocess.run(["cp", "-cR", str(navigator / "node_modules"), str(replica / "node_modules")], check=True)
            shutil.copy2(navigator / "package-lock.json", replica / "package-lock.json")
            if label == "corr6":
                row = _run_in(code, script, str(replica), str(base / f"{label}-{variant}-dest"))
                row["frozen_authority_unchanged"] = (
                    (code / "execution_infrastructure/authority/FROZEN_NEXT_RUNTIME_AUTHORITY.json").read_bytes()
                    == (BENCH / "execution_infrastructure/authority/FROZEN_NEXT_RUNTIME_AUTHORITY.json").read_bytes()
                )
            else:
                row = _run_in(code, script, str(replica))
            results[f"{label}_{variant}"] = row
            shutil.rmtree(navigator, ignore_errors=True)
            shutil.rmtree(replica, ignore_errors=True)
    corr6_ok = all(
        row.get("origin_classification") == "NEXT_ORIGIN_IDENTITY_MISMATCH"
        and row.get("replica_classification") == "NEXT_RUNTIME_IDENTITY_MISMATCH"
        and "NEXT_ORIGIN_IDENTITY_MISMATCH" in str(row.get("build_sanitized_replica"))
        and row.get("dest_created") is False
        and "NEXT_ORIGIN_IDENTITY_MISMATCH" in str(row.get("launch"))
        and row.get("capability") is False
        and row.get("build_id_written") is False
        and row.get("context_minted") is False
        and row.get("scenario_body_permitted") is False
        and row.get("frozen_authority_unchanged") is True
        for key, row in results.items() if key.startswith("corr6_")
    )
    corr5_detects = all(
        row.get("classification") == "TRUSTED_NEXT_RUNTIME"
        for key, row in results.items() if key.startswith("corr5_control")
    )
    return {
        "rows": results,
        "trust_root_poisoning_rejected": corr6_ok,
        "control_accepts_poison_on_corr5": corr5_detects,
    }


def launch_matrix(base: Path) -> dict[str, Any]:
    sys.path.insert(0, str(BENCH))
    from execution_infrastructure.constants import PRELOAD_PATH
    from execution_infrastructure.frozen_next_authority import load_frozen_authority
    from execution_infrastructure.next_authority import accepted_node_executable, current_capability, launch_controlled_next

    doc = load_frozen_authority()
    files = sorted(
        item["path"] for item in doc["runtime_surface"]["entries"]
        if item["type"] == "file" and item["path"].startswith("next/")
    )
    import random

    random_pick = random.Random(611).choice(files)
    clone = base / "launch-matrix"
    clone.mkdir()
    _clone_tree(clone)
    modules = clone / "node_modules"
    origin = _origin() / "node_modules"
    profile = clone / "deny.sb"
    profile.write_text("(version 1)\n(allow default)\n(deny network*)\n", encoding="utf-8")
    rows: dict[str, Any] = {}

    def launch(**overrides: Any) -> str:
        kwargs = dict(
            replica=clone, profile_path=profile, port=9, env={"PATH": os.environ.get("PATH", "")},
            build_log=clone / "b.log", start_log=clone / "s.log", state_path=clone / "st.json",
            ledger_path=clone / "l.json", preload_path=PRELOAD_PATH,
        )
        kwargs.update(overrides)
        try:
            launch_controlled_next(**kwargs)
            return "LAUNCHED"
        except PermissionError as exc:
            return str(exc)

    cases = (
        ("picocolors_hijack", "next/dist/lib/picocolors.js"),
        ("next_server", "next/dist/server/next-server.js"),
        ("build_index", "next/dist/build/index.js"),
        ("router_server", "next/dist/server/lib/router-server.js"),
        ("next_env", "@next/env/dist/index.js"),
        ("swc_native", "@next/swc-darwin-x64/next-swc.darwin-x64.node"),
        ("random_next_file", random_pick),
    )
    for name, rel in cases:
        target = modules / rel
        original = target.read_bytes()
        if name == "picocolors_hijack":
            _replace(target, HIJACK.encode("utf-8") + original)
        elif name == "swc_native":
            data = bytearray(original)
            data[len(data) // 3] ^= 0x01
            _replace(target, bytes(data))
        else:
            _replace(target, original + b"\n/* corr6 adversarial */\n")
        result = launch()
        rows[name] = {
            "path": rel,
            "launch": result,
            "capability": current_capability() is not None,
            "build_id_written": (clone / ".next" / "BUILD_ID").exists(),
        }
        target.unlink()
        subprocess.run(["cp", "-c", str(origin / rel), str(target)], check=True)
    tampered_preload = base / "tampered-preload.cjs"
    tampered_preload.write_bytes(PRELOAD_PATH.read_bytes() + b"\n// corr6\n")
    rows["preload_tamper"] = {"launch": launch(preload_path=tampered_preload), "capability": current_capability() is not None}
    substitute = base / "node-substitute" / "node"
    substitute.parent.mkdir()
    subprocess.run(["cp", "-c", accepted_node_executable(), str(substitute)], check=True)
    rows["node_substitution"] = {"launch": launch(node_executable=substitute), "capability": current_capability() is not None}
    expected = {
        **{name: "NEXT_RUNTIME_IDENTITY_MISMATCH" for name, _rel in cases},
        "preload_tamper": "PRELOAD_IDENTITY_MISMATCH",
        "node_substitution": "NODE_EXECUTABLE_IDENTITY_MISMATCH",
    }
    passed = all(
        expected[name] in str(row.get("launch")) and row.get("capability") is False and not row.get("build_id_written")
        for name, row in rows.items()
    )
    shutil.rmtree(clone, ignore_errors=True)
    return {"rows": rows, "random_file": random_pick, "all_rejected": passed}


def main() -> int:
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(BENCH))
    from execution_infrastructure.process_hygiene import install_suite_hygiene

    install_suite_hygiene("corr6-adversarial")
    origin_before = subprocess.run(
        ["shasum", "-a", "256", str(_origin() / "node_modules/next/dist/bin/next"),
         str(_origin() / "node_modules/next/dist/lib/picocolors.js")],
        capture_output=True, text=True, check=True,
    ).stdout
    base = Path(tempfile.mkdtemp(prefix="academy-corr6-adversarial-"))
    poison = poisoning_probe(base)
    matrix = launch_matrix(base)
    origin_after = subprocess.run(
        ["shasum", "-a", "256", str(_origin() / "node_modules/next/dist/bin/next"),
         str(_origin() / "node_modules/next/dist/lib/picocolors.js")],
        capture_output=True, text=True, check=True,
    ).stdout
    from execution_infrastructure.next_runtime_identity import attest_origin_next_runtime

    origin_attestation = attest_origin_next_runtime()
    document = {
        "act": "IMPLEMENTATION-1.CORR6",
        "provider_contact": "NONE",
        "benchmark_scenarios_executed": 0,
        "base": str(base),
        "poisoning": poison,
        "launch_matrix": matrix,
        "real_origin_unchanged": origin_before == origin_after and origin_attestation["ok"] is True,
        "real_origin_classification_after": origin_attestation["classification"],
    }
    document["ok"] = bool(
        poison["trust_root_poisoning_rejected"]
        and poison["control_accepts_poison_on_corr5"]
        and matrix["all_rejected"]
        and document["real_origin_unchanged"]
    )
    target = os.environ.get("ACADEMY_CORR6_ADVERSARIAL_OUT")
    text = json.dumps(document, indent=2, sort_keys=True, default=str) + "\n"
    if target:
        Path(target).write_text(text, encoding="utf-8")
    print(text)
    return 0 if document["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
