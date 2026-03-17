# AgentLog Daily Bootstrap Design

**Date:** 2026-03-18
**Status:** Proposed
**Related:** #26

## Goal

Make AgentLog safe when today's Daily Note does not exist yet by letting Obsidian create the note first, while preserving the existing AgentLog section-merge behavior after the note exists.

## Problem Statement

Today, AgentLog resolves the target file path with `obsidian daily:path`, then writes the markdown file directly.

That is good enough when today's note already exists and the CLI path is stable. It is not good enough when today's note is missing:

- `daily:path` returns the expected path, not a guarantee that the file already exists.
- `obsidian daily` creates the note and applies the user's Daily Notes template.
- direct file creation by AgentLog can bypass Obsidian's bootstrap path and produce a raw markdown file before the template is applied.
- if CLI lookup fails, the current `{vault}/Daily/YYYY-MM-DD-<weekday>.md` fallback can drift from the user's configured Daily Notes folder or naming format.

The result is a correctness problem, not just a path-resolution problem.

## Evidence

Observed in the reporter's environment:

- `obsidian daily:path` returned `Daily/2026-03-18-수.md` even when the file was absent.
- deleting today's Daily Note and then running `obsidian daily` recreated the file and populated the Daily template.
- `obsidian daily:read` read the recreated note normally after bootstrap.

Observed in the current code:

- [`src/note-writer.ts`](../../src/note-writer.ts) uses `cliDailyPath()` and then writes the resolved file directly.
- [`src/obsidian-cli.ts`](../../src/obsidian-cli.ts) exposes `cliDailyPath()`, but no "ensure note exists" primitive.
- hook entrypoints in [`src/hook.ts`](../../src/hook.ts) and [`src/codex-notify.ts`](../../src/codex-notify.ts) assume `appendEntry()` can safely create the file itself.

## Approaches Considered

### Approach A — CLI bootstrap + direct merge write **(chosen)**

Keep the existing markdown merge logic, but make Obsidian responsible for bootstrap.

Flow:

1. resolve the relative path with `obsidian daily:path`
2. if the file is missing, call `obsidian daily`
3. verify the file now exists
4. run existing AgentLog section insertion against the resulting file

If the CLI is unavailable or bootstrap fails, skip the write instead of silently creating a guessed file path.

**Pros**

- preserves the existing AgentLog section/grouping logic
- preserves the user's Daily template on first creation
- keeps the change small and reviewable
- removes the most dangerous fallback behavior

**Cons**

- non-plain mode becomes more dependent on a working Obsidian CLI
- no automatic write in CLI-unavailable cases

### Approach B — Cache the last known authoritative Daily path

Store a previously resolved relative Daily path in config and reuse it when CLI lookup fails.

**Pros**

- can preserve some offline resilience

**Cons**

- adds state and cache invalidation problems
- still fails when the user changes Daily settings
- still cannot guarantee template/bootstrap correctness

### Approach C — Use `obsidian daily:append` for all writes

Let Obsidian append content instead of AgentLog editing the file.

**Pros**

- Obsidian remains the only writer during bootstrap and append

**Cons**

- `daily:append` is not expressive enough for AgentLog's structured merge behavior
- hard to keep `## AgentLog`, latest line, project subsections, and session dividers consistent
- would force a much larger redesign

## Chosen Direction

Adopt Approach A.

The key design rule is:

> In non-plain mode, AgentLog should not create today's Daily Note by guessing a filesystem path. It should first ask Obsidian to create the note, then perform the structured AgentLog write.

## Architecture Changes

### 1. `src/obsidian-cli.ts`

Add an explicit bootstrap helper around the official CLI:

- `cliDailyPath()` remains the authoritative relative-path resolver.
- add `cliEnsureDailyNoteExists()`:
  - call `obsidian daily`
  - return success/failure
  - keep stdout parsing minimal
- optionally add a small internal helper to run Obsidian CLI subcommands consistently.

Responsibilities:

- path lookup
- note bootstrap
- clear success/failure boundary for callers

### 2. `src/note-writer.ts`

Replace the current fallback-first behavior with an authoritative bootstrap flow in non-plain mode.

New non-plain flow:

1. call `cliDailyPath()`
2. if no relative path is returned, abort non-plain write
3. compute absolute path from `config.vault + relativePath`
4. if file does not exist:
   - call `cliEnsureDailyNoteExists()`
   - re-check the same absolute path
   - if still missing, abort write
5. once the file exists, run the current AgentLog section insertion logic

Plain mode remains unchanged.

### 3. Entry points: `src/hook.ts` and `src/codex-notify.ts`

Keep the current fail-soft behavior:

- hooks must still never interrupt Claude/Codex
- bootstrap failure should surface as a non-fatal stderr message
- no raw fallback file should be created when non-plain bootstrap is impossible

That keeps runtime safety while improving correctness.

## Failure Handling

### Case 1: CLI unavailable

Current behavior:

- path fallback guesses `{vault}/Daily/YYYY-MM-DD-<weekday>.md`
- AgentLog may create the wrong file

New behavior:

- skip the write
- emit a compact non-fatal diagnostic

Example:

```text
[agentlog] write skipped: could not resolve today's Daily Note through Obsidian CLI
```

### Case 2: `daily:path` succeeds, but file is missing

New behavior:

- call `obsidian daily`
- if the file appears, proceed
- if not, skip the write and log a diagnostic

### Case 3: CLI bootstrap succeeds, but markdown merge fails

Behavior remains the same:

- catch and report a non-fatal write error
- never break the caller flow

## Testing Strategy

### Unit tests

Add/adjust tests in:

- [`src/__tests__/obsidian-cli.test.ts`](../../src/__tests__/obsidian-cli.test.ts)
- [`src/__tests__/note-writer.test.ts`](../../src/__tests__/note-writer.test.ts)

New cases:

1. `cliEnsureDailyNoteExists()` succeeds when `obsidian daily` exits 0
2. `cliEnsureDailyNoteExists()` returns failure on non-zero exit
3. `appendEntry()` bootstraps the Daily Note when `daily:path` resolves a missing file
4. `appendEntry()` does not create a guessed fallback file when `daily:path` is unavailable
5. existing section-merge behavior still passes for already-existing notes

### Smoke verification

Project verification after the change should still include:

- `bun test`
- `bun run typecheck`
- `bun run build`

## Documentation Changes

Update:

- [`README.md`](../../README.md)

Required wording changes:

- stop claiming that `daily:path` is enough for safe Daily creation
- explain that non-plain mode depends on Obsidian CLI for authoritative Daily bootstrap
- clarify that plain mode remains direct-file mode

## Acceptance Criteria

1. When today's Daily Note is missing, AgentLog first triggers Obsidian's Daily bootstrap path before appending AgentLog content.
2. A freshly created Daily Note preserves the user's Daily template structure.
3. Non-plain mode no longer silently creates a guessed fallback file when the authoritative CLI path cannot be resolved.
4. Existing AgentLog grouping behavior remains unchanged once the file exists.
5. Tests cover both missing-note bootstrap and CLI-unavailable behavior.

## Out of Scope

- changing plain mode behavior
- redesigning AgentLog section structure
- solving Codex notify registration issues
- introducing persistent path caches or new config schema in this first pass
