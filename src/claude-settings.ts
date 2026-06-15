/**
 * Claude Code settings.json hook management.
 * Centralizes read/write/query of the agentlog hook entry
 * in ~/.claude/settings.json.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
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

export type ClaudeHookState =
  | { kind: "registered" }
  | { kind: "missing" }
  | { kind: "unsupported"; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns true if the given hook entry contains an "agentlog hook" command. */
function isAgentlogHookEntry(entry: unknown): boolean {
  return (
    isPlainObject(entry) &&
    Array.isArray((entry as Record<string, unknown>)["hooks"]) &&
    ((entry as Record<string, unknown>)["hooks"] as unknown[]).some(
      (h) =>
        isPlainObject(h) &&
        (h as Record<string, unknown>)["command"] === "agentlog hook"
    )
  );
}

function readClaudeSettings(): Record<string, unknown> | null {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readClaudeSettingsState():
  | { kind: "missing" }
  | { kind: "ok"; settings: Record<string, unknown> }
  | { kind: "unsupported"; reason: string } {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return { kind: "missing" };
  try {
    const parsed = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"));
    if (!isPlainObject(parsed)) {
      return { kind: "unsupported", reason: "settings.json must be an object" };
    }
    return { kind: "ok", settings: parsed };
  } catch {
    return { kind: "unsupported", reason: "settings.json is invalid JSON" };
  }
}

function writeClaudeSettings(settings: Record<string, unknown>): void {
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}

export function validateClaudeHookSettings(settings: Record<string, unknown>): string | null {
  const hooks = settings["hooks"];
  if (hooks === undefined) return null;
  if (!isPlainObject(hooks)) return "hooks must be an object";

  for (const [eventName, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) return `hooks.${eventName} must be an array`;

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (!isPlainObject(entry)) return `hooks.${eventName}.${index} must be an object`;
      if ("matcher" in entry && typeof entry["matcher"] !== "string") {
        return `hooks.${eventName}.${index}.matcher must be a string`;
      }
      if (!Array.isArray(entry["hooks"])) {
        return `hooks.${eventName}.${index}.hooks must be an array`;
      }
    }
  }

  return null;
}

export function unregisterHook(): boolean {
  const settings = readClaudeSettings();
  if (!settings) return false;

  const hooks = settings["hooks"] as Record<string, unknown> | undefined;
  if (!hooks || !Array.isArray(hooks["UserPromptSubmit"])) return false;

  const before = hooks["UserPromptSubmit"] as unknown[];
  const after = before.filter((entry) => !isAgentlogHookEntry(entry));

  if (after.length === before.length) return false; // nothing removed

  if (after.length === 0) {
    delete hooks["UserPromptSubmit"];
  } else {
    hooks["UserPromptSubmit"] = after;
  }

  if (Object.keys(hooks).length === 0) {
    delete settings["hooks"];
  }

  if (Object.keys(settings).length === 0) {
    rmSync(CLAUDE_SETTINGS_PATH, { force: true });
  } else {
    writeClaudeSettings(settings);
  }

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

  // Replace any AgentLog-owned stale hook entry with the canonical matcher string format.
  hooks["UserPromptSubmit"] = [
    ...upsArr.filter((entry) => !isAgentlogHookEntry(entry)),
    HOOK_ENTRY,
  ];

  writeClaudeSettings(settings);
}

export function inspectClaudeHookState(): ClaudeHookState {
  const state = readClaudeSettingsState();
  if (state.kind === "missing") return { kind: "missing" };
  if (state.kind === "unsupported") return { kind: "unsupported", reason: state.reason };

  const validationError = validateClaudeHookSettings(state.settings);
  if (validationError) return { kind: "unsupported", reason: validationError };

  const hooks = state.settings["hooks"] as Record<string, unknown> | undefined;
  if (!hooks || !Array.isArray(hooks["UserPromptSubmit"])) return { kind: "missing" };

  return (hooks["UserPromptSubmit"] as unknown[]).some(isAgentlogHookEntry)
    ? { kind: "registered" }
    : { kind: "missing" };
}

/** Returns true if the agentlog hook is registered in ~/.claude/settings.json */
export function isHookRegistered(): boolean {
  return inspectClaudeHookState().kind === "registered";
}
