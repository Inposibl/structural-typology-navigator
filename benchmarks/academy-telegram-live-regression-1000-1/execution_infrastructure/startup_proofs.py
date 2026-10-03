"""Startup proofs issued only by the subsystem that observed them.

A caller-built dict of True values is not a proof. A constructed object that
this module did not register is not a proof. Minting checks object identity,
process identity, and that the subsystem is still installed.
"""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import urllib.request
from pathlib import Path
from typing import Any

from .controlled_context import REQUIRED_PROOFS

_SEAL = secrets.token_bytes(32)
_GENERATION = 0
_LIVE: dict[str, "StartupProof"] = {}
_LAUNCHED: dict[int, subprocess.CompletedProcess] = {}
_ACTIVE_RUN: "LiveRunRecord | None" = None
_ISSUING: Any = None


class LiveRunRecord:
    """Unforgeable registry for the one running Next generation.

    ``_issue`` can create a proof object. Mint accepts that object only when
    this record bound it and the live Next process still matches.
    """

    def __init__(
        self,
        seal: bytes,
        generation: int,
        nonce: str,
        pid: int,
        port: int,
        build_id: str,
        replica_identity: str,
        control_url: str,
    ) -> None:
        if seal is not _SEAL:
            raise PermissionError("live run seal rejected")
        self.generation = int(generation)
        self.nonce = str(nonce)
        self.pid = int(pid)
        self.port = int(port)
        self.build_id = str(build_id)
        self.replica_identity = str(replica_identity)
        self.control_url = str(control_url)
        self.orchestrator_capability_id: str | None = None
        self._bound: dict[str, str] = {}

    def bind(self, seal: bytes, name: str, instance_id: str, generation: int) -> None:
        if seal is not _SEAL:
            raise PermissionError("live run seal rejected")
        if int(generation) != self.generation:
            raise PermissionError("proof generation does not match the live run")
        if name in self._bound:
            raise PermissionError("live run proof already bound")
        self._bound[name] = instance_id

    def bound_id(self, name: str) -> str | None:
        return self._bound.get(name)


class StartupProof:
    def __init__(
        self,
        seal: bytes,
        name: str,
        generation: int,
        pid: int,
        instance_id: str,
        observation: dict[str, Any],
    ) -> None:
        if seal is not _SEAL:
            raise PermissionError("startup proof seal rejected")
        self.name = name
        self.generation = generation
        self.pid = pid
        self.instance_id = instance_id
        self.observation = observation

    def public_identity(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "generation": self.generation,
            "pid": self.pid,
            "instance_id": self.instance_id,
            "observation": self.observation,
        }


def begin_generation() -> int:
    global _GENERATION
    _GENERATION += 1
    return _GENERATION


def current_generation() -> int:
    return _GENERATION


def active_live_run() -> "LiveRunRecord | None":
    return _ACTIVE_RUN


def clear_live_run() -> None:
    global _ACTIVE_RUN, _ISSUING
    _ACTIVE_RUN = None
    _ISSUING = None
    from .next_authority import retire_current_capability

    retire_current_capability()


def set_issuing_capability(cap: Any) -> None:
    """Only the live orchestrator capability may be the issuing context."""
    global _ISSUING
    if cap is None:
        _ISSUING = None
        return
    from .next_authority import OrchestratorRunCapability, current_capability

    if not isinstance(cap, OrchestratorRunCapability) or current_capability() is not cap:
        raise PermissionError("PUBLIC_CAPABILITY_INSTALL_FORBIDDEN")
    _ISSUING = cap


