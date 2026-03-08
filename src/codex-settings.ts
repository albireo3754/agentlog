import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml");
export const CODEX_CONFIG_BACKUP_PATH = join(homedir(), ".codex", "config.toml.bak");
export const AGENTLOG_CODEX_NOTIFY_COMMAND = ["agentlog", "codex-notify"] as const;

export interface CodexNotifyMutationResult {
  toml: string;
  restoreNotify: string[] | null;
  changed: boolean;
}

export type CodexNotifyState =
  | { kind: "missing" }
  | { kind: "registered" }
  | { kind: "other"; command: string[] }
  | { kind: "unsupported"; reason: string };

function formatNotifyCommand(command: readonly string[]): string {
  return `notify = [${command.map((part) => JSON.stringify(part)).join(", ")}]`;
}

function topLevelNotifySearch(lines: string[]): { kind: "missing" } | { kind: "unsupported"; reason: string } | { kind: "present"; index: number; line: string } {
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      return { kind: "missing" };
    }
    if (!/^notify\s*=/.test(trimmed)) continue;
    if (!trimmed.includes("]")) {
      return {
        kind: "unsupported",
        reason: "Unsupported notify configuration: multi-line arrays are not supported",
      };
    }
    return { kind: "present", index, line: lines[index] };
  }
  return { kind: "missing" };
}

function parseSingleLineNotify(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes("[") || !trimmed.includes("]")) {
    throw new Error("Unsupported notify configuration: multi-line arrays are not supported");
  }

  const eqIdx = trimmed.indexOf("=");
  const value = trimmed.slice(eqIdx + 1).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Unsupported notify configuration: expected a single-line string array");
  }

  if (!Array.isArray(parsed) || parsed.some((part) => typeof part !== "string")) {
    throw new Error("Unsupported notify configuration: expected a string array");
  }
  return parsed as string[];
}

export function inspectCodexNotifyState(toml: string): CodexNotifyState {
  const lines = toml.split("\n");
  const search = topLevelNotifySearch(lines);
  if (search.kind === "missing") return { kind: "missing" };
  if (search.kind === "unsupported") {
    return { kind: "unsupported", reason: search.reason };
  }

  let parsed: string[];
  try {
    parsed = parseSingleLineNotify(search.line);
  } catch (err) {
    return {
      kind: "unsupported",
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const isAgentlog =
    parsed.length === AGENTLOG_CODEX_NOTIFY_COMMAND.length &&
    parsed.every((part, index) => part === AGENTLOG_CODEX_NOTIFY_COMMAND[index]);

  if (isAgentlog) return { kind: "registered" };
  return { kind: "other", command: parsed };
}

export function hasAgentlogCodexNotify(toml: string): boolean {
  return inspectCodexNotifyState(toml).kind === "registered";
}

export function installCodexNotify(
  toml: string,
  currentRestore: string[] | null = null
): CodexNotifyMutationResult {
  const lines = toml === "" ? [] : toml.split("\n");
  const search = topLevelNotifySearch(lines);

  if (search.kind === "missing") {
    const nextLines = [formatNotifyCommand(AGENTLOG_CODEX_NOTIFY_COMMAND), ...lines].filter(
      (line, index, all) => !(line === "" && index === all.length - 1)
    );
    return {
      toml: `${nextLines.join("\n")}\n`,
      restoreNotify: currentRestore,
      changed: true,
    };
  }

  if (search.kind === "unsupported") {
    throw new Error(search.reason);
  }

  let parsed: string[];
  try {
    parsed = parseSingleLineNotify(search.line);
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

  const state = inspectCodexNotifyState(search.line);
  if (state.kind === "registered") {
    return {
      toml,
      restoreNotify: currentRestore,
      changed: false,
    };
  }

  lines[search.index] = formatNotifyCommand(AGENTLOG_CODEX_NOTIFY_COMMAND);
  return {
    toml: `${lines.join("\n")}${toml.endsWith("\n") || lines.length === 0 ? "" : "\n"}`,
    restoreNotify: parsed,
    changed: true,
  };
}

export function uninstallCodexNotify(
  toml: string,
  restoreNotify: string[] | null
): CodexNotifyMutationResult {
  const lines = toml.split("\n");
  const search = topLevelNotifySearch(lines);
  if (search.kind !== "present" || !hasAgentlogCodexNotify(toml)) {
    return {
      toml,
      restoreNotify,
      changed: false,
    };
  }

  if (restoreNotify && restoreNotify.length > 0) {
    lines[search.index] = formatNotifyCommand(restoreNotify);
  } else {
    lines.splice(search.index, 1);
    if (lines[0] === "") lines.shift();
  }

  return {
    toml: `${lines.join("\n")}${lines.length > 0 && !toml.endsWith("\n") ? "" : "\n"}`,
    restoreNotify,
    changed: true,
  };
}

function readCodexConfigToml(): string {
  if (!existsSync(CODEX_CONFIG_PATH)) return "";
  return readFileSync(CODEX_CONFIG_PATH, "utf-8");
}

function writeCodexConfigToml(toml: string, backup: boolean): void {
  mkdirSync(join(homedir(), ".codex"), { recursive: true });
  if (backup && existsSync(CODEX_CONFIG_PATH)) {
    copyFileSync(CODEX_CONFIG_PATH, CODEX_CONFIG_BACKUP_PATH);
  }
  writeFileSync(CODEX_CONFIG_PATH, toml, "utf-8");
}

export function registerCodexNotify(
  currentRestore: string[] | null = null
): CodexNotifyMutationResult {
  const current = readCodexConfigToml();
  const result = installCodexNotify(current, currentRestore);
  if (result.changed) {
    writeCodexConfigToml(result.toml, true);
  }
  return result;
}

export function unregisterCodexNotify(
  restoreNotify: string[] | null
): CodexNotifyMutationResult {
  const current = readCodexConfigToml();
  const result = uninstallCodexNotify(current, restoreNotify);
  if (result.changed) {
    writeCodexConfigToml(result.toml, true);
  }
  return result;
}

export function isCodexNotifyRegistered(): boolean {
  return hasAgentlogCodexNotify(readCodexConfigToml());
}

export function codexNotifyConfigExists(): boolean {
  return existsSync(CODEX_CONFIG_PATH);
}

export function readCodexNotifyState(): CodexNotifyState {
  return inspectCodexNotifyState(readCodexConfigToml());
}
