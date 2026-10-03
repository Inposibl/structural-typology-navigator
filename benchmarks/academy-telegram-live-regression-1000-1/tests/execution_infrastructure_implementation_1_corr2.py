"""CORR2 regressions for the CORR1.IV1 open findings.

No benchmark scenario body runs. No real provider is contacted.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
NAVIGATOR = BENCH.parent.parent
sys.path.insert(0, str(BENCH))

# CORR6 MINOR-3: private temp root, own process group, and a child reaper.
from execution_infrastructure.process_hygiene import install_suite_hygiene  # noqa: E402

install_suite_hygiene("corr2")

from adapters.corr2_synthetic import synthetic_registry, synthetic_spec  # noqa: E402
from execution_infrastructure.attempt_binding import (  # noqa: E402
    apply_infrastructure_precedence,
    arm_request_identity,
    close_evidence_attempt,
    collected_evidence,
    open_evidence_attempt,
    publish_provider_evidence,
    quarantine,
    register_active_loopback,
)
from execution_infrastructure.constants import (  # noqa: E402
    CHATBOT_TEST_BASE,
    COVERAGE_PATH,
    LOGGING_STOP_CLASS,
    PRELOAD_PATH,
    SUPABASE_SECRET_PLACEHOLDER,
)
from execution_infrastructure.controlled_context import (  # noqa: E402
    REQUIRED_PROOFS,
    clear_controlled_context,
    mint_controlled_context,
    permit_scenario_body,
    require_controlled_context,
)
from execution_infrastructure.orchestrator import (  # noqa: E402
    claim_evidence_directory,
    run_sandboxed_next_build,
)
from execution_infrastructure.os_f04_streams import (  # noqa: E402
    fd2_cursor,
    install_process_stderr_tee,
    os_f04_report_since,
)
from execution_infrastructure.pd_f04_provider_evidence import (  # noqa: E402
    AttemptProviderObserver,
    aggregate_attempt_evidence,
    redact,
)
from execution_infrastructure.pd_f05_fixtures import (  # noqa: E402
    build_query_vector,
    fixture_key,
    load_frozen_document,
    vector_sha256,
)
from execution_infrastructure.pd_f05_loopback import LoopbackSupabaseDouble  # noqa: E402
from execution_infrastructure.pd_f06_isolation import (  # noqa: E402
    events,
    import_guard_installed,
    install_import_guard,
    install_network_guard,
    is_credential_path,
    network_guard_installed,
    uninstall_import_guard,
    uninstall_network_guard,
)
from execution_infrastructure.pd_f06_lifecycle import AttemptBoundary  # noqa: E402
from execution_infrastructure.pd_f06_product_lifecycle import ensure_product_wrappers  # noqa: E402
from execution_infrastructure.snapshot_rule import snapshot_document  # noqa: E402
from execution_infrastructure.startup_proofs import (  # noqa: E402
    StartupProof,
    begin_generation,
    issue_inprocess_proofs,
    prove_python_isolation,
)
from harness.factory import LANE_CALIBRATION  # noqa: E402
from harness.runner import run_scenario_once  # noqa: E402
from harness.verdicts import PrimaryVerdict  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []
TESTS: list = []
PROFILE = (
    "(version 1)\n(allow default)\n(deny network*)\n"
    "(allow network-outbound (remote ip \"localhost:*\"))\n"
    "(allow network-inbound (local ip \"localhost:*\"))\n"
    "(allow network-bind (local ip \"localhost:*\"))\n"
)
SECRET_ENV = (
    "COHERE_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY", "BOT_TOKEN",
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


def _post_json(url: str, payload: dict) -> tuple[int, dict]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.status, json.loads(response.read().decode("utf-8") or "{}")


class _Plane:
    """Loopback plus the real preload, without a Next build."""

    def __init__(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="academy-corr2-plane-")
        self.state_path = Path(self.tmp) / "preload-state.json"
        self.ledger_path = Path(self.tmp) / "node-ledger.json"
        self.process: subprocess.Popen | None = None
        self.loopback = LoopbackSupabaseDouble()
        self.port = 0
        self._previous_state = os.environ.get("ACADEMY_EXECUTION_PRELOAD_STATE")

    def start(self) -> "_Plane":
        env = os.environ.copy()
        for key in SECRET_ENV:
            env.pop(key, None)
        env["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
        env["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(self.state_path)
        env["ACADEMY_NODE_LEDGER_PATH"] = str(self.ledger_path)
        self.process = subprocess.Popen(
            ["node", str(PRELOAD_PATH.parent / "corr2_preload_keepalive.cjs")],
            cwd=str(BENCH),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        self.loopback.start()
        register_active_loopback(self.loopback)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not self.state_path.exists():
            if self.process.poll() is not None:
                err = self.process.stderr.read().decode("utf-8", "replace") if self.process.stderr else ""
                raise RuntimeError(err or "preload keepalive exited")
            time.sleep(0.05)
        if not self.state_path.exists():
            raise RuntimeError("preload state missing")
        self.port = int(json.loads(self.state_path.read_text(encoding="utf-8"))["port"])
        os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(self.state_path)
        os.environ["ACADEMY_NODE_LEDGER_PATH"] = str(self.ledger_path)
        os.environ["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
        return self

    @property
    def control(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def mint(self):
        proofs = issue_inprocess_proofs(self.loopback, self.control, PROFILE)
        return mint_controlled_context(proofs)

    def stop(self) -> None:
        clear_controlled_context()
        try:
            self.loopback.stop()
        except Exception:
            pass
        process = self.process
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        if self._previous_state is None:
            os.environ.pop("ACADEMY_EXECUTION_PRELOAD_STATE", None)
        else:
            os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = self._previous_state


def _probe(plane: _Plane, scenario_id: str) -> dict:
    armed = arm_request_identity(scenario_id, 1, 1, "levels-of-consciousness")
    key = fixture_key(scenario_id, 1, 1, "levels-of-consciousness")
    vector = build_query_vector(key)
    bindings = _post_json(plane.control + "/probe-fetch", {
        "url": plane.loopback.supabase_url + "/rest/v1/academy_course_sources?course_id=eq.levels-of-consciousness&is_active=eq.true&select=course_id",
        "method": "GET",
    })
    cohere = _post_json(plane.control + "/probe-fetch", {
        "url": "https://api.cohere.com/v2/embed",
        "method": "POST",
        "headers": {"content-type": "application/json"},
        "body": {"texts": ["corr2-probe"], "model": "embed-multilingual-v3.0"},
    })
    match = _post_json(plane.control + "/probe-fetch", {
        "url": plane.loopback.supabase_url + "/rest/v1/rpc/match_course_knowledge_chunks",
        "method": "POST",
        "headers": {"content-type": "application/json", "apikey": SUPABASE_SECRET_PLACEHOLDER},
        "body": {
            "p_course_id": "levels-of-consciousness",
            "p_query_embedding": vector,
            "p_match_count": 12,
            "p_match_threshold": -1,
        },
    })
    body = json.loads(cohere[1].get("body") or "{}")
    returned = ((body.get("embeddings") or {}).get("float") or [None])[0]
    expected = load_frozen_document()["fixtures"][key]["query_vector_sha256"]
    returned_sha = vector_sha256(returned) if isinstance(returned, list) else None
    return {
        "bindings_http": bindings[1].get("status"),
        "cohere_http": cohere[1].get("status"),
        "match_http": match[1].get("status"),
        "vector_sha_equal": returned_sha == expected == vector_sha256(vector),
        "node_scenario": ((armed.get("node") or {}).get("armed") or {}).get("scenario_id"),
        "loopback_scenario": (armed.get("loopback") or {}).get("scenario_id"),
        "runner_scenario": (armed.get("request") or {}).get("scenario_id"),
    }


@test("CORR2.precedence_maps_each_infrastructure_source")
def _():
    cases = [
        (
            {"provider_evidence": {"raw_infrastructure_outcome": "PROVIDER_TIMEOUT", "timeout_class": "TIMEOUT"}},
            "TIMEOUT",
            None,
        ),
        (
            {"provider_evidence": {"raw_infrastructure_outcome": "PROVIDER_HTTP_5XX", "http_status": 500}},
            "INFRA_FAILURE",
            None,
        ),
        (
            {"provider_evidence": {"raw_infrastructure_outcome": "PROVIDER_HTTP_4XX", "http_status": 401}},
            "INFRA_FAILURE",
            None,
        ),
        (
            {"retrieval_evidence": [{"classification": "RETRIEVAL_INFRA_FAILURE"}]},
            "INFRA_FAILURE",
            "RETRIEVAL_INFRA_FAILURE",
        ),
        (
            {"node_events": [{"violation": True, "decision": "deny", "reason": "DEFAULT_DENY", "scenario_id": "A-0005", "attempt_number": 1}]},
            "INFRA_FAILURE",
            "NODE_LEDGER_VIOLATION",
        ),
        (
            {"python_violations": [{"violation": True, "decision": "deny", "external_contact": False}]},
            "INFRA_FAILURE",
            "PYTHON_ISOLATION_VIOLATION",
        ),
        (
            {"lifecycle_report": {"fail_closed": True, "remaining_task_count": 1, "status": "BACKGROUND_WORK_UNTERMINATED"}},
            "INFRA_FAILURE",
            "BACKGROUND_WORK_UNTERMINATED",
        ),
        (
            {"os_f04": {"markers": ["--- Logging error ---"], "execution_status": LOGGING_STOP_CLASS}},
            "INFRA_FAILURE",
            LOGGING_STOP_CLASS,
        ),
    ]
    for parts, canonical, stop in cases:
        result = apply_infrastructure_precedence(infra_failure=False, timeout_exceeded=False, **parts)
        if result["continue_to_next_scenario"] is not False:
            raise AssertionError(result)
        aggregate = result["aggregate"]
        if aggregate["canonical_benchmark_status"] != canonical:
            raise AssertionError((canonical, aggregate))
        if stop is not None and aggregate.get("stop_class") != stop:
            raise AssertionError((stop, aggregate.get("stop_class")))
    quiet = apply_infrastructure_precedence(
        infra_failure=False,
        timeout_exceeded=False,
        node_events=[{"decision": "deny", "reason": "DEFAULT_DENY", "violation": False}],
    )
    if quiet["aggregate"]["dominates"] is not False:
        raise AssertionError(quiet)


@test("CORR2.self_asserted_proof_cannot_mint")
def _():
    clear_controlled_context()
    try:
        StartupProof(b"not-the-seal", "PYTHON_ISOLATION_ACTIVE", 1, os.getpid(), "x", {})
    except PermissionError:
        pass
    else:
        raise AssertionError("foreign seal minted a proof object")
    try:
        mint_controlled_context({name: True for name in REQUIRED_PROOFS})
    except PermissionError:
        pass
    else:
        raise AssertionError("boolean dict minted a context")
    if require_controlled_context() is not None:
        raise AssertionError("context active after self-asserted mint")


@test("CORR2.failed_remint_clears_active_context")
def _():
    import execution_infrastructure.controlled_context as cc

    plane = _Plane().start()
    try:
        proofs = issue_inprocess_proofs(plane.loopback, plane.control, PROFILE)
        try:
            mint_controlled_context(proofs)
        except PermissionError:
            pass
        else:
            raise AssertionError("unit proofs minted a context")
        planted = cc.ControlledContext(cc._SEAL, {name: True for name in REQUIRED_PROOFS})
        cc._ACTIVE = planted
        if require_controlled_context() is None:
            raise AssertionError("planted context was not active")
        try:
            mint_controlled_context({name: True for name in REQUIRED_PROOFS})
        except PermissionError:
            pass
        else:
            raise AssertionError("stale proofs reminted")
        if cc._ACTIVE is not None or require_controlled_context() is not None:
            raise AssertionError("previous context stayed active after failed remint")
    finally:
        plane.stop()


@test("CORR2.python_guard_installed_before_product_import")
def _():
    uninstall_network_guard()
    uninstall_import_guard()
    try:
        ensure_product_wrappers(CHATBOT_TEST_BASE)
    except RuntimeError as exc:
        if "PYTHON_ISOLATION_NOT_INSTALLED_BEFORE_PRODUCT_IMPORT" not in str(exc):
            raise
    else:
        raise AssertionError("product import ran without isolation guards")
    install_network_guard()
    install_import_guard()
    if not network_guard_installed() or not import_guard_installed():
        raise AssertionError("guards did not install")


@test("CORR2.python_gethostbyname_and_udp_sendto_denied")
def _():
    install_network_guard()
    before = len(events())
    try:
        socket.gethostbyname("example.com")
    except PermissionError as exc:
        if "DEFAULT_DENY" not in str(exc):
            raise
    else:
        raise AssertionError("gethostbyname reached the network")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        try:
            sock.sendto(b"corr2", ("8.8.8.8", 53))
        except PermissionError as exc:
            if "DEFAULT_DENY" not in str(exc):
                raise
        else:
            raise AssertionError("udp sendto reached the network")
    finally:
        sock.close()
    fresh = events()[before:]
    operations = {item.get("operation") for item in fresh}
    if "socket.gethostbyname" not in operations or "socket.sendto" not in operations:
        raise AssertionError(operations)
    if any(item.get("external_contact") is True for item in fresh):
        raise AssertionError(fresh)


@test("CORR2.credential_bytes_case_and_symlink_denied")
def _():
    code = r"""
