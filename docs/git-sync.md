# Git sync event logging

Enable on **every desktop/device that writes or merges the vault**, after updating AgentLog:

```sh
agentlog git-sync install
```

The existing Daily Note remains the human-readable log. New entries are independent
Markdown blocks containing time, project, cwd, source, session link, and prompt.
An event has a unique capture ID and content checksum. Two identical prompts in
the same minute are two records; a synced copy of an existing ID is one record.
No pinned latest line or shared project/session section is rewritten in this mode.
Existing historical text is kept as ordinary Markdown; it is not silently migrated.

## Preservation and merge contract

1. Before a note write, capture one private, fsynced event file under
   `~/.agentlog/journal/<vault hash>/<note hash>/`. Publish each JSON record by rename.
2. Serialize local projection into a note, then append missing complete event
   blocks with one append operation. Git operation markers do not stop capture or
   append. Repeating projection is idempotent by event ID.
3. Git's `agentlog` merge driver extracts validated event blocks from base, ours,
   and theirs, unions IDs, and sorts deterministically. Other Markdown is merged
   with normal `git merge-file --diff3`. Thus concurrent generated records merge
   cleanly while genuine handwritten conflicts stay unresolved.
4. Edited/corrupt blocks, incompatible formats, or conflicting payloads for an ID
   produce an explicit conflict containing the original versions. The driver
   never reports those as a clean union.
5. The installed `post-merge` hook replays local events missing after a Git merge
   or fast-forward. Each new capture also replays the target note's journal.

A Git checkout or another editor can replace an append concurrently; the local
journal preserves that event for replay. This is not a transaction with Git or
Obsidian. The journal is local recovery storage, not a second synced vault.
Neither journal deletion nor loss of the device is recoverable before a record
has reached the note and Git. Keep normal backups.

## Installation details

The installer adds `*.md merge=agentlog` to the vault's `.gitattributes` and
configures the driver in local Git config using the installed runtime path.
The driver uses ordinary text merging for files without event blocks. Existing
attribute rules are retained after AgentLog's default, so specific custom merge
rules still win. Verify the attribute for your actual Daily path with:

```sh
git check-attr merge -- Daily/2026-10-07-수.md
```

The `.gitattributes` file should be committed with the vault. Git does **not**
sync local driver configuration or hooks: repeat installation on every device.
Git clients must execute Git CLI custom merge drivers; web merges and mobile
clients that do not run them are not supported for automatic event merging.
Without the driver, Git may report an ordinary conflict; the source commits and
local journal remain available. Do not use a blanket `merge=union` on the note.

An existing non-AgentLog `post-merge` hook is left intact and installation reports
an error before mutations. Use `agentlog git-sync install --no-replay-hook` to keep
that hook and run replay in your sync workflow. Reinstall after moving the package
or runtime, because driver configuration contains an absolute executable path.

## Recovery and removal

```sh
agentlog git-sync replay
agentlog git-sync uninstall
```

Replay only touches existing note paths. A deleted or moved/archived day is not
recreated; `missing` reports journal targets requiring explicit handling. Journal
records are retained after successful replay, removal of Git integration, and
AgentLog integration uninstall. Deleting an immutable block from a note does not
delete its journal event; replay/merge restores it. To permanently redact an event,
handle its note, local journals on all devices, and Git history explicitly.

If note creation fails (for example, Obsidian CLI is disabled), the event has
already been captured when a target path was resolvable. Create the intended note,
then replay. On an invalid/edited block, repair the explicit conflict first and
replay; new captures remain in the journal. `backfill` remains available for older
Claude/Codex transcripts; Hermes captures now have the same local journal support.

Uninstall removes only AgentLog's attribute entry, driver config, and owned
post-merge hook. Existing records and handwritten text are unchanged. Normal
legacy logging remains the default until `git-sync install` enables this mode.

## Validation

Tests use real bare remotes and two clones to exercise independent creation,
divergent append, repeated bidirectional push/pull, identical prompts, human
conflicts, missing drivers, and recovery after a checkout followed by fast-forward.
Concurrent child processes exercise capture and projection. Unit tests cover
record validation, deterministic union, replay idempotence, backfill multiplicity,
and EnglishAsk context across independent blocks.

Git driver protocol: https://git-scm.com/docs/gitattributes#_defining_a_custom_merge_driver
