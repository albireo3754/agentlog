import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const CODEX_HOOKS_PATH = join(homedir(), ".codex", "hooks.json");
export const CODEX_HOOKS_BACKUP_PATH = join(homedir(), ".codex", "hooks.json.bak");
export const AGENTLOG_CODEX_HOOK_COMMAND = "agentlog hook --source codex";
export const LEGACY_AGENTLOG_CODEX_HOOK_COMMAND = "agentlog hook";

export const CODEX_HOOK_ENTRY = {
  hooks: [
    {
      type: "command",
      command: AGENTLOG_CODEX_HOOK_COMMAND,
    },
  ],
};

export interface CodexHookMutationResult {
  json: string;
  changed: boolean;
}

export type CodexHookState =
  | { kind: "missing" }
  | { kind: "registered" }
  | { kind: "needs_migration"; reason: string }
  | { kind: "unsupported"; reason: string };

function parseHooksJson(json: string): Record<string, unknown> {
  if (json.trim() === "") return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Unsupported Codex hooks configuration: hooks.json is invalid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Unsupported Codex hooks configuration: hooks.json must be an object");
  }

  return parsed as Record<string, unknown>;
}

function isAgentlogCodexHookEntry(entry: unknown): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    Array.isArray((entry as Record<string, unknown>)["hooks"]) &&
    ((entry as Record<string, unknown>)["hooks"] as unknown[]).some(isAgentlogCodexHookHandler)
  );
}

function isAgentlogCodexHookHandler(hook: unknown): boolean {
  return (
    typeof hook === "object" &&
    hook !== null &&
    (hook as Record<string, unknown>)["type"] === "command" &&
    (hook as Record<string, unknown>)["command"] === AGENTLOG_CODEX_HOOK_COMMAND
  );
}

function isLegacyAgentlogCodexHookHandler(hook: unknown): boolean {
  return (
    typeof hook === "object" &&
    hook !== null &&
    (hook as Record<string, unknown>)["type"] === "command" &&
    (hook as Record<string, unknown>)["command"] === LEGACY_AGENTLOG_CODEX_HOOK_COMMAND
  );
}

function hasLegacyAgentlogCodexHookEntry(entry: unknown): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    Array.isArray((entry as Record<string, unknown>)["hooks"]) &&
    ((entry as Record<string, unknown>)["hooks"] as unknown[]).some(isLegacyAgentlogCodexHookHandler)
  );
}

function ensureHookArray(root: Record<string, unknown>): unknown[] {
  if (root["hooks"] === undefined) {
    root["hooks"] = {};
  }
  if (typeof root["hooks"] !== "object" || root["hooks"] === null || Array.isArray(root["hooks"])) {
    throw new Error("Unsupported Codex hooks configuration: hooks must be an object");
  }

  const hooks = root["hooks"] as Record<string, unknown>;
  if (hooks["UserPromptSubmit"] === undefined) {
    hooks["UserPromptSubmit"] = [];
  }
  if (!Array.isArray(hooks["UserPromptSubmit"])) {
    throw new Error("Unsupported Codex hooks configuration: hooks.UserPromptSubmit must be an array");
  }

  return hooks["UserPromptSubmit"] as unknown[];
}

function pruneUserPromptSubmitState(root: Record<string, unknown>): void {
  if (typeof root["state"] !== "object" || root["state"] === null || Array.isArray(root["state"])) {
    return;
  }

  const state = root["state"] as Record<string, unknown>;
  for (const key of Object.keys(state)) {
    if (key.includes(":user_prompt_submit:")) {
      delete state[key];
    }
  }
  if (Object.keys(state).length === 0) {
    delete root["state"];
  }
}

function removeAgentlogHandlers(root: Record<string, unknown>, options: { current: boolean; legacy: boolean }): boolean {
  if (root["hooks"] === undefined) return false;
  if (typeof root["hooks"] !== "object" || root["hooks"] === null || Array.isArray(root["hooks"])) {
    throw new Error("Unsupported Codex hooks configuration: hooks must be an object");
  }

  const hooks = root["hooks"] as Record<string, unknown>;
  if (hooks["UserPromptSubmit"] === undefined) return false;
  if (!Array.isArray(hooks["UserPromptSubmit"])) {
    throw new Error("Unsupported Codex hooks configuration: hooks.UserPromptSubmit must be an array");
  }

  let removed = false;
  const before = hooks["UserPromptSubmit"] as unknown[];
  const after = before.flatMap((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !Array.isArray((entry as Record<string, unknown>)["hooks"])
    ) {
      return [entry];
    }

    const hookGroup = entry as Record<string, unknown>;
    const handlers = hookGroup["hooks"] as unknown[];
    const nextHandlers = handlers.filter((handler) => {
      const shouldRemove =
        (options.current && isAgentlogCodexHookHandler(handler)) ||
        (options.legacy && isLegacyAgentlogCodexHookHandler(handler));
      if (shouldRemove) removed = true;
      return !shouldRemove;
    });
    if (nextHandlers.length === handlers.length) return [entry];
    if (nextHandlers.length === 0) return [];
    return [{ ...hookGroup, hooks: nextHandlers }];
  });
  if (!removed) return false;

  if (after.length === 0) {
    delete hooks["UserPromptSubmit"];
  } else {
    hooks["UserPromptSubmit"] = after;
  }

  if (Object.keys(hooks).length === 0) {
    delete root["hooks"];
  }
  pruneUserPromptSubmitState(root);

  return true;
}

