#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEFAULT_PRD = "docs/plans/2026-06-21-hook-provider-abstraction-hermes-prd.md";

function parseArgs(argv) {
  const args = {
    prd: DEFAULT_PRD,
    output: null,
    json: false,
    model: "gpt-5.3-codex-spark",
    reasoningEffort: "low",
    skipModel: false,
    timeoutMs: 120_000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prd") args.prd = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--reasoning-effort") args.reasoningEffort = argv[++i];
    else if (arg === "--skip-model") args.skipModel = true;
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    fail(`Invalid --timeout-ms: ${args.timeoutMs}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/prd-redteam.mjs [--prd ${DEFAULT_PRD}] [--output report.json]

Runs a two-layer PRD red-team gate:
  1. mechanical checks for required Phase 0 PRD coverage
  2. model review through isolated: codex exec --ephemeral --ignore-rules -- <prompt>

Options:
  --json          Print the full JSON report to stdout
  --model         Codex model for model review (default: gpt-5.3-codex-spark)
  --reasoning-effort
                  Codex model_reasoning_effort override (default: low)
  --skip-model    Run only mechanical checks, intended for local triage
  --timeout-ms    codex exec timeout in milliseconds (default: 120000)
`);
}

function fail(message) {
  console.error(`[prd-redteam] ${message}`);
  process.exit(2);
}

function check(id, description, passed, evidence = "") {
  return { id, description, passed: Boolean(passed), evidence };
}

function includesAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function matchesAll(text, patterns) {
  return patterns.every((pattern) => pattern.test(text));
}

const REQUIRED_PHASE0_FILES = [
  "docs/plans/2026-06-21-hook-provider-current-behavior-coverage.md",
  "docs/plans/2026-06-21-hook-provider-agent-readiness.md",
  "docs/research/2026-06-21-hermes-agentlog-research.md",
  "docs/research/2026-06-21-hook-provider-abstraction-research.md",
];