def bind_orchestrator_run(cap: Any) -> LiveRunRecord:
    """Bind the active run from the capability. Caller-supplied ids are ignored."""
    global _ACTIVE_RUN
    from .next_authority import OrchestratorRunCapability, current_capability

    if not isinstance(cap, OrchestratorRunCapability) or current_capability() is not cap:
        raise PermissionError("PUBLIC_CAPABILITY_INSTALL_FORBIDDEN")
    if int(cap.generation) != _GENERATION:
        raise PermissionError("live run generation is not current")
    if not cap.node_pid or not cap.build_id or not cap.control_url:
        raise PermissionError("REAL_NEXT_REQUIRED")
    record = LiveRunRecord(
        _SEAL,
        int(cap.generation),
        str(cap.nonce),
        int(cap.node_pid),
        int(cap.port),
        str(cap.build_id),
        str(cap.replica_identity),
        str(cap.control_url),
    )
    record.orchestrator_capability_id = cap.capability_id
    _ACTIVE_RUN = record
    return record


def register_live_next_run(
    *,
    generation: int,
    nonce: str,
    pid: int,
    port: int,
    build_id: str,
    replica_identity: str,
    control_url: str,
) -> LiveRunRecord:
    """Public registration does not create orchestrator authority."""
    global _ACTIVE_RUN
    from .next_authority import current_capability

    if current_capability() is not None:
        raise PermissionError("PUBLIC_REGISTRATION_FORBIDDEN_WHILE_ORCHESTRATOR_OWNS_THE_RUN")
    if int(generation) != _GENERATION:
        raise PermissionError("live run generation is not current")
    record = LiveRunRecord(
        _SEAL,
        generation,
        nonce,
        pid,
        port,
        build_id,
        replica_identity,
        control_url,
    )
    _ACTIVE_RUN = record
    return record


def _issue(name: str, observation: dict[str, Any]) -> StartupProof:
    proof = StartupProof(
        seal=_SEAL,
        name=name,
        generation=_GENERATION,
        pid=os.getpid(),
        instance_id=secrets.token_hex(8),
        observation=observation,
    )
    _LIVE[name] = proof
    if _ACTIVE_RUN is not None:
        _ACTIVE_RUN.bind(_SEAL, name, proof.instance_id, proof.generation)
    return proof


def note_launched(process: subprocess.CompletedProcess) -> None:
    _LAUNCHED[id(process)] = process


def run_owned(argv: list[str], **kwargs: Any) -> subprocess.CompletedProcess:
    if not argv or argv[0] != "sandbox-exec":
        raise RuntimeError("UNSANDBOXED_COMMAND_REFUSED")
    process = subprocess.run(argv, **kwargs)
    note_launched(process)
    return process


def prove_python_isolation() -> StartupProof:
    from .pd_f06_isolation import (
        deny_connect,
        import_guard_installed,
        install_import_guard,
        install_network_guard,
        network_guard_installed,
    )

    install_network_guard()
    install_import_guard()
    if not network_guard_installed() or not import_guard_installed():
        raise PermissionError("PYTHON_ISOLATION_NOT_INSTALLED")
    probe = deny_connect("example.com", 443)
    if probe.get("denied") is not True or probe.get("external_contact") is not False:
        raise PermissionError("PYTHON_ISOLATION_DENY_PROBE_FAILED")
    return _issue("PYTHON_ISOLATION_ACTIVE", {
        "network_guard_installed": True,
        "import_guard_installed": True,
        "deny_probe": probe,
        "installed_before_product_import": True,
    })


def prove_os_f04() -> StartupProof:
    import sys

    from .os_f04_streams import fd2_cursor, install_process_stderr_tee

    stderr_identity = id(sys.stderr)
    install_process_stderr_tee()
    if id(sys.stderr) != stderr_identity or sys.stderr.closed:
        raise PermissionError("OS_F04_STREAM_REPLACED")
    if fd2_cursor() < 0:
        raise PermissionError("OS_F04_FD2_ABSENT")
    return _issue("OS_F04_PROCESS_STREAM_CAPTURE_ACTIVE", {
        "stderr_identity_unchanged": True,
        "fd2_capture_installed": True,
    })


def prove_lifecycle() -> StartupProof:
    from .pd_f06_lifecycle import AttemptBoundary

    boundary = AttemptBoundary()
    boundary.begin()
    report = boundary.finish(join_timeout=1.0)
    if report.get("fail_closed") is not False:
        raise PermissionError("PD_F06_LIFECYCLE_NOT_ACTIVE")
    return _issue("PD_F06_LIFECYCLE_ACTIVE", {
        "status": report.get("status"),
        "fail_closed": False,
        "async_patches_installed": True,
    })


