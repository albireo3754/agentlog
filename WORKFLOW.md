# AgentLog — Development Workflow

## 작업 순서

### 1. GitHub Issue 발행

작업 전 반드시 이슈를 먼저 발행한다.

```bash
gh issue create \
  --title "fix: 설명 (#이슈번호 closes 예정)" \
  --body "..." \
  --label "bug"  # 또는 enhancement
```

- **bug**: 버그 수정
- **enhancement**: 기능 추가 / 개선
- **documentation**: 문서

이슈 번호를 확인해둔다.

---

### 2. Feature 브랜치 생성

이슈 번호와 짧은 설명을 브랜치명에 포함한다.

```bash
# develop 기준으로 분기
git checkout develop
git pull origin develop
git checkout -b fix/{issue-number}-{short-description}
# 예: fix/28-cli-daily-path-noise
# 예: feat/29-full-session-id
```

---

### 3. 작업 및 커밋

```bash
# 작업 후 커밋 (이슈 번호 참조)
git add <files>
git commit -m "fix: 설명 (closes #28)"
```

커밋 메시지 규칙:
- `fix:` — 버그 수정
- `feat:` — 기능 추가
- `refactor:` — 리팩토링
- `docs:` — 문서
- `test:` — 테스트

커밋 전 검증:
```bash
bun run typecheck
bun test
```

---

### 4. Push

```bash
git push -u origin fix/{issue-number}-{short-description}
```

---

### 5. PR 생성 (base: develop)

```bash
gh pr create \
  --base develop \
  --title "fix: 설명 (closes #28)" \
  --body "## Summary
- 변경 내용 bullet

Closes #28"
```

- base는 항상 **develop**
- 제목에 `closes #이슈번호` 포함 → PR merge 시 이슈 자동 close

---

## 브랜치 네이밍

| 유형 | 패턴 | 예시 |
|------|------|------|
| 버그 수정 | `fix/{issue}-{desc}` | `fix/28-cli-daily-path-noise` |
| 기능 추가 | `feat/{issue}-{desc}` | `feat/29-full-session-id` |
| 리팩토링 | `refactor/{issue}-{desc}` | `refactor/23-cli-architecture` |
| 문서 | `docs/{issue}-{desc}` | `docs/30-readme-update` |

## 브랜치 구조

```
main          ← 릴리즈
  └─ develop  ← 통합 (PR base)
       ├─ fix/28-cli-daily-path-noise
       ├─ feat/29-full-session-id
       └─ ...
```

---

## SCM 주의: GH_HOST

이 머신은 `GH_HOST=github.dktechin.in` 환경변수가 기본이라, agentlog의 `gh` 명령은
모두 `GH_HOST=github.com` 접두사를 붙여야 한다 (origin이 github.com이기 때문).

```bash
GH_HOST=github.com gh issue view 43
GH_HOST=github.com gh pr create --base develop ...
```

---

## TDD (test-first)

버그 수정·기능 추가는 **실패 테스트 먼저** 작성한다.

1. 재현/요구사항을 드러내는 테스트를 추가 → `bun test`로 **올바른 이유로 실패**(red) 확인
2. 통과시키는 **최소 구현**(green)
3. 필요 시 리팩토링 (테스트 green 유지)

---

## 검증 (커밋 전 필수)

```bash
bun run typecheck   # tsc --noEmit, exit 0
bun test            # 전체 green
```

둘 다 통과해야 커밋한다.

---

## 리뷰 (PR 전후 2단계)

작성과 리뷰는 분리한다 — 자기 코드를 자기가 승인하지 않는다.

1. **서브에이전트 리뷰**: `code-reviewer`(또는 OMC `oh-my-claudecode:code-reviewer`)에게
   diff를 넘겨 리뷰받고, 지적사항 반영.
2. **Copilot 리뷰**: PR 생성 후 Copilot 리뷰 요청 → 피드백 반영.

```bash
GH_HOST=github.com gh api repos/<owner>/agentlog/pulls/<PR#>/requested_reviewers \
  -X POST -f "reviewers[]=copilot-pull-request-reviewer[bot]"
```

---

## 머지

리뷰 반영 + CI green 후:

```bash
GH_HOST=github.com gh pr merge <PR#> --squash --delete-branch
```

- **squash** 머지 → develop fast-forward
- 머지 후 feature 브랜치(local + remote) 삭제, `git fetch --prune`
- PR 제목/본문의 `Closes #N`으로 이슈 자동 close 확인
