# Codex Hook Integration Spec

AgentLog's Codex integration MUST use Codex lifecycle hooks, not the legacy
`notify` command path, for new installs. This document records the release
behavior AgentLog implements and tests.

Sources:

- Codex Hooks reference: <https://developers.openai.com/codex/hooks.md>
- Codex Advanced Configuration hooks section: <https://developers.openai.com/codex/config-advanced.md#hooks>

## Scope

AgentLog logs the user prompt that starts a Codex turn. The Codex hook event
that exposes this prompt before model submission is `UserPromptSubmit`.

Out of scope for the first hook migration:

- Tool-policy enforcement hooks such as `PreToolUse` or `PermissionRequest`.
- Stop/continuation hooks such as `Stop` and `SubagentStop`.
- Transcript parsing. Codex documents `transcript_path` as convenient but not a
  stable hook interface.
- Hook trust automation. Codex requires users to review/trust non-managed hooks
  through `/hooks`; AgentLog can install the hook definition, but Codex owns the
  trust prompt/state.

## Hook discovery and registration

Codex discovers hooks next to active config layers as either `hooks.json` or
inline `[hooks]` TOML tables. For AgentLog's user-level install, write:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "agentlog hook --source codex"
          }
        ]
      }
    ]
  }
}
```

Registration rules:

1. Use `~/.codex/hooks.json` for user-level Codex integration.
2. Preserve unrelated hook events and unrelated `UserPromptSubmit` hook groups.
3. Add the AgentLog hook idempotently; never duplicate the same command.
4. Treat a `UserPromptSubmit` handler whose command is exactly `agentlog hook`
   as an AgentLog legacy Codex handler and migrate it to
   `agentlog hook --source codex`. Leaving both commands installed logs the same
   Codex prompt twice and can mislabel one entry as Claude-sourced.
5. When migration or uninstall changes the `UserPromptSubmit` hook array, drop
   top-level `state` entries keyed to `:user_prompt_submit:` because Codex hook
   trust state is index-based and may no longer point at the same command.
6. Omit `matcher` for `UserPromptSubmit`; Codex currently ignores matchers for
   this event.
7. Command hooks run with the Codex session `cwd`, but AgentLog still reads
   `cwd` from hook stdin because it is part of the documented common input.
8. `type: "command"` is the only handler type AgentLog should emit today.
9. Do not configure `notify` for new Codex installs. Codex project-local config
   also cannot override `notify`; user-level notification/hook behavior belongs
   in user-level Codex config.

## UserPromptSubmit input contract

Every Codex command hook receives one JSON object on stdin. AgentLog depends on
these fields:

| Field | Required | AgentLog use |
| --- | --- | --- |
| `hook_event_name` | yes | Must be `UserPromptSubmit` |
| `session_id` | yes | Daily Note session grouping |
| `cwd` | yes | Daily Note project/section grouping |
| `prompt` | yes | Prompt text to log |
| `turn_id` | no | Codex turn identity; retained for future diagnostics |
| `transcript_path` | no | Ignored; not a stable parsing interface |
| `permission_mode` | no | Ignored |
| `model` | no | Ignored |

Representative fixture:

```json
{
  "session_id": "019cb123-ac48-7d22-b5bf-195ee34699af",
  "transcript_path": "/Users/pray/.codex/sessions/example.jsonl",
  "cwd": "/Users/pray/opensource/agentlog",
  "hook_event_name": "UserPromptSubmit",
  "model": "gpt-5.5",
  "turn_id": "019cb123-ac4f-7800-a1f9-a953dc2ce3f5",
  "permission_mode": "default",
  "prompt": "Reply with exactly: OK"
}
```

AgentLog may continue to accept Claude/backward-compatibility fallback shapes
(`message.content` and `parts[].text`) in its generic hook parser. Those
fallbacks are not part of the Codex contract. When the handler runs with
`--source codex`, a missing `prompt` is invalid.

## Output behavior

AgentLog should normally exit `0` with no stdout. Codex treats that as success
and continues. AgentLog must not block or modify prompts in normal logging mode.

Allowed but unused Codex `UserPromptSubmit` outputs include:

- Plain text stdout as extra developer context.
- JSON common output fields such as `continue`, `stopReason`, `systemMessage`,
  and `suppressOutput`.
- `hookSpecificOutput.additionalContext`.
- Legacy block output (`decision: "block"`) or exit code `2` to block a prompt.

AgentLog intentionally does not emit these because prompt logging must be
non-interrupting.

## Codebase mapping

| Spec concept | Code artifact |
| --- | --- |
| User-level hook file | `src/codex-hooks.ts` (`CODEX_HOOKS_PATH`) |
| AgentLog hook command | `src/codex-hooks.ts` (`AGENTLOG_CODEX_HOOK_COMMAND`) |
| Hook stdin parser | `src/schema/hook-input.ts` (`parseHookInput`) |
| Codex source tagging | `src/hook.ts` (`agentlog hook --source codex`) |
| CLI install path | `src/cli.ts` (`init --codex`, `init --all`) |
| CLI uninstall path | `src/cli.ts` (`uninstall --codex`, `uninstall --all`) |
| Doctor verification | `src/cli.ts` (`codex` check reads hooks state) |
| Hook registration tests | `src/__tests__/codex-hooks.test.ts` |
| Hook input fixture/tests | `src/__tests__/fixtures/codex-hook-user-prompt-submit.json`, `src/__tests__/hook-input.test.ts` |

## Backward compatibility

The legacy `agentlog codex-notify` command and notify parser may remain for
users who already have an old Codex `notify` command configured. New install,
doctor, and uninstall behavior should be hook-based. Legacy notify forwarding is
not part of the hook spec and must not be used as evidence that the latest Codex
integration is installed.
