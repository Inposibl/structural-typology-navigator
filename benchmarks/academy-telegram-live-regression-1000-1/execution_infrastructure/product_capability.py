"""Runner-owned authority for Chatbot product execution.

There is one installation path:

    valid controlled execution context
      -> runner product attempt (harness.runner.run_scenario_once only)
      -> Chatbot TEST_BASE physical byte attestation
      -> Navigator product TEST_BASE attestation
      -> ephemeral runner-owned product authority
      -> product execution

Product authority is enforced inside the product code itself. Every Chatbot
product module is loaded through a guarded loader that inserts an authority
check as the first statement of every function and lambda body. A cached
module in sys.modules, a captured method reference, a wrapper closure, or a
subclass therefore reaches the same check. An audit hook refuses to execute
a product code object that the guarded loader did not compile, and refuses
to compile accepted product source under a foreign filename.

Import permission is separate. infrastructure_import_scope() lets the
lifecycle installer import product modules. It never satisfies the call
guard.

Limit: this is an in-process Python boundary against public API, import
scope, cached modules, wrappers, and self-minting. Code that deliberately
rewrites private benchmark state (for example the vault closure, the
pending-code table, or the guard name inside a product module), rebuilds
product functions from raw .pyc bytecode, or uses ctypes is not stopped by
it. Process isolation would be required for that, and is not part of CORR6.
"""

from __future__ import annotations

import ast
import hashlib
import importlib.machinery
import json
import os
import secrets
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .constants import CHATBOT_TEST_BASE

PINNED_TIKHON_MANIFEST = (
    "dbe494af1aaf47df8409ba9b570c250022e310c9f89e8cfae92a98675b5b92b4"
)
EXPECTED_TIKHON_HEAD = "3adbb9f1d16c299c5b42f1dccad0966c4e7eeecd"
EXPECTED_TIKHON_BRANCH = "feat/telegram-shared-brain-integration-1"
LIVE_CHATBOT = Path("/Users/entp_psyche/Desktop/InvestProjects2026/chatbot")
NAVIGATOR_TEST_BASE = Path(
    "/Users/entp_psyche/Desktop/InvestProjects2026/"
    "test-bases/ACADEMY_TELEGRAM_LIVE_REGRESSION_1000_1/navigator"
)
EXPECTED_NAVIGATOR_HEAD = "0a930593c1e354022160925e12e0b6474b5fa240"
EXPECTED_NAVIGATOR_BRANCH = "navigator-production-dialogue-corr2-ab-normalization"

GUARD_NAME = "__academy_product_guard__"
GUARDED_MARK = "__academy_product_guarded__"

# Bound at import time. Later rebinding of the module constants above does
# not move the accepted roots.
_ACCEPTED_CHATBOT_ROOT = os.path.realpath(str(CHATBOT_TEST_BASE))
_ACCEPTED_NAVIGATOR_ROOT = os.path.realpath(str(NAVIGATOR_TEST_BASE))
_LIVE_CHATBOT_ROOT = os.path.realpath(str(LIVE_CHATBOT))

_INFRA_IMPORTS = 0
_SURFACE_ENTRIES = 0
# Code objects compiled by the guarded loader and not yet executed. The exec
# audit gate admits a product code object only when it is this exact object.
_PENDING_CODE: dict[int, Any] = {}
_STATS = {
    "guarded_calls": 0,
    "denied_calls": 0,
    "denied_imports": 0,
    "denied_exec": 0,
    "denied_compile": 0,
    "guarded_modules": [],
    "purged_unguarded_modules": [],
    "self_mint_rejected": 0,
}


class ProductBindingRequired(RuntimeError):
    """Product execution was requested without runner-owned product authority."""


# ---------------------------------------------------------------------------
# Capability declarations (unchanged CORR5 contract)
# ---------------------------------------------------------------------------

