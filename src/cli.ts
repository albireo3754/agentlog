#!/usr/bin/env bun
/**
 * AgentLog CLI
 *
 * Commands:
 *   agentlog init [vault] [--plain]   — configure vault and register Claude Code hook
 *   agentlog detect                   — list detected Obsidian vaults
 *   agentlog hook                     — invoked by Claude Code UserPromptSubmit hook
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { saveConfig, expandHome } from "./config.js";
import { detectVaults } from "./detect.js";
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
  agentlog hook                     Run hook (called by Claude Code)

Options:
  --plain   Write to plain folder without Obsidian timeblock parsing
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
  case "hook":
    await cmdHook();
    break;
  default:
    usage();
    process.exit(command ? 1 : 0);
}
