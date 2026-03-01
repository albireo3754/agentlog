# Architecture

## Overview

AgentLog MVP follows a direct-write architecture:

```
Claude Code prompt
  ↓ UserPromptSubmit hook
hook.ts (parseHookInput → LogEntry)
  ↓
note-writer.ts (appendEntry)
  ↓
Obsidian Daily Note
```

No intermediate storage. No background processes. No LLM calls.

## Module Responsibilities

### `src/hook.ts` — Hook Entry Point

- Reads stdin JSON from Claude Code
- Delegates parsing to `parseHookInput()` from schema
- Creates a `LogEntry` with timestamp and truncated content
- Calls `appendEntry()` to write to Daily Note
- Fails silently on all errors (stderr only)

### `src/note-writer.ts` — Daily Note Writer

- `dailyNotePath(config, date)` — resolves file path using date + Korean day name
- `appendEntry(config, entry, date)` — main write function:
  1. Reads existing note content (or creates new file)
  2. Finds matching timeblock line via regex
  3. Inserts `[agentlog]`-tagged line after existing entries
  4. Updates checkbox `[ ]` → `[x]`
  5. Falls back to `## AgentLog` section if no timeblock found

### `src/config.ts` — Configuration

- `loadConfig()` — reads `~/.agentlog/config.json`
- `saveConfig(config)` — writes config with directory creation
- `expandHome(path)` — resolves `~/` to absolute path

### `src/schema/hook-input.ts` — Hook Input Schema (SOT)

Source of truth for Claude Code hook input format:
- `HookInput` interface with all known fields
- `parseHookInput(raw)` — validates and extracts prompt via 3-level fallback:
  1. `input.prompt`
  2. `input.message.content`
  3. `input.parts[0].text`

### `src/schema/daily-note.ts` — Daily Note Schema (SOT)

Source of truth for timeblock structure:
- `TIME_BLOCKS` — hour ranges for all periods
- `KO_DAYS` — Korean day names (일, 월, 화, ...)
- `TIMEBLOCK_PERIODS` — period labels with block arrays
- `findTimeBlock(hour)` — maps hour to block label
- `buildLogLine(time, content)` — formats entry line
- `dailyNoteFileName(date)` — generates filename

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Direct-write (no JSONL) | MVP simplicity — fewer moving parts |
| Bun runtime | Fast startup (< 50ms), TypeScript native |
| Silent failures | Hook must never block Claude Code |
| Schema as SOT | Single source for hook format and timeblocks |
| Korean timeblocks | Primary user's Daily Note format |
| `--plain` fallback | Support non-Obsidian users |

## Future Architecture (Post-MVP)

```
hook.ts → ~/.agentlog/sessions/{date}.jsonl  (capture)
                    ↓
agentlog run    (parse + summarize)
                    ↓
note-writer.ts → Daily Note              (write)
```

Adding JSONL capture enables:
- Session replay (`agentlog run`)
- LLM summarization (optional `--summarize` flag)
- Multi-session grouping by sessionId
- Historical analysis
