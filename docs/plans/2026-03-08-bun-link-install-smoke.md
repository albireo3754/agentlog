# Bun Link Install Smoke Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `bun link` 이후 실제 전역 `agentlog` 명령이 설치되고, `init --codex` 중심 설치 흐름이 격리된 환경에서 자동 검증되도록 한다.

**Architecture:** 기존 `bun test` 단위 테스트는 유지하고, 별도 설치 스모크 러너를 추가한다. 이 러너는 임시 `HOME`, 임시 `BUN_INSTALL`, 임시 `PATH`, fake `codex` binary를 사용해 사용자 실제 설정 파일을 건드리지 않으면서 `bun link -> agentlog 실행 -> 파일 결과 검증`까지 수행한다.

**Tech Stack:** Bun, TypeScript, `Bun.spawn`, macOS/zsh 환경, 기존 fixture (`src/__tests__/fixtures/codex-notify-single.json`)

---

## Scope

이 문서는 "설치가 실제로 잘 되었는지"를 확인하는 자동화 전략만 다룬다.

포함:
- `bun link` 후 `agentlog` 명령 노출 검증
- `agentlog init --codex --plain` 설치 성공 검증
- 생성 후 삭제하는 disposable test vault 기반 non-plain 설치 검증
- 생성된 `config.json`, `config.toml` 검증
- `agentlog codex-notify` 실제 파일 append 검증
- `agentlog uninstall --codex` 및 idempotency 검증
- 선택적 `doctor` 검증

제외:
- 실제 사용자 `~/Obsidian`, `~/.codex`, `~/.claude` 사용
- 실제 Claude Code hook 런타임 통합
- 실제 Obsidian GUI 실행 의존
- CI 기본 필수 단계로 host-dependent 검사 강제

## Design Decisions

### Decision 1: 기본 스모크 경로는 `--plain`

권장:
- `agentlog init --codex --plain <tmp-notes>`

이유:
- Obsidian 앱/CLI 상태 의존 제거
- 설치 검증의 핵심은 `bun link`, CLI 노출, config 생성, notify 동작이므로 plain mode가 가장 안정적

보조 경로:
- fake `.obsidian` 폴더를 둔 disposable test vault smoke를 추가
- vault 이름/경로는 고정하지 않고 매 실행마다 새로 만들고 마지막에 삭제한다

### Decision 2: 실제 글로벌 환경은 절대 사용하지 않음

필수 격리 변수:
- `HOME=<tmp-home>`
- `BUN_INSTALL=<tmp-bun-install>`
- `PATH=<tmp-bin>:<tmp-bun-install>/bin:$PATH`
- `AGENTLOG_CONFIG_DIR=<tmp-home>/.agentlog`

추가 원칙:
- 고정된 `agentlog-dev` 같은 테스트 vault 경로는 사용하지 않음
- 모든 non-plain smoke는 disposable vault를 만들고, 종료 시 정리한다

### Decision 3: `doctor`는 base success 조건이 아니라 secondary assertion

이유:
- `doctor`는 환경에 따라 `agentlog` binary, Obsidian CLI, Codex binary를 더 폭넓게 본다
- 설치 검증의 핵심은 생성 파일과 실행 경로이므로, `doctor`는 plain mode 설치 성공 뒤 추가 확인으로 둔다

### Decision 4: 설치형 smoke test는 `bun test`에 섞지 않음

원칙:
- `bun test`는 빠른 unit/integration loop로 유지
- 설치형 smoke는 별도 명령으로 분리
- 필요하면 상위 aggregator script에서 둘을 순차 실행

이유:
- `bun link`, `PATH`, `HOME`, `BUN_INSTALL`을 건드리는 테스트는 일반 test runner에 섞으면 느리고 flaky해지기 쉽다
- 실패 원인도 성격이 달라서 unit failure와 install failure를 분리해서 보는 편이 좋다

목표 실행 체계:
- `bun test` → 단위/통합 테스트
- `bun run test:install-smoke` → 격리된 설치 smoke
- `bun run test:install-host` → 선택적 host smoke
- 선택 시 `bun run test:all` → 위 명령들을 순차 실행

## Test Layers

### Layer 1: Existing unit tests

