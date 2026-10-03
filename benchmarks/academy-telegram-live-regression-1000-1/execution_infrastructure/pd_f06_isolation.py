"""PD-F06 benchmark-side default-deny isolation.

Installed before any side-effect-capable Chatbot import. Credential files are
refused by path pattern. File contents are not read to prove absence. Google,
Sheets, OAuth, Telegram, Cohere, Supabase, and every other non-loopback
destination are denied before DNS.
"""

from __future__ import annotations

import builtins
import fnmatch
import io
import ipaddress
import os
import socket
import sys
from pathlib import Path
from typing import Any

_CREDENTIAL_NAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    "gcp_service_account.json",
    "gcp-key.json",
    "client_secret.json",
    "credentials.json",
    "token.json",
    "service-account.json",
    "service_account.json",
}
_GOOGLE_SUFFIXES = (
    "googleapis.com",
    "google.com",
    "gstatic.com",
)
_DENY_EXACT = {
    "oauth2.googleapis.com",
    "sheets.googleapis.com",
    "www.googleapis.com",
    "api.telegram.org",
    "api.cohere.com",
    "api.deepseek.com",
    "suggestions.dadata.ru",
    "structural-typology-navigator.vercel.app",
}

_state: dict[str, Any] = {
    "open_installed": False,
    "network_installed": False,
    "events": [],
    "originals": {},
}


def _normalize_host(host: str | None) -> str:
    if not host:
        return ""
    text = str(host).strip().lower().rstrip(".")
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    return text


def _is_exact_loopback(normalized: str) -> bool:
    if normalized == "localhost":
        return True
    try:
        parsed = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    if isinstance(parsed, ipaddress.IPv4Address):
        return parsed == ipaddress.IPv4Address("127.0.0.1")
    return parsed == ipaddress.IPv6Address("::1")


def _decode_path(path: Any) -> str | None:
    """Path text only. File bytes are never read to classify a path."""
    if isinstance(path, bytes):
        return os.fsdecode(path)
    if isinstance(path, os.PathLike):
        raw = os.fspath(path)
        if isinstance(raw, bytes):
            return os.fsdecode(raw)
        return str(raw)
    if isinstance(path, str):
        return path
    return None


def _name_is_protected(name: str) -> bool:
    folded = name.casefold()
    protected = {item.casefold() for item in _CREDENTIAL_NAMES}
    if folded in protected or folded.startswith(".env"):
        return True
    if folded.endswith(".session"):
        return True
    if fnmatch.fnmatch(folded, "client_secret*.json"):
        return True
    if "service_account" in folded or "service-account" in folded or "service account" in folded:
        return True
    return False


def _components_protected(text: str) -> bool:
    candidate = Path(text)
    if _name_is_protected(candidate.name):
        return True
    return any(part.casefold() == "credentials" for part in candidate.parts)


def _resolve_filesystem(text: str) -> str | None:
    """Resolve a path the way the filesystem walks it.

    ``..`` is applied after the symlink it follows, not before. The walk
    uses readlink and islink only. It does not open the final file. None
    means a cycle or an unreadable link. Callers fail closed.
    """
    if os.path.isabs(text):
        stack: list[str] = []
        pieces = text.split(os.sep)
    else:
        stack = [part for part in os.getcwd().split(os.sep) if part]
        pieces = text.split(os.sep)
    hops = 0
    seen: set[str] = set()
    index = 0
    while index < len(pieces):
        piece = pieces[index]
        index += 1
        if piece in ("", "."):
            continue
        if piece == "..":
            if stack:
                stack.pop()
            continue
        candidate = os.sep + os.path.join(*stack, piece) if stack else os.sep + piece
        try:
            is_link = os.path.islink(candidate)
        except OSError:
            return None
        if not is_link:
            stack.append(piece)
            continue
        hops += 1
        if hops > 16 or candidate in seen:
            return None
        seen.add(candidate)
        try:
            target = os.readlink(candidate)
        except OSError:
            return None
        if os.path.isabs(target):
            stack = []
        pieces = target.split(os.sep) + pieces[index:]
        index = 0
    if not stack:
        return os.sep
    return os.sep + os.path.join(*stack)


