# AgentLog

Auto-log Claude Code prompts to Obsidian Daily Notes.

AgentLog is a local-first Claude Code prompt logger for Obsidian. It captures every prompt you type in Claude Code and appends it to today's Daily Note, grouped by project and session.

Use it as a lightweight developer journal, worklog capture layer, or the first building block for richer Daily Notes automation.

```
npx agentlog init ~/Obsidian
```

That's it. Start using Claude Code and your Daily Note fills itself.

## What It Does

```
Claude Code prompt → UserPromptSubmit hook → Daily Note append
```

## Why AgentLog

- Local-first prompt logging with no external service required
- Obsidian Daily Notes integration that works with your existing vault
- Project and session grouping so prompts stay readable later
- Zero copy-paste overhead during normal Claude Code use

**Before:** You finish a 3-hour Claude Code session. Your Daily Note is empty.

**After:**

```markdown
## AgentLog
> 🕐 11:21 — js/agentlog › git init하고 vscode로 열어봐

#### 10:53 · js/agentlog
<!-- cwd=/Users/you/work/js/agentlog -->
- - - - [[ses_a1b2c3d4]]
- 10:53 agentlog 개발을 위해서 작업 진행
- 11:07 스펙 문서 열어봐
- - - - [[ses_e5f6a7b8]]
- 11:21 git init하고 vscode로 열어봐
```

| Element | Role |
|---------|------|
| `> 🕐 HH:MM — project › prompt` | Latest entry (always updated) |
| `#### HH:MM · project` | Project subsection (grouped by cwd) |
| `<!-- cwd=... -->` | Section matching key (Reading view에서 숨김) |
| `- - - - [[ses_...]]` | Session boundary (Obsidian wiki-link) |
| `- HH:MM prompt` | Individual log entry |

No manual logging. No copy-paste. No AI summarization overhead.

## Install

```bash
# With Bun
bunx agentlog init ~/path/to/vault

# With npm
npx agentlog init ~/path/to/vault
```

### Requirements

- [Claude Code](https://claude.ai/code) (hook integration)
- [Obsidian](https://obsidian.md) (Daily Note target)
- [Bun](https://bun.sh) (>=1.0.0) or [Node.js](https://nodejs.org) >=20

## Usage

### Setup

```bash
# Point to your Obsidian vault
agentlog init ~/Obsidian

# Or use any folder (no Obsidian required)
agentlog init --plain ~/notes
```

This does two things:
1. Creates `~/.agentlog/config.json` with your vault path
2. Registers a hook in `~/.claude/settings.json`

Run `agentlog init` without arguments to auto-detect installed vaults.

### That's It

Use Claude Code normally. Every prompt you type gets logged to your Daily Note.

### How It Works

1. You type a prompt in Claude Code
2. Claude Code fires the `UserPromptSubmit` hook
3. AgentLog reads the prompt from stdin and sanitizes it
4. Finds your Daily Note via `obsidian daily:path` (Obsidian CLI 1.12+), fallback: `{vault}/Daily/YYYY-MM-DD-요일.md`
5. Finds or creates a `## AgentLog` section
6. Finds or creates a `#### project` subsection matching the current working directory
7. Inserts a session divider `[[ses_...]]` if the session changed, then appends the entry
8. Updates the `> 🕐` latest-entry line at the top of the section

Total overhead: < 50ms per prompt. Fire-and-forget, never blocks Claude Code.

## Daily Note Format

### Obsidian Mode (default)

Daily Note 경로는 `obsidian daily:path` CLI 명령으로 동적 해석 (Obsidian 1.12+). Obsidian이 실행 중이 아니거나 CLI를 사용할 수 없으면 `{vault}/Daily/YYYY-MM-DD-요일.md`로 fallback.

Each working directory gets its own `#### project` subsection. Session changes insert a `[[ses_...]]` wiki-link divider. The `> 🕐` blockquote at the top always shows the latest entry across all projects.

```markdown
## AgentLog
> 🕐 14:30 — kotlin/message-gate › API 응답 수정

#### 10:53 · js/agentlog
<!-- cwd=/Users/you/work/js/agentlog -->
- - - - [[ses_a1b2c3d4]]
- 10:53 agentlog 개발을 위해서 작업 진행
- 11:07 스펙 문서 열어봐

#### 14:00 · kotlin/message-gate
<!-- cwd=/Users/you/work/kotlin/message-gate -->
- - - - [[ses_e5f6a7b8]]
- 14:00 API 응답 수정
- 14:30 테스트 실행
```

### Plain Mode

With `--plain`, entries go to `{folder}/YYYY-MM-DD.md`:

```markdown
# 2026-03-02
- 10:53 agentlog 개발을 위해서 작업 진행
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `agentlog init [vault] [--plain]` | Vault 경로 설정 + Claude Code hook 등록. 인자 없으면 자동 감지 |
| `agentlog detect` | 설치된 Obsidian vault 목록 + CLI 상태 표시 |
| `agentlog doctor` | 설치 상태 헬스체크 (binary, vault, hook, Obsidian CLI 등) |
| `agentlog open` | 오늘의 Daily Note를 Obsidian에서 열기 (CLI 1.12+ 필요) |
| `agentlog uninstall [-y]` | Hook 제거 + `~/.agentlog/` 삭제. `-y`로 확인 생략 |
| `agentlog hook` | Claude Code가 자동 호출 (사용자 직접 실행 X) |

## Configuration

`~/.agentlog/config.json`:

| Field | Default | Description |
|-------|---------|-------------|
| `vault` | (required) | Obsidian vault 또는 plain 폴더 경로 |
| `plain` | `false` | Plain 모드 (Obsidian 없이 단순 파일 기록) |

환경변수:

| Variable | Description |
|----------|-------------|
| `AGENTLOG_CONFIG_DIR` | Config 디렉토리 오버라이드 (기본: `~/.agentlog`) |
| `OBSIDIAN_BIN` | Obsidian CLI 바이너리 경로 오버라이드 |

## Uninstall

```bash
agentlog uninstall
```

Hook을 `~/.claude/settings.json`에서 제거하고 `~/.agentlog/`를 삭제합니다.

## Development

```bash
bun install
bun test              # 120 pass / 120 tests
bun run typecheck     # tsc --noEmit
bun run build         # compile to dist/ (optional)
```

`bin`이 `src/cli.ts`를 직접 가리키므로 개발 중 빌드 불필요 — Bun이 TypeScript를 네이티브 실행합니다.

```bash
# 글로벌 커맨드로 링크
bun link

# 소스 수정 → 즉시 반영
agentlog doctor

# Watch 모드
bun run dev:watch
```

## Roadmap

- **Phase 2:** Obsidian plugin with timeline visualization UI
- **Phase 3:** Git log integration (commits → Daily Note)
- **Future:** `agentlog run` command for session replay from JSONL captures

## License

MIT
