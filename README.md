# AgentLog

Auto-log Claude Code prompts and Codex turns to Obsidian Daily Notes.

AgentLog is a local-first prompt logger for Obsidian. It captures Claude Code prompts and Codex CLI turn inputs, then appends them to today's Daily Note, grouped by project and session.

Use it as a lightweight developer journal, worklog capture layer, or the first building block for richer Daily Notes automation.

```bash
# Requires Bun (https://bun.sh) installed and available on your PATH
npm install -g @albireo3754/agentlog
agentlog init ~/Obsidian
```

Install it once, start using Claude Code, and your Daily Note fills itself.

## What It Does

```
Claude Code hook / Codex hook → Daily Note append
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

- [Claude Code](https://claude.ai/code) (hook integration) or [Codex CLI](https://developers.openai.com/codex) (hook integration)
- [Obsidian](https://obsidian.md) (Daily Note target)
- [Bun](https://bun.sh) (>=1.0.0) or [Node.js](https://nodejs.org) >=20

## Usage

### Setup

Unified CLI:

```bash
# Claude Code
agentlog init ~/Obsidian

# Codex
agentlog init --codex ~/Obsidian

# Claude + Codex
agentlog init --all ~/Obsidian

# Plain folder
agentlog init --plain ~/notes
```

`agentlog init` does two things:
1. Creates `~/.agentlog/config.json` with your vault path
2. Registers a hook in `~/.claude/settings.json`

Run `agentlog init` without arguments to auto-detect installed vaults.

`agentlog init --codex`:
1. Verifies that Codex CLI is installed and available in `PATH`
2. Creates or updates `~/.agentlog/config.json`
3. Registers a Codex `UserPromptSubmit` command hook in `~/.codex/hooks.json`
4. Prints a reminder to review/trust the hook in Codex with `/hooks` if prompted

The `default = --all` variant is intentionally not supported. `agentlog init` stays Claude-first for backward compatibility and to avoid failing on machines without Codex CLI.

### That's It

Use Claude Code or Codex normally. Claude and Codex prompts are logged from their `UserPromptSubmit` hook payloads.

### How It Works

1. Claude Code or Codex fires the `UserPromptSubmit` hook
2. AgentLog extracts the latest user-visible input and sanitizes it
3. Finds your Daily Note via `obsidian daily:path` (Obsidian CLI 1.12+). If that fails, it falls back to `{vault}/Daily/YYYY-MM-DD-<Korean weekday>.md`
4. Finds or creates a `## AgentLog` section
5. Finds or creates a `#### project` subsection matching the current working directory
6. Inserts a session divider `[[ses_...]]` if the session changed, then appends the entry
7. Updates the `> 🕐` latest-entry line at the top of the section

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

Current CLI:

| Command | Description |
|---------|-------------|
| `agentlog init [vault] [--plain] [--claude\|--codex\|--all]` | Configure vault and install integrations. `--claude` (default): Claude hook, `--codex`: Codex hook, `--all`: both |
| `agentlog detect` | List detected Obsidian vaults and CLI status |
| `agentlog codex-debug <prompt>` | Run `codex exec "<prompt>"` with Codex hook auto-registered |
| `agentlog doctor` | Run health checks for the binary, vault, hook, and Obsidian CLI. Also checks Codex hook status if configured |
| `agentlog open` | Open today's Daily Note in Obsidian (requires CLI 1.12+) |
| `agentlog version` | Print AgentLog version. In `dev` builds, also shows channel and commit |
| `agentlog uninstall [-y] [--codex\|--all]` | `default`: Remove Claude hook + config, `--codex`: Remove Codex hook only, `--all`: Remove both |
| `agentlog hook` | Invoked automatically by Claude Code or Codex (not for direct use) |
| `agentlog codex-notify` | Legacy handler for older Codex `notify` installs |

## Configuration

`~/.agentlog/config.json`:

| Field | Default | Description |
|-------|---------|-------------|
| `vault` | (required) | Path to the Obsidian vault or plain output folder |
| `plain` | `false` | Plain mode that writes simple markdown files without Obsidian integration |
| `codexHookInstalled` | `false` | Records that AgentLog expects the Codex hook to be installed, so `doctor` can detect partial damage |
| `codexNotifyRestore` | unset | Legacy metadata for older Codex `notify` installs |

Environment variables:

| Variable | Description |
|----------|-------------|
| `AGENTLOG_CONFIG_DIR` | Override the config directory (default: `~/.agentlog`) |
| `AGENTLOG_PHASE` | Force the runtime channel (`dev` or `prod`), overriding auto-detection |
| `OBSIDIAN_BIN` | Override the Obsidian CLI binary path |

`agentlog version`은 현재 실행 중인 AgentLog의 build identity를 출력합니다.

- `prod`: 헤드라인만 출력

```text
AgentLog 0.1.1
```

- `dev`: 개발 실행임을 나타내는 메타데이터를 추가 출력

```text
AgentLog 0.1.1
channel: dev
commit: <short-sha>
```

기본 규칙은 git 메타데이터가 있는 checkout/link 실행이면 `dev`, 패키지 설치본이면 `prod`입니다. 테스트나 디버깅에서 channel을 고정하고 싶다면 `AGENTLOG_PHASE=dev` 또는 `AGENTLOG_PHASE=prod`를 사용할 수 있습니다.

## Uninstall

Claude-only uninstall:

```bash
agentlog uninstall
```

This removes the hook from `~/.claude/settings.json` and deletes `~/.agentlog/`.

Codex-only uninstall:

```bash
agentlog uninstall --codex
```

Or remove both integrations:

```bash
agentlog uninstall --all
```

Codex 상태 확인은 별도 명령 대신 기존 `agentlog doctor`에 포함됩니다.

## Development

```bash
bun install
bun test              # run the test suite
bun run test:install-smoke
bun run typecheck     # run tsc --noEmit
bun run build         # compile to dist/ (optional)
```

The `bin` entry points directly to `src/cli.ts`, so you do not need a build during development. Bun runs TypeScript natively.

```bash
# Link as a global command
bun link

# Edit source and run immediately
agentlog doctor

# Isolated bun link install smoke test
bun run test:install-smoke

# Watch mode
bun run dev:watch
```

## Roadmap

- **Phase 2:** Obsidian plugin with timeline visualization UI
- **Phase 3:** Git log integration (commits → Daily Note)
- **Future:** `agentlog run` command for session replay from JSONL captures

## License

MIT
