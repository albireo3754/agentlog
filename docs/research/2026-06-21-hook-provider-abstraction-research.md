# Hook Provider Abstraction Research

**Date:** 2026-06-21
**Status:** Research
**Related:** [Hermes Agent Integration Research](./2026-06-21-hermes-agentlog-research.md)

## Question

AgentLog currently supports Claude Code and Codex through separate hook install/check code paths. Hermes is the third provider. Under the "third time" rule, the question is whether the third provider justifies a hook-provider abstraction before adding Hermes.

## Conclusion

Yes, but only at the hook-provider boundary.

The abstraction should cover repeated integration lifecycle concerns:

- provider identity and config metadata
- install/uninstall/inspect operations
- provider-specific hook command and config path
- provider-specific stdin payload normalization into AgentLog's internal `{ sessionId, cwd, prompt }`
- doctor output state mapping

It should not generalize the Daily Note writer, prompt formatter, Obsidian resolver, or backfill collectors. Those are not provider-specific enough yet.

## External Evidence

### Claude Code

Official Claude Code hook docs: <https://code.claude.com/docs/en/hooks>

Relevant evidence:

- Command hooks receive event JSON on stdin and communicate through exit codes/stdout.
- `UserPromptSubmit` runs when the user submits a prompt before Claude processes it.
- `UserPromptSubmit` input contains common fields plus `prompt`.
- The documented input includes `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, and `prompt`.
- A stuck `UserPromptSubmit` hook blocks model processing until it completes, so AgentLog must stay fail-soft and return no output.

### Codex

Official Codex hook docs: <https://developers.openai.com/codex/hooks>

Relevant evidence:

- Hooks are deterministic scripts during the Codex lifecycle.
- Codex discovers hooks from `hooks.json` or inline `[hooks]` tables.
- User-level practical locations include `~/.codex/hooks.json` and `~/.codex/config.toml`.
- Command hooks receive one JSON object on stdin.
- Common fields include `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and `model`.
- `UserPromptSubmit` adds `turn_id` and `prompt`; matcher is not supported for that event.
- Exit `0` with no output is success and continues.
- Non-managed hooks require trust review.

### Hermes Agent

Official Hermes hook docs: <https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks>

Relevant evidence:

- Plugin hooks and shell hooks share lifecycle events.
- `pre_llm_call` fires once per turn before the tool-calling loop.
- `pre_llm_call` can inject context by returning `{"context": "..."}`.
- Shell hooks live under `hooks:` in `~/.hermes/config.yaml`.
- Shell hook JSON payload includes `hook_event_name`, `tool_name`, `tool_input`, `session_id`, `cwd`, and `extra`.
- For non-tool events such as `pre_llm_call`, `tool_name` and `tool_input` are `null`, and `extra` carries event-specific kwargs such as `user_message` and `conversation_history`.
- Hermes explicitly treats `pre_llm_call` as the Claude-Code `UserPromptSubmit` equivalent.
- Shell hooks run with full user credentials; Hermes docs call `hooks:` privileged config.

## Local Evidence

### Current duplication

`src/cli.ts` has separate Claude/Codex branches:

- `InitTarget = "claude" | "codex" | "all"` and `UninstallTarget = "claude" | "codex" | "all"`.
- `runInit()` handles Claude registration.
- `runCodexInit()` handles Codex registration.
- `runAllInit()` manually repeats both flows.
- `cmdDoctor()` manually decides whether Codex is relevant, then prints Claude and Codex checks separately.
- `cmdUninstall()` manually switches between Claude/Codex/all.
- `cmdBackfill()` hard-codes `["all", "claude", "codex"]`.

Provider adapters already exist, but only as separate modules:

- `src/claude-settings.ts`: Claude settings mutation and inspection.
- `src/codex-hooks.ts`: Codex hooks mutation and inspection.
- `src/codex-settings.ts`: legacy Codex notify migration/uninstall support.

### Current provider assumptions

Runtime source support is still hard-coded:

- `src/types.ts`: `SourceType = "claude" | "codex"`.
- `src/hook.ts`: `--source codex` maps to Codex; any other value maps to Claude.
- `src/schema/hook-input.ts`: parser accepts `UserPromptSubmit` only.
- `src/note-writer.ts`: divider regex recognizes only `claude|codex|ses`.

### Existing architecture rule

`docs/architecture/cli-layering.md` says:

- command handlers should stay thin
- reusable workflow support should live outside `src/cli.ts`
- external side effects should stay behind adapter modules

Hook-provider abstraction follows that rule by moving install/doctor/uninstall branching out of `src/cli.ts` while leaving file-format side effects inside provider adapters.

## Abstraction Boundary

Recommended minimal abstraction:

```ts
export type HookProviderId = "claude" | "codex" | "hermes";

export type HookProviderState =
  | { kind: "registered"; detail: string }
  | { kind: "missing"; detail: string; repairHint: string }
  | { kind: "needs_migration"; detail: string; repairHint: string }
  | { kind: "unsupported"; detail: string; repairHint: string };

export interface HookProvider {
  id: HookProviderId;
  label: string;
  configFlag: "claudeHookInstalled" | "codexHookInstalled" | "hermesHookInstalled";
  command: string;
  install?(ctx: HookInstallContext): HookInstallResult;
  uninstall?(ctx: HookUninstallContext): HookUninstallResult;
  inspect(): HookProviderState;
}
```

Separate runtime payload normalization:

```ts
export interface ParsedHookInput {
  sessionId: string;
  cwd: string;
  prompt: string;
}

export function parseHookInput(raw: string, options: { source: HookProviderId }): ParsedHookInput;
```

Keep install/check provider abstraction separate from parsing if that keeps the diff smaller. The shared type name can still be `HookProviderId`.

## Non-Abstractions

Do not abstract these now:

- Daily Note writer: same for all sources.
- Obsidian CLI path/bootstrap: not provider-specific.
- EnglishAsk: currently Codex-specific behavior; Hermes should not inherit it by accident.
- Backfill collectors: Hermes transcript format is not yet verified.
- YAML mutation engine: only needed if AgentLog-owned `init --hermes` is in scope.

## Product Direction

Recommended PRD direction:

1. First refactor Claude/Codex hook integration into a provider registry while preserving behavior.
2. Add Hermes as a third provider using the same registry.
3. Keep Hermes install conservative:
   - runtime parser and docs are required
   - AgentLog-owned `~/.hermes/config.yaml` mutation is optional and should be gated behind explicit scope
4. Keep `agentlog init --all` meaning Claude+Codex for backward compatibility unless the user explicitly chooses Hermes.

## Risks

- Over-abstracting before Hermes details are implemented can create a framework that still misses Hermes's unique `pre_llm_call` payload shape.
- Mutating `~/.hermes/config.yaml` safely likely requires a YAML parser dependency or a very narrow append-only strategy.
- Hermes `pre_llm_call` can alter prompts; AgentLog must emit no context and no stdout.
- Doctor output can become noisy if all providers are checked unconditionally; provider relevance should come from config metadata or existing installed state.

## Recommended Next Artifact

Create a PRD/spec for:

> Hook Provider Abstraction, then Hermes provider implementation.

The spec should split work into two phases:

- Phase 1: provider registry extraction for Claude/Codex, no behavior change.
- Phase 2: Hermes runtime provider and docs, with optional install/doctor support only if YAML mutation is accepted.
