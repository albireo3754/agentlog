/**
 * Structured error definitions for AgentLog CLI.
 */

export interface AgentLogError {
  code: string;
  message: string;
  fix: string;
  docs?: string;
}

export const Errors = {
  VAULT_NOT_FOUND: (vault: string): AgentLogError => ({
    code: "VAULT_NOT_FOUND",
    message: `Directory not found: ${vault}`,
    fix: `run: agentlog init ~/path/to/vault`,
  }),

  VAULT_NOT_OBSIDIAN: (vault: string): AgentLogError => ({
    code: "VAULT_NOT_OBSIDIAN",
    message: `Obsidian vault not detected at: ${vault}`,
    fix: `Open the folder as a vault in Obsidian, then run: agentlog init ${vault}\nOr to write to a plain folder: agentlog init --plain ~/notes`,
    docs: "https://obsidian.md/download",
  }),

  CONFIG_NOT_FOUND: (): AgentLogError => ({
    code: "CONFIG_NOT_FOUND",
    message: "AgentLog is not configured",
    fix: "run: agentlog init ~/path/to/vault",
  }),

  HOOK_NOT_REGISTERED: (): AgentLogError => ({
    code: "HOOK_NOT_REGISTERED",
    message: "AgentLog hook is not registered in Claude settings",
    fix: "run: agentlog init",
  }),

  CLI_NOT_FOUND: (): AgentLogError => ({
    code: "CLI_NOT_FOUND",
    message: "Obsidian CLI not found in PATH",
    fix: "Enable CLI in Obsidian 1.12+ Settings > General > Command line interface",
  }),

  APP_NOT_RESPONDING: (): AgentLogError => ({
    code: "APP_NOT_RESPONDING",
    message: "Obsidian app is not responding",
    fix: "Start the Obsidian app, or check CLI settings",
  }),

  PROMPT_REQUIRED: (): AgentLogError => ({
    code: "PROMPT_REQUIRED",
    message: "A prompt argument is required for codex-debug",
    fix: 'run: agentlog codex-debug "your prompt text"',
  }),
} as const;

export function formatError(err: AgentLogError): string {
  return `Error: ${err.message}\n  Fix: ${err.fix}`;
}

export function toJsonError(err: AgentLogError): object {
  return { status: "error", ...err };
}
