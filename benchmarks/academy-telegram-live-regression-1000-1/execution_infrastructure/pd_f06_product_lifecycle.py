"""Enclose the real Chatbot side-effect methods in an attempt boundary.

The product modules are not modified on disk. They load through the
product-code guard in product_capability, so every product function checks
runner-owned authority before its body runs. Lifecycle wrappers are then
installed on the classes. Import failure fails closed.

This module never creates product authority. Import permission
(infrastructure_import_scope) is not execution authority.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from .pd_f06_lifecycle import AttemptBoundary

_INSTALLED = False
_IMPORT_HOOK = False


def _publish_report(report: dict[str, Any]) -> None:
    from .attempt_binding import publish_lifecycle_report

    publish_lifecycle_report(report)


def bind_loaded_data_engine_module(_module: Any = None) -> list[str]:
    """Wrap the classes currently loaded in sys.modules.

    Called after a TEST_BASE reload so the fresh class objects are covered.
    """
    install_rebind_hook()
    wrapped: list[str] = []
    outreach = sys.modules.get("data_engine.outreach")
    adapter = sys.modules.get("data_engine.lebedev_adapter")
    if outreach is not None and hasattr(outreach, "OutreachHistoryManager"):
        wrapped.append(_wrap_sync(outreach.OutreachHistoryManager, "record_attempt"))
        wrapped.append(_wrap_sync(outreach.OutreachHistoryManager, "update_lead_status"))
    if adapter is not None and hasattr(adapter, "LebedevNavigatorAdapter"):
        wrapped.append(_wrap_async_turn(adapter.LebedevNavigatorAdapter))
    return wrapped


def install_rebind_hook() -> None:
    """Re-wrap data_engine classes every time the package is imported."""
    global _IMPORT_HOOK
    import builtins

    current = builtins.__import__
    if getattr(current, "_academy_rebind", False):
        _IMPORT_HOOK = True
        return

    def hooked(name: str, globals: Any = None, locals: Any = None, fromlist: Any = (), level: int = 0) -> Any:
        if isinstance(name, str) and (name == "data_engine" or name.startswith("data_engine.")):
            from .product_capability import require_product_import_permission

            require_product_import_permission()
        module = current(name, globals, locals, fromlist, level)
        if isinstance(name, str) and (name == "data_engine" or name.startswith("data_engine.")):
            bind_targets()
        return module

    def bind_targets() -> None:
        outreach = sys.modules.get("data_engine.outreach")
        adapter = sys.modules.get("data_engine.lebedev_adapter")
        if outreach is not None and hasattr(outreach, "OutreachHistoryManager"):
            _wrap_sync(outreach.OutreachHistoryManager, "record_attempt")
            _wrap_sync(outreach.OutreachHistoryManager, "update_lead_status")
        if adapter is not None and hasattr(adapter, "LebedevNavigatorAdapter"):
            _wrap_async_turn(adapter.LebedevNavigatorAdapter)

    hooked._academy_rebind = True  # type: ignore[attr-defined]
    builtins.__import__ = hooked
    _IMPORT_HOOK = True


def ensure_product_wrappers(chatbot_root: str | Path) -> dict[str, Any]:
    """Insert TEST_BASE and wrap the three real side-effect methods.

    The real network and credential guards must already be installed. This
    function does not treat a classifier result as that installation.
    """
    global _INSTALLED
    from .pd_f06_isolation import import_guard_installed, network_guard_installed

    if not network_guard_installed() or not import_guard_installed():
        raise RuntimeError("PYTHON_ISOLATION_NOT_INSTALLED_BEFORE_PRODUCT_IMPORT")
    sys.dont_write_bytecode = True
    root = str(Path(chatbot_root))
    if root not in sys.path:
        sys.path.insert(0, root)
    from .product_capability import install_product_code_guard

    install_product_code_guard()
    install_rebind_hook()
    try:
        from .product_capability import infrastructure_import_scope

        with infrastructure_import_scope():
            from data_engine.lebedev_adapter import LebedevNavigatorAdapter
            from data_engine.outreach import OutreachHistoryManager
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"PRODUCT_LIFECYCLE_UNAVAILABLE: {type(exc).__name__}: {exc}") from exc
    wrapped = bind_loaded_data_engine_module()
    if not wrapped:
        wrapped = [
            _wrap_sync(OutreachHistoryManager, "record_attempt"),
            _wrap_sync(OutreachHistoryManager, "update_lead_status"),
            _wrap_async_turn(LebedevNavigatorAdapter),
        ]
    _INSTALLED = True
    return {
        "ok": True,
        "wrapped": wrapped,
        "fail_closed_on_import_error": True,
        "guards_installed_before_import": True,
    }


def _wrap_sync(cls: type, name: str) -> str:
    original = getattr(cls, name)
    if getattr(original, "_academy_lifecycle_wrapped", False):
        return f"{cls.__name__}.{name}"

    def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
        boundary = AttemptBoundary()
        boundary.begin()
        try:
            return original(self, *args, **kwargs)
        finally:
            wrapper.last_report = boundary.finish(join_timeout=2.0)
            if isinstance(wrapper.last_report, dict):
                _publish_report(wrapper.last_report)

    wrapper._academy_lifecycle_wrapped = True  # type: ignore[attr-defined]
    wrapper.last_report = None  # type: ignore[attr-defined]
    setattr(cls, name, wrapper)
    return f"{cls.__name__}.{name}"


def run_product_lifecycle_probe() -> dict[str, Any]:
    """Prove the real Chatbot methods are wrapped and fail closed unbound.

    This probe has no runner product attempt, so it has no product
    authority. It checks that the lifecycle wrappers are installed on the
    real classes, that public self-mint is rejected, and that each real
    product operation fails before its first side effect. Bound execution of
    the same methods is proven by the runner-bound topology.

    Call this only from a disposable cwd. Credential file bytes are never printed.
    """
    import json
    import os
    import tempfile
    from pathlib import Path

    from .pd_f06_isolation import events, install_import_guard, install_network_guard
    from .product_capability import (
        ProductBindingRequired,
        authority_installed,
        infrastructure_import_scope,
        mint_accepted_authority,
        module_is_guarded,
    )

    sys.dont_write_bytecode = True
    sentinel = "SYNTHETIC-SENTINEL-NOT-A-CREDENTIAL"
    cred = Path("credentials")
    cred.mkdir(exist_ok=True)
    cred_file = cred / "gcp_service_account.json"
    cred_file.write_text(sentinel + "\n", encoding="utf-8")
    os.environ["GCP_CREDENTIALS_PATH"] = str(cred_file)
    install_import_guard()
    install_network_guard()
    try:
        mint_accepted_authority("lifecycle-probe")
        self_mint_rejected = False
    except ProductBindingRequired:
        self_mint_rejected = True
    root = os.environ["ACADEMY_CHATBOT_ROOT"]
    db_dir = Path(tempfile.mkdtemp(prefix="academy-lifecycle-db-"))
    db = db_dir / "outreach.sqlite"
    installed = ensure_product_wrappers(root)
    with infrastructure_import_scope():
        from data_engine.lebedev_adapter import LebedevNavigatorAdapter
        from data_engine.outreach import OutreachHistoryManager

    denied: dict[str, bool] = {}

    def attempt(name: str, fn: Any) -> None:
        try:
            fn()
            denied[name] = False
        except ProductBindingRequired:
            denied[name] = True

    import asyncio

    attempt("construct_outreach", lambda: OutreachHistoryManager(db_path=db))
    attempt("record_attempt", lambda: OutreachHistoryManager.record_attempt(
        object(), 9002, "corr1", "Corr", "local", "synthetic", "SENT", None))
    attempt("update_lead_status", lambda: OutreachHistoryManager.update_lead_status(
        object(), 9002, "SENT", error_message=None, sync_to_sheets=False))
    attempt("process_user_turn", lambda: asyncio.run(
        LebedevNavigatorAdapter.process_user_turn(object(), 9001, "hello", 1)))
    credential_open_denied = False
    try:
        with open(cred_file, "rb") as handle:
            handle.read()
    except PermissionError:
        credential_open_denied = True
    credential_event = any(
        item.get("operation") == "audit.open" or item.get("reason") == "CREDENTIAL_DISCOVERY_DENIED"
        for item in events()
    )
    record_report = getattr(OutreachHistoryManager.record_attempt, "last_report", None) or {}
    turn_report = getattr(LebedevNavigatorAdapter.process_user_turn, "last_report", None) or {}
    summary = {
        "installed": installed,
        "self_mint_rejected": self_mint_rejected,
        "authority_installed": authority_installed(),
        "unbound_operations_denied": denied,
        "db_created": db.exists(),
        "db_dir_entries": sorted(item.name for item in db_dir.iterdir()),
        "modules_guarded": all(
            module_is_guarded(sys.modules[name])
            for name in ("data_engine.lebedev_adapter", "data_engine.outreach")
        ),
        "methods_wrapped": all(
            getattr(method, "_academy_lifecycle_wrapped", False)
            for method in (
                OutreachHistoryManager.record_attempt,
                OutreachHistoryManager.update_lead_status,
                LebedevNavigatorAdapter.process_user_turn,
            )
        ),
        "record_boundary_fail_closed": record_report.get("fail_closed"),
        "turn_boundary_fail_closed": turn_report.get("fail_closed"),
        "credential_open_denied": credential_open_denied and credential_event,
    }
    blob = json.dumps(summary, ensure_ascii=False, default=str)
    summary["sentinel_in_summary"] = sentinel in blob
    summary["summary_has_secret_markers"] = "sb_secret_" in blob or "Bearer " in blob
    return summary


def _wrap_async_turn(cls: type) -> str:
    original = cls.process_user_turn
    if getattr(original, "_academy_lifecycle_wrapped", False):
        return f"{cls.__name__}.process_user_turn"

    async def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
        boundary = AttemptBoundary()
        boundary.begin_async()
        try:
            return await original(self, *args, **kwargs)
        finally:
            wrapper.last_report = await boundary.finish_async(join_timeout=2.0)
            if isinstance(wrapper.last_report, dict):
                _publish_report(wrapper.last_report)

    wrapper._academy_lifecycle_wrapped = True  # type: ignore[attr-defined]
    wrapper.last_report = None  # type: ignore[attr-defined]
    setattr(cls, "process_user_turn", wrapper)
    return f"{cls.__name__}.process_user_turn"


def prove_wrappers_survive_reload() -> dict[str, Any]:
    """Reload data_engine the way the product adapter does and re-check wrappers."""
    import os

    from .pd_f06_isolation import install_import_guard, install_network_guard

    install_network_guard()
    install_import_guard()
    from .product_capability import infrastructure_import_scope, module_is_guarded

    root = os.environ["ACADEMY_CHATBOT_ROOT"]
    ensure_product_wrappers(root)
    with infrastructure_import_scope():
        from data_engine.lebedev_adapter import LebedevNavigatorAdapter
        from data_engine.outreach import OutreachHistoryManager

    before = all(
        getattr(method, "_academy_lifecycle_wrapped", False)
        for method in (
            OutreachHistoryManager.record_attempt,
            OutreachHistoryManager.update_lead_status,
            LebedevNavigatorAdapter.process_user_turn,
        )
    )
    from adapters.product import _load_package_module

    with infrastructure_import_scope():
        outreach, outreach_error = _load_package_module(root, "data_engine", "outreach")
        adapter, adapter_error = _load_package_module(root, "data_engine", "lebedev_adapter")
    live_outreach = sys.modules.get("data_engine.outreach")
    live_adapter = sys.modules.get("data_engine.lebedev_adapter")

    def _wrapped(module: Any, cls_name: str, method_name: str) -> bool:
        cls = getattr(module, cls_name, None)
        method = getattr(cls, method_name, None)
        return bool(getattr(method, "_academy_lifecycle_wrapped", False))

    return {
        "before_wrapped": before,
        "outreach_error": outreach_error,
        "adapter_error": adapter_error,
        "returned_record_wrapped": _wrapped(outreach, "OutreachHistoryManager", "record_attempt"),
        "returned_update_wrapped": _wrapped(outreach, "OutreachHistoryManager", "update_lead_status"),
        "returned_turn_wrapped": _wrapped(adapter, "LebedevNavigatorAdapter", "process_user_turn"),
        "live_record_wrapped": _wrapped(live_outreach, "OutreachHistoryManager", "record_attempt"),
        "live_update_wrapped": _wrapped(live_outreach, "OutreachHistoryManager", "update_lead_status"),
        "live_turn_wrapped": _wrapped(live_adapter, "LebedevNavigatorAdapter", "process_user_turn"),
        "reloaded_modules_guarded": bool(
            outreach is not None and adapter is not None
            and module_is_guarded(outreach) and module_is_guarded(adapter)
        ),
    }


if __name__ == "__main__":
    import json

    sys.dont_write_bytecode = True
    if "--corr2-reload" in sys.argv:
        sys.stdout.write(json.dumps(prove_wrappers_survive_reload(), ensure_ascii=False))
    else:
        sys.stdout.write(json.dumps(run_product_lifecycle_probe(), ensure_ascii=False))

