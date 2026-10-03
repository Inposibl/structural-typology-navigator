"""Evidence layer v4 — CORR4 (B-01, B-02, B-17; IV4 owner sections 8-10, 30-31).

Closures over IV4:
- DIRECTORY-ANCHORED FILE API (B-01): the evidence parent directory is
  resolved and validated ONCE; every open/read/write addresses the validated
  BASENAME through held directory file descriptors (os.open(..., dir_fd=...),
  O_NOFOLLOW on every hop). The path object actually opened is therefore the
  same contained target that was validated — a directory swapped between
  validation and access cannot redirect a frozen evidence read or write.
- ATOMIC EXCLUSIVE FREEZE: O_CREAT | O_EXCL (anchored) — exactly ONE writer
  succeeds per EvidenceIdentity; concurrent writers fail; no exists()+rename
  race exists in the code path.
- STRUCTURED FIELD REFS (B-02): field evidence references bind {identity,
  FIELD_NAME, value digest}; resolution verifies the declared field name
  against the field being scored and recomputes the digest from the verified
  frozen artifact — index membership alone is not authority.
- SANITIZE BEFORE ObservedValue (B-17): the recursive sanitizer runs on every
  capture value BEFORE the authoritative ObservedValue / field digest / frozen
  evidence representation is built; the unsanitized value never becomes the
  persisted authoritative observed value.
- MEANINGFUL TRANSCRIPT validation for semantic-required scenarios.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from .provenance import (
    FORBIDDEN_PROVENANCE,
    ProvenanceKind,
    is_allowed_provenance,
)

UNOBSERVED = "UNOBSERVED"

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")


class EvidencePathError(RuntimeError):
    """Evidence identity components would form an unsafe filesystem path."""


class EvidenceNotFrozenError(RuntimeError):
    pass


class EvidenceIdentityMismatch(RuntimeError):
    pass


class EvidenceLocationMismatch(RuntimeError):
    """The evidence CONTAINER currently addressed is not the container that
    was originally frozen (IV5 F01): location identity is part of the frozen
    evidence handle, and content equality of copied bytes does NOT substitute
    for location/provenance identity."""


class EvidenceImmutableViolation(RuntimeError):
    pass


class ProvenanceViolation(ValueError):
    pass


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_canonical(obj: Any) -> str:
    return hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_identifier(kind: str, value: str) -> str:
    """Restricted identifier format for evidence path components (owner §10)."""
    if not isinstance(value, str) or not _SAFE_ID_RE.fullmatch(value):
        raise EvidencePathError(
            f"{kind} {value!r} is not a safe evidence identifier "
            "(restricted format [A-Za-z0-9][A-Za-z0-9._-]{{0,119}} required)"
        )
    if ".." in value or "/" in value or "\\" in value or value.startswith("."):
        raise EvidencePathError(f"{kind} {value!r} contains a forbidden path sequence")
    return value


@dataclass(frozen=True)
class EvidenceIdentity:
    run_id: str
    scenario_id: str
    scenario_sha256: str
    observation_id: str
    attempt_index: int
    evidence_type: str

    def __post_init__(self) -> None:
        validate_identifier("RUN_ID", self.run_id)
        validate_identifier("SCENARIO_ID", self.scenario_id)
        validate_identifier("OBSERVATION_ID", self.observation_id)
        validate_identifier("EVIDENCE_TYPE", self.evidence_type)

    def to_json(self) -> dict:
        return {
            "run_id": self.run_id,
            "scenario_id": self.scenario_id,
            "scenario_sha256": self.scenario_sha256,
            "observation_id": self.observation_id,
            "attempt_index": self.attempt_index,
            "evidence_type": self.evidence_type,
        }

    def path_under(self, evidence_root: str) -> str:
        path = os.path.join(
            evidence_root,
            self.run_id,
            self.scenario_id,
            f"{self.observation_id}.{self.evidence_type}.json",
        )
        return contained_path(evidence_root, path)


def contained_path(evidence_root: str, path: str) -> str:
    """Resolve (realpath) and PROVE the path remains under the evidence root."""
    root_real = os.path.realpath(evidence_root)
    parent = os.path.dirname(path)
    if os.path.isdir(parent):
        parent_real = os.path.realpath(parent)
    else:
        # resolve the nearest existing ancestor to defeat symlinked dirs
        ancestor = parent
        while not os.path.isdir(ancestor):
            nxt = os.path.dirname(ancestor)
            if nxt == ancestor:
                break
            ancestor = nxt
        rest = parent[len(ancestor):].lstrip(os.sep)
        parent_real = os.path.join(os.path.realpath(ancestor), rest)
    candidate_real = os.path.join(parent_real, os.path.basename(path))
    if os.path.commonpath([root_real, candidate_real]) != root_real:
        raise EvidencePathError(
            f"evidence path {path!r} escapes the evidence root {evidence_root!r} "
            "(symlink or traversal escape rejected)"
        )
    return candidate_real


# ---------------------------------------------------------------------------
# Directory-anchored evidence access (B-01)
#
# Design: the evidence parent directory chain is resolved and validated ONCE
# (each component must be a real directory — never a symlink — directly under
# the previous validated component), and its OBJECT IDENTITY (st_dev, st_ino)
# is captured at validation time. Every subsequent open/read/write then:
#   1. addresses ONLY the validated basename (a restricted identifier) under
#      the validated scenario directory,
#   2. opens with O_NOFOLLOW (a symlink planted at the final component is
#      refused), and
#   3. PROVES the directory the file was opened in still IS the validated
#      directory object (identity re-check before and after the open).
# A directory swapped between validation and access has a different object
# identity and is refused: the path actually opened is the same contained
# target that was validated. (os.open dir_fd is unavailable on darwin; this
# is the platform-equivalent directory-anchored file API.)
# ---------------------------------------------------------------------------

_O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)


def _dir_identity(st) -> tuple[int, int]:
    return (st.st_dev, st.st_ino)


def _validated_dir_chain(evidence_root: str, run_id: str, scenario_id: str) -> tuple[str, tuple[int, int]]:
    """Validate/create the root -> RUN_ID -> SCENARIO_ID chain and return the
    scenario directory path together with its validated object identity."""
    import stat as _stat

    validate_identifier("RUN_ID", run_id)
    validate_identifier("SCENARIO_ID", scenario_id)
    root_real = os.path.realpath(evidence_root)
    if not os.path.isdir(root_real):
        raise EvidencePathError(f"evidence root {evidence_root!r} is not a directory")
    chain = [root_real, os.path.join(root_real, run_id), None]
    chain[2] = os.path.join(chain[1], scenario_id)
    path = chain[0]
    for nxt in chain[1:]:
        try:
            st = os.lstat(nxt)
        except FileNotFoundError:
            try:
                os.mkdir(nxt, 0o755)  # single validated component under the validated parent
            except FileExistsError:
                pass  # concurrent writer created it: fall through to validation
            st = os.lstat(nxt)
        if _stat.S_ISLNK(st.st_mode):
            raise EvidencePathError(
                f"evidence component {nxt!r} is a symlink (anchored access refused)")
        if not _stat.S_ISDIR(st.st_mode):
            raise EvidencePathError(f"evidence component {nxt!r} is not a directory")
        path = nxt
    scen_dir = chain[2]
    return scen_dir, _dir_identity(os.lstat(scen_dir))


def _anchored_open(basename: str, scen_dir: str, validated_identity: tuple[int, int],
                   flags: int, mode: int = 0o644) -> int:
    """Open the validated basename inside the validated scenario directory,
    proving the directory object identity before and after the open."""
    import stat as _stat

    if os.path.basename(basename) != basename or basename in (".", ".."):
        raise EvidencePathError(f"evidence basename {basename!r} is not a single component")
    before = os.lstat(scen_dir)
    if _dir_identity(before) != validated_identity:
        raise EvidencePathError(
            f"evidence directory {scen_dir!r} changed identity between validation and "
            "access (directory swap refused)")
    fd = os.open(os.path.join(scen_dir, basename), flags | _O_NOFOLLOW, mode)
    try:
        after = os.lstat(scen_dir)
        if _dir_identity(after) != validated_identity or not _stat.S_ISDIR(after.st_mode):
            raise EvidencePathError(
                f"evidence directory {scen_dir!r} changed identity during access "
                "(directory swap refused)")
    except BaseException:
        os.close(fd)
        raise
    return fd


# ---------------------------------------------------------------------------
# F01 (IV5): persistent evidence LOCATION identity.
#
# CORR4 anchored every per-access open to a validated directory identity, but
# FrozenEvidence forgot the identity of the directory that existed when the
# evidence was FROZEN: a later access could validate a replacement directory
# as a fresh valid directory and accept byte-identical copied evidence. The
# freeze-time container identity is now part of the frozen evidence handle:
# it is embedded in the frozen document (under the content digest) and every
# subsequent load MUST find the SAME container object identity. Content SHA
# identity, EvidenceIdentity and location identity remain SEPARATE concepts:
# content equality never replaces location/provenance identity.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EvidenceLocationIdentity:
    """Immutable minimum local identity of the evidence container that existed
    at freeze time: the evidence root's real path plus the scenario
    directory's object identity (st_dev, st_ino)."""

    root_realpath: str
    run_id: str
    scenario_id: str
    dir_st_dev: int
    dir_st_ino: int

    def to_json(self) -> dict:
        return {
            "root_realpath": self.root_realpath,
            "run_id": self.run_id,
            "scenario_id": self.scenario_id,
            "dir_st_dev": self.dir_st_dev,
            "dir_st_ino": self.dir_st_ino,
        }

    @classmethod
    def from_json(cls, doc: dict) -> "EvidenceLocationIdentity":
        return cls(
            root_realpath=str(doc["root_realpath"]),
            run_id=str(doc["run_id"]),
            scenario_id=str(doc["scenario_id"]),
            dir_st_dev=int(doc["dir_st_dev"]),
            dir_st_ino=int(doc["dir_st_ino"]),
        )

    def matches_current(self, root_realpath: str, run_id: str, scenario_id: str,
                        current_identity: tuple[int, int]) -> bool:
        return (
            self.run_id == run_id
            and self.scenario_id == scenario_id
            and self.dir_st_dev == current_identity[0]
            and self.dir_st_ino == current_identity[1]
            # the recorded root real path pins WHICH root container was frozen;
            # a replacement tree mounted at a different real path is not the
            # original container even when bytes are identical
            and self.root_realpath == root_realpath
        )


