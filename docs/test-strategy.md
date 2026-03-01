# AgentLog Test Strategy

> status: draft
> created: 2026-03-01

## Overview

AgentLog MVP has four modules: `config`, `hook`, `note-writer`, `cli`.
Tests are written with the **Bun built-in test runner** (`bun test`) — no external test frameworks or mocking libraries.

---

## Test Approach

### Runner

```bash
bun test                        # run all tests
bun test src/__tests__/hook.test.ts   # single file
bun test --watch                # watch mode
```

### Guiding principles

1. **No external deps** — use only Node/Bun built-ins (`fs`, `os`, `path`, `crypto`).
2. **Temp dirs for FS tests** — every test that touches the filesystem creates an isolated temp directory and cleans it up in `afterEach`.
3. **Pure-function tests first** — functions like `expandHome`, time/date helpers, and note-insertion logic are pure and should be tested without I/O.
4. **Integration tests are lightweight** — no subprocess spawning; import the module directly and point it at a temp dir.
5. **No network** — no mocks for external calls; MVP has none.

### Directory layout

```
src/__tests__/
├── fixtures/
│   ├── daily-note-with-timeblocks.md   # sample with 08-10/10-12/12-13 blocks
│   ├── daily-note-no-timeblocks.md     # sample without any timeblock headers
│   ├── daily-note-empty.md             # empty file (0 bytes)
│   ├── hook-input.json                 # valid UserPromptSubmit stdin payload
│   └── config.json                     # valid ~/.agentlog/config.json sample
├── config.test.ts
├── hook.test.ts
├── note-writer.test.ts
└── cli.test.ts
```

---

## Module Test Scenarios

### 1. `config.ts`

**Functions:** `loadConfig`, `saveConfig`, `expandHome`, `configPath`

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| C1 | Load config when file exists | valid JSON at CONFIG_PATH | returns `AgentLogConfig` |
| C2 | Load config when file missing | no file | returns `null` |
| C3 | Load config when file is malformed JSON | `{broken` | returns `null` |
| C4 | Save config creates dir if missing | fresh temp dir | dir + file created |
| C5 | Save config expands `~` in vault path | `vault: "~/Obsidian"` | stored as absolute path |
| C6 | Save then load round-trip | any valid config | loaded equals saved |
| C7 | `expandHome` with `~/` prefix | `"~/foo/bar"` | `"{homedir}/foo/bar"` |
| C8 | `expandHome` with absolute path | `"/abs/path"` | unchanged |
| C9 | `expandHome` with no prefix | `"relative/path"` | unchanged |
| C10 | `configPath` returns expected location | — | `"{homedir}/.agentlog/config.json"` |

---

### 2. `hook.ts`

**Entry point:** reads from stdin, writes to Daily Note via `note-writer`.

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| H1 | Valid hook input — timeblock note | `{ session_id, prompt }` + note with timeblocks | entry appended under correct block |
| H2 | Valid hook input — no timeblocks | `{ session_id, prompt }` + note without timeblocks | appended under `## AgentLog` section |
| H3 | Valid hook input — file missing | `{ session_id, prompt }` + nonexistent note | file created with entry |
| H4 | Prompt truncated at 100 chars | prompt of 150 chars | stored as first 100 chars |
| H5 | Prompt exactly 100 chars | prompt of exactly 100 chars | stored as-is (no truncation marker) |
| H6 | Empty prompt | `prompt: ""` | entry written with empty text (no crash) |
| H7 | Config missing (not initialized) | no `~/.agentlog/config.json` | exits silently (no crash, no write) |
| H8 | Invalid JSON on stdin | `not-json` | exits silently (no crash) |
| H9 | Plain mode | config `plain: true` | writes to `{vault}/{YYYY-MM-DD}.md` |
| H10 | session_id field present in input | any valid input | session_id not written to note |

---

### 3. `note-writer.ts`

