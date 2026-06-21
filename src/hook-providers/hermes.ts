import {
  AGENTLOG_HERMES_HOOK_COMMAND,
  type HermesConfigTargetOptions,
  readHermesHookState,
  registerHermesHook,
  unregisterHermesHook,
} from "../hermes-config.js";
import type { AgentLogConfig } from "../types.js";
import type { HookInstallContext, HookProvider } from "./types.js";

function hermesOptions(ctx: Partial<HookInstallContext> | undefined): HermesConfigTargetOptions {
  return {
    homeDir: ctx?.homeDir,
    hermesHome: ctx?.hermesHome,
    profiles: ctx?.hermesProfiles,
    allProfiles: ctx?.hermesAllProfiles,
  };
}

function profilesFromTargets(targets: Array<{ profile: string }>): string[] {
  return targets.map((target) => target.profile);
}

function formatTargets(targets: Array<{ profile: string; path: string }>): string {
  return targets.map((target) => `${target.profile}:${target.path}`).join(", ");
}

export const hermesProvider: HookProvider = {
  id: "hermes",
  label: "Hermes Agent",
  configFlag: "hermesHookInstalled",
  command: AGENTLOG_HERMES_HOOK_COMMAND,

  install(ctx) {
    const result = registerHermesHook(hermesOptions(ctx));
    return {
      changed: result.changed,
      messages: [
        `Hermes hook registered: ${formatTargets(result.targets)}`,
        `  ${AGENTLOG_HERMES_HOOK_COMMAND}`,
      ],
      configPatch: {
        hermesHookInstalled: true,
        hermesProfiles: profilesFromTargets(result.targets),
      },
    };
  },

  uninstall(ctx) {
    const result = unregisterHermesHook(hermesOptions(ctx));
    return {
      changed: result.changed,
      messages: [
        result.changed
          ? `Hermes hook removed: ${formatTargets(result.targets)}`
          : `Hermes hook not found: ${formatTargets(result.targets)}`,
      ],
      configPatch: { hermesHookInstalled: undefined, hermesProfiles: undefined },
    };
  },

  inspect(ctx) {
    const state = readHermesHookState(hermesOptions(ctx));
    if (state.kind === "registered") {
      return { kind: "registered", detail: `${formatTargets(state.targets)} — hook command present` };
    }
    if (state.kind === "unsupported") {
      return {
        kind: "unsupported",
        detail: `${formatTargets(state.targets)} — ${state.reason}`,
        repairHint: "check Hermes config permissions",
      };
    }
    if (state.kind === "partial") {
      return {
        kind: "missing",
        detail: `registered: ${formatTargets(state.registered)}; missing: ${formatTargets(state.missing)}`,
        repairHint: "run: agentlog init --hermes to repair Hermes hooks",
      };
    }
    return {
      kind: "missing",
      detail: `${formatTargets(state.targets)} — hook command not detected`,
      repairHint: "run: agentlog init --hermes ~/path/to/vault",
    };
  },

  isRelevant(config: AgentLogConfig | null, ctx) {
    return config?.hermesHookInstalled === true || readHermesHookState(hermesOptions(ctx)).kind !== "missing";
  },
};
