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
- - - - [[claude_a1b2c3d4-1111-2222-3333-444455556666]]
- 10:53 start building agentlog
- 11:07 open the spec document
- - - - [[claude_e5f6a7b8-1111-2222-3333-444455556666]]
- 11:21 initialize git and open it in VS Code
```

| Element | Role |
|---------|------|
| `> 🕐 HH:MM — project › prompt` | Latest entry (always updated) |
| `#### HH:MM · project` | Project subsection (grouped by cwd) |
| `<!-- cwd=... -->` | Section matching key (hidden in Obsidian Reading view) |
| `- - - - [[claude_...]]` / `[[codex_...]]` | Session boundary (Obsidian wiki-link) |
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

# Hermes Agent
agentlog init --hermes ~/Obsidian
agentlog init --hermes --hermes-profile work ~/Obsidian
agentlog init --hermes --hermes-all-profiles ~/Obsidian

# Plain folder
agentlog init --plain ~/notes
```

`agentlog init` does two things:
1. Creates `~/.agentlog/config.json` with your vault path
2. Registers or repairs a Claude Code hook in `~/.claude/settings.json` using the string matcher format (`"matcher": ""`)

Run `agentlog init` without arguments to auto-detect installed vaults.

`agentlog init --codex`:
1. Verifies that Codex CLI is installed and available in `PATH`
2. Creates or updates `~/.agentlog/config.json`
3. Registers a Codex `UserPromptSubmit` command hook in `~/.codex/hooks.json`
4. Prints a reminder to review/trust the hook in Codex with `/hooks` if prompted

The `default = --all` variant is intentionally not supported. `agentlog init` stays Claude-first for backward compatibility and to avoid failing on machines without Codex CLI.

`agentlog init --hermes` records Hermes metadata and writes this shell hook under `hooks.pre_llm_call` in the selected Hermes config:

```yaml
hooks:
  pre_llm_call:
    - command: "agentlog hook --source hermes"
```

By default it edits `~/.hermes/config.yaml`. Use `--hermes-profile <name>` for `~/.hermes/profiles/<name>/config.yaml`, repeat the flag for multiple profiles, or use `--hermes-all-profiles` for default plus every existing named profile. AgentLog uses structured YAML parsing and only adds/removes its own command. See `docs/hermes-hook-spec.md`.

### That's It

Use Claude Code, Codex, or Hermes normally. Claude and Codex prompts are logged from `UserPromptSubmit`; Hermes prompts are logged from `pre_llm_call` after Hermes accepts/trusts the shell hook.

### Backfill Missed Prompts

If hooks were disabled, untrusted, or misconfigured for part of the day, rebuild the Daily Note from local session JSONL files:

```bash
agentlog backfill              # today, Claude + Codex
agentlog backfill 2026-06-19   # specific day
agentlog backfill --source codex --dry-run --format json
```

Backfill scans `~/.codex/sessions/YYYY/MM/DD/*.jsonl` and top-level `~/.claude/projects/**/*.jsonl`, extracts user prompts only, skips subagent/tool-result noise, and appends entries that are not already present in the target Daily Note.

### How It Works

1. Claude Code/Codex fires `UserPromptSubmit`, or Hermes fires `pre_llm_call`
2. AgentLog extracts the latest user-visible input and sanitizes it
3. Resolves your Daily Note path from `.obsidian/daily-notes.json`, then `obsidian daily:path` when needed
4. If the Daily Note is missing in Obsidian mode, asks `obsidian daily` to create it before writing so your Daily Notes template is preserved
5. Finds or creates a `## AgentLog` section
6. Finds or creates a `#### project` subsection matching the current working directory
7. Inserts a source-prefixed session divider such as `[[claude_...]]`, `[[codex_...]]`, or `[[hermes_...]]` if the session changed, then appends the entry
8. Updates the `> 🕐` latest-entry line at the top of the section

Steady-state overhead is under 50ms per prompt when the Daily Note already exists. Missing-note bootstrap depends on Obsidian CLI startup. Fire-and-forget, never blocks Claude Code.

## Daily Note Format

### Obsidian Mode (default)

AgentLog resolves the Daily Note path from `.obsidian/daily-notes.json` first, then `obsidian daily:path` when the vault settings are unavailable or unsupported. If the resolved Daily Note is missing, AgentLog runs `obsidian daily` before writing and only appends after the file exists, preserving the user's Daily Notes template. Obsidian mode does not create a guessed `{vault}/Daily/...` fallback file; if no safe path can be resolved or the CLI cannot bootstrap a missing note, the hook fails softly and skips the write. Plain mode still writes directly to `{dir}/YYYY-MM-DD.md`.

Each working directory gets its own `#### project` subsection. Session changes insert a source-prefixed wiki-link divider such as `[[claude_...]]`, `[[codex_...]]`, or `[[hermes_...]]`. The `> 🕐` blockquote at the top always shows the latest entry across all projects.

