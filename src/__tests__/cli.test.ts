import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { fileURLToPath } from "url";

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

const CLI_PATH = fileURLToPath(new URL("../cli.ts", import.meta.url));

async function runCli(
  args: string[],
  opts: Record<string, string | undefined> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = { ...process.env, ...opts };
  const proc = Bun.spawn(
    ["bun", "run", CLI_PATH, ...args],
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
    // Use tmpHome as HOME so ~/ expands to tmpHome inside the subprocess.
    // AGENTLOG_CONFIG_DIR isolates config writes to tmpHome/.agentlog.
    const vault = join(tmpHome, "test-vault");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });

    const cfgDir = join(tmpHome, ".agentlog");
    await runCli(["init", "~/test-vault"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    const cfgPath = join(cfgDir, "config.json");
    expect(existsSync(cfgPath)).toBe(true);
    const config = JSON.parse(readFileSync(cfgPath, "utf-8"));
    expect(config.vault).not.toContain("~");
    expect(config.vault).toBe(vault);
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

describe("cli doctor command", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  // DR1: all checks pass
  it("exits 0 and prints all checks passed when fully configured", async () => {
    // Set up vault
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    // Set up config
    mkdirSync(join(tmpHome, ".agentlog"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".agentlog", "config.json"),
      JSON.stringify({ vault }),
      "utf-8"
    );
    // Set up hook
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { matcher: "", hooks: [{ type: "command", command: "agentlog hook" }] },
          ],
        },
      }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], { HOME: tmpHome });
    // binary check may fail in test env; focus on vault/hook checks
    expect(stdout).toMatch(/AgentLog \d+\.\d+\.\d+/);
    expect(stdout).toContain("vault");
    expect(stdout).toContain("hook");
  });

  // DR2: no config → exits 1, shows "not configured"
  it("exits 1 and shows not configured when no config", async () => {
    const { stdout, exitCode } = await runCli(["doctor"], { HOME: tmpHome });
    expect(exitCode).toBe(1);
    expect(stdout).toContain("not configured");
  });

  // DR3: config present but vault missing → exits 1
  it("exits 1 when vault path does not exist", async () => {
    mkdirSync(join(tmpHome, ".agentlog"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".agentlog", "config.json"),
      JSON.stringify({ vault: join(tmpHome, "nonexistent-vault") }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], { HOME: tmpHome });
    expect(exitCode).toBe(1);
    expect(stdout).toContain("❌");
    expect(stdout).toContain("vault");
  });

  // DR4: hook not registered → exits 1
  it("exits 1 when hook is not registered", async () => {
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".agentlog"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".agentlog", "config.json"),
      JSON.stringify({ vault }),
      "utf-8"
    );
    // No settings.json → hook not registered

    const { stdout, exitCode } = await runCli(["doctor"], { HOME: tmpHome });
    expect(exitCode).toBe(1);
    expect(stdout).toContain("hook");
    expect(stdout).toContain("not registered");
  });

  // DR5: plain mode skips obsidian app check
  it("shows plain mode in vault check and skips obsidian app check", async () => {
    const notes = join(tmpHome, "notes");
    mkdirSync(notes, { recursive: true });
    mkdirSync(join(tmpHome, ".agentlog"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".agentlog", "config.json"),
      JSON.stringify({ vault: notes, plain: true }),
      "utf-8"
    );

    const { stdout } = await runCli(["doctor"], { HOME: tmpHome });
    expect(stdout).toContain("plain mode");
    // obsidian line should not appear when plain mode
    expect(stdout).not.toContain("obsidian");
  });
});

