"""CORR1 regressions for the IV1 blind spots.

No benchmark scenario body runs. No real provider is contacted.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
NAVIGATOR = BENCH.parent.parent
sys.path.insert(0, str(BENCH))

# CORR6 MINOR-3: private temp root, own process group, and a child reaper.
from execution_infrastructure.process_hygiene import install_suite_hygiene  # noqa: E402

install_suite_hygiene("corr1")

from execution_infrastructure.attempt_binding import apply_infrastructure_precedence  # noqa: E402
from execution_infrastructure.constants import (  # noqa: E402
    CHATBOT_TEST_BASE,
    LOGGING_STOP_CLASS,
    PRELOAD_PATH,
)
from execution_infrastructure.controlled_context import (  # noqa: E402
    REQUIRED_PROOFS,
    clear_controlled_context,
    mint_controlled_context,
    require_controlled_context,
)
from execution_infrastructure.execution_gate import (  # noqa: E402
    ScenarioExecutionForbidden,
    execute_controlled,
)
from execution_infrastructure.os_f04_streams import (  # noqa: E402
    ProcessLifetimeStreams,
    run_attempt_with_streams,
)
from execution_infrastructure.pd_f04_provider_evidence import (  # noqa: E402
    adjudicate,
    aggregate_attempt_evidence,
    build_native_evidence,
    canonical_json,
)
from execution_infrastructure.pd_f05_fixtures import (  # noqa: E402
    build_query_vector,
    fixture_key,
    vector_sha256,
)
from execution_infrastructure.pd_f05_loopback import serve_retrieval  # noqa: E402
from execution_infrastructure.pd_f05_fixtures import load_coverage, load_frozen_document  # noqa: E402
from execution_infrastructure.pd_f06_isolation import (  # noqa: E402
    classify_host,
    install_network_guard,
    uninstall_network_guard,
)
from execution_infrastructure.pd_f06_lifecycle import AttemptBoundary  # noqa: E402
from harness.runner import run_scenario_once, run_scenario_repeat_set  # noqa: E402
from harness.verdicts import PrimaryVerdict  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []


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


TESTS: list = []


def _serve(body: dict, course: str = "levels-of-consciousness"):
    document = load_frozen_document()
    coverage = load_coverage()
    return serve_retrieval(
        document=document,
        coverage=coverage,
        armed={"scenario_id": "A-0005", "attempt_number": 1, "chat_request_ordinal": 1},
        method="POST",
        path="/rest/v1/rpc/match_course_knowledge_chunks",
        query="",
        body=json.dumps(body).encode("utf-8"),
    )


@test("CORR1.strict_loopback_rejects_prefix_and_neighbor")
def _():
    if classify_host("127.0.0.1")["allow"] is not True:
        raise AssertionError("127.0.0.1 denied")
    if classify_host("::1")["allow"] is not True or classify_host("localhost")["allow"] is not True:
        raise AssertionError("exact loopback denied")
    for host in ("127.iv-bypass.invalid", "127.0.0.2", "127.1.1.1"):
        if classify_host(host)["allow"] is not False:
            raise AssertionError(host)


@test("CORR1.connect_ex_cannot_bypass_policy")
def _():
    install_network_guard()
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.connect_ex(("example.com", 9))
        except PermissionError:
            pass
        else:
            raise AssertionError("connect_ex returned instead of PermissionError")
        finally:
            sock.close()
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        port = listener.getsockname()[1]
        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            code = client.connect_ex(("127.0.0.1", port))
            if code != 0:
                raise AssertionError(code)
        finally:
            client.close()
            listener.close()
    finally:
        uninstall_network_guard()


@test("CORR1.io_fileio_protected_path_denied")
def _():
    script = r"""
import io, json, sys
sys.dont_write_bytecode = True
from execution_infrastructure.pd_f06_isolation import install_import_guard
install_import_guard()
path = sys.argv[1]
try:
    io.FileIO(path, "r")
except PermissionError as exc:
    sys.stdout.write(json.dumps({"denied": True, "message": str(exc)}))
