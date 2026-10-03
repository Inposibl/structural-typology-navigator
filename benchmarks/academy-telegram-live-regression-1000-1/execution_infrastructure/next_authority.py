"""Orchestrator-owned Next run capability.

A caller cannot mint this object. The capability is created only when this
module launches the sandboxed next build and the sandboxed next start.
Startup proofs are accepted only while that same object is the live
capability and the process it spawned is still the process that is running.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

_SEAL = secrets.token_bytes(32)
_CURRENT: "OrchestratorRunCapability | None" = None

_BUILD_MARKERS = (
    "Creating an optimized production build",
    "Compiled successfully",
    "Collecting page data",
    "Route (app)",
    "✓ Compiled",
)
_PROTECTED_ARTIFACT_ROOTS = (
    Path("/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1"),
    Path("/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1_CORR1"),
    Path("/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1_CORR2"),
    Path("/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1_CORR3"),
    Path("/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1_CORR4"),
    Path("/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1_CORR5"),
    Path("/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1_CORR6"),
    Path("/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_CLOSURE_1_PREFLIGHT_1"),
    Path("/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_CLOSURE_1_PREFLIGHT_1_CORR2"),
)


class OrchestratorRunCapability:
    def __init__(self, seal: bytes) -> None:
        if seal is not _SEAL:
            raise PermissionError("orchestrator capability seal rejected")
        self.capability_id = secrets.token_hex(16)
        self.nonce = secrets.token_hex(16)
        self.sentinel_challenge = secrets.token_hex(32)
        self.generation = 0
        self.build_process: subprocess.CompletedProcess | None = None
        self.start_process: subprocess.Popen | None = None
        self.sandbox_pid: int | None = None
        self.node_pid: int | None = None
        self.node_lstart = ""
        self.sandbox_lstart = ""
        self.node_command = ""
        self.port = 0
        self.control_port = 0
        self.control_url = ""
        self.boot_url = ""
        self.replica = ""
        self.replica_identity = ""
        self.build_id = ""
        self.build_marker = ""
        self.next_binary = ""
        self.preload_path = ""
        self.preload_instance_id = ""
        self.ledger_instance_id = ""
        self.profile_path = ""
        self.minted = False
        self.consumed = False
        self.next_runtime_attested = False
        self.next_runtime_identity: dict[str, Any] = {}
        self.node_executable = ""

    def is_authentic(self) -> bool:
        return isinstance(self, OrchestratorRunCapability) and not self.consumed


def current_capability() -> OrchestratorRunCapability | None:
    cap = _CURRENT
    if cap is None or cap.consumed:
        return None
    return cap


def retire_current_capability() -> None:
    global _CURRENT
    cap = _CURRENT
    _CURRENT = None
    if cap is not None:
        cap.consumed = True
        cap.minted = True


def install_capability(*_args: Any, **_kwargs: Any) -> None:
    """Public installation is not authority."""
    raise PermissionError("PUBLIC_CAPABILITY_INSTALL_FORBIDDEN")


_FINAL_MANIFEST = re.compile(r"^IMPLEMENTATION_.*_MANIFEST\.json$")
_FINAL_SIDECAR = re.compile(r"^IMPLEMENTATION_.*_MANIFEST\.sha256$")


def hardcoded_artifact_root(path: Path) -> bool:
    resolved = path.resolve()
    for root in _PROTECTED_ARTIFACT_ROOTS:
        root_resolved = root.resolve()
        if resolved == root_resolved or root_resolved in resolved.parents:
            return True
    return False


def _directory_has_final_manifest(directory: Path) -> bool:
    if not directory.is_dir():
        return False
    try:
        names = [item.name for item in directory.iterdir()]
    except OSError:
        return True
    return any(_FINAL_MANIFEST.match(name) or _FINAL_SIDECAR.match(name) for name in names)


def finalized_artifact_root(path: Path) -> bool:
    """A directory that already holds an implementation manifest is claimed.

    The check looks at the directory and its parents. It does not treat a
    parent as claimed because a child directory contains a manifest.
    """
    probe = path if path.is_dir() else path.parent
    for candidate in (probe, *probe.parents):
        if _directory_has_final_manifest(candidate):
            return True
        if candidate == candidate.parent:
            break
    return False


def canonical_artifact_root(path: Path) -> bool:
    return hardcoded_artifact_root(path) or finalized_artifact_root(path)


def refuse_persistent_artifact_root(path: Path) -> None:
    """Fail closed before a focused writer can replace claimed evidence."""
    if hardcoded_artifact_root(path):
        raise PermissionError("CANONICAL_ARTIFACT_ROOT_REFUSED")
    if finalized_artifact_root(path):
        raise PermissionError("FINALIZED_ARTIFACT_ROOT_IMMUTABLE")
    if path.exists() and any(path.iterdir()):
        raise PermissionError("FINALIZED_ARTIFACT_ROOT_IMMUTABLE")


def default_focused_output_root(prefix: str = "academy-focused-") -> Path:
    """Fresh temporary root. Focused suites do not choose a canonical root."""
    return Path(tempfile.mkdtemp(prefix=prefix))


_ACCEPTED_NODE: list[str] = []


def accepted_node_executable() -> str:
    """Absolute Node path from the frozen authority. PATH is not consulted."""
    if not _ACCEPTED_NODE:
        from .frozen_next_authority import load_frozen_authority

        _ACCEPTED_NODE.append(str(load_frozen_authority()["node_executable"]["realpath"]))
    return _ACCEPTED_NODE[0]


# Variables that can load code into Node or the dynamic linker. The caller's
# values never reach the controlled Next process.
_STRIPPED_ENV_PREFIXES = ("NODE_", "DYLD_", "LD_", "NPM_CONFIG_", "npm_config_")
_SAFE_SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"


def controlled_child_env(env: dict[str, str], *, node: str, preload: str) -> dict[str, str]:
    child = {
        key: value for key, value in dict(env).items()
        if not key.startswith(_STRIPPED_ENV_PREFIXES)
    }
    child["PATH"] = os.path.dirname(node) + ":" + _SAFE_SYSTEM_PATH
    child["NODE_OPTIONS"] = f"--require {preload}"
    return child


def resolve_next_binary(replica: Path) -> Path:
    candidate = (replica / "node_modules" / "next" / "dist" / "bin" / "next").resolve()
    text = str(candidate).replace("\\", "/")
    if not candidate.is_file() or "/node_modules/next/dist/bin/next" not in text:
        raise PermissionError("NEXT_BINARY_NOT_IN_REPLICA")
    return candidate


def _is_accepted_node(value: str) -> bool:
    try:
        return os.path.realpath(value) == accepted_node_executable()
    except Exception:  # noqa: BLE001 — a missing authority is not a controlled build
        return False


def classify_build_argv(args: list[str] | tuple[str, ...] | None, next_binary: str | None = None) -> str:
    """CONTROLLED, TOKEN_ONLY, or REJECTED. Token presence is not a build.

    The controlled shape is sandbox-exec -f <profile> <accepted node>
    <replica next binary> build. The Node binary is the frozen absolute
    path, so the next entrypoint shebang and PATH are never used.
    """
    if not args:
        return "REJECTED"
    values = [str(item) for item in args]
    token = any(item == "build" or item.endswith(" build") for item in values) or "build" in values
    controlled = (
        len(values) == 6
        and values[0] == "sandbox-exec"
        and values[1] == "-f"
        and values[5] == "build"
    )
    node = values[3] if len(values) > 3 else ""
    exe = values[4] if len(values) > 4 else ""
    normalized = exe.replace("\\", "/")
    exact_binary = normalized.endswith("/node_modules/next/dist/bin/next")
    if next_binary:
        exact_binary = exact_binary and os.path.realpath(exe) == os.path.realpath(next_binary)
    if controlled and exact_binary and _is_accepted_node(node):
        return "CONTROLLED"
    if token or "build" in " ".join(values):
        return "TOKEN_ONLY"
    return "REJECTED"


def classify_start_argv(args: list[str] | tuple[str, ...] | None, next_binary: str) -> bool:
    if not args:
        return False
    values = [str(item) for item in args]
    if values[:2] != ["sandbox-exec", "-f"] or "start" not in values:
        return False
    if len(values) < 6 or not _is_accepted_node(values[3]):
        return False
    if os.path.realpath(values[4]) != os.path.realpath(next_binary) or values[5] != "start":
        return False
    if any(item.endswith("corr2_preload_keepalive.cjs") for item in values):
        return False
    return True


def _ps_field(pid: int, column: str) -> str:
    try:
        completed = subprocess.run(
            ["ps", "-p", str(int(pid)), "-ww", "-o", column + "="],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if completed.returncode != 0:
        return ""
    return (completed.stdout or "").strip()


def process_birth(pid: int) -> str:
    return _ps_field(pid, "lstart")


def process_command(pid: int) -> str:
    return _ps_field(pid, "command")


def process_ppid(pid: int) -> int:
    text = _ps_field(pid, "ppid")
    try:
        return int(text)
    except ValueError:
        return -1


def pid_descends_from(pid: int, ancestor: int, limit: int = 12) -> bool:
    current = int(pid)
    target = int(ancestor)
    seen: set[int] = set()
    for _ in range(limit):
        if current == target:
            return True
        if current in seen or current <= 1:
            return False
        seen.add(current)
        parent = process_ppid(current)
        if parent <= 0 or parent == current:
            return False
        current = parent
    return False


def command_is_owned_next(command: str, next_binary: str) -> bool:
    """The live command must be the orchestrator-spawned next start binary."""
    if not command or not next_binary:
        return False
    real = os.path.realpath(next_binary)
    if real not in command and next_binary not in command:
        return False
    padded = f" {command} "
    if " start " not in padded and not command.rstrip().endswith(" start"):
        return False
    if "corr2_preload_keepalive" in command.lower():
        return False
    first = command.split()[0] if command.split() else ""
    if "python" in os.path.basename(first).lower():
        return False
    return True


def spawned_process_is_owned_next(
    cap: OrchestratorRunCapability,
    node_pid: int,
    command: str,
    birth: str,
) -> bool:
    """Bind a live process to the pid this orchestrator actually spawned.

    Next 16 execs the sandboxed process and replaces its title with
    ``next-server (vX)``. The title is accepted only for that same pid and
    the birth marker captured at spawn. A copied title, a copied health
    JSON, or another Node process does not match.
    """
    if not birth or not command or not cap.sandbox_pid or not cap.sandbox_lstart:
        return False
    if "corr2_preload_keepalive" in command.lower():
        return False
    first = command.split()[0] if command.split() else ""
    if "python" in os.path.basename(first).lower():
        return False
    same_process = int(node_pid) == int(cap.sandbox_pid) and birth == cap.sandbox_lstart
    child = (not same_process) and pid_descends_from(int(node_pid), int(cap.sandbox_pid))
    if not same_process and not child:
        return False
    if command_is_owned_next(command, cap.next_binary):
        return True
    title = command.strip()
    return bool(same_process and title.startswith("next-server (v") and title.endswith(")"))


def _read_build_marker(log_path: Path) -> str:
    if not log_path.is_file():
        return ""
    text = log_path.read_text(encoding="utf-8", errors="replace")
    for marker in _BUILD_MARKERS:
        if marker in text:
            return marker
    return ""


def _post_json(url: str, payload: dict[str, Any], timeout: float = 10) -> tuple[int, dict[str, Any]]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8") or "{}"
        parsed = json.loads(raw)
        return response.status, parsed if isinstance(parsed, dict) else {}


def challenge_proof(challenge: str, request_nonce: str, preload_instance_id: str) -> str:
    raw = f"{challenge}:{request_nonce}:{preload_instance_id}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def launch_controlled_next(
    *,
    replica: Path,
    profile_path: Path,
    port: int,
    env: dict[str, str],
    build_log: Path,
    start_log: Path,
    state_path: Path,
    ledger_path: Path,
    preload_path: Path,
    node_executable: str | Path | None = None,
) -> OrchestratorRunCapability:
    """Launch the sandboxed build and start. The capability is not a caller argument.

    Order: frozen authority, origin attestation, replica attestation, Node
    executable, preload, then build and start. Any mismatch raises before a
    capability exists, before a build, and before a context can be minted.
    """
    global _CURRENT
    from .frozen_next_authority import (
        NextAuthorityError,
        attest_node_executable,
        attest_preload,
        load_frozen_authority,
    )
    from .next_runtime_identity import attest_origin_next_runtime, attest_replica_next_runtime

    replica = Path(replica)
    try:
        frozen = load_frozen_authority()
    except NextAuthorityError as exc:
        raise PermissionError(f"NEXT_RUNTIME_IDENTITY_MISMATCH: {exc}") from exc
    origin = attest_origin_next_runtime()
    if not origin.get("ok"):
        raise PermissionError("NEXT_ORIGIN_IDENTITY_MISMATCH")
    attestation = attest_replica_next_runtime(replica)
    if not attestation.get("ok"):
        raise PermissionError("NEXT_RUNTIME_IDENTITY_MISMATCH")
    node_check = attest_node_executable(frozen, node_executable)
    if not node_check.get("ok"):
        raise PermissionError("NODE_EXECUTABLE_IDENTITY_MISMATCH")
    preload_check = attest_preload(frozen, preload_path)
    if not preload_check.get("ok"):
        raise PermissionError("PRELOAD_IDENTITY_MISMATCH")
    node = str(node_check["realpath"])
    if _CURRENT is not None:
        retire_current_capability()
    from .startup_proofs import begin_generation, bind_orchestrator_run, note_launched

    next_binary = resolve_next_binary(replica)
    if not profile_path.is_file():
        raise PermissionError("SANDBOX_PROFILE_MISSING")
    cap = OrchestratorRunCapability(_SEAL)
    cap.next_runtime_attested = True
    cap.node_executable = node
    cap.next_runtime_identity = {
        "classification": attestation.get("classification"),
        "authority": attestation.get("authority"),
        "frozen_authority_sha256": frozen["_artifact_sha256"],
        "runtime_surface_aggregate_sha256": frozen["runtime_surface_aggregate_sha256"],
        "surface_aggregate_sha256": frozen["runtime_surface"]["aggregate_sha256"],
        "package_lock_sha256": frozen["package_lock"]["sha256"],
        "origin_classification": origin.get("classification"),
        "origin_observed_surface_aggregate_sha256": origin.get("observed_surface_aggregate_sha256"),
        "replica_observed_surface_aggregate_sha256": attestation.get("observed_surface_aggregate_sha256"),
        "replica_root": attestation.get("replica_root"),
        "origin_is_replica": attestation.get("origin_is_replica"),
        "next_version": attestation.get("next_version"),
        "file_count": attestation.get("file_count"),
        "mismatches": list(attestation.get("mismatches") or []),
        "node_executable_sha256": node_check.get("sha256"),
        "node_executable_bytes": node_check.get("bytes"),
        "preload_sha256": preload_check.get("sha256"),
        "preload_bytes": preload_check.get("bytes"),
    }
    cap.generation = begin_generation()
    cap.next_binary = str(next_binary)
    cap.preload_path = str(preload_path)
    cap.profile_path = str(profile_path)
    cap.replica = str(replica)
    cap.port = int(port)
    cap.boot_url = f"http://127.0.0.1:{int(port)}/"
    child_env = controlled_child_env(env, node=node, preload=str(preload_path))
    child_env["ACADEMY_SENTINEL_CHALLENGE"] = cap.sentinel_challenge
    _CURRENT = cap
    build_argv = ["sandbox-exec", "-f", str(profile_path), node, str(next_binary), "build"]
    if classify_build_argv(build_argv, str(next_binary)) != "CONTROLLED":
        retire_current_capability()
        raise PermissionError("BUILD_TOKEN_ONLY_REJECTED")
    build_started = time.time()
    with build_log.open("w", encoding="utf-8") as handle:
        build = subprocess.run(
            build_argv,
            cwd=str(replica),
            env=child_env,
            stdout=handle,
            stderr=subprocess.STDOUT,
            check=False,
            timeout=180,
        )
    note_launched(build)
    cap.build_process = build
    if build.returncode != 0:
        retire_current_capability()
        raise PermissionError("NEXT_BUILD_FAILED")
    marker = _read_build_marker(build_log)
    if not marker:
        retire_current_capability()
        raise PermissionError("NEXT_BUILD_OUTPUT_MARKER_MISSING")
    build_id_path = replica / ".next" / "BUILD_ID"
    if not build_id_path.is_file():
        retire_current_capability()
        raise PermissionError("NEXT_BUILD_ID_MISSING")
    build_id = build_id_path.read_text(encoding="utf-8").strip()
    if not build_id:
        retire_current_capability()
        raise PermissionError("NEXT_BUILD_ID_MISSING")
    try:
        if build_id_path.stat().st_mtime + 1 < build_started:
            retire_current_capability()
            raise PermissionError("NEXT_BUILD_ID_STALE")
    except OSError as exc:
        retire_current_capability()
        raise PermissionError("NEXT_BUILD_ID_UNREADABLE") from exc
    cap.build_id = build_id
    cap.build_marker = marker
    cap.replica_identity = hashlib.sha256(f"{replica}:{build_id}:{cap.capability_id}".encode("utf-8")).hexdigest()
    for stale in (state_path, ledger_path):
        if stale.exists():
            stale.unlink()
    start_argv = [
        "sandbox-exec", "-f", str(profile_path), node, str(next_binary),
        "start", "-H", "127.0.0.1", "-p", str(int(port)),
    ]
    if not classify_start_argv(start_argv, str(next_binary)):
        retire_current_capability()
        raise PermissionError("NEXT_START_ARGV_REJECTED")
    start_handle = start_log.open("w", encoding="utf-8")
    process = subprocess.Popen(
        start_argv,
        cwd=str(replica),
        env=child_env,
        stdout=start_handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    cap.start_process = process
    cap.sandbox_pid = int(process.pid)
    cap.sandbox_lstart = process_birth(process.pid)
    try:
        _wait_http(cap.boot_url, 40)
        state = _wait_state(state_path, 20)
        if not state:
            raise PermissionError("PRELOAD_STATE_MISSING")
        control_port = int(state["port"])
        cap.control_port = control_port
        cap.control_url = f"http://127.0.0.1:{control_port}"
        health = _get_json(cap.control_url + "/health")
        node_pid = int(health.get("pid") or 0)
        if node_pid <= 0:
            raise PermissionError("NEXT_PID_MISSING")
        cap.node_pid = node_pid
        cap.node_lstart = process_birth(node_pid)
        cap.node_command = process_command(node_pid)
        if not spawned_process_is_owned_next(cap, node_pid, cap.node_command, cap.node_lstart):
            raise PermissionError("NEXT_PROCESS_NOT_OWNED")
        bind_orchestrator_run(cap)
    except Exception:
        _stop_started(process)
        retire_current_capability()
        raise
    finally:
        start_handle.close()
    return cap


def verify_live_process(cap: OrchestratorRunCapability) -> None:
    if current_capability() is not cap or cap.consumed:
        raise PermissionError("REPLAYED_CAPABILITY_REJECTED")
    if not cap.node_pid or not cap.node_lstart or not cap.next_binary:
        raise PermissionError("REAL_NEXT_REQUIRED")
    try:
        os.kill(int(cap.node_pid), 0)
    except OSError as exc:
        raise PermissionError("registered next pid is not alive") from exc
    birth = process_birth(int(cap.node_pid))
    command = process_command(int(cap.node_pid))
    if birth != cap.node_lstart or not birth:
        raise PermissionError("NEXT_PROCESS_IDENTITY_MISMATCH")
    if not spawned_process_is_owned_next(cap, int(cap.node_pid), command, birth):
        raise PermissionError("NEXT_PROCESS_NOT_OWNED")
    if cap.start_process is None or cap.build_process is None:
        raise PermissionError("REAL_NEXT_REQUIRED")
    if classify_build_argv(cap.build_process.args, cap.next_binary) != "CONTROLLED":
        raise PermissionError("BUILD_TOKEN_ONLY_REJECTED")


def prove_live_sentinel(cap: OrchestratorRunCapability) -> dict[str, Any]:
    """Ask the owned preload to prove the challenge created inside the capability."""
    verify_live_process(cap)
    request_nonce = secrets.token_hex(16)
    status, body = _post_json(cap.control_url + "/sentinel", {"request_nonce": request_nonce})
    if status != 200 or body.get("ok") is not True:
        raise PermissionError("POST_PATCH_SENTINEL_FAILED")
    if body.get("request_nonce") != request_nonce:
        raise PermissionError("SENTINEL_NONCE_MISMATCH")
    if body.get("challenge_echo") != cap.sentinel_challenge:
        raise PermissionError("SENTINEL_CHALLENGE_MISMATCH")
    preload_id = str(body.get("preload_instance_id") or "")
    ledger_id = str(body.get("ledger_instance_id") or "")
    if not preload_id or not ledger_id:
        raise PermissionError("SENTINEL_INSTANCE_MISSING")
    expected = challenge_proof(cap.sentinel_challenge, request_nonce, preload_id)
    if body.get("challenge_proof") != expected:
        raise PermissionError("SENTINEL_PROOF_MISMATCH")
    if int(body.get("pid") or -1) != int(cap.node_pid or -2):
        raise PermissionError("SENTINEL_PID_MISMATCH")
    if body.get("interposer_current") is not True or body.get("fetch_is_current") is not True:
        raise PermissionError("SENTINEL_INTERPOSER_NOT_CURRENT")
    if str(body.get("harness_sentinel") or "") == "CORR2-SENTINEL-1" and body.get("challenge_proof") != expected:
        raise PermissionError("FAKE_SENTINEL_REJECTED")
    if cap.preload_instance_id and cap.preload_instance_id != preload_id:
        raise PermissionError("PRELOAD_INSTANCE_MISMATCH")
    if cap.ledger_instance_id and cap.ledger_instance_id != ledger_id:
        raise PermissionError("LEDGER_INSTANCE_MISMATCH")
    cap.preload_instance_id = preload_id
    cap.ledger_instance_id = ledger_id
    body["challenge_proof_ok"] = True
    return body


def issue_controlled_proofs(cap: OrchestratorRunCapability, loopback: Any) -> dict[str, Any]:
    """Issue proofs for the live capability. Public registration cannot do this."""
    from .startup_proofs import (
        prove_lifecycle,
        prove_loopback,
        prove_next_build_and_start,
        prove_node_from_control,
        prove_os_f04,
        prove_provider_observer,
        prove_python_isolation,
        set_issuing_capability,
    )

    if current_capability() is not cap:
        raise PermissionError("REAL_NEXT_REQUIRED")
    verify_live_process(cap)
    set_issuing_capability(cap)
    try:
        _post_json(cap.control_url + "/bind-run", {"generation": cap.generation, "nonce": cap.nonce})
        proofs = {
            "PYTHON_ISOLATION_ACTIVE": prove_python_isolation(),
            "OS_F04_PROCESS_STREAM_CAPTURE_ACTIVE": prove_os_f04(),
            "PD_F06_LIFECYCLE_ACTIVE": prove_lifecycle(),
            "PD_F04_ATTEMPT_OBSERVER_ACTIVE": prove_provider_observer(),
            "SUPABASE_LOOPBACK_ACTIVE": prove_loopback(loopback),
            "CONTROLLED_NEXT_MODE": prove_next_build_and_start(
                cap.build_process,
                cap.boot_url,
                next_pid=cap.node_pid,
                server_port=cap.port,
                build_id=cap.build_id,
                replica_identity=cap.replica_identity,
                control_url=cap.control_url,
            ),
        }
        proofs.update(prove_node_from_control(cap.control_url))
        return proofs
    finally:
        set_issuing_capability(None)


def _get_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=5) as response:
        parsed = json.loads(response.read().decode("utf-8") or "{}")
        return parsed if isinstance(parsed, dict) else {}


def _wait_http(url: str, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    last = "not-started"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return
        except Exception as exc:  # noqa: BLE001
            code = getattr(exc, "code", None)
            if isinstance(code, int):
                return
            last = f"{type(exc).__name__}: {exc}"
        time.sleep(0.2)
    raise PermissionError("NEXT_START_UNREACHABLE: " + last)


def _wait_state(path: Path, seconds: float) -> dict[str, Any] | None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if path.exists():
            try:
                parsed = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict) and parsed.get("port"):
                return parsed
        time.sleep(0.1)
    return None


def _stop_started(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, 15)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, 9)
        except ProcessLookupError:
            return
        process.wait(timeout=5)
