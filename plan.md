# Issue #9 Codex Notify Integration

## TDD Order

1. Capture Codex notify fixture shape and freeze it as test input.
2. Add RED tests for parser, config install/uninstall, and CLI commands.
3. Review the failing test set before production code.
4. Implement parser/runtime, then config/CLI flows in small batches.
5. Re-run full regression and request final review.

## Review Gates

- Gate A: fixture and scenario review
- Gate B: RED-only review
- Gate C: batch review after parser/runtime, then config/CLI
- Gate D: final review after regression

## Test Scenarios

- Parser: parse real `agent-turn-complete` payload, pick the last user message, ignore non-turn events, reject missing `thread-id`, reject missing `cwd`, reject missing `input-messages`, handle Korean prompts.
- Config install: require Codex CLI to be installed first, create top-level `notify` when absent, preserve existing single-line `notify`, persist the previous command in `config.json` as `codexNotifyRestore`, stay idempotent on re-run, abort on unsupported multi-line `notify`.
- Notify runtime: write Daily Note entry, forward prior notify command, keep logging even when forward fails.
- Uninstall/doctor: restore prior `notify`, remove AgentLog notify when no prior command existed, and surface Codex status from `agentlog doctor` with installed/missing/partial-damage distinctions.
- Regression: Claude `init`/`hook`/`doctor` behavior remains unchanged.

## CLI Review Outcome

- Accept: unified target flags on `init`/`uninstall`
- Target commands: `init --claude`, `init --codex`, `init --all`, `uninstall --codex`, `uninstall --all`
- Reject: changing the default to `--all`
- Reason: default `init` must remain backward-compatible and must not fail on machines without Codex CLI
- Legacy aliases removed: `codex-init`, `codex-uninstall`
