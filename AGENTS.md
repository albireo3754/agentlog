# AgentLog — Agent Guide

AgentLog captures Claude Code prompts and Codex CLI turn inputs, then appends them to the Obsidian Daily Note for today, grouped by project directory and session.

## Quick Reference

- Config: `~/.agentlog/config.json`
- Hook registered in: `~/.claude/settings.json`
- Codex notify registered in: `~/.codex/config.toml`
- Sessions dir: `~/.agentlog/` (config only; no session JSONL in current version)
- Config dir override: `AGENTLOG_CONFIG_DIR`

Before running any other command, run `agentlog doctor` to verify the installation is healthy.

## Commands

### `agentlog init [vault] [--plain] [--claude | --codex | --all]`

Saves config and registers the integration hook(s).

| Flag | Effect |
|------|--------|
| (none) | Claude hook only (default) |
| `--claude` | Claude hook only (explicit) |
| `--codex` | Codex notify only; requires `codex` binary in PATH |
| `--all` | Claude hook + Codex notify; requires `codex` binary in PATH |
| `--plain` | Write to a plain folder instead of an Obsidian vault |

- `vault` argument is optional. Without it, the command auto-detects installed Obsidian vaults.
- In non-TTY mode (piped stdin), a single detected vault is selected automatically.
- With `--plain`, the target must be an existing directory; no `.obsidian` check is performed.

What `init` does (Claude target):
1. Validates the vault path (checks for `.obsidian/` directory)
2. Writes `~/.agentlog/config.json`
3. Registers `agentlog hook` in `~/.claude/settings.json` under `UserPromptSubmit`

What `init --codex` does additionally:
1. Verifies `codex` binary is in PATH
2. Registers `notify = ["agentlog", "codex-notify"]` in `~/.codex/config.toml`
3. Preserves any existing `notify` command for forwarding at runtime

Example:
```
agentlog init ~/Obsidian
agentlog init --codex ~/Obsidian
agentlog init --all ~/Obsidian
agentlog init --plain ~/notes
```

Expected output (Claude):
```
Config saved: /Users/you/.agentlog/config.json
  vault: /Users/you/Obsidian
  Obsidian CLI: detected (1.12.3)
Hook registered: /Users/you/.claude/settings.json

AgentLog is ready. Claude Code prompts will be logged to your Daily Note.
```

### `agentlog detect`

Lists all detected Obsidian vaults and Obsidian CLI status. Does not modify any config.

- On macOS: reads `~/Library/Application Support/Obsidian/obsidian.json`
- All platforms: checks `~/Obsidian`, `~/Documents/Obsidian`, `~/Notes`, `~/Documents/Notes`

Example:
```
agentlog detect
```

Expected output:
```
Detected Obsidian vaults:
  1) /Users/you/Obsidian

Obsidian CLI: /usr/local/bin/obsidian (1.12.3)
```

### `agentlog doctor`

Runs health checks and prints a status table. Exits with code 1 if any required check fails.

Checks performed (in order):

| Check label | What it verifies | Fail = error or warn? |
|-------------|------------------|-----------------------|
| `binary` | `agentlog` is in PATH | error |
| `vault` | Config exists and vault path is valid | error |
| `obsidian` | Obsidian.app is installed (macOS only) | error |
| `cli` | Obsidian CLI binary found | warn |
| `cli-ver` | CLI version meets minimum | warn |
| `cli-app` | Obsidian app responds to CLI | warn |
| `daily` | Today's Daily Note exists | warn |
| `hook` | Hook registered in `~/.claude/settings.json` | error (warn if Codex-only) |
| `codex-bin` | `codex` binary in PATH (if Codex configured) | error |
| `codex` | Codex notify registered in config (if configured) | error |

Warnings (⚠️) do not affect the exit code. Errors (❌) cause exit code 1.

Example:
```
agentlog doctor
```

### `agentlog open`

Opens today's Daily Note in Obsidian using the Obsidian CLI (`obsidian daily`). Requires Obsidian 1.12+ with CLI enabled and Obsidian app running.

Example:
```
agentlog open
```

### `agentlog uninstall [-y] [--codex | --all]`

Removes AgentLog integration(s).

| Flag | Effect |
|------|--------|
| (none) | Remove Claude hook from `~/.claude/settings.json` + delete `~/.agentlog/` |
| `--codex` | Remove Codex notify from `~/.codex/config.toml` only |
| `--all` | Remove both Claude hook + Codex notify + delete `~/.agentlog/` |
| `-y` | Skip confirmation prompt |

