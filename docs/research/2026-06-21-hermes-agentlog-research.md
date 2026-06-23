# Hermes Agent Integration Research

**Date:** 2026-06-21
**Status:** Research
**Target:** Add Hermes Agent prompt capture to AgentLog.

## Goal

Support Hermes Agent as a third AgentLog source beside Claude Code and Codex CLI, so Hermes user turns are appended to the same Obsidian Daily Note format with `[[hermes_<session_id>]]` session dividers.

## Scope

This is research only. No implementation changes are included here.

Acceptance criteria for the later implementation:

- Hermes user prompts are captured from the correct Hermes turn-start hook.
- Daily Note output preserves the current AgentLog section structure.
- Claude and Codex behavior remain unchanged.
- `agentlog doctor` can distinguish configured, missing, and unsupported Hermes integration state if AgentLog owns installation.
- Tests cover hook input parsing, source divider behavior, CLI install/uninstall/doctor behavior, and any Hermes fixture payload.

## External Evidence

Official Hermes docs identify the relevant lifecycle hook as `pre_llm_call`:

- Event Hooks docs: <https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks>
  - `pre_llm_call` fires once per turn before the tool-calling loop.
  - Callback parameters include `session_id`, `user_message`, `conversation_history`, `is_first_turn`, `model`, and `platform`.
  - Shell hooks receive JSON on stdin with `hook_event_name`, `session_id`, `cwd`, and `extra`; for non-tool events, `tool_name` and `tool_input` are `null`.
  - `extra` carries event-specific kwargs, including `user_message` and `conversation_history`.
  - Hermes docs explicitly say Claude Code `UserPromptSubmit` is not a separate Hermes event; `pre_llm_call` fires at the same place.
  - Shell hooks are configured under `hooks:` in `~/.hermes/config.yaml`.
  - Malformed JSON, non-zero exits, and timeouts warn but do not abort the agent loop.

- Configuration docs: <https://hermes-agent.nousresearch.com/docs/user-guide/configuration>
  - Hermes stores config under `~/.hermes/config.yaml`.
  - Secrets live in `~/.hermes/.env`; non-secret config belongs in `config.yaml`.
  - `hermes config`, `hermes config edit`, `hermes config set`, `hermes config check`, and `hermes config migrate` are the documented management commands.

- Plugin guide: <https://hermes-agent.nousresearch.com/docs/guides/build-a-hermes-plugin>
  - General plugins live under `~/.hermes/plugins/<plugin-name>/` with `plugin.yaml` and `__init__.py`.
  - Plugins register hooks through `ctx.register_hook(...)`.
  - Shell hooks are the documented no-Python path for running scripts on lifecycle events.

## Current AgentLog Architecture

Current source support is hard-coded to two sources:

- `src/types.ts`
  - `SourceType = "claude" | "codex"`.
  - `AgentLogConfig` has `claudeHookInstalled?` and `codexHookInstalled?`, no generalized integration map.

- `src/hook.ts`
  - `resolveSource()` accepts `--source codex`; every other value becomes `claude`.
  - The same entry point parses hook stdin and writes a `LogEntry`.

- `src/schema/hook-input.ts`
  - Parser requires `hook_event_name: "UserPromptSubmit"`.
  - Codex mode requires top-level `prompt`.
  - Claude mode supports `prompt`, `message.content`, or `parts[].text`.
  - No Hermes payload shape is accepted.

- `src/schema/daily-note.ts`
  - `buildSessionDivider(sessionId, source)` already formats source-prefixed wiki-links.
  - It will work with `hermes` after `SourceType` expands.

- `src/note-writer.ts`
  - `dividerRe` only recognizes `claude|codex|ses`.
  - This must include `hermes`, or existing Hermes sections will not be source-aware on subsequent writes.

- `src/backfill.ts`
  - `BackfillSource = SourceType | "all"`.
  - Backfill knows Claude JSONL and Codex JSONL locations only.
  - Hermes backfill should be a separate decision, because the researched hook path does not prove a stable Hermes local transcript format.

- CLI install/doctor/uninstall
  - Claude install writes `~/.claude/settings.json` through `src/claude-settings.ts`.
  - Codex install writes `~/.codex/hooks.json` through `src/codex-hooks.ts`.
  - Hermes would need a new module if AgentLog edits `~/.hermes/config.yaml`.

## Integration Options

### Option A: Hermes shell hook, AgentLog-owned config mutation

AgentLog adds `agentlog init --hermes ~/Obsidian`, modifies `~/.hermes/config.yaml`, and registers:

```yaml
hooks:
  pre_llm_call:
    - command: "agentlog hook --source hermes"
```

AgentLog then parses Hermes shell-hook stdin:

```json
{
  "hook_event_name": "pre_llm_call",
  "tool_name": null,
  "tool_input": null,
  "session_id": "sess_abc123",
  "cwd": "/home/user/project",
  "extra": {
    "user_message": "the prompt",
    "conversation_history": [],
    "is_first_turn": true,
    "model": "anthropic/claude-sonnet-4.6",
    "platform": "cli"
  }
}
```

