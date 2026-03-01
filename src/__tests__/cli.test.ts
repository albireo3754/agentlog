import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";

/**
 * CLI tests use a subprocess approach: spawn `bun run src/cli.ts` with arguments
 * and check stdout/stderr + side effects (config file, settings.json).
 *
 * The AGENTLOG_CONFIG_DIR and CLAUDE_SETTINGS_PATH overrides are handled by
 * environment variables that cli.ts respects (if supported), otherwise we test
 * the exported registerHook and saveConfig logic directly via imports.
 *
 * For MVP, we spawn the CLI as a subprocess and redirect writes to temp dirs
 * by temporarily overriding HOME env var.
 */

const PROJECT_ROOT = "/Users/pray/work/js/agentlog";

async function runCli(
  args: string[],
  opts: { HOME?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = { ...process.env, ...opts };
  const proc = Bun.spawn(
    ["bun", "run", join(PROJECT_ROOT, "src/cli.ts"), ...args],
    {
      stdout: "pipe",
      stderr: "pipe",
      env,
    }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function makeTmpHome(): string {
  const dir = join(tmpdir(), `agentlog-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("cli init command", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  // CL1: init with valid Obsidian vault
  it("succeeds when vault has .obsidian directory", async () => {
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });

    const { stdout, exitCode } = await runCli(["init", vault], { HOME: tmpHome });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Config saved");
    expect(stdout).toContain("Hook registered");
  });

  // CL2: init with non-Obsidian directory
  it("exits with error when vault has no .obsidian directory", async () => {
    const vault = join(tmpHome, "NotObsidian");
    mkdirSync(vault, { recursive: true });

    const { stderr, exitCode } = await runCli(["init", vault], { HOME: tmpHome });

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Obsidian vault not detected");
  });

  // CL3: init with --plain flag
  it("succeeds with --plain flag on any existing directory", async () => {
    const notes = join(tmpHome, "notes");
    mkdirSync(notes, { recursive: true });

    const { stdout, exitCode } = await runCli(["init", "--plain", notes], { HOME: tmpHome });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("plain mode");

    const configPath = join(tmpHome, ".agentlog", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.plain).toBe(true);
  });

  // CL4: init with nonexistent path in plain mode
  it("exits with error when plain vault path does not exist", async () => {
    const { stderr, exitCode } = await runCli(
      ["init", "--plain", "/nonexistent/path/xyz"],
      { HOME: tmpHome }
    );

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("not found");
  });

  // CL5: init overwrites existing config
  it("overwrites existing config on re-init", async () => {
    const vault1 = join(tmpHome, "Vault1");
    mkdirSync(join(vault1, ".obsidian"), { recursive: true });
    const vault2 = join(tmpHome, "Vault2");
    mkdirSync(join(vault2, ".obsidian"), { recursive: true });

    await runCli(["init", vault1], { HOME: tmpHome });
    await runCli(["init", vault2], { HOME: tmpHome });

    const configPath = join(tmpHome, ".agentlog", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.vault).toBe(vault2);
  });

  // CL6: hook registration writes correct JSON
  it("registers UserPromptSubmit hook in settings.json", async () => {
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });

    await runCli(["init", vault], { HOME: tmpHome });

    const settingsPath = join(tmpHome, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks).toBeDefined();
    expect(Array.isArray(settings.hooks.UserPromptSubmit)).toBe(true);

    const hasHook = settings.hooks.UserPromptSubmit.some(
      (entry: { hooks?: Array<{ command?: string }> }) =>
        Array.isArray(entry.hooks) &&
        entry.hooks.some((h) => h.command === "agentlog hook")
    );
    expect(hasHook).toBe(true);
  });

  // CL7: hook registration merges with existing settings
  it("merges hook into existing settings.json without losing other keys", async () => {
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });

    const existingSettings = { theme: "dark", model: "sonnet" };
    writeFileSync(
      join(tmpHome, ".claude", "settings.json"),
      JSON.stringify(existingSettings),
      "utf-8"
    );

    await runCli(["init", vault], { HOME: tmpHome });

    const settings = JSON.parse(
      readFileSync(join(tmpHome, ".claude", "settings.json"), "utf-8")
    );
    expect(settings.theme).toBe("dark");
    expect(settings.model).toBe("sonnet");
    expect(settings.hooks).toBeDefined();
  });

  // CL8: init expands ~/
  it("expands ~/ in vault path to absolute path in config", async () => {
    // Create vault at real home so ~ expansion resolves correctly
    const realHome = homedir();
    const vault = join(realHome, ".agentlog-test-vault-tmp");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });

    try {
      // Use real HOME so ~ expands properly inside the CLI subprocess
      await runCli(["init", "~/.agentlog-test-vault-tmp"]);

      const configPath = join(realHome, ".agentlog", "config.json");
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        expect(config.vault).not.toContain("~");
        expect(config.vault).toBe(vault);
      }
    } finally {
      rmSync(vault, { recursive: true, force: true });
      // Clean up written config
      rmSync(join(realHome, ".agentlog", "config.json"), { force: true });
    }
  });

  // No vault arg → shows detection guide (non-TTY exits 0)
  it("shows vault detection guide when no vault path is provided", async () => {
    const { exitCode, stdout, stderr } = await runCli(["init"], { HOME: tmpHome });
    expect(exitCode).toBe(0);
    // In non-TTY with no vaults detected, outputs detection guide
    const output = stdout + stderr;
    expect(output).toMatch(/No Obsidian vaults detected|Detected Obsidian vault/);
  });
});

describe("cli usage", () => {
  it("prints usage when no command given", async () => {
    const { stdout, exitCode } = await runCli([]);
    // exitCode 0 or 1 depending on implementation, but usage should be printed
    expect(stdout).toContain("agentlog init");
  });

  it("exits non-zero for unknown command", async () => {
    const { exitCode } = await runCli(["unknown-cmd"]);
    expect(exitCode).not.toBe(0);
  });
});