def _symlink_destination(text: str) -> str | None:
    """Follow link targets with readlink. Do not open the destination."""
    return _resolve_filesystem(text)


def _resolve_lexical_chain(text: str) -> str | None:
    """Resolve directory symlink chains with readlink. Do not open the file.

    None means a cycle or an unreadable link. Callers fail closed.
    ``..`` is not collapsed before symlink resolution.
    """
    return _resolve_filesystem(text)


def is_credential_path(path: Any) -> bool:
    """Deny credential paths without reading them.

    Accepts str, bytes, and path-like values. Comparison is case-folded so
    APFS case variants match. A symlink, including a directory symlink
    followed by ``..``, is classified after readlink. The file is not opened.
    """
    text = _decode_path(path)
    if not text:
        return False
    if _components_protected(text):
        return True
    try:
        resolved = _resolve_filesystem(text)
    except (OSError, ValueError):
        return True
    if resolved is None:
        return True
    return _components_protected(resolved)


def classify_host(host: str | None) -> dict[str, Any]:
    normalized = _normalize_host(host)
    if _is_exact_loopback(normalized):
        return {"allow": True, "reason": "LOOPBACK", "normalized_host": normalized, "destination_class": "LOOPBACK"}
    if normalized in _DENY_EXACT or any(normalized == suffix or normalized.endswith("." + suffix) for suffix in _GOOGLE_SUFFIXES):
        destination = "GOOGLE" if "google" in normalized else normalized or "UNKNOWN"
        if normalized.startswith("sheets.") or normalized == "sheets.googleapis.com":
            destination = "GOOGLE_SHEETS_API"
        elif normalized == "oauth2.googleapis.com":
            destination = "GOOGLE_OAUTH_TOKEN"
        elif "telegram" in normalized:
            destination = "TELEGRAM"
        return {
            "allow": False,
            "reason": "DEFAULT_DENY",
            "normalized_host": normalized,
            "destination_class": destination,
        }
    return {
        "allow": False,
        "reason": "DEFAULT_DENY",
        "normalized_host": normalized,
        "destination_class": "ALL_OTHER_HOSTS",
    }


def _record(event: dict[str, Any]) -> None:
    _state["events"].append(event)


def events() -> list[dict[str, Any]]:
    return list(_state["events"])


def event_count() -> int:
    return len(_state["events"])


def clear_events() -> None:
    _state["events"].clear()


def network_guard_installed() -> bool:
    return (
        _state["network_installed"] is True
        and getattr(socket.getaddrinfo, "__name__", "") == "guarded_getaddrinfo"
        and getattr(socket.gethostbyname, "__name__", "") == "guarded_gethostbyname"
        and getattr(socket.gethostbyname_ex, "__name__", "") == "guarded_gethostbyname_ex"
        and getattr(socket.gethostbyaddr, "__name__", "") == "guarded_gethostbyaddr"
        and getattr(socket.socket.sendto, "__name__", "") == "guarded_sendto"
        and getattr(socket.socket.sendmsg, "__name__", "") == "guarded_sendmsg"
    )


def import_guard_installed() -> bool:
    return (
        _state["open_installed"] is True
        and _state.get("audit_installed") is True
        and getattr(builtins.open, "__name__", "") == "guarded_open"
        and getattr(os.open, "__name__", "") == "guarded_os_open"
    )