현 상태 유지:
- `bun test`

역할:
- parser/config/CLI branch 검증
- 빠른 개발 피드백 루프 유지

### Layer 2: New isolated install smoke

새 러너:
- `scripts/e2e-bun-link-smoke.ts`

역할:
- 실제 `bun link` 후 전역 명령 노출
- plain 설치/실행/제거 흐름 검증
- disposable test vault 기반 non-plain 설치 흐름 검증

실행 방식:
- `bun test`에 포함하지 않음
- 별도 script `bun run test:install-smoke`로 실행

### Layer 3: Optional host integration

추가 러너 또는 flag-gated mode:
- `scripts/e2e-bun-link-smoke.ts --host`

역할:
- 실제 `codex` binary 사용
- disposable test vault 기반 `init --codex <vault>` 확인
- 필요 시 실제 `doctor`까지 확인

기본값:
- 비활성

실행 방식:
- 기본 test 루프에 포함하지 않음
- 명시적으로 `bun run test:install-host`를 호출할 때만 실행

## Task 1: Add smoke runner scaffold

**Files:**
- Create: `scripts/e2e-bun-link-smoke.ts`
- Modify: `package.json`

**Step 1: Write the failing smoke contract**

러너가 다음 순서의 시나리오 이름을 출력하도록 test plan을 코드 주석으로 고정한다.

```ts
// 1. create temp dirs
// 2. create fake codex binary
// 3. run bun link in isolated env
// 4. verify `agentlog` resolves from PATH
// 5. run install flow
// 6. verify files
// 7. run notify flow
// 8. run uninstall flow
```

**Step 2: Add package script**

`package.json`에 추가:

```json
"test:install-smoke": "bun run scripts/e2e-bun-link-smoke.ts"
```

이 단계에서는 `bun test` 스크립트는 수정하지 않는다.

선택적 후속 script:

```json
"test:all": "bun test && bun run test:install-smoke"
```

**Step 3: Run the script to verify it fails**

Run:

```bash
bun run test:install-smoke
```

Expected:
- 파일이 아직 없으므로 `Module not found` 또는 명시적인 scaffold failure

**Step 4: Write minimal scaffold**

러너가 temp dir 생성과 환경 변수 출력까지만 하도록 최소 구현한다.

**Step 5: Re-run**

Run:

```bash
bun run test:install-smoke
```

Expected:
- temp root, temp home, temp bun install 경로를 출력하고 exit 0

**Step 6: Commit**

```bash
git add package.json scripts/e2e-bun-link-smoke.ts
git commit -m "test: scaffold bun link install smoke runner"
```

## Task 2: Prove `bun link` exposes `agentlog`

**Files:**
- Modify: `scripts/e2e-bun-link-smoke.ts`

**Step 1: Add failing assertion for `bun link`**

새 assertion:
- isolated env에서 `bun link` 실행 후 `command -v agentlog` 결과가 비어 있지 않아야 함

**Step 2: Run smoke to verify failure**

Run:

```bash
bun run test:install-smoke
```

Expected:
- `agentlog binary not found after bun link`

**Step 3: Implement minimal runner helpers**

추가 helper:

```ts
async function run(cmd: string[], env: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number }>
async function assertOk(result: Result, label: string): Promise<void>
```

실행 순서:
- temp bin dir 생성
- `bun link` 실행
- `command -v agentlog` 확인
- `agentlog --help` 실행

**Step 4: Re-run**

Expected:
- `agentlog` path가 `<tmp-bun-install>/bin/agentlog` 아래로 확인됨

**Step 5: Commit**

```bash
git add scripts/e2e-bun-link-smoke.ts
git commit -m "test: verify bun link exposes agentlog binary"
```

## Task 3: Verify `init --codex --plain` install path

**Files:**
- Modify: `scripts/e2e-bun-link-smoke.ts`

**Step 1: Add failing assertions**

새 assertion:
- fake `codex` binary가 있는 PATH에서
- `agentlog init --codex --plain <tmp-notes>` 실행 시 exit 0
- `<tmp-home>/.agentlog/config.json` 생성
- `<tmp-home>/.codex/config.toml` 생성

**Step 2: Run smoke to verify failure**

