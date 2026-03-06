# AgentLog

Auto-log Claude Code prompts to Obsidian Daily Notes.

AgentLog is a local-first Claude Code prompt logger for Obsidian. It captures every prompt you type in Claude Code and appends it to today's Daily Note, grouped by project and session.

Use it as a lightweight developer journal, worklog capture layer, or the first building block for richer Daily Notes automation.

```bash
# Requires Bun (https://bun.sh) installed and available on your PATH
npm install -g @albireo3754/agentlog
agentlog init ~/Obsidian
```

Install it once, start using Claude Code, and your Daily Note fills itself.

## What It Does

```
Claude Code prompt → UserPromptSubmit hook → Daily Note append
```

## Why AgentLog

- Local-first prompt logging with no external service required
- Obsidian Daily Notes integration that works with your existing vault
- Project and session grouping so prompts stay readable later
- Zero copy-paste overhead during normal Claude Code use

**Before:** You finish a 3-hour Claude Code session. Your Daily Note is empty.

**After:**

```markdown
## AgentLog
> 🕐 11:21 — js/agentlog › initialize git and open it in VS Code

#### 10:53 · js/agentlog
<!-- cwd=/Users/you/work/js/agentlog -->
- - - - [[ses_a1b2c3d4]]
- 10:53 start building agentlog
- 11:07 open the spec document
- - - - [[ses_e5f6a7b8]]
- 11:21 initialize git and open it in VS Code
```

| Element | Role |
|---------|------|
| `> 🕐 HH:MM — project › prompt` | Latest entry (always updated) |
| `#### HH:MM · project` | Project subsection (grouped by cwd) |
| `<!-- cwd=... -->` | Section matching key (hidden in Obsidian Reading view) |
| `- - - - [[ses_...]]` | Session boundary (Obsidian wiki-link) |
| `- HH:MM prompt` | Individual log entry |

No manual logging. No copy-paste. No AI summarization overhead.

## Install

```bash
# With Bun
bun add -g @albireo3754/agentlog

# With npm
npm install -g @albireo3754/agentlog

# Then configure your vault
agentlog init ~/path/to/vault
```

AgentLog registers the Claude Code hook as `agentlog hook`, so the `agentlog` binary must remain available on your `PATH` after setup.

### Requirements

- [Claude Code](https://claude.ai/code) (hook integration)
- [Obsidian](https://obsidian.md) (Daily Note target)
- [Bun](https://bun.sh) (>=1.0.0) or [Node.js](https://nodejs.org) >=20

## Usage

### Setup

```bash
# Point to your Obsidian vault
agentlog init ~/Obsidian

# Or use any folder (no Obsidian required)
agentlog init --plain ~/notes
```

This does two things:
1. Creates `~/.agentlog/config.json` with your vault path
2. Registers a hook in `~/.claude/settings.json`

Run `agentlog init` without arguments to auto-detect installed vaults.

### That's It

Use Claude Code normally. Every prompt you type gets logged to your Daily Note.

### How It Works

1. You type a prompt in Claude Code
2. Claude Code fires the `UserPromptSubmit` hook
3. AgentLog reads the prompt from stdin and sanitizes it
4. Finds your Daily Note via `obsidian daily:path` (Obsidian CLI 1.12+). If that fails, it falls back to `{vault}/Daily/YYYY-MM-DD-<Korean weekday>.md`
5. Finds or creates a `## AgentLog` section
6. Finds or creates a `#### project` subsection matching the current working directory
7. Inserts a session divider `[[ses_...]]` if the session changed, then appends the entry
8. Updates the `> 🕐` latest-entry line at the top of the section

Total overhead: < 50ms per prompt. Fire-and-forget, never blocks Claude Code.

## Daily Note Format

### Obsidian Mode (default)

AgentLog resolves the Daily Note path via `obsidian daily:path` when the Obsidian CLI is available (1.12+). If the CLI is unavailable or Obsidian is not running, it falls back to `{vault}/Daily/YYYY-MM-DD-<Korean weekday>.md` such as `2026-03-01-일.md`.

Each working directory gets its own `#### project` subsection. Session changes insert a `[[ses_...]]` wiki-link divider. The `> 🕐` blockquote at the top always shows the latest entry across all projects.

```markdown
## AgentLog
> 🕐 14:30 — kotlin/message-gate › adjust the API response

#### 10:53 · js/agentlog
<!-- cwd=/Users/you/work/js/agentlog -->
- - - - [[ses_a1b2c3d4]]
- 10:53 start building agentlog
- 11:07 open the spec document

#### 14:00 · kotlin/message-gate
<!-- cwd=/Users/you/work/kotlin/message-gate -->
- - - - [[ses_e5f6a7b8]]
- 14:00 adjust the API response
- 14:30 run tests
```

### Plain Mode

With `--plain`, entries go to `{folder}/YYYY-MM-DD.md`:

```markdown
# 2026-03-02
- 10:53 start building agentlog
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `agentlog init [vault] [--plain]` | Configure the vault path and register the Claude Code hook. Auto-detect vaults when the path is omitted |
| `agentlog detect` | List detected Obsidian vaults and CLI status |
| `agentlog doctor` | Run health checks for the binary, vault, hook, and Obsidian CLI |
| `agentlog open` | Open today's Daily Note in Obsidian (requires CLI 1.12+) |
| `agentlog uninstall [-y]` | Remove the hook and delete `~/.agentlog/`. Use `-y` to skip confirmation |
| `agentlog hook` | Invoked automatically by Claude Code (not for direct use) |

## Configuration

`~/.agentlog/config.json`:

| Field | Default | Description |
|-------|---------|-------------|
| `vault` | (required) | Path to the Obsidian vault or plain output folder |
| `plain` | `false` | Plain mode that writes simple markdown files without Obsidian integration |

Environment variables:

| Variable | Description |
|----------|-------------|
| `AGENTLOG_CONFIG_DIR` | Override the config directory (default: `~/.agentlog`) |
| `OBSIDIAN_BIN` | Override the Obsidian CLI binary path |

## Uninstall

```bash
agentlog uninstall
```

This removes the hook from `~/.claude/settings.json` and deletes `~/.agentlog/`.

## Development

```bash
bun install
bun test              # run the test suite
bun run typecheck     # run tsc --noEmit
bun run build         # compile to dist/ (optional)
```

The `bin` entry points directly to `src/cli.ts`, so you do not need a build during development. Bun runs TypeScript natively.

```bash
# Link as a global command
bun link

# Edit source and run immediately
agentlog doctor

# Watch mode
bun run dev:watch
```

## Roadmap

- **Phase 2:** Obsidian plugin with timeline visualization UI
- **Phase 3:** Git log integration (commits → Daily Note)
- **Future:** `agentlog run` command for session replay from JSONL captures

## License

MIT