def capabilities_of(obj: Any) -> frozenset[str]:
    """Capabilities declared by the class, its bases, or a delegated adapter."""
    found: set[str] = set()
    seen: set[int] = set()

    def walk(item: Any) -> None:
        if item is None or id(item) in seen:
            return
        seen.add(id(item))
        target = item if isinstance(item, type) else type(item)
        for base in getattr(target, "__mro__", (target,)):
            for cap in getattr(base, "product_capabilities", ()) or ():
                found.add(str(cap))
            if getattr(base, "requires_authenticated_product_binding", False):
                found.add("IMPORTS_CHATBOT_PRODUCT")
            if getattr(base, "requires_tikhon_test_root", False):
                found.add("TIKHON_TEST_ROOT")
            delegated = getattr(base, "delegates_to", None)
            if isinstance(delegated, (list, tuple, set, frozenset)):
                for item in delegated:
                    if item is not base:
                        walk(item)
            elif delegated is not None and delegated is not base:
                walk(delegated)

    walk(obj)
    return frozenset(found)


def is_product_backed(obj: Any) -> bool:
    return bool(capabilities_of(obj))


def surface_entries() -> int:
    return _SURFACE_ENTRIES


def note_product_surface(kind: str) -> None:
    global _SURFACE_ENTRIES
    _SURFACE_ENTRIES += 1


def reset_surface_entries() -> None:
    global _SURFACE_ENTRIES
    _SURFACE_ENTRIES = 0


def guard_stats() -> dict[str, Any]:
    return {
        key: (list(value) if isinstance(value, list) else value)
        for key, value in _STATS.items()
    }


# ---------------------------------------------------------------------------
# Import permission. It is not execution authority.
# ---------------------------------------------------------------------------

def infrastructure_import_active() -> bool:
    return _INFRA_IMPORTS > 0


@contextmanager
def infrastructure_import_scope() -> Iterator[None]:
    """Permit product module import for the lifecycle installer.

    Calls into product code inside this scope still require runner-owned
    authority.
    """
    global _INFRA_IMPORTS
    _INFRA_IMPORTS += 1
    try:
        yield
    finally:
        _INFRA_IMPORTS -= 1


def require_product_import_permission(expected_root: str | None = None) -> None:
    if infrastructure_import_active():
        return
    require_product_authority(expected_root)


# ---------------------------------------------------------------------------
# Runner-owned capability
# ---------------------------------------------------------------------------

