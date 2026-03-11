#!/usr/bin/env bun

import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { spawn } from "bun";
import { dirname, join } from "path";
import { tmpdir } from "os";

interface Result {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function run(cmd: string[], env: Record<string, string>, cwd = process.cwd()): Promise<Result> {
  const proc = spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

function assertOk(result: Result, label: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents, "utf-8");
  chmodSync(path, 0o755);
}

async function main(): Promise<void> {
  const repoRoot = join(import.meta.dir, "..");
  const bunBinDir = dirname(process.execPath);
  const root = mkdtempSync(join(tmpdir(), "agentlog-install-smoke-"));
  const home = join(root, "home");
  const bunInstall = join(root, "bun-install");
  const binDir = join(root, "bin");
  const notesDir = join(root, "notes");
  const vaultDir = join(root, "vault");

  mkdirSync(home, { recursive: true });
  mkdirSync(bunInstall, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(notesDir, { recursive: true });
  mkdirSync(vaultDir, { recursive: true });

  try {
    console.log(`temp root: ${root}`);
    console.log(`temp home: ${home}`);
    console.log(`temp bun install: ${bunInstall}`);

    const env = {
      HOME: home,
      BUN_INSTALL: bunInstall,
      PATH: `${binDir}:${join(bunInstall, "bin")}:${bunBinDir}:/usr/bin:/bin`,
      AGENTLOG_CONFIG_DIR: join(home, ".agentlog"),
    };

    writeExecutable(join(binDir, "codex"), "#!/bin/sh\nexit 0\n");

    const linked = await run(
      [process.execPath, "link"],
      env,
      repoRoot
    );
    assertOk(linked, "bun link");

    const resolved = await run(
      ["/bin/sh", "-lc", "command -v agentlog"],
      env
    );
    assertOk(resolved, "resolve agentlog after bun link");
    if (!resolved.stdout.trim()) {
      throw new Error("agentlog binary not found after bun link");
    }

    const help = await run(["agentlog"], env);
    assertOk(help, "agentlog help");
    if (!help.stdout.includes("Usage:")) {
      throw new Error("agentlog help output did not include Usage");
    }

    const installed = await run(["agentlog", "init", "--codex", "--plain", notesDir], env);
    assertOk(installed, "agentlog init --codex --plain");

    const configJsonPath = join(home, ".agentlog", "config.json");
    const configTomlPath = join(home, ".codex", "config.toml");
    if (!existsSync(configJsonPath)) {
      throw new Error(`config.json missing after init: ${configJsonPath}`);
    }
    if (!existsSync(configTomlPath)) {
      throw new Error(`config.toml missing after init: ${configTomlPath}`);
    }

    const config = JSON.parse(readFileSync(configJsonPath, "utf-8")) as {
      vault: string;
      plain?: boolean;
      codexNotifyRestore?: string[] | null;
    };
    if (config.vault !== notesDir) {
      throw new Error(`config vault mismatch: expected ${notesDir}, got ${config.vault}`);
    }
    if (config.plain !== true) {
      throw new Error("config plain flag was not set to true");
    }

    const configToml = readFileSync(configTomlPath, "utf-8");
    if (!configToml.includes('notify = ["agentlog", "codex-notify"]')) {
      throw new Error("config.toml did not register Codex notify");
    }

    const notifyFixturePath = join(repoRoot, "src", "__tests__", "fixtures", "codex-notify-single.json");
    const notifyRaw = readFileSync(notifyFixturePath, "utf-8");
    const notified = await run(["agentlog", "codex-notify", notifyRaw], env);
    assertOk(notified, "agentlog codex-notify");

    const noteNames = readdirSync(notesDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name));
    if (noteNames.length === 0) {
      throw new Error("daily note was not created by codex notify");
    }

    const noteContent = readFileSync(join(notesDir, noteNames[0]), "utf-8");
    if (!noteContent.includes("Reply with exactly: OK")) {
      throw new Error("daily note did not include expected prompt text");
    }

    const uninstalled = await run(["agentlog", "uninstall", "--codex", "-y"], env);
    assertOk(uninstalled, "agentlog uninstall --codex");

    const postUninstallToml = readFileSync(configTomlPath, "utf-8");
    if (postUninstallToml.includes('notify = ["agentlog", "codex-notify"]')) {
      throw new Error("agentlog notify was still present after uninstall");
    }
    if (!existsSync(configJsonPath)) {
      throw new Error("config.json should remain after uninstall --codex");
    }

    const reinstalled = await run(["agentlog", "init", "--codex", "--plain", notesDir], env);
    assertOk(reinstalled, "reinstall agentlog init --codex --plain");

    const reinstallToml = readFileSync(configTomlPath, "utf-8");
    const notifyOccurrences = reinstallToml.match(/notify = \["agentlog", "codex-notify"\]/g)?.length ?? 0;
    if (notifyOccurrences !== 1) {
      throw new Error(`expected exactly one agentlog notify registration, got ${notifyOccurrences}`);
    }

    const doctor = await run(["agentlog", "doctor"], env);
    assertOk(doctor, "agentlog doctor");
    if (!doctor.stdout.includes("All checks passed.")) {
      throw new Error("doctor output did not report success");
    }
    if (!doctor.stdout.includes("codex")) {
      throw new Error("doctor output did not include codex status");
    }

    mkdirSync(join(vaultDir, ".obsidian"), { recursive: true });
    const vaultInstalled = await run(["agentlog", "init", "--codex", vaultDir], env);
    assertOk(vaultInstalled, "agentlog init --codex <vault>");

    const vaultConfig = JSON.parse(readFileSync(configJsonPath, "utf-8")) as {
      vault: string;
      plain?: boolean;
    };
    if (vaultConfig.vault !== vaultDir) {
      throw new Error(`vault-mode config mismatch: expected ${vaultDir}, got ${vaultConfig.vault}`);
    }
    if (vaultConfig.plain === true) {
      throw new Error("vault-mode install should not persist plain=true");
    }

    rmSync(vaultDir, { recursive: true, force: true });
    if (existsSync(vaultDir)) {
      throw new Error("disposable vault cleanup failed");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
