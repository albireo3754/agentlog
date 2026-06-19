#!/usr/bin/env bun
/**
 * AgentLog CLI
 *
 * Commands:
 *   agentlog init [vault] [--plain] [--claude | --codex | --all]
 *                                   — configure Claude hook, Codex hook, or both
 *   agentlog uninstall [-y] [--codex | --all]
 *                                   — remove Claude hook, Codex hook, or both
 *   agentlog detect                   — list detected Obsidian vaults
 *   agentlog hook                     — invoked by Claude Code UserPromptSubmit hook
 *   agentlog codex-notify             — legacy Codex notify handler
 */

import { existsSync, rmSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { saveConfig, loadConfig, expandHome, configPath, configDir } from "./config.js";
import type { AgentLogConfig } from "./types.js";
import { detectVaults, detectCli } from "./detect.js";
import { isVersionAtLeast, isCliDisabledOutput, MIN_CLI_VERSION, resolveCliBin, parseCliVersion } from "./obsidian-cli.js";
import { registerHook, unregisterHook, inspectClaudeHookState, CLAUDE_SETTINGS_PATH } from "./claude-settings.js";
import {
  ask,
  detectBinary,
  printObsidianCliStatus,
  printSavedConfig,
  saveMergedConfig,
  validateVault,
  validateVaultOrExit,
} from "./cli-shared.js";
import {
  CODEX_HOOKS_PATH,
  type CodexHookMutationResult,
  readCodexHookState,
  registerCodexHook,
  unregisterCodexHook,
} from "./codex-hooks.js";
import {
  CODEX_CONFIG_PATH,
  readCodexNotifyState,
  unregisterCodexNotify,
} from "./codex-settings.js";
import { formatVersionHeadline, formatVersionOutput, getRuntimeInfo, readVersion, resolvePackageRoot } from "./version-info.js";
import { parseDateArg, runBackfill, type BackfillSource } from "./backfill.js";
import { Command } from "commander";

type InitTarget = "claude" | "codex" | "all";
type UninstallTarget = "claude" | "codex" | "all";

async function runInit(vaultArg: string, plain: boolean): Promise<void> {
  const vault = validateVaultOrExit(vaultArg, plain);

  saveMergedConfig(vault, plain, { claudeHookInstalled: true });
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
  let result: CodexHookMutationResult;
  try {
    result = registerCodexHook();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  saveMergedConfig(vault, plain, { codexHookInstalled: true });
  printSavedConfig(vault, plain);
  printObsidianCliStatus(plain);
  console.log(`  Codex CLI: ${codexBin}`);
  console.log(`Codex hook registered: ${CODEX_HOOKS_PATH}`);
  if (!result.changed) console.log(`  Existing AgentLog Codex hook left unchanged`);
  console.log(`  Review/trust the hook in Codex with /hooks if prompted.`);
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
  let result: CodexHookMutationResult;
  try {
    result = registerCodexHook();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  saveMergedConfig(vault, plain, { codexHookInstalled: true, claudeHookInstalled: true });
  printSavedConfig(vault, plain);
  printObsidianCliStatus(plain);

  registerHook();
  console.log(`Hook registered: ${CLAUDE_SETTINGS_PATH}`);
  console.log(`  Codex CLI: ${codexBin}`);
  console.log(`Codex hook registered: ${CODEX_HOOKS_PATH}`);
  if (!result.changed) console.log(`  Existing AgentLog Codex hook left unchanged`);
  console.log(`  Review/trust the hook in Codex with /hooks if prompted.`);
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
  let result: CodexHookMutationResult;
  try {
    result = unregisterCodexHook();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  if (result.changed) {
    console.log(`Codex hook removed: ${CODEX_HOOKS_PATH}`);
  } else {
    console.log("Codex hook not found (already removed or never registered)");
  }

  const legacyNotify = unregisterCodexNotify(config?.codexNotifyRestore ?? null);
  if (legacyNotify.changed) {
    const action = legacyNotify.restoreNotify && legacyNotify.restoreNotify.length > 0 ? "restored" : "removed";
    console.log(`Legacy Codex notify ${action}: ${CODEX_CONFIG_PATH}`);
  }

  if (clearRestoreMetadata && config) {
    const next: AgentLogConfig = { ...config };
    delete next.codexHookInstalled;
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
    console.log(`  Would register codex hook integration in: ${CODEX_HOOKS_PATH}`);
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
    console.log(`  Enable in Obsidian ${MIN_CLI_VERSION}+ Settings > General > Command line interface`);
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
      const cliVerDisabled = isCliDisabledOutput(cliVer.stdout) || isCliDisabledOutput(cliVer.stderr);
      // stdout may contain warning lines before the version; take the last non-empty line.
      // A disabled CLI emits only the warning, which must not be parsed as a version string.
      const version = cliVer.status === 0 && !cliVerDisabled ? (parseCliVersion(cliVer.stdout ?? "") ?? "") : "";
      if (cliVerDisabled) {
        check("cli-ver", false, "CLI disabled in Obsidian settings", `Enable CLI in Obsidian ${MIN_CLI_VERSION}+ Settings > General > Command line interface`, true);
      } else if (version) {
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

      // 5b. CLI responsive (app running + CLI enabled + can communicate).
      // A disabled CLI exits 0 while only printing a warning, so status alone is not enough.
      const cliProbe = spawnSync(cliBinPath, ["daily:path"], { encoding: "utf-8", timeout: 3000 });
      const cliDisabled = isCliDisabledOutput(cliProbe.stdout) || isCliDisabledOutput(cliProbe.stderr);
      const cliResponsive = cliProbe.status === 0 && !cliDisabled;
      check(
        "cli-app",
        cliResponsive,
        cliResponsive ? "responsive" : cliDisabled ? "CLI disabled in Obsidian settings" : "app not responding",
        cliDisabled
          ? `Enable CLI in Obsidian ${MIN_CLI_VERSION}+ Settings > General > Command line interface`
          : "Start Obsidian app, or check CLI settings",
        true
      );

      // 5c. Daily note status (only when CLI is responsive)
      if (cliResponsive) {
        const dailyRead = spawnSync(cliBinPath, ["daily:read"], { encoding: "utf-8", timeout: 3000 });
        const dailyDisabled = isCliDisabledOutput(dailyRead.stdout) || isCliDisabledOutput(dailyRead.stderr);
        const noteExists =
          dailyRead.status === 0 && !dailyDisabled && (dailyRead.stdout ?? "").trim().length > 0;
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

  const hasCodexHookMetadata = config?.codexHookInstalled === true;
  const hasClaudeHookMetadata = config?.claudeHookInstalled === true;
  const hasRestoreMetadata = !!config && Object.prototype.hasOwnProperty.call(config, "codexNotifyRestore");
  const codexHookState = readCodexHookState();
  const legacyNotifyState = readCodexNotifyState();
  const codexRelevant =
    hasCodexHookMetadata ||
    hasRestoreMetadata ||
    codexHookState.kind !== "missing" ||
    legacyNotifyState.kind !== "missing";

  // 6. Claude hook registered and compatible with Claude Code matcher validation.
  const hookState = inspectClaudeHookState();
  const hookOk = hookState.kind === "registered";
  const hookDetail = hookState.kind === "registered"
    ? CLAUDE_SETTINGS_PATH
    : hookState.kind === "unsupported"
      ? `${CLAUDE_SETTINGS_PATH} — ${hookState.reason}`
      : "not registered";
  check(
    "hook",
    hookOk,
    hookDetail,
    hookState.kind === "unsupported"
      ? "run: agentlog init to migrate AgentLog hook, or fix Claude settings"
      : "run: agentlog init to re-register",
    codexRelevant && hookState.kind === "missing" && !hasClaudeHookMetadata
  );

  // 7. Codex hook checks (only when configured or explicitly requested)
  if (codexRelevant) {
    const codexBinPath = detectBinary("codex");
    check(
      "codex-bin",
      !!codexBinPath,
      codexBinPath || "not found in PATH",
      "install Codex CLI, then re-run: agentlog init --codex ~/path/to/vault"
    );

    const detail = codexHookState.kind === "unsupported"
      ? `${CODEX_HOOKS_PATH} — unsupported hook config (${codexHookState.reason})`
      : codexHookState.kind === "needs_migration"
        ? `${CODEX_HOOKS_PATH} — ${codexHookState.reason}`
      : codexHookState.kind === "registered"
        ? `${CODEX_HOOKS_PATH} — hook registered`
        : hasCodexHookMetadata
          ? `${CODEX_HOOKS_PATH} — not registered (inconsistent state)`
          : legacyNotifyState.kind === "registered"
            ? `${CODEX_CONFIG_PATH} — legacy notify registered; migrate to hooks`
            : legacyNotifyState.kind === "unsupported"
              ? `${CODEX_CONFIG_PATH} — unsupported legacy notify config (${legacyNotifyState.reason})`
              : `${CODEX_HOOKS_PATH} — not registered`;

    check(
      "codex",
      codexHookState.kind === "registered",
      detail,
      codexHookState.kind === "unsupported"
        ? "fix hooks.json or move it aside, then run: agentlog init --codex"
        : codexHookState.kind === "needs_migration"
          ? "run: agentlog init --codex to migrate the Codex hook"
        : legacyNotifyState.kind === "unsupported"
          ? "simplify legacy notify config or move config.toml aside, then run: agentlog init --codex"
          : hasCodexHookMetadata || hasRestoreMetadata || legacyNotifyState.kind === "registered"
            ? "run: agentlog init --codex to repair or migrate to hooks"
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
  // Resolve via the shared lookup so OBSIDIAN_BIN and the macOS app-bundle
  // fallback work here too, instead of relying on `obsidian` being on PATH.
  const cliBin = resolveCliBin();
  if (!cliBin) {
    console.error("Failed to open. Obsidian CLI not found.");
    console.error(`  Enable CLI in Obsidian ${MIN_CLI_VERSION}+ Settings > General > Command line interface`);
    process.exit(1);
    return;
  }
  const proc = spawnSync(cliBin, ["daily"], {
    encoding: "utf-8",
    timeout: 5000,
  });
  // A disabled CLI exits 0 while only printing a warning, so status alone is not success.
  const disabled = isCliDisabledOutput(proc.stdout) || isCliDisabledOutput(proc.stderr);
  if (proc.status === 0 && !disabled) {
    console.log("Opened today's Daily Note in Obsidian.");
  } else {
    console.error("Failed to open. Is Obsidian running with CLI enabled?");
    console.error(`  Enable CLI in Obsidian ${MIN_CLI_VERSION}+ Settings > General > Command line interface`);
    process.exit(1);
  }
}

async function cmdHook(_source: "claude" | "codex" = "claude"): Promise<void> {
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

  // Ensure Codex hook is registered so logging works
  const config = loadConfig();
  let result: CodexHookMutationResult;
  try {
    result = registerCodexHook();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  if (result.changed) {
    console.log("[agentlog] codex hook registered");
    if (config) {
      saveConfig({ ...config, codexHookInstalled: true });
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

async function cmdBackfill(dateArg: string | undefined, opts: { source: BackfillSource; dryRun: boolean; format: string }): Promise<void> {
  if (!["all", "claude", "codex"].includes(opts.source)) {
    console.error("Error: --source must be one of: all, claude, codex");
    process.exit(1);
  }
  if (!["text", "json"].includes(opts.format)) {
    console.error("Error: --format must be one of: text, json");
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    console.error("[agentlog] not initialized. Run: agentlog init ~/path/to/vault");
    process.exit(1);
  }

  let date: Date;
  try {
    date = parseDateArg(dateArg);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  let result;
  try {
    result = runBackfill(config, { date, source: opts.source, dryRun: opts.dryRun });
  } catch (err) {
    console.error(err instanceof Error ? `Error: ${err.message}` : String(err));
    process.exit(1);
  }

  if (opts.format === "json") {
    console.log(JSON.stringify({ status: "success", data: result }));
    return;
  }

  const verb = opts.dryRun ? "Would append" : "Appended";
  console.log(`${verb} ${result.inserted} entries from ${result.found} discovered prompts (${result.skipped} already present).`);
  console.log(`  date: ${result.date}`);
  console.log(`  scanned sessions: ${result.scanned}`);
  if (result.filePath) console.log(`  note: ${result.filePath}`);
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
      console.log(`  Would remove codex hook from: ${CODEX_HOOKS_PATH}`);
      console.log(`  Would restore/remove legacy codex notify in: ${CODEX_CONFIG_PATH}`);
    }
    return;
  }

  if (!opts.y && process.stdin.isTTY) {
    const prompt = target === "all"
      ? "Remove AgentLog Claude hook, Codex hook, and config? [y/N]: "
      : target === "codex"
        ? "Remove AgentLog Codex hook and legacy notify integration? [y/N]: "
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
    // Check if Codex hook is still registered
    const codexHookState = readCodexHookState();
    if (codexHookState.kind === "registered" || codexHookState.kind === "needs_migration") {
      console.warn(
        "⚠️  Codex hook is still registered. Run `agentlog uninstall --all` to also remove it."
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
  const hookState = inspectClaudeHookState();
  if (hookState.kind === "registered") {
    console.log(`hook: ok — ${CLAUDE_SETTINGS_PATH}`);
  } else {
    const detail = hookState.kind === "unsupported" ? hookState.reason : "not registered";
    console.log(`hook: fail — ${detail}`);
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
      description: "Configure Claude hook, Codex hook, or both",
      arguments: [{ name: "vault", description: "Path to Obsidian vault or plain folder", required: false }],
      options: [
        { flags: "--plain", description: "Write to plain folder without Obsidian timeblock parsing" },
        { flags: "--claude", description: "Register Claude Code hook only (default)" },
        { flags: "--codex", description: "Register Codex hook only" },
        { flags: "--all", description: "Register both Claude hook and Codex hook" },
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
      description: "Remove Claude hook, Codex hook, or both",
      arguments: [],
      options: [
        { flags: "-y", description: "Skip confirmation prompt" },
        { flags: "--codex", description: "Remove Codex hook and legacy notify integration" },
        { flags: "--all", description: "Remove Claude hook, Codex hook, legacy notify, and config" },
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
      name: "backfill",
      description: "Scan Claude/Codex session JSONL files and append missing prompts to a Daily Note",
      arguments: [{ name: "date", description: "Date to backfill (YYYY-MM-DD, default: today)", required: false }],
      options: [
        { flags: "--source <source>", description: "Source to scan: all, claude, or codex" },
        { flags: "--dry-run", description: "Report entries without writing to the note" },
        { flags: "--format <format>", description: "Output format: text or json" },
      ],
    },
    {
      name: "hook",
      description: "Run hook (called by Claude Code or Codex UserPromptSubmit)",
      arguments: [],
      options: [],
    },
    {
      name: "codex-notify",
      description: "Run legacy notify handler (called by old Codex notify on agent-turn-complete)",
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
  .description("Configure Claude hook, Codex hook, or both")
  .option("--plain", "Write to plain folder without Obsidian timeblock parsing", false)
  .option("--claude", "Register Claude Code hook only (default)", false)
  .option("--codex", "Register Codex hook only", false)
  .option("--all", "Register both Claude hook and Codex hook", false)
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
  .description("Remove Claude hook, Codex hook, or both")
  .option("-y", "Skip confirmation prompt", false)
  .option("--codex", "Remove Codex hook and legacy notify integration", false)
  .option("--all", "Remove Claude hook, Codex hook, legacy notify, and config", false)
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
  .command("backfill [date]")
  .description("Scan Claude/Codex session JSONL files and append missing prompts to a Daily Note")
  .option("--source <source>", "Source to scan: all, claude, or codex", "all")
  .option("--dry-run", "Report entries without writing to the note", false)
  .option("--format <format>", "Output format: text or json", "text")
  .action(async (date: string | undefined, opts: { source: BackfillSource; dryRun: boolean; format: string }) => {
    await cmdBackfill(date, opts);
  });

program
  .command("hook")
  .description("Run hook (called by Claude Code or Codex UserPromptSubmit)")
  .option("--source <source>", "Source to record: claude or codex", "claude")
  .action(async (opts: { source: "claude" | "codex" }) => {
    await cmdHook(opts.source);
  });

program
  .command("codex-notify [output-file]")
  .description("Run legacy notify handler (called by old Codex notify on agent-turn-complete)")
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
