# OMX Discord Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an OMX-native Discord bridge harness that reuses Discord credentials from `~/work/js/kw-chat/.env`, creates a fresh Discord test channel, enables bidirectional Discord↔tmux OMX interaction, and validates the flow with Playwright MCP.

**Architecture:** Add a small script-based harness in this repo rather than extending `kw-chat` runtime behavior. The harness will (1) load Discord secrets from `kw-chat`, (2) create/manage a dedicated test channel, (3) generate an isolated OMX config home, (4) start the installed OMX reply-listener via exported runtime functions, (5) launch OMX in tmux with that isolated config, and (6) run Playwright MCP-based Discord Web verification.

**Tech Stack:** Bun, TypeScript, Node 20, installed `oh-my-codex` runtime, Discord REST/Bot API, tmux, Playwright MCP, existing local `kw-chat` `.env` file.

---

## Scope

포함:
- `kw-chat` `.env`에서 Discord secret 읽기
- 테스트용 Discord 채널 생성/정리
- 격리된 `CODEX_HOME` + `.omx-config.json` 생성
- OMX reply-listener 부트스트랩
- tmux 안에서 OMX 세션 실행
- Discord reply → tmux input injection 검증
- Playwright MCP로 Discord Web 시나리오 검증
- operator runbook / cleanup 문서화

제외:
- `kw-chat` 메인 런타임 리팩터링
- 글로벌 `~/.codex/config.toml` 영구 수정
- `oh-my-codex` upstream 자체 패치
- production-wide Discord channel migration

## Design Decisions

### Decision 1: `kw-chat`는 secret source만 사용
`~/work/js/kw-chat/.env`는 신뢰된 비밀 저장 위치로 취급하고, 실행 경로는 본 repo의 harness + installed OMX로 제한한다.

### Decision 2: 격리된 `CODEX_HOME` 사용
글로벌 `~/.codex` 대신 repo-local disposable home을 사용해 실험 side effect를 제어한다.

### Decision 3: reply-listener는 installed OMX export를 직접 호출
현재 `omx --help`에 reply-listener 관리 CLI가 드러나지 않으므로 bootstrap wrapper에서 runtime export를 직접 사용한다.

### Decision 4: Discord 검증은 새 테스트 채널에서만 수행
기존 `DISCORD_CHANNEL_ID`를 재사용하지 않고, 별도 채널을 생성해 실험 흔적을 격리한다.

### Decision 5: Playwright MCP를 우선 사용
Discord Web roundtrip은 브라우저 기반 검증이 가장 명확하므로 Playwright MCP를 1순위로 사용한다.

## Task Breakdown

### Task 1: Baseline context + operator metadata 정리

**Files:**
- Create: `.omx/context/omx-discord-bridge-20260314T000000Z.md`
- Modify: `docs/plans/2026-03-14-omx-discord-bridge.md`

**Step 1: Write the context snapshot**

Document:
- 목적: Discord↔OMX/tmux bidirectional bridge
- secret source: `~/work/js/kw-chat/.env`
- constraints: isolated `CODEX_HOME`, dedicated Discord channel, tmux required
- evidence: installed OMX exports, kw-chat Discord env availability, Playwright MCP target

**Step 2: Verify context file exists**

Run: `test -f .omx/context/omx-discord-bridge-20260314T000000Z.md`
Expected: exit code 0

**Step 3: Commit**

```bash
git add .omx/context/omx-discord-bridge-20260314T000000Z.md docs/plans/2026-03-14-omx-discord-bridge.md
git commit -m "docs: add omx discord bridge context"
```

### Task 2: kw-chat env reader + redacted summary

**Files:**
- Create: `scripts/omx-discord/kw-chat-env.ts`
- Create: `src/__tests__/kw-chat-env.test.ts`
- Modify: `tsconfig.json`

**Step 1: Write the failing test**

Test cases:
- loads `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`, `DISCORD_OWNER_ID` from a sample `.env`
- ignores unrelated keys
- prints redacted summary without exposing token values

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/kw-chat-env.test.ts`
Expected: FAIL because loader module does not exist

**Step 3: Write minimal implementation**

Implement:
- `loadKwChatDiscordEnv(path: string)`
- `redactDiscordEnvSummary(env)`
- strict error when required keys are absent (`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`)

**Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/kw-chat-env.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/omx-discord/kw-chat-env.ts src/__tests__/kw-chat-env.test.ts tsconfig.json
git commit -m "feat: add kw-chat discord env loader"
```

### Task 3: Discord test channel create/list/cleanup helper

**Files:**
- Create: `scripts/omx-discord/discord-channel.ts`
- Create: `src/__tests__/discord-channel.test.ts`
- Modify: `package.json`

**Step 1: Write the failing test**

