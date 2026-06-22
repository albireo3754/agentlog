import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  AGENTLOG_HERMES_HOOK_COMMAND,
  readHermesHookState,
  registerHermesHook,
  resolveHermesConfigTargets,
  unregisterHermesHook,
} from "../hermes-config.js";

let tmpHome: string;

function makeTmpHome(): string {
  const dir = join(tmpdir(), `agentlog-hermes-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("Hermes config automation", () => {
  beforeEach(() => {
    tmpHome = makeTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("registers the AgentLog pre_llm_call hook in default config.yaml while preserving unrelated config", () => {
    const hermesDir = join(tmpHome, ".hermes");
    mkdirSync(hermesDir, { recursive: true });
    writeFileSync(join(hermesDir, "config.yaml"), "model:\n  provider: openai\nhooks: {}\n", "utf-8");

    const result = registerHermesHook({ homeDir: tmpHome });

    expect(result.changed).toBe(true);
    expect(result.targets).toEqual([{ profile: "default", path: join(hermesDir, "config.yaml"), changed: true }]);
    const content = read(join(hermesDir, "config.yaml"));
    expect(content).toContain("provider: openai");
    expect(content).toContain("pre_llm_call:");
    expect(content).toContain(`command: ${AGENTLOG_HERMES_HOOK_COMMAND}`);
  });

  it("is idempotent and preserves other pre_llm_call hook commands", () => {
    const configPath = join(tmpHome, ".hermes", "config.yaml");
    mkdirSync(join(tmpHome, ".hermes"), { recursive: true });
    writeFileSync(
      configPath,
      [
        "hooks:",
        "  pre_llm_call:",
        "    - command: echo keep",
        `    - command: ${AGENTLOG_HERMES_HOOK_COMMAND}`,
        "",
      ].join("\n"),
      "utf-8"
    );

    const result = registerHermesHook({ homeDir: tmpHome });

    expect(result.changed).toBe(false);
    expect(read(configPath).match(new RegExp(AGENTLOG_HERMES_HOOK_COMMAND, "g"))).toHaveLength(1);
    expect(read(configPath)).toContain("command: echo keep");
  });

  it("replaces older bare AgentLog hook command with the requested executable path", () => {
    const configPath = join(tmpHome, ".hermes", "config.yaml");
    mkdirSync(join(tmpHome, ".hermes"), { recursive: true });
    writeFileSync(
      configPath,
      'hooks:\n  pre_llm_call:\n    - command: "agentlog hook --source hermes"\n    - command: echo keep\n',
      "utf-8"
    );

    const command = "/Users/pray/.bun/bin/agentlog hook --source hermes";
    const result = registerHermesHook({ homeDir: tmpHome, command });

    expect(result.changed).toBe(true);
    const content = read(configPath);
    expect(content).toContain(command);
    expect(content).not.toContain('command: agentlog hook --source hermes\n');
    expect(content).toContain("echo keep");
    expect(content.match(/hook --source hermes/g)).toHaveLength(1);
  });

  it("supports default plus multiple named Hermes profiles", () => {
    mkdirSync(join(tmpHome, ".hermes", "profiles", "alpha"), { recursive: true });
    mkdirSync(join(tmpHome, ".hermes", "profiles", "beta"), { recursive: true });
    writeFileSync(join(tmpHome, ".hermes", "profiles", "alpha", "config.yaml"), "hooks: {}\n", "utf-8");
    writeFileSync(join(tmpHome, ".hermes", "profiles", "beta", "config.yaml"), "display:\n  theme: dark\n", "utf-8");

    const targets = resolveHermesConfigTargets({ homeDir: tmpHome, profiles: ["default", "alpha", "beta"] });
    const result = registerHermesHook({ homeDir: tmpHome, profiles: ["default", "alpha", "beta"] });

    expect(targets.map((target) => target.profile)).toEqual(["default", "alpha", "beta"]);
    expect(result.changed).toBe(true);
    for (const target of targets) {
      expect(read(target.path)).toContain(AGENTLOG_HERMES_HOOK_COMMAND);
    }
    expect(read(join(tmpHome, ".hermes", "profiles", "beta", "config.yaml"))).toContain("theme: dark");
  });

  it("expands allProfiles to every existing named profile plus default", () => {
    mkdirSync(join(tmpHome, ".hermes", "profiles", "alpha"), { recursive: true });
    mkdirSync(join(tmpHome, ".hermes", "profiles", "beta"), { recursive: true });
    mkdirSync(join(tmpHome, ".hermes", "profiles", "not-a-profile"), { recursive: true });
    writeFileSync(join(tmpHome, ".hermes", "profiles", "alpha", "config.yaml"), "hooks: {}\n", "utf-8");
    writeFileSync(join(tmpHome, ".hermes", "profiles", "beta", "config.yaml"), "hooks: {}\n", "utf-8");

    const targets = resolveHermesConfigTargets({ homeDir: tmpHome, allProfiles: true });

    expect(targets.map((target) => target.profile)).toEqual(["default", "alpha", "beta"]);
  });

  it("unregisters only the AgentLog hook from selected profiles", () => {
    const configPath = join(tmpHome, ".hermes", "config.yaml");
    mkdirSync(join(tmpHome, ".hermes"), { recursive: true });
    writeFileSync(
      configPath,
      [
        "hooks:",
        "  pre_llm_call:",
        "    - command: echo keep",
        `    - command: ${AGENTLOG_HERMES_HOOK_COMMAND}`,
        "",
      ].join("\n"),
      "utf-8"
    );

    const result = unregisterHermesHook({ homeDir: tmpHome });

    expect(result.changed).toBe(true);
    expect(read(configPath)).toContain("command: echo keep");
    expect(read(configPath)).not.toContain(AGENTLOG_HERMES_HOOK_COMMAND);
  });

  it("reports missing and partial profile state", () => {
    mkdirSync(join(tmpHome, ".hermes", "profiles", "alpha"), { recursive: true });
    writeFileSync(join(tmpHome, ".hermes", "profiles", "alpha", "config.yaml"), "hooks: {}\n", "utf-8");
    registerHermesHook({ homeDir: tmpHome, profiles: ["default"] });

    const state = readHermesHookState({ homeDir: tmpHome, profiles: ["default", "alpha"] });

    expect(state.kind).toBe("partial");
    if (state.kind === "partial") {
      expect(state.registered.map((target) => target.profile)).toEqual(["default"]);
      expect(state.missing.map((target) => target.profile)).toEqual(["alpha"]);
    }
  });

  it("rejects invalid YAML without modifying the file", () => {
    const configPath = join(tmpHome, ".hermes", "config.yaml");
    mkdirSync(join(tmpHome, ".hermes"), { recursive: true });
    writeFileSync(configPath, "hooks: [\n", "utf-8");

    expect(() => registerHermesHook({ homeDir: tmpHome })).toThrow("Unsupported Hermes config");
    expect(read(configPath)).toBe("hooks: [\n");
    expect(existsSync(configPath)).toBe(true);
  });
});
