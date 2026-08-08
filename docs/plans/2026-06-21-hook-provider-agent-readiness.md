# Hook Provider Agent Readiness

> status: implementation-gate
> date: 2026-06-21
> scope: Phase 0 for provider abstraction + Hermes runtime support

## Executable Task Boundaries

| Task | Agent Inputs | Expected Output | Verification |
|------|--------------|-----------------|--------------|
| Provider registry | PRD §3.2, existing Claude/Codex modules | `src/hook-providers/*` | `bun test src/__tests__/hook-providers.test.ts` |
| Hermes parser | Hermes fixture and research docs | `parseHookInput(..., { source: "hermes" })` | `bun test src/__tests__/hook-input.test.ts` |
| Source-aware writing | `SourceType` expansion and divider regex | `[[hermes_<session_id>]]` without duplicate divider | `bun test src/__tests__/daily-note.test.ts src/__tests__/note-writer.test.ts` |
| Hermes config automation | research Option A + structured YAML parser guardrail | default/profile/all-profile config write-remove lifecycle | `bun test src/__tests__/hermes-config.test.ts src/__tests__/cli-codex.test.ts` |
| Red-team gate | PRD + coverage/readiness docs | mechanical + model report | `bun run prd:redteam` |

## Decisions Locked

| Decision | Status | Reason |
|----------|--------|--------|
| `init --all` excludes Hermes | locked | avoids surprising privileged Hermes hook config |
| Hermes YAML mutation | locked | allowed only through structured YAML parsing; no regex mutation |
| Hermes backfill | out of scope | transcript format not verified |
| EnglishAsk for Hermes | out of scope | Codex-specific evaluator should not run accidentally |

## Agent Framework Checks

- Files, commands, interfaces, and test commands are named in the PRD.
- Ambiguous choices are either locked above or left out of implementation scope.
- Phase 0 coverage matrix exists before provider extraction.
- Red-team script validates PRD structure and required Phase 0 artifacts.
- Agent loop script runs implementation tests before model review.

## Remaining Risk

Nested `codex exec` can hang when it reuses a large or inconsistent global `~/.codex` state. The red-team gate runs model review with an isolated temporary `CODEX_HOME` that copies auth and writes a minimal config; timeout is still treated as a model-gate failure with captured evidence.
