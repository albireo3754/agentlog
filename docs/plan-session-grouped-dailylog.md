# Plan: Session-Grouped Daily Log

## Goal

Daily Note의 `## AgentLog` 섹션을 세션(cwd) 기반으로 그룹핑하여
"도메인별 보기"와 "시간순 보기"를 동시에 지원한다.

---

## Hook에서 사용할 데이터

| 필드 | 소스 | 파생값 | 용도 |
|------|------|--------|------|
| `session_id` | stdin JSON | 앞 8자 short hash | 같은 세션 판별 (섹션 내 경계 표시) |
| `cwd` | stdin JSON | 표시명 규칙 적용 (아래 참고) | 섹션 헤더 제목 + 매칭 키 |
| `prompt` | stdin JSON | 앞 100자 | 엔트리 본문 |
| `time` | `new Date()` | `HH:MM` | 엔트리 타임스탬프 + 섹션 시작 시간 |

> `transcript_path`, `permission_mode`는 현재 스키마에만 추가 (이번 플랜에서 미사용)

### cwd 처리: 표시명과 매칭 키 분리

// cwd의 표시명은, 모든 경로는 현재 path + parrent path로 일반화 한다.

`cwd`는 전체 경로로 오기 때문에 **표시명**과 **매칭 키**를 분리한다.

| 역할 | 값 | 예시 |
|------|-----|------|
| 매칭 키 | 전체 `cwd` 경로 | `/Users/pray/worktrees/work-status-v5/gate` |
| 표시명 | 규칙으로 파생 (아래) | `work-status-v5/gate` |

**표시명 파생 규칙:**

```
모든 경우 → parent/basename (2단계 고정, 예외 없음)
```

| cwd | 표시명 |
|-----|--------|
| `/Users/pray/work/js/agentlog` | `js/agentlog` |
| `/Users/pray/work/kotlin/my-project` | `kotlin/my-project` |
| `/Users/pray/worktrees/feature-branch/app` | `feature-branch/app` |
| `/Users/pray/worktrees/refactor-auth/server` | `refactor-auth/server` |

**섹션 매칭:** 섹션 헤더에 `cwd` 전체 경로를 HTML 주석으로 삽입하여 재탐색 시 사용한다.

```markdown
#### agentlog · 10:53 <!-- /Users/pray/work/js/agentlog -->
#### work-status-v5/gate · 15:00 <!-- /Users/pray/worktrees/work-status-v5/gate -->
```

---

## 섹션 구조 설계

### 그룹핑 기준

- **1차 키: `cwd`** (프로젝트 단위로 섹션 생성)
- 같은 프로젝트에서 세션이 바뀌면 (`session_id` 변경) → 섹션 내 **세션 구분선** 삽입
- 같은 세션 내 연속 엔트리 → 그냥 append

### 최상단 고정 라인

파일 전체에서 **가장 마지막으로 기록된 엔트리**를 blockquote로 고정.
매번 덮어쓴다.

---

## 출력 샘플

```markdown
## AgentLog

> 🕐 17:32 — kotlin/my-project › API 응답에 초기 상태 포함하도록 수정

#### js/agentlog · 10:53 <!-- /Users/pray/work/js/agentlog -->
- 10:53 dailylog에 세션 구분 기능 추가 논의
- 11:07 plan 파일 작성

#### kotlin/my-project · 15:00 <!-- /Users/pray/work/kotlin/my-project -->
- 15:00 v5 subscribe 응답 설계
- 15:30 서버 gRPC 스펙 확인
- - - - (ses_f3a91c2e)
- 16:45 DTO 확장 작업
- 17:32 API 응답에 초기 상태 포함하도록 수정
```

### 섹션 헤더 형식

```
#### {project} · {첫 엔트리 시작 시간}
```

- `{project}` = `path.basename(cwd)` (e.g. `my-project`)
- `{첫 엔트리 시작 시간}` = 해당 프로젝트의 가장 이른 엔트리 시간

### 세션 구분선 형식

```
- - - - (ses_{session_id 앞 8자})
```

같은 프로젝트 섹션 내에서 `session_id`가 바뀔 때만 삽입.

### 엔트리 형식

```
- HH:MM prompt (100자 이내)
```

### 최신 엔트리 고정 라인 형식

```
> 🕐 HH:MM — {project} › {prompt}
```

---

## 파싱 로직 (note-writer.ts)

```
appendEntry(config, entry, date) 호출 시:

1. Daily Note 파일 읽기 (없으면 생성)
2. ## AgentLog 섹션 찾기 (없으면 파일 끝에 추가)
3. entry.project에 해당하는 #### 섹션 탐색
   - 없으면: 섹션 새로 생성 (기존 섹션들 뒤에 append)
   - 있으면:
     a. 마지막 엔트리의 sessionId 확인
     b. entry.sessionId 다르면 → 구분선 삽입 후 엔트리 append
     c. 같으면 → 엔트리 그냥 append
4. 최상단 > 🕐 라인 갱신 (있으면 교체, 없으면 blockquote 줄 삽입)
5. 파일 저장
```

---

## 변경이 필요한 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/schema/hook-input.ts` | `HookInput`에 `transcript_path?`, `permission_mode?` 필드 추가 |
| `src/types.ts` | `LogEntry`에 `sessionId: string`, `project: string` 추가 |
| `src/hook.ts` | `entry` 생성 시 `sessionId`, `project` 채우기 |
| `src/note-writer.ts` | `appendEntry` 섹션 관리 로직 전면 교체 |
| `src/schema/daily-note.ts` | `buildLogLine`, `buildSessionDivider`, `buildLatestLine` 헬퍼 추가 |

---

## 기존 타임블록과의 관계

- 기존 `- [ ] 23 - 24` 타임블록 **그대로 유지** (수동 계획/체크 용도)
- `## AgentLog` 섹션은 **자동 기록 전용** (별도 섹션)
- 타임블록에 자동 삽입하던 기존 동작은 **제거**

---

## 비고

- `session_id` short hash는 표시용 (구분선)이지 섹션 키가 아님. 섹션 키는 `project`
- 같은 날 같은 프로젝트를 10번 열어도 `####` 섹션은 1개
- `plain` 모드는 이번 변경 범위 밖 (현행 유지)