Test cases:
- builds valid create payload for a test channel name
- validates required guild/token inputs
- builds cleanup target metadata without needing live Discord I/O

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/discord-channel.test.ts`
Expected: FAIL because helper module does not exist

**Step 3: Write minimal implementation**

Implement:
- Discord REST helper using `fetch`
- `createTestChannel({ token, guildId, name, topic })`
- `archiveOrDeleteTestChannel({ token, channelId })`
- stdout JSON output with redacted token handling

**Step 4: Add operator scripts**

Add npm/bun scripts:
- `bun run omx:discord:create-channel`
- `bun run omx:discord:cleanup-channel`

**Step 5: Run tests**

Run: `bun test src/__tests__/discord-channel.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add scripts/omx-discord/discord-channel.ts src/__tests__/discord-channel.test.ts package.json
git commit -m "feat: add discord test channel helper"
```

### Task 4: Isolated OMX home/config generator

**Files:**
- Create: `scripts/omx-discord/omx-home.ts`
- Create: `src/__tests__/omx-home.test.ts`
- Modify: `scripts/omx-discord/kw-chat-env.ts`

**Step 1: Write the failing test**

Test cases:
- creates isolated codex home path under repo-local workspace
- writes `.omx-config.json` with `discord-bot` and `reply` blocks
- stores `authorizedDiscordUserIds` and selected events
- never writes secrets into committed repo locations outside the generated workspace

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/omx-home.test.ts`
Expected: FAIL because generator module does not exist

**Step 3: Write minimal implementation**

Implement:
- `prepareOmxDiscordHome({ rootDir, discordChannelId, userId, token? })`
- create local workspace dir like `.omx/discord-bridge/<timestamp>/codex-home`
- write `.omx-config.json` using env or inline values as agreed by tests
- persist metadata JSON for cleanup/debug

**Step 4: Run tests**

Run: `bun test src/__tests__/omx-home.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/omx-discord/omx-home.ts src/__tests__/omx-home.test.ts scripts/omx-discord/kw-chat-env.ts
git commit -m "feat: generate isolated omx discord home"
```

### Task 5: Installed OMX reply-listener bootstrap wrapper

**Files:**
- Create: `scripts/omx-discord/omx-reply-listener.ts`
- Create: `src/__tests__/omx-reply-listener.test.ts`
- Modify: `package.json`

**Step 1: Write the failing test**

Test cases:
- resolves installed `oh-my-codex` package root
- imports notification module entrypoint path safely
- returns actionable error when OMX package is missing
- builds start/status/stop wrapper calls without touching the real daemon during unit tests

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/omx-reply-listener.test.ts`
Expected: FAIL because wrapper does not exist

**Step 3: Write minimal implementation**

Implement wrappers:
- `resolveInstalledOmxPackageRoot()`
- `loadOmxNotificationModule()`
- `startOmxReplyListener(config)`
- `getOmxReplyListenerStatus()`
- `stopOmxReplyListener()`

Expose CLI entrypoints:
- `bun run omx:discord:start-listener`
- `bun run omx:discord:listener-status`
- `bun run omx:discord:stop-listener`

**Step 4: Run tests**

Run: `bun test src/__tests__/omx-reply-listener.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/omx-discord/omx-reply-listener.ts src/__tests__/omx-reply-listener.test.ts package.json
git commit -m "feat: add omx reply listener wrapper"
```

### Task 6: OMX tmux launch wrapper + run manifest

**Files:**
- Create: `scripts/omx-discord/launch.ts`
- Create: `src/__tests__/omx-launch.test.ts`
- Create: `.omx/context/omx-discord-runbook.md`
- Modify: `package.json`

**Step 1: Write the failing test**

Test cases:
- generates launch env with isolated `CODEX_HOME`
- rejects launch when not inside tmux
- records tmux pane/session metadata into a run manifest

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/omx-launch.test.ts`
Expected: FAIL because launch wrapper does not exist

**Step 3: Write minimal implementation**

Implement:
- `launchOmxDiscordSession({ codexHome, prompt, reasoning })`
- verify `$TMUX`
- spawn `omx` with isolated env
- write run manifest containing tmux pane/session, channel id, codex home path, listener pid, and timestamps

Add operator script:
- `bun run omx:discord:launch -- "<prompt>"`

**Step 4: Run tests**

Run: `bun test src/__tests__/omx-launch.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/omx-discord/launch.ts src/__tests__/omx-launch.test.ts .omx/context/omx-discord-runbook.md package.json
git commit -m "feat: add omx discord launch wrapper"
```

### Task 7: Bootstrap orchestrator end-to-end smoke

**Files:**
- Create: `scripts/omx-discord/bootstrap.ts`
- Create: `src/__tests__/omx-bootstrap.test.ts`
- Modify: `package.json`

