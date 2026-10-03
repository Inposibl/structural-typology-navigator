"""CORR6 probe adapters.

Product-backed adapters declare their product capabilities, so the runner
binds them, attests the Chatbot and Navigator TEST_BASEs, and installs the
runner-owned product authority before execute() runs.

Calibration wrappers declare nothing. They try to reach real Chatbot code
through every indirection in the CORR6 wrapper matrix. Each records whether
a product side effect happened. None of them may succeed.
"""

from __future__ import annotations

import asyncio
import os
import sqlite3
import sys
import tempfile
import types
from pathlib import Path
from typing import Any, Callable

from harness.evidence import RawCapture

from adapters.corr4_producers import _success, corr4_registry
from adapters.product import AlexeyUserTurnAdapter

RESULTS: dict[str, Any] = {}
HOOKS: dict[str, Callable[[], Any]] = {}

_PRODUCT_CAPS = (
    "ALEXEY_USER_TURN",
    "IMPORTS_CHATBOT_PRODUCT",
    "TIKHON_TEST_ROOT",
    "LEBEDEV_ADAPTER",
)


class _Adapter:
    def __init__(self, *, request: Any = None, token: Any = None, spec: Any = None) -> None:
        self.request = request
        self.token = token
        self.spec = spec


def _root() -> str:
    from execution_infrastructure.constants import CHATBOT_TEST_BASE

    return str(CHATBOT_TEST_BASE)


def _inner_request(request: Any, *, transport: str, pause_s: float | None = None, env: dict | None = None):
    from harness.execution_request import build_execution_request

    pre: dict[str, Any] = {"navigator_transport": transport, "user_id": 701006, "message_id": 21}
    spec: dict[str, Any] = {
        "scenario_id": str(getattr(request, "scenario_id", "CORR6-PROBE")),
        "track": "ALEXEY_INBOUND",
        "execution_level": "L2",
        "adapter_id": "alexey_user_turn",
        "turns": [{"role": "user", "content": "local synthetic corr6 probe"}],
        "preconditions": pre,
        "state_setup": {},
        "fault_schedule": [],
    }
    if pause_s:
        pre["concurrency_schedule"] = {"provider_pause_s": pause_s}
        spec["provider_fixture"] = {"contention_schedule": {"provider_pause_s": pause_s}}
    return build_execution_request(
        spec,
        adapter_id="alexey_user_turn",
        run_id=str(getattr(request, "run_id", "corr6")),
        attempt=int(getattr(request, "attempt", 1)),
        scenario_sha256="e" * 64,
        navigator_test_root=str(getattr(request, "navigator_test_root", "") or _root()),
        tikhon_test_root=_root(),
        execution_environment=env or {},
    )


def _load(module: str) -> Any:
    from adapters.product import _load_package_module

    mod, err = _load_package_module(_root(), "data_engine", module)
    if mod is None:
        raise RuntimeError(err or "module load failed")
    return mod


# ---------------------------------------------------------------------------
# Runner-bound product adapters
# ---------------------------------------------------------------------------

class BoundLifecycleProbeAdapter(_Adapter):
    """Real record_attempt, update_lead_status, and process_user_turn under authority.

    This is the bound half of the CORR1 lifecycle probe. The Navigator core
    call is a local synthetic coroutine. Lifecycle reports are recorded.
    """

    product_capabilities = _PRODUCT_CAPS
    requires_authenticated_product_binding = True

    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure.product_capability import authority_snapshot

        outreach = _load("outreach")
        lebedev = _load("lebedev_adapter")
        session = _load("session_store")
        tmp = Path(tempfile.mkdtemp(prefix="academy-corr6-lifecycle-"))
        manager = outreach.OutreachHistoryManager(db_path=tmp / "outreach.sqlite")
        manager.record_attempt(9002, "corr6", "Corr", "local", "synthetic", "SENT", None)
        record_report = getattr(outreach.OutreachHistoryManager.record_attempt, "last_report", None) or {}
        manager.update_lead_status(9002, "SENT", error_message=None, sync_to_sheets=False)
        store = session.TelegramSessionStore(db_path=tmp / "sessions.sqlite")
        adapter = lebedev.LebedevNavigatorAdapter(
            api_url="http://127.0.0.1:9/api/chat",
            session_store=store,
            outreach_manager=manager,
        )

        async def fake_core(**_kwargs: Any) -> dict[str, Any]:
            return {"message": "synthetic local reply", "profile": {}, "conversationState": {}}

        adapter.call_navigator_core = fake_core  # type: ignore[method-assign]
        replies = asyncio.run(adapter.process_user_turn(9001, "hello from corr6", 1))
        turn_report = getattr(lebedev.LebedevNavigatorAdapter.process_user_turn, "last_report", None) or {}
        rows = sqlite3.connect(str(tmp / "outreach.sqlite")).execute(
            "select count(*) from sqlite_master"
        ).fetchone()[0]
        RESULTS["bound_lifecycle"] = {
            "record_fail_closed": record_report.get("fail_closed"),
            "record_created_threads": record_report.get("created_thread_count"),
            "record_remaining_threads": record_report.get("remaining_thread_count"),
            "turn_fail_closed": turn_report.get("fail_closed"),
            "turn_executor_closed": turn_report.get("executor_closed"),
            "turn_remaining_tasks": turn_report.get("remaining_task_count"),
            "turn_reply_count": len(replies) if isinstance(replies, list) else None,
            "sqlite_objects": rows,
            "authority": {k: v for k, v in (authority_snapshot() or {}).items() if k != "token_digest"},
        }
        return _success("BoundLifecycleProbeAdapter.execute")


