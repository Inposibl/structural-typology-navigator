"""CORR6 regressions for the CORR5.IV1 findings.

No benchmark scenario body runs. No real provider is contacted. The real
accepted node_modules origin is never written: every tamper happens in a
copy-on-write clone under this invocation's private temporary root.
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

# MINOR-3: private temp root, own process group, and a child reaper.
from execution_infrastructure.process_hygiene import (  # noqa: E402
    hygiene_state,
    install_suite_hygiene,
    owned_processes,
    reap,
)

install_suite_hygiene("corr6")

from execution_infrastructure.attempt_binding import collected_evidence  # noqa: E402
from execution_infrastructure.constants import CHATBOT_TEST_BASE, PRELOAD_PATH  # noqa: E402
from execution_infrastructure.controlled_context import (  # noqa: E402
    REQUIRED_PROOFS,
    mint_controlled_context,
    permit_scenario_body,
    require_controlled_context,
)
from execution_infrastructure.frozen_next_authority import (  # noqa: E402
    AUTHORITY_PATH,
    AUTHORITY_SIDECAR,
    FROZEN_NEXT_RUNTIME_AUTHORITY_SHA256,
    NextAuthorityError,
    attest_node_executable,
    attest_preload,
    compare_tree,
    load_frozen_authority,
    runtime_identity_aggregate,
    sha256_file,
)
from execution_infrastructure.next_authority import (  # noqa: E402
    accepted_node_executable,
    classify_build_argv,
    controlled_child_env,
    current_capability,
    launch_controlled_next,
    refuse_persistent_artifact_root,
)
from execution_infrastructure.next_runtime_identity import (  # noqa: E402
    attest_origin_next_runtime,
    attest_replica_next_runtime,
    trusted_node_modules,
)
from execution_infrastructure import product_capability as pc  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []
TESTS: list = []
UNIT: dict = {}
NAVIGATOR_TEST_BASE = Path(
    "/Users/entp_psyche/Desktop/InvestProjects2026/"
    "test-bases/ACADEMY_TELEGRAM_LIVE_REGRESSION_1000_1/navigator"
)
FAKE_NEXT = """#!/usr/bin/env node
const fs = require("fs");
const cmd = process.argv[2];
if (cmd === "build") {
  process.stdout.write("Creating an optimized production build\\nCompiled successfully\\n");
  fs.mkdirSync(".next", { recursive: true });
  fs.writeFileSync(".next/BUILD_ID", "fake-build\\n");
  process.exit(0);
}
"""
HIJACK = "/* corr6 negative control */ try { require.cache; } catch (e) {}\n"
SECRETS = (
    "Bearer CORR6SECRETTOKEN",
    "sb_secret_corr6destination",
    "Basic Y29ycjY6c2VjcmV0",
    "sk-corr6errorvalue0000",
    "Bearer CORR6NESTED",
    "sk-corr6listelement0000",
    "sb_secret_corr6freetext",
    "Bearer CORR6FREE",
    "sk-abcdefghijklmnopqrstuvwxyz",
    "sb_secret_corr6placeholder",
)
_CLONES: dict[str, Path] = {}


def test(name: str):
    def wrap(fn):
        def run() -> None:
            started = time.monotonic()
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 — the suite records the failure
                RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
                return
            finally:
                UNIT.setdefault("timings", {})[name] = round(time.monotonic() - started, 2)
            RESULTS.append((name, True, ""))
        TESTS.append(run)
        return run
    return wrap


def _clone_navigator(prefix: str) -> Path:
    """A disposable Navigator-shaped root: cloned node_modules and package-lock."""
    root = Path(tempfile.mkdtemp(prefix=prefix))
    origin = trusted_node_modules()
    subprocess.run(["cp", "-cR", str(origin), str(root / "node_modules")], check=True)
    shutil.copy2(origin.parent / "package-lock.json", root / "package-lock.json")
    return root


def _genuine() -> Path:
    if "genuine" not in _CLONES:
        _CLONES["genuine"] = _clone_navigator("academy-corr6-genuine-")
    return _CLONES["genuine"]


def _replace(path: Path, data: bytes) -> None:
    """Break the clone sharing first. The origin file is never opened for write."""
    path.unlink()
    path.write_bytes(data)


def _launch(replica: Path, **overrides):
    profile = overrides.pop("profile_path", replica / "missing.sb")
    kwargs = dict(
        replica=replica,
        profile_path=profile,
        port=9,
        env=overrides.pop("env", {"PATH": os.environ.get("PATH", "")}),
        build_log=replica / "build.log",
        start_log=replica / "start.log",
        state_path=replica / "state.json",
        ledger_path=replica / "ledger.json",
        preload_path=overrides.pop("preload_path", PRELOAD_PATH),
    )
    kwargs.update(overrides)
    return launch_controlled_next(**kwargs)


def _expect_launch_refused(replica: Path, marker: str, **overrides) -> str:
    try:
        _launch(replica, **overrides)
    except PermissionError as exc:
        if marker not in str(exc):
            raise AssertionError(f"expected {marker}, got {exc}")
        if current_capability() is not None:
            raise AssertionError("capability minted after refusal")
        if (replica / ".next" / "BUILD_ID").exists():
            raise AssertionError("a build ran before attestation")
        return str(exc)
    raise AssertionError(f"launch accepted, expected {marker}")


def _no_context_after() -> None:
    try:
        mint_controlled_context({name: True for name in REQUIRED_PROOFS})
        raise AssertionError("context minted from boolean proofs")
    except PermissionError:
        pass
    if require_controlled_context() is not None:
        raise AssertionError("context active")
    try:
        permit_scenario_body()
        raise AssertionError("scenario body permitted")
    except PermissionError:
        pass


# ---------------------------------------------------------------------------
# MAJOR-1 / MAJOR-2 / MINOR-2: frozen Next authority
# ---------------------------------------------------------------------------

@test("CORR6.frozen_authority_is_static_pinned_and_complete")
def frozen_static() -> None:
    raw = AUTHORITY_PATH.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    sidecar = AUTHORITY_SIDECAR.read_text(encoding="utf-8").split()[0]
    if not (digest == sidecar == FROZEN_NEXT_RUNTIME_AUTHORITY_SHA256):
        raise AssertionError((digest, sidecar, FROZEN_NEXT_RUNTIME_AUTHORITY_SHA256))
    doc = load_frozen_authority()
    surface = doc["runtime_surface"]
    paths = {item["path"]: item for item in surface["entries"]}
    if surface["coverage"] != "FULL_NODE_MODULES_TREE" or surface["excluded"]:
        raise AssertionError(surface["coverage"])
    required = (
        "next/dist/lib/picocolors.js",
        "next/dist/server/next-server.js",
        "next/dist/build/index.js",
        "next/dist/server/lib/router-server.js",
        "@next/env/dist/index.js",
        "@next/swc-darwin-x64/next-swc.darwin-x64.node",
        "next/dist/bin/next",
        ".package-lock.json",
    )
    missing = [item for item in required if item not in paths]
    if missing:
        raise AssertionError(missing)
    if any(item["type"] == "symlink" and item["target"].startswith("/") for item in surface["entries"]):
        raise AssertionError("absolute symlink in frozen surface")
    if any("/Users/" in json.dumps(item) for item in surface["entries"]):
        raise AssertionError("absolute path inside a surface entry")
    lock = doc["package_lock"]
    integrity = doc["package"]["lock_integrity"]
    for key in ("node_modules/next", "node_modules/@next/env", "node_modules/@next/swc-darwin-x64"):
        if not str((integrity.get(key) or {}).get("integrity") or "").startswith("sha512-"):
            raise AssertionError(key)
    if "PROVENANCE_ONLY" not in doc["package"]["integrity_semantics"]:
        raise AssertionError("integrity semantics overstated")
    if doc["preload"]["benchmark_relative_path"] != "execution_infrastructure/node/academy-execution-preload.cjs":
        raise AssertionError(doc["preload"])
    if sha256_file(PRELOAD_PATH) != doc["preload"]["sha256"]:
        raise AssertionError("preload is not the frozen preload")
    if runtime_identity_aggregate(doc) != doc["runtime_surface_aggregate_sha256"]:
        raise AssertionError("aggregate does not recompute")
    node = doc["node_executable"]
    if not os.path.isabs(node["realpath"]) or node["sha256"] != sha256_file(node["realpath"]):
        raise AssertionError("node executable identity")
    UNIT.update({
        "frozen_next_runtime_authority_sha256": digest,
        "package_lock_sha256": lock["sha256"],
        "runtime_surface_aggregate_sha256": doc["runtime_surface_aggregate_sha256"],
        "surface_aggregate_sha256": surface["aggregate_sha256"],
        "surface_entry_count": surface["entry_count"],
        "surface_file_count": surface["file_count"],
        "surface_symlink_count": surface["symlink_count"],
        "node_executable_sha256": node["sha256"],
        "node_executable_realpath": node["realpath"],
        "preload_sha256": doc["preload"]["sha256"],
        "next_version": doc["package"]["next_version"],
        "next_authority_binds_package_lock": True,
    })


@test("CORR6.frozen_authority_is_never_regenerated_at_execution")
def never_regenerated() -> None:
    before = AUTHORITY_PATH.read_bytes()
    for name in ("next_authority.py", "next_runtime_identity.py", "orchestrator.py",
                 "frozen_next_authority.py", "startup_proofs.py", "corr6_topology.py"):
        text = (BENCH / "execution_infrastructure" / name).read_text(encoding="utf-8")
        if "freeze_next_runtime_authority" in text and name != "frozen_next_authority.py":
            raise AssertionError(f"{name} imports the one-time writer")
        if ".write_bytes(" in text and "AUTHORITY_PATH" in text:
            raise AssertionError(f"{name} writes the authority artifact")
    completed = subprocess.run(
        [sys.executable, "-B", "-m", "execution_infrastructure.freeze_next_runtime_authority",
         "--navigator-root", str(trusted_node_modules().parent), "--node", accepted_node_executable()],
        cwd=str(BENCH), capture_output=True, text=True, timeout=120, check=False,
    )
    if completed.returncode == 0 or "FROZEN_NEXT_AUTHORITY_ALREADY_EXISTS" not in completed.stdout:
        raise AssertionError(completed.stdout[-400:] + completed.stderr[-400:])
    if AUTHORITY_PATH.read_bytes() != before:
        raise AssertionError("authority bytes changed")
    tmp = Path(tempfile.mkdtemp(prefix="academy-corr6-artifact-"))
    forged = tmp / "FROZEN_NEXT_RUNTIME_AUTHORITY.json"
    doc = json.loads(before.decode("utf-8"))
    doc["runtime_surface"]["entries"][0]["sha256"] = "0" * 64
    forged_bytes = (json.dumps(doc, ensure_ascii=False, sort_keys=True, indent=1) + "\n").encode("utf-8")
    forged.write_bytes(forged_bytes)
    sidecar = tmp / "FROZEN_NEXT_RUNTIME_AUTHORITY.sha256"
    sidecar.write_text(hashlib.sha256(forged_bytes).hexdigest() + "  x\n", encoding="utf-8")
    try:
        load_frozen_authority(forged, sidecar)
        raise AssertionError("re-signed forged authority accepted")
    except NextAuthorityError as exc:
        if "PIN_MISMATCH" not in str(exc):
            raise
    sidecar.write_text("0" * 64 + "  x\n", encoding="utf-8")
    try:
        load_frozen_authority(forged, sidecar)
        raise AssertionError("sidecar mismatch accepted")
    except NextAuthorityError as exc:
        if "SIDECAR_MISMATCH" not in str(exc):
            raise
    UNIT["frozen_authority_static"] = True


@test("CORR6.identity_is_path_independent")
def path_independent() -> None:
    doc = load_frozen_authority()
    genuine = _genuine()
    result = compare_tree(genuine / "node_modules", doc)
    if result["ok"] is not True:
        raise AssertionError({k: result[k] for k in ("missing", "extra", "changed")})
    if result["observed_aggregate_sha256"] != doc["runtime_surface"]["aggregate_sha256"]:
        raise AssertionError("aggregate depends on location")
    origin = attest_origin_next_runtime()
    if origin["observed_surface_aggregate_sha256"] != result["observed_aggregate_sha256"]:
        raise AssertionError("origin and clone aggregates differ")
    if str(genuine) in json.dumps(doc) or str(trusted_node_modules()) in json.dumps(doc):
        raise AssertionError("origin or clone path inside the authority")
    UNIT["next_runtime_identity_path_independent"] = True
    UNIT["path_independence"] = {
        "origin_location": str(trusted_node_modules()),
        "clone_location": str(genuine / "node_modules"),
        "aggregate_at_both": result["observed_aggregate_sha256"],
    }


@test("CORR6.origin_is_bound_to_frozen_authority")
def origin_bound() -> None:
    origin = attest_origin_next_runtime()
    if origin["ok"] is not True or origin["classification"] != "TRUSTED_NEXT_RUNTIME":
        raise AssertionError(origin.get("mismatches"))
    if origin["frozen_authority_sha256"] != FROZEN_NEXT_RUNTIME_AUTHORITY_SHA256:
        raise AssertionError("origin attested against another authority")
    replica = attest_replica_next_runtime(_genuine())
    if replica["ok"] is not True or replica["origin_is_replica"] is not False:
        raise AssertionError(replica.get("mismatches"))
    UNIT["trusted_next_origin_bound_to_frozen_authority"] = True
    UNIT["genuine_clone_attests"] = True


@test("CORR6.trust_root_poisoning_rejected")
def poisoning() -> None:
    """Claude's A/B attack: the same fake Next in origin A and replica B."""
    import execution_infrastructure.next_runtime_identity as nri
    import execution_infrastructure.orchestrator as orchestrator

    navigator_a = _clone_navigator("academy-corr6-poison-a-")
    _replace(navigator_a / "node_modules" / "next" / "dist" / "bin" / "next", FAKE_NEXT.encode("utf-8"))
    replica_b = Path(tempfile.mkdtemp(prefix="academy-corr6-poison-b-"))
    subprocess.run(["cp", "-cR", str(navigator_a / "node_modules"), str(replica_b / "node_modules")], check=True)
    shutil.copy2(navigator_a / "package-lock.json", replica_b / "package-lock.json")
    frozen_before = AUTHORITY_PATH.read_bytes()
    origin_a = attest_origin_next_runtime(navigator_a)
    replica_b_result = attest_replica_next_runtime(replica_b)
    if origin_a["ok"] or origin_a["classification"] != "NEXT_ORIGIN_IDENTITY_MISMATCH":
        raise AssertionError("poisoned origin A attested")
    if "next/dist/bin/next" not in origin_a["changed"]:
        raise AssertionError(origin_a["changed"][:5])
    if replica_b_result["ok"] or "next/dist/bin/next" not in replica_b_result["changed"]:
        raise AssertionError("replica B inherited trust")
    saved_nav = orchestrator.NAVIGATOR
    saved_root = nri.origin_navigator_root
    orchestrator.NAVIGATOR = navigator_a
    nri.origin_navigator_root = lambda: navigator_a.resolve()
    dest = Path(tempfile.mkdtemp(prefix="academy-corr6-poison-dest-")) / "replica"
    try:
        try:
            orchestrator.build_sanitized_replica(dest)
            raise AssertionError("replica built from poisoned origin")
        except PermissionError as exc:
            if "NEXT_ORIGIN_IDENTITY_MISMATCH" not in str(exc):
                raise
        if dest.exists():
            raise AssertionError("replica directory created from poisoned origin")
        _expect_launch_refused(replica_b, "NEXT_ORIGIN_IDENTITY_MISMATCH")
    finally:
        orchestrator.NAVIGATOR = saved_nav
        nri.origin_navigator_root = saved_root
    _expect_launch_refused(replica_b, "NEXT_RUNTIME_IDENTITY_MISMATCH")
    _no_context_after()
    if AUTHORITY_PATH.read_bytes() != frozen_before:
        raise AssertionError("frozen authority changed")
    UNIT["trust_root_poisoning_rejected"] = True
    UNIT["poisoning"] = {
        "origin_a_classification": origin_a["classification"],
        "replica_b_classification": replica_b_result["classification"],
        "launch_with_poisoned_origin": "NEXT_ORIGIN_IDENTITY_MISMATCH",
        "launch_with_genuine_origin": "NEXT_RUNTIME_IDENTITY_MISMATCH",
        "build_ran": False,
        "capability_minted": False,
        "context_minted": False,
        "scenario_body_permitted": False,
    }


