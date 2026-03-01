import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { appendEntry, dailyNotePath } from "../note-writer.js";
import type { AgentLogConfig, LogEntry } from "../types.js";

// Fixed test date: 2026-03-01 (일요일, day index 0)
const TEST_DATE = new Date(2026, 2, 1, 10, 53, 0); // March 1 2026, 10:53

function makeTmpDir(): string {
  const dir = join(tmpdir(), `agentlog-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const FIXTURE_WITH_TIMEBLOCKS = `# 2026-03-01

## 오전 (08-13)
- [ ] 08 - 09
- [ ] 09 - 10
- [ ] 10 - 12
- [ ] 12 - 13

## 오후 (13-17)
- [ ] 13 - 15
- [ ] 15 - 17

## 저녁 (17-24)
- [ ] 17 - 19
- [ ] 19 - 21
- [ ] 21 - 23
- [ ] 23 - 24`;

const FIXTURE_NO_TIMEBLOCKS = `# 2026-03-01

오늘 할 일 메모.`;

describe("dailyNotePath", () => {
  it("returns Obsidian Daily path with Korean day name", () => {
    const config: AgentLogConfig = { vault: "/vault" };
    const path = dailyNotePath(config, TEST_DATE);
    // 2026-03-01 is 일요일 (day 0 → 일)
    expect(path).toBe("/vault/Daily/2026-03-01-일.md");
  });

  it("returns plain path without Daily subdir", () => {
    const config: AgentLogConfig = { vault: "/vault", plain: true };
    const path = dailyNotePath(config, TEST_DATE);
    expect(path).toBe("/vault/2026-03-01.md");
  });
});

describe("appendEntry — timeblock mode", () => {
  let tmpDir: string;
  let config: AgentLogConfig;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    config = { vault: tmpDir };
    mkdirSync(join(tmpDir, "Daily"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // N7: file does not exist → created
  it("creates Daily Note file if it does not exist", () => {
    const entry: LogEntry = { time: "10:53", prompt: "hello" };
    const result = appendEntry(config, entry, TEST_DATE);

    expect(result.created).toBe(true);
    expect(existsSync(result.filePath)).toBe(true);
  });

  // N1: append to existing timeblock — exact match 10-12
  it("inserts entry under the matching 10-12 timeblock", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_WITH_TIMEBLOCKS, "utf-8");

    const entry: LogEntry = { time: "10:53", prompt: "테스트 작업" };
    const result = appendEntry(config, entry, TEST_DATE);

    expect(result.section).toBe("timeblock");
    const lines = readFileSync(filePath, "utf-8").split("\n");
    const blockIdx = lines.findIndex((l) => l.includes("10 - 12"));
    expect(blockIdx).toBeGreaterThan(-1);
    // The entry line should appear right after the block line
    expect(lines[blockIdx + 1]).toBe("  - 10:53 테스트 작업");
  });

  // N2: first block (08 - 09)
  it("inserts entry under the 08-09 timeblock for hour 08", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_WITH_TIMEBLOCKS, "utf-8");

    const earlyDate = new Date(2026, 2, 1, 8, 5, 0);
    const entry: LogEntry = { time: "08:05", prompt: "아침 작업" };
    const result = appendEntry(config, entry, earlyDate);

    expect(result.section).toBe("timeblock");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("  - 08:05 아침 작업");
  });

  // N3: last block (12 - 13)
  it("inserts entry under the 12-13 timeblock for hour 12", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_WITH_TIMEBLOCKS, "utf-8");

    const noonDate = new Date(2026, 2, 1, 12, 30, 0);
    const entry: LogEntry = { time: "12:30", prompt: "점심 후 작업" };
    const result = appendEntry(config, entry, noonDate);

    expect(result.section).toBe("timeblock");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("  - 12:30 점심 후 작업");
  });

  // N5: no timeblock headers → AgentLog section
  it("falls back to ## AgentLog section when no timeblocks present", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_NO_TIMEBLOCKS, "utf-8");

    const entry: LogEntry = { time: "10:53", prompt: "노트 없음" };
    const result = appendEntry(config, entry, TEST_DATE);

    expect(result.section).toBe("agentlog");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("## AgentLog");
    expect(content).toContain("  - 10:53 노트 없음");
  });

  // N6: ## AgentLog section already exists
  it("appends under existing ## AgentLog section", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, "# 2026-03-01\n\n## AgentLog\n  - 09:00 기존 항목\n", "utf-8");

    const entry: LogEntry = { time: "10:53", prompt: "새 항목" };
    appendEntry(config, entry, TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("  - 09:00 기존 항목");
    expect(content).toContain("  - 10:53 새 항목");
  });

  // N8: file is empty
  it("handles empty file without crashing", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, "", "utf-8");

    const entry: LogEntry = { time: "10:53", prompt: "빈 파일" };
    expect(() => appendEntry(config, entry, TEST_DATE)).not.toThrow();
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("  - 10:53 빈 파일");
  });

  // N9: existing content preserved
  it("preserves existing file content when appending", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_NO_TIMEBLOCKS, "utf-8");

    const entry: LogEntry = { time: "10:53", prompt: "신규 항목" };
    appendEntry(config, entry, TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("오늘 할 일 메모.");
    expect(content).toContain("  - 10:53 신규 항목");
  });

  // N10: two writes produce two separate lines (no dedup)
  it("appends two separate lines on two writes at the same time", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_NO_TIMEBLOCKS, "utf-8");

    const entry: LogEntry = { time: "10:53", prompt: "동일 프롬프트" };
    appendEntry(config, entry, TEST_DATE);
    appendEntry(config, entry, TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    const matches = content.match(/- 10:53 동일 프롬프트/g) ?? [];
    expect(matches.length).toBe(2);
  });

  // N13: WriteResult.section === "timeblock" when block found
  it("returns section=timeblock when a matching timeblock is found", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_WITH_TIMEBLOCKS, "utf-8");

    const entry: LogEntry = { time: "10:53", prompt: "섹션 확인" };
    const result = appendEntry(config, entry, TEST_DATE);

    expect(result.section).toBe("timeblock");
  });

  // N14: WriteResult.section === "agentlog" as fallback
  it("returns section=agentlog when no timeblocks present", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_NO_TIMEBLOCKS, "utf-8");

    const entry: LogEntry = { time: "10:53", prompt: "섹션 확인" };
    const result = appendEntry(config, entry, TEST_DATE);

    expect(result.section).toBe("agentlog");
  });
});

describe("appendEntry — plain mode", () => {
  let tmpDir: string;
  let config: AgentLogConfig;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    config = { vault: tmpDir, plain: true };
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // N11: plain mode file path
  it("writes to {vault}/YYYY-MM-DD.md in plain mode", () => {
    const entry: LogEntry = { time: "10:53", prompt: "plain test" };
    const result = appendEntry(config, entry, TEST_DATE);

    expect(result.filePath).toBe(join(tmpDir, "2026-03-01.md"));
  });

  // N15: WriteResult.section === "plain"
  it("returns section=plain in plain mode", () => {
    const entry: LogEntry = { time: "10:53", prompt: "plain section" };
    const result = appendEntry(config, entry, TEST_DATE);

    expect(result.section).toBe("plain");
  });

  it("creates file with header and entry when file does not exist", () => {
    const entry: LogEntry = { time: "10:53", prompt: "plain 신규 파일" };
    const result = appendEntry(config, entry, TEST_DATE);

    expect(result.created).toBe(true);
    const content = readFileSync(result.filePath, "utf-8");
    expect(content).toContain("# 2026-03-01");
    expect(content).toContain("- 10:53 plain 신규 파일");
  });

  it("appends to existing plain file without creating duplicate header", () => {
    const filePath = join(tmpDir, "2026-03-01.md");
    writeFileSync(filePath, "# 2026-03-01\n- 09:00 기존 항목\n", "utf-8");

    const entry: LogEntry = { time: "10:53", prompt: "추가 항목" };
    appendEntry(config, entry, TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    const headerCount = (content.match(/# 2026-03-01/g) ?? []).length;
    expect(headerCount).toBe(1);
    expect(content).toContain("- 10:53 추가 항목");
  });
});