import os
import tempfile
from pathlib import Path
from execution_infrastructure.pd_f06_isolation import install_import_guard, is_credential_path

sentinel = "SENTINEL-NOT-A-SECRET"
root = Path(tempfile.mkdtemp(prefix="academy-corr2-cred-"))
target = root / ".env.local"
target.write_text(sentinel + "\n", encoding="utf-8")
link = root / "notes.txt"
link.symlink_to(target)
install_import_guard()
probes = [
    os.fsencode(str(root / "token.json")),
    os.fsencode(str(root / "client_secret_live.json")),
    str(root / "Credentials.JSON"),
    str(link),
]
for path in probes:
    if not is_credential_path(path):
        raise SystemExit("classifier missed " + repr(path))
    for opener in (lambda item: open(item, "rb"), lambda item: os.open(item, os.O_RDONLY)):
        try:
            opener(path)
        except PermissionError as exc:
            text = str(exc)
            if "CREDENTIAL_DISCOVERY_DENIED" not in text or sentinel in text:
                raise SystemExit(text)
        else:
            raise SystemExit("open allowed " + repr(path))
"""
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONPATH"] = str(BENCH)
    completed = subprocess.run(
        [sys.executable, "-B", "-c", code],
        cwd=str(BENCH),
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if completed.returncode != 0:
        raise AssertionError(completed.stderr[-1500:] or completed.stdout[-1500:] or "credential probe failed")
    if "SENTINEL-NOT-A-SECRET" in completed.stdout or "SENTINEL-NOT-A-SECRET" in completed.stderr:
        raise AssertionError("sentinel credential bytes leaked")


@test("CORR2.redaction_keeps_basic_sk_and_nonserializable_events")
def _():
    stamped = redact({
        "note": "Authorization: Basic dXNlcjpwYXNz api_key=sk-live-secret-value-12345678",
    })
    encoded = json.dumps(stamped)
    if "dXNlcjpwYXNz" in encoded or "sk-live-secret-value" in encoded:
        raise AssertionError(encoded)
    if "REDACTED_BASIC" not in encoded or "REDACTED_SK" not in encoded:
        raise AssertionError(encoded)

    class Weird:
        def __repr__(self) -> str:
            return "weird-event"

    aggregate = aggregate_attempt_evidence({
        "retrieval_evidence": [{
            "classification": "RETRIEVAL_INFRA_FAILURE",
            "blob": {1, 2},
            "obj": Weird(),
        }],
    })
    preserved = aggregate["preserved"]["retrieval_evidence"]
    if len(preserved) != 1:
        raise AssertionError(preserved)
    blob = json.dumps(preserved)
    if "RETRIEVAL_INFRA_FAILURE" not in blob or "__nonserializable__" not in blob:
        raise AssertionError(blob)
    if aggregate["canonical_benchmark_status"] != "INFRA_FAILURE":
        raise AssertionError(aggregate)


@test("CORR2.provider_event_identity_does_not_cross_attempts")
def _():
    observer = AttemptProviderObserver().install()
    open_evidence_attempt("A-0005", 1)
    try:
        observer.bind_attempt("A-0005", 1, 1)
        accepted = observer.observe_synthetic_transport(http_status=500)
        if accepted.get("accepted") is not True:
            raise AssertionError(accepted)
        event = accepted["evidence"]
        if event.get("scenario_id") != "A-0005" or event.get("attempt_number") != 1:
            raise AssertionError(event)
        if event.get("chat_request_ordinal") != 1:
            raise AssertionError(event)
    finally:
        close_evidence_attempt()
    open_evidence_attempt("A-0006", 1)
    try:
        misplaced = publish_provider_evidence({
            "scenario_id": "A-0005",
            "attempt_number": 1,
            "raw_infrastructure_outcome": "PROVIDER_HTTP_5XX",
        })
        if misplaced:
            raise AssertionError("foreign provider event entered the open attempt")
        observer.bound = {"scenario_id": "A-0005", "attempt_number": 1, "chat_request_ordinal": 1}
        rejected = observer.observe_synthetic_transport(http_status=500)
        if rejected.get("accepted") is not False:
            raise AssertionError(rejected)
        current = collected_evidence("A-0006", 1) or {}
        if current.get("provider_evidence"):
            raise AssertionError(current["provider_evidence"])
    finally:
        close_evidence_attempt()
    original = collected_evidence("A-0005", 1) or {}
    if len(original.get("provider_evidence") or []) != 1:
        raise AssertionError(original)
    if not any(item.get("kind") == "provider" for item in quarantine()):
        raise AssertionError(quarantine())


@test("CORR2.exact_vector_digest_distinguishes_close_values")
def _():
    left = vector_sha256([0.0])
    right = vector_sha256([0.001])
    if left == right:
        raise AssertionError((left, right))
    coverage = COVERAGE_PATH.read_bytes()
    digest = hashlib.sha256(coverage).hexdigest()
    if digest != "f97895c0d47eb2a987990ad460bda978cda0070343175a0aa214f7014e9c76e0":
        raise AssertionError(digest)
    if len(coverage) != 28165:
        raise AssertionError(len(coverage))


@test("CORR2.fd2_logging_marker_is_captured")
def _():
    stderr_identity = id(sys.stderr)
    install_process_stderr_tee()
    cursor = fd2_cursor()
    os.write(2, b"--- Logging error ---\n")
    report = os_f04_report_since(stderr_cursor=10**9, fd2_at=cursor)
    if "--- Logging error ---" not in (report.get("markers") or []):
        raise AssertionError(report)
    if report.get("execution_status") != LOGGING_STOP_CLASS:
        raise AssertionError(report)
    if id(sys.stderr) != stderr_identity or sys.stderr.closed:
        raise AssertionError("stderr object was replaced")


@test("CORR2.artifact_directory_overwrite_refused")
def _():
    with tempfile.TemporaryDirectory(prefix="academy-corr2-artifacts-") as tmp:
        root = Path(tmp) / "evidence"
        root.mkdir()
        marker = root / "kept.txt"
        marker.write_text("keep\n", encoding="utf-8")
        try:
            claim_evidence_directory(root)
        except FileExistsError:
            pass
        else:
            raise AssertionError("non-empty evidence directory was claimed")
        if marker.read_text(encoding="utf-8") != "keep\n":
            raise AssertionError("existing artifact bytes changed")
        empty = Path(tmp) / "empty"
        claim_evidence_directory(empty)
        if not empty.is_dir():
            raise AssertionError("empty evidence directory was not created")


@test("CORR2.sandbox_failure_does_not_retry_unsandboxed")
def _():
    import execution_infrastructure.startup_proofs as proofs

    calls: list[list[str]] = []

    def fake_run(argv, **_kwargs):
        calls.append(list(argv))
        return subprocess.CompletedProcess(argv, 1)

    original = proofs.subprocess.run
    proofs.subprocess.run = fake_run
    try:
        with tempfile.TemporaryDirectory(prefix="academy-corr2-sandbox-") as tmp:
            profile = Path(tmp) / "deny.sb"
            profile.write_text(PROFILE, encoding="utf-8")
            with (Path(tmp) / "build.log").open("w", encoding="utf-8") as handle:
                result = run_sandboxed_next_build("next", tmp, {}, profile, handle)
    finally:
        proofs.subprocess.run = original
    if result.returncode != 1 or len(calls) != 1 or calls[0][0] != "sandbox-exec":
        raise AssertionError((result.returncode, calls))
    source = (BENCH / "execution_infrastructure" / "orchestrator.py").read_text(encoding="utf-8")
    if "SANDBOX_BUILD_FAILED retry without sandbox-exec" in source or "retry without sandbox" in source:
        raise AssertionError("unsandboxed retry remains in the orchestrator")


@test("CORR2.snapshot_replay_command_lists_followed")
def _():
    document = snapshot_document(BENCH / "execution_infrastructure")
    included = document.get("metadata_included") or []
    if "followed" not in included:
        raise AssertionError(included)
    with tempfile.TemporaryDirectory(prefix="academy-corr2-snap-") as tmp:
        (Path(tmp) / "one.txt").write_text("one\n", encoding="utf-8")
        env = os.environ.copy()
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        completed = subprocess.run(
            [
                sys.executable,
                "benchmarks/academy-telegram-live-regression-1000-1/execution_infrastructure/snapshot_rule.py",
                tmp,
            ],
            cwd=str(NAVIGATOR),
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if completed.returncode != 0:
            raise AssertionError(completed.stderr[-1000:] or completed.stdout[-1000:])
        if len(completed.stdout.strip()) != 64:
            raise AssertionError(completed.stdout)


@test("CORR2.async_attempt_boundary_accounts_for_tasks")
def _():
    boundary = AttemptBoundary()
    boundary.begin()

    async def work() -> None:
        loop = asyncio.get_running_loop()

        async def sleeper() -> None:
            await asyncio.sleep(0.01)

        task = loop.create_task(sleeper())
        await task
        await asyncio.to_thread(lambda: 1)

    asyncio.run(work())
    report = boundary.report
    if report.get("fail_closed") is not False:
        raise AssertionError(report)
    if report.get("remaining_task_count") not in (0, None):
        raise AssertionError(report)
    if report.get("executor_closed") is False:
        raise AssertionError(report)
    if "<lambda>" not in (report.get("to_thread_calls") or []):
        raise AssertionError(report)


@test("CORR2.two_request_identities_rearm_node_and_supabase")
def _():
    plane = _Plane().start()
    try:
        first = _probe(plane, "A-0005")
        second = _probe(plane, "A-0006")
        for item in (first, second):
            if item["bindings_http"] != 200 or item["cohere_http"] != 200 or item["match_http"] != 200:
                raise AssertionError(item)
            if item["vector_sha_equal"] is not True:
                raise AssertionError(item)
            if not (item["node_scenario"] == item["loopback_scenario"] == item["runner_scenario"]):
                raise AssertionError(item)
        if first["node_scenario"] != "A-0005" or second["node_scenario"] != "A-0006":
            raise AssertionError((first, second))
        if (plane.loopback.armed or {}).get("scenario_id") != "A-0006":
            raise AssertionError(plane.loopback.armed)
        historical = [row.get("scenario_id") for row in plane.loopback.evidence]
        if "A-0005" not in historical or plane.loopback.armed.get("scenario_id") == "A-0005":
            raise AssertionError(historical)
    finally:
        plane.stop()


@test("CORR2.lifecycle_wrappers_survive_adapter_reload")
def _():
    venv = CHATBOT_TEST_BASE / "venv" / "bin" / "python"
    if not venv.exists():
        raise AssertionError(f"chatbot venv missing: {venv}")
    with tempfile.TemporaryDirectory(prefix="academy-corr2-life-") as tmp:
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": tmp,
            "TMPDIR": tmp,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPATH": str(BENCH),
            "ACADEMY_CHATBOT_ROOT": str(CHATBOT_TEST_BASE),
            "PYTHONNOUSERSITE": "1",
        }
        completed = subprocess.run(
            [str(venv), "-B", "-m", "execution_infrastructure.pd_f06_product_lifecycle", "--corr2-reload"],
            cwd=tmp,
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if completed.returncode != 0:
            raise AssertionError(completed.stderr[-2000:] or completed.stdout[-2000:])
        payload = json.loads(completed.stdout)
        required = (
            "before_wrapped",
            "returned_record_wrapped",
            "returned_update_wrapped",
            "returned_turn_wrapped",
            "live_record_wrapped",
            "live_update_wrapped",
            "live_turn_wrapped",
            "reloaded_modules_guarded",
        )
        if any(payload.get(name) is not True for name in required):
            raise AssertionError(payload)
        if payload.get("outreach_error") or payload.get("adapter_error"):
            raise AssertionError(payload)


@test("CORR2.runner_consumes_every_infrastructure_source")
def _():
    """Unit proofs no longer mint. Real producer consumption is the CORR3 topology."""
    plane = _Plane().start()
    try:
        try:
            plane.mint()
        except PermissionError:
            pass
        else:
            raise AssertionError("unit proofs minted a context")
        if require_controlled_context() is not None:
            raise AssertionError("context active after unit mint")
        with tempfile.TemporaryDirectory(prefix="academy-corr2-runner-") as tmp:
            outcome = run_scenario_once(
                synthetic_spec(),
                run_id="corr2-synthetic",
                attempt=1,
                evidence_root=tmp,
                lane=LANE_CALIBRATION,
                calibration_registry=synthetic_registry(),
            )
        if outcome.verdict != PrimaryVerdict.INFRA_FAILURE or outcome.adapter_invocations != 0:
            raise AssertionError((outcome.verdict, outcome.adapter_invocations, outcome.verdict_reason))
        if outcome.derivation_state.get("continue_to_next_scenario") is not False:
            raise AssertionError(outcome.derivation_state)
        if outcome.derivation_state.get("scenarios_executed") not in (0, None):
            raise AssertionError(outcome.derivation_state.get("scenarios_executed"))
    finally:
        plane.stop()


@test("CORR2.residual_dns_surfaces_are_denied")
def _():
    with tempfile.TemporaryDirectory(prefix="academy-corr2-dns-") as tmp:
        output = str(Path(tmp) / "dns.json")
        env = os.environ.copy()
        for key in SECRET_ENV:
            env.pop(key, None)
        env["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
        completed = subprocess.run(
            ["node", str(PRELOAD_PATH.parent / "corr2_dns_probe.cjs"), output],
            cwd=str(BENCH),
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if not Path(output).exists():
            raise AssertionError(completed.stderr[-2000:] or completed.stdout[-2000:])
        payload = json.loads(Path(output).read_text(encoding="utf-8"))
        failed = [item for item in payload["tests"] if not item["pass"]]
        if failed or completed.returncode != 0:
            raise AssertionError(failed or completed.stderr[-1000:])
        names = {item["name"] for item in payload["tests"]}
        for surface in ("resolveAny", "resolveTxt", "lookupService", "reverse"):
            if f"module.{surface}" not in names:
                raise AssertionError(names)


def main() -> int:
    sys.dont_write_bytecode = True
    for fn in TESTS:
        fn()
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
