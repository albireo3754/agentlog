# AgentLog — Hook Integration Guide

## Overview

AgentLog uses the Claude Code `UserPromptSubmit` hook to capture every prompt
you type in Claude Code and append it to your Obsidian Daily Note.

---

## Hook Input Format (Source of Truth)

When Claude Code fires the `UserPromptSubmit` hook, it sends a JSON object via
**stdin**. The canonical shape is:

```json
{
  "hook_event_name": "UserPromptSubmit",
  "session_id": "abc-123",
  "cwd": "/path/to/working/dir",
  "prompt": "user prompt text",
  "message": { "content": "user prompt text" },
  "parts": [{ "type": "text", "text": "user prompt text" }]
}
```

### Required Fields

| Field            | Type   | Description                           |
|------------------|--------|---------------------------------------|
| `hook_event_name`| string | Always `"UserPromptSubmit"`           |
| `session_id`     | string | Unique Claude Code session identifier |
| `cwd`            | string | Working directory of the Claude session |

### Prompt Extraction (priority order)

AgentLog extracts the user prompt using this fallback chain:

1. `input.prompt` — direct string field (preferred)
2. `input.message.content` — nested message object
3. `input.parts[0].text` — first text part in parts array

If none of these yield a non-empty string, the hook exits silently (no write).

### Type Definitions

See [`src/schema/hook-input.ts`](../src/schema/hook-input.ts) for the full
TypeScript interface and `parseHookInput()` runtime validator.

---

## Hook Registration

After running `npx agentlog init <vault>`, the hook is registered in
`~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "agentlog hook"
          }
        ]
      }
    ]
  }
}
```

The `matcher` is empty string to match all prompts regardless of content.

---

## Daily Note Format

AgentLog appends to `{vault}/Daily/{YYYY-MM-DD}-{요일}.md`.

### With time-block sections (Korean Daily Note format)

If the file contains time-block checkbox lines, the entry is inserted under the
matching 2-hour block:

```markdown
## 오전 (08-13)
- [ ] 08 - 10
- [x] 10 - 12
  - 10:53 agentlog 개발을 위해서 작업 진행
  - 11:07 스펙 문서 열어봐
- [ ] 12 - 13
```

### Without time-block sections (fallback)

If no time-block pattern is found, appended to an `## AgentLog` section at
end of file:

```markdown
## AgentLog
- 10:53 agentlog 개발을 위해서 작업 진행
- 11:07 스펙 문서 열어봐
```

### `--plain` mode

With `--plain` flag during init, writes to `{dir}/{YYYY-MM-DD}.md` with no
time-block logic:

```markdown
- 10:53 agentlog 개발을 위해서 작업 진행
```

---

## Error Handling

The hook script is designed to **fail silently** — Claude Code must not be
interrupted by logging errors. All errors are written to stderr only.

Exit codes:
- `0` — success or silent skip (no config, empty prompt)
- `1` — unexpected fatal error (also silent to Claude Code user)