def _vault():
    """Closure state. There is no module attribute holding the authority."""
    seal = object()
    state: dict[str, Any] = {"runner_code": None, "attempt": None, "authority": None}

    class RunnerProductAttempt:
        __slots__ = (
            "_seal", "capability_id", "scenario_id", "attempt_number", "attempt_nonce",
            "run_id", "context", "context_nonce", "context_generation", "pid", "consumed",
        )

        def __init__(self, token: object, **fields: Any) -> None:
            if token is not seal:
                raise ProductBindingRequired("RUNNER_PRODUCT_CAPABILITY_FORGED")
            self._seal = token
            for key, value in fields.items():
                setattr(self, key, value)
            self.consumed = False

        def __reduce__(self):  # noqa: D401 — a capability does not pickle
            raise ProductBindingRequired("RUNNER_PRODUCT_CAPABILITY_NOT_TRANSFERABLE")

        def __copy__(self):
            raise ProductBindingRequired("RUNNER_PRODUCT_CAPABILITY_NOT_TRANSFERABLE")

        def __deepcopy__(self, memo):
            raise ProductBindingRequired("RUNNER_PRODUCT_CAPABILITY_NOT_TRANSFERABLE")

    class ProductAuthority:
        __slots__ = ("_seal", "attempt", "fields", "expired")

        def __init__(self, token: object, attempt: Any, fields: dict[str, Any]) -> None:
            if token is not seal:
                raise ProductBindingRequired("PRODUCT_AUTHORITY_FORGED")
            self._seal = token
            self.attempt = attempt
            self.fields = dict(fields)
            self.expired = False

        def __reduce__(self):
            raise ProductBindingRequired("PRODUCT_AUTHORITY_NOT_TRANSFERABLE")

    def register_runner_entry(code: Any) -> None:
        current = state["runner_code"]
        if current is not None:
            if current is not code:
                raise ProductBindingRequired("RUNNER_ENTRY_ALREADY_REGISTERED")
            return
        runner_file = os.path.realpath(
            str(Path(__file__).resolve().parents[1] / "harness" / "runner.py")
        )
        if os.path.realpath(getattr(code, "co_filename", "")) != runner_file:
            raise ProductBindingRequired("RUNNER_ENTRY_NOT_RUNNER")
        if getattr(code, "co_name", "") != "run_scenario_once":
            raise ProductBindingRequired("RUNNER_ENTRY_NOT_RUNNER")
        state["runner_code"] = code

    def caller_is_runner(depth: int) -> bool:
        code = state["runner_code"]
        if code is None:
            return False
        try:
            frame = sys._getframe(depth + 1)
        except ValueError:
            return False
        return frame.f_code is code

    def _context_now() -> Any:
        from .controlled_context import require_controlled_context

        return require_controlled_context()

    def _attempt_now() -> dict[str, Any] | None:
        from .attempt_binding import active_attempt

        return active_attempt()

    def begin(scenario_id: str, attempt_number: int, run_id: str) -> Any:
        if not caller_is_runner(2):
            raise ProductBindingRequired("RUNNER_PRODUCT_ATTEMPT_NOT_RUNNER_OWNED")
        ctx = _context_now()
        if ctx is None or not getattr(ctx, "scenario_body_permitted", False):
            raise ProductBindingRequired("CONTROLLED_EXECUTION_CONTEXT_REQUIRED")
        active = _attempt_now()
        if (
            not active
            or str(active.get("scenario_id")) != str(scenario_id)
            or int(active.get("attempt_number") or -1) != int(attempt_number)
            or not active.get("attempt_nonce")
        ):
            raise ProductBindingRequired("RUNNER_PRODUCT_ATTEMPT_NOT_ACTIVE")
        end(None)
        attempt = RunnerProductAttempt(
            seal,
            capability_id=secrets.token_hex(16),
            scenario_id=str(scenario_id),
            attempt_number=int(attempt_number),
            attempt_nonce=str(active["attempt_nonce"]),
            run_id=str(run_id),
            context=ctx,
            context_nonce=str(getattr(ctx, "context_nonce", "")),
            context_generation=(getattr(ctx, "proof_identity", {}) or {}).get("generation"),
            pid=os.getpid(),
        )
        state["attempt"] = attempt
        return attempt

    def end(_attempt: Any) -> None:
        attempt = state["attempt"]
        authority = state["authority"]
        state["attempt"] = None
        state["authority"] = None
        if attempt is not None:
            attempt.consumed = True
        if authority is not None:
            authority.expired = True

    def live_attempt(attempt: Any) -> bool:
        return (
            isinstance(attempt, RunnerProductAttempt)
            and attempt is state["attempt"]
            and attempt._seal is seal
            and not attempt.consumed
            and attempt.pid == os.getpid()
        )

    def install(attempt: Any, fields: dict[str, Any]) -> None:
        if not caller_is_runner(2):
            raise ProductBindingRequired("PRODUCT_AUTHORITY_NOT_RUNNER_OWNED")
        if not live_attempt(attempt):
            raise ProductBindingRequired("RUNNER_PRODUCT_CAPABILITY_REQUIRED")
        state["authority"] = ProductAuthority(seal, attempt, fields)

    def validate(expected_root: str | None) -> dict[str, Any]:
        authority = state["authority"]
        if authority is None or not isinstance(authority, ProductAuthority):
            raise ProductBindingRequired("PRODUCT_BINDING_REQUIRED")
        attempt = authority.attempt
        if authority._seal is not seal or authority.expired:
            raise ProductBindingRequired("PRODUCT_AUTHORITY_EXPIRED")
        if not live_attempt(attempt):
            raise ProductBindingRequired("PRODUCT_AUTHORITY_REPLAYED")
        if attempt.pid != os.getpid():
            raise ProductBindingRequired("PRODUCT_AUTHORITY_OTHER_PROCESS")
        ctx = _context_now()
        if (
            ctx is None
            or ctx is not attempt.context
            or str(getattr(ctx, "context_nonce", "")) != attempt.context_nonce
            or (getattr(ctx, "proof_identity", {}) or {}).get("generation") != attempt.context_generation
            or not getattr(ctx, "scenario_body_permitted", False)
        ):
            raise ProductBindingRequired("PRODUCT_AUTHORITY_OTHER_GENERATION")
        active = _attempt_now()
        if (
            not active
            or active.get("attempt_nonce") != attempt.attempt_nonce
            or str(active.get("scenario_id")) != attempt.scenario_id
            or int(active.get("attempt_number") or -1) != attempt.attempt_number
        ):
            raise ProductBindingRequired("PRODUCT_AUTHORITY_OTHER_ATTEMPT")
        if expected_root:
            if os.path.realpath(str(expected_root)) != authority.fields["chatbot_root"]:
                raise ProductBindingRequired("PRODUCT_AUTHORITY_OTHER_ROOT")
        return authority.fields

    def snapshot() -> dict[str, Any] | None:
        authority = state["authority"]
        if authority is None:
            return None
        attempt = authority.attempt
        return {
            **authority.fields,
            "capability_id": attempt.capability_id,
            "scenario_id": attempt.scenario_id,
            "attempt_number": attempt.attempt_number,
            "context_generation": attempt.context_generation,
            "pid": attempt.pid,
            "expired": authority.expired,
        }

    def current_attempt() -> Any:
        return state["attempt"]

    return register_runner_entry, begin, end, install, validate, snapshot, live_attempt, current_attempt


