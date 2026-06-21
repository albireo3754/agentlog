# Hook Provider Current Behavior Coverage

> status: implementation-gate
> date: 2026-06-21
> scope: Phase 0 for hook provider abstraction before Hermes

## Purpose

Lock current Claude and Codex behavior before provider extraction.

## Coverage Matrix

| Area | Behavior | Evidence |
|------|----------|----------|
| Claude init | `agentlog init` writes config and registers `agentlog hook` in `~/.claude/settings.json` | `src/__tests__/cli.test.ts` |
| Claude hook migration | stale object matcher is migrated to string matcher | `src/__tests__/cli.test.ts` |
| Claude doctor | missing/unsupported Claude hook fails unless Codex-only warning path applies | `src/__tests__/cli.test.ts`, `src/__tests__/cli-codex.test.ts` |
| Codex init | `agentlog init --codex` writes `agentlog hook --source codex` and records metadata | `src/__tests__/cli-codex.test.ts` |
| Codex hook preservation | unrelated Codex hooks and trusted state are preserved | `src/__tests__/codex-hooks.test.ts`, `src/__tests__/cli-codex.test.ts` |
| Codex legacy migration | legacy `agentlog hook` is migrated to `--source codex` | `src/__tests__/codex-hooks.test.ts`, `src/__tests__/cli-codex.test.ts` |
| `init --all` compatibility | `--all` remains Claude + Codex, not Hermes | `src/__tests__/cli-codex.test.ts`, `src/__tests__/hook-providers.test.ts` |
| Hook parser | Claude fallbacks and Codex required `prompt` stay intact | `src/__tests__/hook-input.test.ts` |
| Daily Note writer | project sections, source-aware dividers, latest line, and plain mode remain intact | `src/__tests__/daily-note.test.ts`, `src/__tests__/note-writer.test.ts` |
| Backfill | Claude/Codex JSONL backfill remains scoped to `all`, `claude`, `codex` | `src/__tests__/backfill.test.ts` |
| Uninstall | Claude, Codex, legacy notify, and `--all` paths preserve current cleanup behavior | `src/__tests__/cli.test.ts`, `src/__tests__/cli-codex.test.ts` |

## Added Regression Coverage

| New Risk | Evidence |
|----------|----------|
| Provider registry accidentally includes Hermes in `init --all` | `src/__tests__/hook-providers.test.ts` |
| Hermes parser accepts wrong event or wrong field | `src/__tests__/hook-input.test.ts` |
| Unknown explicit source silently becomes Claude | `src/__tests__/cli-codex.test.ts` |
| Hermes divider duplicates in same session | `src/__tests__/note-writer.test.ts` |
| `init --hermes` edits privileged YAML | `src/__tests__/cli-codex.test.ts` verifies no `~/.hermes/config.yaml` write |

## QA Smoke

Run before abstraction PR review:

```bash
agentlog doctor
bun test
bun run typecheck
bun run prd:redteam
bun run agent:redteam-loop
```

Manual host checks:

```bash
agentlog init --dry-run ~/Obsidian
agentlog init --codex --dry-run ~/Obsidian
agentlog init --hermes --dry-run ~/Obsidian
agentlog backfill --dry-run --format json
```

Hermes isolated fixture check:

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/notes" "$tmp/cfg"
printf '{"vault":"%s/notes","plain":true,"hermesHookInstalled":true}' "$tmp" > "$tmp/cfg/config.json"
AGENTLOG_CONFIG_DIR="$tmp/cfg" bun run src/cli.ts hook --source hermes < src/__tests__/fixtures/hermes-pre-llm-call.json
```