@test("CORR6.complete_runtime_tamper_matrix")
def tamper_matrix() -> None:
    doc = load_frozen_authority()
    files = sorted(
        item["path"] for item in doc["runtime_surface"]["entries"]
        if item["type"] == "file" and item["path"].startswith("next/")
    )
    rng = random.Random(20261003)
    random_pick = rng.choice(files)
    clone = _clone_navigator("academy-corr6-tamper-")
    modules = clone / "node_modules"
    origin = trusted_node_modules()
    cases = [
        ("picocolors_hijack", "next/dist/lib/picocolors.js", "prepend"),
        ("next_server", "next/dist/server/next-server.js", "append"),
        ("build_index", "next/dist/build/index.js", "append"),
        ("router_server", "next/dist/server/lib/router-server.js", "append"),
        ("next_env", "@next/env/dist/index.js", "append"),
        ("swc_native", "@next/swc-darwin-x64/next-swc.darwin-x64.node", "flip"),
        ("random_next_file", random_pick, "append"),
        ("added_shadow_module", "next/node_modules/react/index.js", "add"),
        ("removed_file", "next/dist/server/require-hook.js", "remove"),
        ("bin_symlink_retarget", ".bin/next", "retarget"),
    ]
    rows = {}
    for name, rel, mode in cases:
        target = modules / rel
        original = None if mode == "add" else (os.readlink(target) if target.is_symlink() else target.read_bytes())
        if mode == "prepend":
            _replace(target, HIJACK.encode("utf-8") + original)
        elif mode == "append":
            _replace(target, original + b"\n/* corr6 */\n")
        elif mode == "flip":
            data = bytearray(original)
            data[len(data) // 2] ^= 0x01
            _replace(target, bytes(data))
        elif mode == "add":
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("module.exports = {};\n", encoding="utf-8")
        elif mode == "remove":
            target.unlink()
        elif mode == "retarget":
            target.unlink()
            target.symlink_to("../next/dist/lib/picocolors.js")
        result = attest_replica_next_runtime(clone)
        detected = rel in (result["changed"] + result["extra"]) or result.get("missing_count", 0) > 0
        rows[name] = {
            "path": rel,
            "mode": mode,
            "classification": result["classification"],
            "detected_path": rel in result["changed"] + result["extra"] or mode == "remove",
            "mismatch_count": result["mismatch_count"],
        }
        if result["ok"] or not detected:
            raise AssertionError({name: rows[name]})
        if name == "picocolors_hijack":
            rows[name]["launch"] = _expect_launch_refused(clone, "NEXT_RUNTIME_IDENTITY_MISMATCH")
        if mode == "add":
            shutil.rmtree(modules / "next" / "node_modules")
        elif mode == "retarget":
            target.unlink()
            target.symlink_to(original)
        else:
            if target.exists():
                target.unlink()
            subprocess.run(["cp", "-c", str(origin / rel), str(target)], check=True)
    lock = clone / "package-lock.json"
    lock_bytes = lock.read_bytes()
    lock.write_bytes(lock_bytes.replace(b'"lockfileVersion": 3', b'"lockfileVersion": 3 ', 1))
    lock_result = attest_replica_next_runtime(clone)
    rows["package_lock"] = {"classification": lock_result["classification"], "package_lock_ok": lock_result["package_lock_ok"]}
    if lock_result["ok"] or lock_result["package_lock_ok"]:
        raise AssertionError("package-lock mutation accepted")
    lock.write_bytes(lock_bytes)
    restored = attest_replica_next_runtime(clone)
    if restored["ok"] is not True:
        raise AssertionError(("restore failed", restored["mismatches"][:5]))
    UNIT["tamper_matrix"] = rows
    UNIT["tamper_matrix_random_file"] = random_pick
    UNIT["complete_runtime_tamper_matrix_pass"] = True


@test("CORR6.preload_identity_bound")
def preload_bound() -> None:
    doc = load_frozen_authority()
    tampered = Path(tempfile.mkdtemp(prefix="academy-corr6-preload-")) / "academy-execution-preload.cjs"
    tampered.write_bytes(PRELOAD_PATH.read_bytes() + b"\n// corr6\n")
    if attest_preload(doc, PRELOAD_PATH)["ok"] is not True:
        raise AssertionError("accepted preload rejected")
    if attest_preload(doc, tampered)["ok"] is not False:
        raise AssertionError("tampered preload accepted")
    message = _expect_launch_refused(_genuine(), "PRELOAD_IDENTITY_MISMATCH", preload_path=tampered)
    env = controlled_child_env(
        {"PATH": "/tmp/evil", "NODE_OPTIONS": "--require /tmp/evil.js", "NODE_PATH": "/tmp/x",
         "DYLD_INSERT_LIBRARIES": "/tmp/x.dylib", "LD_PRELOAD": "/tmp/x.so", "KEEP": "1"},
        node=accepted_node_executable(), preload=str(PRELOAD_PATH),
    )
    if env.get("NODE_OPTIONS") != f"--require {PRELOAD_PATH}" or "NODE_PATH" in env:
        raise AssertionError(env)
    if "DYLD_INSERT_LIBRARIES" in env or "LD_PRELOAD" in env or env.get("KEEP") != "1":
        raise AssertionError(env)
    if env["PATH"].split(":")[0] != os.path.dirname(accepted_node_executable()) or "/tmp/evil" in env["PATH"]:
        raise AssertionError(env["PATH"])
    UNIT["preload_identity_bound"] = True
    UNIT["preload_launch_refusal"] = message


@test("CORR6.node_executable_identity_bound")
def node_bound() -> None:
    doc = load_frozen_authority()
    accepted = accepted_node_executable()
    if attest_node_executable(doc)["ok"] is not True:
        raise AssertionError("accepted node rejected")
    substitute_dir = Path(tempfile.mkdtemp(prefix="academy-corr6-node-"))
    substitute = substitute_dir / "node"
    subprocess.run(["cp", "-c", accepted, str(substitute)], check=True)
    if attest_node_executable(doc, substitute)["ok"] is not False:
        raise AssertionError("relocated node accepted")
    shim = substitute_dir / "shim" / "node"
    shim.parent.mkdir()
    shim.write_text("#!/bin/sh\necho SHIM\n", encoding="utf-8")
    shim.chmod(0o755)
    if attest_node_executable(doc, shim)["ok"] is not False:
        raise AssertionError("shim accepted")
    message = _expect_launch_refused(_genuine(), "NODE_EXECUTABLE_IDENTITY_MISMATCH", node_executable=substitute)
    _expect_launch_refused(_genuine(), "NODE_EXECUTABLE_IDENTITY_MISMATCH", node_executable=shim)
    _expect_launch_refused(
        _genuine(), "SANDBOX_PROFILE_MISSING",
        env={"PATH": str(shim.parent) + ":" + os.environ.get("PATH", "")},
    )
    controlled = ["sandbox-exec", "-f", "p.sb", accepted, "/r/node_modules/next/dist/bin/next", "build"]
    if classify_build_argv(controlled) != "CONTROLLED":
        raise AssertionError("accepted node argv not controlled")
    if classify_build_argv(["sandbox-exec", "-f", "p.sb", "/r/node_modules/next/dist/bin/next", "build"]) == "CONTROLLED":
        raise AssertionError("PATH-resolved shebang argv accepted")
    if classify_build_argv(["sandbox-exec", "-f", "p.sb", str(substitute), "/r/node_modules/next/dist/bin/next", "build"]) == "CONTROLLED":
        raise AssertionError("substitute node argv accepted")
    UNIT["node_executable_identity_bound"] = True
    UNIT["node_executable_substitution_rejected"] = True
    UNIT["node_launch_refusal"] = message


# ---------------------------------------------------------------------------
# MAJOR-3 / MAJOR-4: runner-owned product authority
# ---------------------------------------------------------------------------

@test("CORR6.public_self_mint_and_install_rejected")
def self_mint() -> None:
    from datetime import datetime, timezone

    from harness.factory import BINDING_TOKEN_SCHEMA_VERSION, BindingToken
    from harness.seams.sut_binding import EXPECTED_NAVIGATOR, EXPECTED_TIKHON

    pc.clear_product_authority()
    try:
        pc.mint_accepted_authority("corr6")
        raise AssertionError("self-mint accepted")
    except pc.ProductBindingRequired as exc:
        if "SELF_MINT_REJECTED" not in str(exc):
            raise
    token = BindingToken(
        schema_version=BINDING_TOKEN_SCHEMA_VERSION,
        navigator_expected=dict(EXPECTED_NAVIGATOR),
        tikhon_expected=dict(EXPECTED_TIKHON),
        navigator_root=str(NAVIGATOR_TEST_BASE),
        tikhon_root=str(CHATBOT_TEST_BASE),
        navigator_manifest_sha256=None,
        tikhon_manifest_sha256=pc.PINNED_TIKHON_MANIFEST,
        created_at_utc=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        run_id="corr6",
    )
    for label, call in (
        ("install_without_capability", lambda: pc.install_product_authority(token)),
        ("install_with_object", lambda: pc.install_product_authority(token, object())),
        ("begin_from_non_runner", lambda: pc.begin_runner_product_attempt(scenario_id="X", attempt_number=1, run_id="corr6")),
        ("register_foreign_entry", lambda: pc.register_runner_entry(self_mint.__code__)),
        ("require", lambda: pc.require_product_authority()),
    ):
        try:
            call()
            raise AssertionError(f"{label} accepted")
        except pc.ProductBindingRequired:
            pass
    if pc.authority_installed():
        raise AssertionError("authority installed")
    UNIT["public_product_authority_self_mint_rejected"] = True


def _load_scoped() -> tuple:
    root = str(CHATBOT_TEST_BASE)
    if root not in sys.path:
        sys.path.insert(0, root)
    from adapters.product import _load_package_module

    with pc.infrastructure_import_scope():
        outreach, err = _load_package_module(root, "data_engine", "outreach")
        lebedev, err2 = _load_package_module(root, "data_engine", "lebedev_adapter")
    if outreach is None or lebedev is None:
        raise AssertionError((err, err2))
    return outreach, lebedev


@test("CORR6.import_scope_and_cached_modules_cannot_execute_product")
def import_scope_cached() -> None:
    import asyncio

    from execution_infrastructure.pd_f06_isolation import install_import_guard, install_network_guard

    install_network_guard()
    install_import_guard()
    outreach, lebedev = _load_scoped()
    if not (pc.module_is_guarded(outreach) and pc.module_is_guarded(lebedev)):
        raise AssertionError("product modules not loaded through the guarded loader")
    db = Path(tempfile.mkdtemp(prefix="academy-corr6-scope-")) / "o.sqlite"
    calls = {
        "construct_in_scope": lambda: outreach.OutreachHistoryManager(db_path=db),
        "record_attempt_cached": lambda: sys.modules["data_engine.outreach"].OutreachHistoryManager.record_attempt(
            object(), 1, "u", "f", "s", "m", "SENT", None),
        "update_lead_status_cached": lambda: sys.modules["data_engine.outreach"].OutreachHistoryManager.update_lead_status(
            object(), 1, "SENT", error_message=None, sync_to_sheets=False),
        "process_user_turn_cached": lambda: asyncio.run(
            sys.modules["data_engine.lebedev_adapter"].LebedevNavigatorAdapter.process_user_turn(object(), 1, "x", 1)),
        "module_function": lambda: outreach.format_navigator_message(),
    }
    rows = {}
    with pc.infrastructure_import_scope():
        try:
            outreach.OutreachHistoryManager(db_path=db)
            rows["construct_inside_scope"] = "EXECUTED"
        except pc.ProductBindingRequired:
            rows["construct_inside_scope"] = "DENIED"
    for name, call in calls.items():
        try:
            call()
            rows[name] = "EXECUTED"
        except pc.ProductBindingRequired:
            rows[name] = "DENIED"
    if any(value != "DENIED" for value in rows.values()):
        raise AssertionError(rows)
    if db.exists():
        raise AssertionError("product side effect without authority")
    UNIT["public_import_scope_cannot_authorize_product_execution"] = True
    UNIT["cached_product_modules_require_active_authority"] = True
    UNIT["import_scope_rows"] = rows


@test("CORR6.product_code_outside_guarded_loader_is_denied")
def loader_bypass() -> None:
    import importlib.util

    path = os.path.join(str(CHATBOT_TEST_BASE), "data_engine", "outreach.py")
    rows = {}
    try:
        spec = importlib.util.spec_from_file_location("corr6_unit_copy", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # type: ignore[union-attr]
        rows["spec_from_file_location"] = "EXECUTED"
    except pc.ProductBindingRequired:
        rows["spec_from_file_location"] = "DENIED"
    with open(path, "rb") as handle:
        source = handle.read()
    try:
        exec(compile(source, "<corr6-unit>", "exec"), {"__name__": "corr6_unit"})  # noqa: S102
        rows["foreign_filename_recompile"] = "EXECUTED"
    except pc.ProductBindingRequired:
        rows["foreign_filename_recompile"] = "DENIED"
    if any(value != "DENIED" for value in rows.values()):
        raise AssertionError(rows)
    UNIT["loader_bypass_rows"] = rows


@test("CORR6.calibration_wrapper_matrix_without_authority")
def wrapper_matrix() -> None:
    import harness.runner as runner_mod
    from adapters import corr6_producers as producers
    from adapters.corr4_producers import corr4_spec
    from harness.factory import LANE_CALIBRATION

    for key in ("NAVIGATOR_TEST_ROOT", "TIKHON_TEST_ROOT"):
        os.environ.pop(key, None)
    _load_scoped()
    original = runner_mod._controlled_execution_gate
    runner_mod._controlled_execution_gate = lambda *_a, **_k: None
    registry = producers.corr6_registry()
    rows = {}
    try:
        for tag in producers.WRAPPERS:
            if tag == "kept_reference":
                producers.RESULTS["kept_class"] = sys.modules["data_engine.outreach"].OutreachHistoryManager
            outcome = runner_mod.run_scenario_once(
                corr4_spec(f"CORR6-WRAP-{tag}", "corr6_wrap_" + tag),
                run_id="corr6-wrap",
                attempt=1,
                evidence_root=tempfile.mkdtemp(prefix="academy-corr6-wrap-ev-"),
                lane=LANE_CALIBRATION,
                calibration_registry=registry,
            )
            record = (producers.RESULTS.get("wrap") or {}).get(tag) or {}
            rows[tag] = {
                "verdict": outcome.verdict.value,
                "reason": (outcome.verdict_reason or "")[:120],
                "product_returned": record.get("product_returned"),
                "denied": record.get("denied"),
                "side_effect": record.get("side_effect"),
            }
            if (
                outcome.verdict.value == "PASS"
                or record.get("product_returned")
                or record.get("side_effect")
                or "PRODUCT_BINDING_REQUIRED" not in (outcome.verdict_reason or "")
            ):
                raise AssertionError({tag: rows[tag]})
    finally:
        runner_mod._controlled_execution_gate = original
        pc.clear_product_authority()
    UNIT["calibration_cannot_wrap_product_unbound"] = True
    UNIT["wrapper_matrix_unit"] = rows


@test("CORR6.gate_bypass_does_not_grant_product_authority")
def gate_bypass_no_authority() -> None:
    import harness.runner as runner_mod
    from adapters import corr6_producers as producers
    from adapters.corr4_producers import corr4_spec
    from harness.factory import LANE_CALIBRATION

    os.environ["NAVIGATOR_TEST_ROOT"] = str(NAVIGATOR_TEST_BASE)
    os.environ["TIKHON_TEST_ROOT"] = str(CHATBOT_TEST_BASE)
    original = runner_mod._controlled_execution_gate
    runner_mod._controlled_execution_gate = lambda *_a, **_k: None
    producers.RESULTS.pop("bound_authority", None)
    try:
        outcome = runner_mod.run_scenario_once(
            corr4_spec("CORR6-NO-CONTEXT", "corr6_BoundAuthorityProbeAdapter"),
            run_id="corr6-no-context",
            attempt=1,
            evidence_root=tempfile.mkdtemp(prefix="academy-corr6-noctx-"),
            lane=LANE_CALIBRATION,
            calibration_registry=producers.corr6_registry(),
        )
    finally:
        runner_mod._controlled_execution_gate = original
        os.environ.pop("NAVIGATOR_TEST_ROOT", None)
        os.environ.pop("TIKHON_TEST_ROOT", None)
    if outcome.verdict.value != "NOT_EXECUTED" or "CONTROLLED_EXECUTION_CONTEXT_REQUIRED" not in (outcome.verdict_reason or ""):
        raise AssertionError((outcome.verdict.value, outcome.verdict_reason))
    if "bound_authority" in producers.RESULTS or outcome.adapter_invocations:
        raise AssertionError("product adapter ran without a controlled context")
    UNIT["product_authority_requires_controlled_context"] = True


@test("CORR6.physical_attestation_functions")
def physical() -> None:
    rows = {}
    chatbot = pc.attest_chatbot_physical(CHATBOT_TEST_BASE)
    navigator = pc.attest_navigator_physical(NAVIGATOR_TEST_BASE)
    if chatbot["ok"] is not True or navigator["ok"] is not True:
        raise AssertionError((chatbot["reasons"], navigator["reasons"]))
    rows["chatbot_accepted"] = chatbot["ok"]
    rows["navigator_accepted"] = navigator["ok"]
    rows["navigator_files_checked"] = navigator["files_checked"]
    drifted = Path(tempfile.mkdtemp(prefix="academy-corr6-chatbot-")) / "chatbot"
    subprocess.run(["cp", "-cR", str(CHATBOT_TEST_BASE), str(drifted)], check=True)
    target = drifted / "data_engine" / "lebedev_adapter.py"
    data = bytearray(target.read_bytes())
    data[-1] ^= 0x01
    _replace(target, bytes(data))
    drift = pc.attest_chatbot_physical(drifted)
    rows["chatbot_drifted_copy"] = drift["reasons"][:4]
    if drift["ok"] or not drift["byte_mismatch_count"]:
        raise AssertionError(drift)
    live = pc.attest_chatbot_physical(pc.LIVE_CHATBOT)
    rows["chatbot_live_root"] = live["reasons"][:3]
    if live["ok"]:
        raise AssertionError("live Chatbot accepted")
    rows["chatbot_none"] = pc.attest_chatbot_physical(None)["reasons"]
    nav_copy = Path(tempfile.mkdtemp(prefix="academy-corr6-nav-")) / "navigator"
    subprocess.run(
        ["rsync", "-a", "--exclude", "node_modules", "--exclude", ".next",
         str(NAVIGATOR_TEST_BASE) + "/", str(nav_copy) + "/"],
        check=True,
    )
    clean_copy = pc.attest_navigator_physical(nav_copy)
    rows["navigator_clean_copy"] = clean_copy["reasons"]
    if clean_copy["ok"] or "NAVIGATOR_ROOT_NOT_ACCEPTED" not in clean_copy["reasons"]:
        raise AssertionError(clean_copy)
    readme = nav_copy / "README.md"
    readme.write_bytes(readme.read_bytes() + b"\n")
    drifted_nav = pc.attest_navigator_physical(nav_copy)
    rows["navigator_drifted_copy"] = drifted_nav["reasons"]
    if "NAVIGATOR_PHYSICAL_BYTES_MISMATCH" not in drifted_nav["reasons"]:
        raise AssertionError(drifted_nav)
    pointer = Path(tempfile.mkdtemp(prefix="academy-corr6-navptr-"))
    (pointer / ".git").mkdir()
    for name in ("HEAD", "objects", "refs", "config", "packed-refs"):
        source = NAVIGATOR_TEST_BASE / ".git" / name
        if source.exists():
            (pointer / ".git" / name).symlink_to(source)
    pointed = pc.attest_navigator_physical(pointer)
    rows["navigator_metadata_points_elsewhere"] = pointed["reasons"]
    if pointed["ok"]:
        raise AssertionError(pointed)
    rows["navigator_none"] = pc.attest_navigator_physical(None)["reasons"]
    rows["navigator_wrong_root"] = pc.attest_navigator_physical(Path(tempfile.mkdtemp()))["reasons"]
    UNIT["physical_attestation"] = rows
    UNIT["chatbot_physical_bytes_required_for_product_authority"] = True


# ---------------------------------------------------------------------------
# MINOR-1: raw python_violations redaction
# ---------------------------------------------------------------------------

@test("CORR6.raw_python_violations_redacted")
def python_violations() -> None:
    import harness.runner as runner_mod
    from adapters import corr6_producers as producers
    from adapters.corr4_producers import corr4_spec
    from harness.factory import LANE_CALIBRATION

    original = runner_mod._controlled_execution_gate
    runner_mod._controlled_execution_gate = lambda *_a, **_k: None
    try:
        outcome = runner_mod.run_scenario_once(
            corr4_spec("CORR6-PYVIOL", "corr6_PythonViolationSecretsAdapter"),
            run_id="corr6-pyviol",
            attempt=1,
            evidence_root=tempfile.mkdtemp(prefix="academy-corr6-pyviol-"),
            lane=LANE_CALIBRATION,
            calibration_registry=producers.corr6_registry(),
        )
    finally:
        runner_mod._controlled_execution_gate = original
    stored = collected_evidence("CORR6-PYVIOL", 1) or {}
    violations = stored.get("python_violations") or []
    blob = json.dumps(violations, ensure_ascii=False, default=str)
    leaked = [secret for secret in SECRETS if secret in blob]
    if leaked:
        raise AssertionError(f"{len(leaked)} secret shapes survived")
    if len(violations) < 3:
        raise AssertionError(len(violations))
    synthetic = [item for item in violations if item.get("operation") == "python.synthetic"]
    if not synthetic or "nested" not in synthetic[0] or "text" not in synthetic[0]:
        raise AssertionError("redaction dropped the record instead of redacting it")
    if outcome.verdict.value == "PASS":
        raise AssertionError("python violations returned PASS")
    # Negative control: with the redaction step removed, this same check
    # must see the secrets. The control proves the check is sensitive.
    import execution_infrastructure.attempt_binding as binding

    saved = binding._safe_record
    binding._safe_record = lambda record: dict(record)
    runner_mod._controlled_execution_gate = lambda *_a, **_k: None
    try:
        runner_mod.run_scenario_once(
            corr4_spec("CORR6-PYVIOL-CONTROL", "corr6_PythonViolationSecretsAdapter"),
            run_id="corr6-pyviol-control",
            attempt=1,
            evidence_root=tempfile.mkdtemp(prefix="academy-corr6-pyviol-control-"),
            lane=LANE_CALIBRATION,
            calibration_registry=producers.corr6_registry(),
        )
    finally:
        binding._safe_record = saved
        runner_mod._controlled_execution_gate = original
    control_blob = json.dumps(
        (collected_evidence("CORR6-PYVIOL-CONTROL", 1) or {}).get("python_violations") or [],
        ensure_ascii=False, default=str,
    )
    control_leaks = sum(1 for secret in SECRETS if secret in control_blob)
    if control_leaks == 0:
        raise AssertionError("negative control did not detect unredacted storage")
    UNIT["python_violation_negative_control_leaks"] = control_leaks
    UNIT["raw_python_violations_redacted"] = True
    UNIT["python_violation_count"] = len(violations)
    UNIT["python_violation_verdict"] = outcome.verdict.value


# ---------------------------------------------------------------------------
# MINOR-3: process and state-file hygiene
# ---------------------------------------------------------------------------

@test("CORR6.child_process_reaper")
def reaper() -> None:
    keepalive = PRELOAD_PATH.parent / "corr2_preload_keepalive.cjs"
    state = Path(tempfile.mkdtemp(prefix="academy-corr6-keep-")) / "state.json"
    env = dict(os.environ, ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS="1",
               ACADEMY_EXECUTION_PRELOAD_STATE=str(state),
               ACADEMY_NODE_LEDGER_PATH=str(state.with_name("ledger.json")))
    direct = subprocess.Popen([accepted_node_executable(), str(keepalive)], env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    session = subprocess.Popen([accepted_node_executable(), str(keepalive)], env=dict(env, ACADEMY_EXECUTION_PRELOAD_STATE=str(state) + ".2"),
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    orphan_pid_file = state.with_name("orphan.pid")
    subprocess.run(
        ["/bin/sh", "-c", f'"{accepted_node_executable()}" "{keepalive}" >/dev/null 2>&1 & echo $! > "{orphan_pid_file}"'],
        env=dict(env, ACADEMY_EXECUTION_PRELOAD_STATE=str(state) + ".3"), check=True,
    )
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and not orphan_pid_file.exists():
        time.sleep(0.05)
    orphan = int(orphan_pid_file.read_text().strip())
    time.sleep(0.5)
    owned = owned_processes()
    expected = {direct.pid, session.pid, orphan}
    if not expected <= set(owned):
        raise AssertionError({"owned": owned, "expected": sorted(expected)})
    report = reap("test")
    for pid in expected:
        try:
            os.kill(pid, 0)
            alive = True
        except ProcessLookupError:
            alive = False
        if alive:
            raise AssertionError(f"pid {pid} survived")
    if report["alive_after_reap"]:
        raise AssertionError(report)
    UNIT["reaper"] = {"killed": sorted(expected), "orphan_reaped": True, "session_child_reaped": True}


@test("CORR6.state_files_are_private_and_atomic")
def state_isolation() -> None:
    state = hygiene_state()
    root = state["temp_root"]
    if not root or not tempfile.gettempdir().startswith(root) or os.environ.get("TMPDIR") != root:
        raise AssertionError(state)
    script = (
        "import json,os,subprocess,sys,time,tempfile\n"
        "sys.path.insert(0, sys.argv[1])\n"
        "from execution_infrastructure.process_hygiene import install_suite_hygiene\n"
        "info = install_suite_hygiene('corr6-concurrent')\n"
        "state = os.path.join(tempfile.mkdtemp(), 'preload-state.json')\n"
        "env = dict(os.environ, ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS='1', ACADEMY_EXECUTION_PRELOAD_STATE=state,"
        " ACADEMY_NODE_LEDGER_PATH=state + '.ledger')\n"
        "p = subprocess.Popen([sys.argv[2], sys.argv[3]], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
        "reads = errors = 0\n"
        "deadline = time.monotonic() + 8\n"
        "while time.monotonic() < deadline and reads < 400:\n"
        "    if os.path.exists(state):\n"
        "        try:\n"
        "            json.loads(open(state).read()); reads += 1\n"
        "        except json.JSONDecodeError:\n"
        "            errors += 1\n"
        "print(json.dumps({'root': info['temp_root'], 'state': state, 'reads': reads, 'json_errors': errors, 'child': p.pid}))\n"
    )
    procs = [
        subprocess.Popen(
            [sys.executable, "-B", "-c", script, str(BENCH), accepted_node_executable(),
             str(PRELOAD_PATH.parent / "corr2_preload_keepalive.cjs")],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        for _ in range(2)
    ]
    outputs = [json.loads(proc.communicate(timeout=60)[0].strip().splitlines()[-1]) for proc in procs]
    roots = {item["root"] for item in outputs}
    if len(roots) != 2 or any(item["json_errors"] for item in outputs) or any(item["reads"] < 1 for item in outputs):
        raise AssertionError(outputs)
    for item in outputs:
        if not item["state"].startswith(item["root"]):
            raise AssertionError(item)
        try:
            os.kill(int(item["child"]), 0)
            raise AssertionError(f"child {item['child']} survived its invocation")
        except ProcessLookupError:
            pass
    UNIT["concurrent_unit_probe"] = outputs
    UNIT["focused_suite_state_files_isolated"] = True


@test("CORR6.state_race_negative_control")
def state_race_control() -> None:
    """A non-atomic writer must be caught by the same reader check."""
    import threading

    target = Path(tempfile.mkdtemp(prefix="academy-corr6-race-")) / "state.json"
    body = json.dumps({"port": 12345, "pad": "x" * 4000})
    stop = threading.Event()

    def writer() -> None:
        while not stop.is_set():
            with open(target, "w", encoding="utf-8") as handle:
                handle.write(body[: len(body) // 2])
                handle.flush()
                time.sleep(0.001)
                handle.write(body[len(body) // 2:])

    thread = threading.Thread(target=writer, name="academy-harness-race-writer", daemon=True)
    thread.start()
    errors = reads = 0
    deadline = time.monotonic() + 3
    try:
        while time.monotonic() < deadline and errors == 0:
            if target.exists():
                try:
                    json.loads(target.read_text(encoding="utf-8"))
                    reads += 1
                except json.JSONDecodeError:
                    errors += 1
    finally:
        stop.set()
        thread.join(timeout=2)
    if errors == 0:
        raise AssertionError("reader check did not detect a partial write")
    UNIT["state_race_negative_control"] = {"json_errors": errors, "reads": reads}


@test("CORR6.single_product_authority_installation_path")
def single_path() -> None:
    hits = []
    for path in BENCH.rglob("*.py"):
        if "__pycache__" in path.parts or path.parts[len(BENCH.parts)] == "tests":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if "install_product_authority(" in text or "begin_runner_product_attempt(" in text:
            hits.append(str(path.relative_to(BENCH)))
    allowed = {"execution_infrastructure/product_capability.py", "harness/runner.py"}
    # The CORR6 probe adapters call both functions only inside the
    # capability-replay helper, where each call is expected to be rejected.
    negative_probe_sites = {"adapters/corr6_producers.py"}
    probes = (BENCH / "adapters" / "corr6_producers.py").read_text(encoding="utf-8")
    helper = probes.split("def _replay_rows", 1)[1].split("\nclass ", 1)[0]
    for name in ("install_product_authority(", "begin_runner_product_attempt("):
        if probes.count(name) != helper.count(name):
            raise AssertionError(f"probe adapters call {name} outside the replay helper")
    allowed |= negative_probe_sites
    if set(hits) - allowed:
        raise AssertionError(sorted(set(hits) - allowed))
    runner = (BENCH / "harness" / "runner.py").read_text(encoding="utf-8")
    once = runner.split("def run_scenario_once", 1)[1].split("\ndef _unobserved_block", 1)[0]
    begin = once.index("begin_attempt(scenario_id, attempt")
    install = once.index("install_product_authority(token, product_attempt)")
    execute = once.index("raw = adapter.execute(request)")
    if not begin < install < execute:
        raise AssertionError("authority is not installed inside the open attempt before execution")
    UNIT["single_installation_path"] = sorted(hits)


def _write_unit_proof(exit_code: int) -> None:
    raw = os.environ.get("ACADEMY_CORR6_ARTIFACT_ROOT")
    if not raw:
        return
    root = Path(raw).resolve()
    refuse_persistent_artifact_root(root)
    root.mkdir(parents=True, exist_ok=True)
    (root / "CORR6_UNIT_RESULTS.json").write_text(json.dumps({
        "act": "IMPLEMENTATION-1.CORR6",
        "exit_code": exit_code,
        "provider_contact": "NONE",
        "benchmark_scenarios_executed": 0,
        "unit": UNIT,
        "results": [{"name": name, "pass": ok, "detail": detail} for name, ok, detail in RESULTS],
    }, ensure_ascii=False, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8")


def main() -> int:
    sys.dont_write_bytecode = True
    raw_root = os.environ.get("ACADEMY_CORR6_ARTIFACT_ROOT")
    if raw_root:
        try:
            refuse_persistent_artifact_root(Path(raw_root))
        except PermissionError as exc:
            print(json.dumps({"refused": True, "reason": str(exc)}))
            return 2
    try:
        for fn in TESTS:
            fn()
    finally:
        for path in _CLONES.values():
            shutil.rmtree(path, ignore_errors=True)
    passed = sum(1 for _name, ok, _detail in RESULTS if ok)
    failed = len(RESULTS) - passed
    exit_code = 0 if failed == 0 else 1
    print(json.dumps({
        "focused_tests_total": len(RESULTS),
        "focused_tests_pass": passed,
        "focused_tests_fail": failed,
        "exit_code": exit_code,
        "provider_contact": "NONE",
        "benchmark_scenarios_executed": 0,
        "unit": UNIT,
        "results": [{"name": name, "pass": ok, "detail": detail} for name, ok, detail in RESULTS],
    }, ensure_ascii=False, indent=2, default=str))
    _write_unit_proof(exit_code)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