else:
    sys.stdout.write(json.dumps({"denied": False}))
"""
    sentinel = "SYNTHETIC-SENTINEL-NOT-A-CREDENTIAL"
    with tempfile.TemporaryDirectory(prefix="academy-fileio-") as tmp:
        target = Path(tmp) / "token.json"
        target.write_text(sentinel + "\n", encoding="utf-8")
        completed = subprocess.run(
            [sys.executable, "-B", "-c", script, str(target)],
            cwd=str(BENCH),
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": str(BENCH)},
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if sentinel in completed.stdout or sentinel in completed.stderr:
            raise AssertionError("credential bytes were read")
        if completed.returncode != 0:
            raise AssertionError(completed.stderr)
        payload = json.loads(completed.stdout)
        if payload.get("denied") is not True:
            raise AssertionError(payload)


@test("CORR1.malformed_and_wrong_query_vectors_rejected")
def _():
    key = fixture_key("A-0005", 1, 1, "levels-of-consciousness")
    good = build_query_vector(key)
    cases = [
        ({"p_course_id": "levels-of-consciousness", "p_match_count": 12, "p_match_threshold": -1}, "p_query_embedding_missing"),
        ({"p_course_id": "levels-of-consciousness", "p_query_embedding": [1], "p_match_count": 12, "p_match_threshold": -1}, "p_query_embedding_dimension"),
        ({"p_course_id": "levels-of-consciousness", "p_query_embedding": [0] * 1023, "p_match_count": 12, "p_match_threshold": -1}, "p_query_embedding_dimension"),
        ({"p_course_id": "levels-of-consciousness", "p_query_embedding": [0] * 1025, "p_match_count": 12, "p_match_threshold": -1}, "p_query_embedding_dimension"),
        ({"p_course_id": "levels-of-consciousness", "p_query_embedding": ["x"] * 1024, "p_match_count": 12, "p_match_threshold": -1}, "p_query_embedding_malformed"),
        ({"p_course_id": "levels-of-consciousness", "p_query_embedding": [0.0] * 1024, "p_match_count": 12, "p_match_threshold": -1}, "p_query_embedding_wrong_vector"),
    ]
    for body, reason in cases:
        status, _payload, evidence = _serve(body)
        if status != 503 or evidence["reason"] != reason:
            raise AssertionError((reason, status, evidence))
    nan_body = (
        '{"p_course_id":"levels-of-consciousness","p_query_embedding":['
        + ",".join(["NaN"] + ["0"] * 1023)
        + '],"p_match_count":12,"p_match_threshold":-1}'
    )
    status, _payload, evidence = serve_retrieval(
        document=load_frozen_document(),
        coverage=load_coverage(),
        armed={"scenario_id": "A-0005", "attempt_number": 1, "chat_request_ordinal": 1},
        method="POST",
        path="/rest/v1/rpc/match_course_knowledge_chunks",
        query="",
        body=nan_body.encode("utf-8"),
    )
    if status != 503 or evidence["reason"] != "p_query_embedding_non_finite":
        raise AssertionError(evidence)
    other = build_query_vector(fixture_key("A-0005", 1, 1, "maslow"))
    status, _payload, evidence = _serve({
        "p_course_id": "levels-of-consciousness",
        "p_query_embedding": other,
        "p_match_count": 12,
        "p_match_threshold": -1,
    })
    if status != 503 or evidence["reason"] != "p_query_embedding_wrong_vector":
        raise AssertionError(evidence)
    status, _payload, evidence = _serve({
        "p_course_id": "levels-of-consciousness",
        "p_query_embedding": good,
        "p_match_count": 12,
        "p_match_threshold": -1,
    })
    if status != 200 or evidence.get("query_vector_sha256") != vector_sha256(good):
        raise AssertionError(evidence)


@test("CORR1.inconsistent_provider_record_cannot_pass")
def _():
    for kwargs in (
        {"http_status": 500},
        {"timeout_class": "DEADLINE"},
        {"transport_error_class": "ConnectionError"},
    ):
        native = build_native_evidence(
            provider_class="DEEPSEEK",
            destination_class="DEEPSEEK_CHAT_COMPLETIONS",
            raw_infrastructure_outcome="PRODUCT_RESPONSE_OBSERVED",
            benchmark_scenario_id="A-0005",
            benchmark_attempt_number=1,
            **kwargs,
        )
        result = adjudicate(native, {"semantic_status": "PASS", "visible_text": "fallback"})
        if result["canonical_benchmark_status"] == "PASS" or result["infra_evidence_dominates"] is not True:
            raise AssertionError(result)
    native = build_native_evidence(
        provider_class="RETRIEVAL",
        destination_class="SUPABASE_LOOPBACK",
        raw_infrastructure_outcome="PRODUCT_RESPONSE_OBSERVED",
        http_status=200,
    )
    native["retrieval_failure"] = True
    result = adjudicate(native, {"semantic_status": "PASS"})
    if result["canonical_benchmark_status"] != "INFRA_FAILURE":
        raise AssertionError(result)
    aggregate = aggregate_attempt_evidence({
        "provider_evidence": build_native_evidence(
            provider_class="DEEPSEEK",
            destination_class="DEEPSEEK_CHAT_COMPLETIONS",
            raw_infrastructure_outcome="PRODUCT_RESPONSE_OBSERVED",
            http_status=500,
        ),
    })
    if aggregate["dominates"] is not True or aggregate["canonical_benchmark_status"] == "PASS":
        raise AssertionError(aggregate)


@test("CORR1.redaction_returns_evidence_without_secret_content")
def _():
    native = build_native_evidence(
        provider_class="DEEPSEEK",
        destination_class="DEEPSEEK_CHAT_COMPLETIONS",
        raw_infrastructure_outcome="PROVIDER_CONNECTION_FAILURE",
        transport_error_class="Bearer secret-token-value sb_secret_example_value",
        provider_request_id="req-synthetic",
        headers={
            "Authorization": "Bearer benchmark-placeholder-not-a-secret",
            "apikey": "sb_secret_benchmark_placeholder",
        },
    )
    encoded = canonical_json(native)
    if "Bearer " in encoded or "sb_secret_" in encoded or "Authorization" in encoded or "apikey" in encoded:
        raise AssertionError(encoded)
    if native.get("provider_request_id") != "req-synthetic":
        raise AssertionError(native)
    if native.get("raw_infrastructure_outcome") != "PROVIDER_CONNECTION_FAILURE":
        raise AssertionError("evidence event was dropped")
    result = adjudicate(native, {"semantic_status": "FAIL"})
    encoded_result = canonical_json(result)
    if "Bearer " in encoded_result or "sb_secret_" in encoded_result:
        raise AssertionError(encoded_result)


@test("CORR1.real_stderr_logging_error_stops")
def _():
    streams = ProcessLifetimeStreams()
    streams.install()

    class ClosedFileHandler(logging.StreamHandler):
        def __init__(self) -> None:
            stream = io.StringIO()
            stream.close()
            super().__init__(stream)

    logger = logging.getLogger("academy.corr1.realstderr")
    handler = ClosedFileHandler()
    logger.addHandler(handler)
    logger.setLevel(logging.ERROR)
    logger.propagate = False
    try:
        logger.error("trigger-real-logging-error")
        streams.note_background_terminated()
        shutdown = streams.shutdown(scenario_ordinal=1)
    finally:
        logger.removeHandler(handler)
    if shutdown["execution_status"] != LOGGING_STOP_CLASS:
        raise AssertionError(shutdown)
    if shutdown["continue_to_next_scenario"] is not False:
        raise AssertionError(shutdown)
    if "--- Logging error ---" not in shutdown["markers"]:
        raise AssertionError(shutdown["markers"])


@test("CORR1.unterminated_thread_forces_stop")
def _():
    release = threading.Event()

    def scenario() -> None:
        threading.Thread(target=lambda: release.wait(30), name="corr1-stuck", daemon=True).start()

    try:
        result = run_attempt_with_streams(scenario, join_timeout=0.2, scenario_ordinal=3)
    finally:
        release.set()
    shutdown = result["shutdown"]
    if shutdown["continue_to_next_scenario"] is not False:
        raise AssertionError(shutdown)
    if result["thread_report"]["fail_closed"] is not True:
        raise AssertionError(result["thread_report"])


@test("CORR1.cancellation_swallower_is_bounded")
def _():
    loop = asyncio.new_event_loop()

    async def swallower() -> None:
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            await asyncio.Future()

    async def body() -> tuple[dict, float]:
        boundary = AttemptBoundary()
        boundary.begin_async()
        loop.create_task(swallower(), name="swallower")
        await asyncio.sleep(0)
        started = time.monotonic()
        report = await boundary.finish_async(join_timeout=0.4)
        return report, time.monotonic() - started

    try:
        report, elapsed = loop.run_until_complete(asyncio.wait_for(body(), timeout=3))
    finally:
        for task in asyncio.all_tasks(loop):
            task.cancel()
        loop.close()
    if elapsed >= 2:
        raise AssertionError(elapsed)
    if report["fail_closed"] is not True or report["continue_to_next_scenario"] is not False:
        raise AssertionError(report)


def _mint_real_unit_context():
    """Mint from installed subsystems. Boolean dicts are not proofs."""
    from execution_infrastructure.pd_f05_loopback import LoopbackSupabaseDouble
    from execution_infrastructure.startup_proofs import issue_inprocess_proofs

    tmp = tempfile.mkdtemp(prefix="academy-corr1-mint-")
    state_path = Path(tmp) / "preload-state.json"
    ledger_path = Path(tmp) / "node-ledger.json"
    env = os.environ.copy()
    for key in (
        "COHERE_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "DEEPSEEK_API_KEY",
        "OPENAI_API_KEY", "BOT_TOKEN",
    ):
        env.pop(key, None)
    env["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
    env["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(state_path)
    env["ACADEMY_NODE_LEDGER_PATH"] = str(ledger_path)
    process = subprocess.Popen(
        ["node", str(PRELOAD_PATH.parent / "corr2_preload_keepalive.cjs")],
        cwd=str(BENCH),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    loopback = LoopbackSupabaseDouble()
    loopback.start()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and not state_path.exists():
        if process.poll() is not None:
            err = process.stderr.read().decode("utf-8", "replace") if process.stderr else ""
            loopback.stop()
            raise RuntimeError(err or "preload keepalive exited")
        time.sleep(0.05)
    if not state_path.exists():
        loopback.stop()
        process.kill()
        raise RuntimeError("preload state missing")
    port = json.loads(state_path.read_text(encoding="utf-8"))["port"]
    profile = "(version 1)\n(allow default)\n(deny network*)\n(allow network-outbound (remote ip \"localhost:*\"))\n"
    proofs = issue_inprocess_proofs(loopback, f"http://127.0.0.1:{port}", profile)
    try:
        mint_controlled_context(proofs)
        minted = True
    except PermissionError:
        minted = False

    def stop() -> None:
        clear_controlled_context()
        loopback.stop()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()

    stop.minted = minted  # type: ignore[attr-defined]
    return stop


@test("CORR1.runner_without_context_fails_closed")
def _():
    clear_controlled_context()
    os.environ["ACADEMY_EXECUTION_READY"] = "1"
    spec = {"scenario_id": "CORR1-GATE"}
    with tempfile.TemporaryDirectory(prefix="academy-gate-") as tmp:
        outcome = run_scenario_once(spec, run_id="corr1", attempt=1, evidence_root=tmp)
        if outcome.verdict != PrimaryVerdict.INFRA_FAILURE or outcome.adapter_invocations != 0:
            raise AssertionError((outcome.verdict, outcome.adapter_invocations, outcome.verdict_reason))
        if outcome.derivation_state.get("continue_to_next_scenario") is not False:
            raise AssertionError(outcome.derivation_state)
        outcomes, _label, aggregate = run_scenario_repeat_set(
            spec, run_id="corr1", evidence_root=tmp, repeats=3,
        )
        if len(outcomes) != 1 or outcomes[0].derivation_state.get("called_run_scenario_once") is not False:
            raise AssertionError(outcomes[0].derivation_state)
        if aggregate != PrimaryVerdict.INFRA_FAILURE:
            raise AssertionError(aggregate)
        try:
            mint_controlled_context({"CONTROLLED_NEXT_MODE": True})
        except PermissionError:
            pass
        else:
            raise AssertionError("partial proofs minted a context")
        if require_controlled_context() is not None:
            raise AssertionError("context active after partial mint")
        try:
            mint_controlled_context({name: True for name in REQUIRED_PROOFS})
        except PermissionError:
            pass
        else:
            raise AssertionError("boolean proofs minted a context")
        if require_controlled_context() is not None:
            raise AssertionError("context active after boolean mint")
        stop_unit = _mint_real_unit_context()
        try:
            if getattr(stop_unit, "minted", True):
                raise AssertionError("unit keepalive and sandbox-exec proofs minted a context")
            if require_controlled_context() is not None:
                raise AssertionError("context active after unit proofs")
            try:
                from execution_infrastructure.controlled_context import permit_scenario_body
                permit_scenario_body()
            except PermissionError:
                pass
            else:
                raise AssertionError("permit_scenario_body succeeded without a real Next context")
            stopped = run_scenario_once(spec, run_id="corr1", attempt=1, evidence_root=tmp)
            if stopped.verdict != PrimaryVerdict.INFRA_FAILURE or stopped.adapter_invocations != 0:
                raise AssertionError((stopped.verdict, stopped.adapter_invocations, stopped.verdict_reason))
            if os.environ.get("ACADEMY_EXECUTION_READY") == "1" and require_controlled_context() is not None:
                raise AssertionError("ready env was treated as the capability")
        finally:
            stop_unit()
            clear_controlled_context()
    try:
        execute_controlled({"run_scenario": True, "scenario_id": "A-0005"})
    except ScenarioExecutionForbidden:
        return
    raise AssertionError("execute_controlled accepted a scenario")


@test("CORR1.source_wires_infrastructure_before_verdict")
def _():
    runner = (BENCH / "harness" / "runner.py").read_text(encoding="utf-8")
    once = runner.split("def run_scenario_once", 1)[1].split("\ndef _unobserved_block", 1)[0]
    normalize_at = once.index("normalize_executed_state")
    for name in ("begin_attempt", "finish_attempt", "apply_infrastructure_precedence"):
        if once.index(name) > normalize_at:
            raise AssertionError(name)
    if "permit_scenario_body" in runner:
        raise AssertionError("runner can permit a scenario body")
    product = (BENCH / "adapters" / "product.py").read_text(encoding="utf-8")
    chat = product.split("def _chat_call", 1)[1].split("def execute", 1)[0]
    if chat.index("arm_chat_request_for_active_attempt") > chat.index("urlopen"):
        raise AssertionError("arm hook is after the chat POST")
    spec = (BENCH / "execution_infrastructure" / "SNAPSHOT_RULE_SPEC.md").read_text(encoding="utf-8")
    if "`followed`" not in spec:
        raise AssertionError("snapshot spec omits followed")
    precedence = apply_infrastructure_precedence(
        infra_failure=False,
        timeout_exceeded=False,
        lifecycle_report={"fail_closed": True, "status": "BACKGROUND_WORK_UNTERMINATED"},
    )
    if precedence["infra_failure"] is not True or precedence["continue_to_next_scenario"] is not False:
        raise AssertionError(precedence)


@test("CORR1.real_product_paths_are_lifecycle_enclosed")
def _():
    venv = CHATBOT_TEST_BASE / "venv" / "bin" / "python"
    if not venv.exists():
        raise AssertionError(f"chatbot venv missing: {venv}")
    before = _tree_fingerprint(CHATBOT_TEST_BASE)
    with tempfile.TemporaryDirectory(prefix="academy-product-life-") as tmp:
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
            [str(venv), "-B", "-m", "execution_infrastructure.pd_f06_product_lifecycle"],
            cwd=tmp,
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if "SYNTHETIC-SENTINEL-NOT-A-CREDENTIAL" in completed.stdout or "SYNTHETIC-SENTINEL-NOT-A-CREDENTIAL" in completed.stderr:
            raise AssertionError("sentinel credential bytes leaked")
        if completed.returncode != 0:
            raise AssertionError(completed.stderr[-2000:] or completed.stdout[-2000:])
        start = completed.stdout.rfind('{"installed"')
        if start < 0:
            raise AssertionError(completed.stdout[-2000:])
        payload = json.loads(completed.stdout[start:])
        # CORR6: this probe has no runner product attempt, so it holds no
        # product authority and public self-mint is rejected. The real
        # methods must be lifecycle-wrapped, loaded through the product-code
        # guard, and fail closed before any side effect. Bound execution of
        # the same methods under the lifecycle boundary is proven by the
        # runner-bound CORR6 topology.
        if payload.get("methods_wrapped") is not True or payload.get("modules_guarded") is not True:
            raise AssertionError(payload)
        if payload.get("self_mint_rejected") is not True or payload.get("authority_installed") is not False:
            raise AssertionError(payload)
        denied = payload.get("unbound_operations_denied") or {}
        if set(denied) != {"construct_outreach", "record_attempt", "update_lead_status", "process_user_turn"}:
            raise AssertionError(payload)
        if not all(value is True for value in denied.values()):
            raise AssertionError(payload)
        if payload.get("db_created") is not False or payload.get("db_dir_entries"):
            raise AssertionError(payload)
        if payload.get("record_boundary_fail_closed") is not False or payload.get("turn_boundary_fail_closed") is not False:
            raise AssertionError(payload)
        if payload.get("credential_open_denied") is not True:
            raise AssertionError(payload)
        if payload.get("sentinel_in_summary") is not False:
            raise AssertionError(payload)
    after = _tree_fingerprint(CHATBOT_TEST_BASE)
    if before != after:
        raise AssertionError("Chatbot TEST_BASE changed during the product lifecycle probe")


def _tree_fingerprint(root: Path) -> str:
    import hashlib
    rows = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name != ".git"]
        for name in filenames:
            path = Path(dirpath) / name
            if path.is_symlink():
                rows.append(f"link:{path.relative_to(root)}:{os.readlink(path)}")
                continue
            if not path.is_file():
                continue
            rows.append(f"file:{path.relative_to(root)}:{path.stat().st_size}")
    return hashlib.sha256("\n".join(sorted(rows)).encode("utf-8")).hexdigest()


def _run_node() -> list[tuple[str, bool, str]]:
    with tempfile.TemporaryDirectory(prefix="academy-corr1-node-") as tmp:
        output = str(Path(tmp) / "results.json")
        env = os.environ.copy()
        for key in (
            "COHERE_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "DEEPSEEK_API_KEY",
            "OPENAI_API_KEY", "BOT_TOKEN",
        ):
            env.pop(key, None)
        env["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        completed = subprocess.run(
            ["node", str(PRELOAD_PATH.parent / "corr1_loopback_probe.cjs"), output],
            cwd=str(BENCH),
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if not Path(output).exists():
            raise RuntimeError(completed.stderr or completed.stdout or "node probe wrote no results")
        payload = json.loads(Path(output).read_text(encoding="utf-8"))
        rows = []
        for item in payload["tests"]:
            rows.append((f"NODE.{item['name']}", bool(item["pass"]), item.get("detail") or ""))
        if payload.get("error") and all(row[1] for row in rows):
            rows.append(("NODE.harness", False, payload["error"]))
        if completed.returncode != 0 and not rows:
            raise RuntimeError(completed.stderr)
        return rows


def main() -> int:
    for fn in TESTS:
        fn()
    try:
        RESULTS.extend(_run_node())
    except Exception as exc:  # noqa: BLE001
        RESULTS.append(("NODE.harness", False, f"{type(exc).__name__}: {exc}"))
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
