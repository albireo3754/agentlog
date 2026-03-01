# 02) DailyLog 설정과 명령어

> 이 문서는 **두 층위**를 분리해 설명합니다.
>
> - **현재 repo 구현 (`agentlog` CLI)**: Claude 프롬프트를 Daily Note에 즉시 append
> - **운영 스킬 워크플로 (`/dailylog`)**: Claude 대화 로그를 분석해 타임블록 요약/피드백 생성

---

## 1. `/dailylog` 명령 사용법 (운영 스킬 워크플로)

`/Users/pray/.codex/skills/dailylog/SKILL.md` 기준:

```bash
/dailylog
/dailylog --full
/dailylog --no-fill
/dailylog 2026-02-20
/dailylog --window 10-12
/dailylog 2026-02-20 --full --window 09-12
```

### 옵션 의미

- `/dailylog`  
  - 기본 모드: 타임블록 채움 + 1줄 요약
- `--full`  
  - 타임블록 + 피드백 전체(패턴 분석/개선 질문/Claude 질문) 생성
- `--no-fill`  
  - 타임블록 수정 없이 피드백만 생성
- `날짜` (예: `2026-02-20`)  
  - 대상 날짜 지정 (미지정 시 오늘)
- `--window HH-HH` (예: `10-12`, `09-12`)  
  - 해당 시간대 질문만 분석/반영 (끝 시간은 제외 범위)

> **구분 중요**: `/dailylog`는 `agentlog` 바이너리 명령이 아니라, Codex/OMX 쪽 **운영 스킬 명령**입니다.

---

## 2. `agentlog` CLI와 dailylog의 관계

| 명령 | 현재 repo 구현 | dailylog와 관계 |
|---|---|---|
| `agentlog init [vault] [--plain]` | vault 설정 저장 + `~/.claude/settings.json`에 `agentlog hook` 등록 | `/dailylog`가 활용할 Daily Note/로그 운영의 기본 토대 준비 |
| `agentlog detect` | Obsidian vault 자동 탐지 | init 전에 대상 vault 결정용 |
| `agentlog doctor` | binary/vault/obsidian/hook 상태 점검 | `/dailylog` 실행 전 로깅 파이프 정상 여부 점검 |
| `agentlog uninstall` | hook/config 제거 | 이후 자동 수집 중단(신규 데이터 축적 감소) |
| `agentlog hook` | UserPromptSubmit stdin을 읽어 Daily Note에 기록 | `/dailylog` 이전 단계의 원천 입력 축적 역할 |

### 핵심 정리

- **현재 repo에는 `/dailylog` 구현이 없음**
- 이 repo는 **수집/기록(agentlog)** 담당
- `/dailylog`는 **사후 분석/정리(운영 스킬)** 담당

---

## 3. Daily Note 파일명/타임블록 규칙 (이 프로젝트 기준)

### 3.1 파일명 규칙

### 현재 repo 구현

- Obsidian 모드: `{vault}/Daily/YYYY-MM-DD-요일.md`
  - 예: `2026-03-01-일.md`
- Plain 모드: `{vault}/YYYY-MM-DD.md`

### 운영 스킬 워크플로

- 분석 입력 로그: `Daily/{날짜}-{요일}-claude.md`, `Daily/{날짜}-{요일}-claude-silba.md`
- 반영 대상: `Daily/{날짜}-{요일}.md`

### 3.2 타임블록 규칙

`src/schema/daily-note.ts` 기준:

- 새벽: `00 - 02`, `02 - 04`, `04 - 06`, `06 - 08`
- 오전: `08 - 09`, `09 - 10`, `10 - 12`, `12 - 13`
- 오후: `13 - 15`, `15 - 17`
- 저녁: `17 - 19`, `19 - 21`, `21 - 23`, `23 - 24`

시간 매핑은 **start 포함 / end 제외**입니다. (예: 10:53 → `10 - 12`)

### 3.3 라인 형식 차이

- **현재 repo 구현**: `  - HH:MM {prompt(최대 100자)}`
- **운영 스킬 워크플로**: `  - [dailylog] {session_id}: {요약}`

---

## 4. 재실행(idempotent)과 수동 메모 보호 규칙

### 4.1 운영 스킬 워크플로 (`/dailylog`)

- 블록 내 기존 `- [dailylog] ...` 라인만 교체
- `[dailylog]` 접두어 없는 수동 메모는 수정/삭제 금지
- 같은 날짜/같은 윈도우로 재실행해도 결과가 중복 누적되지 않도록 설계(idempotent)

### 4.2 현재 repo 구현 (`agentlog hook`)

- append-only 동작
- 동일 입력 재실행 시 동일 라인이 **중복 추가될 수 있음** (dedup 없음)
- 기존 수동 메모를 직접 수정/삭제하지는 않음

---

## 5. 운영 팁

1. **창(세션) 분리 운영**  
   - 업무 주제별로 터미널/세션을 나누면 `/dailylog` 세션 그룹 요약 품질이 좋아집니다.

2. **시간대(타임존) 고정**  
   - `agentlog hook`의 `HH:MM`은 실행 머신 로컬 시간 기준입니다.  
   - 해외/원격 환경이면 OS 타임존을 먼저 맞추고, 필요 시 `/dailylog YYYY-MM-DD`로 날짜를 명시하세요.

3. **`--window`로 블록 단위 운영**  
   - 점심 전/퇴근 전 등 마감 시점에 `--window`를 사용하면 해당 구간만 빠르게 정리할 수 있습니다.

4. **반복질문 패턴 분석 활용**  
   - `/dailylog --full` 또는 `/dailylog --no-fill`로 반복/무의미 질문 패턴을 확인하고, 다음 지시 문장을 더 구체화하세요.

5. **실무 권장 루틴**  
   - 시작: `agentlog doctor`  
   - 작업 중: hook 자동 수집  
   - 마감: `/dailylog` 또는 `/dailylog --full`
