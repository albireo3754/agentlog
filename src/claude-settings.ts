/**
 * Claude Code settings.json hook management.
 * Centralizes read/write/query of the agentlog hook entry
 * in ~/.claude/settings.json.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

export const HOOK_ENTRY = {
  matcher: "",
  hooks: [
    {
      type: "command",
      command: "agentlog hook",
    },
  ],
};

/** Returns true if the given hook entry contains an "agentlog hook" command. */
function isAgentlogHookEntry(entry: unknown): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    Array.isArray((entry as Record<string, unknown>)["hooks"]) &&
    ((entry as Record<string, unknown>)["hooks"] as unknown[]).some(
      (h) =>
        typeof h === "object" &&
        h !== null &&
        (h as Record<string, unknown>)["command"] === "agentlog hook"
    )
  );
}

function readClaudeSettings(): Record<string, unknown> | null {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function writeClaudeSettings(settings: Record<string, unknown>): void {
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}

export function unregisterHook(): boolean {
  const settings = readClaudeSettings();
  if (!settings) return false;

  const hooks = settings["hooks"] as Record<string, unknown> | undefined;
  if (!hooks || !Array.isArray(hooks["UserPromptSubmit"])) return false;

  const before = hooks["UserPromptSubmit"] as unknown[];
  const after = before.filter((entry) => !isAgentlogHookEntry(entry));

  if (after.length === before.length) return false; // nothing removed

  hooks["UserPromptSubmit"] = after;
  writeClaudeSettings(settings);
  return true;
}

export function registerHook(): void {
  // Ensure ~/.claude exists
  mkdirSync(join(homedir(), ".claude"), { recursive: true });

  let settings: Record<string, unknown> = readClaudeSettings() ?? {};

  // Ensure hooks.UserPromptSubmit array exists
  if (typeof settings["hooks"] !== "object" || settings["hooks"] === null) {
    settings["hooks"] = {};
  }
  const hooks = settings["hooks"] as Record<string, unknown>;

  if (!Array.isArray(hooks["UserPromptSubmit"])) {
    hooks["UserPromptSubmit"] = [];
  }
  const upsArr = hooks["UserPromptSubmit"] as unknown[];

  // Idempotent: only add if not already registered
  if (!upsArr.some(isAgentlogHookEntry)) {
    upsArr.push(HOOK_ENTRY);
  }

  writeClaudeSettings(settings);
}

/** Returns true if the agentlog hook is registered in ~/.claude/settings.json */
export function isHookRegistered(): boolean {
  const settings = readClaudeSettings();
  if (!settings) return false;

  const hooks = settings["hooks"] as Record<string, unknown> | undefined;
  if (!hooks || !Array.isArray(hooks["UserPromptSubmit"])) return false;

  return (hooks["UserPromptSubmit"] as unknown[]).some(isAgentlogHookEntry);
}