function formatHooksJson(root: Record<string, unknown>): string {
  return `${JSON.stringify(root, null, 2)}\n`;
}

export function installCodexHook(json: string): CodexHookMutationResult {
  const root = parseHooksJson(json);
  const removedLegacy = removeAgentlogHandlers(root, { current: false, legacy: true });
  const userPromptSubmit = ensureHookArray(root);

  if (userPromptSubmit.some(isAgentlogCodexHookEntry)) {
    return removedLegacy ? { json: formatHooksJson(root), changed: true } : { json, changed: false };
  }

  userPromptSubmit.push(CODEX_HOOK_ENTRY);
  return { json: formatHooksJson(root), changed: true };
}

export function uninstallCodexHook(json: string): CodexHookMutationResult {
  const root = parseHooksJson(json);
  const removed = removeAgentlogHandlers(root, { current: true, legacy: true });
  if (!removed) return { json, changed: false };

  if (Object.keys(root).length === 0) {
    return { json: "", changed: true };
  }

  return { json: formatHooksJson(root), changed: true };
}

export function inspectCodexHookState(json: string): CodexHookState {
  let root: Record<string, unknown>;
  try {
    root = parseHooksJson(json);
  } catch (err) {
    return { kind: "unsupported", reason: err instanceof Error ? err.message : String(err) };
  }

  if (root["hooks"] === undefined) return { kind: "missing" };
  if (typeof root["hooks"] !== "object" || root["hooks"] === null || Array.isArray(root["hooks"])) {
    return { kind: "unsupported", reason: "Unsupported Codex hooks configuration: hooks must be an object" };
  }

  const userPromptSubmit = (root["hooks"] as Record<string, unknown>)["UserPromptSubmit"];
  if (userPromptSubmit === undefined) return { kind: "missing" };
  if (!Array.isArray(userPromptSubmit)) {
    return {
      kind: "unsupported",
      reason: "Unsupported Codex hooks configuration: hooks.UserPromptSubmit must be an array",
    };
  }

  const hasCurrent = userPromptSubmit.some(isAgentlogCodexHookEntry);
  const hasLegacy = userPromptSubmit.some(hasLegacyAgentlogCodexHookEntry);
  if (hasLegacy) {
    return {
      kind: "needs_migration",
      reason: hasCurrent
        ? "legacy AgentLog Codex hook remains beside the current hook"
        : "legacy AgentLog Codex hook must be migrated to --source codex",
    };
  }
  return hasCurrent ? { kind: "registered" } : { kind: "missing" };
}

export function hasAgentlogCodexHook(json: string): boolean {
  let root: Record<string, unknown>;
  try {
    root = parseHooksJson(json);
  } catch {
    return false;
  }

  if (typeof root["hooks"] !== "object" || root["hooks"] === null || Array.isArray(root["hooks"])) {
    return false;
  }

  const userPromptSubmit = (root["hooks"] as Record<string, unknown>)["UserPromptSubmit"];
  return Array.isArray(userPromptSubmit) && userPromptSubmit.some(isAgentlogCodexHookEntry);
}

function readCodexHooksJson(): string {
  if (!existsSync(CODEX_HOOKS_PATH)) return "";
  return readFileSync(CODEX_HOOKS_PATH, "utf-8");
}

function writeCodexHooksJson(json: string, backup: boolean): void {
  mkdirSync(join(homedir(), ".codex"), { recursive: true });
  if (backup && existsSync(CODEX_HOOKS_PATH)) {
    copyFileSync(CODEX_HOOKS_PATH, CODEX_HOOKS_BACKUP_PATH);
  }
  if (json === "") {
    rmSync(CODEX_HOOKS_PATH, { force: true });
    return;
  }
  writeFileSync(CODEX_HOOKS_PATH, json, "utf-8");
}

export function registerCodexHook(): CodexHookMutationResult {
  const current = readCodexHooksJson();
  const result = installCodexHook(current);
  if (result.changed) {
    writeCodexHooksJson(result.json, true);
  }
  return result;
}

export function unregisterCodexHook(): CodexHookMutationResult {
  const current = readCodexHooksJson();
  const result = uninstallCodexHook(current);
  if (result.changed) {
    writeCodexHooksJson(result.json, true);
  }
  return result;
}

export function isCodexHookRegistered(): boolean {
  return hasAgentlogCodexHook(readCodexHooksJson());
}

export function readCodexHookState(): CodexHookState {
  return inspectCodexHookState(readCodexHooksJson());
}
