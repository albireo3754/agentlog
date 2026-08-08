import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { YAMLMap, YAMLSeq, isMap, isScalar, isSeq, parseDocument, type Document, type Node } from "yaml";

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
type HermesDocument = Document<Node, false>;
type HermesMap = YAMLMap<unknown, Node>;
type HermesSeq = YAMLSeq<Node>;

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
  const root = currentHermesHome(options);
  const profiles = normalizeProfiles(options.profiles);

  if (options.allProfiles) {
    const targets: HermesConfigTarget[] = [{ profile: "default", path: join(root, "config.yaml") }];
    const profilesRoot = join(root, "profiles");
    if (existsSync(profilesRoot)) {
      for (const name of readdirSync(profilesRoot).sort()) {
        const profilePath = join(profilesRoot, name);
        const configPath = join(profilePath, "config.yaml");
        let isDirectory = false;
        try {
          isDirectory = statSync(profilePath).isDirectory();
        } catch {
          continue;
        }
        if (isDirectory && existsSync(configPath)) {
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

function loadConfigDocument(path: string): HermesDocument {
  if (!existsSync(path)) {
    const doc = parseDocument<Node, false>("");
    doc.contents = new YAMLMap() as Node;
    return doc;
  }

  const content = readFileSync(path, "utf-8");
  const doc = parseDocument<Node, false>(content || "");
  if (doc.errors.length > 0) {
    throw new Error(`Unsupported Hermes config: ${doc.errors[0]?.message ?? "invalid YAML"}`);
  }
  if (doc.contents === null) {
    doc.contents = new YAMLMap() as Node;
  }
  if (!isMap(doc.contents)) {
    throw new Error("Unsupported Hermes config: config.yaml must be a YAML object");
  }
  return doc;
}

function writeConfigDocument(path: string, doc: HermesDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(doc), "utf-8");
}

function ensureRootMap(doc: HermesDocument): HermesMap {
  if (doc.contents === null) doc.contents = new YAMLMap() as Node;
  if (!isMap(doc.contents)) {
    throw new Error("Unsupported Hermes config: config.yaml must be a YAML object");
  }
  return doc.contents as HermesMap;
}

function ensurePreLlmHookList(doc: HermesDocument): HermesSeq {
  const root = ensureRootMap(doc);
  let hooks = root.get("hooks", true) as Node | undefined | null;
  if (hooks === undefined || hooks === null) {
    hooks = new YAMLMap() as Node;
    root.set("hooks", hooks);
  }
  if (!isMap(hooks)) {
    throw new Error("Unsupported Hermes config: hooks must be an object");
  }
  const hooksMap = hooks as HermesMap;
  let preLlmCall = hooksMap.get("pre_llm_call", true) as Node | undefined | null;
  if (preLlmCall === undefined || preLlmCall === null) {
    preLlmCall = new YAMLSeq() as Node;
    hooksMap.set("pre_llm_call", preLlmCall);
  }
  if (!isSeq(preLlmCall)) {
    throw new Error("Unsupported Hermes config: hooks.pre_llm_call must be an array");
  }
  return preLlmCall as HermesSeq;
}

function entryCommand(entry: unknown): string | null {
  if (isScalar(entry)) return typeof entry.value === "string" ? entry.value : null;
  if (!isMap(entry)) return null;
  const command = entry.get("command", true);
  if (typeof command === "string") return command;
  return isScalar(command) && typeof command.value === "string" ? command.value : null;
}

function isAgentlogHookCommand(command: string, desiredCommand: string): boolean {
  const trimmed = command.trim();
  const unquotedAgentlogSuffix = /(?:^|\s)(?:"[^"]*\/agentlog"|'[^']*\/agentlog'|[^'" ]*\/agentlog) hook --source hermes$/;
  return (
    trimmed === desiredCommand ||
    trimmed === AGENTLOG_HERMES_HOOK_COMMAND ||
    trimmed.endsWith(`/agentlog hook --source hermes`) ||
    unquotedAgentlogSuffix.test(trimmed)
  );
}

function hasDesiredAgentlogHook(list: HermesSeq, desiredCommand: string): boolean {
  return list.items.some((entry) => entryCommand(entry) === desiredCommand);
}

export function registerHermesHook(options: HermesConfigTargetOptions = {}): HermesConfigMutationResult {
  const targets = resolveHermesConfigTargets(options);
  const command = hookCommand(options);
  const results: HermesTargetResult[] = [];

  for (const target of targets) {
    const doc = loadConfigDocument(target.path);
    const preLlmCall = ensurePreLlmHookList(doc);
    const withoutStaleAgentlog = preLlmCall.items.filter((entry) => {
      const existingCommand = entryCommand(entry);
      return existingCommand === null || !isAgentlogHookCommand(existingCommand, command) || existingCommand === command;
    });
    const removedStale = withoutStaleAgentlog.length !== preLlmCall.items.length;
    if (removedStale) {
      preLlmCall.items.splice(0, preLlmCall.items.length, ...withoutStaleAgentlog);
    }
    const needsAdd = !hasDesiredAgentlogHook(preLlmCall, command);
    const changed = removedStale || needsAdd;
    if (changed) {
      if (needsAdd) preLlmCall.items.push(doc.createNode({ command }));
      writeConfigDocument(target.path, doc);
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
    const doc = loadConfigDocument(target.path);
    const preLlmCall = ensurePreLlmHookList(doc);
    const next = preLlmCall.items.filter((entry) => {
      const existingCommand = entryCommand(entry);
      return existingCommand === null || !isAgentlogHookCommand(existingCommand, command);
    });
    const changed = next.length !== preLlmCall.items.length;
    if (changed) {
      preLlmCall.items.splice(0, preLlmCall.items.length, ...next);
      writeConfigDocument(target.path, doc);
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
      const doc = loadConfigDocument(target.path);
      const preLlmCall = ensurePreLlmHookList(doc);
      if (preLlmCall.items.some((entry) => {
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
