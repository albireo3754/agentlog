# Daily Bootstrap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure AgentLog lets Obsidian create a missing Daily Note before AgentLog writes into it, and remove the unsafe guessed-path fallback in non-plain mode.

**Architecture:** Keep the current AgentLog markdown merge algorithm, but move Daily Note bootstrap responsibility into `src/obsidian-cli.ts`. In non-plain mode, `src/note-writer.ts` should resolve the authoritative Daily path, ensure the file exists through Obsidian CLI when missing, and only then run the existing section insertion logic.

**Tech Stack:** Bun, TypeScript, Node 20, Obsidian CLI 1.12+, existing AgentLog hook and notify entrypoints.

---

## Scope

포함:

- `obsidian daily` 기반 bootstrap helper 추가
- non-plain mode missing-note 처리 수정
- unsafe fallback 제거 또는 skip 처리
- unit tests 보강
- README 문구 수정

제외:

- plain mode 변경
- Codex notify registration 수정
- 대규모 note merge 구조 변경

## Task Breakdown

### Task 1: Add Obsidian CLI bootstrap helper

**Files:**
- Modify: `src/obsidian-cli.ts`
- Test: `src/__tests__/obsidian-cli.test.ts`

**Step 1: Write the failing test**

Add tests for:

- `obsidian daily` exit 0 -> helper returns success
- `obsidian daily` non-zero -> helper returns failure

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/obsidian-cli.test.ts`
Expected: FAIL because bootstrap helper does not exist yet

**Step 3: Write minimal implementation**

Add:

- a shared CLI runner if it keeps the file simpler
- `cliEnsureDailyNoteExists(): boolean`

Rules:

- use the resolved Obsidian binary
- keep output parsing minimal
- return `false` on missing CLI or non-zero exit

**Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/obsidian-cli.test.ts`
Expected: PASS

### Task 2: Change non-plain write flow to bootstrap before merge

**Files:**
- Modify: `src/note-writer.ts`
- Test: `src/__tests__/note-writer.test.ts`

**Step 1: Write the failing test**

Add tests for:

- missing Daily file + successful bootstrap -> note is created, then AgentLog content is merged
- `daily:path` unavailable -> non-plain write does not create guessed fallback file
- bootstrap failure -> write aborts instead of creating a raw file

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/note-writer.test.ts`
Expected: FAIL because current code still creates files directly

**Step 3: Write minimal implementation**

In `appendEntry()` / path resolution:

- keep plain mode unchanged
- require `cliDailyPath()` in non-plain mode
- if the resolved target file is missing, call `cliEnsureDailyNoteExists()`
- re-check file existence before reading/writing
- throw or return a controlled failure when bootstrap cannot be confirmed

**Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/note-writer.test.ts`
Expected: PASS

### Task 3: Keep hook/notify fail-soft behavior explicit

**Files:**
- Modify: `src/hook.ts`
- Modify: `src/codex-notify.ts`

**Step 1: Review existing failure path**

Confirm callers already catch `appendEntry()` errors and write non-fatal stderr messages.

**Step 2: Make minimal adjustments if needed**

Only change caller messaging if bootstrap failures need clearer diagnostics. Do not add new control flow unless tests show ambiguity.

**Step 3: Run targeted tests**

Run: `bun test src/__tests__/cli-codex.test.ts src/__tests__/cli.test.ts`
Expected: PASS

### Task 4: Update README wording

**Files:**
- Modify: `README.md`

**Step 1: Update behavior description**

Change docs so they no longer imply:

- `daily:path` alone safely creates the note
- a guessed `{vault}/Daily/...` path is the reliable fallback for all users

Document:

- non-plain mode uses Obsidian CLI as the authoritative bootstrap path
- plain mode is still direct-file append

**Step 2: Review the diff for consistency**

Check the README sections:

- Setup / How It Works
- Daily Note Format
- Requirements

### Task 5: Full verification

**Files:**
- Verify only

**Step 1: Run unit tests**

Run: `bun test`
Expected: PASS

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Run build**

Run: `bun run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/obsidian-cli.ts src/note-writer.ts src/hook.ts src/codex-notify.ts src/__tests__/obsidian-cli.test.ts src/__tests__/note-writer.test.ts README.md
git commit -m "fix: bootstrap missing daily notes via obsidian cli"
```