function mechanicalChecks(prd, rootDir = process.cwd()) {
  const sections = [
    "## 0. LLM Work Guide",
    "## 1. Goal",
    "## 2. Non-Goals",
    "## 3. Design",
    "## 4. Verification Criteria",
    "## 5. Risks",
    "## 6. Task Checklist",
    "## 7. Open Questions",
    "## 8. Decision Log",
    "## 9. Handoff Snapshot",
    "## 10. Changelog",
  ];

  const phase0Index = prd.indexOf("Phase 0");
  const phase1Index = prd.indexOf("Phase 1");

  return [
    check(
      "required-sections",
      "PRD has all execution sections from work guide through changelog",
      includesAll(prd, sections),
      sections.filter((section) => !prd.includes(section)).join(", ")
    ),
    check(
      "third-provider-rationale",
      "Goal explains why abstraction is justified only at Claude+Codex+Hermes",
      matchesAll(prd, [/third time/i, /Claude \+ Codex \+ Hermes/, /third repeated hook lifecycle path/])
    ),
    check(
      "phase0-before-phase1",
      "Phase 0 behavior lock appears before provider extraction",
      phase0Index >= 0 && phase1Index >= 0 && phase0Index < phase1Index,
      `Phase 0 index=${phase0Index}, Phase 1 index=${phase1Index}`
    ),
    check(
      "phase0-coverage-matrix",
      "Phase 0 requires current behavior coverage matrix before refactoring",
      includesAll(prd, [
        "current behavior coverage matrix",
        "docs/plans/2026-06-21-hook-provider-current-behavior-coverage.md",
        "Claude, Codex, legacy Codex notify, hook parsing, note writing, doctor, init, uninstall, and backfill",
      ])
    ),
    check(
      "phase0-missing-tests",
      "Phase 0 requires missing regression tests before provider extraction",
      includesAll(prd, [
        "Add missing regression tests before refactoring",
        "Missing tests found in Phase 0 are added before provider extraction",
      ])
    ),
    check(
      "phase0-qa-smoke",
      "Phase 0 lists QA smoke commands and isolated hook fixture invocation",
      includesAll(prd, [
        "agentlog doctor",
        "agentlog init --dry-run",
        "agentlog init --codex --dry-run",
        "agentlog backfill --dry-run --format json",
        "hook fixture invocation in an isolated `AGENTLOG_CONFIG_DIR`",
      ])
    ),
    check(
      "phase0-agent-readiness",
      "Phase 0 requires agent-framework readiness review and PRD gap patching",
      includesAll(prd, [
        "Validate agent-framework readiness",
        "docs/plans/2026-06-21-hook-provider-agent-readiness.md",
        "Patch any missing PRD detail discovered during readiness review before code changes",
      ])
    ),
    check(
      "phase0-artifacts-exist",
      "Phase 0 coverage/readiness/research artifacts exist on disk",
      REQUIRED_PHASE0_FILES.every((file) => existsSync(resolve(rootDir, file))),
      REQUIRED_PHASE0_FILES.filter((file) => !existsSync(resolve(rootDir, file))).join(", ")
    ),
    check(
      "non-goals-guardrails",
      "PRD excludes risky or out-of-scope Hermes behavior",
      includesAll(prd, [
        "Do not rewrite the Daily Note writer",
        "Do not add Hermes backfill until Hermes transcript format is separately verified",
        "Do not make EnglishAsk run for Hermes",
        "Do not silently include Hermes in `agentlog init --all`",
        "Do not regex-edit arbitrary YAML for `~/.hermes/config.yaml`",
      ])
    ),
    check(
      "provider-interface",
      "PRD defines a bounded HookProvider interface and target mapping",
      includesAll(prd, [
        "export interface HookProvider",
        "providersForInitTarget(\"all\") === [\"claude\", \"codex\"]",
        "HookProviderId = \"claude\" | \"codex\" | \"hermes\"",
      ])
    ),
    check(
      "hermes-runtime-contract",
      "PRD captures Hermes runtime input, parser, and divider behavior",
      includesAll(prd, [
        "hook_event_name: \"pre_llm_call\"",
        "extra.user_message",
        "agentlog hook --source hermes",
        "[[hermes_sess_abc]]",
      ])
    ),
    check(
      "negative-security-tests",
      "Verification includes unknown source, stdout, and unsupported provider negatives",
      includesAll(prd, [
        "unknown `--source bad`",
        "stdout is empty or `{}`",
        "unsupported provider config shape",
      ])
    ),
    check(
      "research-links",
      "Handoff references both research documents needed by implementation agents",
      includesAll(prd, [
        "docs/research/2026-06-21-hermes-agentlog-research.md",
        "docs/research/2026-06-21-hook-provider-abstraction-research.md",
      ])
    ),
    check(
      "init-hermes-decision",
      "PRD resolves init --hermes as docs-only without Hermes YAML mutation",
      includesAll(prd, [
        "`agentlog init --hermes` is docs-only",
        "does not write `~/.hermes/config.yaml`",
      ])
    ),
    check(
      "backfill-source-contract",
      "PRD explicitly rejects Hermes backfill source until separately specified",
      includesAll(prd, [
        "agentlog backfill --source hermes",
        "Error: --source must be one of: all, claude, codex",
        "Hermes transcript backfill is separately specified",
      ])
    ),
  ];
}

function modelPrompt(prd) {
  return `You are red-teaming an implementation PRD for AgentLog.

Return only compact JSON with this exact shape:
{"verdict":"pass"|"fail","findings":[{"severity":"high"|"medium"|"low","message":"...","evidence":"..."}],"missingRequirements":["..."]}

Pass only if the PRD is executable by a coding agent and fully covers the user's Phase 0 requirement:
- current behavior coverage tests before abstraction
- QA smoke validation tests
- agent-framework readiness validation
- PRD gap patching before provider code changes
- later migration to Hermes only after provider abstraction

Fail if any required Phase 0 deliverable, guardrail, or verification criterion is missing or ambiguous.

PRD:
${prd}`;
}

function extractJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("codex exec returned empty stdout");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("codex exec stdout did not contain a JSON object");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function trimOutput(value, maxChars = 4000) {
  if (!value) return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

function createIsolatedCodexHome(args) {
  const codexHome = mkdtempSync(join(tmpdir(), "agentlog-prd-redteam-codex-"));
  const sourceHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  const authPath = join(sourceHome, "auth.json");
  if (existsSync(authPath)) {
    copyFileSync(authPath, join(codexHome, "auth.json"));
  }
  writeFileSync(
    join(codexHome, "config.toml"),
    [
      `model = "${args.model}"`,
      `model_reasoning_effort = "${args.reasoningEffort}"`,
      `approval_policy = "never"`,
      `sandbox_mode = "danger-full-access"`,
      "",
    ].join("\n"),
    "utf-8"
  );
  return codexHome;
}

function runCodexReview(prd, args) {
  const isolatedCodexHome = createIsolatedCodexHome(args);
  let result;
  try {
    result = spawnSync("codex", [
      "exec",
      "--skip-git-repo-check",
      "--ignore-rules",
      "--ephemeral",
      "-m",
      args.model,
      "-c",
      `model_reasoning_effort="${args.reasoningEffort}"`,
      "--",
      modelPrompt(prd),
    ], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: args.timeoutMs,
      env: {
        ...process.env,
        AGENTLOG_ENGLISHASK_EVAL: "1",
        CODEX_HOME: isolatedCodexHome,
      },
    });
  } finally {
    rmSync(isolatedCodexHome, { recursive: true, force: true });
  }

  if (result.error) {
    return {
      invoked: true,
      verdict: "fail",
      findings: [{ severity: "high", message: result.error.message, evidence: "codex exec failed to start or timed out" }],
      missingRequirements: [],
      stdout: trimOutput(result.stdout ?? ""),
      stderr: trimOutput(result.stderr ?? ""),
      exitCode: result.status ?? null,
      model: args.model,
      reasoningEffort: args.reasoningEffort,
      timeoutMs: args.timeoutMs,
    };
  }

  if (result.status !== 0) {
    return {
      invoked: true,
      verdict: "fail",
      findings: [{ severity: "high", message: `codex exec exited ${result.status}`, evidence: result.stderr.trim() }],
      missingRequirements: [],
      stdout: trimOutput(result.stdout ?? ""),
      stderr: trimOutput(result.stderr ?? ""),
      exitCode: result.status,
      model: args.model,
      reasoningEffort: args.reasoningEffort,
      timeoutMs: args.timeoutMs,
    };
  }

  try {
    const parsed = extractJson(result.stdout ?? "");
    return {
      invoked: true,
      verdict: parsed.verdict === "pass" ? "pass" : "fail",
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      missingRequirements: Array.isArray(parsed.missingRequirements) ? parsed.missingRequirements : [],
      stdout: trimOutput(result.stdout ?? ""),
      stderr: trimOutput(result.stderr ?? ""),
      exitCode: result.status,
      model: args.model,
      reasoningEffort: args.reasoningEffort,
      timeoutMs: args.timeoutMs,
    };
  } catch (error) {
    return {
      invoked: true,
      verdict: "fail",
      findings: [{ severity: "high", message: error.message, evidence: trimOutput(result.stdout ?? "", 1000) }],
      missingRequirements: [],
      stdout: trimOutput(result.stdout ?? ""),
      stderr: trimOutput(result.stderr ?? ""),
      exitCode: result.status,
      model: args.model,
      reasoningEffort: args.reasoningEffort,
      timeoutMs: args.timeoutMs,
    };
  }
}

function summarize(result) {
  console.log(`prd-redteam: ${result.verdict}`);
  console.log(`prd: ${result.prd}`);
  console.log(`mechanical: ${result.mechanical.verdict} (${result.mechanical.passed}/${result.mechanical.total} checks passed)`);
  for (const item of result.mechanical.checks) {
    console.log(`- ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.description}`);
  }
  console.log(`model: ${result.model.invoked ? result.model.verdict : "skipped"}`);
  if (result.model.invoked) {
    console.log(`model config: ${result.model.model} / ${result.model.reasoningEffort} timeout=${result.model.timeoutMs}ms`);
  }
  for (const finding of result.model.findings ?? []) {
    console.log(`- [${finding.severity ?? "unknown"}] ${finding.message}${finding.evidence ? ` (${finding.evidence})` : ""}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const prdPath = resolve(process.cwd(), args.prd);
  if (!existsSync(prdPath)) {
    fail(`PRD not found: ${args.prd}`);
  }

  const prd = readFileSync(prdPath, "utf-8");
  const checks = mechanicalChecks(prd, process.cwd());
  const failed = checks.filter((item) => !item.passed);
  const mechanical = {
    verdict: failed.length === 0 ? "pass" : "fail",
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };

  const model = args.skipModel || mechanical.verdict === "fail"
    ? { invoked: false, verdict: "skipped", findings: [], missingRequirements: [] }
    : runCodexReview(prd, args);

  const result = {
    checkedAt: new Date().toISOString(),
    prd: args.prd,
    verdict: mechanical.verdict === "pass" && (args.skipModel || model.verdict === "pass") ? "pass" : "fail",
    mechanical,
    model,
  };

  if (args.output) {
    const outputPath = resolve(process.cwd(), args.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    summarize(result);
  }

  process.exit(result.verdict === "pass" ? 0 : 1);
}

main();
