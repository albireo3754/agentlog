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

function usage(): void {
  console.log(`Usage:
  agentlog init [vault] [--plain] [--claude | --codex | --all] [--dry-run]
                                   Configure Claude hook, Codex notify, or both
  agentlog detect                   List detected Obsidian vaults
  agentlog codex-debug <prompt>     Run codex exec with a test prompt
  agentlog codex-notify             Handle Codex notify callback (internal)
  agentlog doctor                   Check installation health
  agentlog validate                 Validate installation (machine-readable pass/fail)
  agentlog open                     Open today's Daily Note in Obsidian (CLI)
  agentlog uninstall [-y] [--codex | --all] [--dry-run]
                                   Remove Claude hook, Codex notify, or both
  agentlog version                  Print version and build identity
  agentlog hook                     Run hook (called by Claude Code)
  agentlog codex-notify             Run notify handler (called by Codex)

Options:
  --plain       Write to plain folder without Obsidian timeblock parsing
  -y            Skip confirmation prompt (for uninstall)
  --dry-run     Show what would happen without making changes
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

function validateVault(vaultArg: string, plain: boolean): { vault: string; error?: string } {
  const vault = resolve(expandHome(vaultArg));

  if (!plain) {
    const obsidianDir = join(vault, ".obsidian");
    if (!existsSync(obsidianDir)) {
      return { vault, error: formatError(Errors.VAULT_NOT_OBSIDIAN(vault)) };
    }
  } else if (!existsSync(vault)) {
    return { vault, error: formatError(Errors.VAULT_NOT_FOUND(vault)) };
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

function printVersion(): void {
  try {
    const pkgPath = join(import.meta.dir ?? new URL(".", import.meta.url).pathname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    if (pkg.version) console.log(`agentlog v${pkg.version}\n`);
  } catch {
    // version display is best-effort
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

function parseInitArgs(args: string[]): { plain: boolean; target: InitTarget; vaultArg: string; dryRun: boolean } {
  const plain = args.includes("--plain");
  const hasClaude = args.includes("--claude");
  const hasCodex = args.includes("--codex");
  const hasAll = args.includes("--all");
  const dryRun = args.includes("--dry-run");

  if ((hasAll && (hasClaude || hasCodex)) || (hasClaude && hasCodex)) {
    console.error("Error: choose exactly one target: --claude, --codex, or --all");
    process.exit(1);
  }

  const target: InitTarget = hasAll ? "all" : hasCodex ? "codex" : "claude";
  const filteredArgs = args.filter(
    (arg) => !["--plain", "--claude", "--codex", "--all", "--dry-run"].includes(arg)
  );

  return { plain, target, vaultArg: filteredArgs[0] ?? "", dryRun };
}

function parseUninstallArgs(args: string[]): { skipConfirm: boolean; target: UninstallTarget; dryRun: boolean } {
  const skipConfirm = args.includes("-y");
  const hasCodex = args.includes("--codex");
  const hasAll = args.includes("--all");
  const dryRun = args.includes("--dry-run");

  if (hasCodex && hasAll) {
    console.error("Error: choose at most one uninstall target: --codex or --all");
    process.exit(1);
  }

  return { skipConfirm, target: hasAll ? "all" : hasCodex ? "codex" : "claude", dryRun };
}

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

async function cmdInitDryRun(vaultArg: string, plain: boolean): Promise<void> {
  if (!vaultArg) {
    console.error("Error: --dry-run requires a vault path argument");
    process.exit(1);
  }

  const { vault, error } = validateVault(vaultArg, plain);
  if (error) {
    console.error(error);
    process.exit(1);
  }

  const cfgPath = configPath();
  const claudeSettingsPath = CLAUDE_SETTINGS_PATH;

  console.log("[dry-run] Validation passed. No changes were made.");
  console.log(`  Would save config to: ${cfgPath}`);
  console.log(`    vault: ${vault}${plain ? " (plain mode)" : ""}`);
  console.log(`  Would register hook in: ${claudeSettingsPath}`);
}

async function cmdInit(args: string[]): Promise<void> {
  const { plain, target, vaultArg, dryRun } = parseInitArgs(args);

  if (dryRun) {
    await cmdInitDryRun(vaultArg, plain);
    return;
  }

  const runner = target === "all" ? runAllInit : target === "codex" ? runCodexInit : runInit;

  if (!vaultArg) {
    await interactiveInit(plain, runner);
    return;
  }

  await runner(vaultArg, plain);
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

async function cmdUninstall(args: string[]): Promise<void> {
  const { skipConfirm, target, dryRun } = parseUninstallArgs(args);
  const cfgDir = configDir();

  if (dryRun) {
    const claudeSettingsPath = CLAUDE_SETTINGS_PATH;
    if (target === "codex" || target === "all") {
      console.log(`[dry-run] Would restore/remove Codex notify: ${CODEX_CONFIG_PATH}`);
    }
    if (target === "claude" || target === "all") {
      console.log(`[dry-run] Would remove hook from: ${claudeSettingsPath}`);
      console.log(`[dry-run] Would delete config at: ${cfgDir}`);
    }
    console.log("[dry-run] No changes were made.");
    return;
  }
  if (!skipConfirm && process.stdin.isTTY) {
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

/** agentlog doctor — check installation health */
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

async function cmdVersion(): Promise<void> {
  console.log(formatVersionOutput(getRuntimeInfo()));
}

/** agentlog validate — structured pass/fail checks, exit 0 if all required pass */
async function cmdValidate(): Promise<void> {
  let allOk = true;
  const results: Array<{ check: string; status: "ok" | "fail"; detail: string }> = [];

  function check(name: string, ok: boolean, detail: string): void {
    results.push({ check: name, status: ok ? "ok" : "fail", detail });
    if (!ok) allOk = false;
  }

  // 1. Config present
  const config = loadConfig();
  check("config", !!config, config ? configPath() : "no config.json");

  // 2. Vault exists
  if (config) {
    if (config.plain) {
      const vaultOk = existsSync(config.vault);
      check("vault", vaultOk, vaultOk ? config.vault : `not found: ${config.vault}`);
    } else {
      const vaultOk = existsSync(join(config.vault, ".obsidian"));
      check("vault", vaultOk, vaultOk ? config.vault : `.obsidian not found: ${config.vault}`);
    }
  } else {
    check("vault", false, "skipped (no config)");
  }

  // 3. Hook registered
  const hookOk = isHookRegistered();
  check("hook", hookOk, hookOk ? CLAUDE_SETTINGS_PATH : "not registered");

  for (const r of results) {
    console.log(`${r.check}: ${r.status} (${r.detail})`);
  }

  if (!allOk) {
    process.exit(1);
  }
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
  case "validate":
    await cmdValidate();
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
  case "version":
    await cmdVersion();
    break;
  case "hook":
    await cmdHook();
    break;
  default:
    usage();
    process.exit(command ? 1 : 0);
}
