import { CLAUDE_SETTINGS_PATH, inspectClaudeHookState, registerHook, unregisterHook } from "../claude-settings.js";
import type { AgentLogConfig } from "../types.js";
import type { HookProvider } from "./types.js";

export const claudeProvider: HookProvider = {
  id: "claude",
  label: "Claude Code",
  configFlag: "claudeHookInstalled",
  command: "agentlog hook",

  install() {
    registerHook();
    return {
      changed: true,
      messages: [`Hook registered: ${CLAUDE_SETTINGS_PATH}`],
      configPatch: { claudeHookInstalled: true },
    };
  },

  uninstall() {
    const changed = unregisterHook();
    return {
      changed,
      messages: [
        changed
          ? `Hook removed: ${CLAUDE_SETTINGS_PATH}`
          : "Hook not found (already removed or never registered)",
      ],
      configPatch: { claudeHookInstalled: undefined },
    };
  },

  inspect() {
    const state = inspectClaudeHookState();
    if (state.kind === "registered") return { kind: "registered", detail: CLAUDE_SETTINGS_PATH };
    if (state.kind === "unsupported") {
      return {
        kind: "unsupported",
        detail: `${CLAUDE_SETTINGS_PATH} — ${state.reason}`,
        repairHint: "run: agentlog init to migrate AgentLog hook, or fix Claude settings",
      };
    }
    return {
      kind: "missing",
      detail: "not registered",
      repairHint: "run: agentlog init to re-register",
    };
  },

  isRelevant(config: AgentLogConfig | null) {
    return config?.claudeHookInstalled === true;
  },
};
