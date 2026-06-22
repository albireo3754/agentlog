import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { parseDocument, stringify } from "yaml";

export const AGENTLOG_HERMES_HOOK_COMMAND = "agentlog hook --source hermes";

export interface HermesConfigTarget {
  profile: string;
  path: string;
}

export interface HermesTargetResult extends HermesConfigTarget {
  changed: boolean;
}

export interface HermesConfigTargetOptions {
  homeDir?: string;
  hermesHome?: string;
  profiles?: string[];
  allProfiles?: boolean;
  command?: string;
}

export interface HermesConfigMutationResult {
  changed: boolean;
  targets: HermesTargetResult[];
}

export type HermesHookState =
  | { kind: "missing"; targets: HermesConfigTarget[] }
  | { kind: "registered"; targets: HermesConfigTarget[] }
  | { kind: "partial"; registered: HermesConfigTarget[]; missing: HermesConfigTarget[] }
  | { kind: "unsupported"; reason: string; targets: HermesConfigTarget[] };

export const HERMES_CONFIG_PATH = join(homedir(), ".hermes", "config.yaml");

function homeFromOptions(options: HermesConfigTargetOptions): string {
  return options.homeDir ?? homedir();
}

function defaultHermesRoot(options: HermesConfigTargetOptions): string {
  return join(homeFromOptions(options), ".hermes");
}

function currentHermesHome(options: HermesConfigTargetOptions): string {
  return options.hermesHome ?? process.env.HERMES_HOME ?? defaultHermesRoot(options);
}

function normalizeProfiles(profiles: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const profile of profiles ?? []) {
    const trimmed = profile.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function hookCommand(options: HermesConfigTargetOptions): string {
  return options.command?.trim() || AGENTLOG_HERMES_HOOK_COMMAND;
}

export function resolveHermesConfigTargets(options: HermesConfigTargetOptions = {}): HermesConfigTarget[] {
  const root = defaultHermesRoot(options);
  const profiles = normalizeProfiles(options.profiles);

  if (options.allProfiles) {
    const targets: HermesConfigTarget[] = [{ profile: "default", path: join(root, "config.yaml") }];
    const profilesRoot = join(root, "profiles");
    if (existsSync(profilesRoot)) {
      for (const name of readdirSync(profilesRoot).sort()) {
        const profilePath = join(profilesRoot, name);
        const configPath = join(profilePath, "config.yaml");
        if (statSync(profilePath).isDirectory() && existsSync(configPath)) {
          targets.push({ profile: name, path: configPath });
        }
      }
    }
    return targets;
  }

  if (profiles.length > 0) {
    return profiles.map((profile) => {
      if (profile === "default") return { profile, path: join(root, "config.yaml") };
      return { profile, path: join(root, "profiles", profile, "config.yaml") };
    });
  }

  return [{ profile: "default", path: join(currentHermesHome(options), "config.yaml") }];
}

export function hermesManualSetupSnippet(): string {
  return [
    "hooks:",
    "  pre_llm_call:",
    `    - command: "${AGENTLOG_HERMES_HOOK_COMMAND}"`,
  ].join("\n");
}

function loadConfigObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};

  const content = readFileSync(path, "utf-8");
  const doc = parseDocument(content || "{}");
  if (doc.errors.length > 0) {
    throw new Error(`Unsupported Hermes config: ${doc.errors[0]?.message ?? "invalid YAML"}`);
  }
  const parsed = doc.toJS();
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Unsupported Hermes config: config.yaml must be a YAML object");
  }
  return parsed as Record<string, unknown>;
}

function writeConfigObject(path: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(value), "utf-8");
}

function ensurePreLlmHookList(config: Record<string, unknown>): Array<Record<string, unknown> | string> {
  if (config["hooks"] === undefined) config["hooks"] = {};
  if (typeof config["hooks"] !== "object" || config["hooks"] === null || Array.isArray(config["hooks"])) {
    throw new Error("Unsupported Hermes config: hooks must be an object");
  }
  const hooks = config["hooks"] as Record<string, unknown>;
  if (hooks["pre_llm_call"] === undefined) hooks["pre_llm_call"] = [];
  if (!Array.isArray(hooks["pre_llm_call"])) {
    throw new Error("Unsupported Hermes config: hooks.pre_llm_call must be an array");
  }
  return hooks["pre_llm_call"] as Array<Record<string, unknown> | string>;
}