def install_import_guard() -> None:
    """Refuse credential-path opens. Must run before Chatbot imports."""
    if _state["open_installed"]:
        return
    originals = _state["originals"]
    originals["builtins_open"] = builtins.open
    originals["io_open"] = io.open
    originals["os_open"] = os.open

    def guarded_open(file: Any, *args: Any, **kwargs: Any):
        if isinstance(file, (str, bytes, os.PathLike)) and is_credential_path(file):
            decoded = _decode_path(file) or ""
            _record({
                "operation": "open",
                "path_class": Path(decoded).name,
                "decision": "deny",
                "reason": "CREDENTIAL_DISCOVERY_DENIED",
                "violation": False,
            })
            raise PermissionError("CREDENTIAL_DISCOVERY_DENIED")
        return originals["io_open"](file, *args, **kwargs)

    def guarded_os_open(path: Any, flags: int, mode: int = 0o777, *, dir_fd: int | None = None):
        if is_credential_path(path):
            _record({
                "operation": "os.open",
                "path_class": Path(_decode_path(path) or "").name,
                "decision": "deny",
                "reason": "CREDENTIAL_DISCOVERY_DENIED",
                "violation": False,
            })
            raise PermissionError("CREDENTIAL_DISCOVERY_DENIED")
        return originals["os_open"](path, flags, mode, dir_fd=dir_fd)

    def _audit_open(event: str, args: tuple[Any, ...]) -> None:
        if event != "open" or not args or args[0] is None:
            return
        try:
            protected = is_credential_path(args[0])
        except (TypeError, ValueError):
            return
        if not protected:
            return
        _record({
            "operation": "audit.open",
            "path_class": Path(_decode_path(args[0]) or "").name,
            "decision": "deny",
            "reason": "CREDENTIAL_DISCOVERY_DENIED",
            "violation": False,
        })
        raise PermissionError("CREDENTIAL_DISCOVERY_DENIED")

    builtins.open = guarded_open
    io.open = guarded_open
    os.open = guarded_os_open
    if not _state.get("audit_installed"):
        sys.addaudithook(_audit_open)
        _state["audit_installed"] = True
    _state["open_installed"] = True


def uninstall_import_guard() -> None:
    if not _state["open_installed"]:
        return
    originals = _state["originals"]
    builtins.open = originals["builtins_open"]
    io.open = originals["io_open"]
    os.open = originals["os_open"]
    _state["open_installed"] = False


