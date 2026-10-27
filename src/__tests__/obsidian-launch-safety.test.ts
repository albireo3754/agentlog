import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { cliPreflightError, cliDailyPath, cliEnsureDailyNoteExists, isVersionAtLeast, parseCliVersion } from "../obsidian-cli.js";
import { detectCli } from "../detect.js";
import { appendEntry } from "../note-writer.js";
import { replayJournal } from "../event-journal.js";

it("does not mistake Electron startup logs for a CLI version", () => {
  expect(parseCliVersion("2026-10-27 14:51:15 App is up to date.\n")).toBeNull();
  expect(isVersionAtLeast("2026-10-27 14:51:15 App is up to date.", "1.12.4")).toBe(false);
  expect(parseCliVersion("Loading updated app package\n1.14.5 (installer 1.12.7)\n")).toBe("1.14.5");
});

describe.skipIf(process.platform !== "darwin")("macOS CLI launch safety", () => {
  let root: string;
  let bin: string;
  let calls: string;
  const prior = { bin: process.env.OBSIDIAN_BIN, path: process.env.PATH, config: process.env.AGENTLOG_CONFIG_DIR };

  function installer(version: string) {
    writeFileSync(join(root, "Obsidian.app/Contents/Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agentlog-launch-"));
    mkdirSync(join(root, "Obsidian.app/Contents/MacOS"), { recursive: true });
    mkdirSync(join(root, "bin"));
    bin = join(root, "Obsidian.app/Contents/MacOS/obsidian");
    calls = join(root, "called");
    // All test processes stay inside this fixture; never launch the real GUI.
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${calls}'\ncase "$1" in\nversion) echo '1.14.5';;\ndaily:path) echo 'Daily/2026-10-27-화.md';;\nesac\n`);
    chmodSync(bin, 0o755);
    writeFileSync(join(root, "bin/pgrep"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(root, "bin/pgrep"), 0o755);
    installer("1.8.9");
    process.env.OBSIDIAN_BIN = bin;
    process.env.PATH = `${join(root, "bin")}:${prior.path}`;
    process.env.AGENTLOG_CONFIG_DIR = join(root, "state");
  });

  afterEach(() => {
    for (const [key, value] of Object.entries({ OBSIDIAN_BIN: prior.bin, PATH: prior.path, AGENTLOG_CONFIG_DIR: prior.config })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("never executes an old app bundle, including through a symlink", () => {
    symlinkSync(bin, join(root, "bin/obsidian"));
    process.env.OBSIDIAN_BIN = join(root, "bin/obsidian");
    expect(cliDailyPath()).toBeNull();
    expect(cliEnsureDailyNoteExists()).toBe(false);
    expect(detectCli().version).toBeNull();
    expect(existsSync(calls)).toBe(false);
  });

  it("does not start a supported app that is closed", () => {
    installer("1.14.5");
    expect(cliDailyPath()).toBeNull();
    expect(cliEnsureDailyNoteExists()).toBe(false);
    expect(detectCli().version).toBeNull();
    expect(existsSync(calls)).toBe(false);
  });

  it("can query a supported app that is already running", () => {
    installer("1.14.5");
    writeFileSync(join(root, "bin/pgrep"), "#!/bin/sh\nexit 0\n");
    expect(cliPreflightError(bin)).toBeNull();
    expect(cliDailyPath()).toBe("Daily/2026-10-27-화.md");
    expect(readFileSync(calls, "utf8")).toBe("daily:path\n");
  });

  it("journals missing-note entries without launching the app, then replays them", () => {
    const vault = join(root, "vault");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    writeFileSync(join(vault, ".obsidian/daily-notes.json"), JSON.stringify({ folder: "Daily", format: "YYYY-MM-DD-ddd" }));
    expect(() => appendEntry({ vault, gitSync: true }, {
      time: "12:00", prompt: "preserved prompt", sessionId: "test", project: "test", cwd: root, source: "codex",
    }, new Date(2026, 9, 27, 12))).toThrow("Event saved to journal");
    expect(existsSync(calls)).toBe(false);
    mkdirSync(join(vault, "Daily"));
    const note = join(vault, "Daily/2026-10-27-화.md");
    writeFileSync(note, "# Template\n\nKeep handwritten content.\n");
    expect(replayJournal(vault).inserted).toBe(1);
    expect(readFileSync(note, "utf8")).toContain("preserved prompt");
    expect(readFileSync(note, "utf8")).toContain("Keep handwritten content.");
  });

  it("keeps logging to an existing note with an old installer without invoking it", () => {
    const vault = join(root, "vault");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(vault, "Daily"));
    writeFileSync(join(vault, ".obsidian/daily-notes.json"), JSON.stringify({ folder: "Daily", format: "YYYY-MM-DD-ddd" }));
    const note = join(vault, "Daily/2026-10-27-화.md");
    writeFileSync(note, "# My template\n");
    appendEntry({ vault, gitSync: true }, {
      time: "12:00", prompt: "normal logging", sessionId: "test", project: "test", cwd: root, source: "codex",
    }, new Date(2026, 9, 27, 12));
    expect(readFileSync(note, "utf8")).toContain("normal logging");
    expect(existsSync(calls)).toBe(false);
  });

  it("explicit open rejects old installers but may launch a supported one", async () => {
    const runOpen = () => Bun.spawn([process.execPath, new URL("../cli.ts", import.meta.url).pathname, "open"], {
      env: { ...process.env, HOME: root }, stdout: "pipe", stderr: "pipe",
    });
    const old = runOpen();
    expect(await old.exited).toBe(1);
    expect(await new Response(old.stderr).text()).toContain("installer 1.8.9");
    expect(existsSync(calls)).toBe(false);
    installer("1.14.5");
    const supported = runOpen();
    expect(await supported.exited).toBe(0);
    expect(readFileSync(calls, "utf8")).toBe("daily\n");
  });

  it("doctor reports an old installer without executing it", async () => {
    mkdirSync(join(root, "vault/.obsidian"), { recursive: true });
    mkdirSync(join(root, "state"));
    writeFileSync(join(root, "state/config.json"), JSON.stringify({ vault: join(root, "vault") }));
    const child = Bun.spawn([process.execPath, new URL("../cli.ts", import.meta.url).pathname, "doctor"], {
      env: { ...process.env, HOME: root }, stdout: "pipe", stderr: "pipe",
    });
    const stdout = await new Response(child.stdout).text();
    await child.exited;
    expect(stdout).toContain("installer 1.8.9");
    expect(stdout).not.toContain("✅ cli-app");
    expect(existsSync(calls)).toBe(false);
  });
});
