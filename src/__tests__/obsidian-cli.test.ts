import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import {
  CLI_PROBE_TIMEOUT_MS,
  DAILY_BOOTSTRAP_TIMEOUT_MS,
  isVersionAtLeast,
  isCliDisabledOutput,
  MIN_CLI_VERSION,
  resolveCliBin,
  cliDailyPath,
  cliEnsureDailyNoteExists,
} from "../obsidian-cli.js";
import { writeFileSync, readFileSync, mkdirSync, chmodSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("isVersionAtLeast", () => {
  it("returns true when versions are equal", () => {
    expect(isVersionAtLeast("1.12.4", "1.12.4")).toBe(true);
  });

  it("returns true when version is greater (patch)", () => {
    expect(isVersionAtLeast("1.12.5", "1.12.4")).toBe(true);
  });

  it("returns true when version is greater (minor)", () => {
    expect(isVersionAtLeast("1.13.0", "1.12.4")).toBe(true);
  });

  it("returns true when version is greater (major)", () => {
    expect(isVersionAtLeast("2.0.0", "1.12.4")).toBe(true);
  });

  it("returns false when version is less (patch)", () => {
    expect(isVersionAtLeast("1.12.3", "1.12.4")).toBe(false);
  });

  it("returns false when version is less (minor)", () => {
    expect(isVersionAtLeast("1.11.9", "1.12.4")).toBe(false);
  });

  it("returns false when version is less (major)", () => {
    expect(isVersionAtLeast("0.99.99", "1.12.4")).toBe(false);
  });

  it("handles versions with different segment counts", () => {
    expect(isVersionAtLeast("1.12", "1.12.0")).toBe(true);
    expect(isVersionAtLeast("1.12.4", "1.12")).toBe(true);
  });

  it("handles single-segment versions", () => {
    expect(isVersionAtLeast("2", "1")).toBe(true);
    expect(isVersionAtLeast("1", "2")).toBe(false);
  });
});

describe("isCliDisabledOutput", () => {
  it("detects the disabled-CLI warning in stdout", () => {
    expect(
      isCliDisabledOutput(
        "Command line interface is not enabled. Please turn it on in Settings > General > Advanced."
      )
    ).toBe(true);
  });

  it("detects the warning regardless of surrounding noise/case", () => {
    expect(
      isCliDisabledOutput("Loading updated app package\nCOMMAND LINE INTERFACE IS NOT ENABLED.")
    ).toBe(true);
  });

  it("returns false for a normal daily path", () => {
    expect(isCliDisabledOutput("Daily/2026-06-16-화.md")).toBe(false);
  });

  it("returns false for empty/undefined output", () => {
    expect(isCliDisabledOutput("")).toBe(false);
    expect(isCliDisabledOutput(undefined)).toBe(false);
  });
});

describe("MIN_CLI_VERSION", () => {
  it("is set to 1.12.4", () => {
    expect(MIN_CLI_VERSION).toBe("1.12.4");
  });
});

describe("Obsidian CLI timeouts", () => {
  it("gives Daily bootstrap more time than lightweight probes", () => {
    expect(DAILY_BOOTSTRAP_TIMEOUT_MS).toBeGreaterThan(CLI_PROBE_TIMEOUT_MS);
  });
});

describe("resolveCliBin — OBSIDIAN_BIN override", () => {
  const originalOverride = process.env.OBSIDIAN_BIN;

  beforeEach(() => {
    delete process.env.OBSIDIAN_BIN;
  });

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.OBSIDIAN_BIN;
    } else {
      process.env.OBSIDIAN_BIN = originalOverride;
    }
  });

  it("returns OBSIDIAN_BIN when set", () => {
    process.env.OBSIDIAN_BIN = "/custom/obsidian";
    expect(resolveCliBin()).toBe("/custom/obsidian");
  });

  it("trims OBSIDIAN_BIN value", () => {
    process.env.OBSIDIAN_BIN = "  /custom/obsidian  ";
    expect(resolveCliBin()).toBe("/custom/obsidian");
  });

  it("prioritizes OBSIDIAN_BIN over previously cached auto resolution", () => {
    // Warm cache with auto resolution path (found or not-found).
    resolveCliBin();

    process.env.OBSIDIAN_BIN = "/override/obsidian";
    expect(resolveCliBin()).toBe("/override/obsidian");
  });
});

