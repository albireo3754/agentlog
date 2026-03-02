# 06) Obsidian 공식 CLI 조사 (Local REST API 대체 관점)

- 작성일: 2026-03-01
- 범위: AgentLog 프로젝트에서 `Local REST API` 중심 자동화를 `Obsidian 공식 CLI` 중심으로 전환할 수 있는지 조사
- 기준: **공식 문서/공식 changelog 우선**, 보조로 기존 Local REST API 레포 참고

---

## TL;DR

- **결론(권장):** AgentLog 문서/운영 자동화는 **CLI 우선**이 맞다.
- 다만, 모든 사용자에게 자동으로 되는 건 아니고 아래 전제가 필요하다.
  1. Obsidian 데스크톱 앱 버전/설치본 최신화
  2. Settings에서 CLI 활성화 + OS별 등록(PATH/symlink)
  3. Obsidian 앱 실행 상태
- HTTP 엔드포인트가 꼭 필요한 통합(원격 호출, 웹훅, 외부 서비스 pull/push)은 Local REST API를 보조로 유지.

---

## 1. 최신 상태(날짜 기준 정리)

### 1.1 공식 CLI 도입 시점

- 2026-02-10 공개된 `Desktop 1.12.0 (catalyst)` changelog에서 CLI가 신규 기능으로 소개됨.
- 2026-02-27 공개된 `Desktop 1.12 (public)` changelog에서도 CLI가 핵심 신규 기능으로 명시됨.

즉, **2026-03-01 시점 기준으로는 “실험적 컨셉”이 아니라 public 릴리스 라인에 포함된 기능**으로 보는 게 타당하다.

> 추론 근거: changelog의 날짜/채널(early access → public) 순서.

### 1.2 문서 상태 주의

`help.obsidian.md/cli`에는 early access/Catalyst 관련 문구가 일부 남아있고, 동시에 troubleshooting에는 installer `1.12.4+` 요구가 명시되어 있다.

- 운영 판단은 **help 문구 단편보다 changelog + 현재 앱 버전**으로 최종 확인하는 것을 권장.

---

## 2. 공식 CLI 사용 전제 조건

공식 문서 기준 핵심 조건:

1. Obsidian 앱에서 `Settings → General → Command line interface` 활성화
2. CLI 등록 절차 수행(OS별 PATH/symlink 처리)
3. Obsidian 앱 실행 상태 필요 (첫 커맨드가 앱을 띄울 수 있음)
4. installer 버전 업데이트가 필요한 경우 있음

OS별 포인트(문서 기준):
- macOS: `~/.zprofile` PATH 등록 확인
- Linux: `/usr/local/bin/obsidian` symlink(또는 `~/.local/bin` fallback)
- Windows: redirector/installer 관련 추가 요구사항 확인 필요

---

## 3. 기능 범위: REST API 없이도 가능한 것

공식 CLI 문서에서 확인되는 주요 범주:

- 일반 제어: `help`, `version`, `reload`, `restart`
- Daily: `daily`, `daily:read`, `daily:append`, `daily:prepend`, `daily:path`
- 검색/파일: `search`, `read`, `create`, `rename` 등
- 명령 팔레트: `commands`, `command id=...` (플러그인 등록 명령 포함)
- 작업/태그: `tasks`, `task`, `tags`, `tag`
- 개발자 자동화: devtools, screenshot, plugin reload, eval/CDP 계열

즉, 3번 문서에 있던 REST API 기반 `open/read/command` 흐름 상당수는 CLI로 대체 가능.

---

## 4. Local REST API vs 공식 CLI 비교

| 항목 | Obsidian 공식 CLI | Local REST API 플러그인 |
|---|---|---|
| 제공 주체 | Obsidian 공식 | 커뮤니티 플러그인 |
| 접근 방식 | 로컬 프로세스/터미널 명령 | HTTPS + API Key 엔드포인트 |
| 설치 의존성 | Obsidian 앱 + CLI 등록 | 커뮤니티 플러그인 설치/활성화 |
| 원격 통합 적합성 | 낮음(로컬 셸 중심) | 높음(HTTP 연동 쉬움) |
| 보안 표면 | 로컬 명령 권한 중심 | 네트워크/API key 노출면 존재 |
| 개발자 자동화 | 강함(명령/디버그/TUI) | 강함(HTTP 호출/외부 서비스 연동) |

보안 측면에서 Obsidian 공식 문서는 커뮤니티 플러그인에 대해 “권한 제한이 본질적으로 제한적”이고 신뢰 검증이 필요하다고 안내한다. 따라서 **가능하면 공식 기능 우선**이 보수적이다.

---

## 5. AgentLog 기준 실무 권장안

### 5.1 현재 구조와의 관계

