import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  AGENTLOG_CODEX_NOTIFY_COMMAND,
  hasAgentlogCodexNotify,
  installCodexNotify,
  uninstallCodexNotify,
} from "../codex-settings.js";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, "fixtures", name), "utf-8");
}

describe("codex notify config", () => {
  it("creates a top-level notify when config.toml has no notify", () => {
    const result = installCodexNotify(fixture("codex-config-no-notify.toml"));

    expect(result.changed).toBe(true);
    expect(result.restoreNotify).toBeNull();
    expect(result.toml).toContain(
      `notify = ["${AGENTLOG_CODEX_NOTIFY_COMMAND[0]}", "${AGENTLOG_CODEX_NOTIFY_COMMAND[1]}"]`
    );
    expect(hasAgentlogCodexNotify(result.toml)).toBe(true);
  });

  it("preserves an existing single-line notify command for forward chaining", () => {
    const result = installCodexNotify(fixture("codex-config-existing-notify.toml"));

    expect(result.changed).toBe(true);
    expect(result.restoreNotify).toEqual(["node", "/tmp/existing-notify.js"]);
    expect(hasAgentlogCodexNotify(result.toml)).toBe(true);
  });

  it("is idempotent when run again on an already installed config", () => {
    const first = installCodexNotify(fixture("codex-config-existing-notify.toml"));
    const second = installCodexNotify(first.toml, first.restoreNotify);

    expect(second.changed).toBe(false);
    expect(second.restoreNotify).toEqual(["node", "/tmp/existing-notify.js"]);
    expect(hasAgentlogCodexNotify(second.toml)).toBe(true);
  });

  it("aborts on unsupported multi-line notify arrays", () => {
    expect(() => installCodexNotify(fixture("codex-config-unsupported-notify.toml"))).toThrow(
      "Unsupported notify"
    );
  });

  it("restores the previous notify command on uninstall", () => {
    const installed = installCodexNotify(fixture("codex-config-existing-notify.toml"));
    const restored = uninstallCodexNotify(installed.toml, installed.restoreNotify);

    expect(restored.changed).toBe(true);
    expect(restored.toml).toContain('notify = ["node", "/tmp/existing-notify.js"]');
    expect(hasAgentlogCodexNotify(restored.toml)).toBe(false);
  });

  it("removes the AgentLog notify line when no previous notify existed", () => {
    const installed = installCodexNotify(fixture("codex-config-no-notify.toml"));
    const restored = uninstallCodexNotify(installed.toml, installed.restoreNotify);

    expect(restored.changed).toBe(true);
    expect(restored.toml).not.toContain('notify = ["agentlog", "codex-notify"]');
    expect(hasAgentlogCodexNotify(restored.toml)).toBe(false);
  });

  it("treats table-scoped notify as unrelated and inserts a new top-level notify", () => {
    const result = installCodexNotify(fixture("codex-config-profile-notify.toml"));

    expect(result.changed).toBe(true);
    expect(result.restoreNotify).toBeNull();
    expect(result.toml).toContain('notify = ["agentlog", "codex-notify"]');
    expect(result.toml).toContain('[profiles.default]\nnotify = ["node", "/tmp/existing-profile-notify.js"]');
  });
});