function entryCommand(entry: Record<string, unknown> | string): string | null {
  if (typeof entry === "string") return entry;
  const command = entry?.["command"];
  return typeof command === "string" ? command : null;
}

function isAgentlogHookCommand(command: string, desiredCommand: string): boolean {
  const trimmed = command.trim();
  return (
    trimmed === desiredCommand ||
    trimmed === AGENTLOG_HERMES_HOOK_COMMAND ||
    trimmed.endsWith(`/agentlog hook --source hermes`)
  );
}

function hasDesiredAgentlogHook(list: Array<Record<string, unknown> | string>, desiredCommand: string): boolean {
  return list.some((entry) => entryCommand(entry) === desiredCommand);
}

export function registerHermesHook(options: HermesConfigTargetOptions = {}): HermesConfigMutationResult {
  const targets = resolveHermesConfigTargets(options);
  const command = hookCommand(options);
  const results: HermesTargetResult[] = [];

  for (const target of targets) {
    const config = loadConfigObject(target.path);
    const preLlmCall = ensurePreLlmHookList(config);
    const withoutStaleAgentlog = preLlmCall.filter((entry) => {
      const existingCommand = entryCommand(entry);
      return existingCommand === null || !isAgentlogHookCommand(existingCommand, command) || existingCommand === command;
    });
    const removedStale = withoutStaleAgentlog.length !== preLlmCall.length;
    if (removedStale) {
      preLlmCall.splice(0, preLlmCall.length, ...withoutStaleAgentlog);
    }
    const needsAdd = !hasDesiredAgentlogHook(preLlmCall, command);
    const changed = removedStale || needsAdd;
    if (changed) {
      if (needsAdd) preLlmCall.push({ command });
      writeConfigObject(target.path, config);
    }
    results.push({ ...target, changed });
  }

  return {
    changed: results.some((target) => target.changed),
    targets: results,
  };
}

export function unregisterHermesHook(options: HermesConfigTargetOptions = {}): HermesConfigMutationResult {
  const targets = resolveHermesConfigTargets(options);
  const command = hookCommand(options);
  const results: HermesTargetResult[] = [];

  for (const target of targets) {
    if (!existsSync(target.path)) {
      results.push({ ...target, changed: false });
      continue;
    }
    const config = loadConfigObject(target.path);
    const preLlmCall = ensurePreLlmHookList(config);
    const next = preLlmCall.filter((entry) => {
      const existingCommand = entryCommand(entry);
      return existingCommand === null || !isAgentlogHookCommand(existingCommand, command);
    });
    const changed = next.length !== preLlmCall.length;
    if (changed) {
      const hooks = config["hooks"] as Record<string, unknown>;
      hooks["pre_llm_call"] = next;
      writeConfigObject(target.path, config);
    }
    results.push({ ...target, changed });
  }

  return {
    changed: results.some((target) => target.changed),
    targets: results,
  };
}

export function readHermesHookState(options: HermesConfigTargetOptions = {}): HermesHookState {
  const targets = resolveHermesConfigTargets(options);
  const command = hookCommand(options);
  const registered: HermesConfigTarget[] = [];
  const missing: HermesConfigTarget[] = [];

  for (const target of targets) {
    if (!existsSync(target.path)) {
      missing.push(target);
      continue;
    }
    try {
      const config = loadConfigObject(target.path);
      const preLlmCall = ensurePreLlmHookList(config);
      if (preLlmCall.some((entry) => {
        const existingCommand = entryCommand(entry);
        return existingCommand !== null && isAgentlogHookCommand(existingCommand, command);
      })) registered.push(target);
      else missing.push(target);
    } catch (err) {
      return {
        kind: "unsupported",
        reason: err instanceof Error ? err.message : String(err),
        targets,
      };
    }
  }

  if (registered.length === targets.length) return { kind: "registered", targets };
  if (registered.length > 0) return { kind: "partial", registered, missing };
  return { kind: "missing", targets };
}
