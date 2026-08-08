# Hook Provider Abstraction, Then Hermes

> status: draft
> created: 2026-06-21
> updated: 2026-06-21
> revision: 2

## 0. LLM Work Guide

> **Follow the Spec Execution Protocol (`/sisyphus`).** This PRD is implementation-ready only after the Phase 0 hard gate below passes.

| Item | Section |
|------|---------|
| Task Checklist | §6 |
| Naming Conventions | §3.5 |
| State file | `docs/plans/2026-06-21-hook-provider-abstraction-hermes-prd.state.md` |
| Decision Log | §8 |
| Handoff Snapshot | §9 |
| Changelog | §10 |

Hard gate:

- Phase 1 provider extraction must not start until Phase 0 coverage matrix, missing regression tests, QA smoke plan, agent-framework readiness review, and PRD gap patch are complete.
- Phase 0 completion evidence must include `bun test`, `bun run typecheck`, `agentlog doctor`, and `node scripts/prd-redteam.mjs --output docs/plans/2026-06-21-hook-provider-prd-redteam-report.json`.
- If the red-team report fails, patch this PRD first, then rerun the gate before implementation.
- If the red-team report is missing, stale for the current PRD revision, invalid JSON, or has `"verdict" != "pass"`, Phase 1 is blocked.
- The Phase 0 sign-off proof is this exact evidence set:
  - `docs/plans/2026-06-21-hook-provider-current-behavior-coverage.md` exists and every row has `automated`, `manual QA`, or `not in scope` evidence.
  - `docs/plans/2026-06-21-hook-provider-agent-readiness.md` exists and lists no blocker with status `open`.
  - Missing regression tests discovered by those documents are committed before provider extraction.
  - `docs/plans/2026-06-21-hook-provider-prd-redteam-report.json` exists with `"verdict": "pass"`.
  - The final implementation note cites the validation commands and their pass/fail output.

Phase 0 command thresholds:

| Command | Required threshold |
|---------|--------------------|
| `bun test` | exit code 0 for the full suite |
| `bun run typecheck` | exit code 0 |
| `bun run build` | exit code 0 |
| `agentlog doctor` | exit code 0 in the developer environment |
| `node scripts/prd-redteam.mjs --output docs/plans/2026-06-21-hook-provider-prd-redteam-report.json` | exit code 0 and report JSON `"verdict": "pass"` |

Phase 0 artifact status:

| Artifact | Required status | Machine-check |
|----------|-----------------|---------------|
| `docs/plans/2026-06-21-hook-provider-current-behavior-coverage.md` | present before Phase 1 | `phase0-artifacts-exist` red-team check |
| `docs/plans/2026-06-21-hook-provider-agent-readiness.md` | present before Phase 1, no open blocker | `phase0-artifacts-exist` red-team check plus reviewer read |
| `docs/plans/2026-06-21-hook-provider-prd-redteam-report.json` | regenerated after PRD edits | JSON `"verdict": "pass"` |

## 1. Goal

Refactor AgentLog's Claude/Codex hook integration into a small provider layer, then add Hermes Agent as the third hook provider.

This follows the "third time" rule:

- Claude-only did not need an abstraction.
- Claude + Codex still tolerated explicit branching.
- Claude + Codex + Hermes creates the third repeated hook lifecycle path, so provider extraction is now justified.

The desired end state:

- Existing Claude and Codex installs, doctor checks, uninstall behavior, and Daily Note output remain unchanged.
- Hook provider lifecycle logic becomes registry-driven instead of hard-coded throughout `src/cli.ts`.
- `agentlog hook --source hermes` accepts Hermes `pre_llm_call` shell-hook payloads and writes `[[hermes_<session_id>]]` dividers.
- Hermes setup is automated for this PRD: `agentlog init --hermes` writes the AgentLog shell hook to Hermes config with structured YAML parsing, records selected profiles, and `agentlog uninstall --hermes` removes only AgentLog's command.