def field_evidence_ref(identity: EvidenceIdentity, field_name: str, value: Any) -> dict:
    """Structured field reference binding identity + field + value digest."""
    return {
        "identity": identity.to_json(),
        "field_name": field_name,
        "value_digest": sha256_canonical(value),
    }


def resolve_field_ref(evidence_doc: dict, field_name: str, block: dict) -> None:
    """Resolve a field evidence ref against the VERIFIED frozen artifact.

    The ref must name this artifact's identity, its DECLARED FIELD NAME must
    equal the field being scored, and its value_digest must equal the
    recomputed digest of the referenced value. Index membership alone is not
    authority (owner section 12; IV4 B-02).
    """
    if block.get("provenance") in (None, "UNOBSERVED"):
        return
    ref = block.get("evidence_ref")
    if not isinstance(ref, dict):
        raise EvidenceIdentityMismatch(
            f"observed field {field_name!r} has no structured evidence reference"
        )
    if ref.get("field_name") != field_name:
        raise EvidenceIdentityMismatch(
            f"field ref declares field {ref.get('field_name')!r} but was resolved "
            f"against field {field_name!r} (field-name identity violated)"
        )
    stored_identity = evidence_doc.get("identity") or {}
    if ref.get("identity") != stored_identity:
        raise EvidenceIdentityMismatch(
            f"field ref for {field_name!r} binds a different observation identity"
        )
    expected_digest = sha256_canonical(block.get("value"))
    if ref.get("value_digest") != expected_digest:
        raise EvidenceIdentityMismatch(
            f"field ref for {field_name!r} fails value-digest resolution "
            "(foreign or mutated field reference)"
        )


