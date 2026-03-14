# OMX Discord Bridge Design

**Date:** 2026-03-14
**Status:** Approved

## Goal

Use existing Discord credentials from `~/work/js/kw-chat/.env` as the secret source, create a fresh Discord test channel, and validate a bidirectional OMX workflow where Discord messages can drive an OMX/tmux session without adopting `kw-chat` as the long-term runtime surface.

## Problem Statement

The original idea was to piggyback on `kw-chat` because it already has Discord bot credentials and a mature Discord integration surface. That reduces bootstrap work, but it does not reduce long-term maintenance for Discord-driven agent workflows because the runtime would remain coupled to `kw-chat` behavior, routing, and session abstractions.

At the same time, the installed `oh-my-codex` runtime already contains:
- lifecycle notifications to Discord,
- reply-listener code that correlates Discord bot replies to tmux panes,
- rate limiting, authorized-user checks, and input sanitization.

The missing piece is an operator-friendly bootstrap path that:
1. reuses existing Discord secrets,
2. creates an isolated channel for testing,
3. writes OMX notification config in an isolated Codex home,
4. starts reply-listener reliably,
5. launches an OMX session inside tmux,
6. verifies the full roundtrip from Discord to tmux and back.

## Chosen Approach

### Approach A — `kw-chat` runtime reuse
Use `kw-chat` as the main Discord runtime and route Discord messages into Codex/App Server or Claude sessions.

**Pros**
- Existing Discord bot runtime and channel/thread abstractions.
- Existing approval/session UI already implemented.
- Fewer unknowns short-term.

**Cons**
- Does not reduce `kw-chat` maintenance burden.
- Preserves a parallel runtime instead of proving OMX as the operational surface.
- Harder to isolate OMX-specific failures from `kw-chat` behavior.

### Approach B — OMX-native thin bridge using `kw-chat` env as secret source **(chosen)**
Build a small local harness around the installed OMX runtime. The harness reads Discord credentials from `~/work/js/kw-chat/.env`, creates a dedicated test channel, writes `.omx-config.json` into an isolated `CODEX_HOME`, boots OMX reply-listener directly from installed OMX exports, and launches an OMX tmux session for Discord-driven interaction.

**Pros**
- Keeps `kw-chat` out of the runtime path while still reusing trusted credentials.
- Proves the OMX-native experience directly.
- Small maintenance surface: a few scripts plus docs.
- Easy to tear down and rerun in isolation.

**Cons**
- Requires a bootstrap wrapper because reply-listener is not exposed as a first-class CLI command in the current OMX build.
- Must create explicit verification for Discord channel lifecycle and session correlation.

### Approach C — Full custom Discord daemon
Write a new dedicated Discord service for OMX control.

**Pros**
- Maximum flexibility.

**Cons**
- Highest maintenance cost.
- Reinvents large parts of existing OMX/Discord behavior.
- Not justified for the current goal.

## Architecture

### High-level components

1. **kw-chat env loader**
   - Read `~/work/js/kw-chat/.env`.
   - Extract only Discord values needed for OMX test mode.
   - Never copy secrets into repo files.

2. **Discord test channel operator script**
   - Use Discord REST/Bot API with existing bot token + guild id.
   - Create a dedicated text channel for OMX testing.
   - Optionally delete/archive it during cleanup.

3. **Isolated OMX home/config generator**
   - Create an isolated Codex home directory under the current repo (or temp workspace).
   - Write `.omx-config.json` with:
     - `notifications.enabled = true`
     - `discord-bot` target set to the new channel
     - `notifications.reply.enabled = true`
     - `authorizedDiscordUserIds` set to the operator user id
     - event selection for `session-start`, `session-idle`, `ask-user-question`, `session-stop`, `session-end`
   - Preserve the global `~/.codex/config.toml` unless a later step explicitly needs a throwaway override.

4. **OMX reply-listener bootstrap**
   - Resolve installed `oh-my-codex` package root.
   - Import `getReplyConfig()` and `startReplyListener()` from OMX notification exports.
   - Start the daemon after config generation.
   - Surface PID/state/log paths for troubleshooting.