## 2. Non-Goals

- Do not rewrite the Daily Note writer.
- Do not redesign Obsidian path resolution or Daily Note bootstrap.
- Do not add Hermes backfill until Hermes transcript format is separately verified.
- Do not make EnglishAsk run for Hermes.
- Do not silently include Hermes in `agentlog init --all`; keep `--all` as Claude+Codex for backward compatibility.
- Do not regex-edit arbitrary YAML for `~/.hermes/config.yaml`.
- Do not mutate Hermes YAML without a structured parser, idempotency tests, invalid-YAML failure tests, and AgentLog-only unregister tests.
- Do not add a broad plugin framework beyond the hook-provider boundary.

## 3. Design

### 3.1 Deliverables

| Deliverable | Path | Consumer | Format |
|-------------|------|----------|--------|
| Provider type definitions | `src/hook-providers/types.ts` | CLI, hook parser, tests | TypeScript |
| Provider registry | `src/hook-providers/index.ts` | CLI orchestration | TypeScript |
| Claude provider adapter | `src/hook-providers/claude.ts` | provider registry | TypeScript |
| Codex provider adapter | `src/hook-providers/codex.ts` | provider registry | TypeScript |
| Hermes provider adapter | `src/hook-providers/hermes.ts` | provider registry | TypeScript |
| Hermes hook fixture | `src/__tests__/fixtures/hermes-pre-llm-call.json` | hook parser tests | JSON |
| Generic provider lifecycle tests | `src/__tests__/hook-providers.test.ts` | implementation verification | Bun test |
| Current behavior coverage matrix | `docs/plans/2026-06-21-hook-provider-current-behavior-coverage.md` | implementer, reviewer, agents | Markdown |
| Agent framework readiness checklist | `docs/plans/2026-06-21-hook-provider-agent-readiness.md` | implementation agents | Markdown |
| Hermes hook spec docs | `docs/hermes-hook-spec.md` | users and maintainers | Markdown |
| README updates | `README.md` | users | Markdown |

### 3.2 Interface

Provider lifecycle interface:

```ts
export type HookProviderId = "claude" | "codex" | "hermes";

export type HookProviderState =
  | { kind: "registered"; detail: string }
  | { kind: "missing"; detail: string; repairHint: string; warnOnly?: boolean }
  | { kind: "needs_migration"; detail: string; repairHint: string }
  | { kind: "unsupported"; detail: string; repairHint: string };

export interface HookInstallContext {
  vault: string;
  plain: boolean;
}

export interface HookInstallResult {
  changed: boolean;
  messages: string[];
  configPatch?: Partial<AgentLogConfig>;
}

export interface HookUninstallResult {
  changed: boolean;
  messages: string[];
  configPatch?: Partial<AgentLogConfig>;
}

export interface HookProvider {
  id: HookProviderId;
  label: string;
  configFlag: "claudeHookInstalled" | "codexHookInstalled" | "hermesHookInstalled";
  command: string;
  install(ctx: HookInstallContext): HookInstallResult;
  uninstall(): HookUninstallResult;
  inspect(): HookProviderState;
  isRelevant(config: AgentLogConfig | null): boolean;
}
```

Runtime hook input parsing:

```ts
export interface HookInput {
  hook_event_name: "UserPromptSubmit" | "pre_llm_call";
  session_id: string;
  cwd: string;
  prompt?: string;
  message?: { content: string };
  parts?: Array<{ type: "text"; text: string }>;
  extra?: {
    user_message?: string;
    conversation_history?: unknown[];
    is_first_turn?: boolean;
    model?: string;
    platform?: string;
  };
}

export interface ParsedHookInput {
  sessionId: string;
  cwd: string;
  prompt: string;
}

export function parseHookInput(
  raw: string,
  options?: { source?: HookProviderId },
): ParsedHookInput;
```

CLI target parsing:

