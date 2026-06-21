# Hook Provider Abstraction, Then Hermes

> status: draft
> created: 2026-06-21
> updated: 2026-06-21
> revision: 1

## 0. LLM Work Guide

> **Follow the Spec Execution Protocol (`/sisyphus`).** This PRD is implementation-ready, but code work should start only after review.

| Item | Section |
|------|---------|
| Task Checklist | §6 |
| Naming Conventions | §3.5 |
| State file | `docs/plans/2026-06-21-hook-provider-abstraction-hermes-prd.state.md` |
| Decision Log | §8 |
| Handoff Snapshot | §9 |
| Changelog | §10 |

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
- Hermes setup is documented first; AgentLog-owned mutation of `~/.hermes/config.yaml` is optional and explicitly scoped.

## 2. Non-Goals

- Do not rewrite the Daily Note writer.
- Do not redesign Obsidian path resolution or Daily Note bootstrap.
- Do not add Hermes backfill until Hermes transcript format is separately verified.
- Do not make EnglishAsk run for Hermes.
- Do not silently include Hermes in `agentlog init --all`; keep `--all` as Claude+Codex for backward compatibility.
- Do not regex-edit arbitrary YAML for `~/.hermes/config.yaml`.
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
   - Ambiguous decisions are isolated in §7 or gated as ⚠️ tasks.
   - Required docs/research are referenced by path.
6. Patch any missing PRD detail discovered during readiness review before code changes.

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

Phase 3: optional Hermes install/doctor support.

This phase is included in the PRD but should be implemented only if explicitly accepted after Phase 2 review.

1. Add `hermesHookInstalled?: boolean` to config.
2. Add `agentlog init --hermes` that either:
   - prints manual setup instructions, or
   - safely writes `~/.hermes/config.yaml` with a real YAML parser.
3. Add `agentlog uninstall --hermes`.
4. Add doctor state for Hermes only when config metadata or installed state makes it relevant.
5. Add `hermes hooks doctor` to manual QA instructions, not as a required automated test.

### 3.4 Existing Code Impact

| Existing File | Change | Impact |
|---------------|--------|:------:|
| `src/cli.ts` | Replace direct Claude/Codex lifecycle branches with provider registry calls | High |
| `src/types.ts` | Add `hermes` source and optional `hermesHookInstalled` metadata | Medium |
| `src/hook.ts` | Resolve `--source hermes` and reject/handle unknown source safely | Medium |
| `src/schema/hook-input.ts` | Add Hermes `pre_llm_call` parser branch | Medium |
| `src/note-writer.ts` | Recognize `hermes` in divider regex | Low |
| `src/schema/daily-note.ts` | Type expansion only; formatting already source-parametric | Low |
| `src/backfill.ts` | Keep Claude/Codex only; optionally make source validation use supported backfill sources, not all providers | Low |
| `README.md` | Document provider model and Hermes manual setup | Medium |
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
- [ ] Given: `agentlog backfill --source hermes` before Hermes backfill exists / When: command runs / Then: it fails clearly or is absent from allowed values.
- [ ] Given: Hermes manual setup docs / When: user follows them / Then: configured shell hook command is `agentlog hook --source hermes`.

### Regression

- [ ] Current behavior coverage matrix exists and every listed behavior has automated coverage or an explicit manual QA check.
- [ ] Agent framework readiness checklist exists and has no unresolved blocker before implementation.
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
| Hermes YAML mutation corrupts config | High user impact | Make YAML mutation optional; require parser if implemented |
| Unknown source fallback masks bad config | Mislabelled logs | Only default to Claude when `--source` is absent |
| Hermes backfill assumed too early | False feature claim | Exclude from scope |

## 6. Task Checklist