class BoundRealLocalArmProbeAdapter(_Adapter):
    """Real Alexey turn in real_local mode. The arm must precede the transport.

    The class transport is replaced by a local coroutine that records the
    Node and loopback armed identity it observes. Nothing leaves the host.
    """

    product_capabilities = _PRODUCT_CAPS
    requires_authenticated_product_binding = True

    def execute(self, request: Any) -> RawCapture:
        import adapters.product as product
        from adapters.corr4_producers import _control
        from execution_infrastructure.attempt_binding import active_loopback, armed_request_identity

        observed: list[dict[str, Any]] = []
        real_load = product._load_package_module

        def wrapped_load(root: Any, package: str, module: str):
            mod, err = real_load(root, package, module)
            if err is None and module == "lebedev_adapter":
                async def transport(self: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
                    import json
                    import urllib.request

                    with urllib.request.urlopen(_control() + "/health", timeout=5) as response:
                        node = (json.loads(response.read().decode("utf-8")) or {}).get("armed") or {}
                    loop = getattr(active_loopback(), "armed", None) or {}
                    observed.append({
                        "node": dict(node),
                        "loopback": dict(loop),
                        "runner": dict(armed_request_identity() or {}),
                    })
                    return {"message": "local-synthetic", "profile": {}, "conversationState": {}}

                mod.LebedevNavigatorAdapter.call_navigator_core = transport
            return mod, err

        product._load_package_module = wrapped_load
        try:
            inner = _inner_request(
                request,
                transport="real_local",
                env={"navigator_l2_base_url": "http://127.0.0.1:9"},
            )
            capture = AlexeyUserTurnAdapter().execute(inner)
        finally:
            product._load_package_module = real_load
        RESULTS["real_local_arm"] = {
            "observed": observed,
            "capture_error": getattr(capture, "capture_error", None),
            "outcome_class": getattr(capture, "outcome_class", None),
        }
        return capture


class BoundAuthorityProbeAdapter(_Adapter):
    """Exercise the authority once and keep references for a later replay."""

    product_capabilities = _PRODUCT_CAPS
    requires_authenticated_product_binding = True

    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure.product_capability import authority_snapshot

        outreach = _load("outreach")
        tmp = Path(tempfile.mkdtemp(prefix="academy-corr6-authority-"))
        outreach.OutreachHistoryManager(db_path=tmp / "bound.sqlite")
        RESULTS["bound_authority"] = {
            "bound_call_ok": (tmp / "bound.sqlite").exists(),
            "snapshot": {k: v for k, v in (authority_snapshot() or {}).items() if k != "token_digest"},
        }
        # References a malicious adapter could keep past the attempt.
        RESULTS["kept_class"] = outreach.OutreachHistoryManager
        RESULTS["kept_method"] = outreach.OutreachHistoryManager.record_attempt
        RESULTS["kept_module"] = outreach
        return _success("BoundAuthorityProbeAdapter.execute")


class BoundReplayInSecondAttemptAdapter(_Adapter):
    """A second bound attempt. Product calls work with its own authority."""

    product_capabilities = _PRODUCT_CAPS
    requires_authenticated_product_binding = True

    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure.product_capability import authority_snapshot

        RESULTS["second_attempt"] = {
            "snapshot": {k: v for k, v in (authority_snapshot() or {}).items() if k != "token_digest"},
        }
        return _success("BoundReplayInSecondAttemptAdapter.execute")


class BoundGenerationChangeAdapter(_Adapter):
    """Inside a bound attempt, a new controlled generation replaces the old one.

    The topology hook launches a second real Next, issues its proofs, and
    mints a new context. The authority installed for the first generation
    must not authorize a product call after that.
    """

    product_capabilities = _PRODUCT_CAPS
    requires_authenticated_product_binding = True

    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure.product_capability import ProductBindingRequired

        outreach = _load("outreach")
        tmp = Path(tempfile.mkdtemp(prefix="academy-corr6-generation-"))
        outreach.OutreachHistoryManager(db_path=tmp / "before.sqlite")
        before = (tmp / "before.sqlite").exists()
        hook = HOOKS.get("relaunch")
        relaunch = hook() if hook is not None else {"ok": False, "reason": "no hook"}
        denied_reason = None
        try:
            outreach.OutreachHistoryManager(db_path=tmp / "after.sqlite")
        except ProductBindingRequired as exc:
            denied_reason = str(exc)
        RESULTS["generation_change"] = {
            "before_call_ok": before,
            "relaunch": relaunch,
            "after_denied_reason": denied_reason,
            "after_side_effect": (tmp / "after.sqlite").exists(),
        }
        return _success("BoundGenerationChangeAdapter.execute")


class BoundCaptureCapabilityAdapter(_Adapter):
    """Attempt A: keep this attempt's runner capability, as an adversary would."""

    product_capabilities = _PRODUCT_CAPS
    requires_authenticated_product_binding = True

    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure import product_capability as pc

        captured = pc._current_attempt()
        RESULTS["captured_capability"] = captured
        RESULTS["captured_token"] = self.token
        RESULTS["capture"] = {
            "captured_capability_id": getattr(captured, "capability_id", None),
            "authority_valid_in_a": pc.authority_installed(),
        }
        return _success("BoundCaptureCapabilityAdapter.execute")


def _replay_rows(token: Any) -> dict[str, Any]:
    from execution_infrastructure import product_capability as pc

    captured = RESULTS.get("captured_capability")
    rows: dict[str, Any] = {"captured_present": captured is not None}

    def attempt(label: str, call: Callable[[], Any]) -> None:
        try:
            call()
            rows[label] = "ACCEPTED"
        except pc.ProductBindingRequired as exc:
            rows[label] = f"REJECTED: {exc}"

    attempt("install_with_previous_attempt_capability", lambda: pc.install_product_authority(token, captured))
    current = pc._current_attempt()
    if current is not None:
        attempt("install_with_current_capability_from_adapter", lambda: pc.install_product_authority(token, current))
    attempt("begin_from_adapter", lambda: pc.begin_runner_product_attempt(
        scenario_id="CORR6-REPLAY", attempt_number=1, run_id="x"))
    rows["current_capability_id"] = getattr(current, "capability_id", None)
    return rows


class BoundReplayCapabilityAdapter(_Adapter):
    """Attempt B (bound): the capability kept from A must not install authority."""

    product_capabilities = _PRODUCT_CAPS
    requires_authenticated_product_binding = True

    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure import product_capability as pc

        rows = _replay_rows(self.token)
        rows["own_authority_still_valid"] = pc.authority_installed()
        RESULTS["replay_bound"] = rows
        return _success("BoundReplayCapabilityAdapter.execute")


class UnboundReplayCapabilityAdapter(_Adapter):
    """Attempt C (calibration, no authority): replay A's capability, then call product."""

    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure import product_capability as pc

        rows = _replay_rows(RESULTS.get("captured_token"))
        db = _side_effect_db()
        try:
            sys.modules["data_engine.outreach"].OutreachHistoryManager(db_path=db)
            rows["product_call_after_replay"] = "EXECUTED"
        except pc.ProductBindingRequired as exc:
            rows["product_call_after_replay"] = f"DENIED: {exc}"
        rows["side_effect"] = db.exists()
        rows["authority_installed"] = pc.authority_installed()
        RESULTS["replay_unbound"] = rows
        return _success("UnboundReplayCapabilityAdapter.execute")


# ---------------------------------------------------------------------------
# Calibration wrapper matrix (no declarations, no binding)
# ---------------------------------------------------------------------------

def _side_effect_db() -> Path:
    return Path(tempfile.mkdtemp(prefix="academy-corr6-wrap-")) / "o.sqlite"


def _record(tag: str, fn: Callable[[], Any], db: Path | None = None) -> RawCapture:
    from execution_infrastructure.product_capability import ProductBindingRequired

    row: dict[str, Any] = {"product_returned": False, "denied": None, "error": None}
    try:
        fn()
        row["product_returned"] = True
    except ProductBindingRequired as exc:
        row["denied"] = str(exc)
    except Exception as exc:  # noqa: BLE001 — recorded, then re-raised for the runner
        row["error"] = f"{type(exc).__name__}: {exc}"[:300]
    if db is not None:
        row["side_effect"] = db.exists()
    RESULTS.setdefault("wrap", {})[tag] = row
    if row["denied"]:
        raise ProductBindingRequired(row["denied"])
    return _success(f"wrap.{tag}")


def _alexey(factory: Callable[[], Any], request: Any) -> Any:
    capture = factory().execute(_inner_request(request, transport="stubbed"))
    if getattr(capture, "capture_error", None):
        raise RuntimeError(capture.capture_error)
    return capture


def _helper() -> Any:
    return AlexeyUserTurnAdapter()


class WrapPlain(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        return _record("plain", lambda: _alexey(AlexeyUserTurnAdapter, request))


class WrapHelper(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        return _record("helper", lambda: _alexey(_helper, request))


class WrapLambda(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        return _record("lambda", lambda: _alexey((lambda: (lambda: AlexeyUserTurnAdapter()))(), request))


class WrapFactory(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        def factory() -> Callable[[], Any]:
            return lambda: AlexeyUserTurnAdapter()

        return _record("factory", lambda: _alexey(factory(), request))


class WrapDynamic(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        dynamic = type("Dyn", (AlexeyUserTurnAdapter,), {"lane_label": "SYNTHETIC"})
        return _record("dynamic", lambda: _alexey(dynamic, request))


class WrapSubclass(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        class Sub(AlexeyUserTurnAdapter):
            def execute(self, req: Any) -> Any:
                return super().execute(req)

        return _record("subclass", lambda: _alexey(Sub, request))


class WrapClosure(_Adapter):
    """Extract the unsealed execute from the seal closure and call it."""

    def execute(self, request: Any) -> RawCapture:
        guarded = AlexeyUserTurnAdapter.execute
        cells = [cell.cell_contents for cell in (guarded.__closure__ or ())]
        original = [item for item in cells if callable(item) and getattr(item, "__name__", "") == "execute"][0]
        return _record(
            "closure",
            lambda: _alexey(lambda: types.SimpleNamespace(execute=lambda req: original(AlexeyUserTurnAdapter(), req)), request),
        )


class WrapDirectImport(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        root = _root()

        def go() -> None:
            if root not in sys.path:
                sys.path.insert(0, root)
            import data_engine.lebedev_adapter  # noqa: F401

        return _record("direct_import", go)


class WrapImportScope(_Adapter):
    """Public import scope, then a real product call."""

    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure.product_capability import infrastructure_import_scope

        db = _side_effect_db()

        def go() -> None:
            root = _root()
            if root not in sys.path:
                sys.path.insert(0, root)
            with infrastructure_import_scope():
                import data_engine.outreach as outreach
            outreach.OutreachHistoryManager(db_path=db).record_attempt(
                9101, "corr6", "C", "local", "synthetic", "SENT", None)

        return _record("import_scope", go, db)


class WrapCachedModule(_Adapter):
    """sys.modules['data_engine.outreach'] after an earlier load."""

    def execute(self, request: Any) -> RawCapture:
        db = _side_effect_db()

        def go() -> None:
            module = sys.modules.get("data_engine.outreach")
            if module is None:
                raise RuntimeError("CACHED_MODULE_ABSENT")
            module.OutreachHistoryManager(db_path=db).record_attempt(
                9102, "corr6", "C", "local", "synthetic", "SENT", None)

        return _record("cached_module", go, db)


class WrapDirectOutreach(_Adapter):
    """Unbound call on the class method itself."""

    def execute(self, request: Any) -> RawCapture:
        db = _side_effect_db()

        def go() -> None:
            module = sys.modules.get("data_engine.outreach")
            if module is None:
                raise RuntimeError("CACHED_MODULE_ABSENT")
            module.OutreachHistoryManager.record_attempt(
                types.SimpleNamespace(db_path=db), 9103, "corr6", "C", "local", "synthetic", "SENT", None)

        return _record("direct_outreach", go, db)


class WrapDirectLebedev(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        def go() -> None:
            module = sys.modules.get("data_engine.lebedev_adapter")
            if module is None:
                raise RuntimeError("CACHED_MODULE_ABSENT")
            asyncio.run(module.LebedevNavigatorAdapter.process_user_turn(object(), 9104, "x", 1))

        return _record("direct_lebedev", go)


class WrapSelfMint(_Adapter):
    def execute(self, request: Any) -> RawCapture:
        from execution_infrastructure.product_capability import mint_accepted_authority

        def go() -> None:
            mint_accepted_authority("corr6-self-mint")
            _alexey(AlexeyUserTurnAdapter, request)

        return _record("self_mint", go)


class WrapKeptReference(_Adapter):
    """Call references kept from an earlier bound attempt."""

    def execute(self, request: Any) -> RawCapture:
        db = _side_effect_db()

        def go() -> None:
            cls = RESULTS.get("kept_class")
            if cls is None:
                raise RuntimeError("NO_KEPT_REFERENCE")
            cls(db_path=db)

        return _record("kept_reference", go, db)


class WrapLoaderBypass(_Adapter):
    """Load product source outside the guarded loader."""

    def execute(self, request: Any) -> RawCapture:
        import importlib.util

        path = os.path.join(_root(), "data_engine", "outreach.py")

        def go() -> None:
            spec = importlib.util.spec_from_file_location("corr6_outreach_copy", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)  # type: ignore[union-attr]

        return _record("loader_bypass", go)


class WrapSourceRecompile(_Adapter):
    """Compile accepted product source under a foreign filename."""

    def execute(self, request: Any) -> RawCapture:
        path = os.path.join(_root(), "data_engine", "outreach.py")

        def go() -> None:
            with open(path, "rb") as handle:
                source = handle.read()
            namespace: dict[str, Any] = {"__name__": "corr6_recompiled"}
            exec(compile(source, "<corr6-foreign>", "exec"), namespace)  # noqa: S102

        return _record("source_recompile", go)


WRAPPERS = {
    "plain": "WrapPlain",
    "helper": "WrapHelper",
    "lambda": "WrapLambda",
    "factory": "WrapFactory",
    "dynamic": "WrapDynamic",
    "subclass": "WrapSubclass",
    "closure": "WrapClosure",
    "direct_import": "WrapDirectImport",
    "import_scope": "WrapImportScope",
    "cached_module": "WrapCachedModule",
    "direct_outreach": "WrapDirectOutreach",
    "direct_lebedev": "WrapDirectLebedev",
    "self_mint": "WrapSelfMint",
    "kept_reference": "WrapKeptReference",
    "loader_bypass": "WrapLoaderBypass",
    "source_recompile": "WrapSourceRecompile",
}


class PythonViolationSecretsAdapter(_Adapter):
    """Denied Python network calls whose host and reason carry secret shapes."""

    def execute(self, request: Any) -> RawCapture:
        import socket

        for host in (
            "sk-abcdefghijklmnopqrstuvwxyz.example.com",
            "sb_secret_corr6placeholder.example.com",
        ):
            try:
                socket.getaddrinfo(host, 443)
            except Exception:  # noqa: BLE001 — the deny is the evidence
                pass
        from execution_infrastructure.pd_f06_isolation import _record

        _record({
            "operation": "python.synthetic",
            "decision": "deny",
            "host": "Bearer CORR6SECRETTOKEN",
            "destination": "https://user:sb_secret_corr6destination@example.com/",
            "reason": "Authorization: Basic Y29ycjY6c2VjcmV0",
            "error": "connect failed api_key=sk-corr6errorvalue0000",
            "nested": {"inner": {"token": "Bearer CORR6NESTED", "list": ["sk-corr6listelement0000"]}},
            "text": "free text sb_secret_corr6freetext Bearer CORR6FREE",
        })
        return _success("PythonViolationSecretsAdapter.execute")


def _calibration_row(implementation: str) -> dict[str, Any]:
    return {
        "lane": "CALIBRATION",
        "implementation_class": implementation,
        "provenance_class": "SYNTHETIC_CALIBRATION",
        "native_observables": ["act"],
        "supported_failure_classes": ["CORR4-SYNTHETIC"],
        "real_fault_hooks": [],
    }


def corr6_registry() -> dict[str, Any]:
    registry = corr4_registry()
    for name in (
        "BoundLifecycleProbeAdapter",
        "BoundRealLocalArmProbeAdapter",
        "BoundAuthorityProbeAdapter",
        "BoundReplayInSecondAttemptAdapter",
        "BoundGenerationChangeAdapter",
        "BoundCaptureCapabilityAdapter",
        "BoundReplayCapabilityAdapter",
        "UnboundReplayCapabilityAdapter",
        "PythonViolationSecretsAdapter",
    ):
        registry["adapters"]["corr6_" + name] = _calibration_row("adapters.corr6_producers." + name)
    for tag, name in WRAPPERS.items():
        registry["adapters"]["corr6_wrap_" + tag] = _calibration_row("adapters.corr6_producers." + name)
    return registry

