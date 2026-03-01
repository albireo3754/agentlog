---
name: readme-sync
description: Evaluate all sections of README.md by chapter, validate consistency against SSOT evidence files, and report/fix mismatches.
---

# README Sync Skill

## Purpose

Review the entire `README.md` chapter by chapter and synchronize/validate each statement against local SSOT (Source of Truth) files.

- Goal: Keep every README section accurate and up to date.
- Method: Analyze chapter claims -> choose evidence files -> validate/fix.

## Usage

- `/readme-sync`         -> Sync all README sections (apply edits if needed)
- `/readme-sync --check` -> Validate all README sections only

## Agent Note: Chapter-by-chapter triage

For each chapter, leave only these 3 short items:

1. `Claim Type`: requirements/install/run/config/api/architecture/deploy/other
2. `SSOT Files`: 1-3 files that directly prove the claim
3. `Read Method`: static value check | CLI/help output check | code path trace | docs/spec cross-check

Quick mapping rules:

- Requirements/Versions → `package.json`, lockfile, `.nvmrc`, `Dockerfile`
- Install/Run → `package.json` scripts, `Makefile`, `scripts/*`, `bin/*`
- Config/Env → `.env.example`, config schema/validation code
- Usage/API/CLI → entry points, router/handler code, `examples/*`
- Architecture/Flow → `docs/*`, module boundary code, ADR/SPEC
- Deploy/Ops → `Dockerfile`, compose/k8s/helm, CI workflow

## Execution Steps

1. Split `README.md` into chapters using `##`/`###` headings.
2. Decide `Claim Type / SSOT Files / Read Method` for each chapter.
3. Compare evidence files with README statements and judge consistency.
4. In `--check` mode, print mismatch list and fail with `exit 1`.
5. In normal mode, minimally patch README to match actual state.
6. If all aligned, print `README.md is in sync.`.

## README Writing Guideline (SSOT-first)

Prioritize a "verifiable README" over a "nice-looking README."

- Put the top 5 user-critical facts first: what it does, why it matters, how to start, where to get help, who maintains it.
- Optimize for quickstart over long prose: installation/run steps must be copy-paste ready.
- Tie factual statements to evidence files: versions/commands/paths/flags/env vars must follow code reality.
- Keep it scannable: short paragraphs, meaningful headings, lists/code blocks.
- Keep README focused on onboarding/contribution essentials; move long design/background content to `docs/` with relative links.

### Web research rule (default)

- If README quality criteria are unclear, research current web guidance first.
- Priority: 1) GitHub Docs (official), 2) Open Source Guides, 3) supporting templates/examples.
- Do not copy-paste findings directly; rewrite them to match this repository's SSOT.
- Avoid speculative language; keep only statements verifiable from local files.

### Reference sources (priority order)

- GitHub Docs: About READMEs
  - https://docs.github.com/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes
- GitHub Docs: Setting guidelines for repository contributors
  - https://docs.github.com/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors
- Open Source Guides: Starting an Open Source Project
  - https://opensource.guide/starting-a-project/
- Make a README (supporting template)
  - https://www.makeareadme.com/

### Sample template (SSOT-compliant)

~~~md
# <Project Name>

One-line summary: what problem this solves.

## Why
- What problem it solves
- Who benefits from it

## Quickstart
```bash
# install
<actual install command from this repo>
# run
<actual run command from this repo>
```

## Requirements
- Runtime/Version: <verified version>
- OS/Dependencies: <if applicable>

## Configuration
- Required env vars: `<ENV_NAME>` with meaning/default/required flag
- See `docs/config.md` for details

## Usage
- One shortest working usage example
- Expected result/behavior

## Troubleshooting
- Common failure cases and fixes

## Contributing
- Contribution flow summary + relative link to `CONTRIBUTING.md`

## License
- License and link
~~~

## SSOT Rule

- Every README chapter statement must be verifiable from local files/code.
- If a claim has no evidence file, remove it or mark it explicitly as `Planned`.
- Always prioritize SSOT consistency over stylistic wording.
- In CI/review, running `/readme-sync --check` is recommended.
