/**
 * Obsidian CLI (1.12+) detection and execution.
 * Encapsulates all Obsidian CLI interaction so other modules
 * only need to call these functions.
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";

/** Known macOS paths where Obsidian CLI binary may live (PATH may not include these). */
const MACOS_CLI_PATHS = [
  "/Applications/Obsidian.app/Contents/MacOS/obsidian",
];

/** Cached resolved binary path (null = not yet resolved, "" = not found). */
let _cachedBin: string | null = null;

/**
 * Resolve the `obsidian` CLI binary path.
 * Tries `which obsidian` first, then known macOS paths.
 */
export function resolveCliBin(): string | null {
  if (_cachedBin !== null) return _cachedBin || null;

  const which = spawnSync("which", ["obsidian"], { encoding: "utf-8", timeout: 3000 });
  if (which.status === 0 && which.stdout.trim()) {
    _cachedBin = which.stdout.trim();
    return _cachedBin;
  }

  if (process.platform === "darwin") {
    for (const p of MACOS_CLI_PATHS) {
      if (existsSync(p)) {
        _cachedBin = p;
        return _cachedBin;
      }
    }
  }

  _cachedBin = "";
  return null;
}

/** Spawn obsidian CLI with resolved binary path. Returns null if binary not found. */
function obsidianSync(args: string[], timeout: number) {
  const bin = resolveCliBin();
  if (!bin) return null;
  return spawnSync(bin, args, { encoding: "utf-8", timeout });
}

/** Result of probing the Obsidian CLI environment */
export interface ObsidianCliStatus {
  /** CLI binary found in PATH */
  installed: boolean;
  /** Path to the binary (from `which obsidian`) */
  binPath: string | null;
  /** Version string from `obsidian version` */
  version: string | null;
  /** App is running and CLI can communicate with it */
  responsive: boolean;
}

/** Result of a CLI write operation */
export interface CliWriteResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

const CLI_TIMEOUT_MS = 3000;
const CLI_WRITE_TIMEOUT_MS = 5000;

/** Minimum Obsidian version that supports CLI */
export const MIN_CLI_VERSION = "1.12.4";

/**
 * Compare two semver-like version strings (e.g. "1.12.4" >= "1.12.4").
 * Returns true if `version` >= `minimum`.
 */
export function isVersionAtLeast(version: string, minimum: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const ver = parse(version);
  const min = parse(minimum);
  for (let i = 0; i < Math.max(ver.length, min.length); i++) {
    const a = ver[i] ?? 0;
    const b = min[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true; // equal
}

/**
 * Probe the Obsidian CLI environment.
 * Each step is independently guarded — a failure at any step
 * populates the remaining fields with safe defaults.
 */
export function probeObsidianCli(): ObsidianCliStatus {
  const result: ObsidianCliStatus = {
    installed: false,
    binPath: null,
    version: null,
    responsive: false,
  };

  // 1. Resolve binary (PATH + macOS fallback paths)
  const bin = resolveCliBin();
  if (!bin) return result;

  result.installed = true;
  result.binPath = bin;

  // 2. Get version (stdout may contain warning lines; take last non-empty line)
  const ver = obsidianSync(["version"], CLI_TIMEOUT_MS);
  if (ver && ver.status === 0 && ver.stdout.trim()) {
    const lines = ver.stdout.trim().split("\n").filter(Boolean);
    result.version = (lines.at(-1) ?? "").trim() || null;
  }

  // 3. Check if app is responsive (daily:path is a lightweight read-only command)
  const probe = obsidianSync(["daily:path"], CLI_TIMEOUT_MS);
  result.responsive = probe?.status === 0;

  return result;
}

/**
 * Append content to today's Daily Note via Obsidian CLI.
 * Command: obsidian daily:append content="..."
 */
export function cliDailyAppend(content: string): CliWriteResult {
  const proc = obsidianSync(["daily:append", `content=${content}`], CLI_WRITE_TIMEOUT_MS);
  if (!proc) return { success: false, stdout: "", stderr: "obsidian binary not found" };

  return {
    success: proc.status === 0,
    stdout: (proc.stdout ?? "").trim(),
    stderr: (proc.stderr ?? "").trim(),
  };
}

/**
 * Open (and create if missing) today's Daily Note via Obsidian CLI.
 * Command: obsidian daily
 * This triggers Obsidian's daily note template when the note doesn't exist yet.
 */
export function cliDailyCreate(): CliWriteResult {
  const proc = obsidianSync(["daily"], CLI_WRITE_TIMEOUT_MS);
  if (!proc) return { success: false, stdout: "", stderr: "obsidian binary not found" };

  return {
    success: proc.status === 0,
    stdout: (proc.stdout ?? "").trim(),
    stderr: (proc.stderr ?? "").trim(),
  };
}

/**
 * Read today's Daily Note content via Obsidian CLI.
 * Returns null if CLI is unavailable or read fails.
 */
export function cliDailyRead(): string | null {
  const proc = obsidianSync(["daily:read"], CLI_TIMEOUT_MS);
  if (!proc || proc.status !== 0) return null;
  return proc.stdout ?? null;
}

/**
 * Get the file path of today's Daily Note via Obsidian CLI.
 * Returns null if CLI is unavailable.
 */
export function cliDailyPath(): string | null {
  const proc = obsidianSync(["daily:path"], CLI_TIMEOUT_MS);
  if (!proc || proc.status !== 0) return null;
  return (proc.stdout ?? "").trim() || null;
}
