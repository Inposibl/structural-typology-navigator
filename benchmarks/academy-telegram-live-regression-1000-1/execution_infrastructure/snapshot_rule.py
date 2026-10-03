"""Replayable filesystem snapshot rule.

The hash domain is covered file bytes and symlink target strings. mtime,
atime, ctime, uid, gid, mode, and inode are excluded. `.git/objects/**` is
excluded, so an mtime-only change there is not byte-state drift. Symlinks are
recorded and not followed. `tests/_testbase -> ../.git/_testbase` is disclosed
as sanctioned provisioning metadata.
"""

from __future__ import annotations

if __name__ == "__main__" and __package__ in {None, ""}:
    import sys
    from pathlib import Path as _Path

    _bench = _Path(__file__).resolve().parents[1]
    if str(_bench) not in sys.path:
        sys.path.insert(0, str(_bench))
    from execution_infrastructure.snapshot_rule import snapshot_sha256 as _snapshot_sha256

    if len(sys.argv) != 2:
        raise SystemExit(
            "usage: python3 benchmarks/academy-telegram-live-regression-1000-1/"
            "execution_infrastructure/snapshot_rule.py <absolute-root>"
        )
    sys.stdout.write(_snapshot_sha256(_Path(sys.argv[1])) + "\n")
    raise SystemExit(0)

import hashlib
import os
import unicodedata
from pathlib import Path
from typing import Any

from .constants import SANCTIONED_SYMLINK_RELATIVE, SANCTIONED_SYMLINK_TARGET
from .pd_f04_provider_evidence import canonical_json, sha256_bytes

RULE_ID = "academy-telegram-byte-state-snapshot-1"
EXCLUDED_PREFIX = ".git/objects"


def _relative(root: Path, path: Path) -> str:
    rel = path.relative_to(root).as_posix()
    return unicodedata.normalize("NFC", rel)


def _excluded(rel: str) -> bool:
    return rel == EXCLUDED_PREFIX or rel.startswith(EXCLUDED_PREFIX + "/")


def _entry_for(root: Path, path: Path) -> dict[str, Any] | None:
    rel = _relative(root, path)
    if _excluded(rel):
        return None
    if path.is_symlink():
        target = os.readlink(path)
        sanctioned = rel == SANCTIONED_SYMLINK_RELATIVE and target == SANCTIONED_SYMLINK_TARGET
        return {
            "path": rel,
            "type": "symlink",
            "size": None,
            "sha256": None,
            "symlink_target": target,
            "followed": False,
            "sanctioned_provisioning_symlink": sanctioned,
        }
    if not path.is_file():
        return None
    data = path.read_bytes()
    return {
        "path": rel,
        "type": "file",
        "size": len(data),
        "sha256": sha256_bytes(data),
        "symlink_target": None,
        "followed": False,
        "sanctioned_provisioning_symlink": False,
    }


def snapshot_document(root: Path) -> dict[str, Any]:
    root = root.resolve()
    entries: list[dict[str, Any]] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        current = Path(dirpath)
        kept_dirs = []
        for name in dirnames:
            candidate = current / name
            if candidate.is_symlink():
                entry = _entry_for(root, candidate)
                if entry is not None:
                    entries.append(entry)
                continue
            rel = _relative(root, candidate)
            if _excluded(rel):
                continue
            kept_dirs.append(name)
        dirnames[:] = kept_dirs
        for name in filenames:
            entry = _entry_for(root, current / name)
            if entry is not None:
                entries.append(entry)
    entries.sort(key=lambda item: item["path"])
    disclosures = [
        {
            "path": entry["path"],
            "target": entry["symlink_target"],
            "sanctioned_provisioning_symlink": True,
            "followed": False,
            "part_of_152_file_hash_bound_authority_object": False,
        }
        for entry in entries
        if entry["sanctioned_provisioning_symlink"]
    ]
    document = {
        "rule_id": RULE_ID,
        "encoding": "utf-8",
        "serialization": "canonical-json-utf8",
        "hash_domain": "covered-file-bytes-and-symlink-targets",
        "path_normalization": "relative-posix-nfc",
        "ordering": "path-ascending",
        "symlink_treatment": "record-target-do-not-follow",
        "metadata_included": [
            "path",
            "type",
            "size",
            "sha256",
            "symlink_target",
            "sanctioned_provisioning_symlink",
            "followed",
        ],
        "metadata_excluded": ["mtime", "atime", "ctime", "uid", "gid", "mode", "inode"],
        "excluded_paths": [".git/objects/**"],
        "git_object_mtime_is_byte_identity": False,
        "entries": entries,
        "sanctioned_symlink_disclosures": disclosures,
    }
    document["final_sha256"] = sha256_bytes(canonical_json({
        key: value for key, value in document.items() if key != "final_sha256"
    }).encode("utf-8"))
    return document


def snapshot_sha256(root: Path) -> str:
    return snapshot_document(root)["final_sha256"]


def disclose_sanctioned_symlink(root: Path) -> dict[str, Any]:
    """Read the link target only. Do not follow it and do not mutate it."""
    link = root / SANCTIONED_SYMLINK_RELATIVE
    if not link.is_symlink():
        return {
            "present": False,
            "path": SANCTIONED_SYMLINK_RELATIVE,
            "followed": False,
        }
    target = os.readlink(link)
    return {
        "present": True,
        "path": SANCTIONED_SYMLINK_RELATIVE,
        "target": target,
        "sanctioned_provisioning_symlink": target == SANCTIONED_SYMLINK_TARGET,
        "followed": False,
        "part_of_152_file_hash_bound_authority_object": False,
        "deleted": False,
    }


if __name__ == "__main__":
    import sys
    print(snapshot_sha256(Path(sys.argv[1])))
