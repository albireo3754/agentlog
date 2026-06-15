# Self Review Memory

Use this file as LLM reviewer context before pushing PR updates.

The goal is not to approve the diff. The goal is to find material issues that static gates miss, then decide whether each finding should become a future static gate.

## Review Contract

Review the current diff against:

- recurring mistakes listed in this file
- changed runtime behavior
- tests and fixtures that claim to prove that behavior
- developer docs that describe the changed behavior

For every finding, report:

- severity: `high`, `medium`, or `low`
- file and line
- why it matters
- concrete fix
- whether this should become a `review-list.json` static rule

Do not repeat already-addressed findings unless the current diff still violates the behavior.

## Recurring Mistakes

### External Path Safety

Any path from config, CLI stdout, env, file contents, or user-controlled settings is untrusted.

Check:

- The path cannot escape the configured vault/root.
- Absolute path input is rejected, confined, or safely ignored.
- `../` traversal has a regression test.
- CLI output is not joined directly with a trusted root.
- Boundary checks do not reject valid in-root names such as `..daily`.

Good evidence:

- confinement helper such as `safeVaultJoin`
- tests for traversal and valid edge names
- fallback behavior when external path is unsafe

### Bug Fixture Fidelity

Regression tests must reproduce the real bug input shape, not a simplified version that misses the failure mode.

Check:

- Timestamp/log prefixes are included when the bug involved Electron or CLI noise.
- Test inputs match the reported stdout/stderr shape.
- Test names are proven by behavior, not by setup assumptions.

Good evidence:

- fixture includes the full noisy line, such as `2026-03-24 04:27:38 App is up to date.`
- test fails against the buggy implementation

### CLI Invocation Claims

When a test says "without invoking CLI", it must prove the CLI was not invoked.

Check:

- A mock CLI creates a sentinel file if executed.
- The test asserts the sentinel does not exist.
- Merely setting a nonexistent binary is not enough.

Good evidence:

- mock script with `touch <sentinel>`
- assertion such as `expect(existsSync(sentinel)).toBe(false)`

### Integration Uninstall and Migration Cleanup

Install/uninstall paths mutate user-level integration files. Treat those files as external input and keep migration-era side effects explicit.

Check:

- Uninstall paths catch invalid or unsupported external config, such as malformed Codex `hooks.json`, and exit with a single clear message instead of a stack trace.
- User-facing uninstall output distinguishes restoring a previous command from removing an AgentLog-owned legacy entry.
- Docs and CLI help mention both current integration cleanup and legacy migration cleanup when a command performs both.

Good evidence:

- tests for invalid `hooks.json` during `uninstall --codex`
- tests for legacy notify removal when no restore command exists
- docs that mention legacy `notify` cleanup for Codex uninstall

### Docs Sync

When runtime fallback order or behavior changes, developer docs must say the same thing.

Check:

- Docs describe `.obsidian/daily-notes.json` before CLI fallback if that is runtime behavior.
- Old statements like "always uses Obsidian CLI" are removed or qualified.
- README/CLAUDE/docs are updated only when they are in scope.

### Daily Bootstrap Safety

`obsidian daily:path` resolves a path; it does not create the Daily Note or apply the user's template.

Check:

- Missing Daily Notes in Obsidian mode are created through `obsidian daily` before AgentLog writes.
- AgentLog re-checks that the resolved file exists after CLI bootstrap before reading or writing.
- Non-plain mode does not create a guessed `{vault}/Daily/...` fallback when no safe path source is available.
- Plain mode remains direct-file append and is not accidentally routed through Obsidian CLI.
- Tests prove template content created by the bootstrap is preserved after AgentLog merges `## AgentLog`.
- Tests prove CLI-unavailable/bootstrap-failure cases do not create raw Daily files.

Good evidence:

- `cliEnsureDailyNoteExists()` calls `obsidian daily`.
- `appendEntry()` aborts missing-note writes when path resolution or CLI bootstrap cannot be confirmed.
- Regression tests for missing-note bootstrap, no guessed fallback, and bootstrap failure.