@dataclass(frozen=True)
class FrozenEvidence:
    identity: EvidenceIdentity
    path: str
    sha256: str
    # F01: freeze-time container identity (set by freeze_evidence; carried on
    # the handle AND embedded in the frozen document under the digest)
    location_identity: "EvidenceLocationIdentity | None" = None

    def _anchored_load(self) -> dict:
        """B-01 + F01: the read is anchored to the VALIDATED identity components
        (root -> RUN_ID -> SCENARIO_ID -> basename). The validated directory
        object identity is re-proved around the open, the final component is
        opened O_NOFOLLOW, and — since CORR5 — the CURRENT container identity
        must equal the freeze-time LOCATION identity recorded inside the frozen
        document: a replacement directory carrying byte-identical copied
        evidence is refused (content equality does not replace location
        identity)."""
        validate_identifier("RUN_ID", self.identity.run_id)
        validate_identifier("SCENARIO_ID", self.identity.scenario_id)
        validate_identifier("OBSERVATION_ID", self.identity.observation_id)
        validate_identifier("EVIDENCE_TYPE", self.identity.evidence_type)
        basename = f"{self.identity.observation_id}.{self.identity.evidence_type}.json"
        root = _evidence_root_of(self.path)
        root_real = os.path.realpath(root)
        scen_dir, identity = _validated_dir_chain(root, self.identity.run_id,
                                                  self.identity.scenario_id)
        fd = _anchored_open(basename, scen_dir, identity, os.O_RDONLY)
        try:
            with os.fdopen(fd, "rb") as fh:
                data = fh.read()
        except FileNotFoundError as exc:
            raise EvidenceNotFrozenError(f"frozen evidence missing: {self.path}") from exc
        digest = sha256_bytes(data)
        if digest != self.sha256:
            raise EvidenceNotFrozenError(
                f"frozen evidence hash drift: expected {self.sha256}, got {digest}"
            )
        doc = json.loads(data.decode("utf-8"))
        stored_identity = doc.get("identity") or {}
        for key, expected in self.identity.to_json().items():
            if stored_identity.get(key) != expected:
                raise EvidenceIdentityMismatch(
                    f"evidence identity mismatch on {key}: stored "
                    f"{stored_identity.get(key)!r} != requested {expected!r}"
                )
        stored_location = doc.get("location_identity")
        if not isinstance(stored_location, dict):
            raise EvidenceLocationMismatch(
                f"frozen evidence {self.path!r} carries no freeze-time location "
                "identity: the container that was originally frozen cannot be "
                "proved (post-CORR5 evidence must record it)"
            )
        frozen_location = EvidenceLocationIdentity.from_json(stored_location)
        if not frozen_location.matches_current(root_real, self.identity.run_id,
                                               self.identity.scenario_id, identity):
            raise EvidenceLocationMismatch(
                f"frozen evidence {self.path!r} is being addressed through a "
                "REPLACEMENT container: current directory identity "
                f"{identity} != frozen container identity "
                f"({frozen_location.dir_st_dev}, {frozen_location.dir_st_ino}) "
                f"at root {frozen_location.root_realpath!r}; byte-identical "
                "copied evidence does not restore location identity"
            )
        return doc

    def verify(self) -> None:
        self._anchored_load()

    def verify_for(self, *, run_id: str, scenario_id: str, scenario_sha256: str,
                   observation_id: str, attempt_index: int,
                   evidence_type: str = "RAW_OBSERVATION") -> dict:
        if self.identity.evidence_type != evidence_type:
            raise EvidenceIdentityMismatch(
                f"evidence_type {self.identity.evidence_type!r} != {evidence_type!r}"
            )
        doc = self._anchored_load()
        if (
            self.identity.run_id != run_id
            or self.identity.scenario_id != scenario_id
            or self.identity.scenario_sha256 != scenario_sha256
            or self.identity.observation_id != observation_id
            or self.identity.attempt_index != attempt_index
        ):
            raise EvidenceIdentityMismatch(
                "scoring identity does not match frozen evidence identity"
            )
        return doc

    def load(self) -> dict:
        return self._anchored_load()