```ts
export type InitTarget = "claude" | "codex" | "hermes" | "all";
export type UninstallTarget = "claude" | "codex" | "hermes" | "all";

export function providersForInitTarget(target: InitTarget): HookProviderId[];
export function providersForUninstallTarget(target: UninstallTarget): HookProviderId[];
```

Required target behavior:

```ts
providersForInitTarget("claude") === ["claude"];
providersForInitTarget("codex") === ["codex"];
providersForInitTarget("hermes") === ["hermes"];
providersForInitTarget("all") === ["claude", "codex"];
```

### 3.3 Flow

Phase 0: lock current behavior before abstraction.

1. Create a current behavior coverage matrix for Claude, Codex, legacy Codex notify, hook parsing, note writing, doctor, init, uninstall, and backfill.
2. Map each behavior to an existing automated test, a new missing test, or a manual QA check.
3. Add missing regression tests before refactoring.
4. Add a QA smoke checklist for real host integration paths:
   - `agentlog doctor`
   - `agentlog init --dry-run`
   - `agentlog init --codex --dry-run`
   - `agentlog backfill --dry-run --format json`
   - hook fixture invocation in an isolated `AGENTLOG_CONFIG_DIR`
5. Validate agent-framework readiness:
   - PRD has concrete files, interfaces, naming, and test commands.
   - Tasks can be executed by an agent without asking for hidden decisions.
   - No Phase 1 implementation decision remains ambiguous.
   - Required docs/research are referenced by path.
6. Patch any missing PRD detail discovered during readiness review before code changes.
7. Run the red-team PRD gate and require a pass before Phase 1:
   - `node scripts/prd-redteam.mjs --output docs/plans/2026-06-21-hook-provider-prd-redteam-report.json`

Phase 1: extract provider registry without behavior changes.

1. Move Claude install/uninstall/inspect wrapping into `hook-providers/claude.ts`.
2. Move Codex install/uninstall/inspect wrapping into `hook-providers/codex.ts`.
3. Introduce registry helpers.
4. Replace `src/cli.ts` target branches with provider iteration.
5. Keep output text compatible unless tests explicitly approve small wording updates.
6. Run existing CLI, Codex, hook, and note-writer tests.

Phase 2: add Hermes runtime provider.

1. Add `"hermes"` to `HookProviderId` and `SourceType`.
2. Update `src/hook.ts` source resolution so only known providers are accepted; unknown source falls back to Claude only if no `--source` was provided.
3. Update `parseHookInput()`:
   - Claude/Codex: keep current `UserPromptSubmit` behavior.
   - Hermes: require `hook_event_name: "pre_llm_call"` and `extra.user_message`.
4. Update divider parsing to recognize `hermes`.
5. Add Hermes fixture and parser/note-writer tests.
6. Add `docs/hermes-hook-spec.md` and README setup docs.
7. Hermes logs every valid `pre_llm_call` payload regardless of `extra.platform`; platform filtering is out of scope.

Phase 3: Hermes init/doctor/uninstall automation.

1. Add `hermesHookInstalled?: boolean` and `hermesProfiles?: string[]` to config.
2. Add `src/hermes-config.ts` for structured YAML read/write of `hooks.pre_llm_call`.
3. Add `agentlog init --hermes` that writes `agentlog hook --source hermes` to the default Hermes config and records metadata.
4. Add repeated `--hermes-profile <name>` and `--hermes-all-profiles` support for named Hermes profile configs.
5. Add `agentlog uninstall --hermes` that removes only AgentLog's command from configured profiles.
6. Add doctor state for Hermes only when config metadata or installed state makes it relevant; configured missing/partial hooks fail.
7. Add a real Hermes-profile smoke when the `hermes` binary is available.

### 3.4 Existing Code Impact

