#!/usr/bin/env node
/**
 * AgentLog CLI
 *
 * Commands:
 *   agentlog init <vault> [--plain]   — configure vault and register Claude Code hook
 *   agentlog hook                     — invoked by Claude Code UserPromptSubmit hook
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { saveConfig, expandHome } from "./config.js";

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
  agentlog init <vault> [--plain]   Configure vault and register hook
  agentlog hook                     Run hook (called by Claude Code)

Options:
  --plain   Write to plain folder without Obsidian timeblock parsing
`);
}

async function cmdInit(args: string[]): Promise<void> {
  const plainIdx = args.indexOf("--plain");
  const plain = plainIdx !== -1;
  const vaultArgs = args.filter((a) => a !== "--plain");

  if (vaultArgs.length === 0) {
    console.error("Error: vault path required.\n");
    usage();
    process.exit(1);
  }

  const rawVault = vaultArgs[0];
  const vault = resolve(expandHome(rawVault));

  // Vault validation
  if (!plain) {
    const obsidianDir = join(vault, ".obsidian");
    if (!existsSync(obsidianDir)) {
      console.error(`
⚠ Obsidian vault가 감지되지 않았습니다.

1. Obsidian 설치: https://obsidian.md/download
2. vault 생성 후 다시 실행:
   npx agentlog init /path/to/your/vault

또는 일반 폴더에 기록하려면:
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
  console.log(`✓ Config saved: ${join(homedir(), ".agentlog", "config.json")}`);
  console.log(`  vault: ${vault}${plain ? " (plain mode)" : ""}`);

  // Register hook in ~/.claude/settings.json
  registerHook();
  console.log(`✓ Hook registered: ${CLAUDE_SETTINGS_PATH}`);
  console.log(`
AgentLog is ready. Claude Code prompts will be logged to your Daily Note.`);
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
  case "hook":
    await cmdHook();
    break;
  default:
    usage();
    process.exit(command ? 1 : 0);
}
