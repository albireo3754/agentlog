# Codex Host Integration Smoke Test Plan

> Scope: later host integration verification only. This document does not implement the test.

**Goal:** 실제 Codex CLI/TUI 세션에서 turn complete 시 `notify = ["agentlog", "codex-notify"]`가 자동 호출되는지 입증하는 host integration smoke test를 설계한다.

**Non-Goal:** `bun link` 설치 smoke, parser/unit test, 일반 CLI integration test, 실제 구현 변경.

## Goals

- 실제 Codex가 `agentlog codex-notify`를 자동 호출하는지 검증한다.
- 검증 대상은 "config에 등록됨"이 아니라 "Codex turn-complete 이벤트가 실제 notify 프로세스를 실행함"이다.
- 수동 검증과 이후 자동화 가능한 시나리오를 분리해서 정의한다.
- 검증 중 사용자 실제 vault와 설정을 오염시키지 않도록 disposable test vault 전략을 사용한다.

## Constraints

- 이 단계에서는 문서만 작성한다. 코드나 테스트는 추가하지 않는다.
- 실제 Codex host integration 검증은 환경 의존적이다.
- Codex가 사용하는 `notify` 호출 시점은 문서상 `agent-turn-complete` 기준이므로, prompt submit 직후가 아니라 turn 종료 후를 기준으로 판단한다.
- 실제 사용자 `~/Obsidian` 주력 vault는 기본 검증 대상에서 제외한다.
- 검증 실패 시, 원인이 AgentLog인지 Codex host/runtime인지 분리할 수 있는 신호를 함께 수집해야 한다.

## Required Prerequisites

호스트 통합 smoke를 실행하기 전에 아래가 준비되어 있어야 한다.

- `bun install` 완료
- 현재 작업 트리 기준 `agentlog` 실행 가능
- `bun link` 또는 동등한 방식으로 현재 작업 트리의 `agentlog` binary가 `PATH`에 노출됨
- Codex CLI가 설치되어 있고 `PATH`에서 실행 가능
- `agentlog init --codex <vault-or-notes-path>`가 이미 통과하는 상태
- `agentlog doctor`가 Codex 관련 체크를 통과하거나, 최소한 Codex binary/notify 관련 경고만 남는 상태
- disposable test vault를 만들 수 있는 파일시스템 권한

권장 추가 준비:

- 기존 `~/.codex/config.toml` 백업 확인
- 테스트 중 side effect 추적을 위한 임시 로그 디렉터리 준비
- turn-complete 확인이 쉬운 짧은 prompt 세트 준비

## Realistic Post-`bun link` Host Scenarios

이 섹션은 실제로 `bun link`를 마친 개발 환경에서 나올 법한 host integration 시나리오를 우선순위 순으로 정리한 것이다.

### Scenario H1: Config Registered, But Codex Never Calls Notify

증상:
- `agentlog init --codex <vault>`는 성공
- `~/.codex/config.toml`에 `notify = ["agentlog", "codex-notify"]`가 존재
- 하지만 실제 Codex 한 턴 이후 note가 생성되지 않음

의미:
- 등록 성공과 실제 host invocation은 별개라는 뜻
- host integration test에서 가장 먼저 확인해야 할 시나리오

확인 포인트:
- Codex turn이 실제로 완료되었는지
- 사용 중인 Codex 실행 모드가 `notify`를 지원하는지
- `config.toml`이 실제 Codex 프로세스가 읽는 HOME 아래에 있는지

### Scenario H2: Codex Calls Notify, But Linked `agentlog` Cannot Start

증상:
- `notify`는 호출된 것으로 보이지만 note가 안 생김
- stderr에 `env: bun: No such file or directory` 또는 유사한 실행 오류가 남음

의미:
- `agentlog` binary는 링크됐지만, shebang이 기대하는 `bun`을 Codex가 사용하는 PATH에서 찾지 못하는 상황

왜 현실적인가:
- 설치 smoke에서도 격리 PATH에 Bun binary 디렉터리를 명시적으로 넣지 않으면 같은 문제가 재현됐다

확인 포인트:
- Codex 세션의 PATH
- `command -v agentlog`
- `command -v bun`

### Scenario H3: Notify Runs, But Wrong Home/Config Is Used

증상:
- `agentlog codex-notify`는 실행되는 것 같지만 기대한 vault가 아니라 다른 곳에 기록됨
- 또는 `not initialized` 메시지가 뜸

의미:
- Codex가 보는 HOME과 사용자가 설정을 넣은 HOME이 다를 수 있음
- `~/.agentlog/config.json` 또는 `~/.codex/config.toml` 해석 위치가 엇갈린 상황

확인 포인트:
- Codex 프로세스의 HOME
- 실제 로드된 `config.json` 경로
- note가 예상 경로가 아니라 다른 디렉터리에 생기는지

