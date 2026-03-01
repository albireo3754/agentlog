/**
 * Obsidian vault auto-detection for agentlog init.
 * Reads macOS Obsidian app registry and scans common paths.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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