**Core logic:** given a `LogEntry` and file path, correctly inserts into Daily Note.

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| N1 | Append to existing timeblock — exact block match | time `10:53`, block `10 - 12` exists | inserted under that block |
| N2 | Append to existing timeblock — first block | time `08:05`, block `08 - 10` exists | inserted under `08 - 10` |
| N3 | Append to existing timeblock — last block | time `12:30`, block `12 - 13` exists | inserted under `12 - 13` |
| N4 | Time falls between blocks | time `13:45`, blocks `08-13` only | appended to closest or `## AgentLog` |
| N5 | No timeblock headers present | any time, plain note | appended to `## AgentLog` section |
| N6 | `## AgentLog` section already exists | note with existing `## AgentLog` | appended under existing section |
| N7 | File does not exist | nonexistent path | file created, `WriteResult.created = true` |
| N8 | File is empty | 0-byte file | entry written, no crash |
| N9 | Existing content preserved | note with other content | other content unchanged |
| N10 | Multiple writes are idempotent structure-wise | two writes same time | two separate lines appended (no dedup) |
| N11 | Plain mode file path | `plain: true`, date `2026-03-01` | path is `{vault}/2026-03-01.md` |
| N12 | Obsidian mode file path | `plain: false`, date `2026-03-01` (토) | path is `{vault}/Daily/2026-03-01-토.md` |
| N13 | `WriteResult.section` reflects actual section used | timeblock hit | `section === "timeblock"` |
| N14 | `WriteResult.section` for AgentLog fallback | no timeblocks | `section === "agentlog"` |
| N15 | `WriteResult.section` for plain mode | `plain: true` | `section === "plain"` |

---

### 4. `cli.ts`

**Commands:** `init` (vault validation, config write, hook registration)

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| CL1 | `init` with valid Obsidian vault | path containing `.obsidian/` | config saved, hook registered, success message |
| CL2 | `init` with non-Obsidian directory | path without `.obsidian/` | error message + install guide printed |
| CL3 | `init` with `--plain` flag | any writable dir | config saved with `plain: true` |
| CL4 | `init` with nonexistent path | `/nonexistent/path` | error message (dir not found) |
| CL5 | `init` overwrites existing config | config already exists | config replaced with new vault |
| CL6 | Hook registration writes correct JSON | fresh `.claude/settings.json` | hook entry present in settings |
| CL7 | Hook registration merges with existing settings | existing settings.json | existing keys preserved |
| CL8 | `init` expands `~/` in vault path | `~/Obsidian` | stored as absolute path in config |

---

## Fixtures Design

### `fixtures/daily-note-with-timeblocks.md`

Represents a typical Daily Note produced by the Obsidian Daily Note Template:

```markdown
# 2026-03-01

## 오전 (08-13)
- [ ] 08 - 10
- [ ] 10 - 12
- [ ] 12 - 13

## 오후 (13-18)
- [ ] 13 - 15
- [ ] 15 - 18

## 저녁 (18-22)
- [ ] 18 - 20
- [ ] 20 - 22
```

### `fixtures/daily-note-no-timeblocks.md`

A minimal note with no time structure:

```markdown
# 2026-03-01

오늘 할 일 메모.
```

### `fixtures/daily-note-empty.md`

Zero-byte file (represents a newly created but empty note).

### `fixtures/hook-input.json`

Valid `UserPromptSubmit` stdin payload:

```json
{
  "session_id": "abc123",
  "prompt": "agentlog 개발을 위해서 작업 진행"
}
```

### `fixtures/config.json`

```json
{
  "vault": "/Users/testuser/Obsidian"
}
```

---

## Edge Cases Summary

| Category | Edge Case | Handling |
|----------|-----------|----------|
| Truncation | prompt > 100 chars | slice to 100, no ellipsis |
| Missing config | `~/.agentlog/config.json` absent | hook exits silently |
| Missing file | Daily Note doesn't exist | create file |
| Malformed JSON | stdin or config not valid JSON | catch + exit silently |
| Empty prompt | `prompt: ""` | write `- HH:MM ` line (valid) |
| Idempotency | Two identical hook calls | two separate lines (append-only, no dedup) |
| Home expansion | `~/` prefix in vault | expanded to absolute path at save time |
| Plain mode | `plain: true` in config | flat `YYYY-MM-DD.md` in vault root |
| No timeblocks | No `HH - HH` pattern in note | fallback to `## AgentLog` section |
| Concurrent writes | Multiple rapid prompts | last-write-wins on append (acceptable for MVP) |
