import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve, join } from "path";
import * as readline from "readline";
import { detectCli } from "./detect.js";
import { configPath, expandHome, loadConfig, saveConfig } from "./config.js";
import { Errors, formatError } from "./errors.js";
import { MIN_CLI_VERSION } from "./obsidian-cli.js";
import type { AgentLogConfig } from "./types.js";

export function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolveAnswer(answer.trim());
    });
  });
}

export function validateVault(vaultArg: string, plain: boolean): { vault: string; error?: string } {
  const vault = resolve(expandHome(vaultArg));

  if (!existsSync(vault)) {
    return { vault, error: formatError(Errors.VAULT_NOT_FOUND(vault)) };
  }

  if (!plain) {
    const obsidianDir = join(vault, ".obsidian");
    if (!existsSync(obsidianDir)) {
      return { vault, error: formatError(Errors.VAULT_NOT_OBSIDIAN(vault)) };
    }
  }

  return { vault };
}

export function validateVaultOrExit(vaultArg: string, plain: boolean): string {
  const { vault, error } = validateVault(vaultArg, plain);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  return vault;
}

export function saveMergedConfig(
  vault: string,
  plain: boolean,
  extra: Partial<AgentLogConfig> = {}
): AgentLogConfig {
  const existing = loadConfig() ?? { vault };
  const next: AgentLogConfig = {
    ...existing,
    ...extra,
    vault,
  };

  if (plain) {
    next.plain = true;
  } else {
    delete next.plain;
  }

  saveConfig(next);
  return next;
}

export function printSavedConfig(vault: string, plain: boolean): void {
  console.log(`Config saved: ${configPath()}`);
  console.log(`  vault: ${vault}${plain ? " (plain mode)" : ""}`);
}

export function printObsidianCliStatus(plain: boolean): void {
  if (plain) return;

  const cli = detectCli();
  if (cli.installed) {
    console.log(`  Obsidian CLI: detected (${cli.version ?? "unknown version"})`);
    console.log(`  Daily notes will be written via CLI when Obsidian is running.`);
  } else {
    console.log(`  Obsidian CLI: not detected (using direct file write)`);
    console.log(`  For better integration, enable CLI in Obsidian ${MIN_CLI_VERSION}+ Settings.`);
  }
}

export function detectBinary(bin: "agentlog" | "codex"): string {
  const result = spawnSync("/bin/sh", ["-lc", `command -v ${bin}`], {
    encoding: "utf-8",
  });
  if (result.status !== 0) return "";
  return (result.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
}