5. **OMX launch wrapper**
   - Launch `omx` inside tmux using the isolated `CODEX_HOME`.
   - Prefer `--notify-temp --discord` only if needed for temporary routing; otherwise use persistent `.omx-config.json` in the isolated home.
   - Record session metadata (tmux pane, channel id, codex home, log paths).

6. **Playwright MCP validation lane**
   - Use Playwright MCP against Discord Web.
   - Reuse a logged-in browser profile or storage state.
   - Validate bot message arrival, reply input, confirmation ack, and follow-up OMX lifecycle message.

## Data Flow

1. Operator runs bootstrap.
2. Bootstrap reads `kw-chat` env and creates a Discord test channel.
3. Bootstrap writes isolated OMX config and starts reply-listener.
4. Bootstrap launches OMX in tmux.
5. OMX sends Discord lifecycle message via Discord bot.
6. User replies to that bot message in Discord.
7. OMX reply-listener polls Discord, verifies user id, finds message correlation, and injects reply text into tmux pane.
8. OMX session processes the message and eventually emits another lifecycle event back to Discord.

## Security / Safety Rules

- Never write Discord secrets into committed files.
- Redact secrets in logs and summaries.
- Restrict reply injection to explicit `authorizedDiscordUserIds`.
- Use a dedicated test channel rather than the main `kw-chat` channel.
- Use an isolated `CODEX_HOME` so OMX config changes are reversible and local.
- Keep `kw-chat` as a read-only secret source for this experiment.

## Testing Strategy

### Layer 1 — Local unit tests
- Env parsing for `kw-chat` `.env` extraction.
- OMX config generation.
- Channel name generation / metadata handling.
- Installed OMX module resolution logic.

### Layer 2 — Local smoke tests
- Create channel successfully.
- Write isolated `.omx-config.json`.
- Start reply-listener and verify daemon state.
- Launch OMX in tmux with isolated `CODEX_HOME`.

### Layer 3 — Playwright MCP E2E
- Open Discord Web.
- Navigate to the created test channel.
- Observe bot lifecycle message.
- Reply to that message.
- Observe injection confirmation (`✅` reaction and/or “Injected into Codex CLI session.” reply).
- Observe follow-up OMX lifecycle message.

## Team Execution Plan

### Team 1 — Bridge / bootstrap lane
Owns:
- `scripts/omx-discord/*.ts`
- isolated config generation
- reply-listener bootstrap
- tmux/launch wrapper

### Team 2 — Discord ops lane
Owns:
- Discord test channel creation / cleanup
- env loading from `kw-chat`
- operator output / metadata capture

### Team 3 — Verification lane
Owns:
- daemon health checks
- session/log correlation
- failure triage and fallback guidance

### Team 4 — Playwright lane
Owns:
- Playwright MCP setup
- Discord Web scenario automation
- evidence capture (screenshots / traces / assertions)

### Team 5 — Final verifier lane
Owns:
- end-to-end acceptance evidence
- rollback / cleanup confirmation
- final operator runbook

## Open Questions Resolved

- **Use `kw-chat` runtime?** No. Only reuse env secrets.
- **Need a new Discord channel?** Yes. Dedicated test channel.
- **Need full bidirectional Discord → tmux?** Yes. That is the acceptance target.
- **Need Playwright-based validation?** Yes. Via Playwright MCP if available; local Playwright fallback only if MCP setup blocks.

## Acceptance Criteria

1. Bootstrap can create a dedicated Discord test channel using secrets from `~/work/js/kw-chat/.env`.
2. Bootstrap can produce an isolated OMX config without mutating the main `kw-chat` runtime.
3. Reply-listener can start successfully against the isolated config.
4. OMX can emit at least one Discord lifecycle message into the created test channel.
5. A reply from the authorized Discord user can be injected into the active tmux OMX session.
6. Playwright-based validation can prove the roundtrip with captured evidence.
7. Cleanup can stop the reply-listener and remove or clearly retire the test channel.