(
    register_runner_entry,
    _begin_attempt,
    _end_attempt,
    _install_authority,
    _validate_authority,
    _authority_snapshot,
    _live_attempt,
    _current_attempt,
) = _vault()


def begin_runner_product_attempt(*, scenario_id: str, attempt_number: int, run_id: str) -> Any:
    """Called only from harness.runner.run_scenario_once, inside an open attempt."""
    return _begin_attempt(scenario_id, attempt_number, run_id)


def end_runner_product_attempt(attempt: Any = None) -> None:
    _end_attempt(attempt)


def clear_product_authority() -> None:
    _end_attempt(None)


def authority_snapshot() -> dict[str, Any] | None:
    return _authority_snapshot()


def authority_installed() -> bool:
    try:
        _validate_authority(None)
    except ProductBindingRequired:
        return False
    return True


def require_product_authority(expected_root: str | None = None) -> None:
    _validate_authority(expected_root)


def mint_accepted_authority(*_args: Any, **_kwargs: Any) -> Any:
    """Public self-mint is not authority. It always fails closed."""
    _STATS["self_mint_rejected"] += 1
    raise ProductBindingRequired("PUBLIC_PRODUCT_AUTHORITY_SELF_MINT_REJECTED")


# ---------------------------------------------------------------------------
# Physical attestation
# ---------------------------------------------------------------------------

def _manifest_digest(doc: dict[str, Any]) -> str:
    body = {key: value for key, value in doc.items() if key != "manifest_sha256"}
    encoded = json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _git(root: str, *args: str) -> str:
    env = {
        "PATH": "/usr/bin:/bin:/usr/local/bin",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_CONFIG_NOSYSTEM": "1",
        "HOME": "/nonexistent",
    }
    completed = subprocess.run(
        ["git", "-C", root, *args],
        capture_output=True, check=True, timeout=30, env=env,
    )
    return completed.stdout.decode("utf-8", "surrogateescape")


def _under(path: str, root: str) -> bool:
    return path == root or path.startswith(root.rstrip(os.sep) + os.sep)


