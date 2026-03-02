import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { homedir } from "os";

// Tests use AGENTLOG_CONFIG_DIR to isolate from real ~/.agentlog/config.json.
// No backup/restore dance needed — each test gets a fresh temp directory.

import { loadConfig, saveConfig, expandHome, configPath } from "../config.js";

let tempDir: string;

function makeTempDir(): string {
  const dir = join(tmpdir(), `agentlog-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("config", () => {
  beforeEach(() => {
    tempDir = makeTempDir();
    process.env.AGENTLOG_CONFIG_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.AGENTLOG_CONFIG_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  // C10: configPath respects AGENTLOG_CONFIG_DIR
  it("configPath returns path under AGENTLOG_CONFIG_DIR when set", () => {
    expect(configPath()).toBe(join(tempDir, "config.json"));
  });

  // C10b: configPath defaults to ~/.agentlog when env is unset
  it("configPath defaults to ~/.agentlog/config.json", () => {
    delete process.env.AGENTLOG_CONFIG_DIR;
    expect(configPath()).toBe(join(homedir(), ".agentlog", "config.json"));
  });

  // C2: loadConfig when file missing
  it("loadConfig returns null when config file is missing", () => {
    expect(loadConfig()).toBeNull();
  });

  // C1: loadConfig when file exists
  it("loadConfig returns parsed config when file exists", () => {
    const cfg = { vault: "/Users/testuser/Obsidian" };
    writeFileSync(join(tempDir, "config.json"), JSON.stringify(cfg), "utf-8");

    const result = loadConfig();
    expect(result).not.toBeNull();
    expect(result!.vault).toBe("/Users/testuser/Obsidian");
  });

  // C3: loadConfig with malformed JSON
  it("loadConfig returns null when config file has malformed JSON", () => {
    writeFileSync(join(tempDir, "config.json"), "{broken", "utf-8");

    expect(loadConfig()).toBeNull();
  });

  // C4: saveConfig creates dir if missing
  it("saveConfig creates the config directory if it does not exist", () => {
    const nested = join(tempDir, "nested");
    process.env.AGENTLOG_CONFIG_DIR = nested;

    saveConfig({ vault: "/some/vault" });

    expect(existsSync(nested)).toBe(true);
    expect(existsSync(join(nested, "config.json"))).toBe(true);
  });

  // C5: saveConfig expands ~ in vault path
  it("saveConfig expands ~ in vault path before writing", () => {
    saveConfig({ vault: "~/Obsidian" });

    const result = loadConfig();
    expect(result).not.toBeNull();
    expect(result!.vault).toBe(join(homedir(), "Obsidian"));
    expect(result!.vault).not.toContain("~");
  });

  // C6: save then load round-trip
  it("saveConfig and loadConfig round-trip preserves all fields", () => {
    const cfg = { vault: "/abs/vault", plain: true };
    saveConfig(cfg);

    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.vault).toBe("/abs/vault");
    expect(loaded!.plain).toBe(true);
  });

  // C7: expandHome with ~/
  it("expandHome expands ~/ prefix to home directory", () => {
    const result = expandHome("~/foo/bar");
    expect(result).toBe(join(homedir(), "foo/bar"));
  });

  // C8: expandHome with absolute path
  it("expandHome leaves absolute paths unchanged", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
  });

  // C9: expandHome with relative path
  it("expandHome leaves relative paths unchanged", () => {
    expect(expandHome("relative/path")).toBe("relative/path");
  });
});