### Scenario H4: Notify Runs, But Turn-Complete Timing Expectation Is Wrong

증상:
- prompt를 보낸 직후엔 note가 안 생겨 실패처럼 보임
- turn 종료 후에만 append 됨

의미:
- Codex `notify`는 prompt-submit이 아니라 `agent-turn-complete` 기준이므로, 관찰 시점이 잘못되면 false negative가 난다

확인 포인트:
- 응답 생성 도중과 완료 직후를 구분해 관찰
- note timestamp와 turn complete 시점을 비교

### Scenario H5: Notify Runs, But Note Path Resolution Surprises You

증상:
- vault 안에 note가 안 보인다고 생각했는데 다른 Daily folder에 기록됨

의미:
- non-plain 모드에서는 먼저 `obsidian daily:path`를 시도하고, 실패 시 `{vault}/Daily/...`로 fallback한다
- Obsidian CLI 상태에 따라 실제 기록 경로가 달라질 수 있다

확인 포인트:
- `agentlog doctor`의 CLI/app 상태
- 실제 note 경로가 `Daily/` fallback인지 CLI-resolved path인지

### Scenario H6: Single Turn Works, Multi-Turn Append Breaks

증상:
- 첫 turn은 기록되지만 두 번째 turn부터 누락되거나 중복됨

의미:
- host integration이 단발성으로만 검증되면 놓치기 쉬운 문제
- notify 호출 자체가 아니라 append/session grouping 경로의 버그일 수 있음

확인 포인트:
- 같은 세션 두 번
- 다른 prompt 두 번
- append 순서와 중복 여부

### Scenario H7: Notify Registration Is Overwritten By Another Tool

증상:
- 처음엔 동작했는데 나중에 `notify` 설정이 사라지거나 다른 명령으로 바뀜

의미:
- Codex 설정을 다른 도구나 수동 편집이 덮어쓴 상황

확인 포인트:
- `config.toml` snapshot 비교
- AgentLog reinstall 후 복구 여부
- 이전 `notify` 체인 복원 정보 보존 여부

## Disposable Test Vault Strategy

원칙:

- 고정 이름 vault를 쓰지 않는다.
- 매 실행마다 새 disposable vault를 만든다.
- 검증 종료 후 test vault와 관련 산출물을 삭제한다.

권장 구조:

```text
<tmp-root>/
  vault/
    .obsidian/
    Daily/
  logs/
  sentinels/
```

권장 생성 방식:

1. 임시 루트 디렉터리 생성
2. `<tmp-root>/vault/.obsidian` 생성
3. 필요 시 `<tmp-root>/vault/Daily` 선생성
4. `agentlog init --codex <tmp-root>/vault` 실행

이 전략의 목적:

- non-plain 경로 검증
- 실제 note append 여부 검증
- 실행 후 정리 가능

## Verification Model

이번 host integration smoke에서 입증해야 하는 사실은 아래 3단계다.

1. `agentlog init --codex ...`가 Codex 설정에 `notify`를 등록했다.
2. 실제 Codex turn complete가 외부 notify 프로세스를 실행했다.
3. 실행된 notify 프로세스가 AgentLog 기록 경로까지 도달했다.

따라서 성공 판단은 단일 신호가 아니라 복수 신호 조합으로 한다.

## Verification Signals

필수 신호:

- `~/.codex/config.toml`에 기대한 `notify` 등록 존재
- Codex 세션에서 한 턴 완료 후 note 파일이 실제로 생성되거나 append 됨
- append된 note 내용이 해당 turn의 마지막 user message와 일치함

강한 보조 신호:

- `agentlog codex-notify` 호출 흔적이 남는 sentinel 파일 또는 debug log
- note 파일 timestamp가 Codex turn complete 직후 갱신됨
- 동일 세션에서 두 번째 turn 후 note append가 누적됨

실패 분리에 유용한 보조 신호:

- Codex stdout/stderr 또는 세션 로그
- AgentLog 쪽 stderr/stdout 캡처
- `notify` forward chain이 있다면 forward 대상 side effect 로그

## Manual Scenario

이 시나리오는 사람이 직접 Codex를 조작해 "Codex가 실제로 notify를 호출한다"를 먼저 입증하는 기준 경로다.

### Scenario M1: Single Turn Proof

목적:

- turn complete 한 번으로 note append가 발생하는지 확인

절차:

1. disposable test vault 생성
2. 현재 작업 트리 기준으로 `agentlog`를 링크하거나 직접 실행 가능 상태 확인
3. `agentlog init --codex <disposable-vault>` 실행
4. `~/.codex/config.toml`에서 `notify = ["agentlog", "codex-notify"]` 확인
5. Codex를 disposable vault 또는 별도 테스트 cwd에서 실행
6. 짧은 단일 prompt 입력
   - 예: `reply with the word done`