- [ ] ✅ Phase 0 current behavior inventory → verify: `docs/plans/2026-06-21-hook-provider-current-behavior-coverage.md` maps each behavior to test/QA evidence.
- [ ] ✅ Phase 0 missing regression tests → verify: every high-risk current behavior has automated coverage before abstraction.
- [ ] ✅ Phase 0 QA smoke plan → verify: manual commands and expected outcomes are listed, including isolated hook invocation.
- [ ] ✅ Phase 0 agent-framework readiness review → verify: `docs/plans/2026-06-21-hook-provider-agent-readiness.md` lists executable tasks, blockers, and any PRD gaps.
- [ ] ✅ Phase 0 PRD gap patch → verify: blockers from readiness review are resolved or moved to §7 before code changes.
- [ ] ✅ Phase 1 research lock: read this PRD plus both research docs → verify: cite source files in implementation notes.
- [ ] ✅ Add provider type/registry modules → verify: `bun test src/__tests__/hook-providers.test.ts`.
- [ ] ✅ Wrap Claude provider around existing `claude-settings.ts` → verify: Claude CLI tests unchanged.
- [ ] ✅ Wrap Codex provider around existing `codex-hooks.ts` and legacy `codex-settings.ts` cleanup → verify: Codex CLI tests unchanged.
- [ ] ⚠️ Replace `src/cli.ts` provider branching with registry iteration → verify: `bun test src/__tests__/cli.test.ts src/__tests__/cli-codex.test.ts`.
- [ ] ✅ Add Hermes parser fixture and parser branch → verify: `bun test src/__tests__/hook-input.test.ts`.
- [ ] ✅ Add `hermes` source divider support → verify: `bun test src/__tests__/daily-note.test.ts src/__tests__/note-writer.test.ts`.
- [ ] ✅ Add Hermes docs with manual setup → verify: docs mention `pre_llm_call`, `extra.user_message`, and `agentlog hook --source hermes`.
- [ ] ⚠️ Decide whether `init --hermes` mutates YAML or prints manual setup → verify: decision logged in §8 before implementation.
- [ ] ⚠️ If YAML mutation is accepted, add structured YAML dependency or a safe append-only writer → verify: tests cover preserving unrelated config.
- [ ] ✅ Run full validation → verify: `bun test`, `bun run typecheck`, `agentlog doctor`.

## 7. Open Questions

- Should `agentlog init --hermes` be runtime-only documentation output, or should it write `~/.hermes/config.yaml`?
- If YAML mutation is implemented, is adding a YAML parser dependency acceptable?
- Should Hermes log all `platform` values (`cli`, `telegram`, `discord`, etc.) or only `platform: "cli"` by default?
- Should a future `agentlog init --providers claude,codex,hermes` replace expanding flag combinations?

## 8. Decision Log

- 2026-06-21: Provider abstraction is justified now because Hermes is the third hook integration.
- 2026-06-21: Abstraction boundary is lifecycle/provider parsing only; Daily Note writing remains shared core.
- 2026-06-21: `agentlog init --all` remains Claude+Codex to preserve existing semantics.
- 2026-06-21: Hermes backfill is explicitly out of scope until transcript format is verified.
- 2026-06-21: Phase 0 must lock current behavior with coverage, QA smoke checks, and agent-framework readiness before abstraction starts.

## 9. Handoff Snapshot

Current status:

- Research docs exist:
  - `docs/research/2026-06-21-hermes-agentlog-research.md`
  - `docs/research/2026-06-21-hook-provider-abstraction-research.md`
- This PRD defines a two-phase implementation: provider extraction, then Hermes.
- First implementation PRD phase is now Phase 0: current behavior coverage and agent readiness.
- No code implementation has been started.

Next recommended step:

1. Review this PRD for scope, especially Hermes config mutation.
2. Complete Phase 0 coverage and readiness documents.
3. Run spec review.
4. Implement Phase 1 behavior-preserving provider extraction.

## 10. Changelog

| rev | date | summary |
|-----|------|---------|
| 1 | 2026-06-21 | Initial PRD for provider abstraction followed by Hermes |