| Existing File | Change | Impact |
|---------------|--------|:------:|
| `src/cli.ts` | Replace direct Claude/Codex lifecycle branches with provider registry calls | High |
| `src/types.ts` | Add `hermes` source and optional `hermesHookInstalled` metadata | Medium |
| `src/hook.ts` | Resolve `--source hermes` and reject/handle unknown source safely | Medium |
| `src/schema/hook-input.ts` | Add Hermes `pre_llm_call` parser branch | Medium |
| `src/note-writer.ts` | Recognize `hermes` in divider regex | Low |
| `src/schema/daily-note.ts` | Type expansion only; formatting already source-parametric | Low |
| `src/backfill.ts` | Keep Claude/Codex only; `agentlog backfill --source hermes` must fail with `Error: --source must be one of: all, claude, codex` | Low |
| `README.md` | Document provider model and Hermes automated setup | Medium |
| `docs/codex-hook-spec.md` | Leave Codex-specific; link to generic/Hermes docs if needed | Low |

### 3.5 Naming Conventions

| Category | Name | Description |
|----------|------|-------------|
| type | `HookProviderId` | Provider/source identity: `claude`, `codex`, `hermes` |
| type | `HookProviderState` | Normalized doctor/install state |
| interface | `HookProvider` | Install/uninstall/inspect contract |
| function | `providersForInitTarget` | CLI target to provider list |
| function | `providersForUninstallTarget` | CLI uninstall target to provider list |
| function | `parseHookInput` | Provider-aware stdin payload normalization |
| module | `src/hook-providers/index.ts` | Provider registry |
| module | `src/hook-providers/claude.ts` | Claude adapter |
| module | `src/hook-providers/codex.ts` | Codex adapter |
| module | `src/hook-providers/hermes.ts` | Hermes adapter |
| fixture | `hermes-pre-llm-call.json` | Hermes shell-hook fixture |
| docs | `docs/hermes-hook-spec.md` | Hermes provider contract |

### 3.6 Security Considerations

- **Hook command trust**: Claude, Codex, and Hermes all execute user-level commands. AgentLog must install only `agentlog hook --source <provider>` and must not interpolate untrusted user input into hook commands.
- **Hermes YAML risk**: `~/.hermes/config.yaml` is privileged. If AgentLog writes it, use structured YAML parsing. Do not use regex mutation.
- **Prompt mutation risk**: Claude/Codex/Hermes prompt hooks can inject context or block prompts. AgentLog logging must emit no stdout in success cases.
- **Config corruption**: Provider adapters must preserve unrelated config entries and unrelated hook groups.
- **Doctor scope**: Doctor must not pressure users to install every provider. A provider is relevant only if metadata says AgentLog owns it or an installed hook is detected.

### 3.7 Target Environment

- Platform: macOS primary, cross-platform where existing AgentLog supports it.
- Runtime: Bun + TypeScript, Node 20-compatible package.
- Deployment: local CLI package.
- External tools: Claude Code, Codex CLI, Hermes Agent, Obsidian CLI.

## 4. Verification Criteria

### Functional

- [ ] Given: existing Claude-only config / When: `agentlog init` runs / Then: `~/.claude/settings.json` contains the same AgentLog hook shape as before.
- [ ] Given: existing Codex hook config with unrelated hooks / When: `agentlog init --codex` runs / Then: unrelated hooks remain and AgentLog Codex hook is idempotent.
- [ ] Given: `agentlog init --all` / When: provider target resolution runs / Then: it includes only `claude` and `codex`.
- [ ] Given: Hermes shell-hook payload with `hook_event_name: "pre_llm_call"` and `extra.user_message` / When: `parseHookInput(raw, { source: "hermes" })` runs / Then: it returns `{ sessionId, cwd, prompt }`.
- [ ] Given: malformed Hermes payload missing `extra.user_message` / When: parser runs / Then: it throws a source-specific parse error.
- [ ] Given: source `hermes` and session id `sess_abc` / When: Daily Note divider is built / Then: output is `- - - - [[hermes_sess_abc]]`.
- [ ] Given: existing `[[hermes_sess_abc]]` divider / When: another Hermes prompt in same session is appended / Then: no duplicate divider is inserted.
- [ ] Given: `agentlog backfill --source hermes` before Hermes backfill exists / When: command runs / Then: it exits non-zero and prints `Error: --source must be one of: all, claude, codex`.
- [ ] Given: Hermes automated setup docs / When: user follows them / Then: configured shell hook command is `agentlog hook --source hermes`.

