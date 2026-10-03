"""CORR3 regressions for the CORR2.IV1 producer-to-verdict findings.

No benchmark scenario body runs. No real provider is contacted.
The Next topology runs only when ACADEMY_CORR3_TOPOLOGY=1.
CORR3_UNIT_ONLY=1 skips that topology.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import urllib.request
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
NAVIGATOR = BENCH.parent.parent
sys.path.insert(0, str(BENCH))

# CORR6 MINOR-3: private temp root, own process group, and a child reaper.
from execution_infrastructure.process_hygiene import install_suite_hygiene  # noqa: E402

install_suite_hygiene("corr3")

from adapters.product import arm_native_chat_transport  # noqa: E402
from execution_infrastructure.attempt_binding import (  # noqa: E402
    arm_request_identity,
    begin_attempt,
    collected_evidence,
    close_evidence_attempt,
    disarm_request_identity,
    finish_attempt,
    open_evidence_attempt,
    publish_provider_evidence,
    register_active_loopback,
)
from execution_infrastructure.constants import PRELOAD_PATH, SUPABASE_SECRET_PLACEHOLDER  # noqa: E402
from execution_infrastructure.controlled_context import (  # noqa: E402
    REQUIRED_PROOFS,
    clear_controlled_context,
    mint_controlled_context,
    permit_scenario_body,
    require_controlled_context,
)
from execution_infrastructure.corr3_topology import ARTIFACT_ROOT  # noqa: E402
from execution_infrastructure.pd_f04_provider_evidence import (  # noqa: E402
    aggregate_attempt_evidence,
    normalize_provider_event,
)
from execution_infrastructure.pd_f05_loopback import LoopbackSupabaseDouble  # noqa: E402
from execution_infrastructure.pd_f06_isolation import install_import_guard  # noqa: E402
from execution_infrastructure.pd_f06_lifecycle import AttemptBoundary, _accurate_status  # noqa: E402
from execution_infrastructure.producer_registry import PRODUCERS, handoff_for  # noqa: E402
from execution_infrastructure.startup_proofs import (  # noqa: E402
    _issue,
    begin_generation,
    clear_live_run,
    current_generation,
    issue_inprocess_proofs,
    register_live_next_run,
)
from harness.runner import run_scenario_once  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []
TESTS: list = []
ASYNC_PROOF: dict = {}
NETWORK_UNIT: dict = {}
PROFILE = (
    "(version 1)\n(allow default)\n(deny network*)\n"
    "(allow network-outbound (remote ip \"localhost:*\"))\n"
    "(allow network-inbound (local ip \"localhost:*\"))\n"
    "(allow network-bind (local ip \"localhost:*\"))\n"
)
REAL_LOCAL_IDS = {
    "D-0003", "D-0004", "D-0005", "D-0102", "D-0103", "D-0104", "D-0105",
    "D-0106", "D-0107", "D-0108", "D-0109", "D-0114", "D-0115", "D-0116",
    "D-0117", "D-0118", "D-0126", "D-0132",
}
SECRET_MARKERS = (
    "sb_secret_benchmark_placeholder",
    "Bearer raw-token-value",
    "sk-abcdefghijklmnopqrstuvwxyz",
    "Basic dXNlcjpwYXNz",
)


def test(name: str):
    def decorate(fn):
        def wrapped() -> None:
            try:
                fn()
                RESULTS.append((name, True, ""))
            except Exception as exc:  # noqa: BLE001
                RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
        TESTS.append(wrapped)
        return wrapped
    return decorate


def _python() -> str:
    return sys.executable


def _run_snippet(source: str) -> subprocess.CompletedProcess:
    path = Path(tempfile.mkdtemp(prefix="academy-corr3-")) / "probe.py"
    path.write_text(textwrap.dedent(source), encoding="utf-8")
    env = os.environ.copy()
    env["PYTHONPATH"] = str(BENCH) + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return subprocess.run(
        [_python(), str(path)],
        cwd=str(BENCH),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


@test("CORR3.canonical_http_500_is_classified")
def canonical_http_500() -> None:
    event = normalize_provider_event({
        "http_status": 500,
        "transport_error_class": "Error",
        "timeout": False,
        "scenario_id": "CORR3-PROVIDER-500",
        "attempt_number": 1,
        "chat_request_ordinal": 1,
    })
    if event["raw_infrastructure_outcome"] != "PROVIDER_HTTP_5XX":
        raise AssertionError(event["raw_infrastructure_outcome"])
    if event["http_status"] != 500 or event["HTTP_status"] != 500:
        raise AssertionError((event["http_status"], event["HTTP_status"]))
    if event["benchmark_scenario_id"] != event["scenario_id"]:
        raise AssertionError(event)
    aggregate = aggregate_attempt_evidence({"provider_evidence": [event]})
    if aggregate.get("dominates") is not True or aggregate.get("canonical_benchmark_status") != "INFRA_FAILURE":
        raise AssertionError(aggregate.get("canonical_benchmark_status"))
    if "NAVIGATOR_PROVIDER" not in [item.get("source") for item in aggregate.get("findings") or []]:
        raise AssertionError(aggregate.get("findings"))


@test("CORR3.canonical_map_timeout_429_auth_connection_malformed")
def canonical_map() -> None:
    cases = [
        ({"timeout": True, "http_status": 500}, "PROVIDER_TIMEOUT"),
        ({"http_status": 429}, "PROVIDER_HTTP_429"),
        ({"http_status": 404}, "PROVIDER_HTTP_4XX"),
        ({"http_status": 401}, "PROVIDER_AUTH_FAILURE"),
        ({"http_status": 403}, "PROVIDER_AUTH_FAILURE"),
        ({"auth_failure": True, "http_status": 400}, "PROVIDER_AUTH_FAILURE"),
        ({"transport_error_class": "ECONNREFUSED"}, "PROVIDER_CONNECTION_FAILURE"),
        ({"malformed_response": True, "http_status": 200}, "PROVIDER_MALFORMED_RESPONSE"),
    ]
    for fields, expected in cases:
        got = normalize_provider_event(fields)["raw_infrastructure_outcome"]
        if got != expected:
            raise AssertionError((fields, got, expected))


@test("CORR3.python_dns_udp_residuals_denied")
def python_dns_udp() -> None:
    completed = _run_snippet(
        """
        import socket
        from execution_infrastructure.pd_f06_isolation import install_network_guard
        install_network_guard()
        denied = []
        for label, call in (
            ("gethostbyname_ex", lambda: socket.gethostbyname_ex("example.com")),
            ("gethostbyaddr", lambda: socket.gethostbyaddr("8.8.8.8")),
        ):
            try:
                call()
                print(label + "=ALLOWED")
            except PermissionError:
                denied.append(label)
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.sendmsg([b"x"], [], 0, ("8.8.8.8", 53))
            print("sendmsg=ALLOWED")
        except PermissionError:
            denied.append("sendmsg")
        finally:
            sock.close()
        try:
            socket.gethostbyaddr("127.0.0.1")
            print("loopback_addr=OK")
        except PermissionError:
            print("loopback_addr=DENIED")
        except Exception:
            print("loopback_addr=OK")
        print("DENIED=" + ",".join(denied))
        """
    )
    text = completed.stdout + completed.stderr
    NETWORK_UNIT["dns_udp_returncode"] = completed.returncode
    NETWORK_UNIT["dns_udp_denied"] = "DENIED=gethostbyname_ex,gethostbyaddr,sendmsg" in completed.stdout
    NETWORK_UNIT["loopback_addr_allowed"] = "loopback_addr=OK" in completed.stdout
    if completed.returncode != 0 or "DENIED=gethostbyname_ex,gethostbyaddr,sendmsg" not in completed.stdout:
        raise AssertionError(text[-1500:])
    if "loopback_addr=DENIED" in completed.stdout:
        raise AssertionError(text[-1500:])
    if "example.com" in text and "ALLOWED" in text:
        raise AssertionError(text[-1500:])


@test("CORR3.directory_symlink_credential_open_denied")
def directory_symlink() -> None:
    completed = _run_snippet(
        """
        import os, tempfile
        from execution_infrastructure.pd_f06_isolation import install_import_guard, is_credential_path
        root = tempfile.mkdtemp(prefix="academy-corr3-cred-")
        cred = os.path.join(root, "credentials")
        os.mkdir(cred)
        secret = os.path.join(cred, "gcp.json")
        with open(secret, "w", encoding="utf-8") as handle:
            handle.write("SUPERSECRETVALUE")
        linkdir = os.path.join(root, "linkdir")
        os.symlink(cred, linkdir)
        target = os.path.join(linkdir, "gcp.json")
        classified = is_credential_path(target)
        install_import_guard()
        try:
            open(target, "r", encoding="utf-8")
            print("OPENED")
        except PermissionError:
            print("DENIED")
        print("CLASSIFIED=" + str(classified))
        """
    )
    text = completed.stdout + completed.stderr
    NETWORK_UNIT["directory_symlink_denied"] = "DENIED" in completed.stdout and "CLASSIFIED=True" in completed.stdout
    NETWORK_UNIT["credential_value_absent"] = "SUPERSECRETVALUE" not in text
    if completed.returncode != 0 or "DENIED" not in completed.stdout or "CLASSIFIED=True" not in completed.stdout:
        raise AssertionError(text[-1500:])
    if "SUPERSECRETVALUE" in text or "OPENED" in completed.stdout:
        raise AssertionError("credential guard read or opened the target")


@test("CORR3.all_evidence_classes_redacted")
def all_classes_redacted() -> None:
    note = "Authorization: Bearer raw-token-value sb_secret_benchmark_placeholder sk-abcdefghijklmnopqrstuvwxyz Authorization: Basic dXNlcjpwYXNz"
    aggregate = aggregate_attempt_evidence({
        "provider_evidence": [{"http_status": 500, "note": note}],
        "retrieval_evidence": [{"classification": "RETRIEVAL_INFRA_FAILURE", "note": note, "scenario_id": "A-0005"}],
        "python_violations": [{"violation": True, "note": note}],
        "node_events": [{"violation": True, "decision": "deny", "reason": "DEFAULT_DENY", "note": note}],
        "generic_infra_failure": [{"source": "GENERIC", "note": note}],
        "os_f04": {"execution_status": "STOPPED_APPARATUS_LOGGING_FAILURE", "markers": ["--- Logging error ---"], "note": note},
        "lifecycle": {"fail_closed": True, "status": "LIFECYCLE_FAIL_CLOSED", "note": note},
        "timeout_evidence": [{"note": note}],
    })
    encoded = json.dumps(aggregate, ensure_ascii=False)
    for marker in SECRET_MARKERS:
        if marker in encoded or marker.lower() in encoded.lower():
            raise AssertionError(marker)
    if "sb_secret_" in encoded or "sk-" in encoded.lower():
        raise AssertionError("secret shape survived")
    if aggregate.get("dominates") is not True:
        raise AssertionError(aggregate.get("dominates"))
    NETWORK_UNIT["evidence_classes_redacted"] = True


@test("CORR3.loopback_publishes_retrieval_without_manual_call")
def loopback_publishes() -> None:
    loopback = LoopbackSupabaseDouble()
    register_active_loopback(loopback)
    loopback.start()
    try:
        open_evidence_attempt("A-0005", 1)
        arm_request = {
            "scenario_id": "A-0005",
            "attempt_number": 1,
            "chat_request_ordinal": 1,
            "course_id": "levels-of-consciousness",
        }
        loopback.arm("A-0005", 1, 1, "levels-of-consciousness")
        payload = json.dumps({
            "p_course_id": "levels-of-consciousness",
            "p_query_embedding": [0.0] * 1024,
            "p_match_count": 12,
            "p_match_threshold": -1,
        }).encode("utf-8")
        request = urllib.request.Request(
            loopback.supabase_url + "/rest/v1/rpc/match_course_knowledge_chunks",
            data=payload,
            headers={"Content-Type": "application/json", "apikey": SUPABASE_SECRET_PLACEHOLDER},
            method="POST",
        )
        try:
            urllib.request.urlopen(request, timeout=5).read()
        except Exception:
            pass
        stored = collected_evidence("A-0005", 1) or {}
        rows = stored.get("retrieval_evidence") or []
        recorded = [item for item in loopback.evidence if item.get("classification") == "RETRIEVAL_INFRA_FAILURE"]
        if not recorded or not rows:
            raise AssertionError({"loopback": len(recorded), "attempt": len(rows)})
        row = rows[-1]
        for field in ("scenario_id", "attempt_number", "chat_request_ordinal", "course_id", "route", "failure_reason", "fixture_identity"):
            if not row.get(field) and row.get(field) != 0:
                raise AssertionError((field, row))
        if row.get("scenario_id") != "A-0005" or row.get("course_id") != arm_request["course_id"]:
            raise AssertionError(row)
    finally:
        close_evidence_attempt()
        loopback.stop()


@test("CORR3.stale_event_is_visible_and_identity_clears")
def stale_and_clear() -> None:
    loopback = LoopbackSupabaseDouble()
    register_active_loopback(loopback)
    loopback.start()
    try:
        open_evidence_attempt("CORR3-B", 1)
        loopback.arm("CORR3-A", 1, 1, "levels-of-consciousness")
        accepted = publish_provider_evidence({
            "scenario_id": "CORR3-A",
            "attempt_number": 1,
            "http_status": 500,
            "timeout": False,
        })
        stored = collected_evidence("CORR3-B", 1) or {}
        classes = [item.get("classification") for item in stored.get("quarantine") or []]
        if accepted or "STALE_OR_MISMATCHED_INFRA_EVENT" not in classes or stored.get("infra_failure") is not True:
            raise AssertionError({"accepted": accepted, "classes": classes, "infra": stored.get("infra_failure")})
        if "provider" not in [item.get("kind") for item in stored.get("quarantine") or []]:
            raise AssertionError(stored.get("quarantine"))
        close_evidence_attempt()
        if loopback.armed is not None:
            raise AssertionError(loopback.armed)
        open_evidence_attempt("CORR3-C", 1)
        if loopback.armed is not None:
            raise AssertionError("identity survived into the next attempt")
        disarm_request_identity()
        if loopback.armed is not None:
            raise AssertionError(loopback.armed)
    finally:
        close_evidence_attempt()
        loopback.stop()


@test("CORR3.inner_asyncio_run_does_not_close_outer_boundary")
def inner_asyncio_keeps_boundary() -> None:
    boundary = AttemptBoundary()
    boundary.begin()
    try:
        asyncio.run(asyncio.sleep(0.01))
        if boundary._finished:
            raise AssertionError("inner asyncio.run closed the outer boundary")
        if boundary.report.get("outer_boundary_open") is not True:
            raise AssertionError(boundary.report)
        worker = threading.Thread(target=lambda: time.sleep(0.15), name="product-after-inner-async", daemon=False)
        worker.start()
        report = boundary.finish(join_timeout=1.0)
    finally:
        if not boundary._finished:
            boundary.finish(join_timeout=0.2)
    if "product-after-inner-async" not in (report.get("joined_threads") or []):
        raise AssertionError(report)
    if report.get("outer_boundary_closed_by") != "ATTEMPT_FINISH":
        raise AssertionError(report.get("outer_boundary_closed_by"))
    ASYNC_PROOF["outer_boundary_survives_inner_asyncio_run"] = True
    ASYNC_PROOF["thread_after_inner_async_observed"] = True


@test("CORR3.cancellation_swallower_is_bounded")
def cancellation_swallower() -> None:
    async def swallower() -> None:
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                await asyncio.sleep(30)

    async def main() -> None:
        asyncio.create_task(swallower())
        await asyncio.sleep(0.05)

    boundary = AttemptBoundary()
    boundary.join_timeout = 0.4
    boundary.begin()
    started = time.monotonic()
    try:
        asyncio.run(main())
        elapsed = time.monotonic() - started
        report = boundary.finish(join_timeout=0.4)
    finally:
        if not boundary._finished:
            boundary.finish(join_timeout=0.2)
    if elapsed >= 8:
        raise AssertionError(elapsed)
    if report.get("fail_closed") is not True:
        raise AssertionError(report)
    if report.get("status") == "BACKGROUND_WORK_TERMINATED":
        raise AssertionError(report.get("status"))
    ASYNC_PROOF["cancellation_swallower_elapsed_s"] = round(elapsed, 3)
    ASYNC_PROOF["cancellation_swallower_bounded"] = True
    ASYNC_PROOF["fail_closed_status"] = report.get("status")


@test("CORR3.lifecycle_failure_status_and_shutdown_thread")
def lifecycle_labels() -> None:
    if _accurate_status(True, "BACKGROUND_WORK_TERMINATED") != "LIFECYCLE_FAIL_CLOSED":
        raise AssertionError(_accurate_status(True, "BACKGROUND_WORK_TERMINATED"))
    boundary = AttemptBoundary()
    boundary.begin()
    threading.Thread(target=lambda: time.sleep(0.8), name="product-status-probe", daemon=False).start()
    report = boundary.finish(join_timeout=0.15)
    if report.get("fail_closed") is not True or report.get("status") == "BACKGROUND_WORK_TERMINATED":
        raise AssertionError(report.get("status"))
    if "product-status-probe" not in (report.get("still_alive_threads") or []):
        raise AssertionError(report.get("still_alive_threads"))

    async def quiet() -> None:
        await asyncio.sleep(0.01)

    outer = AttemptBoundary()
    outer.join_timeout = 0.5
    outer.begin()
    try:
        asyncio.run(quiet())
        finished = outer.finish(join_timeout=0.5)
    finally:
        if not outer._finished:
            outer.finish(join_timeout=0.2)
    product = ((finished.get("ownership_classes") or {}).get("PRODUCT_ATTEMPT_THREAD") or [])
    alive = finished.get("still_alive_threads") or []
    if "academy-executor-shutdown" in product or "academy-executor-shutdown" in alive:
        raise AssertionError(finished)
    ASYNC_PROOF["lifecycle_failure_status"] = report.get("status")
    ASYNC_PROOF["shutdown_thread_excluded"] = True


@test("CORR3.harness_loopback_thread_is_not_product_work")
def harness_loopback_thread() -> None:
    boundary = AttemptBoundary()
    boundary.begin()
    loopback = LoopbackSupabaseDouble()
    try:
        loopback.start()
        try:
            urllib.request.urlopen(loopback.supabase_url + "/health", timeout=3).read()
        except Exception:
            pass
        threading.Thread(target=lambda: time.sleep(0.8), name="product-attempt-worker", daemon=False).start()
        report = boundary.finish(join_timeout=0.2)
    finally:
        loopback.stop()
        if not boundary._finished:
            boundary.finish(join_timeout=0.2)
    alive = report.get("still_alive_threads") or []
    if "product-attempt-worker" not in alive:
        raise AssertionError(alive)
    for name in alive:
        if str(name).startswith("academy-harness-") or name == "supabase-loopback":
            raise AssertionError(alive)
    ASYNC_PROOF["harness_loopback_excluded"] = True


@test("CORR3.unit_startup_proofs_cannot_mint")
def unit_proofs_cannot_mint() -> None:
    clear_controlled_context()
    clear_live_run()
    try:
        mint_controlled_context({name: True for name in REQUIRED_PROOFS})
        raise AssertionError("boolean proofs minted")
    except PermissionError:
        pass
    if require_controlled_context() is not None:
        raise AssertionError("context remained after boolean mint")
    try:
        permit_scenario_body()
        raise AssertionError("permit without context")
    except PermissionError:
        pass
    blocked = run_scenario_once(
        {"scenario_id": "CORR3-NO-CONTEXT", "failure_class": "CORR3-SYNTHETIC", "track": "ALEXEY_INBOUND",
         "execution_level": "L2", "seam_class": "RUNTIME"},
        run_id="corr3-no-context",
        attempt=1,
        evidence_root=tempfile.mkdtemp(prefix="academy-corr3-gate-"),
    )
    if blocked.verdict.value != "INFRA_FAILURE" or blocked.adapter_invocations != 0:
        raise AssertionError((blocked.verdict.value, blocked.adapter_invocations))


@test("CORR3.keepalive_stub_is_not_next_authority")
def keepalive_not_authority() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="academy-corr3-keepalive-"))
    state = tmp / "preload-state.json"
    ledger = tmp / "node-ledger.json"
    env = os.environ.copy()
    env["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
    env["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(state)
    env["ACADEMY_NODE_LEDGER_PATH"] = str(ledger)
    process = subprocess.Popen(
        ["node", str(PRELOAD_PATH.parent / "corr2_preload_keepalive.cjs")],
        cwd=str(BENCH),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    loopback = LoopbackSupabaseDouble()
    previous = os.environ.get("ACADEMY_EXECUTION_PRELOAD_STATE")
    try:
        loopback.start()
        register_active_loopback(loopback)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not state.exists():
            if process.poll() is not None:
                err = process.stderr.read().decode("utf-8", "replace") if process.stderr else ""
                raise AssertionError(err or "keepalive exited")
            time.sleep(0.05)
        if not state.exists():
            raise AssertionError("keepalive state missing")
        port = int(json.loads(state.read_text(encoding="utf-8"))["port"])
        os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(state)
        os.environ["ACADEMY_NODE_LEDGER_PATH"] = str(ledger)
        health_request = urllib.request.Request(f"http://127.0.0.1:{port}/health")
        with urllib.request.urlopen(health_request, timeout=5) as response:
            health = json.loads(response.read().decode("utf-8"))
        if health.get("next_server") is True:
            raise AssertionError(health)
        try:
            proofs = issue_inprocess_proofs(loopback, f"http://127.0.0.1:{port}", PROFILE)
            mint_controlled_context(proofs)
            raise AssertionError("unit startup proofs minted a context")
        except PermissionError:
            pass
        if require_controlled_context() is not None:
            raise AssertionError("context active after unit proofs")
        try:
            permit_scenario_body()
            raise AssertionError("permit after unit proofs")
        except PermissionError:
            pass
    finally:
        clear_controlled_context()
        clear_live_run()
        loopback.stop()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        if previous is None:
            os.environ.pop("ACADEMY_EXECUTION_PRELOAD_STATE", None)
        else:
            os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = previous


@test("CORR3.forged_issue_is_rejected")
def forged_issue() -> None:
    begin_generation()
    register_live_next_run(
        generation=current_generation(),
        nonce="corr3-unit-nonce",
        pid=os.getpid(),
        port=9,
        build_id="unit-not-next",
        replica_identity="unit",
        control_url="http://127.0.0.1:9",
    )
    try:
        _issue("CONTROLLED_NEXT_MODE", {"kind": "FORGED"})
        try:
            _issue("CONTROLLED_NEXT_MODE", {"kind": "FORGED_AGAIN"})
            raise AssertionError("second _issue was accepted")
        except PermissionError as exc:
            if "already bound" not in str(exc):
                raise
        try:
            mint_controlled_context({name: True for name in REQUIRED_PROOFS})
            raise AssertionError("forged boolean mint succeeded")
        except PermissionError:
            pass
    finally:
        clear_live_run()
        clear_controlled_context()


@test("CORR3.real_local_arm_is_on_the_native_path")
def real_local_source() -> None:
    source = (BENCH / "adapters" / "product.py").read_text(encoding="utf-8")
    if "arm_native_chat_transport(adapter)" not in source:
        raise AssertionError("real_local arm call missing")
    if source.count("arm_chat_request_for_active_attempt") < 2:
        raise AssertionError("navigator chat arm missing")
    producers = (BENCH / "adapters" / "corr3_producers.py").read_text(encoding="utf-8")
    if "publish_provider_evidence" in producers or "publish_retrieval_evidence" in producers:
        raise AssertionError("corr3 adapters publish evidence directly")
    called = {"value": False}

    class Dummy:
        async def call_navigator_core(self) -> str:
            called["value"] = True
            return "ok"

    dummy = Dummy()
    arm_native_chat_transport(dummy)
    if not getattr(dummy.call_navigator_core, "_academy_request_armed", False):
        raise AssertionError("wrapper was not installed")
    arm_native_chat_transport(dummy)
    if dummy.call_navigator_core.__name__ != "armed_real_local_core":
        raise AssertionError("wrapper was replaced")
    found: dict[str, set[str]] = {}
    for path in sorted((BENCH / "corpus").glob("*.jsonl")):
        ids = set()
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            transport = ((row.get("preconditions") or {}).get("navigator_transport"))
            if transport == "real_local":
                ids.add(row.get("scenario_id"))
        if ids:
            found[path.name] = ids
    if not found:
        raise AssertionError("no real_local corpus rows")
    for name, ids in found.items():
        if ids != REAL_LOCAL_IDS:
            raise AssertionError((name, sorted(ids - REAL_LOCAL_IDS), sorted(REAL_LOCAL_IDS - ids)))
    if called["value"]:
        raise AssertionError("source scan invoked the native transport")


@test("CORR3.producer_registry_names_every_handoff")
def producer_registry() -> None:
    required = {
        "NODE_PROVIDER_OBSERVER",
        "NODE_FETCH_DENY_OBSERVER",
        "SUPABASE_LOOPBACK",
        "PYTHON_ISOLATION",
        "PD_F06_LIFECYCLE",
        "OS_F04",
        "GENERIC_TIMEOUT_TRANSPORT",
    }
    if set(PRODUCERS) != required:
        raise AssertionError(sorted(PRODUCERS))
    for name in required:
        row = handoff_for(name)
        if not row.get("emits") or not row.get("handoff"):
            raise AssertionError(name)
    loopback_handoff = handoff_for("SUPABASE_LOOPBACK")["handoff"]
    if "_remember" not in loopback_handoff or "publish_retrieval_evidence" not in loopback_handoff:
        raise AssertionError(loopback_handoff)


@test("CORR3.real_node_provider_and_fetch_deny_reach_attempt")
def real_node_producer() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="academy-corr3-node-"))
    state = tmp / "preload-state.json"
    ledger = tmp / "node-ledger.json"
    stub = _Stub()
    stub.start()
    env = os.environ.copy()
    env["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
    env["ACADEMY_LOCAL_PROVIDER_STUB"] = stub.url
    env["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(state)
    env["ACADEMY_NODE_LEDGER_PATH"] = str(ledger)
    process = subprocess.Popen(
        ["node", "-e", "require(process.argv[1]); setInterval(() => {}, 1000);", str(PRELOAD_PATH)],
        cwd=str(BENCH),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    loopback = LoopbackSupabaseDouble()
    previous_state = os.environ.get("ACADEMY_EXECUTION_PRELOAD_STATE")
    previous_ledger = os.environ.get("ACADEMY_NODE_LEDGER_PATH")
    previous_stub = os.environ.get("ACADEMY_LOCAL_PROVIDER_STUB")
    try:
        loopback.start()
        register_active_loopback(loopback)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not state.exists():
            if process.poll() is not None:
                err = process.stderr.read().decode("utf-8", "replace") if process.stderr else ""
                raise AssertionError(err or "preload exited")
            time.sleep(0.05)
        port = int(json.loads(state.read_text(encoding="utf-8"))["port"])
        os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(state)
        os.environ["ACADEMY_NODE_LEDGER_PATH"] = str(ledger)
        os.environ["ACADEMY_LOCAL_PROVIDER_STUB"] = stub.url
        control = f"http://127.0.0.1:{port}"
        begin_attempt("CORR3-NODE-500", 1)
        try:
            arm_request_identity("CORR3-NODE-500", 1, 1, "levels-of-consciousness")
            _post(control + "/probe-fetch", {
                "url": "https://api.deepseek.com/chat/completions",
                "method": "POST",
                "headers": {"content-type": "application/json", "x-academy-local-mode": "http500"},
                "body": {"model": "local-stub", "messages": [{"role": "user", "content": "local"}]},
            })
        finally:
            finish_attempt()
        stored = collected_evidence("CORR3-NODE-500", 1) or {}
        providers = stored.get("provider_evidence") or []
        if not providers or providers[-1].get("raw_infrastructure_outcome") != "PROVIDER_HTTP_5XX":
            raise AssertionError(providers[-1] if providers else stored)
        if providers[-1].get("http_status") != 500:
            raise AssertionError(providers[-1].get("http_status"))
        begin_attempt("CORR3-NODE-DENY", 1)
        try:
            arm_request_identity("CORR3-NODE-DENY", 1, 1, None)
            _post(control + "/probe-fetch", {"url": "https://api.telegram.org/bot", "method": "GET"})
        finally:
            finish_attempt()
        denied = collected_evidence("CORR3-NODE-DENY", 1) or {}
        reasons = [item.get("reason") for item in (denied.get("node_events") or []) if item.get("violation") is True]
        if "DEFAULT_DENY" not in reasons:
            raise AssertionError(denied.get("node_events"))
    finally:
        close_evidence_attempt()
        loopback.stop()
        stub.stop()
        if process.poll() is None:
            process.kill()
            process.wait(timeout=3)
        if previous_state is None:
            os.environ.pop("ACADEMY_EXECUTION_PRELOAD_STATE", None)
        else:
            os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = previous_state
        if previous_ledger is None:
            os.environ.pop("ACADEMY_NODE_LEDGER_PATH", None)
        else:
            os.environ["ACADEMY_NODE_LEDGER_PATH"] = previous_ledger
        if previous_stub is None:
            os.environ.pop("ACADEMY_LOCAL_PROVIDER_STUB", None)
        else:
            os.environ["ACADEMY_LOCAL_PROVIDER_STUB"] = previous_stub


class _Stub:
    def __init__(self) -> None:
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        self._server_cls = ThreadingHTTPServer
        self._handler_cls = BaseHTTPRequestHandler
        self._httpd = None
        self._thread = None
        self.url = ""

    def start(self) -> str:
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt: str, *args) -> None:
                return None

            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                if length:
                    self.rfile.read(length)
                body = b"local-http-500"
                self.send_response(500)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:  # noqa: N802
                self.do_POST()

        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        host, port = self._httpd.server_address[:2]
        self.url = f"http://{host}:{port}"
        self._thread = threading.Thread(target=self._httpd.serve_forever, name="academy-harness-unit-stub", daemon=True)
        self._thread.start()
        return self.url

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)


def _post(url: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


@test("CORR3.real_topology")
def real_topology() -> None:
    if os.environ.get("CORR3_UNIT_ONLY") == "1":
        return
    if os.environ.get("ACADEMY_CORR3_TOPOLOGY") != "1":
        return
    from execution_infrastructure.corr3_topology import run_corr3_topology

    proof = run_corr3_topology()
    if proof.get("ok") is not True:
        raise AssertionError(proof.get("reason") or proof.get("checks"))


def _unit_artifact_root() -> Path:
    """Focused runs write a private directory. Canonical proof roots are refused."""
    from execution_infrastructure.next_authority import refuse_persistent_artifact_root

    raw = os.environ.get("ACADEMY_AUTHOR_ARTIFACT_ROOT")
    if raw:
        path = Path(raw).resolve()
        refuse_persistent_artifact_root(path)
        path.mkdir(parents=True, exist_ok=True)
        return path
    return Path(tempfile.mkdtemp(prefix="academy-corr3-unit-artifacts-"))


def _write_unit_artifacts() -> None:
    root = _unit_artifact_root()
    from execution_infrastructure.next_authority import canonical_artifact_root

    if canonical_artifact_root(root) or canonical_artifact_root(ARTIFACT_ROOT):
        if root.resolve() == ARTIFACT_ROOT.resolve() or canonical_artifact_root(root):
            raise PermissionError("CANONICAL_ARTIFACT_ROOT_REFUSED")
    if ASYNC_PROOF:
        path = root / "ASYNC_LIFECYCLE_REAL_RUN_PROOF.json"
        path.write_text(json.dumps({
            "act": "IMPLEMENTATION-1.CORR3",
            "provider_contact": "NONE",
            "benchmark_scenarios_executed": 0,
            "artifact_root": str(root),
            **ASYNC_PROOF,
        }, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if NETWORK_UNIT:
        network_path = root / "NETWORK_CREDENTIAL_RESIDUAL_PROOF.json"
        network_path.write_text(json.dumps({
            "act": "IMPLEMENTATION-1.CORR3",
            "provider_contact": "NONE",
            "artifact_root": str(root),
            "unit": NETWORK_UNIT,
        }, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    sys.dont_write_bytecode = True
    for fn in TESTS:
        fn()
    _write_unit_artifacts()
    passed = sum(1 for _name, ok, _detail in RESULTS if ok)
    failed = len(RESULTS) - passed
    print(json.dumps({
        "focused_tests_total": len(RESULTS),
        "focused_tests_pass": passed,
        "focused_tests_fail": failed,
        "results": [
            {"name": name, "pass": ok, "detail": detail}
            for name, ok, detail in RESULTS
        ],
    }, ensure_ascii=False, indent=2))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
