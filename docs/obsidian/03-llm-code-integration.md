# Obsidian + LLM + 코드 연동 가이드

> 대상: AgentLog 기반 Claude Code 작업 로그를 Obsidian에 연결해 개발 루프를 자동화하려는 사용자

## 1) Claude Code Hook 기반 자동 로깅 구조 (현재 구현)

AgentLog의 현재 구조는 **Claude Code `UserPromptSubmit` Hook → 파일 직접 append** 방식이다.

```text
Claude Code Prompt
  → UserPromptSubmit hook
  → agentlog hook (src/hook.ts)
  → appendEntry (src/note-writer.ts)
  → {vault}/Daily/YYYY-MM-DD-요일.md
```

핵심 동작:

1. `agentlog init <vault>` 실행 시 `~/.claude/settings.json`에 `agentlog hook` 등록
2. Hook 실행 시 stdin JSON 파싱 (`parseHookInput`)
   - 우선순위: `prompt` → `message.content` → `parts[].text`
3. 현재 시각 `HH:MM` 생성 + 프롬프트 100자 truncate
4. Daily Note 경로 계산 후 append
   - 기본: `Daily/YYYY-MM-DD-요일.md`
   - `--plain`: `YYYY-MM-DD.md`
5. 실패 시 Claude Code를 막지 않고 종료(오류는 stderr만 기록)

현재 코드 기준 참고사항:

- timeblock 라인을 찾으면 해당 블록 아래에 로그 줄을 추가한다.
- README/일부 문서 설명과 달리, **체크박스 `[ ] → [x]` 자동 변경 로직은 현재 `src/note-writer.ts`에 구현되어 있지 않다.**
- `session_id`는 파싱되지만 노트에는 기록하지 않는다.

---

## 2) Obsidian REST API 기반 자동화 경로 (obs/obs-daily/obs-cmd/obs-open 스킬 관점)

AgentLog 코어는 파일 직접 쓰기지만, 운영 자동화는 Obsidian Local REST API(`http://localhost:27123`) 기반 스킬 체인으로 확장할 수 있다.

공통 전제:

- Obsidian 실행 중
- Local REST API 플러그인 활성화
- `Authorization: Bearer <API_KEY>` 사용

### 스킬별 역할

| 스킬 | 역할 | 대표 API |
|---|---|---|
| `obs` | 통합 라우터(`open`, `daily`, `cmd`) | `/open/*`, `/vault/*`, `/commands/*` |
| `obs-open` | 노트/경로 열기 | `POST /open/{path}` |
| `obs-daily` | Daily 열기/읽기/추가 | `POST /open/{daily}`, `GET/PUT /vault/{daily}` |
| `obs-cmd` | Obsidian 명령 실행/조회 | `GET /commands/`, `POST /commands/{id}/` |

권장 자동화 흐름:

1. Hook로 prompt 로그가 Daily에 누적됨
2. `/obs-daily --read`로 오늘 로그 확인
3. `/obs-cmd template` 또는 `/obs-cmd daily`로 회고 템플릿 호출
4. `/obs-open <프로젝트 노트>`로 다음 작업 노트로 전환

---

## 3) 코드 작업 루프 예시

```text
프롬프트 입력
→ Hook 자동 로그
→ Daily Note에서 타임블록/AgentLog 누적 확인
→ 하루 끝에 회고(문제/해결/다음 액션)
→ 다음 작업 프롬프트로 재시작
```

예시 시나리오:

1. Claude Code에 "에러 재현 테스트 추가" 프롬프트 입력
2. AgentLog가 `10:53 ...` 형태로 Daily Note에 자동 append
3. 점심 전 `/obs-daily --read`로 오전 로그 묶음 확인
4. 저녁에 회고 섹션 작성
   - 오늘 해결한 이슈
   - 막힌 포인트
   - 내일 첫 프롬프트 초안
5. 다음 날 첫 프롬프트를 회고 기반으로 입력해 컨텍스트 손실 최소화

---

## 4) 향후 확장안 (README Roadmap 기반)

README 기준 확장 로드맵:

1. **Phase 2: Obsidian Plugin UI**
   - Daily 로그 타임라인 시각화
   - 세션별 필터/탐색 UX 강화

2. **Phase 3: Git log integration**
   - 커밋 히스토리와 프롬프트 로그를 같은 Daily Note 축으로 병합
   - "무엇을 요청했고 어떤 코드가 커밋됐는지" 추적 강화

3. **Future: Session replay (`agentlog run`)**
   - JSONL 캡처 기반 재생/요약
   - 아키텍처 문서의 post-MVP 방향(캡처 → run → note write)과 연결

---

## 5) 보안/개인정보 체크리스트

### API 키

- Obsidian REST API 키는 비밀값으로 취급
- 문서/스크립트/커밋에 하드코딩 금지
- 로컬 환경변수 또는 안전한 로컬 설정 파일로 관리

### 로컬 Vault 데이터

- AgentLog는 로컬 vault 파일을 직접 수정하므로, 민감 vault 경로 사용 시 접근권한(파일 권한/백업 정책) 확인
- 원치 않는 폴더에 기록되지 않도록 `~/.agentlog/config.json`의 `vault` 경로 주기적 점검

### Hook stderr 처리

- 현재 훅은 "사용자 플로우 비차단"을 위해 에러를 stderr로만 남김
- 운영 환경에서 stderr를 외부 수집기로 전송한다면 민감 텍스트가 섞이지 않게 필터링 정책 필요
- 최소 권장: stderr 저장 범위/보관기간 제한, 공유 로그 마스킹

---

## 참고 근거 파일

- `README.md` (개요, 동작 흐름, Roadmap)
- `docs/architecture.md` (모듈 책임, post-MVP 구조)
- `docs/hook-integration.md` (Hook 입력/등록/에러 처리)
- `src/hook.ts`, `src/note-writer.ts`, `src/schema/hook-input.ts`, `src/schema/daily-note.ts`, `src/cli.ts`
- `/Users/pray/.codex/skills/obs/SKILL.md`
- `/Users/pray/.codex/skills/obs-daily/SKILL.md`
- `/Users/pray/.codex/skills/obs-cmd/SKILL.md`
- `/Users/pray/.codex/skills/obs-open/SKILL.md`
