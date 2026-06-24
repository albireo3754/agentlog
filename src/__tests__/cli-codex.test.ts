import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const BUN_BIN = process.execPath;
const CLI_PATH = fileURLToPath(new URL("../cli.ts", import.meta.url));

async function runCli(
  args: string[],
  opts: { HOME?: string; AGENTLOG_CONFIG_DIR?: string; PATH?: string; AGENTLOG_ENGLISHASK_EVAL?: string; HERMES_HOME?: string } = {}
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
  mkdirSync(binDir, { recursive: true });
  for (const binName of ["codex", "agentlog"]) {
    const bin = join(binDir, binName);
    writeFileSync(bin, "#!/bin/sh\nexit 0\n", "utf-8");
    chmodSync(bin, 0o755);
  }
  return `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`;
}

function makeFakeEnglishAskEvaluator(home: string): { command: string[]; inputPath: string } {
  const script = join(home, "englishask-eval.sh");
  const inputPath = join(home, "englishask-input.txt");
  writeFileSync(
    script,
    `#!/bin/sh
test "$AGENTLOG_ENGLISHASK_EVAL" = "1" || exit 7
cat > "$1"
printf 'Score: 3/5\\nNatural version: Reply with exactly OK.\\nMissing context: none\\nRewrite with: exact expected output\\n'
`,
    "utf-8"
  );
  chmodSync(script, 0o755);
  return { command: [script, inputPath], inputPath };
}

function makeReadonlyNoteEnglishAskEvaluator(home: string, vault: string): { command: string[]; inputPath: string } {
  const script = join(home, "englishask-readonly-note.sh");
  const inputPath = join(home, "englishask-readonly-input.txt");
  writeFileSync(
    script,
    `#!/bin/sh
test "$AGENTLOG_ENGLISHASK_EVAL" = "1" || exit 7
cat > "$1"
chmod 444 "$2"/*.md || exit 8
printf '%s\\n' 'Score: 3/5' 'Natural version: Reply with exactly OK.' 'Missing context: none' 'Rewrite with: exact expected output'
`,
    "utf-8"
  );
  chmodSync(script, 0o755);
  return { command: [script, inputPath, vault], inputPath };
}

function findPlainNotePath(vault: string): string {
  const file = readdirSync(vault).find((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name));
  if (!file) {
    throw new Error(`No plain note found in ${vault}`);
  }
  return join(vault, file);
}

function readCodexHooks(home: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf-8"));
}

function writeAgentlogCodexHook(home: string): void {
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(
    join(home, ".codex", "hooks.json"),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "agentlog hook --source codex" }] },
        ],
      },
    }),
    "utf-8"
  );
}