describe("cliDailyPath", () => {
  const originalBin = process.env.OBSIDIAN_BIN;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `agentlog-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (originalBin === undefined) {
      delete process.env.OBSIDIAN_BIN;
    } else {
      process.env.OBSIDIAN_BIN = originalBin;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns path from CLI stdout", () => {
    const mockBin = join(tmpDir, "mock-obsidian");
    writeFileSync(mockBin, '#!/bin/bash\necho "Custom/2026-03-01-일.md"', "utf-8");
    chmodSync(mockBin, 0o755);

    process.env.OBSIDIAN_BIN = mockBin;
    expect(cliDailyPath()).toBe("Custom/2026-03-01-일.md");
  });

  it("returns null when CLI exits non-zero", () => {
    const mockBin = join(tmpDir, "mock-obsidian-fail");
    writeFileSync(mockBin, "#!/bin/bash\nexit 1", "utf-8");
    chmodSync(mockBin, 0o755);

    process.env.OBSIDIAN_BIN = mockBin;
    expect(cliDailyPath()).toBeNull();
  });

  it("returns null when CLI binary not found", () => {
    process.env.OBSIDIAN_BIN = "/nonexistent/obsidian";
    expect(cliDailyPath()).toBeNull();
  });

  it("trims whitespace from CLI output", () => {
    const mockBin = join(tmpDir, "mock-obsidian-ws");
    writeFileSync(mockBin, '#!/bin/bash\necho "  Daily/2026-03-01-일.md  "', "utf-8");
    chmodSync(mockBin, 0o755);

    process.env.OBSIDIAN_BIN = mockBin;
    expect(cliDailyPath()).toBe("Daily/2026-03-01-일.md");
  });

  it("returns null when CLI outputs empty string", () => {
    const mockBin = join(tmpDir, "mock-obsidian-empty");
    writeFileSync(mockBin, '#!/bin/bash\necho ""', "utf-8");
    chmodSync(mockBin, 0o755);

    process.env.OBSIDIAN_BIN = mockBin;
    expect(cliDailyPath()).toBeNull();
  });

  it("returns null when CLI outputs only Electron noise (Obsidian not running)", () => {
    const mockBin = join(tmpDir, "mock-obsidian-noise");
    writeFileSync(mockBin, '#!/bin/bash\necho "2026-03-24 04:27:38 App is up to date."', "utf-8");
    chmodSync(mockBin, 0o755);

    process.env.OBSIDIAN_BIN = mockBin;
    expect(cliDailyPath()).toBeNull();
  });

  it("returns null when disabled CLI prints warning but exits 0", () => {
    const mockBin = join(tmpDir, "mock-obsidian-path-disabled");
    writeFileSync(
      mockBin,
      '#!/bin/bash\necho "Command line interface is not enabled. Please turn it on in Settings > General > Advanced."\nexit 0',
      "utf-8"
    );
    chmodSync(mockBin, 0o755);

    process.env.OBSIDIAN_BIN = mockBin;
    expect(cliDailyPath()).toBeNull();
  });
});

describe("cliEnsureDailyNoteExists", () => {
  const originalBin = process.env.OBSIDIAN_BIN;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `agentlog-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (originalBin === undefined) {
      delete process.env.OBSIDIAN_BIN;
    } else {
      process.env.OBSIDIAN_BIN = originalBin;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns true when obsidian daily exits 0", () => {
    const mockBin = join(tmpDir, "mock-obsidian-daily");
    const called = join(tmpDir, "called");
    writeFileSync(mockBin, `#!/bin/bash\necho "$1" > ${JSON.stringify(called)}\nexit 0`, "utf-8");
    chmodSync(mockBin, 0o755);

    process.env.OBSIDIAN_BIN = mockBin;
    expect(cliEnsureDailyNoteExists()).toBe(true);
    expect(readFileSync(called, "utf-8")).toBe("daily\n");
  });

  it("returns false when obsidian daily exits non-zero", () => {
    const mockBin = join(tmpDir, "mock-obsidian-daily-fail");
    writeFileSync(mockBin, "#!/bin/bash\nexit 1", "utf-8");
    chmodSync(mockBin, 0o755);

    process.env.OBSIDIAN_BIN = mockBin;
    expect(cliEnsureDailyNoteExists()).toBe(false);
  });

  it("returns false when CLI binary is not found", () => {
    process.env.OBSIDIAN_BIN = "/nonexistent/obsidian";
    expect(cliEnsureDailyNoteExists()).toBe(false);
  });

  it("returns false when disabled CLI prints warning but exits 0 (stdout)", () => {
    const mockBin = join(tmpDir, "mock-obsidian-daily-disabled");
    writeFileSync(
      mockBin,
      '#!/bin/bash\necho "Command line interface is not enabled. Please turn it on in Settings > General > Advanced."\nexit 0',
      "utf-8"
    );
    chmodSync(mockBin, 0o755);

    process.env.OBSIDIAN_BIN = mockBin;
    expect(cliEnsureDailyNoteExists()).toBe(false);
  });

  it("returns false when disabled CLI prints warning to stderr but exits 0", () => {
    const mockBin = join(tmpDir, "mock-obsidian-daily-disabled-stderr");
    writeFileSync(
      mockBin,
      '#!/bin/bash\necho "Command line interface is not enabled. Please turn it on in Settings > General > Advanced." >&2\nexit 0',
      "utf-8"
    );
    chmodSync(mockBin, 0o755);

    process.env.OBSIDIAN_BIN = mockBin;
    expect(cliEnsureDailyNoteExists()).toBe(false);
  });
});