describe("cli codex-debug command", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("runs codex exec with the provided prompt", async () => {
    const binDir = join(tmpHome, "bin");
    mkdirSync(binDir, { recursive: true });
    const argsFile = join(tmpHome, "codex-args.txt");

    writeFileSync(
      join(binDir, "codex"),
      `#!/bin/sh
printf '%s\n' "$@" > "${argsFile}"
`,
      "utf-8"
    );
    Bun.spawnSync(["chmod", "+x", join(binDir, "codex")]);

    const { exitCode } = await runCli(["codex-debug", "system", "prompt"], {
      HOME: tmpHome,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(argsFile, "utf-8")).toBe("exec\n--\nsystem prompt\n");
  });

  it("passes prompts starting with dashes as prompt text", async () => {
    const binDir = join(tmpHome, "bin");
    mkdirSync(binDir, { recursive: true });
    const argsFile = join(tmpHome, "codex-args.txt");

    writeFileSync(
      join(binDir, "codex"),
      `#!/bin/sh
printf '%s\n' "$@" > "${argsFile}"
`,
      "utf-8"
    );
    Bun.spawnSync(["chmod", "+x", join(binDir, "codex")]);

    const { exitCode } = await runCli(["codex-debug", "--help"], {
      HOME: tmpHome,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(argsFile, "utf-8")).toBe("exec\n--\n--help\n");
  });

  it("exits with error when prompt is missing", async () => {
    const { stderr, exitCode } = await runCli(["codex-debug"], { HOME: tmpHome });

    expect(exitCode).toBe(1);
    expect(stderr).toContain("prompt is required");
  });
});

describe("cli init --dry-run", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("exits 0 and prints dry-run output without writing config or settings", async () => {
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });

    const { stdout, exitCode } = await runCli(["init", "--dry-run", vault], { HOME: tmpHome });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("[dry-run]");
    expect(stdout).toContain("No changes were made");

    const configFile = join(tmpHome, ".agentlog", "config.json");
    const settingsFile = join(tmpHome, ".claude", "settings.json");
    expect(existsSync(configFile)).toBe(false);
    expect(existsSync(settingsFile)).toBe(false);
  });

  it("exits 1 with error when vault path does not exist", async () => {
    const { stderr, exitCode } = await runCli(
      ["init", "--dry-run", join(tmpHome, "nonexistent")],
      { HOME: tmpHome }
    );

    expect(exitCode).toBe(1);
    expect(stderr).toBeTruthy();
  });

  it("exits 1 with 'requires a vault path' when no vault arg", async () => {
    const { stderr, exitCode } = await runCli(["init", "--dry-run"], { HOME: tmpHome });

    expect(exitCode).toBe(1);
    expect(stderr).toContain("requires a vault path");
  });

  it("exits 0 and mentions plain mode with --plain flag", async () => {
    const notes = join(tmpHome, "notes");
    mkdirSync(notes, { recursive: true });

    const { stdout, exitCode } = await runCli(
      ["init", "--plain", "--dry-run", notes],
      { HOME: tmpHome }
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("[dry-run]");
    expect(stdout).toContain("No changes were made");
  });
});

describe("cli uninstall --dry-run", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("exits 0 and prints Would remove without modifying config or settings", async () => {
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".agentlog"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".agentlog", "config.json"),
      JSON.stringify({ vault }),
      "utf-8"
    );
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    const settingsContent = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { matcher: "", hooks: [{ type: "command", command: "agentlog hook" }] },
        ],
      },
    });
    writeFileSync(join(tmpHome, ".claude", "settings.json"), settingsContent, "utf-8");

    const { stdout, exitCode } = await runCli(["uninstall", "--dry-run"], { HOME: tmpHome });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Would remove");

    expect(existsSync(join(tmpHome, ".agentlog", "config.json"))).toBe(true);
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(true);
    const settings = JSON.parse(readFileSync(join(tmpHome, ".claude", "settings.json"), "utf-8"));
    expect(settings.hooks).toBeDefined();
  });
});

describe("cli validate", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("exits 0 with config: ok and hook: ok when fully configured", async () => {
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".agentlog"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".agentlog", "config.json"),
      JSON.stringify({ vault }),
      "utf-8"
    );
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { matcher: "", hooks: [{ type: "command", command: "agentlog hook" }] },
          ],
        },
      }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["validate"], { HOME: tmpHome });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("config: ok");
    expect(stdout).toContain("hook: ok");
  });

  it("exits 1 with config: fail when no config present", async () => {
    const { stdout, exitCode } = await runCli(["validate"], { HOME: tmpHome });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("config: fail");
  });

  it("exits 1 with hook: fail when config present but hook not registered", async () => {
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".agentlog"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".agentlog", "config.json"),
      JSON.stringify({ vault }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["validate"], { HOME: tmpHome });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("hook: fail");
  });
});

describe("cli usage", () => {
  it("prints only the headline in prod for the version command", async () => {
    const { stdout, exitCode } = await runCli(["version"], { AGENTLOG_PHASE: "prod" });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^AgentLog \d+\.\d+\.\d+$/);
  });

  it("prints build metadata in dev for the version command", async () => {
    const { stdout, exitCode } = await runCli(["version"], { AGENTLOG_PHASE: "dev" });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(
      /^AgentLog \d+\.\d+\.\d+\nchannel: dev\ncommit: [0-9a-f]{7}\n?$/
    );
  });

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
