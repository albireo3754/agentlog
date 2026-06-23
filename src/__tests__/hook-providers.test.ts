import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  hookProviders,
  providersForInitTarget,
  providersForUninstallTarget,
} from "../hook-providers/index.js";

let tmpHome: string;

function makeTmpHome(): string {
  const dir = join(tmpdir(), `agentlog-hook-providers-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("hook provider registry", () => {
  beforeEach(() => {
    tmpHome = makeTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("maps init targets to providers while preserving --all as Claude plus Codex", () => {
    expect(providersForInitTarget("claude")).toEqual(["claude"]);
    expect(providersForInitTarget("codex")).toEqual(["codex"]);
    expect(providersForInitTarget("hermes")).toEqual(["hermes"]);
    expect(providersForInitTarget("all")).toEqual(["claude", "codex"]);
  });

  it("maps uninstall --all to every provider metadata surface", () => {
    expect(providersForUninstallTarget("all")).toEqual(["claude", "codex", "hermes"]);
  });

  it("declares canonical hook commands for all supported providers", () => {
    expect(hookProviders.claude.command).toBe("agentlog hook");
    expect(hookProviders.codex.command).toBe("agentlog hook --source codex");
    expect(hookProviders.hermes.command).toBe("agentlog hook --source hermes");
  });

  it("runs Hermes install, inspect, and uninstall through the provider lifecycle", () => {
    const profileHome = join(tmpHome, ".hermes", "profiles", "alpha");
    mkdirSync(profileHome, { recursive: true });
    writeFileSync(join(profileHome, "config.yaml"), "hooks: {}\n", "utf-8");

    const install = hookProviders.hermes.install({
      vault: join(tmpHome, "notes"),
      plain: true,
      hermesProfiles: ["alpha"],
      homeDir: tmpHome,
    });
    expect(install.changed).toBe(true);
    expect(install.configPatch).toEqual({ hermesHookInstalled: true, hermesProfiles: ["alpha"] });
    expect(readFileSync(join(profileHome, "config.yaml"), "utf-8")).toContain("agentlog hook --source hermes");

    const state = hookProviders.hermes.inspect({ hermesProfiles: ["alpha"], homeDir: tmpHome });
    expect(state.kind).toBe("registered");

    const uninstall = hookProviders.hermes.uninstall({ hermesProfiles: ["alpha"], homeDir: tmpHome });
    expect(uninstall.changed).toBe(true);
    expect(uninstall.configPatch).toEqual({ hermesHookInstalled: undefined, hermesProfiles: undefined });
    expect(readFileSync(join(profileHome, "config.yaml"), "utf-8")).not.toContain("agentlog hook --source hermes");
  });
});
