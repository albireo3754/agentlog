import {
  AGENTLOG_HERMES_HOOK_COMMAND,
  HERMES_CONFIG_PATH,
  hermesManualSetupSnippet,
  readHermesHookState,
} from "../hermes-config.js";
import type { AgentLogConfig } from "../types.js";
import type { HookProvider } from "./types.js";

export const hermesProvider: HookProvider = {
  id: "hermes",
  label: "Hermes Agent",
  configFlag: "hermesHookInstalled",
  command: AGENTLOG_HERMES_HOOK_COMMAND,

  install() {
    return {
      changed: false,
      messages: [
        "Hermes manual setup required:",
        `  Add this shell hook to ${HERMES_CONFIG_PATH}:`,
        hermesManualSetupSnippet(),
        "  AgentLog does not edit Hermes YAML automatically.",
      ],
      configPatch: { hermesHookInstalled: true },
    };
  },

  uninstall() {
    return {
      changed: false,
      messages: [
        "Hermes config was not modified by AgentLog.",
        `  Remove '${AGENTLOG_HERMES_HOOK_COMMAND}' from ${HERMES_CONFIG_PATH} if you added it manually.`,
      ],
      configPatch: { hermesHookInstalled: undefined },
    };
  },

  inspect() {
    const state = readHermesHookState();
    if (state.kind === "registered") {
      return { kind: "registered", detail: `${HERMES_CONFIG_PATH} — hook command present` };
    }
    if (state.kind === "unsupported") {
      return {
        kind: "unsupported",
        detail: `${HERMES_CONFIG_PATH} — ${state.reason}`,
        repairHint: "check Hermes config permissions",
      };
    }
    return {
      kind: "missing",
      detail: `${HERMES_CONFIG_PATH} — hook command not detected`,
      repairHint: "add the manual pre_llm_call hook from: agentlog init --hermes ~/path/to/vault",
      warnOnly: true,
    };
  },

  isRelevant(config: AgentLogConfig | null) {
    return config?.hermesHookInstalled === true || readHermesHookState().kind !== "missing";
  },
};