Expected:
- 아직 install step이 없으므로 config file missing failure

**Step 3: Implement minimal install flow**

러너에서:
- temp notes dir 생성
- fake `codex` executable 생성 (`#!/bin/sh\nexit 0`)
- `agentlog init --codex --plain <tmp-notes>` 실행
- 결과 파일 읽기

검증값:

```json
{
  "vault": "<tmp-notes>",
  "plain": true
}
```

`config.toml`에는 반드시 포함:

```toml
notify = ["agentlog", "codex-notify"]
```

**Step 4: Re-run**

Expected:
- install phase pass

**Step 5: Commit**

```bash
git add scripts/e2e-bun-link-smoke.ts
git commit -m "test: verify codex plain install via linked agentlog"
```

## Task 4: Verify `codex-notify` writes a real note

**Files:**
- Modify: `scripts/e2e-bun-link-smoke.ts`
- Reuse: `src/__tests__/fixtures/codex-notify-single.json`

**Step 1: Add failing assertion**

새 assertion:
- `agentlog codex-notify "$(cat fixture)"` 후 `<tmp-notes>/YYYY-MM-DD.md`가 생성되고 prompt text가 포함되어야 함

검증할 문자열:
- `Reply with exactly: OK`

**Step 2: Run smoke to verify failure**

Expected:
- note file missing

**Step 3: Implement notify phase**

러너에서:
- fixture 읽기
- `agentlog codex-notify <raw-json>` 실행
- 생성된 daily note 파일 탐색
- 내용 검증

**Step 4: Re-run**

Expected:
- notify phase pass

**Step 5: Commit**

```bash
git add scripts/e2e-bun-link-smoke.ts
git commit -m "test: verify linked codex notify writes note"
```

## Task 5: Verify uninstall and idempotency

**Files:**
- Modify: `scripts/e2e-bun-link-smoke.ts`

**Step 1: Add failing assertions**

새 assertion:
- `agentlog uninstall --codex` 후 `config.toml`에서 agentlog notify 제거
- `config.json`은 남아 있어야 함
- `agentlog init --codex --plain <tmp-notes>` 재실행 시 성공
- 재실행 후 `config.toml`에 notify가 1개만 있어야 함

**Step 2: Run smoke to verify failure**

Expected:
- uninstall 또는 재설치 검증 실패

**Step 3: Implement uninstall/reinstall phase**

러너에서:
- uninstall 실행
- 파일 내용 검증
- reinstall 실행
- `notify = ["agentlog", "codex-notify"]` occurrence count 확인

**Step 4: Re-run**

Expected:
- uninstall/idempotency pass

**Step 5: Commit**

```bash
git add scripts/e2e-bun-link-smoke.ts
git commit -m "test: verify uninstall and reinstall idempotency"
```

## Task 6: Add secondary `doctor` assertion

**Files:**
- Modify: `scripts/e2e-bun-link-smoke.ts`

**Step 1: Add failing assertion**

새 assertion:
- plain mode install 이후 `agentlog doctor` exit 0
- 출력에 `codex` line 포함

**Step 2: Run smoke to verify failure**

Expected:
- doctor output assertion mismatch

**Step 3: Implement doctor phase**

러너에서:
- install 직후 `agentlog doctor` 실행
- 다음 문자열 포함 확인:
  - `All checks passed.`
  - `codex`

주의:
- `hook`은 Codex-only install에서 warn-only여야 함

**Step 4: Re-run**

Expected:
- doctor phase pass

**Step 5: Commit**

```bash
git add scripts/e2e-bun-link-smoke.ts
git commit -m "test: verify doctor after codex-only linked install"
```

## Task 7: Add disposable test vault smoke

**Files:**
- Modify: `scripts/e2e-bun-link-smoke.ts`

**Step 1: Add failing assertion**

새 assertion:
- temp root 아래에 disposable vault dir 생성
- `<tmp-vault>/.obsidian` 생성
- `agentlog init --codex <tmp-vault>` 실행 시 exit 0
- `config.json`의 `plain`이 unset 이어야 함
- vault cleanup phase에서 `<tmp-vault>`가 삭제되어야 함

**Step 2: Run smoke to verify failure**

