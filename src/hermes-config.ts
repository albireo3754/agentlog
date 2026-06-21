import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const HERMES_CONFIG_PATH = join(homedir(), ".hermes", "config.yaml");
export const AGENTLOG_HERMES_HOOK_COMMAND = "agentlog hook --source hermes";

export type HermesHookState =
  | { kind: "missing" }
  | { kind: "registered" }
  | { kind: "unsupported"; reason: string };

export function hermesManualSetupSnippet(): string {
  return [
    "hooks:",
    "  pre_llm_call:",
    `    - command: "${AGENTLOG_HERMES_HOOK_COMMAND}"`,
  ].join("\n");
}

export function readHermesHookState(): HermesHookState {
  if (!existsSync(HERMES_CONFIG_PATH)) return { kind: "missing" };

  let content: string;
  try {
    content = readFileSync(HERMES_CONFIG_PATH, "utf-8");
  } catch (err) {
    return { kind: "unsupported", reason: err instanceof Error ? err.message : String(err) };
  }

  return content.includes(AGENTLOG_HERMES_HOOK_COMMAND)
    ? { kind: "registered" }
    : { kind: "missing" };
}