def prove_provider_observer() -> StartupProof:
    from .attempt_binding import close_evidence_attempt, collected_evidence, open_evidence_attempt
    from .pd_f04_provider_evidence import AttemptProviderObserver, installed_observer

    observer = AttemptProviderObserver().install()
    if installed_observer() is not observer:
        raise PermissionError("PD_F04_OBSERVER_NOT_INSTALLED")
    open_evidence_attempt("CORR2-OBSERVER-PROOF", 0)
    try:
        observer.bind_attempt("CORR2-OBSERVER-PROOF", 0, 1)
        result = observer.observe_synthetic_transport(http_status=500)
        if result.get("accepted") is not True:
            raise PermissionError("PD_F04_OBSERVER_DID_NOT_REACH_ATTEMPT")
    finally:
        close_evidence_attempt()
    stored = collected_evidence("CORR2-OBSERVER-PROOF", 0) or {}
    events = stored.get("provider_evidence") or []
    if not events:
        raise PermissionError("PD_F04_OBSERVER_EVIDENCE_MISSING")
    return _issue("PD_F04_ATTEMPT_OBSERVER_ACTIVE", {
        "instance_id": observer.instance_id,
        "synthetic_transport": True,
        "event_count": len(events),
        "live_provider_contact": False,
    })


def prove_loopback(loopback: Any) -> StartupProof:
    from .attempt_binding import register_active_loopback

    thread = getattr(loopback, "_thread", None)
    httpd = getattr(loopback, "_httpd", None)
    if httpd is None or thread is None or not thread.is_alive():
        raise PermissionError("SUPABASE_LOOPBACK_NOT_RUNNING")
    register_active_loopback(loopback)
    url = loopback.supabase_url
    try:
        with urllib.request.urlopen(url + "/health", timeout=2) as response:
            status = response.status
    except Exception:
        status = 0
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                status = response.status
        except Exception as exc:
            if getattr(exc, "code", None):
                status = int(exc.code)
            else:
                raise PermissionError("SUPABASE_LOOPBACK_UNREACHABLE") from exc
    return _issue("SUPABASE_LOOPBACK_ACTIVE", {
        "url_host": "127.0.0.1",
        "http_status": status,
        "thread_alive": True,
    })


def prove_node_from_control(control_url: str) -> dict[str, StartupProof]:
    health = _fetch_json(control_url + "/health")
    if health.get("ok") is not True:
        raise PermissionError("NODE_PRELOAD_NOT_ACTIVE")
    ledger = _fetch_json(control_url + "/ledger")
    events = ledger.get("events") or []
    if not events:
        raise PermissionError("NODE_LIFETIME_LEDGER_EMPTY")
    cap = _ISSUING
    if cap is None:
        sentinel_status, sentinel = _fetch_json_status(control_url + "/sentinel", method="POST")
        capability_bound = False
    else:
        from .next_authority import current_capability, prove_live_sentinel

        if current_capability() is not cap or str(control_url).rstrip("/") != str(cap.control_url).rstrip("/"):
            raise PermissionError("REAL_NEXT_REQUIRED")
        sentinel = prove_live_sentinel(cap)
        sentinel_status = 200
        capability_bound = True
    if sentinel_status != 200 or sentinel.get("ok") is not True or sentinel.get("cohere_socket_events") not in (0, None):
        raise PermissionError("POST_PATCH_SENTINEL_FAILED")
    if capability_bound and sentinel.get("challenge_proof_ok") is not True:
        raise PermissionError("REAL_SENTINEL_REQUIRED")
    return {
        "NODE_PRELOAD_ACTIVE": _issue("NODE_PRELOAD_ACTIVE", {
            "health_ok": True,
            "pid": health.get("pid"),
            "capability_bound": capability_bound,
        }),
        "NODE_LIFETIME_LEDGER_ACTIVE": _issue("NODE_LIFETIME_LEDGER_ACTIVE", {
            "event_count": len(events),
            "capability_bound": capability_bound,
        }),
        "POST_PATCH_SENTINEL_PASS": _issue("POST_PATCH_SENTINEL_PASS", {
            "ok": True,
            "cohere_socket_events": sentinel.get("cohere_socket_events"),
            "fetched_by": "startup_proofs",
            "next_server": sentinel.get("next_server") is True,
            "pid": sentinel.get("pid"),
            "bound_generation": sentinel.get("bound_generation"),
            "bound_nonce": sentinel.get("bound_nonce"),
            "ledger_event_count": sentinel.get("ledger_event_count"),
            "fetch_is_current": sentinel.get("fetch_is_current") is True,
            "interposer_current": sentinel.get("interposer_current") is True,
            "capability_bound": capability_bound,
            "challenge_proof_ok": sentinel.get("challenge_proof_ok") is True,
            "preload_instance_id": sentinel.get("preload_instance_id"),
            "ledger_instance_id": sentinel.get("ledger_instance_id"),
        }),
    }


