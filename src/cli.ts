#!/usr/bin/env bun
/**
 * AgentLog CLI
 *
 * Commands:
 *   agentlog init [vault] [--plain] [--claude | --codex | --hermes | --all]
 *                                   — configure Claude, Codex, Hermes, or Claude+Codex
 *   agentlog uninstall [-y] [--codex | --hermes | --all]
 *                                   — remove Claude, Codex, Hermes, or all metadata
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
import { unregisterHook, inspectClaudeHookState, CLAUDE_SETTINGS_PATH } from "./claude-settings.js";
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
import {
  hookProviders,
  providerById,
  providersForInitTarget,
  type InitTarget,
  type UninstallTarget,
} from "./hook-providers/index.js";
import { uninstallLegacyCodexNotify } from "./hook-providers/codex.js";
import { resolveHermesConfigTargets } from "./hermes-config.js";
import { Command } from "commander";

interface HermesCliOptions {
  hermesProfile?: string[];
  hermesAllProfiles?: boolean;
}

function providerContext(config: AgentLogConfig | null, opts: HermesCliOptions = {}) {
  return {
    homeDir: process.env.HOME,
    hermesHome: process.env.HERMES_HOME,
    hermesProfiles: opts.hermesProfile && opts.hermesProfile.length > 0 ? opts.hermesProfile : config?.hermesProfiles,
    hermesAllProfiles: opts.hermesAllProfiles,
    hermesCommand: agentlogHermesHookCommand(),
  };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function agentlogHermesHookCommand(): string {
  const agentlogBin = detectBinary("agentlog");
  return `${shellQuote(agentlogBin || "agentlog")} hook --source hermes`;
}

function savePatchedConfig(config: AgentLogConfig | null, patch: Partial<AgentLogConfig> | undefined): void {
  if (!config || !patch) return;
  const next: AgentLogConfig = { ...config };
  for (const [key, value] of Object.entries(patch) as Array<[keyof AgentLogConfig, AgentLogConfig[keyof AgentLogConfig]]>) {
    if (value === undefined) delete next[key];
    else (next as unknown as Record<string, unknown>)[key] = value;
  }
  saveConfig(next);
}

function validateHermesCliOptions(target: InitTarget | UninstallTarget, opts: HermesCliOptions): void {
  const hasHermesProfile = !!opts.hermesProfile && opts.hermesProfile.length > 0;
  if (hasHermesProfile && opts.hermesAllProfiles) {
    console.error("Error: choose either --hermes-profile or --hermes-all-profiles");
    process.exit(1);
  }
  if ((hasHermesProfile || opts.hermesAllProfiles) && target !== "hermes") {
    console.error("Error: Hermes profile options require --hermes");
    process.exit(1);
  }
}

function hermesConfigTargetLines(opts: HermesCliOptions = {}): string[] {
  return resolveHermesConfigTargets({
    homeDir: process.env.HOME,
    hermesHome: process.env.HERMES_HOME,
    profiles: opts.hermesProfile,
    allProfiles: opts.hermesAllProfiles,
  }).map((target) => `${target.profile}:${target.path}`);
}

async function runProviderInit(vaultArg: string, plain: boolean, target: InitTarget, opts: HermesCliOptions = {}): Promise<void> {
  const vault = validateVaultOrExit(vaultArg, plain);
  const providerIds = providersForInitTarget(target);
  const messages: string[] = [];
  const configPatch: Partial<AgentLogConfig> = {};

  for (const providerId of providerIds) {
    const provider = providerById(providerId);
    try {
      const result = provider.install({ vault, plain, ...providerContext(loadConfig(), opts) });
      Object.assign(configPatch, result.configPatch);
      messages.push(...result.messages);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  saveMergedConfig(vault, plain, configPatch);
  printSavedConfig(vault, plain);
  printObsidianCliStatus(plain);
  for (const message of messages) console.log(message);
  if (providerIds.includes("codex")) {
    console.log(`  Review/trust the hook in Codex with /hooks if prompted.`);
  }

  if (target === "claude") {
    console.log(`\nAgentLog is ready. Claude Code prompts will be logged to your Daily Note.`);
  } else if (target === "codex") {
    console.log(`\nAgentLog is ready. Codex turns will be logged to your Daily Note.`);
  } else if (target === "hermes") {
    console.log(`\nAgentLog is ready. Hermes turns will be logged after Hermes accepts the shell hook.`);
  } else {
    console.log(`\nAgentLog is ready. Claude Code prompts and Codex turns will be logged to your Daily Note.`);
  }
}

async function interactiveInit(
  plain: boolean,
  runner: (vault: string, plain: boolean) => Promise<void>
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
  const result = hookProviders.claude.uninstall();
  for (const message of result.messages) console.log(message);

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
  let result;
  try {
    result = hookProviders.codex.uninstall();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  for (const message of result.messages) console.log(message);

  for (const message of uninstallLegacyCodexNotify(config)) console.log(message);

  if (clearRestoreMetadata && config) {
    savePatchedConfig(config, { ...result.configPatch, codexNotifyRestore: undefined });
  }

  console.log("\nCodex integration uninstalled.");
}

function uninstallHermes(opts: HermesCliOptions = {}): void {
  const config = loadConfig();
  let result;
  try {
    result = hookProviders.hermes.uninstall(providerContext(config, opts));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  for (const message of result.messages) console.log(message);
  savePatchedConfig(config, result.configPatch);
  console.log("\nHermes integration metadata removed.");
}

// --- Command implementations ---

async function cmdInitDryRun(vaultArg: string, plain: boolean, target: string, opts: HermesCliOptions = {}): Promise<void> {
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
  if (target === "hermes") {
    console.log(`  Would save Hermes metadata to: ${cfgPath}`);
    console.log("  Would write Hermes hook config:");
    for (const line of hermesConfigTargetLines(opts)) console.log(`    ${line}`);
  }
}

async function cmdInit(vaultArg: string | undefined, opts: { plain: boolean; claude: boolean; codex: boolean; hermes: boolean; all: boolean; dryRun: boolean; hermesProfile?: string[]; hermesAllProfiles?: boolean }): Promise<void> {
  const { plain, dryRun } = opts;

  const selectedTargets = [opts.claude, opts.codex, opts.hermes, opts.all].filter(Boolean).length;
  if (selectedTargets > 1) {
    console.error("Error: choose exactly one target: --claude, --codex, --hermes, or --all");
    process.exit(1);
  }

  const target: InitTarget = opts.all ? "all" : opts.codex ? "codex" : opts.hermes ? "hermes" : "claude";
  validateHermesCliOptions(target, opts);

  if (dryRun) {
    await cmdInitDryRun(vaultArg ?? "", plain, target === "claude" ? "hook" : target, opts);
    return;
  }

  if (!vaultArg) {
    await interactiveInit(plain, (vault, isPlain) => runProviderInit(vault, isPlain, target, opts));
    return;
  }

  await runProviderInit(vaultArg, plain, target, opts);
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
  const hasHermesHookMetadata = config?.hermesHookInstalled === true;
  const hermesCtx = providerContext(config);
  const codexRelevant = hookProviders.codex.isRelevant(config);
  const hermesRelevant = hookProviders.hermes.isRelevant(config, hermesCtx);

  // 6. Claude hook registered and compatible with Claude Code matcher validation.
  const hookState = hookProviders.claude.inspect();
  const hookOk = hookState.kind === "registered";
  check(
    "hook",
    hookOk,
    hookState.detail,
    hookState.kind === "registered" ? undefined : hookState.repairHint,
    (codexRelevant || hermesRelevant) && hookState.kind === "missing" && !hasClaudeHookMetadata
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

    const codexState = hookProviders.codex.inspect();
    check(
      "codex",
      codexState.kind === "registered",
      hasCodexHookMetadata && codexState.kind === "missing"
        ? `${codexState.detail} (inconsistent state)`
        : codexState.detail,
      codexState.kind === "registered" ? undefined : codexState.repairHint
    );
  }

  if (hermesRelevant) {
    const hermesState = hookProviders.hermes.inspect(hermesCtx);
    check(
      "hermes",
      hermesState.kind === "registered",
      hermesState.detail,
      hermesState.kind === "registered" ? undefined : hermesState.repairHint,
      !hasHermesHookMetadata
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

async function cmdHook(_source: "claude" | "codex" | "hermes" = "claude"): Promise<void> {
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

async function cmdUninstall(opts: { y: boolean; codex: boolean; hermes: boolean; all: boolean; dryRun: boolean; hermesProfile?: string[]; hermesAllProfiles?: boolean }): Promise<void> {
  if ([opts.codex, opts.hermes, opts.all].filter(Boolean).length > 1) {
    console.error("Error: choose at most one uninstall target: --codex, --hermes, or --all");
    process.exit(1);
  }

  const target: UninstallTarget = opts.all ? "all" : opts.codex ? "codex" : opts.hermes ? "hermes" : "claude";
  validateHermesCliOptions(target, opts);
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
    if (target === "hermes" || target === "all") {
      console.log("  Would remove Hermes hook config from:");
      for (const line of hermesConfigTargetLines(target === "hermes" ? opts : {})) console.log(`    ${line}`);
      console.log(`  Would remove Hermes metadata from: ${configPath()}`);
    }
    return;
  }

  if (!opts.y && process.stdin.isTTY) {
    const prompt = target === "all"
      ? "Remove AgentLog Claude hook, Codex hook, Hermes metadata, and config? [y/N]: "
      : target === "codex"
        ? "Remove AgentLog Codex hook and legacy notify integration? [y/N]: "
        : target === "hermes"
          ? "Remove AgentLog Hermes metadata? [y/N]: "
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

  if (target === "hermes") {
    uninstallHermes(opts);
    return;
  }

  if (target === "all") {
    uninstallCodex(false);
    uninstallHermes();
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
      description: "Configure Claude hook, Codex hook, or Hermes hook",
      arguments: [{ name: "vault", description: "Path to Obsidian vault or plain folder", required: false }],
      options: [
        { flags: "--plain", description: "Write to plain folder without Obsidian timeblock parsing" },
        { flags: "--claude", description: "Register Claude Code hook only (default)" },
        { flags: "--codex", description: "Register Codex hook only" },
        { flags: "--hermes", description: "Register Hermes shell hook and record metadata" },
        { flags: "--hermes-profile <profile>", description: "Register a named Hermes profile config (repeatable)" },
        { flags: "--hermes-all-profiles", description: "Register default plus every existing Hermes profile config" },
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
      description: "Remove Claude hook, Codex hook, Hermes hook, or all integrations",
      arguments: [],
      options: [
        { flags: "-y", description: "Skip confirmation prompt" },
        { flags: "--codex", description: "Remove Codex hook and legacy notify integration" },
        { flags: "--hermes", description: "Remove Hermes hook config and metadata" },
        { flags: "--hermes-profile <profile>", description: "Remove a named Hermes profile config hook (repeatable)" },
        { flags: "--hermes-all-profiles", description: "Remove default plus every existing Hermes profile config hook" },
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
      options: [
        { flags: "--source <source>", description: "Source to record: claude, codex, or hermes" },
      ],
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
  .description("Configure Claude hook, Codex hook, or Hermes hook")
  .option("--plain", "Write to plain folder without Obsidian timeblock parsing", false)
  .option("--claude", "Register Claude Code hook only (default)", false)
  .option("--codex", "Register Codex hook only", false)
  .option("--hermes", "Register Hermes shell hook and record metadata", false)
  .option("--hermes-profile <profile>", "Register a named Hermes profile config (repeatable)", (value: string, previous: string[]) => [...previous, value], [])
  .option("--hermes-all-profiles", "Register default plus every existing Hermes profile config", false)
  .option("--all", "Register both Claude hook and Codex hook", false)
  .option("--dry-run", "Show what would happen without making changes", false)
  .option("--format <format>", "Output format: text or json", "text")
  .action(async (vault: string | undefined, opts: { plain: boolean; claude: boolean; codex: boolean; hermes: boolean; all: boolean; dryRun: boolean; format: string; hermesProfile?: string[]; hermesAllProfiles?: boolean }) => {
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
  .description("Remove Claude hook, Codex hook, Hermes hook, or all integrations")
  .option("-y", "Skip confirmation prompt", false)
  .option("--codex", "Remove Codex hook and legacy notify integration", false)
  .option("--hermes", "Remove Hermes hook config and metadata", false)
  .option("--hermes-profile <profile>", "Remove a named Hermes profile config hook (repeatable)", (value: string, previous: string[]) => [...previous, value], [])
  .option("--hermes-all-profiles", "Remove default plus every existing Hermes profile config hook", false)
  .option("--all", "Remove Claude hook, Codex hook, legacy notify, and config", false)
  .option("--dry-run", "Show what would happen without making changes", false)
  .option("--format <format>", "Output format: text or json", "text")
  .action(async (opts: { y: boolean; codex: boolean; hermes: boolean; all: boolean; dryRun: boolean; format: string; hermesProfile?: string[]; hermesAllProfiles?: boolean }) => {
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
  .option("--source <source>", "Source to record: claude, codex, or hermes", "claude")
  .action(async (opts: { source: "claude" | "codex" | "hermes" }) => {
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

if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}

await program.parseAsync(process.argv);
