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

type CliBinCacheState =
  | { status: "unresolved" }
  | { status: "resolved"; bin: string }
  | { status: "not-found" };

/** Cached CLI resolution state for PATH/macos fallback lookup. */
let _cachedBinState: CliBinCacheState = { status: "unresolved" };

function envOverrideBin(): string | null {
  const raw = process.env.OBSIDIAN_BIN?.trim();
  return raw ? raw : null;
}

/**
 * Resolve the `obsidian` CLI binary path.
 * Resolution order:
 * 1) OBSIDIAN_BIN env override
 * 2) `which obsidian`
 * 3) known macOS app bundle paths
 */
export function resolveCliBin(): string | null {
  const override = envOverrideBin();
  if (override) return override;

  if (_cachedBinState.status === "resolved") return _cachedBinState.bin;
  if (_cachedBinState.status === "not-found") return null;

  const which = spawnSync("which", ["obsidian"], { encoding: "utf-8", timeout: 3000 });
  if (which.status === 0 && which.stdout.trim()) {
    _cachedBinState = { status: "resolved", bin: which.stdout.trim() };
    return _cachedBinState.bin;
  }

  if (process.platform === "darwin") {
    for (const p of MACOS_CLI_PATHS) {
      if (existsSync(p)) {
        _cachedBinState = { status: "resolved", bin: p };
        return _cachedBinState.bin;
      }
    }
  }

  _cachedBinState = { status: "not-found" };
  return null;
}

/** Minimum Obsidian version that supports CLI */
export const MIN_CLI_VERSION = "1.12.4";

/** Extract version string from CLI stdout (last non-empty line). */
export function parseCliVersion(stdout: string): string | null {
  const lines = stdout.trim().split("\n").filter(Boolean);
  return (lines.at(-1) ?? "").trim() || null;
}

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

