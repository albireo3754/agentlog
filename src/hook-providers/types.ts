import type { AgentLogConfig } from "../types.js";

export type HookProviderId = "claude" | "codex" | "hermes";
export type InitTarget = HookProviderId | "all";
export type UninstallTarget = HookProviderId | "all";

export type HookProviderState =
  | { kind: "registered"; detail: string }
  | { kind: "missing"; detail: string; repairHint: string; warnOnly?: boolean }
  | { kind: "needs_migration"; detail: string; repairHint: string }
  | { kind: "unsupported"; detail: string; repairHint: string };

export interface HookInstallContext {
  vault: string;
  plain: boolean;
  homeDir?: string;
  hermesHome?: string;
  hermesProfiles?: string[];
  hermesAllProfiles?: boolean;
}

export interface HookInstallResult {
  changed: boolean;
  messages: string[];
  configPatch?: Partial<AgentLogConfig>;
}

export interface HookUninstallResult {
  changed: boolean;
  messages: string[];
  configPatch?: Partial<AgentLogConfig>;
}

export interface HookProvider {
  id: HookProviderId;
  label: string;
  configFlag: "claudeHookInstalled" | "codexHookInstalled" | "hermesHookInstalled";
  command: string;
  install(ctx: HookInstallContext): HookInstallResult;
  uninstall(ctx?: Partial<HookInstallContext>): HookUninstallResult;
  inspect(ctx?: Partial<HookInstallContext>): HookProviderState;
  isRelevant(config: AgentLogConfig | null, ctx?: Partial<HookInstallContext>): boolean;
}
