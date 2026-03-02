/**
 * Obsidian CLI (1.12+) detection and execution.
 * Encapsulates all Obsidian CLI interaction so other modules
 * only need to call these functions.
 */

import { spawnSync } from "child_process";

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

  // 1. Check if `obsidian` binary exists in PATH
  const which = spawnSync("which", ["obsidian"], {
    encoding: "utf-8",
    timeout: CLI_TIMEOUT_MS,
  });
  if (which.status !== 0) return result;

  result.installed = true;
  result.binPath = which.stdout.trim();

  // 2. Get version
  const ver = spawnSync("obsidian", ["version"], {
    encoding: "utf-8",
    timeout: CLI_TIMEOUT_MS,
  });
  if (ver.status === 0 && ver.stdout.trim()) {
    result.version = ver.stdout.trim();
  }

  // 3. Check if app is responsive (daily:path is a lightweight read-only command)
  const probe = spawnSync("obsidian", ["daily:path"], {
    encoding: "utf-8",
    timeout: CLI_TIMEOUT_MS,
  });
  result.responsive = probe.status === 0;

  return result;
}

/**
 * Append content to today's Daily Note via Obsidian CLI.
 * Command: obsidian daily:append content="..."
 */
export function cliDailyAppend(content: string): CliWriteResult {
  const proc = spawnSync("obsidian", ["daily:append", `content=${content}`], {
    encoding: "utf-8",
    timeout: CLI_WRITE_TIMEOUT_MS,
  });

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
  const proc = spawnSync("obsidian", ["daily:read"], {
    encoding: "utf-8",
    timeout: CLI_TIMEOUT_MS,
  });
  if (proc.status !== 0) return null;
  return proc.stdout ?? null;
}

/**
 * Get the file path of today's Daily Note via Obsidian CLI.
 * Returns null if CLI is unavailable.
 */
export function cliDailyPath(): string | null {
  const proc = spawnSync("obsidian", ["daily:path"], {
    encoding: "utf-8",
    timeout: CLI_TIMEOUT_MS,
  });
  if (proc.status !== 0) return null;
  return (proc.stdout ?? "").trim() || null;
}