### Regression

- [ ] Current behavior coverage matrix exists and every listed behavior has automated coverage or an explicit manual QA check.
- [ ] Agent framework readiness checklist exists and has no unresolved blocker before implementation.
- [ ] PRD red-team gate passes before Phase 1 implementation begins: `node scripts/prd-redteam.mjs --output docs/plans/2026-06-21-hook-provider-prd-redteam-report.json`.
- [ ] Missing tests found in Phase 0 are added before provider extraction.
- [ ] Existing Claude tests pass.
- [ ] Existing Codex hook tests pass.
- [ ] Existing Codex legacy notify tests pass.
- [ ] Existing note-writer grouping tests pass.
- [ ] Existing backfill tests pass.
- [ ] `bun run typecheck` passes.
- [ ] `agentlog doctor` passes in the developer environment.

### Security/Negative

- [ ] Given: unknown `--source bad` / When: hook runs / Then: it does not silently label the entry as Claude if `--source` was explicitly provided.
- [ ] Given: Hermes hook command succeeds / When: stdout is captured / Then: stdout is empty or `{}` and does not inject context.
- [ ] Given: unsupported provider config shape / When: doctor runs / Then: it reports unsupported with a repair hint without mutating files.

## 5. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Provider abstraction becomes too broad | Larger diff, harder review | Scope only install/uninstall/inspect/source parsing |
| Existing CLI output changes unexpectedly | Test breakage and user confusion | Preserve current wording where practical; update tests only for intentional changes |
| Hermes YAML mutation corrupts config | High user impact | Use structured YAML parser; reject unsupported YAML; test idempotency and AgentLog-only removal |
| Unknown source fallback masks bad config | Mislabelled logs | Only default to Claude when `--source` is absent |
| Hermes backfill assumed too early | False feature claim | Exclude from scope |

## 6. Task Checklist

- [ ] ✅ Phase 0 current behavior inventory → verify: `docs/plans/2026-06-21-hook-provider-current-behavior-coverage.md` maps each behavior to test/QA evidence.
- [ ] ✅ Phase 0 missing regression tests → verify: every high-risk current behavior has automated coverage before abstraction.
- [ ] ✅ Phase 0 QA smoke plan → verify: manual commands and expected outcomes are listed, including isolated hook invocation.
- [ ] ✅ Phase 0 agent-framework readiness review → verify: `docs/plans/2026-06-21-hook-provider-agent-readiness.md` lists executable tasks, blockers, and any PRD gaps.
- [ ] ✅ Phase 0 PRD gap patch → verify: blockers from readiness review are resolved before code changes.
- [ ] ✅ Phase 0 red-team gate → verify: `node scripts/prd-redteam.mjs --output docs/plans/2026-06-21-hook-provider-prd-redteam-report.json` passes before Phase 1.
- [ ] ✅ Phase 1 research lock: read this PRD plus both research docs → verify: cite source files in implementation notes.
- [ ] ✅ Add provider type/registry modules → verify: `bun test src/__tests__/hook-providers.test.ts`.
- [ ] ✅ Wrap Claude provider around existing `claude-settings.ts` → verify: Claude CLI tests unchanged.
- [ ] ✅ Wrap Codex provider around existing `codex-hooks.ts` and legacy `codex-settings.ts` cleanup → verify: Codex CLI tests unchanged.
- [ ] ✅ Replace `src/cli.ts` provider branching with registry iteration → verify: `bun test src/__tests__/cli.test.ts src/__tests__/cli-codex.test.ts`.
- [ ] ✅ Add Hermes parser fixture and parser branch → verify: `bun test src/__tests__/hook-input.test.ts`.
- [ ] ✅ Add `hermes` source divider support → verify: `bun test src/__tests__/daily-note.test.ts src/__tests__/note-writer.test.ts`.
- [ ] ✅ Add Hermes docs with automated setup → verify: docs mention `pre_llm_call`, profiles, `extra.user_message`, and `agentlog hook --source hermes`.
- [ ] ✅ Decide whether `init --hermes` mutates YAML or prints setup instructions → verify: decision logged in §8 before implementation.
- [ ] ✅ Automate `init --hermes` with structured YAML mutation → verify: `bun test src/__tests__/hermes-config.test.ts src/__tests__/cli-codex.test.ts`.
- [ ] ✅ Add real Hermes profile smoke → verify: CLI test runs `hermes -p smoke hooks list` when Hermes is installed.
- [ ] ✅ Keep Hermes out of backfill → verify: `agentlog backfill --source hermes` rejects with the allowed-source error.
- [ ] ✅ Run full validation → verify: `bun test`, `bun run typecheck`, `agentlog doctor`.

