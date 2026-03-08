import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { detectPhase, formatVersionOutput, getRuntimeInfo } from "../version-info.js";

describe("detectPhase", () => {
  it("prefers AGENTLOG_PHASE override when provided", () => {
    expect(
      detectPhase({
        env: { AGENTLOG_PHASE: "dev" },
        packageRoot: "/tmp/pkg",
      })
    ).toBe("dev");
  });

  it("reports prod when package root has no git metadata", () => {
    expect(
      detectPhase({
        env: {},
        packageRoot: "/tmp/pkg",
      })
    ).toBe("prod");
  });

  it("reports dev when package root is nested inside a git work tree", () => {
    const repoRoot = join(tmpdir(), `agentlog-phase-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const packageRoot = join(repoRoot, "packages", "agentlog");

    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(repoRoot, ".git"), "gitdir: /tmp/fake-worktree", "utf-8");

    expect(
      detectPhase({
        env: {},
        packageRoot,
      })
    ).toBe("dev");

    rmSync(repoRoot, { recursive: true, force: true });
  });
});

describe("getRuntimeInfo", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `agentlog-version-info-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ version: "9.9.9" }),
      "utf-8"
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads version from the package root and keeps phase override deterministic", () => {
    expect(
      getRuntimeInfo({
        env: { AGENTLOG_PHASE: "prod" },
        packageRoot: tmpDir,
      })
    ).toEqual({
      version: "9.9.9",
      channel: "prod",
      commit: null,
      packageRoot: tmpDir,
    });
  });

  it("does not invent git metadata when dev is forced outside a git work tree", () => {
    expect(
      getRuntimeInfo({
        env: { AGENTLOG_PHASE: "dev" },
        packageRoot: tmpDir,
      })
    ).toEqual({
      version: "9.9.9",
      channel: "dev",
      commit: null,
      packageRoot: tmpDir,
    });
  });
});

describe("formatVersionOutput", () => {
  it("formats prod as a headline only", () => {
    expect(
      formatVersionOutput({
        version: "0.1.1",
        channel: "prod",
          commit: null,
        packageRoot: "/tmp/pkg",
      })
    ).toBe("AgentLog 0.1.1");
  });

  it("formats dev with commit", () => {
    expect(
      formatVersionOutput({
        version: "0.1.1",
        channel: "dev",
        commit: "67f28cf",
        packageRoot: "/tmp/pkg",
      })
    ).toBe("AgentLog 0.1.1\nchannel: dev\ncommit: 67f28cf");
  });

  it("formats dev without commit when git metadata is unavailable", () => {
    expect(
      formatVersionOutput({
        version: "0.1.1",
        channel: "dev",
          commit: null,
        packageRoot: "/tmp/pkg",
      })
    ).toBe("AgentLog 0.1.1\nchannel: dev");
  });
});
