# Hermes Hook Spec

AgentLog supports Hermes Agent live prompt capture through the Hermes `pre_llm_call` shell hook.

## Setup

Run:

```bash
agentlog init --hermes ~/Obsidian
```

AgentLog writes this command to `hooks.pre_llm_call` in `~/.hermes/config.yaml`:

```yaml
hooks:
  pre_llm_call:
    - command: "agentlog hook --source hermes"
```

Named Hermes profiles are supported:

```bash
agentlog init --hermes --hermes-profile work ~/Obsidian
agentlog init --hermes --hermes-profile alpha --hermes-profile beta ~/Obsidian
agentlog init --hermes --hermes-all-profiles ~/Obsidian
```

`--hermes-profile <name>` targets `~/.hermes/profiles/<name>/config.yaml`; `--hermes-all-profiles` targets the default config plus every existing named profile config. `agentlog uninstall --hermes` removes only `agentlog hook --source hermes` from the configured profiles and clears AgentLog metadata.

AgentLog uses structured YAML parsing. It rejects unsupported YAML instead of regex-editing arbitrary `config.yaml` content.

## Input Contract

Hermes shell hooks send JSON on stdin. AgentLog accepts:

```json
{
  "hook_event_name": "pre_llm_call",
  "session_id": "hermes-session-123",
  "cwd": "/Users/pray/work/js/agentlog",
  "extra": {
    "user_message": "prompt text"
  }
}
```

Required fields:

| Field | Requirement |
|-------|-------------|
| `hook_event_name` | Must be `pre_llm_call` |
| `session_id` | Non-empty string |
| `cwd` | Non-empty string |
| `extra.user_message` | Non-empty string |

## Output Contract

AgentLog writes the same Daily Note structure as Claude and Codex, using a Hermes source divider:

```markdown
- - - - [[hermes_hermes-session-123]]
- 10:53 prompt text
```

AgentLog emits no stdout on successful hook execution, so it does not inject Hermes context.

## Non-Goals

- No Hermes backfill until transcript format is separately verified.
- No EnglishAsk evaluation for Hermes.
- No broad Hermes plugin framework; AgentLog uses the documented shell-hook surface.
