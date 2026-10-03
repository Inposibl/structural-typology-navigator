"""CORR5 adapters and the credential dotdot probe.

The internal-cancellation adapter is synthetic. It does not import Chatbot
product code. The dotdot probe uses a disposable tree and never prints the
marker it writes.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from harness.evidence import RawCapture

from adapters.corr4_producers import _success, corr4_registry
from adapters.product import AlexeyUserTurnAdapter, NavigatorL2ChatAdapter

MARKER = "CORR5_DOTDOT_MARKER"


class _Adapter:
    def __init__(self, *, request: Any = None, token: Any = None, spec: Any = None) -> None:
        self.request = request
        self.token = token
        self.spec = spec


class CalibrationWrapAlexey(_Adapter):
    """Calibration label around the real Alexey adapter. Binding stays mandatory."""

    executed = False
    delegates_to = AlexeyUserTurnAdapter

    def execute(self, request: Any) -> RawCapture:
        type(self).executed = True
        return AlexeyUserTurnAdapter().execute(request)


class CalibrationWrapNavigator(_Adapter):
    """Calibration label around the real Navigator L2 adapter."""

    executed = False
    delegates_to = NavigatorL2ChatAdapter
    product_capabilities = ("NAVIGATOR_L2_CHAT", "IMPORTS_CHATBOT_PRODUCT")

    def execute(self, request: Any) -> RawCapture:
        type(self).executed = True
        return NavigatorL2ChatAdapter().execute(request)


class CalibrationWrapLebedev(_Adapter):
    """Calibration label that imports the real Lebedev adapter."""

    executed = False
    product_capabilities = ("LEBEDEV_ADAPTER", "IMPORTS_CHATBOT_PRODUCT")

    def execute(self, request: Any) -> RawCapture:
        type(self).executed = True
        import data_engine.lebedev_adapter  # noqa: F401

        return _success("CalibrationWrapLebedev.execute")


class InternalCancelledAdapter(_Adapter):
    """Raise CancelledError inside asyncio.run, then return a success capture.

    CORR4 converted that None return into PASS. The runner must record the
    lifecycle cancellation and must not return PASS.
    """

    def execute(self, request: Any) -> RawCapture:
        import asyncio

        async def body() -> None:
            raise asyncio.CancelledError()

        asyncio.run(body())
        return _success("InternalCancelledAdapter.execute")


def _row(implementation: str) -> dict[str, Any]:
    return {
        "lane": "CALIBRATION",
        "implementation_class": implementation,
        "provenance_class": "SYNTHETIC_CALIBRATION",
        "native_observables": ["act"],
        "supported_failure_classes": ["CORR4-SYNTHETIC"],
        "real_fault_hooks": [],
    }


def corr5_registry() -> dict[str, Any]:
    registry = corr4_registry()
    registry["adapters"]["corr5_internal_cancel"] = _row(
        "adapters.corr5_producers.InternalCancelledAdapter"
    )
    registry["adapters"]["corr5_wrap_alexey"] = _row(
        "adapters.corr5_producers.CalibrationWrapAlexey"
    )
    registry["adapters"]["corr5_wrap_navigator"] = _row(
        "adapters.corr5_producers.CalibrationWrapNavigator"
    )
    registry["adapters"]["corr5_wrap_lebedev"] = _row(
        "adapters.corr5_producers.CalibrationWrapLebedev"
    )
    return registry


def _denied(path: Any) -> dict[str, bool]:
    from execution_infrastructure.pd_f06_isolation import is_credential_path

    classified = bool(is_credential_path(path))
    try:
        with open(path, "rb") as handle:
            payload = handle.read()
        return {
            "classified": classified,
            "opened": True,
            "leaked": MARKER.encode("utf-8") in payload,
        }
    except PermissionError as exc:
        return {
            "classified": classified,
            "opened": False,
            "leaked": MARKER in str(exc),
        }


def credential_dotdot_probe(root: Path | None = None) -> dict[str, Any]:
    """Filesystem resolution must see symlink-plus-dotdot credential paths.

    The marker is written only so a mistaken read can be detected. The
    returned document contains booleans, not the marker.
    """
    from execution_infrastructure.pd_f06_isolation import events, install_import_guard

    base = root or Path(tempfile.mkdtemp(prefix="academy-corr5-dotdot-"))
    credentials = base / "credentials"
    (credentials / "sub").mkdir(parents=True)
    staging = base / "staging-gcp.json"
    staging.write_text(MARKER, encoding="utf-8")
    os.rename(staging, credentials / "gcp.json")
    (base / "safe.txt").write_text("safe", encoding="utf-8")
    (base / "a").symlink_to(credentials / "sub", target_is_directory=True)
    (base / "linkdir").symlink_to(credentials, target_is_directory=True)
    (base / "l2").symlink_to(base / "linkdir", target_is_directory=True)
    (base / "l3").symlink_to(base / "l2", target_is_directory=True)
    (base / "l4").symlink_to(base / "l3", target_is_directory=True)
    (base / "deep").mkdir()
    (base / "deep" / "link").symlink_to(Path("..") / "credentials" / "sub", target_is_directory=True)
    (base / "cycle-a").symlink_to(Path("cycle-b"))
    (base / "cycle-b").symlink_to(Path("cycle-a"))
    install_import_guard()
    case_text = str(credentials / "gcp.json").replace(
        f"{os.sep}credentials{os.sep}",
        f"{os.sep}Credentials{os.sep}",
    )
    cases = {
        "single_level": base / "linkdir" / "gcp.json",
        "multi_level": base / "l4" / "gcp.json",
        "symlink_dotdot": base / "a" / ".." / "gcp.json",
        "longer_symlink_dotdot": base / "deep" / "link" / ".." / "gcp.json",
        "symlink_cycle": base / "cycle-a" / "gcp.json",
        "bytes_path": os.fsencode(base / "a" / ".." / "gcp.json"),
        "case_variant": case_text,
    }
    before = len(events())
    results = {name: _denied(path) for name, path in cases.items()}
    safe_classified = False
    safe_opened = False
    from execution_infrastructure.pd_f06_isolation import is_credential_path

    safe_classified = bool(is_credential_path(base / "safe.txt"))
    with open(base / "safe.txt", "r", encoding="utf-8") as handle:
        safe_opened = handle.read() == "safe"
    leaked_events = MARKER in repr(events()[before:])
    closed = (
        safe_opened
        and not safe_classified
        and not leaked_events
        and all(row["classified"] and not row["opened"] and not row["leaked"] for row in results.values())
    )
    return {
        "root": str(base),
        "closed": closed,
        "safe_opened": safe_opened,
        "safe_classified": safe_classified,
        "leaked_events": leaked_events,
        "cases": results,
    }