def _root_of(path: str) -> str:
    marker = os.sep + "evidence_runs"
    idx = path.find(marker)
    if idx == -1:
        return os.path.dirname(path)
    return path[: idx + len(marker)]


def _evidence_root_of(path: str) -> str:
    """The evidence file layout is <root>/<RUN_ID>/<SCENARIO_ID>/<basename>:
    the evidence root is exactly three dirname levels above the file. (Falls
    back to the evidence_runs marker for legacy paths.)"""
    marker = os.sep + "evidence_runs"
    idx = path.find(marker)
    if idx != -1:
        return path[: idx + len(marker)]
    return os.path.dirname(os.path.dirname(os.path.dirname(path)))


def freeze_evidence(identity: EvidenceIdentity, evidence_root: str, payload: dict) -> FrozenEvidence:
    """ATOMIC EXCLUSIVE creation via O_CREAT|O_EXCL through a HELD, VALIDATED
    directory fd (owner section 11; IV4 B-01) + freeze-time LOCATION identity
    capture (IV5 F01).

    The parent directory is resolved/validated once and the file is created by
    its validated basename relative to that held fd with O_NOFOLLOW: exactly
    one writer succeeds per EvidenceIdentity; concurrent writers fail; no
    previously frozen bytes are ever replaced, and no mutable re-resolution of
    an independently movable path occurs between validation and creation.

    F01: the validated scenario-directory object identity and the evidence
    root's real path at freeze time are embedded in the frozen document (under
    the content digest) and carried on the returned handle. Subsequent loads
    must address the SAME container object; replacement containers with copied
    bytes are refused by _anchored_load.
    """
    basename = f"{identity.observation_id}.{identity.evidence_type}.json"
    scen_dir, dir_identity = _validated_dir_chain(
        evidence_root, identity.run_id, identity.scenario_id)
    location = EvidenceLocationIdentity(
        root_realpath=os.path.realpath(evidence_root),
        run_id=identity.run_id,
        scenario_id=identity.scenario_id,
        dir_st_dev=dir_identity[0],
        dir_st_ino=dir_identity[1],
    )
    doc = {
        "schema": "CORR5_EVIDENCE_V5",
        "identity": identity.to_json(),
        "location_identity": location.to_json(),
        "payload": payload,
    }
    blob = canonical_json(doc)
    digest = sha256_bytes(blob.encode("utf-8"))
    path = os.path.join(scen_dir, basename)
    try:
        fd = _anchored_open(basename, scen_dir, dir_identity,
                            os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError as exc:
        raise EvidenceImmutableViolation(
            f"frozen evidence identity already exists: {path}; frozen evidence is "
            "immutable (atomic exclusive creation)"
        ) from exc
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(blob.encode("utf-8"))
    except BaseException:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise
    # re-prove the container identity immediately after the write: the
    # location identity we embedded must still describe this directory
    post = _dir_identity(os.lstat(scen_dir))
    if post != dir_identity:
        raise EvidencePathError(
            f"evidence directory {scen_dir!r} changed identity during freeze: the "
            "recorded location identity would be false (refused)"
        )
    rfd = _anchored_open(basename, scen_dir, dir_identity, os.O_RDONLY)
    with os.fdopen(rfd, "rb") as fh:
        if sha256_bytes(fh.read()) != digest:
            raise RuntimeError("evidence hash mismatch immediately after write")
    return FrozenEvidence(identity, path, digest, location)


# ---------------------------------------------------------------------------
# Deep sanitization (owner section 51)
# ---------------------------------------------------------------------------

_SECRET_KEY_RE = re.compile(
    r"(?i)(api[-_]?key|password|passwd|secret|token|authorization|cookie|credential)"
)
_BOT_TOKEN_RE = re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b")
_BEARER_RE = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]+")
_CRED_URL_RE = re.compile(r"\b[a-zA-Z][a-zA-Z0-9+.-]*://[^/\s:@]+:[^/\s@]+@")
_QUERY_SECRET_RE = re.compile(r"(?i)([?&](?:token|key|secret|password|api[-_]?key|access[-_]?token)=)[^&\s]+")
_KV_SECRET_RE = re.compile(r"(?i)\b(api[_-]?key|password|passwd|secret|token|access[-_]?token)\b(\s*[:=]\s*)\S+")
_SB_SECRET_RE = re.compile(r"sb_secret_\S+")
_SK_BARE_RE = re.compile(r"\bsk-[A-Za-z0-9_\-]{8,}")
_BASIC_RE = re.compile(r"(?i)\bauthorization:\s*basic\s+\S+")