Example:
```
agentlog uninstall -y
agentlog uninstall --codex -y
agentlog uninstall --all -y
```

### `agentlog version`

Prints version and build identity.

- In prod installs: `AgentLog 0.x.y`
- In dev (git checkout): also prints `channel: dev` and `commit: <sha>`

Override channel with `AGENTLOG_PHASE=dev` or `AGENTLOG_PHASE=prod`.

### `agentlog hook` (internal)

Invoked automatically by Claude Code on `UserPromptSubmit`. Do not call directly.

Reads JSON from stdin (Claude Code hook format), extracts prompt and cwd, and appends an entry to the Daily Note. Fails silently — never interrupts Claude Code.

### `agentlog codex-notify` (internal)

Invoked automatically by Codex on `agent-turn-complete`. Do not call directly.

## Operational Rules

1. Run `agentlog doctor` before other commands to verify the setup is healthy.
2. Run `agentlog init` before `agentlog hook` will work. The hook exits silently if config is missing.
3. Do not call `agentlog hook` or `agentlog codex-notify` manually — they are registered as callbacks.
4. The `agentlog` binary must stay in PATH after `init`, because Claude Code invokes `agentlog hook` by name.
5. Re-running `agentlog init` is safe — it merges into the existing config.
6. `--claude` and `--codex` flags are mutually exclusive. Use `--all` for both.

## Error Recovery

| Symptom | Fix |
|---------|-----|
| `[agentlog] not initialized. Run: agentlog init ~/path/to/vault` in Claude Code output | `agentlog init ~/path/to/vault` |
| `doctor` shows `vault` ❌ — `.obsidian not found` | Open the folder in Obsidian, then re-run `agentlog init` |
| `doctor` shows `hook` ❌ — `not registered` | `agentlog init` |
| `doctor` shows `codex` ❌ — `not registered` | `agentlog init --codex ~/path/to/vault` |
| `doctor` shows `codex-bin` ❌ — `not found in PATH` | Install Codex CLI, then `agentlog init --codex ~/path/to/vault` |
| `Error: Codex CLI not found in PATH` on `init --codex` | Install Codex CLI first |
| `Warning: Obsidian vault not detected at: ...` on `init` | Pass `--plain` for a plain folder, or open the folder in Obsidian first |
| `doctor` exits 1, all checks pass for ⚠️ only | Warnings are non-fatal; only ❌ errors block completion |
| Codex notify is still registered after `uninstall` | `agentlog uninstall --all -y` |

## Integration Points

### Claude Code Hook

- Event: `UserPromptSubmit`
- Registered in: `~/.claude/settings.json`
- Invocation: `agentlog hook` (receives JSON on stdin)
- Input fields used: `prompt`, `session_id`, `cwd`

### Codex CLI Notify

- Event: `agent-turn-complete`
- Registered in: `~/.codex/config.toml` as `notify = ["agentlog", "codex-notify"]`
- Existing `notify` is preserved for forwarding

### Obsidian CLI

- Used to resolve the Daily Note path via `obsidian daily:path`
- Minimum version: checked by `doctor` (1.12+)
- Override binary path: `OBSIDIAN_BIN`
- Fallback when CLI unavailable: `{vault}/Daily/YYYY-MM-DD-<weekday>.md`

### Config File

`~/.agentlog/config.json`:

```json
{
  "vault": "/Users/you/Obsidian",
  "plain": false,
  "codexNotifyRestore": null
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `vault` | yes | Absolute path to the Obsidian vault or plain output folder |
| `plain` | no | If true, writes simple `YYYY-MM-DD.md` files without Obsidian section structure |
| `codexNotifyRestore` | no | Previous Codex `notify` value, restored on `uninstall --codex` |

## Daily Note Output Format

### Obsidian mode (default)

```markdown
## AgentLog
> 🕐 11:21 — js/agentlog › initialize git

#### 10:53 · js/agentlog
<!-- cwd=/Users/you/work/js/agentlog -->
- - - - [[ses_a1b2c3d4]]
- 10:53 start building agentlog
- 11:07 open the spec document
- - - - [[ses_e5f6a7b8]]
- 11:21 initialize git
```

### Plain mode (`--plain`)

```markdown
# 2026-03-02
- 10:53 start building agentlog
```