- AgentLog 핵심(`agentlog hook`)은 이미 파일 직접 쓰기라 REST API 의존이 없다.
- 영향 범위는 주로 문서/운영 자동화 레이어(`obs`, `obs-daily`, `obs-cmd`, `obs-open`류)다.

### 5.2 권장 전략

1. **기본 경로: 공식 CLI 우선**
   - Daily 열기/읽기/추가, 명령 실행, 검색은 CLI로 표준화
2. **예외 경로: REST API 보조 유지**
   - 웹훅/외부 서버에서 HTTP로 호출해야 하는 경우만 유지
3. **서버/CI 무GUI 요구 시**
   - CLI 대신 `Obsidian Headless` 검토 (Node 22+, Sync 구독 필요)

---

## 6. 마이그레이션 매핑 (기존 REST 문서 → CLI)

| 기존(REST 사고방식) | CLI 대체 예시 |
|---|---|
| 오늘 Daily 열기 | `obsidian daily` |
| 오늘 Daily 내용 읽기 | `obsidian daily:read` |
| 오늘 Daily에 텍스트 추가 | `obsidian daily:append content="..."` |
| 특정 명령 실행 | `obsidian command id="..."` |
| 명령 목록 조회 | `obsidian commands` |
| vault 검색 | `obsidian search query="..."` |
| Daily 경로 확인 | `obsidian daily:path` |

> 참고: 실제 명령/파라미터는 1.12.x에서 빠르게 변경된 이력이 있으니, 도입 시점에 `obsidian help`로 재검증 필요.

---

## 7. 운영 리스크 및 완화

1. **문서/릴리스 불일치 리스크**
   - 완화: changelog 날짜 + 로컬 `obsidian version` + `obsidian help` 3중 확인
2. **초기 1.12.x 구간의 CLI 변경 속도**
   - 완화: 팀 표준 최소 버전 고정(예: 1.12.4+), 명령 스모크 테스트 유지
3. **앱 실행 의존**
   - 완화: 자동화 스크립트 시작 시 앱 상태 확인 또는 첫 커맨드로 기동 유도
4. **원격 자동화 공백**
   - 완화: HTTP 필요 작업만 REST API fallback 경로 유지

---

## 8. 도입 체크리스트 (팀 표준)

- [ ] Obsidian 데스크톱 최신 installer 적용
- [ ] `Settings > General > Command line interface` 활성화
- [ ] `obsidian help` 정상 출력
- [ ] `obsidian daily:path` / `daily:read` / `daily:append` 스모크 테스트 통과
- [ ] 문서 03의 REST 예시를 CLI 우선 예시로 단계적 대체
- [ ] HTTP 필수 연동만 REST API 잔존 근거 문서화

---

## 9. 참고 레퍼런스

### 공식(우선)

1. Obsidian CLI (Help)  
   https://help.obsidian.md/cli
2. Obsidian 1.12.0 Desktop (Early access) — CLI 도입  
   https://obsidian.md/changelog/2026-02-10-desktop-v1.12.0/
3. Obsidian 1.12 Desktop (Public) — CLI public 릴리스 라인 포함  
   https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/
4. Obsidian 1.12.1 Desktop (EA) — CLI 파라미터/`daily:prepend` 수정  
   https://obsidian.md/changelog/2026-02-10-desktop-v1.12.1/
5. Obsidian 1.12.2 Desktop (EA) — `daily:path`, `help <command>` 등 추가  
   https://obsidian.md/changelog/2026-02-18-desktop-v1.12.2/
6. Obsidian 1.12.3 Desktop (EA) — 긴 content에서 CLI hang 수정  
   https://obsidian.md/changelog/2026-02-23-desktop-v1.12.3/
7. Obsidian 1.12.4 Desktop (EA) — Windows CLI 감지 이슈 수정/installer 경고  
   https://obsidian.md/changelog/2026-02-24-desktop-v1.12.4/
8. Update Obsidian (installer update 가이드)  
   https://help.obsidian.md/updates
9. Plugin security (커뮤니티 플러그인 신뢰 모델)  
   https://help.obsidian.md/plugin-security
10. Obsidian Headless (CLI와 구분되는 서버형 대안)  
    https://help.obsidian.md/headless
11. Headless Sync  
    https://help.obsidian.md/sync/headless

### 비교 참고(비공식/커뮤니티)

12. Local REST API for Obsidian (GitHub)  
    https://github.com/coddingtonbear/obsidian-local-rest-api
13. Local REST API manifest (버전/desktop-only)  
    https://raw.githubusercontent.com/coddingtonbear/obsidian-local-rest-api/main/manifest.json
14. Local REST API README (HTTPS+API key 모델)  
    https://raw.githubusercontent.com/coddingtonbear/obsidian-local-rest-api/main/README.md

