/**
 * Obsidian vault auto-detection for agentlog init.
 * Reads macOS Obsidian app registry and scans common paths.
 * Also detects Obsidian CLI (1.12+) availability.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { resolveCliBin, parseCliVersion } from "./obsidian-cli.js";

export interface DetectedVault {
  path: string;
  source: "obsidian-registry" | "common-path";
}

/**
 * Detects Obsidian vaults on the current system.
 * macOS: reads ~/Library/Application Support/Obsidian/obsidian.json
 * All platforms: checks common paths
 */
export function detectVaults(): DetectedVault[] {
  const found: DetectedVault[] = [];
  const seen = new Set<string>();

  // macOS: Obsidian registry
  if (process.platform === "darwin") {
    const registryPath = join(
      homedir(),
      "Library/Application Support/Obsidian/obsidian.json"
    );
    if (existsSync(registryPath)) {
      try {
        const raw = readFileSync(registryPath, "utf-8");
        const data = JSON.parse(raw) as { vaults?: Record<string, { path: string }> };
        for (const vault of Object.values(data.vaults ?? {})) {
          const vaultPath = vault.path;
          if (vaultPath && existsSync(vaultPath) && !seen.has(vaultPath)) {
            seen.add(vaultPath);
            found.push({ path: vaultPath, source: "obsidian-registry" });
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  // Common paths fallback
  const home = homedir();
  const commonPaths = [
    join(home, "Obsidian"),
    join(home, "Documents", "Obsidian"),
    join(home, "Notes"),
    join(home, "Documents", "Notes"),
  ];
  for (const p of commonPaths) {
    if (existsSync(join(p, ".obsidian")) && !seen.has(p)) {
      seen.add(p);
      found.push({ path: p, source: "common-path" });
    }
  }

  return found;
}

export interface CliDetection {
  installed: boolean;
  binPath: string | null;
  version: string | null;
}

/** Detect Obsidian CLI availability. Lightweight — no app-running check. */
export function detectCli(): CliDetection {
  const binPath = resolveCliBin();
  if (!binPath) {
    return { installed: false, binPath: null, version: null };
  }

  const ver = spawnSync(binPath, ["version"], {
    encoding: "utf-8",
    timeout: 3000,
  });
  const version = ver.status === 0 ? parseCliVersion(ver.stdout ?? "") : null;

  return { installed: true, binPath, version };
}