_REDACTED = "[REDACTED]"


def sanitize_text(text: str) -> str:
    out = text
    out = _BOT_TOKEN_RE.sub(_REDACTED, out)
    out = _BEARER_RE.sub("Bearer " + _REDACTED, out)
    out = _CRED_URL_RE.sub(lambda m: m.group(0).split("://")[0] + "://" + _REDACTED + "@", out)
    out = _QUERY_SECRET_RE.sub(lambda m: m.group(1) + _REDACTED, out)
    out = _KV_SECRET_RE.sub(lambda m: m.group(1) + m.group(2) + _REDACTED, out)
    out = _SB_SECRET_RE.sub(_REDACTED, out)
    out = _SK_BARE_RE.sub(_REDACTED, out)
    out = _BASIC_RE.sub("Authorization: Basic " + _REDACTED, out)
    return out


def _is_secret_key(key: str) -> bool:
    return bool(_SECRET_KEY_RE.search(str(key)))


def sanitize_key(key: Any) -> Any:
    if isinstance(key, str):
        red = sanitize_text(key)
        return red
    return key


def sanitize_obj(obj: Any, _key: str | None = None) -> Any:
    """Key-aware RECURSIVE sanitization with parent-context propagation.

    A secret-named key redacts its ENTIRE value regardless of carrier type
    (string, number, bool, dict, list, tuple, nested). Mapping keys are
    sanitized too. Secret shapes in text are redacted wherever they appear.
    """
    secret_parent = _key is not None and _is_secret_key(_key)
    if secret_parent:
        return _REDACTED
    if isinstance(obj, str):
        return sanitize_text(obj)
    if isinstance(obj, dict):
        return {
            sanitize_key(k): sanitize_obj(v, _key=str(k))
            for k, v in obj.items()
        }
    if isinstance(obj, (list, tuple)):
        return [sanitize_obj(v, _key=_key) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# ObservedValue / RawCapture / transcript validation
# ---------------------------------------------------------------------------

@dataclass
class ObservedValue:
    value: Any = UNOBSERVED
    provenance: str = ProvenanceKind.UNOBSERVED.value
    evidence_ref: dict | None = None

    def set_observed(self, value: Any, provenance: str, evidence_ref: dict | None = None) -> None:
        if not is_allowed_provenance(provenance):
            raise ProvenanceViolation(
                f"provenance {provenance!r} is not an allowed class "
                f"(forbidden: {sorted(FORBIDDEN_PROVENANCE)})"
            )
        if provenance == ProvenanceKind.UNOBSERVED.value and value is not UNOBSERVED:
            raise ProvenanceViolation("UNOBSERVED provenance cannot carry a value")
        if provenance != ProvenanceKind.UNOBSERVED.value and value is UNOBSERVED:
            raise ProvenanceViolation("observed provenance cannot attach to the UNOBSERVED sentinel")
        self.value = value
        self.provenance = provenance
        self.evidence_ref = evidence_ref

    @property
    def is_unobserved(self) -> bool:
        return self.provenance == ProvenanceKind.UNOBSERVED.value or self.value is UNOBSERVED

    def to_json(self) -> dict:
        return {
            "value": None if self.value is UNOBSERVED else self.value,
            "sentinel": UNOBSERVED if self.value is UNOBSERVED else None,
            "provenance": self.provenance,
            "evidence_ref": self.evidence_ref,
        }


@dataclass
class RawCapture:
    values: dict[str, Any] = field(default_factory=dict)
    transcripts: dict[str, Any] = field(default_factory=dict)
    concurrency: dict[str, Any] = field(default_factory=dict)
    fault: dict[str, Any] = field(default_factory=dict)
    static_inspection: dict[str, Any] | None = None
    auxiliary_diagnostics: dict[str, Any] = field(default_factory=dict)
    sut_path: str | None = None
    sut_symbol: str | None = None
    capture_error: str | None = None
    adapter_protocol_error: str | None = None
    infra_failure: bool = False
    timeout_exceeded: bool = False
    outcome_class: str | None = None


class ObservedFieldError(ValueError):
    pass


def observed_fields_from_capture(capture: RawCapture, provenance_class: str,
                                 identity: "EvidenceIdentity",
                                 field_names: tuple[str, ...] = (
                                     "act", "origin", "state", "link", "output",
                                     "tool_api", "mutations")) -> dict[str, ObservedValue]:
    """B-17 order-of-operations: raw capture value -> recursive sanitizer ->
    SANITIZED value -> ObservedValue -> field digest/ref -> frozen evidence.
    The unsanitized value never becomes the persisted authoritative
    ObservedValue."""
    if capture.adapter_protocol_error:
        raise ObservedFieldError(f"adapter protocol error: {capture.adapter_protocol_error}")
    if not is_allowed_provenance(provenance_class):
        raise ProvenanceViolation(f"registry provenance {provenance_class!r} is not allowed")
    out: dict[str, ObservedValue] = {}
    for name in field_names:
        ov = ObservedValue()
        if capture.capture_error is None and name in capture.values:
            value = capture.values[name]
            if value is not UNOBSERVED:
                sanitized = sanitize_obj(value)
                ov.set_observed(sanitized, provenance_class,
                                field_evidence_ref(identity, name, sanitized))
        out[name] = ov
    return out


def validate_meaningful_transcript(transcripts: Any, actual_output: Any) -> tuple[bool, str]:
    """Semantic-required scenarios need a REAL assistant/system output record
    (owner section 14). An empty dict or a user-only transcript cannot satisfy
    evidence completeness."""
    if not isinstance(transcripts, dict) or not transcripts:
        return False, "transcript missing or empty"
    assistant_entries = []
    for key, entry in transcripts.items():
        if isinstance(entry, dict):
            role = str(entry.get("role", entry.get("speaker", ""))).lower()
            content = entry.get("content", entry.get("text"))
            if role in ("assistant", "system", "bot") and isinstance(content, str) and content.strip():
                assistant_entries.append((key, content))
        elif isinstance(entry, str) and entry.strip():
            # keyed text artifacts (e.g. turn_response) count as assistant
            # output only when they match the observed output
            assistant_entries.append((key, entry))
    if not assistant_entries:
        return False, "no assistant/system output record in transcript"
    if actual_output is UNOBSERVED or (isinstance(actual_output, str) and not actual_output.strip()):
        return False, "actual output empty: transcript cannot correspond to an observation"
    out_text = actual_output if isinstance(actual_output, str) else json.dumps(actual_output, ensure_ascii=False)
    if not any(content.strip() == out_text.strip() for _, content in assistant_entries):
        # transcript must correspond to the actual observation
        return False, "transcript does not contain the observed assistant output"
    return True, "meaningful assistant transcript present"


@dataclass
class Observation:
    scenario_id: str
    failure_class: str
    track: str
    execution_level: str
    seam_class: str
    run_id: str
    observation_id: str
    attempt: int

    input_identity: dict[str, Any] = field(default_factory=dict)
    preconditions: dict[str, Any] = field(default_factory=dict)
    expected_invariant_refs: dict[str, Any] = field(default_factory=dict)

    actual_output: ObservedValue = field(default_factory=ObservedValue)
    actual_state_transition: ObservedValue = field(default_factory=ObservedValue)
    actual_tool_api_evidence: ObservedValue = field(default_factory=ObservedValue)

    deterministic_oracles: list[dict[str, Any]] = field(default_factory=list)
    semantic_evaluation: dict[str, Any] = field(default_factory=dict)

    primary_verdict: str = "NOT_EXECUTED"
    verdict_reason: str = "Observation not yet adjudicated."
    stability_label: str = "NONE"
    scenario_aggregate_verdict: str | None = None

    timestamp: str = ""
    reproduction_trace: list[str] = field(default_factory=list)

    raw_evidence_path: str | None = None
    raw_evidence_sha256: str | None = None