describe("cli codex commands", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("init --codex creates a UserPromptSubmit hook in Codex hooks.json", async () => {
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
    expect(stdout).toContain("Codex hook registered");
    expect(readCodexHooks(tmpHome)).toEqual({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "agentlog hook --source codex" }] },
        ],
      },
    });
    expect(readFileSync(join(tmpHome, ".codex", "config.toml"), "utf-8")).not.toContain("agentlog\", \"codex-notify");
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(false);
    const config = JSON.parse(readFileSync(join(cfgDir, "config.json"), "utf-8"));
    expect(config.codexHookInstalled).toBe(true);
    expect(config.claudeHookInstalled).toBeUndefined();
  });

  it("init --codex preserves existing Codex hooks and records hook metadata", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo prompt" }] }],
        },
      }),
      "utf-8"
    );

    const { exitCode } = await runCli(["init", "--codex", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).toBe(0);
    const hooks = readCodexHooks(tmpHome) as { hooks: { Stop: unknown[]; UserPromptSubmit: unknown[] } };
    expect(hooks.hooks.Stop).toHaveLength(1);
    expect(hooks.hooks.UserPromptSubmit).toHaveLength(2);
    const config = JSON.parse(readFileSync(join(cfgDir, "config.json"), "utf-8"));
    expect(config.codexHookInstalled).toBe(true);
    expect(config.claudeHookInstalled).toBeUndefined();
  });

  it("init --codex migrates a legacy Codex UserPromptSubmit AgentLog hook", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "agentlog hook" }] },
            { hooks: [{ type: "command", command: "node /opt/omx/codex-native-hook.js" }] },
          ],
        },
        state: {
          "/tmp/hooks.json:user_prompt_submit:0:0": { trusted_hash: "sha256:old-user-prompt-submit" },
          "/tmp/hooks.json:stop:0:0": { trusted_hash: "sha256:stop" },
        },
      }),
      "utf-8"
    );

    const { exitCode } = await runCli(["init", "--codex", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).toBe(0);
    expect(readCodexHooks(tmpHome)).toEqual({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "node /opt/omx/codex-native-hook.js" }] },
          { hooks: [{ type: "command", command: "agentlog hook --source codex" }] },
        ],
      },
      state: {
        "/tmp/hooks.json:stop:0:0": { trusted_hash: "sha256:stop" },
      },
    });
  });

  it("init --codex aborts on unsupported hooks.json", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(join(tmpHome, ".codex", "hooks.json"), "{bad", "utf-8");

    const { stdout, stderr, exitCode } = await runCli(["init", "--codex", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).not.toBe(0);
    expect(stdout + stderr).toContain("hooks.json is invalid JSON");
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
    expect(existsSync(join(tmpHome, ".codex", "hooks.json"))).toBe(false);
    const config = JSON.parse(readFileSync(join(tmpHome, ".agentlog", "config.json"), "utf-8"));
    expect(config.claudeHookInstalled).toBe(true);
  });

  it("legacy codex-init command is rejected", async () => {
    const vault = join(tmpHome, "Obsidian");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });

    const { stdout, stderr, exitCode } = await runCli(["codex-init", vault], { HOME: tmpHome });

    expect(exitCode).not.toBe(0);
    expect(stdout + stderr).toContain("Usage:");
  });

  it("init --all installs both the Claude hook and Codex hook", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });

    const { stdout, stderr, exitCode } = await runCli(["init", "--all", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Hook registered");
    expect(stdout).toContain("Codex hook registered");
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(true);
    expect(readCodexHooks(tmpHome)).toEqual({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "agentlog hook --source codex" }] },
        ],
      },
    });
    const config = JSON.parse(readFileSync(join(cfgDir, "config.json"), "utf-8"));
    expect(config.codexHookInstalled).toBe(true);
    expect(config.claudeHookInstalled).toBe(true);
    expect(config.hermesHookInstalled).toBeUndefined();
  });

  it("init --hermes writes the default Hermes config and records metadata", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(tmpHome, ".hermes"), { recursive: true });
    writeFileSync(join(tmpHome, ".hermes", "config.yaml"), "display:\n  theme: dark\nhooks: {}\n", "utf-8");

    const { stdout, stderr, exitCode } = await runCli(["init", "--hermes", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Hermes hook registered");
    expect(stdout).toContain("agentlog hook --source hermes");
    const config = JSON.parse(readFileSync(join(cfgDir, "config.json"), "utf-8"));
    expect(config.hermesHookInstalled).toBe(true);
    expect(config.hermesProfiles).toEqual(["default"]);
    const hermesConfig = readFileSync(join(tmpHome, ".hermes", "config.yaml"), "utf-8");
    expect(hermesConfig).toContain("theme: dark");
    expect(hermesConfig).toContain("pre_llm_call");
    expect(hermesConfig).toContain("agentlog hook --source hermes");
  });

  it("init --hermes supports multiple named profiles", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    for (const profile of ["alpha", "beta"]) {
      mkdirSync(join(tmpHome, ".hermes", "profiles", profile), { recursive: true });
      writeFileSync(join(tmpHome, ".hermes", "profiles", profile, "config.yaml"), "hooks: {}\n", "utf-8");
    }

    const { stdout, stderr, exitCode } = await runCli(
      ["init", "--hermes", "--hermes-profile", "alpha", "--hermes-profile", "beta", vault],
      {
        HOME: tmpHome,
        AGENTLOG_CONFIG_DIR: cfgDir,
      }
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Hermes hook registered");
    for (const profile of ["alpha", "beta"]) {
      expect(readFileSync(join(tmpHome, ".hermes", "profiles", profile, "config.yaml"), "utf-8")).toContain(
        "agentlog hook --source hermes"
      );
    }
    expect(existsSync(join(tmpHome, ".hermes", "config.yaml"))).toBe(false);
    const config = JSON.parse(readFileSync(join(cfgDir, "config.json"), "utf-8"));
    expect(config.hermesProfiles).toEqual(["alpha", "beta"]);
  });

  it("init --hermes --hermes-all-profiles writes default and every existing profile config", async () => {
    const vault = join(tmpHome, "Obsidian");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    for (const profile of ["alpha", "beta"]) {
      mkdirSync(join(tmpHome, ".hermes", "profiles", profile), { recursive: true });
      writeFileSync(join(tmpHome, ".hermes", "profiles", profile, "config.yaml"), "hooks: {}\n", "utf-8");
    }

    const { exitCode } = await runCli(["init", "--hermes", "--hermes-all-profiles", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    for (const path of [
      join(tmpHome, ".hermes", "config.yaml"),
      join(tmpHome, ".hermes", "profiles", "alpha", "config.yaml"),
      join(tmpHome, ".hermes", "profiles", "beta", "config.yaml"),
    ]) {
      expect(readFileSync(path, "utf-8")).toContain("agentlog hook --source hermes");
    }
    const config = JSON.parse(readFileSync(join(cfgDir, "config.json"), "utf-8"));
    expect(config.hermesProfiles).toEqual(["default", "alpha", "beta"]);
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

  it("codex-notify appends EnglishAsk feedback when enabled", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const evaluator = makeFakeEnglishAskEvaluator(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        englishAsk: {
          enabled: true,
          mode: "log-only",
          evaluatorCommand: evaluator.command,
        },
      }),
      "utf-8"
    );

    const raw = fixture("codex-notify-single.json");
    const { exitCode, stderr } = await runCli(["codex-notify", raw], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    const content = readFileSync(findPlainNotePath(vault), "utf-8");
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(content).toContain("Reply with exactly: OK");
    expect(content).toContain("## EnglishAsk");
    expect(content).toContain("- score: 3/5");
    expect(readFileSync(evaluator.inputPath, "utf-8")).toContain("User prompt:\nReply with exactly: OK");
    expect(readFileSync(evaluator.inputPath, "utf-8")).toContain("assistant: OK");
  });

  it("codex-notify evaluates the raw prompt to EnglishAsk while logging a pretty prompt", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const evaluator = makeFakeEnglishAskEvaluator(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        englishAsk: {
          enabled: true,
          mode: "log-only",
          evaluatorCommand: evaluator.command,
        },
      }),
      "utf-8"
    );

    const raw = JSON.stringify({
      type: "agent-turn-complete",
      "thread-id": "thread-raw-prompt",
      cwd: "/Users/pray/Obsidian",
      "input-messages": ["Line one\nLine two\nLine three"],
    });
    const { exitCode, stderr } = await runCli(["codex-notify", raw], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    const content = readFileSync(findPlainNotePath(vault), "utf-8");
    const evaluatorInput = readFileSync(evaluator.inputPath, "utf-8");
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(content).toContain("Line one (+1 lines) Line three");
    expect(evaluatorInput).toContain("User prompt:\nLine one\nLine two\nLine three");
  });

  it("codex-notify skips guarded evaluator child turns without forwarding", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const marker = join(tmpHome, "forwarded-guarded.txt");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexNotifyRestore: ["sh", "-lc", `printf forwarded > '${marker}'`],
        englishAsk: {
          enabled: true,
        },
      }),
      "utf-8"
    );

    const raw = fixture("codex-notify-single.json");
    const { exitCode, stderr } = await runCli(["codex-notify", raw], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      AGENTLOG_ENGLISHASK_EVAL: "1",
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(readdirSync(vault).some((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it("codex-notify exits immediately for guarded child turns without a notify argument", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        englishAsk: {
          enabled: true,
        },
      }),
      "utf-8"
    );

    const { exitCode, stderr } = await runCli(["codex-notify"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      AGENTLOG_ENGLISHASK_EVAL: "1",
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(readdirSync(vault).some((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))).toBe(false);
  });

  it("codex-notify still writes the note when EnglishAsk evaluator fails", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        englishAsk: {
          enabled: true,
          evaluatorCommand: ["sh", "-lc", "exit 42"],
        },
      }),
      "utf-8"
    );

    const raw = fixture("codex-notify-single.json");
    const { exitCode } = await runCli(["codex-notify", raw], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    const content = readFileSync(findPlainNotePath(vault), "utf-8");
    expect(exitCode).toBe(0);
    expect(content).toContain("Reply with exactly: OK");
    expect(content).not.toContain("## EnglishAsk");
  });

  it("codex-notify keeps EnglishAsk append failures silent", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const evaluator = makeReadonlyNoteEnglishAskEvaluator(tmpHome, vault);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        englishAsk: {
          enabled: true,
          evaluatorCommand: evaluator.command,
        },
      }),
      "utf-8"
    );

    const raw = fixture("codex-notify-single.json");
    const { exitCode, stderr } = await runCli(["codex-notify", raw], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    const content = readFileSync(findPlainNotePath(vault), "utf-8");
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(content).toContain("Reply with exactly: OK");
    expect(content).not.toContain("## EnglishAsk");
  });

  it("agentlog hook --source codex writes a Codex-sourced Daily Note entry", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, codexHookInstalled: true }),
      "utf-8"
    );

    const raw = fixture("codex-hook-user-prompt-submit.json");
    const proc = Bun.spawn([BUN_BIN, "run", CLI_PATH, "hook", "--source", "codex"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: tmpHome, AGENTLOG_CONFIG_DIR: cfgDir },
    });
    proc.stdin.write(raw);
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(readFileSync(findPlainNotePath(vault), "utf-8")).toContain("Reply with exactly: OK");
  });

  it("agentlog hook --source codex appends EnglishAsk feedback when enabled", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const evaluator = makeFakeEnglishAskEvaluator(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexHookInstalled: true,
        englishAsk: {
          enabled: true,
          mode: "log-only",
          evaluatorCommand: evaluator.command,
        },
      }),
      "utf-8"
    );

    const raw = fixture("codex-hook-user-prompt-submit.json");
    const proc = Bun.spawn([BUN_BIN, "run", CLI_PATH, "hook", "--source", "codex"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: tmpHome, AGENTLOG_CONFIG_DIR: cfgDir },
    });
    proc.stdin.write(raw);
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const content = readFileSync(findPlainNotePath(vault), "utf-8");
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(content).toContain("Reply with exactly: OK");
    expect(content).toContain("## EnglishAsk");
    expect(content).toContain("- session: [[codex_019cb123-ac48-7d22-b5bf-195ee34699af]]");
    expect(content).toContain("- score: 3/5");
    expect(readFileSync(evaluator.inputPath, "utf-8")).toContain("User prompt:\nReply with exactly: OK");
  });

  it("agentlog hook --source hermes writes a Hermes-sourced Daily Note entry", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, hermesHookInstalled: true }),
      "utf-8"
    );

    const raw = fixture("hermes-pre-llm-call.json");
    const proc = Bun.spawn([BUN_BIN, "run", CLI_PATH, "hook", "--source", "hermes"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: tmpHome, AGENTLOG_CONFIG_DIR: cfgDir },
    });
    proc.stdin.write(raw);
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    const content = readFileSync(findPlainNotePath(vault), "utf-8");
    expect(content).toContain("Hermes prompt capture");
  });

  it("agentlog hook skips guarded EnglishAsk evaluator child turns", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexHookInstalled: true,
        englishAsk: {
          enabled: true,
        },
      }),
      "utf-8"
    );

    const raw = fixture("codex-hook-user-prompt-submit.json");
    const proc = Bun.spawn([BUN_BIN, "run", CLI_PATH, "hook", "--source", "codex"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: tmpHome,
        AGENTLOG_CONFIG_DIR: cfgDir,
        AGENTLOG_ENGLISHASK_EVAL: "1",
      },
    });
    proc.stdin.write(raw);
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(readdirSync(vault).some((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))).toBe(false);
  });

  it("agentlog hook with unknown explicit source does not fall back to Claude", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, "config.json"), JSON.stringify({ vault, plain: true }), "utf-8");

    const proc = Bun.spawn([BUN_BIN, "run", CLI_PATH, "hook", "--source", "bad"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: tmpHome, AGENTLOG_CONFIG_DIR: cfgDir },
    });
    proc.stdin.write(fixture("codex-hook-user-prompt-submit.json"));
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unsupported source: bad");
    expect(() => findPlainNotePath(vault)).toThrow();
  });

  it("legacy codex-uninstall command is rejected", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeAgentlogCodexHook(tmpHome);
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, codexHookInstalled: true }),
      "utf-8"
    );

    const { stdout, stderr, exitCode } = await runCli(["codex-uninstall", "-y"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).not.toBe(0);
    expect(stdout + stderr).toContain("Usage:");
  });

  it("uninstall --codex removes Codex hook and keeps Claude hook plus shared config", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const marker = join(tmpHome, "forwarded-restored.txt");
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
    writeAgentlogCodexHook(tmpHome);
    writeFileSync(join(tmpHome, ".codex", "config.toml"), 'notify = ["agentlog", "codex-notify"]\n', "utf-8");
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexHookInstalled: true,
        codexNotifyRestore: ["sh", "-lc", `printf restored > '${marker}'`],
      }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["uninstall", "--codex", "-y"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Legacy Codex notify restored: ${join(tmpHome, ".codex", "config.toml")}`);
    expect(existsSync(join(tmpHome, ".codex", "hooks.json"))).toBe(false);
    expect(readFileSync(join(tmpHome, ".codex", "config.toml"), "utf-8")).toContain(
      `notify = ["sh", "-lc", "printf restored > '${marker}'"]`
    );
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(cfgDir, "config.json"))).toBe(true);
    const config = JSON.parse(readFileSync(join(cfgDir, "config.json"), "utf-8"));
    expect(config.codexHookInstalled).toBeUndefined();
  });

  it("uninstall --codex reports when it removes legacy notify without a saved restore command", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeAgentlogCodexHook(tmpHome);
    writeFileSync(join(tmpHome, ".codex", "config.toml"), 'notify = ["agentlog", "codex-notify"]\n', "utf-8");
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, codexHookInstalled: true }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["uninstall", "--codex", "-y"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Legacy Codex notify removed: ${join(tmpHome, ".codex", "config.toml")}`);
    expect(readFileSync(join(tmpHome, ".codex", "config.toml"), "utf-8")).not.toContain("agentlog");
  });

  it("uninstall --codex exits cleanly when hooks.json is invalid", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(join(tmpHome, ".codex", "hooks.json"), "{bad", "utf-8");
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, codexHookInstalled: true }),
      "utf-8"
    );

    const { stdout, stderr, exitCode } = await runCli(["uninstall", "--codex", "-y"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("Unsupported Codex hooks configuration: hooks.json is invalid JSON\n");
  });

  it("uninstall --all removes Claude state and Codex hook", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
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
    writeAgentlogCodexHook(tmpHome);
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, codexHookInstalled: true }),
      "utf-8"
    );

    const { exitCode } = await runCli(["uninstall", "--all", "-y"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(tmpHome, ".codex", "hooks.json"))).toBe(false);
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(cfgDir, "config.json"))).toBe(false);
  });

  it("uninstall --hermes removes AgentLog hook from configured Hermes profiles", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    for (const profile of ["alpha", "beta"]) {
      mkdirSync(join(tmpHome, ".hermes", "profiles", profile), { recursive: true });
      writeFileSync(
        join(tmpHome, ".hermes", "profiles", profile, "config.yaml"),
        'hooks:\n  pre_llm_call:\n    - command: echo keep\n    - command: agentlog hook --source hermes\n',
        "utf-8"
      );
    }
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, hermesHookInstalled: true, hermesProfiles: ["alpha", "beta"] }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["uninstall", "--hermes", "-y"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Hermes hook removed");
    for (const profile of ["alpha", "beta"]) {
      const content = readFileSync(join(tmpHome, ".hermes", "profiles", profile, "config.yaml"), "utf-8");
      expect(content).toContain("command: echo keep");
      expect(content).not.toContain("agentlog hook --source hermes");
    }
    const config = JSON.parse(readFileSync(join(cfgDir, "config.json"), "utf-8"));
    expect(config.hermesHookInstalled).toBeUndefined();
    expect(config.hermesProfiles).toBeUndefined();
  });

  it("default uninstall warns when Codex hooks need migration", async () => {
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
      join(tmpHome, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "agentlog hook" }] },
            { hooks: [{ type: "command", command: "agentlog hook --source codex" }] },
          ],
        },
      }),
      "utf-8"
    );
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, claudeHookInstalled: true }),
      "utf-8"
    );

    const { stderr, exitCode } = await runCli(["uninstall", "-y"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
    });

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Codex hook is still registered");
    expect(existsSync(join(tmpHome, ".codex", "hooks.json"))).toBe(true);
  });

  it("doctor succeeds when Codex hook is installed", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeAgentlogCodexHook(tmpHome);
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, codexHookInstalled: true }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("codex");
    expect(stdout).toContain("hook registered");
  });

  it("doctor fails when config expects both hooks but the Claude hook is missing", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeAgentlogCodexHook(tmpHome);
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        vault,
        plain: true,
        codexHookInstalled: true,
        claudeHookInstalled: true,
      }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("❌ hook");
    expect(stdout).toContain("not registered");
  });

  it("doctor fails for partial damage when AgentLog config expects Codex hook but it is missing", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, codexHookInstalled: true }),
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

  it("doctor ignores Codex checks when no Codex integration is configured", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("hook       not registered");
    expect(stdout).not.toContain("codex-bin");
  });

  it("doctor reports unsupported Codex hooks.json", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(join(tmpHome, ".codex", "hooks.json"), "{bad", "utf-8");
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, codexHookInstalled: true }),
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

  it("doctor reports legacy Codex hook entries as needing migration", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithCodex = makeFakeCodexPath(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "agentlog hook" }] },
            { hooks: [{ type: "command", command: "agentlog hook --source codex" }] },
          ],
        },
      }),
      "utf-8"
    );
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, codexHookInstalled: true }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      PATH: pathWithCodex,
    });

    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("legacy AgentLog Codex hook remains");
    expect(stdout).toContain("agentlog init --codex");
  });

  it("doctor fails when Hermes metadata expects an installed hook but it is missing", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, hermesHookInstalled: true }),
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      HERMES_HOME: join(tmpHome, ".hermes"),
    });

    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("❌ hermes");
    expect(stdout).toContain("hook command not detected");
  });

  it("doctor passes Hermes when config.yaml contains the manual hook command", async () => {
    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const pathWithAgentlog = makeFakeCodexPath(tmpHome);
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(join(tmpHome, ".hermes"), { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ vault, plain: true, hermesHookInstalled: true }),
      "utf-8"
    );
    writeFileSync(
      join(tmpHome, ".hermes", "config.yaml"),
      'hooks:\n  pre_llm_call:\n    - command: "agentlog hook --source hermes"\n',
      "utf-8"
    );

    const { stdout, exitCode } = await runCli(["doctor"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      HERMES_HOME: join(tmpHome, ".hermes"),
      PATH: pathWithAgentlog,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✅ hermes");
    expect(stdout).toContain("hook command present");
  });

  it("runs a real Hermes-profile smoke through init, Hermes hooks list, hook fixture, doctor, and uninstall", async () => {
    const hermesBin = Bun.which("hermes");
    if (!hermesBin) return;

    const vault = join(tmpHome, "notes");
    const cfgDir = join(tmpHome, ".agentlog");
    const profileHome = join(tmpHome, ".hermes", "profiles", "smoke");
    mkdirSync(vault, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });
    mkdirSync(profileHome, { recursive: true });
    writeFileSync(join(profileHome, "config.yaml"), "hooks: {}\n", "utf-8");

    const init = await runCli(["init", "--plain", "--hermes", "--hermes-profile", "smoke", vault], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      HERMES_HOME: profileHome,
    });
    expect(init.exitCode).toBe(0);

    const list = Bun.spawnSync([hermesBin, "-p", "smoke", "hooks", "list"], {
      env: { ...process.env, HOME: tmpHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const listOutput = `${list.stdout.toString()}${list.stderr.toString()}`;
    expect(list.exitCode).toBe(0);
    expect(listOutput).toContain("agentlog hook --source hermes");

    const proc = Bun.spawn([BUN_BIN, "run", CLI_PATH, "hook", "--source", "hermes"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: tmpHome, AGENTLOG_CONFIG_DIR: cfgDir },
    });
    proc.stdin.write(fixture("hermes-pre-llm-call.json"));
    proc.stdin.end();
    expect(await proc.exited).toBe(0);
    expect(readFileSync(findPlainNotePath(vault), "utf-8")).toContain("Hermes prompt capture");

    const doctor = await runCli(["doctor"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      HERMES_HOME: profileHome,
    });
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain("✅ hermes");

    const uninstall = await runCli(["uninstall", "--hermes", "-y"], {
      HOME: tmpHome,
      AGENTLOG_CONFIG_DIR: cfgDir,
      HERMES_HOME: profileHome,
    });
    expect(uninstall.exitCode).toBe(0);
    expect(readFileSync(join(profileHome, "config.yaml"), "utf-8")).not.toContain("agentlog hook --source hermes");
  });
});
