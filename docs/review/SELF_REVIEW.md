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

### Docs Sync

When runtime fallback order or behavior changes, developer docs must say the same thing.

Check:

- Docs describe `.obsidian/daily-notes.json` before CLI fallback if that is runtime behavior.
- Old statements like "always uses Obsidian CLI" are removed or qualified.
- README/CLAUDE/docs are updated only when they are in scope.

### Evaluator Hooks

Any evaluator launched from a hook or notify path must be fail-soft and non-recursive.

Check:

- Child evaluator runs set an env guard before invoking Codex or other agent tooling.
- The notify/hook path checks that guard and skips evaluator recursion.
- Evaluator failure, non-zero exit, and timeout cannot prevent the normal AgentLog write.
- Prompts and evaluator output are redacted and bounded before storage.

Good evidence:

- env guard such as `AGENTLOG_ENGLISHASK_EVAL`
- tests for guard skip, evaluator failure, and timeout
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