Pros:

- Smallest user-facing setup: `agentlog init --hermes`.
- Reuses current executable and Daily Note writer.
- Matches Hermes docs for no-Python shell hooks.

Cons:

- Requires YAML read/modify/write support. Current dependencies do not include a YAML parser.
- YAML mutation must preserve unrelated user config and avoid duplicate hook entries.
- Security-sensitive: Hermes treats `hooks:` as privileged shell config.

### Option B: Documented manual Hermes shell hook

AgentLog supports `agentlog hook --source hermes`, but `init --hermes` only prints instructions or writes a sample script/doc. User edits Hermes config manually.

Pros:

- Avoids YAML parser dependency.
- Avoids AgentLog taking ownership of privileged Hermes config mutation.
- Fastest low-risk implementation path.

Cons:

- Weaker setup UX than Claude/Codex.
- `doctor` can only inspect best-effort state unless config parsing is added.

### Option C: Hermes Python plugin

Ship or document a Hermes plugin under `~/.hermes/plugins/agentlog/` that calls AgentLog from Python or writes directly.

Pros:

- Native Hermes plugin surface.
- Can use `ctx.register_hook("pre_llm_call", ...)`.

Cons:

- Larger maintenance surface.
- Cross-language packaging and install complexity.
- Less aligned with current AgentLog CLI-first integration model.

## Recommendation

Start with Option B unless the product requirement explicitly demands one-command installation.

Implement the runtime path first:

1. Add `hermes` to `SourceType`.
2. Teach `agentlog hook --source hermes` to preserve the source instead of falling back to `claude`.
3. Add a Hermes parser branch:
   - accept `hook_event_name: "pre_llm_call"`
   - extract `session_id`
   - extract `cwd`
   - extract prompt from `extra.user_message`
4. Update `note-writer` divider recognition to include `hermes`.
5. Add tests with a Hermes shell-hook fixture.
6. Document manual Hermes setup under README and/or a dedicated spec.

Then add AgentLog-owned `init --hermes` only if YAML mutation is acceptable. If added, use a real YAML parser or a tightly scoped structured mutation strategy; do not regex-edit arbitrary `config.yaml`.

## Proposed Files For Implementation

Runtime:

- `src/types.ts`
- `src/hook.ts`
- `src/schema/hook-input.ts`
- `src/note-writer.ts`
- `src/schema/daily-note.ts` tests

Docs:

- `README.md`
- `docs/hermes-hook-spec.md` or equivalent

Tests:

- `src/__tests__/hook-input.test.ts`
- `src/__tests__/daily-note.test.ts`
- `src/__tests__/note-writer.test.ts`
- new fixture: `src/__tests__/fixtures/hermes-pre-llm-call.json`

Optional install/doctor work:

- new `src/hermes-config.ts`
- `src/cli.ts`
- CLI tests for `init --hermes`, `init --all`, `uninstall --hermes`, and `doctor`

## Open Questions

- Should `agentlog init --all` include Hermes? Current `--all` means Claude plus Codex. Adding Hermes could surprise users because it writes another tool's privileged shell-hook config.
- Should Hermes be runtime-only first, with manual setup docs, or should AgentLog own Hermes config mutation from day one?
- Does Hermes have stable local session logs suitable for backfill? The hook docs prove live capture, not backfill.
- Which platforms should be logged? `platform` can be `cli`, `telegram`, `discord`, etc. AgentLog may want all platforms by default, or only `cli` to match Claude/Codex terminal-agent scope.

## Verification Plan For Later Code

Minimum:

```bash
bun test src/__tests__/hook-input.test.ts src/__tests__/daily-note.test.ts src/__tests__/note-writer.test.ts
bun run typecheck
```

If CLI setup is added:

```bash
bun test src/__tests__/cli.test.ts
agentlog doctor
```

Manual QA:

1. Add a Hermes shell hook for `pre_llm_call` that runs `agentlog hook --source hermes`.
2. Run a Hermes CLI turn from a known project directory.
3. Confirm today's Daily Note contains:
   - `#### HH:MM · <parent>/<project>`
   - `<!-- cwd=<project cwd> -->`
   - `- - - - [[hermes_<session_id>]]`
   - `- HH:MM <user message>`

## Risks

- YAML config mutation can corrupt unrelated Hermes config if implemented with ad hoc string edits.
- `pre_llm_call` can inject context; AgentLog must return empty output or `{}` so it does not alter the user's Hermes turn.
- Shell hooks run with full user credentials. Docs must say users should review any command added under `~/.hermes/config.yaml`.
- Existing `dividerRe` must recognize `hermes`; otherwise repeated writes may duplicate session dividers or fail source-aware grouping.
- Backfill should not be promised until Hermes transcript format is separately verified.
