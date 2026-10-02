"""TEST_BASE binding + byte attestation — CORR2 (M-1, owner sections 31-33).

The runner MUST invoke TEST_BASE validation BEFORE product execution; no
validated binding means adapter call count = 0 and no product PASS/FAIL.

Tikhon binds to ACCEPTED_BYTE_STATE: the accepted-byte-state.json manifest is
PARSED and VALIDATED (manifest version, HEAD, tracked-modified path hashes,
deleted path set, untracked overlay hashes, manifest SHA) — mere existence is
not acceptance. Navigator binds to a SHA commit with a clean tracked tree in
the TEST_BASE worktree (the LIVE dirty tree is a different concept and is
never a valid test base).
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

HISTORY_ROOT = "/Users/entp_psyche/Desktop/InvestProjects2026/History"

EXPECTED_NAVIGATOR = {
    "repo_name": "structural-typology-navigator",
    "branch": "navigator-production-dialogue-corr2-ab-normalization",
    "head": "0a930593c1e354022160925e12e0b6474b5fa240",
    "identity_type": "SHA",
}

EXPECTED_TIKHON = {
    "repo_name": "chatbot",
    "branch": "feat/telegram-shared-brain-integration-1",
    "head": "3adbb9f1d16c299c5b42f1dccad0966c4e7eeecd",
    "identity_type": "ACCEPTED_BYTE_STATE",
}

LIVE_TREES = {
    "NAVIGATOR_TEST_ROOT": "/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator",
    "TIKHON_TEST_ROOT": "/Users/entp_psyche/Desktop/InvestProjects2026/chatbot",
}

BYTE_STATE_MANIFEST_VERSION = "1.0"


class TestBaseBindingError(RuntimeError):
    pass


@dataclass
class BindingCheck:
    root_env: str
    resolved: str | None
    ok: bool
    reasons: list[str] = field(default_factory=list)


def _is_under(path: Path, ancestor: Path) -> bool:
    try:
        path.resolve().relative_to(ancestor.resolve())
        return True
    except ValueError:
        return False


def check_history_exclusion(root: Path) -> str | None:
    if _is_under(root, Path(HISTORY_ROOT)):
        return (
            f"configured root {root} resolves under History ({HISTORY_ROOT}); "
            "History is not a live source and must never enter the benchmark"
        )
    return None


def read_worktree_identity(root: Path) -> dict | None:
    try:
        head = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True, timeout=15).stdout.strip()
        branch = subprocess.run(["git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD"],
                                capture_output=True, text=True, check=True, timeout=15).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return None
    return {"head": head, "branch": branch}


def _tracked_files_clean(root: Path) -> str | None:
    """Navigator SHA binding: tracked files must match the commit exactly."""
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=no"],
            capture_output=True, text=True, check=True, timeout=15,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        return f"tracked-cleanliness check failed: {exc}"
    if out.stdout.strip():
        return (
            "Navigator TEST_BASE must be a clean SHA worktree; unexpected tracked "
            f"modifications present:\n{out.stdout.strip()[:400]}"
        )
    return None


# ---------------------------------------------------------------------------
# ACCEPTED_BYTE_STATE manifest schema + validation (owner section 31)
# ---------------------------------------------------------------------------

def _manifest_body_digest(doc: dict) -> str:
    body = {k: v for k, v in doc.items() if k != "manifest_sha256"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def load_pinned_expected_digest(side: str) -> str | None:
    """EXTERNAL authority: the expected manifest digest is pinned in the
    harness-side canonical candidate artifact — the bound root can never
    supply its own expected authority (owner section 48)."""
    candidate = Path(__file__).resolve().parent.parent.parent / "artifacts" / "CANONICAL_TIKHON_BYTE_STATE_CANDIDATE.json"
    if not candidate.exists():
        return None
    try:
        doc = json.loads(candidate.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if side == "tikhon":
        return doc.get("manifest_sha256")
    return None


def validate_byte_state_manifest(manifest_path: Path) -> tuple[dict | None, list[str]]:
    """Parse + fully validate an accepted-byte-state manifest against the
    PINNED canonical authority (self-consistency is necessary but NOT
    sufficient; owner sections 48-49)."""
    reasons: list[str] = []
    if not manifest_path.exists():
        return None, [f"byte-state manifest missing: {manifest_path}"]
    try:
        with open(manifest_path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except json.JSONDecodeError as exc:
        return None, [f"byte-state manifest is not valid JSON: {exc}"]
    if not isinstance(doc, dict):
        return None, ["byte-state manifest must be a JSON object"]
    if doc.get("manifest_version") != BYTE_STATE_MANIFEST_VERSION:
        reasons.append(f"manifest_version {doc.get('manifest_version')!r} != {BYTE_STATE_MANIFEST_VERSION!r}")
    for req in ("head", "tracked_modified", "deleted_paths", "untracked_overlay",
                "tracked_clean_inventory"):
        if req not in doc:
            reasons.append(f"manifest missing required field {req!r}")
    if reasons:
        return doc, reasons
    if doc.get("manifest_sha256") != _manifest_body_digest(doc):
        reasons.append(
            f"manifest_sha256 mismatch: recorded {str(doc.get('manifest_sha256'))[:12]} "
            f"!= computed {_manifest_body_digest(doc)[:12]}"
        )
    # EXTERNAL authority pin: a self-rehashed incomplete manifest cannot PASS
    pinned = load_pinned_expected_digest("tikhon")
    if pinned is not None and doc.get("manifest_sha256") != pinned:
        reasons.append(
            f"manifest digest {str(doc.get('manifest_sha256'))[:12]} does not match the "
            f"externally pinned canonical authority {pinned[:12]} (self-consistent "
            "incomplete inventory rejected)"
        )
    if not isinstance(doc.get("tracked_modified"), dict):
        reasons.append("tracked_modified must be {path: sha256}")
    if not isinstance(doc.get("untracked_overlay"), dict):
        reasons.append("untracked_overlay must be {path: sha256}")
    if not isinstance(doc.get("deleted_paths"), list):
        reasons.append("deleted_paths must be a list")
    if not isinstance(doc.get("tracked_clean_inventory"), list):
        reasons.append("tracked_clean_inventory must be a list of {path, sha256}")
    return doc, reasons


def attest_tikhon_bytes(root: Path, manifest_doc: dict) -> list[str]:
    """Full inventory attestation incl. EXTRAS detection (owner section 49):
    omitted expected file, unexpected controlled file, restored deletion,
    missing overlay, changed tracked/overlay byte."""
    reasons: list[str] = []

    def sha(p: Path) -> str | None:
        try:
            return hashlib.sha256(p.read_bytes()).hexdigest()
        except OSError:
            return None

    for rel, expected_hash in (manifest_doc.get("tracked_modified") or {}).items():
        got = sha(root / rel)
        if got is None:
            reasons.append(f"tracked-modified file missing in TEST_BASE: {rel}")
        elif got != expected_hash:
            reasons.append(f"tracked-modified byte mismatch: {rel}")
    for rel in manifest_doc.get("deleted_paths") or []:
        if (root / rel).exists():
            reasons.append(f"accepted-deleted path present in TEST_BASE (restored deletion): {rel}")
    for rel, expected_hash in (manifest_doc.get("untracked_overlay") or {}).items():
        got = sha(root / rel)
        if got is None:
            reasons.append(f"untracked overlay file missing in TEST_BASE: {rel}")
        elif got != expected_hash:
            reasons.append(f"untracked overlay byte mismatch: {rel}")
    # clean tracked inventory: every recorded clean tracked file must be
    # present and byte-identical (omitted expected file is detected)
    for entry in manifest_doc.get("tracked_clean_inventory") or []:
        rel, expected_hash = entry.get("path"), entry.get("sha256")
        got = sha(root / rel) if rel else None
        if got is None:
            reasons.append(f"expected clean tracked file missing in TEST_BASE: {rel}")
        elif got != expected_hash:
            reasons.append(f"clean tracked byte mismatch: {rel}")
    return reasons


def detect_unexpected_controlled_files(root: Path, manifest_doc: dict) -> list[str]:
    """Unexpected CONTROLLED files are a binding failure (owner section 49):
    a tracked file present in the tree but absent from the canonical
    inventory, or an overlay-eligible untracked file not in the overlay
    inventory. Declared excluded classes are never flagged."""
    reasons: list[str] = []
    known = set(manifest_doc.get("tracked_modified") or {})
    known |= set(manifest_doc.get("deleted_paths") or [])
    known |= set(manifest_doc.get("untracked_overlay") or {})
    known |= {e.get("path") for e in manifest_doc.get("tracked_clean_inventory") or []}
    excluded_classes = manifest_doc.get("excluded_classes") or []
    import fnmatch

    def excluded(rel: str) -> bool:
        return any(fnmatch.fnmatch(rel, pat) for pat in excluded_classes)

    try:
        ls = subprocess.run(["git", "-C", str(root), "ls-files"],
                            capture_output=True, text=True, check=True, timeout=30).stdout.splitlines()
    except (subprocess.SubprocessError, OSError):
        return reasons
    for rel in sorted(set(ls) - known):
        if not excluded(rel):
            reasons.append(f"unexpected tracked file not in canonical inventory: {rel}")
    overlay_inventory = set(manifest_doc.get("untracked_overlay") or {})
    included_patterns = manifest_doc.get("overlay_included_classes") or []
    overlay_tree = {str(p.relative_to(root)) for p in root.rglob("*")
                    if p.is_file() and ".git" not in p.parts and not excluded(str(p.relative_to(root)))}
    for rel in sorted((overlay_tree & set(ls)) - overlay_inventory - set(ls)):
        continue  # tracked handled above
    for rel in sorted(overlay_tree - overlay_inventory - set(ls)):
        if any(fnmatch.fnmatch(rel, pat) for pat in included_patterns):
            reasons.append(f"unexpected overlay-eligible untracked file not in canonical inventory: {rel}")
    return reasons


@dataclass
class _BC:
    root_env: str
    resolved: str | None
    ok: bool
    reasons: list = field(default_factory=list)


def check_root(env_name: str, expected: dict, *, require_worktree_marker: bool = True):
    raw = os.environ.get(env_name, "").strip()
    if not raw:
        return _BC(env_name, None, False,
                   [f"{env_name} not configured: the harness refuses to guess a SUT path"])
    root = Path(raw).expanduser()
    if not root.exists() or not root.is_dir():
        return _BC(env_name, str(root), False,
                   [f"{env_name}={raw} does not exist or is not a directory"])
    if reason := check_history_exclusion(root):
        return _BC(env_name, str(root), False, [reason])
    live = LIVE_TREES.get(env_name)
    if live and _is_under(root, Path(live)):
        return _BC(env_name, str(root), False,
                   [f"{env_name}={raw} resolves inside the LIVE product tree {live}"])
    if require_worktree_marker and not (root / ".git").exists():
        return _BC(env_name, str(root), False, [f"{root} has no .git: not a bound worktree"])
    identity = read_worktree_identity(root)
    reasons: list[str] = []
    if identity is None:
        reasons.append("worktree identity could not be read")
    else:
        if identity.get("head") != expected["head"]:
            reasons.append(f"HEAD {identity.get('head')} != expected {expected['head']}")
        if identity.get("branch") != expected["branch"]:
            reasons.append(f"branch {identity.get('branch')!r} != expected {expected['branch']!r}")
        if expected["identity_type"] == "SHA":
            try:
                out = subprocess.run(
                    ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=no"],
                    capture_output=True, text=True, check=True, timeout=15)
                if out.stdout.strip():
                    reasons.append("Navigator TEST_BASE must be a clean SHA worktree")
            except (subprocess.SubprocessError, OSError) as exc:
                reasons.append(f"tracked-cleanliness check failed: {exc}")
        else:
            manifest_path = root / "tests" / "_testbase" / "accepted-byte-state.json"
            doc, m_reasons = validate_byte_state_manifest(manifest_path)
            reasons.extend(m_reasons)
            if doc is not None and not m_reasons:
                if doc.get("head") != expected["head"]:
                    reasons.append(f"manifest head mismatch")
                reasons.extend(attest_tikhon_bytes(root, doc))
                reasons.extend(detect_unexpected_controlled_files(root, doc))
    return _BC(env_name, str(root), not reasons, reasons)


def bind_test_bases_with_token(*, run_id: str = "") -> "object":
    """The RUNNER calls this itself: execute the binding authority and, on
    success, mint the harness-generated BindingToken (owner section 16).
    Caller-supplied binding dicts are never authority."""
    # CORR4 B-03: the factory module is harness/factory.py — from a seams
    # submodule the correct relative import is the PARENT package (..factory).
    # The previous `.factory` resolved the nonexistent harness.seams.factory
    # and raised ModuleNotFoundError on the mandatory PRODUCT binding path.
    from ..factory import BindingToken, BINDING_TOKEN_SCHEMA_VERSION
    from datetime import datetime, timezone

    nav = check_root("NAVIGATOR_TEST_ROOT", EXPECTED_NAVIGATOR)
    tikhon = check_root("TIKHON_TEST_ROOT", EXPECTED_TIKHON)
    reasons = list(nav.reasons) + list(tikhon.reasons)
    token_ok = nav.ok and tikhon.ok
    token = BindingToken(
        schema_version=BINDING_TOKEN_SCHEMA_VERSION,
        navigator_expected=dict(EXPECTED_NAVIGATOR),
        tikhon_expected=dict(EXPECTED_TIKHON),
        navigator_root=nav.resolved if nav.ok else None,
        tikhon_root=tikhon.resolved if tikhon.ok else None,
        navigator_manifest_sha256=None,
        tikhon_manifest_sha256=(json.loads((Path(tikhon.resolved) / "tests" / "_testbase" / "accepted-byte-state.json").read_text()).get("manifest_sha256") if tikhon.ok else None),
        created_at_utc=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        run_id=run_id,
    )

    class _Binding:
        pass

    b = _Binding()
    b.token = token
    b.token_ok = token_ok
    b.reasons = reasons
    b.navigator = {"ok": nav.ok, "resolved": nav.resolved, "reasons": nav.reasons}
    b.tikhon = {"ok": tikhon.ok, "resolved": tikhon.resolved, "reasons": tikhon.reasons}
    return b


def bind_test_bases(*, navigator_required: bool = True, tikhon_required: bool = True) -> dict:
    nav = check_root("NAVIGATOR_TEST_ROOT", EXPECTED_NAVIGATOR) if navigator_required else None
    tikhon = check_root("TIKHON_TEST_ROOT", EXPECTED_TIKHON) if tikhon_required else None
    ok = True
    if navigator_required and nav is not None and not nav.ok:
        ok = False
    if tikhon_required and tikhon is not None and not tikhon.ok:
        ok = False
    return {
        "navigator": ({"ok": nav.ok, "resolved": nav.resolved, "reasons": nav.reasons, "expected": EXPECTED_NAVIGATOR} if nav else {"ok": True, "resolved": None, "reasons": [], "expected": EXPECTED_NAVIGATOR, "skipped": True}),
        "tikhon": ({"ok": tikhon.ok, "resolved": tikhon.resolved, "reasons": tikhon.reasons, "expected": EXPECTED_TIKHON} if tikhon else {"ok": True, "resolved": None, "reasons": [], "expected": EXPECTED_TIKHON, "skipped": True}),
        "all_bound": ok,
    }


def synthetic_history_path_probe() -> list[str]:
    probes = [
        os.path.join(HISTORY_ROOT, "some-archived-repo"),
        os.path.join(HISTORY_ROOT, "nested", "deeper", "repo"),
        "/tmp/safe-outside-history",
        "/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator",
    ]
    results = []
    for p in probes:
        excluded = check_history_exclusion(Path(p)) is not None
        results.append(f"{p} -> {'EXCLUDED' if excluded else 'ALLOWED'}")
    return results