def attest_chatbot_physical(root: str | Path | None) -> dict[str, Any]:
    """Physical Chatbot TEST_BASE bytes against the accepted byte-state contract."""
    from harness.seams.sut_binding import (
        attest_tikhon_bytes,
        detect_unexpected_controlled_files,
        validate_byte_state_manifest,
    )

    reasons: list[str] = []
    if not root:
        return {"ok": False, "reasons": ["CHATBOT_ROOT_ABSENT"]}
    resolved = os.path.realpath(str(root))
    if resolved != _ACCEPTED_CHATBOT_ROOT:
        reasons.append("CHATBOT_ROOT_NOT_ACCEPTED")
    if _under(resolved, _LIVE_CHATBOT_ROOT):
        reasons.append("CHATBOT_ROOT_IS_LIVE_TREE")
    if not os.path.isdir(resolved):
        return {"ok": False, "root": resolved, "reasons": reasons + ["CHATBOT_ROOT_MISSING"]}
    manifest_path = Path(resolved) / "tests" / "_testbase" / "accepted-byte-state.json"
    doc, manifest_reasons = validate_byte_state_manifest(manifest_path)
    reasons.extend(manifest_reasons)
    byte_reasons: list[str] = []
    head = None
    if doc is not None and not manifest_reasons:
        if _manifest_digest(doc) != PINNED_TIKHON_MANIFEST or doc.get("manifest_sha256") != PINNED_TIKHON_MANIFEST:
            reasons.append("CHATBOT_MANIFEST_NOT_PINNED")
        if doc.get("head") != EXPECTED_TIKHON_HEAD:
            reasons.append("CHATBOT_MANIFEST_HEAD_MISMATCH")
        try:
            head = _git(resolved, "rev-parse", "HEAD").strip()
        except (subprocess.SubprocessError, OSError):
            head = None
        if head != EXPECTED_TIKHON_HEAD:
            reasons.append("CHATBOT_GIT_HEAD_MISMATCH")
        byte_reasons = list(attest_tikhon_bytes(Path(resolved), doc))
        byte_reasons += list(detect_unexpected_controlled_files(Path(resolved), doc))
        reasons.extend(byte_reasons)
    return {
        "ok": not reasons,
        "root": resolved,
        "manifest_sha256": (doc or {}).get("manifest_sha256"),
        "head": head,
        "byte_mismatch_count": len(byte_reasons),
        "reasons": reasons[:20],
        "reason_count": len(reasons),
    }


