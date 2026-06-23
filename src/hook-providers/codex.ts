import { detectBinary } from "../cli-shared.js";
import {
  CODEX_HOOKS_PATH,
  readCodexHookState,
  registerCodexHook,
  unregisterCodexHook,
  type CodexHookMutationResult,
} from "../codex-hooks.js";
import { CODEX_CONFIG_PATH, readCodexNotifyState, unregisterCodexNotify } from "../codex-settings.js";
import type { AgentLogConfig } from "../types.js";
import type { HookProvider } from "./types.js";

export const codexProvider: HookProvider = {
  id: "codex",
  label: "Codex CLI",
  configFlag: "codexHookInstalled",
  command: "agentlog hook --source codex",

  install() {
    const codexBin = detectBinary("codex");
    if (!codexBin) throw new Error("Error: Codex CLI not found in PATH");

    const result: CodexHookMutationResult = registerCodexHook();
    const messages = [
      `  Codex CLI: ${codexBin}`,
      `Codex hook registered: ${CODEX_HOOKS_PATH}`,
    ];
    if (!result.changed) messages.push("  Existing AgentLog Codex hook left unchanged");
    return {
      changed: result.changed,
      messages,
      configPatch: { codexHookInstalled: true },
    };
  },

  uninstall() {
    const result = unregisterCodexHook();
    const messages = [
      result.changed
        ? `Codex hook removed: ${CODEX_HOOKS_PATH}`
        : "Codex hook not found (already removed or never registered)",
    ];
    return {
      changed: result.changed,
      messages,
      configPatch: { codexHookInstalled: undefined },
    };
  },

  inspect() {
    const state = readCodexHookState();
    const legacyNotifyState = readCodexNotifyState();
    if (state.kind === "registered") {
      return { kind: "registered", detail: `${CODEX_HOOKS_PATH} — hook registered` };
    }
    if (state.kind === "unsupported") {
      return {
        kind: "unsupported",
        detail: `${CODEX_HOOKS_PATH} — unsupported hook config (${state.reason})`,
        repairHint: "fix hooks.json or move it aside, then run: agentlog init --codex",
      };
    }
    if (state.kind === "needs_migration") {
      return {
        kind: "needs_migration",
        detail: `${CODEX_HOOKS_PATH} — ${state.reason}`,
        repairHint: "run: agentlog init --codex to migrate the Codex hook",
      };
    }
    if (legacyNotifyState.kind === "registered") {
      return {
        kind: "missing",
        detail: `${CODEX_CONFIG_PATH} — legacy notify registered; migrate to hooks`,
        repairHint: "run: agentlog init --codex to repair or migrate to hooks",
      };
    }
    if (legacyNotifyState.kind === "unsupported") {
      return {
        kind: "unsupported",
        detail: `${CODEX_CONFIG_PATH} — unsupported legacy notify config (${legacyNotifyState.reason})`,
        repairHint: "simplify legacy notify config or move config.toml aside, then run: agentlog init --codex",
      };
    }
    return {
      kind: "missing",
      detail: `${CODEX_HOOKS_PATH} — not registered`,
      repairHint: "run: agentlog init --codex ~/path/to/vault",
    };
  },

  isRelevant(config: AgentLogConfig | null) {
    const legacyNotifyState = readCodexNotifyState();
    return (
      config?.codexHookInstalled === true ||
      (!!config && Object.prototype.hasOwnProperty.call(config, "codexNotifyRestore")) ||
      readCodexHookState().kind !== "missing" ||
      legacyNotifyState.kind !== "missing"
    );
  },
};

export function uninstallLegacyCodexNotify(config: AgentLogConfig | null): string[] {
  const legacyNotify = unregisterCodexNotify(config?.codexNotifyRestore ?? null);
  if (!legacyNotify.changed) return [];
  const action = legacyNotify.restoreNotify && legacyNotify.restoreNotify.length > 0 ? "restored" : "removed";
  return [`Legacy Codex notify ${action}: ${CODEX_CONFIG_PATH}`];
}
