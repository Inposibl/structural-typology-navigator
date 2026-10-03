# Snapshot rule `academy-telegram-byte-state-snapshot-1`

Replay command, from the Navigator repository root:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 \
  benchmarks/academy-telegram-live-regression-1000-1/execution_infrastructure/snapshot_rule.py \
  <absolute-root>
```

The command prints the final SHA256. The implementation is `snapshot_rule.py` in this directory. An independent verifier replays that script. This specification names the same rule the script executes.

## Hash domain

Covered file bytes and symlink target strings. The absolute root path is not an input. mtime is not an input.

## Included paths

Every regular file under the root, and every symlink under the root, except the excluded paths below. Directory entries are not hashed. An empty directory does not change the hash.

## Excluded paths

`.git/objects/**` is excluded. Exclusion is by relative POSIX path: the path is exactly `.git/objects` or starts with `.git/objects/`.

No other path is excluded. `.git/HEAD`, `.git/index`, and `.git/refs/**` are covered file bytes when they are regular files. Their mtimes are not hashed.

`.git/objects` mtime is not a byte-state identity signal. An mtime-only change under `.git/objects` does not change the final SHA256 when object content, HEAD, refs, index, and every other covered byte are unchanged.

## Symlinks

`os.walk` does not follow links. A symlink is recorded with `type = symlink`, `followed = false`, and `symlink_target` equal to `os.readlink` of that path. The target string is not resolved. The target's bytes are not read through the link.

If the target is also a covered path reached by its own relative path, those bytes are hashed once at that path.

## Sanctioned provisioning symlink

When the relative path is `tests/_testbase` and the stored target is `../.git/_testbase`, the entry sets `sanctioned_provisioning_symlink = true` and the document repeats it under `sanctioned_symlink_disclosures`.

That link is sanctioned provisioning metadata. It is not part of the 152-file hash-bound Chatbot authority object. It is not unexplained manifest drift. The rule does not delete it and does not follow it.

## Path normalization and ordering

Relative path, POSIX separators, Unicode NFC, no leading `./`. Entries are sorted by that path, ascending.

## Metadata

Included: `path`, `type`, `size`, `sha256`, `symlink_target`, `sanctioned_provisioning_symlink`, `followed`, plus the document-level rule fields and the disclosure list.

Excluded: `mtime`, `atime`, `ctime`, `uid`, `gid`, `mode`, `inode`.

File `sha256` is SHA256 of the raw file bytes. File `size` is the byte length. Symlink `sha256` and `size` are null.

## Serialization

Canonical JSON, UTF-8. Object keys are sorted. Separators are comma and colon with no extra whitespace. `ensure_ascii` is false. The digest input is that JSON encoding of the document with the `final_sha256` field removed.

## Final SHA256

`final_sha256` is the hex SHA256 of the UTF-8 canonical JSON described above. The returned document includes that field. Replaying the script on the same covered bytes yields the same hex digest.
