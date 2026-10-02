"""CANONICAL_TIKHON_BYTE_STATE_CANDIDATE v4 builder — CORR4 M-02 (owner §36).

IV4 found the CORR3 candidate's published overlay rule (`docs/*`) and its
physical inventory disagree (68 listed vs 71 rule-eligible physical files:
docs/.DS_Store + two .docx methodology documents were rule-eligible but
unlisted).

The CORR4 policy is EXPLICIT and non-ambiguous:
  - controlled overlay = untracked files matching the CONTROLLED EXTENSIONS
    anywhere in the tree ({.py,.mjs,.js,.ts,.json,.yml,.yaml,.toml,.sql,.sh,
    .md,.txt} + Dockerfile/docker-compose.yml/requirements*.txt/.dockerignore)
    — documents are controlled ONLY as runtime-syncable TEXT under docs/
    (docs/**/*.md, docs/**/*.txt), never as a blanket docs/*;
  - EXPLICIT excluded classes (never controlled, never read): **/.DS_Store,
    *.docx, *.doc, *.pdf, *.zip, credentials/*, .env*, *.env, *.db,
    *.sqlite*, *.session, __pycache__/*, venv/*, .git/*, *.pyc, nohup.out,
    *.log.

The inventory is computed by PHYSICAL traversal under this policy (not by
git's ignore filter). Excluded sensitive contents are never read or hashed.
The result remains a CANDIDATE pending IV5/Owner acceptance.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
TIKHON = Path("/Users/entp_psyche/Desktop/InvestProjects2026/chatbot")
EXPECTED_HEAD = "3adbb9f1d16c299c5b42f1dccad0966c4e7eeecd"
EXPECTED_BRANCH = "feat/telegram-shared-brain-integration-1"

CONTROLLED_EXTENSIONS = {".py", ".mjs", ".js", ".ts", ".json", ".yml", ".yaml",
                         ".toml", ".sql", ".sh", ".md", ".txt"}
CONTROLLED_BASENAMES = {"Dockerfile", "docker-compose.yml", ".dockerignore"}
CONTROLLED_BASENAME_PREFIXES = ("requirements",)
# explicit controlled DIRECTORIES: every file inside (minus excluded classes) —
# deployment/operational units are runtime bytes regardless of extension
CONTROLLED_DIRECTORIES = {"deploy", "scripts", "tests"}

EXCLUDED_CLASSES = [
    "**/.DS_Store", "*.docx", "*.doc", "*.pdf", "*.zip",
    "credentials/*", ".env*", "*.env", "*.db", "*.sqlite*", "*.session",
    "__pycache__/*", "venv/*", ".git/*", "*.pyc", "nohup.out", "*.log",
]

OVERLAY_INCLUDED_CLASSES = [
    "*.py", "*.mjs", "*.js", "*.ts", "*.json", "*.yml", "*.yaml", "*.toml",
    "*.sql", "*.sh", "*.md", "*.txt", "Dockerfile", "docker-compose.yml",
    ".dockerignore", "requirements*", "docs/**/*.md", "docs/**/*.txt",
    "deploy/**", "scripts/**", "tests/**",
]


def _excluded(rel: str) -> bool:
    import fnmatch

    parts = rel.split("/")
    name = parts[-1]
    for pat in EXCLUDED_CLASSES:
        if fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(name, pat):
            return True
    # any .DS_Store anywhere
    if name == ".DS_Store":
        return True
    if parts[0] in ("credentials", "venv", "__pycache__", ".git"):
        return True
    return False


def _overlay_controlled(rel: str) -> bool:
    import fnmatch

    if _excluded(rel):
        return False
    p = Path(rel)
    name = p.name
    top = rel.split("/")[0]
    if top in CONTROLLED_DIRECTORIES:
        return True  # explicit controlled directory family (exclusions still apply)
    if name in CONTROLLED_BASENAMES:
        return True
    if any(name.startswith(pre) for pre in CONTROLLED_BASENAME_PREFIXES) and p.suffix == ".txt":
        return True
    if p.suffix in CONTROLLED_EXTENSIONS:
        return True
    return False


def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def _git(*args: str) -> str:
    env = {"PATH": "/usr/bin:/bin:/usr/local/bin", "GIT_OPTIONAL_LOCKS": "0",
           "HOME": str(Path.home())}
    out = subprocess.run(["git", "-C", str(TIKHON), *args], capture_output=True,
                         text=True, check=True, timeout=60, env=env)
    return out.stdout


def build_candidate() -> dict:
    head = _git("rev-parse", "HEAD").strip()
    branch = _git("rev-parse", "--abbrev-ref", "HEAD").strip()
    if head != EXPECTED_HEAD or branch != EXPECTED_BRANCH:
        raise SystemExit(f"tikhon identity drift: {branch}/{head[:12]}")

    modified = {}
    for rel in _git("diff", "--name-only", "--diff-filter=M").splitlines():
        if rel.strip() and not _excluded(rel.strip()):
            modified[rel.strip()] = _sha(TIKHON / rel)
    deleted = [l.strip() for l in _git("diff", "--name-only", "--diff-filter=D").splitlines() if l.strip()]
    ls_files = [l.strip() for l in _git("ls-files").splitlines() if l.strip()]
    clean_tracked = []
    known = set(modified) | set(deleted)
    for rel in ls_files:
        if rel in known or _excluded(rel):
            continue
        p = TIKHON / rel
        if p.exists() and p.is_file():
            clean_tracked.append({"path": rel, "sha256": _sha(p)})

    tracked = set(ls_files)
    overlay = {}
    excluded_seen = []
    for p in sorted(TIKHON.rglob("*")):
        if not p.is_file() or ".git" in p.parts:
            continue
        rel = p.relative_to(TIKHON).as_posix()
        if rel in tracked:
            continue
        if _excluded(rel):
            excluded_seen.append(rel)
            continue
        if _overlay_controlled(rel):
            overlay[rel] = _sha(p)

    doc = {
        "manifest_version": "1.0",
        "head": head,
        "branch": branch,
        "tracked_modified": modified,
        "deleted_paths": deleted,
        "untracked_overlay": overlay,
        "tracked_clean_inventory": clean_tracked,
        "excluded_classes": EXCLUDED_CLASSES,
        "overlay_included_classes": OVERLAY_INCLUDED_CLASSES,
        "overlay_policy": (
            "EXPLICIT controlled-overlay policy (CORR4 M-02): untracked files with "
            "controlled source/config/text extensions anywhere in the tree, plus "
            "Dockerfile/docker-compose.yml/.dockerignore/requirements*.txt; documents "
            "are controlled ONLY as runtime-syncable text (docs/**/*.md, docs/**/*.txt) "
            "— the ambiguous blanket docs/* rule is RETIRED; non-runtime binary "
            "documents (.docx/.doc/.pdf), .DS_Store and sensitive classes are "
            "explicitly excluded and never read"),
        "counts": {
            "head": head,
            "tracked_modified": len(modified),
            "tracked_deleted": len(deleted),
            "clean_tracked": len(clean_tracked),
            "controlled_untracked_overlay": len(overlay),
            "explicit_excluded_untracked": len(excluded_seen),
        },
        "iv4_discrepancy_resolution": (
            "IV4 M-02: published rule docs/* was rule-eligible for 71 physical files "
            "while 68 were listed. The explicit policy retires the blanket docs/* rule; "
            "docs/.DS_Store and the two .docx methodology documents are EXCLUDED "
            "classes (non-runtime), so the policy and the physical inventory now agree "
            "by construction"),
        "derived_from": "physical policy traversal of the live Tikhon tree (read-only; excluded sensitive classes never read)",
        "candidate_status": "CANDIDATE — pending IV5/Owner acceptance",
    }
    body = {k: v for k, v in doc.items() if k != "manifest_sha256"}
    doc["manifest_sha256"] = hashlib.sha256(
        json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return doc


def main() -> int:
    doc = build_candidate()
    out = BENCH / "artifacts" / "CANONICAL_TIKHON_BYTE_STATE_CANDIDATE.json"
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=2, sort_keys=True))
    print("counts:", json.dumps(doc["counts"], ensure_ascii=False))
    print("manifest_sha256:", doc["manifest_sha256"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
