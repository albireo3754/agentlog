# AgentLog — CLAUDE.md

Claude Code prompts를 Obsidian Daily Note에 자동 기록하는 로컬 CLI 도구.

## Spec

핵심 스펙 문서: `~/Obsidian/2026/agentlog/agentlog.md`
MVP 스펙: `~/Obsidian/2026/agentlog/agentlog-mvp.md`

## Project Structure

```
src/
  cli.ts              # 진입점: init / detect / doctor / open / uninstall / hook
  hook.ts             # Claude Code UserPromptSubmit hook (핵심)
  note-writer.ts      # Daily Note append 로직
  config.ts           # ~/.agentlog/config.json 관리
  detect.ts           # Obsidian vault 자동 탐지
  claude-settings.ts  # .claude/settings.json hook 등록/해제
  obsidian-cli.ts     # Obsidian CLI 연동 (daily note 경로)
  types.ts            # 공용 타입
  schema/             # zod 스키마
  __tests__/          # 단위 테스트

docs/
  metrics/            # 생산성 지표 (baseline + weekly snapshots)
  cc/                 # Claude Code hook 연동 문서
  obsidian/           # Obsidian CLI 연동 문서
```

## Dev Commands

```bash
bun run dev           # 로컬 실행
bun test              # 테스트
bun run typecheck     # 타입 체크
bun run build         # dist/ 빌드
```

## Key Conventions

- 런타임: Bun (primary), Node.js 18+ (fallback)
- hook은 `~/.agentlog/sessions/{date}.jsonl`에 append (JSON Lines)
- Daily Note 경로는 Obsidian CLI로 동적 조회 (`agentlog-cli daily:path`)
- `[agentlog]` 태그 라인만 관리, 수기 라인은 절대 건드리지 않음
- config: `~/.agentlog/config.json`

## Metrics Tracking

생산성 지표는 `docs/metrics/`에서 관리한다 (수기 markdown, 외부 서비스 없음).

- baseline 먼저 측정 → `docs/metrics/baseline/2026-03-baseline.md`
- 이후 매주 → `docs/metrics/weekly/2026-W__.md`
- README에 최신 수치 3줄 반영

지표 정의: `~/Obsidian/2026/agentlog/2026-03-06-agentlog-github-native-metrics-plan.md`

## Development Workflow

작업 순서: **Issue 발행 → feature 브랜치 → 작업/커밋 → Push → PR (base: develop)**

상세: `WORKFLOW.md` 참조

```bash
# 1. 이슈 발행
gh issue create --title "fix: ..." --label "bug"

# 2. 브랜치 (develop 기준)
git checkout -b fix/{issue}-{desc}

# 3. 검증 후 커밋
bun run typecheck && bun test
git commit -m "fix: ... (closes #N)"

# 4. Push → PR
git push -u origin fix/{issue}-{desc}
gh pr create --base develop --title "fix: ... (closes #N)"
```

## TODO

- [ ] `agentlog daily` 명령어 추가: `~/.agentlog/sessions/{날짜}.jsonl` 라인 수(prompts_captured)를 읽어 `docs/metrics/weekly/{week}.md`에 기록
