#!/usr/bin/env bun
/**
 * AgentLog CLI
 *
 * Commands:
 *   agentlog init [vault] [--plain]   — configure vault and register Claude Code hook
 *   agentlog detect                   — list detected Obsidian vaults
 *   agentlog hook                     — invoked by Claude Code UserPromptSubmit hook
 */

import { existsSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { saveConfig, loadConfig, expandHome, configPath, configDir } from "./config.js";
import { detectVaults, detectCli } from "./detect.js";
import { isVersionAtLeast, MIN_CLI_VERSION, resolveCliBin, parseCliVersion } from "./obsidian-cli.js";
import { registerHook, unregisterHook, isHookRegistered, CLAUDE_SETTINGS_PATH } from "./claude-settings.js";
import * as readline from "readline";

function usage(): void {
  console.log(`Usage:
  agentlog init [vault] [--plain]   Configure vault and register hook
  agentlog detect                   List detected Obsidian vaults
  agentlog codex-debug <prompt>     Run codex exec with a test prompt
  agentlog codex-notify             Handle Codex notify callback (internal)
  agentlog doctor                   Check installation health
  agentlog open                     Open today's Daily Note in Obsidian (CLI)
  agentlog uninstall                Remove hook and config
  agentlog hook                     Run hook (called by Claude Code)

Options:
  --plain       Write to plain folder without Obsidian timeblock parsing
  -y            Skip confirmation prompt (for uninstall)
`);
}

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function runInit(vaultArg: string, plain: boolean): Promise<void> {
  const vault = resolve(expandHome(vaultArg));

  // Vault validation
  if (!plain) {
    const obsidianDir = join(vault, ".obsidian");
    if (!existsSync(obsidianDir)) {
      console.error(`
Warning: Obsidian vault not detected at: ${vault}

1. Install Obsidian: https://obsidian.md/download
2. Open the folder as a vault, then run:
   npx agentlog init /path/to/your/vault

Or to write to a plain folder:
   npx agentlog init --plain ~/notes
`);
      process.exit(1);
    }
  } else {
    // Plain mode: just check the directory exists
    if (!existsSync(vault)) {
      console.error(`Error: directory not found: ${vault}`);
      process.exit(1);
    }
  }

  // Save config
  saveConfig({ vault, ...(plain ? { plain: true } : {}) });
  console.log(`Config saved: ${configPath()}`);
  console.log(`  vault: ${vault}${plain ? " (plain mode)" : ""}`);

  // Probe CLI availability (informational)
  if (!plain) {
    const cli = detectCli();
    if (cli.installed) {
      console.log(`  Obsidian CLI: detected (${cli.version ?? "unknown version"})`);
      console.log(`  Daily notes will be written via CLI when Obsidian is running.`);
    } else {
      console.log(`  Obsidian CLI: not detected (using direct file write)`);
      console.log(`  For better integration, enable CLI in Obsidian 1.12+ Settings.`);
    }
  }

  // Register hook in ~/.claude/settings.json
  registerHook();
  console.log(`Hook registered: ${CLAUDE_SETTINGS_PATH}`);
  console.log(`
AgentLog is ready. Claude Code prompts will be logged to your Daily Note.`);
}

async function interactiveInit(plain: boolean): Promise<void> {
  if (plain) {
    const folder = await ask("Enter folder path for plain mode: ");
    if (!folder) {
      console.error("No path provided.");
      process.exit(1);
    }
    await runInit(folder, true);
    return;
  }

  const vaults = detectVaults();

  if (vaults.length === 0) {
    // F4: No vaults found
    console.log("No Obsidian vaults detected.\n");
    console.log("Options:");
    console.log("  a) Install Obsidian: https://obsidian.md");
    console.log("     brew install --cask obsidian");
    console.log("     Then run: agentlog init ~/path/to/vault");
    console.log("");
    console.log("  b) Use plain mode (any folder):");
    console.log("     agentlog init --plain ~/Documents/notes");
    console.log("");

    if (!process.stdin.isTTY) return;

    const choice = await ask("Choose [a/b]: ");
    if (choice.toLowerCase() === "b") {
      const folder = await ask("Enter folder path: ");
      if (folder) await runInit(folder, true);
    } else {
      console.log("\nVisit https://obsidian.md to install Obsidian.");
      console.log("After installing, run: agentlog init ~/path/to/vault");
    }
    return;
  }

  if (vaults.length === 1) {
    const v = vaults[0];
    console.log(`Detected vault: ${v.path}`);
    if (!process.stdin.isTTY) {
      await runInit(v.path, false);
      return;
    }
    const confirm = await ask("Use this vault? [Y/n]: ");
    if (confirm === "" || confirm.toLowerCase() === "y") {
      await runInit(v.path, false);
    } else {
      const manual = await ask("Enter vault path manually: ");
      if (manual) await runInit(manual, false);
    }
    return;
  }

  // Multiple vaults
  console.log("Detected Obsidian vaults:");
  vaults.forEach((v, i) => console.log(`  ${i + 1}) ${v.path}`));
  console.log("");

  if (!process.stdin.isTTY) {
    console.log(`Auto-selecting vault: ${vaults[0].path}`);
    await runInit(vaults[0].path, false);
    return;
  }

  const choice = await ask("Select vault [1]: ");
  const idx = choice === "" ? 0 : parseInt(choice, 10) - 1;
  const selected = vaults[idx] ?? vaults[0];
  await runInit(selected.path, false);
}

async function cmdInit(args: string[]): Promise<void> {
  const plain = args.includes("--plain");
  const filteredArgs = args.filter((a) => a !== "--plain");
  const vaultArg = filteredArgs[0] ?? "";

  if (!vaultArg) {
    await interactiveInit(plain);
    return;
  }

  await runInit(vaultArg, plain);
}

/** agentlog detect — list detected Obsidian vaults */
async function cmdDetect(): Promise<void> {
  const vaults = detectVaults();
  if (vaults.length === 0) {
    console.log("No Obsidian vaults detected.");
    console.log("\nOptions:");
    console.log("  Install Obsidian: https://obsidian.md");
    console.log("  Or use plain mode: agentlog init --plain ~/path/to/folder");
    return;
  }
  console.log("Detected Obsidian vaults:");
  vaults.forEach((v, i) => {
    console.log(`  ${i + 1}) ${v.path}`);
  });

  // CLI detection
  const cli = detectCli();
  console.log("");
  if (cli.installed) {
    console.log(`Obsidian CLI: ${cli.binPath} (${cli.version ?? "version unknown"})`);
  } else {
    console.log("Obsidian CLI: not detected");
    console.log("  Enable in Obsidian 1.12+ Settings > General > Command line interface");
  }
}

async function cmdUninstall(args: string[]): Promise<void> {
  const skipConfirm = args.includes("-y");
  const cfgDir = configDir();

  if (!skipConfirm && process.stdin.isTTY) {
    const answer = await ask("Remove AgentLog hook and config? [y/N]: ");
    if (answer.toLowerCase() !== "y") {
      console.log("Aborted.");
      return;
    }
  }

  // Remove hook from ~/.claude/settings.json
  const hookRemoved = unregisterHook();
  if (hookRemoved) {
    console.log(`Hook removed: ${CLAUDE_SETTINGS_PATH}`);
  } else {
    console.log(`Hook not found (already removed or never registered)`);
  }

  // Remove config directory
  if (existsSync(cfgDir)) {
    rmSync(cfgDir, { recursive: true, force: true });
    console.log(`Config removed: ${cfgDir}`);
  } else {
    console.log(`Config not found (already removed)`);
  }

  console.log("\nAgentLog uninstalled.");
}

/** agentlog doctor — check installation health */
async function cmdDoctor(): Promise<void> {
  // Show agentlog version
  try {
    const pkgPath = join(import.meta.dir ?? new URL(".", import.meta.url).pathname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    if (pkg.version) console.log(`agentlog v${pkg.version}\n`);
  } catch {
    // version display is best-effort
  }

  let allOk = true;

  function check(label: string, ok: boolean, detail: string, hint?: string, warnOnly?: boolean): void {
    const icon = ok ? "✅" : warnOnly ? "⚠️" : "❌";
    const suffix = !ok && hint ? `  →  ${hint}` : "";
    console.log(`${icon} ${label.padEnd(10)} ${detail}${suffix}`);
    if (!ok && !warnOnly) allOk = false;
  }

  // 1. Binary in PATH
  const which = spawnSync("which", ["agentlog"], { encoding: "utf-8" });
  const binPath = which.status === 0 ? which.stdout.trim() : "";
  check("binary", !!binPath, binPath || "not found in PATH", "run: npm install -g agentlog");

  // 2. Vault (covers both config presence and vault validity)
  const config = loadConfig();
  if (!config) {
    check("vault", false, "not configured", "run: agentlog init ~/path/to/vault");
  } else if (config.plain) {
    const vaultOk = existsSync(config.vault);
    check(
      "vault",
      vaultOk,
      vaultOk ? `${config.vault} (plain mode)` : `${config.vault} — directory not found`,
      vaultOk ? undefined : "run: agentlog init ~/new/path"
    );
  } else {
    const vaultOk = existsSync(join(config.vault, ".obsidian"));
    check(
      "vault",
      vaultOk,
      vaultOk ? config.vault : `${config.vault} — .obsidian not found`,
      vaultOk ? undefined : "open this folder in Obsidian, or run: agentlog init ~/new/vault"
    );
  }

  // 3. Obsidian app installed (macOS only, skip for plain mode)
  if (process.platform === "darwin" && (!config || !config.plain)) {
    const obsidianPaths = [
      "/Applications/Obsidian.app",
      join(homedir(), "Applications", "Obsidian.app"),
    ];
    const foundPath = obsidianPaths.find((p) => existsSync(p));
    check(
      "obsidian",
      !!foundPath,
      foundPath ?? "not installed",
      "brew install --cask obsidian  or  https://obsidian.md/download"
    );
  }

  // 5. Obsidian CLI checks (warn-only, skip for plain mode)
  if (!config || !config.plain) {
    const cliBinPath = resolveCliBin();
    check(
      "cli",
      !!cliBinPath,
      cliBinPath || "not found",
      "Enable CLI in Obsidian Settings > General, then register in PATH (or set OBSIDIAN_BIN)",
      true
    );

    if (cliBinPath) {
      // 5a. CLI version + minimum version check
      const cliVer = spawnSync(cliBinPath, ["version"], { encoding: "utf-8", timeout: 3000 });
      // stdout may contain warning lines before the version; take the last non-empty line
      const version = cliVer.status === 0 ? (parseCliVersion(cliVer.stdout ?? "") ?? "") : "";
      if (version) {
        const meetsMin = isVersionAtLeast(version, MIN_CLI_VERSION);
        check(
          "cli-ver",
          meetsMin,
          meetsMin ? version : `${version} (requires ${MIN_CLI_VERSION}+)`,
          meetsMin ? undefined : `Update Obsidian: https://help.obsidian.md/updates`,
          true
        );
      } else {
        check("cli-ver", false, "could not determine version", "Ensure Obsidian app is running", true);
      }

      // 5b. CLI responsive (app running + can communicate)
      const cliProbe = spawnSync(cliBinPath, ["daily:path"], { encoding: "utf-8", timeout: 3000 });
      check(
        "cli-app",
        cliProbe.status === 0,
        cliProbe.status === 0 ? "responsive" : "app not responding",
        "Start Obsidian app, or check CLI settings",
        true
      );

      // 5c. Daily note status (only when CLI is responsive)
      if (cliProbe.status === 0) {
        const dailyRead = spawnSync(cliBinPath, ["daily:read"], { encoding: "utf-8", timeout: 3000 });
        const noteExists = dailyRead.status === 0 && (dailyRead.stdout ?? "").trim().length > 0;
        check(
          "daily",
          noteExists,
          noteExists ? "today's note exists" : "today's note not found (will be created on first log)",
          undefined,
          true
        );
      }
    }
  }

  // 6. Hook registered
  const hookOk = isHookRegistered();
  check(
    "hook",
    hookOk,
    hookOk ? CLAUDE_SETTINGS_PATH : "not registered",
    "run: agentlog init  to re-register"
  );

  console.log("");
  if (allOk) {
    console.log("All checks passed.");
  } else {
    console.log("Some checks failed. Fix the issues above and re-run: agentlog doctor");
    process.exit(1);
  }
}

/** agentlog open — open today's Daily Note in Obsidian via CLI */
async function cmdOpen(): Promise<void> {
  const proc = spawnSync("obsidian", ["daily"], {
    encoding: "utf-8",
    timeout: 5000,
  });
  if (proc.status === 0) {
    console.log("Opened today's Daily Note in Obsidian.");
  } else {
    console.error("Failed to open. Is Obsidian running with CLI enabled?");
    console.error("  Enable CLI in Obsidian 1.12+ Settings > General > Command line interface");
    process.exit(1);
  }
}

async function cmdCodexDebug(args: string[]): Promise<void> {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    console.error("Error: prompt is required");
    process.exit(1);
  }

  // Ensure codex notify is registered so logging works
  const { registerCodexNotify } = await import("./codex-settings.js");
  const config = loadConfig();
  const result = registerCodexNotify(config?.codexNotifyRestore ?? null);
  if (result.changed) {
    console.log("[agentlog] codex notify registered");
    // Persist restore state so uninstall can undo it
    if (config) {
      saveConfig({ ...config, codexNotifyRestore: result.restoreNotify });
    }
  }

  const proc = spawnSync("codex", ["exec", "--", prompt], {
    stdio: "inherit",
  });

  if (proc.error) {
    console.error(`Failed to run codex exec: ${proc.error.message}`);
    process.exit(1);
  }

  process.exit(proc.status ?? 1);
}

async function cmdCodexNotify(args: string[]): Promise<void> {
  const { runCodexNotify } = await import("./codex-notify.js");
  const rawArg = args.length > 0 ? args.join(" ") : undefined;
  await runCodexNotify(rawArg);
}

async function cmdHook(): Promise<void> {
  // Dynamically import hook to avoid loading it unless needed
  await import("./hook.js");
}

// --- Main dispatch ---

const [, , command, ...rest] = process.argv;

switch (command) {
  case "init":
    await cmdInit(rest);
    break;
  case "detect":
    await cmdDetect();
    break;
  case "doctor":
    await cmdDoctor();
    break;
  case "codex-debug":
    await cmdCodexDebug(rest);
    break;
  case "codex-notify":
    await cmdCodexNotify(rest);
    break;
  case "open":
    await cmdOpen();
    break;
  case "uninstall":
    await cmdUninstall(rest);
    break;
  case "hook":
    await cmdHook();
    break;
  default:
    usage();
    process.exit(command ? 1 : 0);
}
