import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AgentLogConfig } from "./types.js";

const CONFIG_DIR = join(homedir(), ".agentlog");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function configPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): AgentLogConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as AgentLogConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: AgentLogConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  // Expand ~ in vault path before saving
  const normalized: AgentLogConfig = {
    ...config,
    vault: expandHome(config.vault),
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2), "utf-8");
}

export function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}