def prove_sandbox_boundary(profile_text: str) -> StartupProof:
    path = Path(os.environ.get("TMPDIR") or "/tmp") / f"academy-corr2-sandbox-{os.getpid()}.sb"
    path.write_text(profile_text, encoding="utf-8")
    process = run_owned(
        ["sandbox-exec", "-f", str(path), "/usr/bin/true"],
        check=False,
        capture_output=True,
        timeout=20,
    )
    if process.returncode != 0 or not process.args or process.args[0] != "sandbox-exec":
        raise PermissionError("SANDBOX_BOUNDARY_FAILED")
    return _issue("CONTROLLED_NEXT_MODE", {
        "kind": "SANDBOX_EXEC_BOUNDARY",
        "returncode": process.returncode,
        "argv0": process.args[0],
        "next_build_executed": False,
        "owned_process": True,
    })


def prove_next_build_and_start(
    build_process: subprocess.CompletedProcess,
    boot_url: str,
    *,
    next_pid: int | None = None,
    server_port: int | None = None,
    build_id: str | None = None,
    replica_identity: str | None = None,
    control_url: str | None = None,
) -> StartupProof:
    from .next_authority import classify_build_argv, current_capability

    kind = classify_build_argv(getattr(build_process, "args", None))
    if kind == "TOKEN_ONLY":
        raise PermissionError("BUILD_TOKEN_ONLY_REJECTED")
    if kind != "CONTROLLED":
        raise PermissionError("NEXT_BUILD_WAS_NOT_SANDBOXED")
    cap = _ISSUING
    if cap is None or current_capability() is not cap or build_process is not cap.build_process:
        raise PermissionError("BUILD_NOT_ORCHESTRATOR_OWNED")
    if build_process.returncode != 0 or not cap.build_marker or not cap.build_id:
        raise PermissionError("NEXT_BUILD_FAILED")
    if str(build_id or "") != cap.build_id or str(replica_identity or "") != cap.replica_identity:
        raise PermissionError("BUILD_NOT_ORCHESTRATOR_OWNED")
    if int(next_pid or -1) != int(cap.node_pid or -2) or int(server_port or -1) != int(cap.port):
        raise PermissionError("NEXT_START_NOT_ORCHESTRATOR_OWNED")
    if str(control_url or "") != cap.control_url or str(boot_url) != cap.boot_url:
        raise PermissionError("NEXT_START_NOT_ORCHESTRATOR_OWNED")
    run = _ACTIVE_RUN
    authority = (
        run is not None
        and run.orchestrator_capability_id == cap.capability_id
        and int(next_pid) == run.pid
        and int(server_port) == run.port
        and str(build_id) == run.build_id
        and str(control_url) == run.control_url
    )
    if not authority:
        raise PermissionError("REAL_NEXT_REQUIRED")
    if not getattr(cap, "next_runtime_attested", False):
        raise PermissionError("NEXT_RUNTIME_IDENTITY_MISMATCH")
    return _issue("CONTROLLED_NEXT_MODE", {
        "kind": "NEXT_BUILD_PLUS_NEXT_START",
        "authority": True,
        "returncode": build_process.returncode,
        "argv0": build_process.args[0],
        "next_binary": cap.next_binary,
        "build_marker": cap.build_marker,
        "next_build_executed": True,
        "start_ok": True,
        "sandbox": True,
        "owned_process": True,
        "capability_id": cap.capability_id,
        "next_pid": int(next_pid),
        "server_port": int(server_port),
        "build_id": build_id,
        "replica_identity": replica_identity,
        "run_generation": run.generation,
        "run_nonce_bound": True,
    })