### Session Link Fidelity

Session links written to Daily Notes should preserve the full session id unless reading legacy data.

Check:

- New `[[claude_...]]`, `[[codex_...]]`, and EnglishAsk session links use full `sessionId`.
- Truncation such as `sessionId.slice(0, 8)` remains only in legacy matching compatibility, not in new output builders.
- Docs examples do not show short 6-8 character source-prefixed session links as the current output.

Good evidence:

- tests for full UUID-like session links in Claude and Codex dividers
- tests showing legacy short dividers still match the current session without rewriting old notes

### Evaluator Hooks

Any evaluator launched from a hook or notify path must be fail-soft and non-recursive.

Check:

- Child evaluator runs set an env guard before invoking Codex or other agent tooling.
- The notify/hook path checks that guard before reading stdin, normal writes, and forwarding, then skips evaluator child turns entirely.
- Notify payload `cwd` can be stale or unavailable on CI/another machine; evaluator cwd must fall back safely.
- Evaluator failure, non-zero exit, timeout, and feedback append failures cannot prevent the normal AgentLog write or surface as generic notify errors.
- Evaluators receive the raw user prompt for semantic review; display-only formatting such as `prettyPrompt(...)` is used only for Daily Note entries.
- Prompts and evaluator output are redacted and bounded before storage.
- Stored prompt metadata is flattened before being written as a Markdown list item.
- Stored evaluator feedback cannot break out of its Markdown code fence.
- New feedback is inserted inside the existing `## EnglishAsk` section, before the next top-level heading, including when the next heading immediately follows the section header.

Good evidence:

- env guard such as `AGENTLOG_ENGLISHASK_EVAL`
- tests for guarded notify no-write/no-forward, raw evaluator input vs display prompt, missing cwd fallback, evaluator failure, timeout, append failure, prompt flattening, feedback fence safety, and existing-section insertion
- config defaults that keep evaluator features off unless explicitly enabled

### Plan and Design Contract Drift

Implementation plans and design docs must not drift from the current code contract.

Check:

- Plans do not require unavailable external skills, prompts, or tools.
- Path-resolution docs match the current implementation order and fallback behavior.
- Version requirements match exported constants and tests, such as `MIN_CLI_VERSION`.
- Acceptance criteria have explicit test tasks, especially for preservation behavior.
- Manual commit or staging examples include every file required by the task, or instruct the agent to inspect `git status`.

Good evidence:

- plan prerequisites exist locally or are replaced with repo-native instructions
- line-level agreement between plan, design, implementation, and tests
- test tasks that prove each user-visible acceptance criterion
- no stale manual `git add` list after docs or tests are added

### Date Format Token Validation

Supported date format tokens must be explicit and tested.

Check:

- Supported tokens and replacement implementation match.
- Unsupported named tokens such as `MMMM` or `WW` fall back safely.
- `.md` suffix handling does not become part of token replacement.
- No dead conditions, such as checking Korean characters inside ASCII regex matches.

Good evidence:

- explicit `SUPPORTED_FORMAT_TOKENS`
- regression tests for `.md` suffix and unsupported named tokens

## Static Gate Promotion

After an LLM review finds a real issue, decide whether it should be promoted:

- Promote when it can be checked deterministically by file path, diff text, or regex evidence.
- Keep in this MD only when it needs judgment, design context, or semantic review.
- Avoid broad noisy rules that fail unrelated diffs.

When promoting:

1. Add or update `docs/review/review-list.json`.
2. Run `bun run self-review -- --mode staged`.
3. Confirm the new rule would fail on the bad historical commit when possible.

## Reviewer Prompt

Use this prompt shape for LLM self-review:

```text
Use docs/review/SELF_REVIEW.md as review memory.
Review the current diff against that memory.
Find new material issues not covered by static gates.
For each finding: severity, file:line, why, concrete fix, and whether it should become a static gate.
Do not repeat already-addressed findings unless the current diff still violates the behavior.
```
