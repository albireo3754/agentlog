import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AgentLogConfig } from "./types.js";

export function configDir(): string {
  return process.env.AGENTLOG_CONFIG_DIR ?? join(homedir(), ".agentlog");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function loadConfig(): AgentLogConfig | null {
  const cfgPath = configPath();
  if (!existsSync(cfgPath)) return null;
  try {
    const raw = readFileSync(cfgPath, "utf-8");
    return JSON.parse(raw) as AgentLogConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: AgentLogConfig): void {
  const cfgDir = configDir();
  mkdirSync(cfgDir, { recursive: true });
  // Expand ~ in vault path before saving
  const normalized: AgentLogConfig = {
    ...config,
    vault: expandHome(config.vault),
  };
  writeFileSync(configPath(), JSON.stringify(normalized, null, 2), "utf-8");
}

export function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}