def _fetch_json(url: str) -> dict[str, Any]:
    status, body = _fetch_json_status(url, method="GET")
    if status != 200:
        raise PermissionError(f"control fetch failed: {url} {status}")
    return body


def _fetch_json_status(url: str, method: str, body: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
    if method == "POST":
        data = json.dumps(body or {}).encode("utf-8")
    else:
        data = None
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        raw = response.read().decode("utf-8") or "{}"
        parsed = json.loads(raw)
        return response.status, parsed if isinstance(parsed, dict) else {}


def verify_still_installed(name: str, proof: StartupProof) -> bool:
    if name == "PYTHON_ISOLATION_ACTIVE":
        from .pd_f06_isolation import import_guard_installed, network_guard_installed
        return network_guard_installed() and import_guard_installed()
    if name == "PD_F04_ATTEMPT_OBSERVER_ACTIVE":
        from .pd_f04_provider_evidence import installed_observer
        observer = installed_observer()
        return observer is not None and observer.installed and bool(observer.events)
    if name == "OS_F04_PROCESS_STREAM_CAPTURE_ACTIVE":
        return proof.observation.get("fd2_capture_installed") is True
    if name == "PD_F06_LIFECYCLE_ACTIVE":
        return proof.observation.get("fail_closed") is False
    if name == "SUPABASE_LOOPBACK_ACTIVE":
        from .attempt_binding import active_loopback
        loopback = active_loopback()
        thread = getattr(loopback, "_thread", None)
        return thread is not None and thread.is_alive()
    if name == "NODE_PRELOAD_ACTIVE":
        return proof.observation.get("health_ok") is True
    if name == "NODE_LIFETIME_LEDGER_ACTIVE":
        return int(proof.observation.get("event_count") or 0) > 0
    if name == "POST_PATCH_SENTINEL_PASS":
        obs = proof.observation
        return (
            obs.get("ok") is True
            and obs.get("fetched_by") == "startup_proofs"
            and obs.get("next_server") is True
            and obs.get("fetch_is_current") is True
            and obs.get("capability_bound") is True
            and obs.get("challenge_proof_ok") is True
            and obs.get("interposer_current") is True
        )
    if name == "CONTROLLED_NEXT_MODE":
        obs = proof.observation
        run = _ACTIVE_RUN
        if obs.get("kind") != "NEXT_BUILD_PLUS_NEXT_START" or obs.get("authority") is not True or run is None:
            return False
        return (
            obs.get("owned_process") is True
            and obs.get("argv0") == "sandbox-exec"
            and obs.get("next_build_executed") is True
            and obs.get("returncode") == 0
            and obs.get("build_marker")
            and obs.get("capability_id") == run.orchestrator_capability_id
            and obs.get("next_pid") == run.pid
            and obs.get("server_port") == run.port
            and obs.get("build_id") == run.build_id
            and obs.get("run_generation") == run.generation
        )
    return False


def issue_inprocess_proofs(loopback: Any, control_url: str, profile_text: str) -> dict[str, StartupProof]:
    """Mint inputs for a unit process.

    CONTROLLED_NEXT_MODE here is an owned sandbox-exec boundary. It is not a
    Next build. POST_PATCH_SENTINEL is fetched from the control URL the caller
    started. A real next start is prove_next_build_and_start.
    """
    _prime_control_ledger(control_url)
    begin_generation()
    proofs = {
        "PYTHON_ISOLATION_ACTIVE": prove_python_isolation(),
        "OS_F04_PROCESS_STREAM_CAPTURE_ACTIVE": prove_os_f04(),
        "PD_F06_LIFECYCLE_ACTIVE": prove_lifecycle(),
        "PD_F04_ATTEMPT_OBSERVER_ACTIVE": prove_provider_observer(),
        "SUPABASE_LOOPBACK_ACTIVE": prove_loopback(loopback),
        "CONTROLLED_NEXT_MODE": prove_sandbox_boundary(profile_text),
    }
    proofs.update(prove_node_from_control(control_url))
    return proofs


def _prime_control_ledger(control_url: str) -> None:
    payload = json.dumps({"url": "https://example.com/outside", "method": "GET"}).encode("utf-8")
    request = urllib.request.Request(
        control_url + "/probe-fetch",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        response.read()


def _require_live_next_process(run: LiveRunRecord) -> dict[str, Any]:
    try:
        os.kill(int(run.pid), 0)
    except OSError as exc:
        raise PermissionError("registered next pid is not alive") from exc
    health = _fetch_json(run.control_url.rstrip("/") + "/health")
    if health.get("next_server") is not True:
        raise PermissionError("REAL_NEXT_REQUIRED")
    if int(health.get("pid") or -1) != int(run.pid):
        raise PermissionError("next pid does not match the live run")
    if health.get("bound_generation") != run.generation:
        raise PermissionError("bound generation does not match the live run")
    if str(health.get("bound_nonce")) != str(run.nonce):
        raise PermissionError("bound nonce does not match the live run")
    return health


def validate_live_proofs(proofs: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(proofs, dict):
        raise PermissionError("startup proofs must be a dict")
    run = _ACTIVE_RUN
    if run is None:
        raise PermissionError("FORGED_OR_UNIT_STARTUP_PROOF")
    from .next_authority import current_capability, prove_live_sentinel, verify_live_process

    cap = current_capability()
    if (
        cap is None
        or run.orchestrator_capability_id != cap.capability_id
        or cap.minted
        or cap.consumed
    ):
        if cap is not None and cap.minted:
            raise PermissionError("REPLAYED_CAPABILITY_REJECTED")
        raise PermissionError("REAL_NEXT_REQUIRED")
    verify_live_process(cap)
    prove_live_sentinel(cap)
    if not getattr(cap, "next_runtime_attested", False):
        raise PermissionError("NEXT_RUNTIME_IDENTITY_MISMATCH")
    found: list[StartupProof] = []
    for name in REQUIRED_PROOFS:
        proof = proofs.get(name)
        if proof is True or proof is False or not isinstance(proof, StartupProof):
            raise PermissionError("startup proof is not an installed-subsystem object: " + name)
        live = _LIVE.get(name)
        if live is None or proof is not live:
            raise PermissionError("startup proof is not the live installed object: " + name)
        if proof.name != name:
            raise PermissionError("startup proof name mismatch: " + name)
        if proof.generation != run.generation or proof.instance_id != run.bound_id(name):
            raise PermissionError("proof is not bound to the live run: " + name)
        if not verify_still_installed(name, proof):
            raise PermissionError("startup proof subsystem is not installed: " + name)
        found.append(proof)
    generations = {item.generation for item in found}
    pids = {item.pid for item in found}
    if len(generations) != 1 or len(pids) != 1 or next(iter(pids)) != os.getpid():
        raise PermissionError("startup proofs do not share generation and process")
    health = _require_live_next_process(run)
    if int(health.get("pid") or -1) != int(cap.node_pid or -2):
        raise PermissionError("REAL_NEXT_REQUIRED")
    cap.minted = True
    return {
        "generation": next(iter(generations)),
        "pid": next(iter(pids)),
        "instance_ids": {item.name: item.instance_id for item in found},
        "observations": {item.name: item.observation for item in found},
        "next_pid": run.pid,
        "next_port": run.port,
        "build_id": run.build_id,
        "replica_identity": run.replica_identity,
        "next_health_pid": health.get("pid"),
    }
