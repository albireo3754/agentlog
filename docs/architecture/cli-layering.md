# CLI Layering

AgentLog CLI code should keep the Commander edge thin. Command registration in
`src/cli.ts` owns argument parsing and delegation; reusable workflow support
lives outside that entrypoint.

## Layers

| Layer | Responsibility | Current modules |
|---|---|---|
| Command edge | Commander setup, option parsing, subcommand delegation | `src/cli.ts` |
| Application support | prompt asking, vault validation, config merge, binary lookup, shared CLI status output | `src/cli-shared.ts` |
| Domain/core | config shape, error taxonomy, Daily Note merge rules, prompt formatting | `src/config.ts`, `src/errors.ts`, `src/note-writer.ts`, `src/schema/*` |
| Infra/adapters | filesystem/process-backed integrations with Claude, Codex, Obsidian | `src/claude-settings.ts`, `src/codex-hooks.ts`, `src/codex-settings.ts`, `src/obsidian-cli.ts` |
| Presentation | human-readable command output and future machine-readable command schemas | command handlers in `src/cli.ts`, `SCHEMA_DATA` |

## Rules

- New command handlers should not add reusable validation or integration helpers
  directly to `src/cli.ts`.
- Shared command support goes in `src/cli-shared.ts` until a narrower
  application module is justified.
- External side effects stay behind adapter modules; command handlers should
  orchestrate them, not parse their internal file formats.
- Formatting that becomes reused by more than one command should move out of
  the command handler with tests.

## Next Cuts

- Move `doctor` check modeling and formatting into a dedicated application module.
- Move `uninstall` orchestration into a dedicated application module.
- Keep `SCHEMA_DATA` aligned with command registration, or generate it from a
  single command description source.
