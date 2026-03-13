import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const BUN_BIN = process.execPath;
const CLI_PATH = fileURLToPath(new URL("../cli.ts", import.meta.url));

async function runCli(
  args: string[],
  opts: { HOME?: string; AGENTLOG_CONFIG_DIR?: string; PATH?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = { ...process.env, ...opts };
  const proc = Bun.spawn(
    [BUN_BIN, "run", CLI_PATH, ...args],
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
  const dir = join(tmpdir(), `agentlog-codex-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, "fixtures", name), "utf-8");
}

function makeFakeCodexPath(home: string): string {
  const binDir = join(home, "bin");
  const codexBin = join(binDir, "codex");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(codexBin, "#!/bin/sh\nexit 0\n", "utf-8");
  chmodSync(codexBin, 0o755);
  return `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`;
}

function findPlainNotePath(vault: string): string {
  const file = readdirSync(vault).find((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name));
  if (!file) {
    throw new Error(`No plain note found in ${vault}`);
  }
  return join(vault, file);
}

describe("cli codex commands", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("init --codex creates a top-level notify when Codex config has none", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(join(tmpHome, ".codex", "config.toml"), fixture("codex-config-no-notify.toml"), "utf-8");

    const { stdout, stderr, exitCode } = await runCli(["init", "--codex", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Codex");
    expect(readFileSync(join(tmpHome, ".codex", "config.toml"), "utf-8")).toContain(
      'notify = ["agentlog", "codex-notify"]'
    );
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(false);
  });

  it("init --codex preserves an existing notify command for forward chaining", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(join(tmpHome, ".codex", "config.toml"), fixture("codex-config-existing-notify.toml"), "utf-8");

    const { exitCode } = await runCli(["init", "--codex", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(tmpHome, ".codex", "config.toml"), "utf-8")).toContain(
      'notify = ["agentlog", "codex-notify"]'
    );
    const config = JSON.parse(readFileSync(join(cfgDir, "config.json"), "utf-8"));
    expect(config.codexNotifyRestore).toEqual(["node", "/tmp/existing-notify.js"]);
  });

  it("init --codex aborts on unsupported multi-line notify arrays", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(join(tmpHome, ".codex", "config.toml"), fixture("codex-config-unsupported-notify.toml"), "utf-8");

    const { stderr, exitCode } = await runCli(["init", "--codex", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Unsupported notify");
  });

  it("init --codex fails when Codex CLI is not installed", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });

    const { stderr, exitCode } = await runCli(["init", "--codex", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: "/usr/bin:/bin",
    });

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Codex CLI not found");
    expect(existsSync(join(cfgDir, "config.json"))).toBe(false);
  });

  it("init --claude behaves like the current Claude-only installer", async () => {
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });

    const { stdout, exitCode } = await runCli(["init", "--claude", vault], {
      HOME: tmpHome,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Hook registered");
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(tmpHome, ".codex", "config.toml"))).toBe(false);
  });

  it("legacy codex-init command is rejected", async () => {
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });

    const { stdout, stderr, exitCode } = await runCli(["codex-init", vault], { HOME: tmpHome });

    expect(exitCode).not.toBe(0);
    expect(stdout + stderr).toContain("Usage:");
  });

  it("init --all installs both the Claude hook and Codex notify", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(join(tmpHome, ".codex", "config.toml"), fixture("codex-config-no-notify.toml"), "utf-8");

    const { stdout, stderr, exitCode } = await runCli(["init", "--all", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Hook registered");
    expect(stdout).toContain("Codex notify registered");
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(true);
    expect(readFileSync(join(tmpHome, ".codex", "config.toml"), "utf-8")).toContain(
      'notify = ["agentlog", "codex-notify"]'
    );
  });

  it("codex-notify writes a Daily Note entry and forwards the saved notify command", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const marker = join(tmpHome, "forwarded.txt");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexNotifyRestore: ["sh", "-lc", `printf forwarded > '${marker}'`],
      }),
      "utf-8"
    );

    const raw = fixture("codex-notify-single.json");
    const { exitCode } = await runCli(["codex-notify", raw], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(findPlainNotePath(vault), "utf-8")).toContain("Reply with exactly: OK");
    expect(existsSync(marker)).toBe(true);
  });

  it("codex-notify still writes the note when the forwarded notify command fails", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexNotifyRestore: ["sh", "-lc", "exit 42"],
      }),
      "utf-8"
    );

    const raw = fixture("codex-notify-single.json");
    const { exitCode } = await runCli(["codex-notify", raw], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(findPlainNotePath(vault), "utf-8")).toContain("Reply with exactly: OK");
  });

  it("codex-notify skips noise prompts but still forwards the saved notify command", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const marker = join(tmpHome, "forwarded-noise.txt");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexNotifyRestore: ["sh", "-lc", `printf forwarded > '${marker}'`],
      }),
      "utf-8"
    );

    const raw = JSON.stringify({
      type: "agent-turn-complete",
      "thread-id": "thread-noise-123",
      cwd: "/Users/pray/work/js/agentlog",
      "input-messages": ["<task-notification>"],
    });
    const { exitCode } = await runCli(["codex-notify", raw], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    expect(readdirSync(vault).some((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))).toBe(false);
    expect(existsSync(marker)).toBe(true);
  });

  it("legacy codex-uninstall command is rejected", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".codex", "config.toml"),
      'notify = ["agentlog", "codex-notify"]\nmodel = "gpt-5.4"\n',
      "utf-8"
    );
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexNotifyRestore: ["node", "/tmp/existing-notify.js"],
      }),
      "utf-8"
    );

    const { stdout, stderr, exitCode } = await runCli(["codex-uninstall", "-y"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).not.toBe(0);
    expect(stdout + stderr).toContain("Usage:");
  });

  it("uninstall --codex restores Codex notify and keeps Claude hook plus shared config", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
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
    writeFileSync(
      join(tmpHome, ".codex", "config.toml"),
      'notify = ["agentlog", "codex-notify"]\nmodel = "gpt-5.4"\n',
      "utf-8"
    );
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexNotifyRestore: ["node", "/tmp/existing-notify.js"],
      }),
      "utf-8"
    );

    const { exitCode } = await runCli(["uninstall", "--codex", "-y"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(tmpHome, ".codex", "config.toml"), "utf-8")).toContain(
      'notify = ["node", "/tmp/existing-notify.js"]'
    );
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(cfgDir, "config.json"))).toBe(true);
  });

  it("uninstall --all removes Claude state and restores the previous Codex notify command", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
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
    writeFileSync(
      join(tmpHome, ".codex", "config.toml"),
      'notify = ["agentlog", "codex-notify"]\nmodel = "gpt-5.4"\n',
      "utf-8"
    );
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexNotifyRestore: ["node", "/tmp/existing-notify.js"],
      }),
      "utf-8"
    );

    const { exitCode } = await runCli(["uninstall", "--all", "-y"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(tmpHome, ".codex", "config.toml"), "utf-8")).toContain(
      'notify = ["node", "/tmp/existing-notify.js"]'
    );
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(cfgDir, "config.json"))).toBe(false);
  });

  it("doctor succeeds when Codex notify is installed", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".codex", "config.toml"),
      'notify = ["agentlog", "codex-notify"]\nmodel = "gpt-5.4"\n',
      "utf-8"
    );
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexNotifyRestore: null,
      }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("codex");
    expect(stdout).toContain("notify");
  });

  it("doctor fails for partial damage when AgentLog config exists but Codex notify is missing", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(join(tmpHome, ".codex", "config.toml"), fixture("codex-config-no-notify.toml"), "utf-8");
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexNotifyRestore: ["node", "/tmp/existing-notify.js"],
      }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("not registered");
    expect(stdout).toContain("inconsistent");
  });

  it("doctor fails when Codex notify is not registered", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(join(tmpHome, ".codex", "config.toml"), fixture("codex-config-no-notify.toml"), "utf-8");
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
      }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("not registered");
    expect(stdout).not.toContain("inconsistent");
  });

  it("doctor reports unsupported top-level multiline notify config", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(join(tmpHome, ".codex", "config.toml"), fixture("codex-config-unsupported-notify.toml"), "utf-8");
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexNotifyRestore: ["node", "/tmp/existing-notify.js"],
      }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("unsupported");
    expect(stdout).not.toContain("stack trace");
  });
});
