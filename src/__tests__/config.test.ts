import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { tmpdir } from "os";

// We test config functions by overriding the module's path resolution via temp dirs.
// Since CONFIG_PATH is hardcoded to ~/.agentlog/config.json, we import and test
// the exported functions directly (loadConfig/saveConfig operate on that fixed path).
// For isolation, we back up and restore any real config.

import { loadConfig, saveConfig, expandHome, configPath } from "../config.js";

const REAL_CONFIG = join(homedir(), ".agentlog", "config.json");
const BACKUP_PATH = join(tmpdir(), `agentlog-config-backup-${Date.now()}.json`);

function backupConfig() {
  if (existsSync(REAL_CONFIG)) {
    const content = Bun.file(REAL_CONFIG).toString();
    writeFileSync(BACKUP_PATH, content, "utf-8");
    return true;
  }
  return false;
}

function restoreConfig(hadBackup: boolean) {
  if (hadBackup && existsSync(BACKUP_PATH)) {
    const content = Bun.file(BACKUP_PATH).toString();
    writeFileSync(REAL_CONFIG, content, "utf-8");
    rmSync(BACKUP_PATH, { force: true });
  } else {
    // Remove any test-written config
    rmSync(REAL_CONFIG, { force: true });
  }
}

describe("config", () => {
  let hadBackup = false;

  beforeEach(() => {
    hadBackup = backupConfig();
    // Remove config so each test starts clean
    rmSync(REAL_CONFIG, { force: true });
  });

  afterEach(() => {
    restoreConfig(hadBackup);
  });

  // C10: configPath returns expected location
  it("configPath returns ~/.agentlog/config.json", () => {
    expect(configPath()).toBe(join(homedir(), ".agentlog", "config.json"));
  });

  // C2: loadConfig when file missing
  it("loadConfig returns null when config file is missing", () => {
    expect(loadConfig()).toBeNull();
  });

  // C1: loadConfig when file exists
  it("loadConfig returns parsed config when file exists", () => {
    const cfg = { vault: "/Users/testuser/Obsidian" };
    mkdirSync(join(homedir(), ".agentlog"), { recursive: true });
    writeFileSync(REAL_CONFIG, JSON.stringify(cfg), "utf-8");

    const result = loadConfig();
    expect(result).not.toBeNull();
    expect(result!.vault).toBe("/Users/testuser/Obsidian");
  });

  // C3: loadConfig with malformed JSON
  it("loadConfig returns null when config file has malformed JSON", () => {
    mkdirSync(join(homedir(), ".agentlog"), { recursive: true });
    writeFileSync(REAL_CONFIG, "{broken", "utf-8");

    expect(loadConfig()).toBeNull();
  });

  // C4: saveConfig creates dir if missing
  it("saveConfig creates the .agentlog directory if it does not exist", () => {
    const agentlogDir = join(homedir(), ".agentlog");
    rmSync(agentlogDir, { recursive: true, force: true });

    saveConfig({ vault: "/some/vault" });

    expect(existsSync(agentlogDir)).toBe(true);
    expect(existsSync(REAL_CONFIG)).toBe(true);
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