## 7. Open Questions

These are deferred future-product questions. They are not Phase 1 or Phase 2 implementation blockers.

- Should a future `agentlog init --providers claude,codex,hermes` replace expanding flag combinations?

## 8. Decision Log

- 2026-06-21: Provider abstraction is justified now because Hermes is the third hook integration.
- 2026-06-21: Abstraction boundary is lifecycle/provider parsing only; Daily Note writing remains shared core.
- 2026-06-21: `agentlog init --all` remains Claude+Codex to preserve existing semantics.
- 2026-06-21: Hermes backfill is explicitly out of scope until transcript format is verified.
- 2026-06-21: Phase 0 must lock current behavior with coverage, QA smoke checks, and agent-framework readiness before abstraction starts.
- 2026-06-22: `agentlog init --hermes` now owns structured Hermes config mutation because Hermes is the third provider and lifecycle abstraction must cover install, inspect, and uninstall. It writes/removes only `agentlog hook --source hermes` and records target profiles.
- 2026-06-21: `agentlog backfill --source hermes` is rejected until Hermes transcript backfill is separately specified.
- 2026-06-21: Hermes runtime logging accepts all valid Hermes `pre_llm_call` payloads and does not filter by `extra.platform`.

## 9. Handoff Snapshot

Current status:

- Research docs exist:
  - `docs/research/2026-06-21-hermes-agentlog-research.md`
  - `docs/research/2026-06-21-hook-provider-abstraction-research.md`
- This PRD defines a two-phase implementation: provider extraction, then Hermes.
- Phase 0 coverage/readiness artifacts now exist:
  - `docs/plans/2026-06-21-hook-provider-current-behavior-coverage.md`
  - `docs/plans/2026-06-21-hook-provider-agent-readiness.md`
- Implementation has started on the `feature/prd-redteam-tool` branch after Phase 0 artifacts were created.
- The red-team report must be regenerated after every PRD change and must pass before this work is considered ready for review.

Next recommended step:

1. Regenerate `docs/plans/2026-06-21-hook-provider-prd-redteam-report.json`.
2. Run full validation: `bun test`, `bun run typecheck`, `bun run build`, `agentlog doctor`.
3. Review the implementation diff only after the red-team report has `"verdict": "pass"`.

## 10. Changelog

| rev | date | summary |
|-----|------|---------|
| 1 | 2026-06-21 | Initial PRD for provider abstraction followed by Hermes |
| 2 | 2026-06-21 | Closed Phase 0 hard gate, initial manual Hermes init decision, and backfill-source rejection contract |
| 3 | 2026-06-22 | Revised Hermes lifecycle scope to structured YAML automation, profile support, and real Hermes smoke |
