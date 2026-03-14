#!/usr/bin/env bun
/**
 * AgentLog CLI
 *
 * Commands:
 *   agentlog init [vault] [--plain] [--claude | --codex | --all]
 *                                   — configure Claude hook, Codex notify, or both
 *   agentlog uninstall [-y] [--codex | --all]
 *                                   — remove Claude hook, Codex notify, or both
 *   agentlog detect                   — list detected Obsidian vaults
 *   agentlog hook                     — invoked by Claude Code UserPromptSubmit hook
 *   agentlog codex-notify             — invoked by Codex notify on agent-turn-complete
 */

import { existsSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { saveConfig, loadConfig, expandHome, configPath, configDir } from "./config.js";
import type { AgentLogConfig } from "./types.js";
import { detectVaults, detectCli } from "./detect.js";
import { isVersionAtLeast, MIN_CLI_VERSION, resolveCliBin, parseCliVersion } from "./obsidian-cli.js";
import { registerHook, unregisterHook, isHookRegistered, CLAUDE_SETTINGS_PATH } from "./claude-settings.js";
import { Errors, formatError } from "./errors.js";
import {
  CODEX_CONFIG_PATH,
  readCodexNotifyState,
  registerCodexNotify,
  unregisterCodexNotify,
} from "./codex-settings.js";
import { formatVersionHeadline, formatVersionOutput, getRuntimeInfo, readVersion, resolvePackageRoot } from "./version-info.js";
import * as readline from "readline";
import { Command } from "commander";

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function validateVault(vaultArg: string, plain: boolean): { vault: string; error?: string } {
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

function validateVaultOrExit(vaultArg: string, plain: boolean): string {
  const { vault, error } = validateVault(vaultArg, plain);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  return vault;
}

function saveMergedConfig(
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

function printSavedConfig(vault: string, plain: boolean): void {
  console.log(`Config saved: ${configPath()}`);
  console.log(`  vault: ${vault}${plain ? " (plain mode)" : ""}`);
}

function printObsidianCliStatus(plain: boolean): void {
  if (plain) return;

  const cli = detectCli();
  if (cli.installed) {
    console.log(`  Obsidian CLI: detected (${cli.version ?? "unknown version"})`);
    console.log(`  Daily notes will be written via CLI when Obsidian is running.`);
  } else {
    console.log(`  Obsidian CLI: not detected (using direct file write)`);
    console.log(`  For better integration, enable CLI in Obsidian 1.12+ Settings.`);
  }
}

function detectBinary(bin: "agentlog" | "codex"): string {
  const result = spawnSync("/bin/sh", ["-lc", `command -v ${bin}`], {
    encoding: "utf-8",
  });
  if (result.status !== 0) return "";
  return (result.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
}

type InitTarget = "claude" | "codex" | "all";
type UninstallTarget = "claude" | "codex" | "all";

async function runInit(vaultArg: string, plain: boolean): Promise<void> {
  const vault = validateVaultOrExit(vaultArg, plain);

  saveMergedConfig(vault, plain);
  printSavedConfig(vault, plain);
  printObsidianCliStatus(plain);

  // Register hook in ~/.claude/settings.json
  registerHook();
  console.log(`Hook registered: ${CLAUDE_SETTINGS_PATH}`);
  console.log(`
AgentLog is ready. Claude Code prompts will be logged to your Daily Note.`);
}

async function runCodexInit(vaultArg: string, plain: boolean): Promise<void> {
  const codexBin = detectBinary("codex");
  if (!codexBin) {
    console.error("Error: Codex CLI not found in PATH");
    process.exit(1);
  }

  const vault = validateVaultOrExit(vaultArg, plain);
  const existing = loadConfig();
  const result = registerCodexNotify(existing?.codexNotifyRestore ?? null);

  saveMergedConfig(vault, plain, { codexNotifyRestore: result.restoreNotify });
  printSavedConfig(vault, plain);
  printObsidianCliStatus(plain);
  console.log(`  Codex CLI: ${codexBin}`);
  console.log(`Codex notify registered: ${CODEX_CONFIG_PATH}`);
  if (result.restoreNotify) {
    console.log(`  Previous notify preserved for forwarding (${result.restoreNotify[0]})`);
  }
  console.log(`
AgentLog is ready. Codex turns will be logged to your Daily Note.`);
}

async function runAllInit(vaultArg: string, plain: boolean): Promise<void> {
  const codexBin = detectBinary("codex");
  if (!codexBin) {
    console.error("Error: Codex CLI not found in PATH");
    process.exit(1);
  }

  const vault = validateVaultOrExit(vaultArg, plain);
  const existing = loadConfig();
  const result = registerCodexNotify(existing?.codexNotifyRestore ?? null);

  saveMergedConfig(vault, plain, { codexNotifyRestore: result.restoreNotify });
  printSavedConfig(vault, plain);
  printObsidianCliStatus(plain);

  registerHook();
  console.log(`Hook registered: ${CLAUDE_SETTINGS_PATH}`);
  console.log(`  Codex CLI: ${codexBin}`);
  console.log(`Codex notify registered: ${CODEX_CONFIG_PATH}`);
  if (result.restoreNotify) {
    console.log(`  Previous notify preserved for forwarding (${result.restoreNotify[0]})`);
  }
  console.log(`
AgentLog is ready. Claude Code prompts and Codex turns will be logged to your Daily Note.`);
}

async function interactiveInit(
  plain: boolean,
  runner: (vault: string, plain: boolean) => Promise<void> = runInit
): Promise<void> {
  if (plain) {
    const folder = await ask("Enter folder path for plain mode: ");
    if (!folder) {
      console.error("No path provided.");
      process.exit(1);
    }
    await runner(folder, true);
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
      if (folder) await runner(folder, true);
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
      await runner(v.path, false);
      return;
    }
    const confirm = await ask("Use this vault? [Y/n]: ");
    if (confirm === "" || confirm.toLowerCase() === "y") {
      await runner(v.path, false);
    } else {
      const manual = await ask("Enter vault path manually: ");
      if (manual) await runner(manual, false);
    }
    return;
  }

  // Multiple vaults
  console.log("Detected Obsidian vaults:");
  vaults.forEach((v, i) => console.log(`  ${i + 1}) ${v.path}`));
  console.log("");

  if (!process.stdin.isTTY) {
    console.log(`Auto-selecting vault: ${vaults[0].path}`);
    await runner(vaults[0].path, false);
    return;
  }

  const choice = await ask("Select vault [1]: ");
  const idx = choice === "" ? 0 : parseInt(choice, 10) - 1;
  const selected = vaults[idx] ?? vaults[0];
  await runner(selected.path, false);
}

function uninstallClaude(configDirPath: string): void {
  // Remove hook from ~/.claude/settings.json
  const hookRemoved = unregisterHook();
  if (hookRemoved) {
    console.log(`Hook removed: ${CLAUDE_SETTINGS_PATH}`);
  } else {
    console.log(`Hook not found (already removed or never registered)`);
  }

  // Remove config directory
  if (existsSync(configDirPath)) {
    rmSync(configDirPath, { recursive: true, force: true });
    console.log(`Config removed: ${configDirPath}`);
  } else {
    console.log(`Config not found (already removed)`);
  }

  console.log("\nAgentLog uninstalled.");
}

function uninstallCodex(clearRestoreMetadata: boolean): void {
  const config = loadConfig();
  const result = unregisterCodexNotify(config?.codexNotifyRestore ?? null);
  if (result.changed) {
    console.log(`Codex notify restored: ${CODEX_CONFIG_PATH}`);
  } else {
    console.log("Codex notify not found (already removed or never registered)");
  }

  if (clearRestoreMetadata && config) {
    const next: AgentLogConfig = { ...config };
    delete next.codexNotifyRestore;
    saveConfig(next);
  }

  console.log("\nCodex integration uninstalled.");
}

// --- Command implementations ---

async function cmdInitDryRun(vaultArg: string, plain: boolean, target: string): Promise<void> {
  if (!vaultArg && target !== "codex") {
    console.error("Error: --dry-run requires a vault path argument");
    process.exit(1);
  }

  if (vaultArg) {
    const { vault, error } = validateVault(vaultArg, plain);
    if (error) {
      console.error(error);
      process.exit(1);
    }
  }

  const cfgPath = configPath();
  const claudeSettingsPath = CLAUDE_SETTINGS_PATH;

  console.log("[dry-run] Validation passed. No changes were made.");
  if (target === "hook" || target === "all") {
    console.log(`  Would save config to: ${cfgPath}`);
    if (vaultArg) console.log(`    vault: ${resolve(expandHome(vaultArg))}${plain ? " (plain mode)" : ""}`);
    console.log(`  Would register hook in: ${claudeSettingsPath}`);
  }
  if (target === "codex" || target === "all") {
    console.log(`  Would register codex notify integration`);
  }
}

async function cmdInit(vaultArg: string | undefined, opts: { plain: boolean; claude: boolean; codex: boolean; all: boolean; dryRun: boolean }): Promise<void> {
  const { plain, dryRun } = opts;

  if ((opts.all && (opts.claude || opts.codex)) || (opts.claude && opts.codex)) {
    console.error("Error: choose exactly one target: --claude, --codex, or --all");
    process.exit(1);
  }

  const target: InitTarget = opts.all ? "all" : opts.codex ? "codex" : "claude";

  if (dryRun) {
    await cmdInitDryRun(vaultArg ?? "", plain, target === "claude" ? "hook" : target);
    return;
  }

  const runner = target === "all" ? runAllInit : target === "codex" ? runCodexInit : runInit;

  if (!vaultArg) {
    await interactiveInit(plain, runner);
    return;
  }

  await runner(vaultArg, plain);
}

async function cmdDetect(opts: { format: string; fields?: string }): Promise<void> {
  const vaults = detectVaults();
  const cli = detectCli();

  if (opts.format === "json") {
    let vaultData: Array<Record<string, unknown>> = vaults.map((v) => ({ path: v.path }));
    const cliData: Record<string, unknown> = {
      installed: cli.installed,
      binPath: cli.binPath ?? null,
      version: cli.version ?? null,
    };

    if (opts.fields) {
      const fields = opts.fields.split(",").map((f) => f.trim());
      vaultData = vaultData.map((v) => {
        const filtered: Record<string, unknown> = {};
        for (const f of fields) {
          if (f in v) filtered[f] = v[f];
        }
        return filtered;
      });
      const filteredCli: Record<string, unknown> = {};
      for (const f of fields) {
        if (f in cliData) filteredCli[f] = cliData[f];
      }
      console.log(JSON.stringify({ status: "success", data: { vaults: vaultData, cli: filteredCli } }));
      return;
    }

    console.log(JSON.stringify({ status: "success", data: { vaults: vaultData, cli: cliData } }));
    return;
  }

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

  console.log("");
  if (cli.installed) {
    console.log(`Obsidian CLI: ${cli.binPath} (${cli.version ?? "version unknown"})`);
  } else {
    console.log("Obsidian CLI: not detected");
    console.log("  Enable in Obsidian 1.12+ Settings > General > Command line interface");
  }
}

async function cmdDoctor(): Promise<void> {
  const version = readVersion(resolvePackageRoot());
  if (version) console.log(`${formatVersionHeadline({ version })}\n`);

  let allOk = true;

  function check(label: string, ok: boolean, detail: string, hint?: string, warnOnly?: boolean): void {
    const icon = ok ? "✅" : warnOnly ? "⚠️" : "❌";
    const suffix = !ok && hint ? `  →  ${hint}` : "";
    console.log(`${icon} ${label.padEnd(10)} ${detail}${suffix}`);
    if (!ok && !warnOnly) allOk = false;
  }

  // 1. Binary in PATH
  const binPath = detectBinary("agentlog");
  check(
    "binary",
    !!binPath,
    binPath || "not found in PATH",
    "install agentlog globally (e.g. npm install -g @albireo3754/agentlog or bun install -g @albireo3754/agentlog)"
  );

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

  const hasRestoreMetadata = !!config && Object.prototype.hasOwnProperty.call(config, "codexNotifyRestore");
  const codexState = readCodexNotifyState();
  const codexRelevant = hasRestoreMetadata || codexState.kind !== "missing";

  // 6. Hook registered
  const hookOk = isHookRegistered();
  check(
    "hook",
    hookOk,
    hookOk ? CLAUDE_SETTINGS_PATH : "not registered",
    "run: agentlog init  to re-register",
    codexRelevant
  );

  // 7. Codex notify checks (only when configured or explicitly requested)
  if (codexRelevant) {
    const codexBinPath = detectBinary("codex");
    check(
      "codex-bin",
      !!codexBinPath,
      codexBinPath || "not found in PATH",
      "install Codex CLI, then re-run: agentlog init --codex ~/path/to/vault"
    );

    const detail = codexState.kind === "unsupported"
      ? `${CODEX_CONFIG_PATH} — unsupported notify config (${codexState.reason})`
      : codexState.kind === "registered"
        ? `${CODEX_CONFIG_PATH} — notify registered`
        : hasRestoreMetadata
          ? `${CODEX_CONFIG_PATH} — not registered (inconsistent state)`
          : `${CODEX_CONFIG_PATH} — not registered`;

    check(
      "codex",
      codexState.kind === "registered",
      detail,
      codexState.kind === "unsupported"
        ? "use a top-level single-line notify array or run: agentlog init --codex after simplifying config"
        : hasRestoreMetadata
          ? "run: agentlog init --codex to repair inconsistent state"
          : "run: agentlog init --codex ~/path/to/vault"
    );
  }

  console.log("");
  if (allOk) {
    console.log("All checks passed.");
  } else {
    console.log("Some checks failed. Fix the issues above and re-run: agentlog doctor");
    process.exit(1);
  }
}

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

async function cmdCodexNotify(outputFile: string | undefined): Promise<void> {
  const { runCodexNotify } = await import("./codex-notify.js");
  await runCodexNotify(outputFile);
}

async function cmdCodexDebug(prompt: string[]): Promise<void> {
  const text = prompt.join(" ").trim();
  if (!text) {
    console.error("Error: prompt is required");
    process.exit(1);
  }

  // Ensure codex notify is registered so logging works
  const config = loadConfig();
  const result = registerCodexNotify(config?.codexNotifyRestore ?? null);
  if (result.changed) {
    console.log("[agentlog] codex notify registered");
    if (config) {
      saveConfig({ ...config, codexNotifyRestore: result.restoreNotify });
    }
  }

  const proc = spawnSync("codex", ["exec", "--", text], {
    stdio: "inherit",
  });

  if (proc.error) {
    console.error(`Failed to run codex exec: ${proc.error.message}`);
    process.exit(1);
  }

  process.exit(proc.status ?? 1);
}

async function cmdVersion(): Promise<void> {
  console.log(formatVersionOutput(getRuntimeInfo()));
}

async function cmdUninstall(opts: { y: boolean; codex: boolean; all: boolean; dryRun: boolean }): Promise<void> {
  if (opts.codex && opts.all) {
    console.error("Error: choose at most one uninstall target: --codex or --all");
    process.exit(1);
  }

  const target: UninstallTarget = opts.all ? "all" : opts.codex ? "codex" : "claude";
  const cfgDir = configDir();

  if (opts.dryRun) {
    console.log("[dry-run] Would remove the following:");
    if (target === "claude" || target === "all") {
      console.log(`  Would remove hook from: ${CLAUDE_SETTINGS_PATH}`);
      console.log(`  Would remove config dir: ${cfgDir}`);
    }
    if (target === "codex" || target === "all") {
      console.log(`  Would restore codex notify: ${CODEX_CONFIG_PATH}`);
    }
    return;
  }

  if (!opts.y && process.stdin.isTTY) {
    const prompt = target === "all"
      ? "Remove AgentLog Claude hook, Codex notify, and config? [y/N]: "
      : target === "codex"
        ? "Remove AgentLog Codex notify integration? [y/N]: "
        : "Remove AgentLog hook and config? [y/N]: ";
    const answer = await ask(prompt);
    if (answer.toLowerCase() !== "y") {
      console.log("Aborted.");
      return;
    }
  }

  if (target === "codex") {
    uninstallCodex(true);
    return;
  }

  if (target === "all") {
    uninstallCodex(false);
  } else {
    // Check if Codex notify is still registered
    const config = loadConfig();
    if (config?.codexNotifyRestore) {
      console.warn(
        "⚠️  Codex notify is still registered. Run `agentlog uninstall --all` to also remove it."
      );
    }
  }

  uninstallClaude(cfgDir);
}

async function cmdValidate(): Promise<void> {
  let allOk = true;

  // 1. Config check
  const config = loadConfig();
  if (!config) {
    console.log("config: fail — not configured");
    allOk = false;
  } else {
    const vaultExists = config.plain
      ? existsSync(config.vault)
      : existsSync(join(config.vault, ".obsidian"));
    if (vaultExists) {
      console.log(`config: ok — ${config.vault}${config.plain ? " (plain)" : ""}`);
    } else {
      console.log(`config: fail — vault not found: ${config.vault}`);
      allOk = false;
    }
  }

  // 2. Hook check
  const hookOk = isHookRegistered();
  if (hookOk) {
    console.log(`hook: ok — ${CLAUDE_SETTINGS_PATH}`);
  } else {
    console.log("hook: fail — not registered");
    allOk = false;
  }

  if (!allOk) {
    process.exit(1);
  }
}

// --- Schema command data ---

const SCHEMA_DATA = {
  commands: [
    {
      name: "init",
      description: "Configure Claude hook, Codex notify, or both",
      arguments: [{ name: "vault", description: "Path to Obsidian vault or plain folder", required: false }],
      options: [
        { flags: "--plain", description: "Write to plain folder without Obsidian timeblock parsing" },
        { flags: "--claude", description: "Register Claude Code hook only (default)" },
        { flags: "--codex", description: "Register Codex notify only" },
        { flags: "--all", description: "Register both Claude hook and Codex notify" },
        { flags: "--dry-run", description: "Show what would happen without making changes" },
        { flags: "--format <format>", description: "Output format: text or json" },
      ],
    },
    {
      name: "detect",
      description: "List detected Obsidian vaults",
      arguments: [],
      options: [
        { flags: "--format <format>", description: "Output format: text or json" },
        { flags: "--fields <fields>", description: "Comma-separated fields to include in JSON output" },
      ],
    },
    {
      name: "doctor",
      description: "Check installation health",
      arguments: [],
      options: [
        { flags: "--format <format>", description: "Output format: text or json" },
      ],
    },
    {
      name: "open",
      description: "Open today's Daily Note in Obsidian (CLI)",
      arguments: [],
      options: [
        { flags: "--format <format>", description: "Output format: text or json" },
      ],
    },
    {
      name: "uninstall",
      description: "Remove Claude hook, Codex notify, or both",
      arguments: [],
      options: [
        { flags: "-y", description: "Skip confirmation prompt" },
        { flags: "--codex", description: "Remove Codex notify only" },
        { flags: "--all", description: "Remove both Claude hook and Codex notify" },
        { flags: "--dry-run", description: "Show what would happen without making changes" },
        { flags: "--format <format>", description: "Output format: text or json" },
      ],
    },
    {
      name: "validate",
      description: "Validate installation (machine-readable pass/fail)",
      arguments: [],
      options: [],
    },
    {
      name: "version",
      description: "Print version and build identity",
      arguments: [],
      options: [
        { flags: "--format <format>", description: "Output format: text or json" },
      ],
    },
    {
      name: "codex-debug",
      description: "Run codex exec with a test prompt",
      arguments: [{ name: "prompt", description: "Prompt text to send to codex exec", required: true }],
      options: [],
    },
    {
      name: "hook",
      description: "Run hook (called by Claude Code UserPromptSubmit)",
      arguments: [],
      options: [],
    },
    {
      name: "codex-notify",
      description: "Run notify handler (called by Codex on agent-turn-complete)",
      arguments: [{ name: "output-file", description: "Output file path", required: false }],
      options: [],
    },
    {
      name: "schema",
      description: "List all commands with their options and descriptions",
      arguments: [{ name: "command", description: "Command name to show schema for", required: false }],
      options: [],
    },
  ],
};

async function cmdSchema(commandName: string | undefined): Promise<void> {
  if (commandName) {
    const cmd = SCHEMA_DATA.commands.find((c) => c.name === commandName);
    if (!cmd) {
      console.log(JSON.stringify({ status: "error", error: `Unknown command: ${commandName}` }));
      process.exit(1);
    }
    console.log(JSON.stringify({ status: "success", data: cmd }));
    return;
  }
  console.log(JSON.stringify({ status: "success", data: SCHEMA_DATA }));
}

// --- Commander program setup ---

const program = new Command();

program
  .name("agentlog")
  .description("Auto-log Claude Code prompts to Obsidian Daily Notes")
  .allowUnknownOption(true)
  .configureOutput({
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => process.stdout.write(str),
  })
  .addHelpText("after", `
Examples:
  agentlog init ~/path/to/vault
  agentlog detect
  agentlog doctor

Options:
  --plain       Write to plain folder without Obsidian timeblock parsing
  -y            Skip confirmation prompt (for uninstall)
`);

program
  .command("init [vault]")
  .description("Configure Claude hook, Codex notify, or both")
  .option("--plain", "Write to plain folder without Obsidian timeblock parsing", false)
  .option("--claude", "Register Claude Code hook only (default)", false)
  .option("--codex", "Register Codex notify only", false)
  .option("--all", "Register both Claude hook and Codex notify", false)
  .option("--dry-run", "Show what would happen without making changes", false)
  .option("--format <format>", "Output format: text or json", "text")
  .action(async (vault: string | undefined, opts: { plain: boolean; claude: boolean; codex: boolean; all: boolean; dryRun: boolean; format: string }) => {
    await cmdInit(vault, opts);
  });

program
  .command("detect")
  .description("List detected Obsidian vaults")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--fields <fields>", "Comma-separated fields to include in JSON output")
  .action(async (opts: { format: string; fields?: string }) => {
    await cmdDetect(opts);
  });

program
  .command("doctor")
  .description("Check installation health")
  .option("--format <format>", "Output format: text or json", "text")
  .action(async (_opts: { format: string }) => {
    await cmdDoctor();
  });

program
  .command("open")
  .description("Open today's Daily Note in Obsidian (CLI)")
  .option("--format <format>", "Output format: text or json", "text")
  .action(async (_opts: { format: string }) => {
    await cmdOpen();
  });

program
  .command("validate")
  .description("Validate installation (machine-readable pass/fail)")
  .action(async () => {
    await cmdValidate();
  });

program
  .command("uninstall")
  .description("Remove Claude hook, Codex notify, or both")
  .option("-y", "Skip confirmation prompt", false)
  .option("--codex", "Remove Codex notify only", false)
  .option("--all", "Remove both Claude hook and Codex notify", false)
  .option("--dry-run", "Show what would happen without making changes", false)
  .option("--format <format>", "Output format: text or json", "text")
  .action(async (opts: { y: boolean; codex: boolean; all: boolean; dryRun: boolean; format: string }) => {
    await cmdUninstall(opts);
  });

program
  .command("version")
  .description("Print version and build identity")
  .option("--format <format>", "Output format: text or json", "text")
  .action(async (_opts: { format: string }) => {
    await cmdVersion();
  });

program
  .command("codex-debug")
  .description("Run codex exec with a test prompt")
  .allowUnknownOption(true)
  .helpOption(false)
  .argument("[prompt...]", "Prompt text to send to codex exec")
  .action(async (prompt: string[]) => {
    await cmdCodexDebug(prompt);
  });

program
  .command("hook")
  .description("Run hook (called by Claude Code UserPromptSubmit)")
  .action(async () => {
    await cmdHook();
  });

program
  .command("codex-notify [output-file]")
  .description("Run notify handler (called by Codex on agent-turn-complete)")
  .action(async (outputFile: string | undefined) => {
    await cmdCodexNotify(outputFile);
  });

program
  .command("schema [command]")
  .description("List all commands with their options and descriptions as JSON")
  .action(async (commandName: string | undefined) => {
    await cmdSchema(commandName);
  });

// Handle unknown commands
program.on("command:*", (operands: string[]) => {
  console.error(`error: unknown command '${operands[0]}'`);
  console.error(`\nUsage: agentlog [command]\nRun 'agentlog --help' for available commands.`);
  process.exit(1);
});

await program.parseAsync(process.argv);

// If no subcommand was invoked, print help and exit 0
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}
