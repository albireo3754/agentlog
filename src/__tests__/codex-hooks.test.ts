import { describe, expect, it } from "bun:test";
import {
  AGENTLOG_CODEX_HOOK_COMMAND,
  hasAgentlogCodexHook,
  installCodexHook,
  inspectCodexHookState,
  uninstallCodexHook,
} from "../codex-hooks.js";

describe("codex hook config", () => {
  it("creates a UserPromptSubmit command hook in an empty hooks.json", () => {
    const result = installCodexHook("");

    expect(result.changed).toBe(true);
    expect(hasAgentlogCodexHook(result.json)).toBe(true);
    expect(JSON.parse(result.json)).toEqual({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: AGENTLOG_CODEX_HOOK_COMMAND,
              },
            ],
          },
        ],
      },
    });
  });

  it("preserves unrelated hooks and appends AgentLog idempotently", () => {
    const existing = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo prompt" }] }],
      },
    });

    const first = installCodexHook(existing);
    const second = installCodexHook(first.json);
    const parsed = JSON.parse(second.json);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(parsed.hooks.Stop).toHaveLength(1);
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(2);
    expect(hasAgentlogCodexHook(second.json)).toBe(true);
  });

  it("removes only the AgentLog Codex hook", () => {
    const installed = installCodexHook(JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo prompt" }] }],
      },
    }));

    const removed = uninstallCodexHook(installed.json);
    const parsed = JSON.parse(removed.json);

    expect(removed.changed).toBe(true);
    expect(hasAgentlogCodexHook(removed.json)).toBe(false);
    expect(parsed.hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: "command", command: "echo prompt" }] },
    ]);
  });

  it("removes only the AgentLog handler when a hook group has multiple handlers", () => {
    const installed = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: "agentlog hook --source codex" },
              { type: "command", command: "echo keep-me" },
            ],
          },
        ],
      },
    });

    const removed = uninstallCodexHook(installed);
    const parsed = JSON.parse(removed.json);

    expect(removed.changed).toBe(true);
    expect(hasAgentlogCodexHook(removed.json)).toBe(false);
    expect(parsed.hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: "command", command: "echo keep-me" }] },
    ]);
  });

  it("removes hooks.json when AgentLog was the only hook", () => {
    const installed = installCodexHook("");
    const removed = uninstallCodexHook(installed.json);

    expect(removed.changed).toBe(true);
    expect(removed.json).toBe("");
  });

  it("reports unsupported hook shapes without throwing from inspection", () => {
    expect(inspectCodexHookState("{bad")).toEqual({
      kind: "unsupported",
      reason: "Unsupported Codex hooks configuration: hooks.json is invalid JSON",
    });
    expect(inspectCodexHookState(JSON.stringify({ hooks: [] })).kind).toBe("unsupported");
    expect(inspectCodexHookState(JSON.stringify({ hooks: { UserPromptSubmit: {} } })).kind).toBe("unsupported");
  });
});