7. Codex 응답이 끝날 때까지 대기
8. vault 내 해당 날짜 note 파일 생성/append 확인
9. 기록된 prompt가 방금 입력한 user message인지 확인

성공 기준:

- turn complete 후 note가 생성 또는 append됨
- 기록된 내용이 입력한 prompt와 일치함

실패 시 수집할 것:

- note 미생성 여부
- `config.toml`의 notify 값
- Codex 실행 cwd
- `agentlog doctor` 결과

### Scenario M2: Multi-Turn Proof

목적:

- turn이 반복될 때 notify가 매번 호출되는지 확인

절차:

1. M1 환경 재사용
2. 첫 turn 완료 후 note 상태 저장
3. 다른 prompt로 두 번째 turn 수행
4. note 파일이 두 번째 prompt까지 append 되었는지 확인

성공 기준:

- note에 두 번째 turn의 prompt가 추가됨
- 중복이나 첫 turn 재기록 없이 append 형태를 유지함

### Scenario M3: Turn-Complete Timing Check

목적:

- prompt submit 시점이 아니라 turn complete 시점에 기록되는지 확인

절차:

1. 약간 시간이 걸리는 prompt를 사용
2. 응답 생성 중 note 파일 변화를 관찰
3. 완료 직후에만 append 되는지 확인

성공 기준:

- 응답 중간이 아니라 완료 시점에 append 발생

## Automated Scenario Plan

이 시나리오는 나중에 host integration smoke를 자동화할 때 구현할 최소 범위다.

### Scenario A1: End-to-End Notify Invocation

개요:

- disposable vault 생성
- isolated HOME 또는 dedicated test HOME 준비
- `agentlog init --codex <vault>` 실행
- 실제 Codex를 non-interactive 또는 제어 가능한 방식으로 1-turn 실행
- note 파일 생성/append 확인

자동화에서 필요한 제어 포인트:

- Codex prompt 입력 방법
- turn 종료 감지 방법
- timeout 기준
- note 파일 경로 계산 방법

필수 assert:

- `config.toml` notify 등록 확인
- note 파일 존재
- note 파일에 expected prompt 포함

### Scenario A2: Repeated Turn Invocation

개요:

- 동일 환경에서 두 번의 turn을 순차 실행
- 두 번째 turn 후 note append가 누적되는지 확인

필수 assert:

- prompt 2개가 순서대로 기록됨
- duplicate installation이나 duplicate notify registration이 없음

### Scenario A3: Sentinel-Based Proof

개요:

- host automation에서 note append만으로는 원인 분리가 약할 수 있으므로, `agentlog codex-notify` 실행 직전에 side effect를 남기는 instrumentation 또는 wrapper 전략을 검토한다.

후보:

- wrapper notify binary가 호출 시간을 sentinel 파일에 기록
- AgentLog debug mode가 호출 payload를 별도 temp log에 기록

주의:

- 본 계획 단계에서는 instrumentation을 구현하지 않는다.
- 자동화 구현 시 "제품 코드 변경 없이 가능한지"를 먼저 평가한다.

## Exact Proof Criteria

Codex가 실제로 notify를 호출했다고 판단하려면 아래를 만족해야 한다.

- `notify` 등록이 config 파일에 존재한다.
- 실제 Codex turn이 완료되었다.
- turn 완료 직후 외부 side effect가 발생했다.
- 그 side effect가 `agentlog codex-notify` 경로와 연결된다.

최소 입증 조합:

- `config.toml` 확인
- note append 확인

권장 입증 조합:

- `config.toml` 확인
- note append 확인
- sentinel 또는 debug log 확인

## Cleanup

실행 종료 후 반드시 정리할 항목:

- disposable test vault 삭제
- 임시 note/log/sentinel 파일 삭제
- 테스트용 HOME을 사용했다면 해당 디렉터리 삭제
- 변경된 `~/.codex/config.toml` 복원 또는 테스트 HOME 폐기
- 필요 시 `agentlog uninstall --codex` 실행

실패 후에도 남겨야 할 항목:

- 실패 재현에 필요한 log/sentinel
- 최종 `config.toml` snapshot
- note 파일 snapshot

권장 정리 원칙:

- 성공 시 즉시 삭제
- 실패 시 조사 완료 전까지 보존

## Open Questions

- 실제 Codex turn을 자동화할 공식적이고 안정적인 non-interactive 경로가 있는가?
- host integration 자동화는 실제 사용자 HOME이 아닌 dedicated test HOME으로 충분한가?
- note append만으로 충분한가, 아니면 sentinel 기반 proof를 필수로 둘 것인가?
- turn-complete timing 검증을 자동화할 때 timeout과 polling 기준을 어떻게 둘 것인가?
- host smoke를 로컬 수동 명령으로만 둘지, 선택적 CI job으로 올릴지?
- 디버깅 편의를 위해 AgentLog에 일시적 debug logging flag가 필요한가?
