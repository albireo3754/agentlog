# AgentLog + Obsidian Quickstart

이 문서는 **agentlog 프로젝트에서 Obsidian Daily Note 자동 기록을 바로 실무에 적용**하기 위한 빠른 가이드입니다.

---

## 1) AgentLog 개요와 데이터 흐름

AgentLog는 Claude Code에서 입력한 프롬프트를 훅으로 받아 Daily Note에 자동 추가합니다.

```text
Claude Code prompt
  -> UserPromptSubmit hook
  -> agentlog hook (stdin JSON 파싱)
  -> note-writer append
  -> Obsidian Daily Note 기록
```

핵심 동작(구현 기준: `src/hook.ts`, `src/note-writer.ts`):

1. Claude Code가 `UserPromptSubmit` 이벤트를 발생시킴
2. `agentlog hook`이 stdin JSON에서 프롬프트를 읽음
   - 우선순위: `prompt` -> `message.content` -> `parts[].text`
3. 현재 시각(`HH:MM`)과 함께 프롬프트(최대 100자) 생성
4. 파일 경로 결정
   - Obsidian 모드: `{vault}/Daily/{YYYY-MM-DD-요일}.md`
   - Plain 모드: `{folder}/{YYYY-MM-DD}.md`
5. 기록 위치 결정
   - 타임블록이 있으면 해당 블록 하위에 삽입
   - 없으면 `## AgentLog` 섹션에 append

> 설계 원칙: 훅 오류가 나도 Claude Code 작업을 막지 않음(fail-silent).

---

## 2) 설치 전 요구사항

`README.md` 기준 필수 조건:

- **Claude Code** (Hook 이벤트 소스)
- **Obsidian** (Daily Note 대상, Obsidian 모드 사용 시)
- **Bun >= 1.0** (`bunx` 사용 시)
- **Node.js >= 20 + npm** (`npx` 사용 시)

권장 사전 확인:

```bash
node -v
bun -v
which agentlog
```

---

## 3) 초기 설정 (`init`, `--plain`, `detect`, `doctor`)

### 3-1. Vault 자동 탐지

```bash
agentlog detect
```

- 감지된 Obsidian vault 목록을 보여줍니다.
- 감지 실패 시 plain 모드 안내가 출력됩니다.

### 3-2. 일반(Obsidian) 모드 초기화

```bash
# npm
npx agentlog init ~/Obsidian

# bun
bunx agentlog init ~/Obsidian
```

`src/cli.ts` 기준 실제 수행:

- `~/.agentlog/config.json` 저장
- `~/.claude/settings.json`에 `UserPromptSubmit -> "agentlog hook"` 등록
- 대상 경로에 `.obsidian` 폴더가 없으면 초기화 실패(경고 출력)

### 3-3. Plain 모드 초기화 (`--plain`)

Obsidian 없이 일반 폴더에만 기록하려면:

```bash
npx agentlog init --plain ~/notes
```

- `.obsidian` 체크 없이 디렉터리 존재 여부만 확인
- 결과 파일: `~/notes/YYYY-MM-DD.md`

### 3-4. 설치/연결 상태 점검 (`doctor`)

```bash
agentlog doctor
```

점검 항목(`src/cli.ts`):

- binary(`which agentlog`)
- vault 설정/유효성
- Obsidian 앱 설치(macOS, plain 제외)
- hook 등록 여부(`~/.claude/settings.json`)

성공 시: `All checks passed.`

---

## 4) 동작 확인 체크리스트

아래 순서로 확인하면 대부분의 초기 이슈를 빠르게 잡을 수 있습니다.

- [ ] `agentlog doctor`가 성공한다.
- [ ] `~/.agentlog/config.json`에 원하는 경로가 저장되어 있다.
- [ ] `~/.claude/settings.json`의 `hooks.UserPromptSubmit`에 `agentlog hook`이 있다.
- [ ] Claude Code에서 프롬프트 1개를 입력한 뒤, 오늘 Daily Note에 라인이 추가된다.
- [ ] (타임블록 템플릿 사용 시) 해당 시간 블록 하위에 `- HH:MM ...` 라인이 추가된다.  
      *(현재 구현은 블록 체크박스 `[ ] -> [x]` 자동 변경 로직이 없다.)*

수동 훅 테스트(원인 분리용):

```bash
printf '{"hook_event_name":"UserPromptSubmit","session_id":"manual-test","cwd":"%s","prompt":"agentlog 수동 테스트"}' "$PWD" | agentlog hook
```

---

## 5) 문제 해결 FAQ

### Q1. 훅이 동작하지 않아요.

가장 먼저:

```bash
agentlog doctor
```

확인 포인트:

1. `binary` 실패면 `agentlog` 명령이 PATH에 없음
2. `hook` 실패면 `agentlog init <vault>`로 훅 재등록
3. `vault` 실패면 경로 재설정 필요
4. 훅은 fail-silent라 Claude Code UI에 오류가 크게 드러나지 않을 수 있음(터미널 stderr 확인)

---

### Q2. vault 경로 문제(.obsidian not found)가 나옵니다.

원인:

- `agentlog init` 기본 모드는 대상 폴더에 `.obsidian`이 있어야 함

해결:

```bash
agentlog detect
agentlog init /정확한/obsidian/vault/경로
```

Obsidian 미사용이면 plain 모드로 전환:

```bash
agentlog init --plain ~/notes
```

---

### Q3. plain 모드에서 왜 타임블록에 안 들어가나요?

정상 동작입니다.

- plain 모드는 타임블록 파싱을 하지 않습니다.
- `YYYY-MM-DD.md`에 `- HH:MM 프롬프트` 형태로 단순 append 합니다.

다시 Obsidian 타임블록 로직을 쓰려면:

```bash
agentlog init ~/Obsidian
```

---

## 구현 근거(SSOT)

- `README.md`
- `src/cli.ts`
- `src/hook.ts`
- `src/note-writer.ts`
