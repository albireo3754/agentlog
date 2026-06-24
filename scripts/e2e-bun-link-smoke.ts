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

async function run(cmd: string[], env: Record<string, string>, cwd = process.cwd(), input?: string): Promise<Result> {
  const proc = spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdin: input === undefined ? undefined : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (input !== undefined) {
    proc.stdin.write(input);
    proc.stdin.end();
  }

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
    const hooksJsonPath = join(home, ".codex", "hooks.json");
    if (!existsSync(configJsonPath)) {
      throw new Error(`config.json missing after init: ${configJsonPath}`);
    }
    if (!existsSync(hooksJsonPath)) {
      throw new Error(`hooks.json missing after init: ${hooksJsonPath}`);
    }

    const config = JSON.parse(readFileSync(configJsonPath, "utf-8")) as {
      vault: string;
      plain?: boolean;
      codexNotifyRestore?: string[] | null;
      englishAsk?: {
        enabled?: boolean;
        mode?: string;
        evaluatorCommand?: string[];
      };
    };
    if (config.vault !== notesDir) {
      throw new Error(`config vault mismatch: expected ${notesDir}, got ${config.vault}`);
    }
    if (config.plain !== true) {
      throw new Error("config plain flag was not set to true");
    }

    const hooksJson = readFileSync(hooksJsonPath, "utf-8");
    if (!hooksJson.includes("agentlog hook --source codex")) {
      throw new Error("hooks.json did not register Codex UserPromptSubmit hook");
    }

    const evaluatorPath = join(root, "englishask-eval.sh");
    const evaluatorInputPath = join(root, "englishask-input.txt");
    writeExecutable(
      evaluatorPath,
      `#!/bin/sh
test "$AGENTLOG_ENGLISHASK_EVAL" = "1" || exit 7
cat > "$1"
printf '%s\\n' 'Score: 4/5' 'Natural version: Reply with exactly OK.' 'Missing context: none' 'Rewrite with: exact expected output'
`
    );
    writeFileSync(
      configJsonPath,
      JSON.stringify(
        {
          ...config,
          englishAsk: {
            enabled: true,
            mode: "log-only",
            evaluatorCommand: [evaluatorPath, evaluatorInputPath],
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    const hookFixturePath = join(repoRoot, "src", "__tests__", "fixtures", "codex-hook-user-prompt-submit.json");
    const hookRaw = readFileSync(hookFixturePath, "utf-8");
    const hooked = await run(["agentlog", "hook", "--source", "codex"], env, process.cwd(), hookRaw);
    assertOk(hooked, "agentlog hook --source codex");

    const noteNames = readdirSync(notesDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name));
    if (noteNames.length === 0) {
      throw new Error("daily note was not created by Codex hook");
    }

    const noteContent = readFileSync(join(notesDir, noteNames[0]), "utf-8");
    if (!noteContent.includes("Reply with exactly: OK")) {
      throw new Error("daily note did not include expected prompt text");
    }
    if (!noteContent.includes("## EnglishAsk")) {
      throw new Error("daily note did not include EnglishAsk feedback");
    }
    if (!noteContent.includes("- score: 4/5")) {
      throw new Error("daily note did not include expected EnglishAsk score");
    }
    if (!readFileSync(evaluatorInputPath, "utf-8").includes("User prompt:\nReply with exactly: OK")) {
      throw new Error("EnglishAsk evaluator did not receive the raw prompt");
    }

    const uninstalled = await run(["agentlog", "uninstall", "--codex", "-y"], env);
    assertOk(uninstalled, "agentlog uninstall --codex");

    const postUninstallHooks = existsSync(hooksJsonPath) ? readFileSync(hooksJsonPath, "utf-8") : "";
    if (postUninstallHooks.includes("agentlog hook --source codex")) {
      throw new Error("agentlog Codex hook was still present after uninstall");
    }
    if (!existsSync(configJsonPath)) {
      throw new Error("config.json should remain after uninstall --codex");
    }

    const reinstalled = await run(["agentlog", "init", "--codex", "--plain", notesDir], env);
    assertOk(reinstalled, "reinstall agentlog init --codex --plain");

    const reinstallHooks = readFileSync(hooksJsonPath, "utf-8");
    const hookOccurrences = reinstallHooks.match(/agentlog hook --source codex/g)?.length ?? 0;
    if (hookOccurrences !== 1) {
      throw new Error(`expected exactly one agentlog Codex hook registration, got ${hookOccurrences}`);
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