```markdown
## AgentLog
> 🕐 14:30 — kotlin/message-gate › adjust the API response

#### 10:53 · js/agentlog
<!-- cwd=/Users/you/work/js/agentlog -->
- - - - [[claude_a1b2c3d4-1111-2222-3333-444455556666]]
- 10:53 start building agentlog
- 11:07 open the spec document

#### 14:00 · kotlin/message-gate
<!-- cwd=/Users/you/work/kotlin/message-gate -->
- - - - [[codex_e5f6a7b8-1111-2222-3333-444455556666]]
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
| `agentlog init [vault] [--plain] [--claude\|--codex\|--hermes\|--all]` | Configure vault and install integrations. `--claude` (default): Claude hook, `--codex`: Codex hook, `--hermes`: Hermes shell hook config, `--all`: Claude+Codex |
| `agentlog detect` | List detected Obsidian vaults and CLI status |
| `agentlog backfill [date] [--source all\|claude\|codex] [--dry-run] [--format text\|json]` | Scan local Claude/Codex session JSONL files and append missing prompts to the Daily Note |
| `agentlog init --hermes [--hermes-profile <name>...] [--hermes-all-profiles] <vault>` | Write Hermes `pre_llm_call` shell-hook config and record profile metadata |
| `agentlog codex-debug <prompt>` | Run `codex exec "<prompt>"` with Codex hook auto-registered |
| `agentlog doctor` | Run health checks for the binary, vault, Claude hook registration/format, and Obsidian CLI. Also checks Codex/Hermes hook status if configured |
| `agentlog open` | Open today's Daily Note in Obsidian (requires CLI 1.12.4+) |
| `agentlog version` | Print AgentLog version. In `dev` builds, also shows channel and commit |
| `agentlog uninstall [-y] [--codex\|--hermes\|--all]` | `default`: Remove Claude hook + config, `--codex`: Remove Codex hook and legacy notify metadata, `--hermes`: remove AgentLog's Hermes hook from configured profiles and clear metadata, `--all`: remove all AgentLog-owned integration state |
| `agentlog hook` | Invoked automatically by Claude Code or Codex (not for direct use) |
| `agentlog codex-notify` | Legacy handler for older Codex `notify` installs |

## Configuration

`~/.agentlog/config.json`:

| Field | Default | Description |
|-------|---------|-------------|
| `vault` | (required) | Path to the Obsidian vault or plain output folder |
| `plain` | `false` | Plain mode that writes simple markdown files without Obsidian integration |
| `claudeHookInstalled` | `false` | Records that AgentLog expects the Claude hook to be installed, so `doctor` does not downgrade a missing Claude hook in `--all` installs |
| `codexHookInstalled` | `false` | Records that AgentLog expects the Codex hook to be installed, so `doctor` can detect partial damage |
| `hermesHookInstalled` | `false` | Records that AgentLog expects Hermes hook config to be present, so `doctor` can detect partial damage |
| `hermesProfiles` | unset | Hermes profiles selected by `init --hermes`; used by `doctor` and `uninstall --hermes` |
| `codexNotifyRestore` | unset | Legacy metadata for older Codex `notify` installs |
| `englishAsk` | unset | Optional hook prompt evaluator config. Disabled unless `englishAsk.enabled` is `true` |

Example EnglishAsk config:

```json
{
  "englishAsk": {
    "enabled": true,
    "mode": "log-only",
    "threshold": 3,
    "timeoutMs": 8000,
    "maxContextChars": 4000
  }
}
```

When enabled, AgentLog evaluates English hook prompts with `codex exec` after writing the normal AgentLog entry. The evaluator receives the current raw prompt plus bounded prior user/model context from the hook transcript when available. If no transcript is available, AgentLog falls back to same-session prompt context from the Daily Note. Results are appended to the same Daily Note under `## EnglishAsk`. Evaluator failures and timeouts are ignored. Child evaluator runs set `AGENTLOG_ENGLISHASK_EVAL=1` so AgentLog skips evaluator child turns.

Environment variables:

| Variable | Description |
|----------|-------------|
| `AGENTLOG_CONFIG_DIR` | Override the config directory (default: `~/.agentlog`) |
| `AGENTLOG_ENGLISHASK_EVAL` | Internal recursion guard for EnglishAsk evaluator runs |
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

This removes the Codex hook and also restores or removes AgentLog's legacy `notify` entry in `~/.codex/config.toml` when present.

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
bun run test:hermes-host
bun run typecheck     # run tsc --noEmit
bun run build         # compile to dist/ (optional)
```

The `bin` entry points directly to `src/cli.ts`, so you do not need a build during development. Bun runs TypeScript natively.

CLI command boundaries are documented in [docs/architecture/cli-layering.md](docs/architecture/cli-layering.md).

```bash
# Link as a global command
bun link

# Edit source and run immediately
agentlog doctor

# Isolated bun link install smoke test
bun run test:install-smoke

# Real host Hermes install smoke. Mutates your global agentlog link,
# ~/.agentlog/config.json, selected ~/.hermes config, and Hermes hook allowlist.
bun run test:hermes-host
bun run test:hermes-host -- --profile work
bun run test:hermes-host -- --append-fixture

# Watch mode
bun run dev:watch
```

## Roadmap

- **Phase 2:** Obsidian plugin with timeline visualization UI
- **Phase 3:** Git log integration (commits → Daily Note)
- **Future:** `agentlog run` command for session replay from JSONL captures

## License

MIT