**Step 1: Write the failing test**

Test cases:
- bootstrap calls env loader, channel create, home generator, listener start, and launch in the correct order
- bootstrap emits machine-readable manifest path
- bootstrap supports dry-run mode

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/omx-bootstrap.test.ts`
Expected: FAIL because bootstrap orchestrator does not exist

**Step 3: Write minimal implementation**

Implement a single entrypoint:
- `bun run omx:discord:bootstrap -- --dry-run`
- `bun run omx:discord:bootstrap -- --prompt "hello from discord bridge"`

Output:
- channel metadata
- codex home path
- listener status
- tmux launch manifest path

**Step 4: Run tests**

Run: `bun test src/__tests__/omx-bootstrap.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/omx-discord/bootstrap.ts src/__tests__/omx-bootstrap.test.ts package.json
git commit -m "feat: add omx discord bootstrap orchestrator"
```

### Task 8: Playwright MCP setup + Discord Web validation plan

**Files:**
- Create: `docs/plans/2026-03-14-omx-discord-playwright-e2e.md`
- Create: `docs/ops/omx-discord-playwright.md`
- Modify: `.codex/config.toml` (or documented local MCP add command only; do not commit secrets)

**Step 1: Write the test scenario document**

Document:
- Discord Web login strategy
- channel navigation
- bot lifecycle message detection
- reply interaction
- inject confirmation assertion
- follow-up lifecycle assertion
- screenshot evidence checkpoints

**Step 2: Register Playwright MCP locally**

Run: `codex mcp add playwright npx "@playwright/mcp@latest"`
Expected: Playwright MCP server registered locally

**Step 3: Verify MCP availability**

Run: `codex mcp list`
Expected: `playwright` entry visible

**Step 4: Commit docs only**

```bash
git add docs/plans/2026-03-14-omx-discord-playwright-e2e.md docs/ops/omx-discord-playwright.md
git commit -m "docs: add omx discord playwright verification plan"
```

### Task 9: Team execution lane assignment

**Files:**
- Modify: `docs/plans/2026-03-14-omx-discord-bridge.md`
- Create: `.omx/context/omx-discord-team-launch.md`

**Step 1: Write team task split**

Document exact lane ownership:
- Lane A: env + channel ops
- Lane B: omx config + listener wrapper
- Lane C: tmux launch + manifests
- Lane D: Playwright MCP validation
- Lane E: verifier / cleanup

**Step 2: Define team launch hints**

Add concrete launch examples:
```bash
omx team 3:executor "Implement Task 2-4 from docs/plans/2026-03-14-omx-discord-bridge.md"
omx team 2:test-engineer "Implement Task 8 from docs/plans/2026-03-14-omx-discord-bridge.md"
```

**Step 3: Commit**

```bash
git add docs/plans/2026-03-14-omx-discord-bridge.md .omx/context/omx-discord-team-launch.md
git commit -m "docs: add omx discord team execution split"
```

## Verification Checklist

- `bun test` for all newly added focused tests
- `bun run omx:discord:bootstrap -- --dry-run`
- live bootstrap against Discord test channel
- listener status confirms running daemon
- tmux pane receives injected reply
- Discord shows confirmation reply/reaction
- Playwright MCP captures the roundtrip on Discord Web
- cleanup stops listener and retires test channel

## Risks and Mitigations

### Risk 1: installed OMX package path varies
Mitigation: resolve with `npm root -g` + explicit existence checks; fail with actionable path diagnostics.

### Risk 2: reply-listener daemon start path is unstable
Mitigation: wrap exported runtime functions rather than shelling into undocumented internals.

### Risk 3: Discord Web login blocks Playwright MCP
Mitigation: use a pre-authenticated browser profile or storage-state and keep MCP scenario focused on the test channel only.

### Risk 4: accidental mutation of main Codex config
Mitigation: require isolated `CODEX_HOME` in all bootstrap/launch paths and assert it in tests.

### Risk 5: Discord rate-limit / stale message correlation
Mitigation: dedicated test channel, authorized user filter, run manifest + listener logs + bounded smoke loops.

## Team Roster Recommendation

- `architect` — validate bridge boundaries and isolation rules
- `executor` x2 — build env/channel + listener/launch lanes in parallel
- `test-engineer` — Playwright MCP and smoke verification
- `verifier` — final end-to-end proof and cleanup confirmation

## Suggested Team Launch

```bash
omx team 4:executor "Implement docs/plans/2026-03-14-omx-discord-bridge.md Tasks 2-7 in parallel lanes, preserving isolated CODEX_HOME and kw-chat env reuse"
omx team 2:test-engineer "Implement docs/plans/2026-03-14-omx-discord-bridge.md Task 8 and collect Discord Web evidence"
```
