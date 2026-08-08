import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";
import { hermesProvider } from "./hermes.js";
import type { HookProvider, HookProviderId, InitTarget, UninstallTarget } from "./types.js";

export type { HookProvider, HookProviderId, InitTarget, UninstallTarget } from "./types.js";

export const hookProviders = {
  claude: claudeProvider,
  codex: codexProvider,
  hermes: hermesProvider,
} satisfies Record<HookProviderId, HookProvider>;

export function providerById(id: HookProviderId): HookProvider {
  return hookProviders[id];
}

export function providersForInitTarget(target: InitTarget): HookProviderId[] {
  if (target === "all") return ["claude", "codex"];
  return [target];
}

export function providersForUninstallTarget(target: UninstallTarget): HookProviderId[] {
  if (target === "all") return ["claude", "codex", "hermes"];
  return [target];
}
