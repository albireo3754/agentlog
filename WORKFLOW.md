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
