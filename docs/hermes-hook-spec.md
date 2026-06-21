# Hermes Hook Spec

AgentLog supports Hermes Agent live prompt capture through the Hermes `pre_llm_call` shell hook.

## Manual Setup

Add this to `~/.hermes/config.yaml`:

```yaml
hooks:
  pre_llm_call:
    - command: "agentlog hook --source hermes"
```

Run:

```bash
agentlog init --hermes ~/Obsidian
```

AgentLog records local metadata and prints the manual setup snippet. It does not mutate `~/.hermes/config.yaml`.

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
- No automatic YAML mutation without a structured YAML parser decision.
