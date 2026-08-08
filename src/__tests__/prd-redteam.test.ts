import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/prd-redteam.mjs", import.meta.url));
const PRD_PATH = "docs/plans/2026-06-21-hook-provider-abstraction-hermes-prd.md";

let tmp: string;

function makeTmp(): string {
  const dir = join(tmpdir(), `agentlog-prd-redteam-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function makeFakeCodex(): { path: string; argsFile: string } {
  const binDir = join(tmp, "bin");
  const argsFile = join(tmp, "codex-args.txt");
  mkdirSync(binDir, { recursive: true });
  const codex = join(binDir, "codex");
  writeFileSync(
    codex,
    `#!/bin/sh
printf '%s\\n' "$@" > ${shQuote(argsFile)}
printf '%s\\n' '{"verdict":"pass","findings":[],"missingRequirements":[]}'
`,
    "utf-8"
  );
  chmodSync(codex, 0o755);
  return {
    path: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    argsFile,
  };
}

async function runRedteam(
  args: string[],
  opts: { PATH?: string; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["node", SCRIPT_PATH, ...args], {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...(opts.PATH ? { PATH: opts.PATH } : {}) },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("PRD red-team verifier", () => {
  beforeEach(() => {
    tmp = makeTmp();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("passes the hook-provider PRD and invokes codex exec with a model-review prompt", async () => {
    const fakeCodex = makeFakeCodex();
    const reportPath = join(tmp, "report.json");

    const result = await runRedteam(["--prd", PRD_PATH, "--output", reportPath], { PATH: fakeCodex.path });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("prd-redteam: pass");

    const codexArgs = readFileSync(fakeCodex.argsFile, "utf-8");
    expect(codexArgs).toStartWith("exec\n--skip-git-repo-check\n--ignore-rules\n--ephemeral\n-m\ngpt-5.3-codex-spark\n-c\n");
    expect(codexArgs).toContain('model_reasoning_effort="low"');
    expect(codexArgs).toContain("\n--\n");
    expect(codexArgs).toContain("current behavior coverage tests before abstraction");
    expect(codexArgs).toContain("agent-framework readiness validation");

    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(report.verdict).toBe("pass");
    expect(report.mechanical.verdict).toBe("pass");
    expect(report.model.invoked).toBe(true);
  });

  it("fails mechanically before codex exec when Phase 0 coverage is missing", async () => {
    const badPrd = join(tmp, "bad-prd.md");
    writeFileSync(
      badPrd,
      "# Hook Provider Abstraction\n\n## 1. Goal\n\nAdd Hermes someday.\n",
      "utf-8"
    );
    const reportPath = join(tmp, "bad-report.json");

    const result = await runRedteam(["--prd", badPrd, "--output", reportPath], { cwd: ROOT });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("mechanical: fail");

    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(report.verdict).toBe("fail");
    expect(report.model.invoked).toBe(false);
    expect(report.mechanical.checks.some((item: { id: string; passed: boolean }) =>
      item.id === "phase0-coverage-matrix" && item.passed === false
    )).toBe(true);
  });

  it("passes mechanical-only triage when --skip-model is set", async () => {
    const result = await runRedteam(["--prd", PRD_PATH, "--skip-model", "--json"]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.verdict).toBe("pass");
    expect(report.mechanical.verdict).toBe("pass");
    expect(report.model.invoked).toBe(false);
  });
});
