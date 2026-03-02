#!/usr/bin/env bun
/**
 * AgentLog CLI
 *
 * Commands:
 *   agentlog init [vault] [--plain]   — configure vault and register Claude Code hook
 *   agentlog detect                   — list detected Obsidian vaults
 *   agentlog hook                     — invoked by Claude Code UserPromptSubmit hook
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { saveConfig, loadConfig, expandHome } from "./config.js";
import { detectVaults, detectCli } from "./detect.js";
import { isVersionAtLeast, MIN_CLI_VERSION } from "./obsidian-cli.js";
import * as readline from "readline";

const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

const HOOK_ENTRY = {
  matcher: "",
  hooks: [
    {
      type: "command",
      command: "agentlog hook",
    },
  ],
};

function usage(): void {
  console.log(`Usage:
  agentlog init [vault] [--plain]   Configure vault and register hook
  agentlog detect                   List detected Obsidian vaults
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
  console.log(`Config saved: ${join(homedir(), ".agentlog", "config.json")}`);
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

function unregisterHook(): boolean {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return false;

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"));
  } catch {
    return false;
  }

  const hooks = settings["hooks"] as Record<string, unknown> | undefined;
  if (!hooks || !Array.isArray(hooks["UserPromptSubmit"])) return false;

  const before = hooks["UserPromptSubmit"] as unknown[];
  const after = before.filter(
    (entry) =>
      !(
        typeof entry === "object" &&
        entry !== null &&
        Array.isArray((entry as Record<string, unknown>)["hooks"]) &&
        ((entry as Record<string, unknown>)["hooks"] as unknown[]).some(
          (h) =>
            typeof h === "object" &&
            h !== null &&
            (h as Record<string, unknown>)["command"] === "agentlog hook"
        )
      )
  );

  if (after.length === before.length) return false; // nothing removed

  hooks["UserPromptSubmit"] = after;
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
  return true;
}

async function cmdUninstall(args: string[]): Promise<void> {
  const skipConfirm = args.includes("-y");
  const configDir = join(homedir(), ".agentlog");

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

  // Remove ~/.agentlog/
  if (existsSync(configDir)) {
    rmSync(configDir, { recursive: true, force: true });
    console.log(`Config removed: ${configDir}`);
  } else {
    console.log(`Config not found (already removed)`);
  }

  console.log("\nAgentLog uninstalled.");
}

function registerHook(): void {
  // Ensure ~/.claude exists
  mkdirSync(join(homedir(), ".claude"), { recursive: true });

  let settings: Record<string, unknown> = {};

  if (existsSync(CLAUDE_SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"));
    } catch {
      // If parse fails, start fresh
      settings = {};
    }
  }

  // Ensure hooks.UserPromptSubmit array exists
  if (typeof settings["hooks"] !== "object" || settings["hooks"] === null) {
    settings["hooks"] = {};
  }
  const hooks = settings["hooks"] as Record<string, unknown>;

  if (!Array.isArray(hooks["UserPromptSubmit"])) {
    hooks["UserPromptSubmit"] = [];
  }
  const upsArr = hooks["UserPromptSubmit"] as unknown[];

  // Idempotent: only add if not already registered
  const alreadyRegistered = upsArr.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      Array.isArray((entry as Record<string, unknown>)["hooks"]) &&
      ((entry as Record<string, unknown>)["hooks"] as unknown[]).some(
        (h) =>
          typeof h === "object" &&
          h !== null &&
          (h as Record<string, unknown>)["command"] === "agentlog hook"
      )
  );

  if (!alreadyRegistered) {
    upsArr.push(HOOK_ENTRY);
  }

  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}

/** Returns true if the agentlog hook is registered in ~/.claude/settings.json */
function isHookRegistered(): boolean {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return false;
  try {
    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
    const hooks = settings["hooks"] as Record<string, unknown> | undefined;
    if (!hooks || !Array.isArray(hooks["UserPromptSubmit"])) return false;
    return (hooks["UserPromptSubmit"] as unknown[]).some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        Array.isArray((entry as Record<string, unknown>)["hooks"]) &&
        ((entry as Record<string, unknown>)["hooks"] as unknown[]).some(
          (h) =>
            typeof h === "object" &&
            h !== null &&
            (h as Record<string, unknown>)["command"] === "agentlog hook"
        )
    );
  } catch {
    return false;
  }
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

  // 4. Obsidian CLI checks (warn-only, skip for plain mode)
  if (!config || !config.plain) {
    const cliWhich = spawnSync("which", ["obsidian"], { encoding: "utf-8", timeout: 3000 });
    const cliBinPath = cliWhich.status === 0 ? cliWhich.stdout.trim() : "";
    check(
      "cli",
      !!cliBinPath,
      cliBinPath || "not found in PATH",
      "Enable CLI in Obsidian Settings > General, then register in PATH",
      true
    );

    if (cliBinPath) {
      // 4a. CLI version + minimum version check
      const cliVer = spawnSync("obsidian", ["version"], { encoding: "utf-8", timeout: 3000 });
      const version = cliVer.status === 0 ? cliVer.stdout.trim() : "";
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

      // 4b. CLI responsive (app running + can communicate)
      const cliProbe = spawnSync("obsidian", ["daily:path"], { encoding: "utf-8", timeout: 3000 });
      check(
        "cli-app",
        cliProbe.status === 0,
        cliProbe.status === 0 ? "responsive" : "app not responding",
        "Start Obsidian app, or check CLI settings",
        true
      );
    }
  }

  // 5. Hook registered
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