def install_network_guard() -> None:
    if _state["network_installed"]:
        return
    originals = _state["originals"]
    originals["getaddrinfo"] = socket.getaddrinfo
    originals["gethostbyname"] = socket.gethostbyname
    originals["gethostbyname_ex"] = socket.gethostbyname_ex
    originals["gethostbyaddr"] = socket.gethostbyaddr
    originals["create_connection"] = socket.create_connection
    originals["connect"] = socket.socket.connect
    originals["connect_ex"] = socket.socket.connect_ex
    originals["sendto"] = socket.socket.sendto
    originals["sendmsg"] = socket.socket.sendmsg

    def guarded_getaddrinfo(host: Any, port: Any, *args: Any, **kwargs: Any):
        decision = classify_host(None if host is None else str(host))
        _record({
            "operation": "socket.getaddrinfo",
            "host": None if host is None else str(host),
            "normalized_host": decision["normalized_host"],
            "port": port,
            "decision": "allow" if decision["allow"] else "deny",
            "reason": decision["reason"],
            "destination_class": decision["destination_class"],
            "external_contact": False,
        })
        if not decision["allow"]:
            raise PermissionError(decision["reason"])
        return originals["getaddrinfo"](host, port, *args, **kwargs)

    def guarded_create_connection(address: Any, *args: Any, **kwargs: Any):
        host = address[0] if isinstance(address, tuple) and address else None
        decision = classify_host(None if host is None else str(host))
        _record({
            "operation": "socket.create_connection",
            "host": None if host is None else str(host),
            "normalized_host": decision["normalized_host"],
            "port": address[1] if isinstance(address, tuple) and len(address) > 1 else None,
            "decision": "allow" if decision["allow"] else "deny",
            "reason": decision["reason"],
            "destination_class": decision["destination_class"],
            "external_contact": False,
        })
        if not decision["allow"]:
            raise PermissionError(decision["reason"])
        return originals["create_connection"](address, *args, **kwargs)

    def guarded_connect(self: socket.socket, address: Any):
        host = address[0] if isinstance(address, tuple) and address else None
        decision = classify_host(None if host is None else str(host))
        _record({
            "operation": "socket.connect",
            "host": None if host is None else str(host),
            "normalized_host": decision["normalized_host"],
            "port": address[1] if isinstance(address, tuple) and len(address) > 1 else None,
            "decision": "allow" if decision["allow"] else "deny",
            "reason": decision["reason"],
            "destination_class": decision["destination_class"],
            "external_contact": False,
        })
        if not decision["allow"]:
            raise PermissionError(decision["reason"])
        return originals["connect"](self, address)

    def _network_address(address: Any) -> tuple[Any, Any]:
        if isinstance(address, tuple) and address:
            host = address[0]
            port = address[1] if len(address) > 1 else None
            return host, port
        return None, None

    def guarded_connect_ex(self: socket.socket, address: Any) -> int:
        if isinstance(address, str):
            return originals["connect_ex"](self, address)
        host, port = _network_address(address)
        decision = classify_host(None if host is None else str(host))
        _record({
            "operation": "socket.connect_ex",
            "host": None if host is None else str(host),
            "normalized_host": decision["normalized_host"],
            "port": port,
            "decision": "allow" if decision["allow"] else "deny",
            "reason": decision["reason"],
            "destination_class": decision["destination_class"],
            "external_contact": False,
        })
        if not decision["allow"]:
            raise PermissionError(decision["reason"])
        return originals["connect_ex"](self, address)

    def guarded_gethostbyname(host: Any):
        decision = classify_host(None if host is None else str(host))
        _record({
            "operation": "socket.gethostbyname",
            "host": None if host is None else str(host),
            "normalized_host": decision["normalized_host"],
            "port": None,
            "decision": "allow" if decision["allow"] else "deny",
            "reason": decision["reason"],
            "destination_class": decision["destination_class"],
            "external_contact": False,
            "violation": False,
        })
        if not decision["allow"]:
            raise PermissionError(decision["reason"])
        return originals["gethostbyname"](host)

    def _guard_name(operation: str, host: Any) -> dict[str, Any]:
        decision = classify_host(None if host is None else str(host))
        _record({
            "operation": operation,
            "host": None if host is None else str(host),
            "normalized_host": decision["normalized_host"],
            "port": None,
            "decision": "allow" if decision["allow"] else "deny",
            "reason": decision["reason"],
            "destination_class": decision["destination_class"],
            "external_contact": False,
            "violation": False,
        })
        return decision

    def guarded_gethostbyname_ex(host: Any):
        decision = _guard_name("socket.gethostbyname_ex", host)
        if not decision["allow"]:
            raise PermissionError(decision["reason"])
        return originals["gethostbyname_ex"](host)

    def guarded_gethostbyaddr(address: Any):
        decision = _guard_name("socket.gethostbyaddr", address)
        if not decision["allow"]:
            raise PermissionError(decision["reason"])
        return originals["gethostbyaddr"](address)

    def guarded_sendto(self: socket.socket, data: Any, *args: Any):
        address = args[-1] if args and isinstance(args[-1], tuple) else None
        if address is None:
            return originals["sendto"](self, data, *args)
        host = address[0] if address else None
        port = address[1] if isinstance(address, tuple) and len(address) > 1 else None
        decision = classify_host(None if host is None else str(host))
        _record({
            "operation": "socket.sendto",
            "host": None if host is None else str(host),
            "normalized_host": decision["normalized_host"],
            "port": port,
            "decision": "allow" if decision["allow"] else "deny",
            "reason": decision["reason"],
            "destination_class": decision["destination_class"],
            "external_contact": False,
            "violation": False,
        })
        if not decision["allow"]:
            raise PermissionError(decision["reason"])
        return originals["sendto"](self, data, *args)

    def guarded_sendmsg(self: socket.socket, buffers: Any, ancdata: Any = (), flags: int = 0, address: Any = None):
        if address is None:
            return originals["sendmsg"](self, buffers, ancdata, flags)
        host, port = _network_address(address)
        decision = classify_host(None if host is None else str(host))
        _record({
            "operation": "socket.sendmsg",
            "host": None if host is None else str(host),
            "normalized_host": decision["normalized_host"],
            "port": port,
            "decision": "allow" if decision["allow"] else "deny",
            "reason": decision["reason"],
            "destination_class": decision["destination_class"],
            "external_contact": False,
            "violation": False,
        })
        if not decision["allow"]:
            raise PermissionError(decision["reason"])
        return originals["sendmsg"](self, buffers, ancdata, flags, address)

    socket.getaddrinfo = guarded_getaddrinfo
    socket.gethostbyname = guarded_gethostbyname
    socket.gethostbyname_ex = guarded_gethostbyname_ex
    socket.gethostbyaddr = guarded_gethostbyaddr
    socket.create_connection = guarded_create_connection
    socket.socket.connect = guarded_connect
    socket.socket.connect_ex = guarded_connect_ex
    socket.socket.sendto = guarded_sendto
    socket.socket.sendmsg = guarded_sendmsg
    _state["network_installed"] = True