Expected:
- vault-mode install 또는 cleanup 검증 실패

**Step 3: Implement disposable vault phase**

러너에서:
- `mkdtemp`로 vault root 생성
- `.obsidian` 디렉터리 생성
- `agentlog init --codex <tmp-vault>` 실행
- 결과 config 검증
- 마지막 cleanup 단계에서 vault root 제거

주의:
- 고정 이름 금지
- `agentlog-dev` 같은 지속 경로 금지
- 실패 시에도 `finally`에서 cleanup 수행

**Step 4: Re-run**

Expected:
- disposable vault phase pass

**Step 5: Commit**

```bash
git add scripts/e2e-bun-link-smoke.ts
git commit -m "test: add disposable vault smoke for non-plain install"
```

## Task 8: Add optional host integration mode

**Files:**
- Modify: `scripts/e2e-bun-link-smoke.ts`
- Modify: `package.json`

**Step 1: Add failing gated mode**

새 실행 경로:

```json
"test:install-host": "bun run scripts/e2e-bun-link-smoke.ts --host"
```

**Step 2: Run without flag to confirm base smoke still works**

Expected:
- host path는 건너뛰고 base smoke만 수행

**Step 3: Implement host-only scenario**

조건:
- `--host` 인자 또는 `AGENTLOG_RUN_HOST_INSTALL_TESTS=1`

동작:
- disposable `.obsidian` test vault 생성
- 실제 `codex` binary를 PATH에서 사용
- `agentlog init --codex <tmp-vault>` 실행
- `doctor` 실행

**Step 4: Re-run host mode locally**

Run:

```bash
bun run test:install-host
```

Expected:
- 실제 개발 머신에서는 pass
- CI에서는 기본 비활성

**Step 5: Commit**

```bash
git add package.json scripts/e2e-bun-link-smoke.ts
git commit -m "test: add optional host install smoke mode"
```

## Task 9: Document the smoke workflow

**Files:**
- Modify: `README.md`

**Step 1: Add failing doc checklist**

README에 아래 문구를 넣을 위치를 정한다.
- install smoke는 사용자 real home을 사용하지 않음
- 기본 명령: `bun run test:install-smoke`
- 선택 명령: `bun run test:install-host`
- `bun test`에는 설치형 smoke를 섞지 않음

**Step 2: Update README**

개발 섹션에 추가:

```bash
bun run test:install-smoke
```

짧은 설명:
- `bun link` 기반 설치 경로를 temp HOME/BUN_INSTALL으로 검증

**Step 3: Re-run targeted checks**

Run:

```bash
bun run test:install-smoke
bun test
bun run typecheck
```

Expected:
- 모두 pass

**Step 4: Commit**

```bash
git add README.md package.json scripts/e2e-bun-link-smoke.ts
git commit -m "docs: add bun link install smoke workflow"
```

## Acceptance Criteria

- `bun run test:install-smoke` 하나로 `bun link` 이후 실제 `agentlog` 실행 경로를 검증할 수 있다.
- `bun test`만으로는 설치형 smoke가 실행되지 않고, 빠른 unit/integration 루프가 유지된다.
- 테스트는 실제 사용자 `HOME`, `~/.codex`, `~/.claude`, `~/.agentlog`를 오염시키지 않는다.
- `init --codex --plain`, `codex-notify`, `uninstall --codex`, 재설치 idempotency가 모두 자동 검증된다.
- disposable test vault 기반 non-plain 설치 경로도 자동 검증된다.
- base smoke는 Obsidian GUI 없이 안정적으로 실행된다.
- 선택적 host smoke는 실제 개발 머신에서 더 현실적인 검증을 제공하지만 기본값은 아니다.

## Open Questions For Review

1. disposable test vault smoke를 base smoke의 필수 단계로 넣을지, host mode로만 제한할지
2. `doctor`를 base smoke의 필수 success criterion으로 둘지, secondary assertion으로 유지할지
3. host mode를 별도 script로 분리할지, 같은 script의 flag로 둘지
4. `test:all` aggregator를 기본 제공할지, 개별 명령만 둘지
5. CI에서 `test:install-smoke`를 기본 필수로 올릴지, 로컬 검증 전용으로 둘지