def _blob_sha1(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def attest_navigator_physical(root: str | Path | None) -> dict[str, Any]:
    """Navigator product TEST_BASE: exact root, HEAD, branch, physical bytes.

    Every file of the expected commit tree is hashed from disk as a git blob
    and compared with the commit's own blob id. The index is not consulted.
    Untracked, non-ignored files are a mismatch.
    """
    reasons: list[str] = []
    if not root:
        return {"ok": False, "reasons": ["NAVIGATOR_ROOT_ABSENT"]}
    resolved = os.path.realpath(str(root))
    if resolved != _ACCEPTED_NAVIGATOR_ROOT:
        reasons.append("NAVIGATOR_ROOT_NOT_ACCEPTED")
    if not os.path.isdir(os.path.join(resolved, ".git")):
        return {"ok": False, "root": resolved, "reasons": reasons + ["NAVIGATOR_ROOT_NOT_A_CHECKOUT"]}
    try:
        toplevel = os.path.realpath(_git(resolved, "rev-parse", "--show-toplevel").strip())
        head = _git(resolved, "rev-parse", "HEAD").strip()
        branch = _git(resolved, "rev-parse", "--abbrev-ref", "HEAD").strip()
        tree = _git(resolved, "ls-tree", "-r", "-z", "--full-tree", EXPECTED_NAVIGATOR_HEAD)
        untracked = [
            item for item in _git(resolved, "ls-files", "-o", "--exclude-standard", "-z").split("\0") if item
        ]
    except (subprocess.SubprocessError, OSError):
        return {"ok": False, "root": resolved, "reasons": reasons + ["NAVIGATOR_GIT_UNREADABLE"]}
    if toplevel != resolved:
        reasons.append("NAVIGATOR_METADATA_POINTS_ELSEWHERE")
    if head != EXPECTED_NAVIGATOR_HEAD:
        reasons.append("NAVIGATOR_HEAD_MISMATCH")
    if branch != EXPECTED_NAVIGATOR_BRANCH:
        reasons.append("NAVIGATOR_BRANCH_MISMATCH")
    byte_mismatches: list[str] = []
    checked = 0
    for row in tree.split("\0"):
        if not row:
            continue
        meta, _, path = row.partition("\t")
        mode, kind, blob = meta.split()
        full = os.path.join(resolved, path)
        checked += 1
        try:
            if mode == "120000":
                data = os.readlink(full).encode("utf-8", "surrogateescape")
            elif kind == "blob":
                with open(full, "rb") as handle:
                    data = handle.read()
            else:
                byte_mismatches.append(path)
                continue
        except OSError:
            byte_mismatches.append(path)
            continue
        if _blob_sha1(data) != blob:
            byte_mismatches.append(path)
    if byte_mismatches:
        reasons.append("NAVIGATOR_PHYSICAL_BYTES_MISMATCH")
    if untracked:
        reasons.append("NAVIGATOR_UNTRACKED_FILES_PRESENT")
    return {
        "ok": not reasons,
        "root": resolved,
        "head": head,
        "branch": branch,
        "files_checked": checked,
        "byte_mismatches": byte_mismatches[:20],
        "untracked": untracked[:20],
        "reasons": reasons,
    }


def install_product_authority(token: Any, attempt: Any = None) -> dict[str, Any]:
    """Install authority for the live runner product attempt.

    Only harness.runner.run_scenario_once can call this successfully, and
    only with the RunnerProductAttempt it began for the current attempt.
    Returns the bound identity document.
    """
    from harness.factory import BindingToken, FactoryRejected

    if attempt is None or not _live_attempt(attempt):
        raise ProductBindingRequired("RUNNER_PRODUCT_CAPABILITY_REQUIRED")
    if not isinstance(token, BindingToken):
        raise ProductBindingRequired("PRODUCT_BINDING_REQUIRED")
    try:
        token.verify()
    except FactoryRejected as exc:
        raise ProductBindingRequired("PRODUCT_BINDING_TOKEN_MUTATED") from exc
    if token.run_id != attempt.run_id:
        raise ProductBindingRequired("PRODUCT_BINDING_TOKEN_OTHER_RUN")
    if token.tikhon_manifest_sha256 != PINNED_TIKHON_MANIFEST:
        raise ProductBindingRequired("CHATBOT_MANIFEST_NOT_PINNED")
    tikhon_expected = dict(token.tikhon_expected or {})
    navigator_expected = dict(token.navigator_expected or {})
    if tikhon_expected.get("head") != EXPECTED_TIKHON_HEAD:
        raise ProductBindingRequired("CHATBOT_EXPECTED_HEAD_MISMATCH")
    if navigator_expected.get("head") != EXPECTED_NAVIGATOR_HEAD:
        raise ProductBindingRequired("NAVIGATOR_EXPECTED_HEAD_MISMATCH")
    if navigator_expected.get("branch") != EXPECTED_NAVIGATOR_BRANCH:
        raise ProductBindingRequired("NAVIGATOR_EXPECTED_BRANCH_MISMATCH")
    chatbot = attest_chatbot_physical(token.tikhon_root)
    if not chatbot["ok"]:
        raise ProductBindingRequired("CHATBOT_PHYSICAL_ATTESTATION_FAILED: " + ",".join(chatbot["reasons"][:3]))
    navigator = attest_navigator_physical(token.navigator_root)
    if not navigator["ok"]:
        raise ProductBindingRequired("NAVIGATOR_ATTESTATION_FAILED: " + ",".join(navigator["reasons"][:3]))
    fields = {
        "chatbot_root": chatbot["root"],
        "chatbot_manifest_sha256": chatbot["manifest_sha256"],
        "chatbot_head": chatbot["head"],
        "chatbot_expected_head": EXPECTED_TIKHON_HEAD,
        "navigator_root": navigator["root"],
        "navigator_expected_head": EXPECTED_NAVIGATOR_HEAD,
        "navigator_actual_head": navigator["head"],
        "navigator_branch": navigator["branch"],
        "navigator_files_checked": navigator["files_checked"],
        "token_digest": token.digest,
        "run_id": token.run_id,
    }
    _install_authority(attempt, fields)
    return dict(fields)


# ---------------------------------------------------------------------------
# Product code guard
# ---------------------------------------------------------------------------

def _product_call_guard() -> None:
    """First statement of every product function body.

    There is no import-time exemption. A product function called while a
    product module body executes needs runner-owned authority too.
    """
    try:
        _validate_authority(None)
    except ProductBindingRequired:
        _STATS["denied_calls"] += 1
        raise
    _STATS["guarded_calls"] += 1


def is_product_path(path: Any) -> bool:
    """Chatbot product source, by location. venv packages are not product."""
    if not isinstance(path, (str, bytes, os.PathLike)):
        return False
    try:
        text = os.fsdecode(path)
    except (TypeError, ValueError):
        return False
    if not text or text.startswith("<"):
        return False
    real = os.path.realpath(text)
    for root in (_ACCEPTED_CHATBOT_ROOT, _LIVE_CHATBOT_ROOT):
        if _under(real, root):
            rel = real[len(root):].lstrip(os.sep)
            first = rel.split(os.sep, 1)[0]
            return first not in ("venv", ".venv", "site-packages")
    parts = real.split(os.sep)
    return "data_engine" in parts and "site-packages" not in parts


_ACCEPTED_SOURCE_HASHES: set[str] = set()


def _load_accepted_source_hashes() -> None:
    manifest = Path(_ACCEPTED_CHATBOT_ROOT) / "tests" / "_testbase" / "accepted-byte-state.json"
    try:
        doc = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    rows: list[tuple[str, str]] = []
    rows += [(item.get("path") or "", item.get("sha256") or "") for item in doc.get("tracked_clean_inventory") or []]
    rows += list((doc.get("tracked_modified") or {}).items())
    rows += list((doc.get("untracked_overlay") or {}).items())
    for path, digest in rows:
        if str(path).endswith(".py") and digest:
            _ACCEPTED_SOURCE_HASHES.add(str(digest))


def _source_is_accepted_product(source: Any) -> bool:
    if isinstance(source, str):
        data = source.encode("utf-8", "surrogateescape")
    elif isinstance(source, (bytes, bytearray)):
        data = bytes(source)
    else:
        return False
    if len(data) < 256:
        return False
    return hashlib.sha256(data).hexdigest() in _ACCEPTED_SOURCE_HASHES


def _audit(event: str, args: tuple[Any, ...]) -> None:
    if event == "exec":
        code = args[0] if args else None
        if is_product_path(getattr(code, "co_filename", None)) and _PENDING_CODE.get(id(code)) is not code:
            _STATS["denied_exec"] += 1
            raise ProductBindingRequired("PRODUCT_CODE_EXEC_OUTSIDE_GUARDED_LOADER")
    elif event == "compile":
        # Compiling product source under its own filename is not execution;
        # the exec gate above decides. Accepted product source compiled under
        # a foreign filename would escape that gate, so it is refused here.
        if len(args) < 2 or is_product_path(args[1]):
            return
        if _source_is_accepted_product(args[0]):
            _STATS["denied_compile"] += 1
            raise ProductBindingRequired("PRODUCT_CODE_COMPILE_OUTSIDE_GUARDED_LOADER")


class _GuardInjector(ast.NodeTransformer):
    def _call(self, anchor: ast.AST) -> ast.Expr:
        node = ast.Expr(ast.Call(func=ast.Name(id=GUARD_NAME, ctx=ast.Load()), args=[], keywords=[]))
        return ast.copy_location(node, anchor)

    def _inject(self, node: Any) -> Any:
        self.generic_visit(node)
        body = node.body
        index = 0
        if (
            body
            and isinstance(body[0], ast.Expr)
            and isinstance(getattr(body[0], "value", None), ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            index = 1
        anchor = body[index] if index < len(body) else body[0]
        body.insert(index, self._call(anchor))
        return node

    visit_FunctionDef = _inject
    visit_AsyncFunctionDef = _inject

    def visit_Lambda(self, node: ast.Lambda) -> Any:
        self.generic_visit(node)
        guard = ast.Call(func=ast.Name(id=GUARD_NAME, ctx=ast.Load()), args=[], keywords=[])
        node.body = ast.copy_location(
            ast.Subscript(
                value=ast.Tuple(elts=[guard, node.body], ctx=ast.Load()),
                slice=ast.Constant(1),
                ctx=ast.Load(),
            ),
            node.body,
        )
        return node


def guarded_code_for(source: bytes, filename: str) -> Any:
    tree = ast.parse(source, filename=filename, mode="exec")
    tree = _GuardInjector().visit(tree)
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec", dont_inherit=True)


class _GuardedProductLoader:
    """Loads product source with the authority guard compiled in."""

    def __init__(self, inner: Any, origin: str) -> None:
        self._inner = inner
        self._origin = origin

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    def create_module(self, spec: Any) -> Any:
        return None

    def exec_module(self, module: Any) -> None:
        try:
            source = self._inner.get_data(self._origin)
        except (OSError, AttributeError) as exc:
            raise ProductBindingRequired("PRODUCT_SOURCE_REQUIRED") from exc
        code = guarded_code_for(source, self._origin)
        module.__dict__[GUARD_NAME] = _product_call_guard
        module.__dict__[GUARDED_MARK] = True
        _PENDING_CODE[id(code)] = code
        try:
            exec(code, module.__dict__)  # noqa: S102 — guarded product module body
        finally:
            _PENDING_CODE.pop(id(code), None)
        name = getattr(module, "__name__", "?")
        if name not in _STATS["guarded_modules"]:
            _STATS["guarded_modules"].append(name)


class _ProductModuleFinder:
    """Route every Chatbot product module through the guarded loader."""

    _academy_product_finder = True

    @classmethod
    def find_spec(cls, fullname: str, path: Any = None, target: Any = None) -> Any:
        spec = importlib.machinery.PathFinder.find_spec(fullname, path)
        if spec is None or not spec.origin or not is_product_path(spec.origin):
            return None
        if not infrastructure_import_active():
            try:
                _validate_authority(None)
            except ProductBindingRequired:
                _STATS["denied_imports"] += 1
                raise
        if not isinstance(spec.loader, importlib.machinery.SourceFileLoader):
            raise ProductBindingRequired("PRODUCT_SOURCE_REQUIRED")
        spec.loader = _GuardedProductLoader(spec.loader, spec.origin)
        return spec

    @classmethod
    def invalidate_caches(cls) -> None:
        return None


_GUARD_INSTALLED = False


def product_code_guard_installed() -> bool:
    return _GUARD_INSTALLED and any(
        getattr(item, "_academy_product_finder", False) for item in sys.meta_path
    )


def install_product_code_guard() -> None:
    """Idempotent. Unguarded product modules already loaded are purged."""
    global _GUARD_INSTALLED
    if not any(getattr(item, "_academy_product_finder", False) for item in sys.meta_path):
        sys.meta_path.insert(0, _ProductModuleFinder)
    if not _GUARD_INSTALLED:
        _load_accepted_source_hashes()
        sys.addaudithook(_audit)
        _GUARD_INSTALLED = True
    for name, module in list(sys.modules.items()):
        origin = getattr(module, "__file__", None)
        if origin and is_product_path(origin) and not getattr(module, GUARDED_MARK, False):
            del sys.modules[name]
            _STATS["purged_unguarded_modules"].append(name)


def module_is_guarded(module: Any) -> bool:
    return bool(getattr(module, GUARDED_MARK, False)) and module.__dict__.get(GUARD_NAME) is _product_call_guard


install_product_code_guard()