def uninstall_network_guard() -> None:
    if not _state["network_installed"]:
        return
    originals = _state["originals"]
    socket.getaddrinfo = originals["getaddrinfo"]
    socket.gethostbyname = originals["gethostbyname"]
    socket.gethostbyname_ex = originals["gethostbyname_ex"]
    socket.gethostbyaddr = originals["gethostbyaddr"]
    socket.create_connection = originals["create_connection"]
    socket.socket.connect = originals["connect"]
    socket.socket.connect_ex = originals["connect_ex"]
    socket.socket.sendto = originals["sendto"]
    socket.socket.sendmsg = originals["sendmsg"]
    _state["network_installed"] = False


def deny_connect(host: str, port: int) -> dict[str, Any]:
    """Attempt a connection through the guard. External contact stays false."""
    install_network_guard()
    try:
        socket.create_connection((host, port), timeout=0.2)
    except PermissionError as exc:
        return {"denied": True, "external_contact": False, "reason": str(exc)}
    return {"denied": False, "external_contact": True, "reason": "CONNECTION_SUCCEEDED"}


def disposable_environment(root: Path) -> dict[str, Any]:
    """Build a disposable process environment. Does not read operator secrets."""
    root = root.resolve()
    home = root / "home"
    cwd = root / "work" / "cwd"
    tmp = root / "tmp"
    xdg_config = root / "xdg" / "config"
    xdg_cache = root / "xdg" / "cache"
    xdg_data = root / "xdg" / "data"
    for path in (home, cwd, tmp, xdg_config, xdg_cache, xdg_data):
        path.mkdir(parents=True, exist_ok=True)
    passthrough = {}
    for key in ("PATH", "LANG", "LC_ALL", "LC_CTYPE"):
        if key in os.environ:
            passthrough[key] = os.environ[key]
    env = {
        **passthrough,
        "HOME": str(home),
        "TMPDIR": str(tmp),
        "TMP": str(tmp),
        "TEMP": str(tmp),
        "XDG_CONFIG_HOME": str(xdg_config),
        "XDG_CACHE_HOME": str(xdg_cache),
        "XDG_DATA_HOME": str(xdg_data),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
    }
    for blocked in (
        "GCP_CREDENTIALS_PATH",
        "GOOGLE_SHEET_ID",
        "COHERE_API_KEY",
        "SUPABASE_URL",
        "SUPABASE_SECRET_KEY",
        "BOT_TOKEN",
        "TG_API_ID",
        "TG_API_HASH",
        "TG_SESSION_NAME",
        "DB_URL",
        "OPENAI_API_KEY",
        "DEEPSEEK_API_KEY",
    ):
        env.pop(blocked, None)
    return {"root": root, "home": home, "cwd": cwd, "tmp": tmp, "env": env}


def credential_candidates(env_spec: dict[str, Any]) -> list[Path]:
    """Paths a cwd/HOME search could see. Parent directories are not added."""
    cwd = Path(env_spec["cwd"])
    home = Path(env_spec["home"])
    return [
        cwd / ".env",
        home / ".env",
        cwd / "credentials" / "gcp_service_account.json",
        home / "credentials" / "gcp_service_account.json",
    ]
