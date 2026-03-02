import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { appendEntry, dailyNotePath } from "../note-writer.js";
import type { AgentLogConfig, LogEntry } from "../types.js";

// Fixed test date: 2026-03-01 (일요일)
const TEST_DATE = new Date(2026, 2, 1, 10, 53, 0);

function makeTmpDir(): string {
  const dir = join(tmpdir(), `agentlog-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    time: "10:53",
    prompt: "테스트 작업",
    sessionId: "abc12345-def6-7890-abcd-ef1234567890",
    project: "js/agentlog",
    cwd: "/Users/pray/work/js/agentlog",
    ...overrides,
  };
}

const FIXTURE_WITH_TIMEBLOCKS = `# 2026-03-01

## 오전 (08-13)
- [ ] 08 - 09
- [ ] 09 - 10
- [ ] 10 - 12
- [ ] 12 - 13

## 오후 (13-17)
- [ ] 13 - 15
- [ ] 15 - 17`;

const FIXTURE_NO_TIMEBLOCKS = `# 2026-03-01

오늘 할 일 메모.`;

describe("dailyNotePath", () => {
  it("returns Obsidian Daily path with Korean day name", () => {
    const config: AgentLogConfig = { vault: "/vault" };
    const path = dailyNotePath(config, TEST_DATE);
    expect(path).toBe("/vault/Daily/2026-03-01-일.md");
  });

  it("returns plain path without Daily subdir", () => {
    const config: AgentLogConfig = { vault: "/vault", plain: true };
    const path = dailyNotePath(config, TEST_DATE);
    expect(path).toBe("/vault/2026-03-01.md");
  });
});

describe("appendEntry — session-grouped AgentLog section", () => {
  let tmpDir: string;
  let config: AgentLogConfig;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    config = { vault: tmpDir, writeMode: "file" };
    mkdirSync(join(tmpDir, "Daily"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // N1: new file — creates ## AgentLog + > 🕐 + #### section
  it("creates ## AgentLog with latest line and project section on new file", () => {
    const entry = makeEntry();
    const result = appendEntry(config, entry, TEST_DATE);

    expect(result.created).toBe(true);
    expect(result.section).toBe("agentlog");
    expect(existsSync(result.filePath)).toBe(true);

    const content = readFileSync(result.filePath, "utf-8");
    expect(content).toContain("## AgentLog");
    expect(content).toContain("> 🕐 10:53 — js/agentlog › 테스트 작업");
    expect(content).toContain("#### js/agentlog · 10:53");
    expect(content).toContain("<!-- cwd=/Users/pray/work/js/agentlog ses=abc12345 -->");
    expect(content).toContain("- 10:53 테스트 작업");
  });

  // N2: file with existing content — appends ## AgentLog at end
  it("appends ## AgentLog section to existing file without modifying existing content", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_NO_TIMEBLOCKS, "utf-8");

    const entry = makeEntry();
    appendEntry(config, entry, TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("오늘 할 일 메모.");
    expect(content).toContain("## AgentLog");
    expect(content).toContain("- 10:53 테스트 작업");
  });

  // N3: file with timeblocks — entries go to ## AgentLog, NOT into timeblocks
  it("writes to ## AgentLog section even when timeblocks exist (no timeblock insertion)", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_WITH_TIMEBLOCKS, "utf-8");

    const entry = makeEntry();
    const result = appendEntry(config, entry, TEST_DATE);

    expect(result.section).toBe("agentlog");
    const content = readFileSync(filePath, "utf-8");
    // Entry should be in AgentLog section
    expect(content).toContain("## AgentLog");
    expect(content).toContain("- 10:53 테스트 작업");
    // Timeblock should NOT have the entry
    const lines = content.split("\n");
    const blockIdx = lines.findIndex((l) => l.includes("10 - 12"));
    expect(lines[blockIdx + 1]).not.toContain("10:53");
  });

  // N4: same project, same session → append to existing section
  it("appends to existing project section when project and session match", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_NO_TIMEBLOCKS, "utf-8");

    const entry1 = makeEntry({ time: "10:53", prompt: "첫 번째 작업" });
    const entry2 = makeEntry({ time: "11:07", prompt: "두 번째 작업" });
    appendEntry(config, entry1, TEST_DATE);
    appendEntry(config, entry2, TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    // Both entries in same section
    const sections = content.split("#### ");
    expect(sections.length).toBe(2); // header + one project section
    expect(content).toContain("- 10:53 첫 번째 작업");
    expect(content).toContain("- 11:07 두 번째 작업");
    // No session divider
    expect(content).not.toContain("- - - -");
  });

  // N5: same project, different session → insert divider
  it("inserts session divider when session changes within same project", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_NO_TIMEBLOCKS, "utf-8");

    const entry1 = makeEntry({ time: "10:53", sessionId: "session1-aaaa-bbbb-cccc-dddddddddddd" });
    const entry2 = makeEntry({ time: "15:00", sessionId: "session2-xxxx-yyyy-zzzz-111111111111" });
    appendEntry(config, entry1, TEST_DATE);
    appendEntry(config, entry2, TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("- - - - (ses_session2)");
    expect(content).toContain("- 10:53 테스트 작업");
    expect(content).toContain("- 15:00 테스트 작업");
  });

  // N6: different projects → separate #### sections
  it("creates separate sections for different projects", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_NO_TIMEBLOCKS, "utf-8");

    const entry1 = makeEntry({
      time: "10:53",
      project: "js/agentlog",
      cwd: "/Users/pray/work/js/agentlog",
    });
    const entry2 = makeEntry({
      time: "15:00",
      project: "kotlin/my-project",
      cwd: "/Users/pray/work/kotlin/my-project",
    });
    appendEntry(config, entry1, TEST_DATE);
    appendEntry(config, entry2, TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("#### js/agentlog · 10:53");
    expect(content).toContain("#### kotlin/my-project · 15:00");
  });

  // N7: > 🕐 latest line always reflects the most recent entry
  it("updates > 🕐 latest line to the most recent entry on each write", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_NO_TIMEBLOCKS, "utf-8");

    appendEntry(config, makeEntry({ time: "10:53", prompt: "첫 번째" }), TEST_DATE);
    appendEntry(config, makeEntry({ time: "11:07", prompt: "두 번째" }), TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    // Only the latest entry appears in > 🕐
    expect(content).toContain("> 🕐 11:07 — js/agentlog › 두 번째");
    expect(content).not.toContain("> 🕐 10:53");
  });

  // N8: project header preserves original start time when session updates
  it("preserves original project start time in header when session changes", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_NO_TIMEBLOCKS, "utf-8");

    appendEntry(config, makeEntry({ time: "10:53", sessionId: "session1-aaaa-bbbb-cccc-dddddddddddd" }), TEST_DATE);
    appendEntry(config, makeEntry({ time: "15:00", sessionId: "session2-xxxx-yyyy-zzzz-111111111111" }), TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    // Header should still show 10:53 (first entry time), not 15:00
    expect(content).toContain("#### js/agentlog · 10:53");
    expect(content).not.toContain("#### js/agentlog · 15:00");
  });

  // N9: ## AgentLog already exists → append project section inside it
  it("appends to existing ## AgentLog section", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(
      filePath,
      "# 2026-03-01\n\n## AgentLog\n> 🕐 09:00 — js/old › old entry\n\n#### js/old · 09:00\n<!-- cwd=/old/path ses=abc00000 -->\n- 09:00 old entry\n",
      "utf-8"
    );

    const entry = makeEntry({ time: "10:53" });
    appendEntry(config, entry, TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("#### js/old · 09:00");
    expect(content).toContain("#### js/agentlog · 10:53");
    expect(content).toContain("- 09:00 old entry");
    expect(content).toContain("- 10:53 테스트 작업");
  });

  // N10: empty file
  it("handles empty file without crashing", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, "", "utf-8");

    const entry = makeEntry();
    expect(() => appendEntry(config, entry, TEST_DATE)).not.toThrow();
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("## AgentLog");
    expect(content).toContain("- 10:53 테스트 작업");
  });

  // N11: WriteResult fields
  it("returns section=agentlog and correct filePath", () => {
    const entry = makeEntry();
    const result = appendEntry(config, entry, TEST_DATE);
    expect(result.section).toBe("agentlog");
    expect(result.filePath).toContain("2026-03-01-일.md");
  });

  // N12: section header contains cwd and sessionShort
  it("embeds full cwd and session short in section header comment", () => {
    const entry = makeEntry();
    appendEntry(config, entry, TEST_DATE);

    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("<!-- cwd=/Users/pray/work/js/agentlog ses=abc12345 -->");
  });

  // N13: cwd with spaces — section matching must not break
  it("handles cwd with spaces in path correctly", () => {
    const entry = makeEntry({
      cwd: "/Users/John Doe/work/js/agentlog",
      project: "js/agentlog",
    });
    appendEntry(config, entry, TEST_DATE);

    // Second entry with same cwd — should go into the same section, not a new one
    const entry2 = makeEntry({
      time: "11:00",
      prompt: "두 번째 작업",
      cwd: "/Users/John Doe/work/js/agentlog",
      project: "js/agentlog",
    });
    appendEntry(config, entry2, TEST_DATE);

    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    const content = readFileSync(filePath, "utf-8");
    // Should have only one #### section (not two)
    const sections = content.split("#### ");
    expect(sections.length).toBe(2);
    expect(content).toContain("<!-- cwd=/Users/John Doe/work/js/agentlog ses=abc12345 -->");
    expect(content).toContain("- 10:53 테스트 작업");
    expect(content).toContain("- 11:00 두 번째 작업");
  });

  // N14: 3 entries in same session — all appended in order within the section
  it("appends three entries in same session in insertion order", () => {
    const filePath = join(tmpDir, "Daily", "2026-03-01-일.md");
    writeFileSync(filePath, FIXTURE_NO_TIMEBLOCKS, "utf-8");

    appendEntry(config, makeEntry({ time: "10:00", prompt: "첫 번째" }), TEST_DATE);
    appendEntry(config, makeEntry({ time: "10:30", prompt: "두 번째" }), TEST_DATE);
    appendEntry(config, makeEntry({ time: "11:00", prompt: "세 번째" }), TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    // Only one #### section
    expect(content.split("#### ").length).toBe(2);
    // No session dividers
    expect(content).not.toContain("- - - -");
    // All three entries present
    expect(content).toContain("- 10:00 첫 번째");
    expect(content).toContain("- 10:30 두 번째");
    expect(content).toContain("- 11:00 세 번째");
    // Ordering: 첫 번째 before 두 번째 before 세 번째
    const idx1 = content.indexOf("- 10:00 첫 번째");
    const idx2 = content.indexOf("- 10:30 두 번째");
    const idx3 = content.indexOf("- 11:00 세 번째");
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
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

  it("writes to {vault}/YYYY-MM-DD.md in plain mode", () => {
    const entry = makeEntry();
    const result = appendEntry(config, entry, TEST_DATE);
    expect(result.filePath).toBe(join(tmpDir, "2026-03-01.md"));
  });

  it("returns section=plain in plain mode", () => {
    const entry = makeEntry();
    const result = appendEntry(config, entry, TEST_DATE);
    expect(result.section).toBe("plain");
  });

  it("creates file with header and entry when file does not exist", () => {
    const entry = makeEntry({ prompt: "plain 신규 파일" });
    const result = appendEntry(config, entry, TEST_DATE);

    expect(result.created).toBe(true);
    const content = readFileSync(result.filePath, "utf-8");
    expect(content).toContain("# 2026-03-01");
    expect(content).toContain("- 10:53 plain 신규 파일");
  });

  it("appends to existing plain file without duplicate header", () => {
    const filePath = join(tmpDir, "2026-03-01.md");
    writeFileSync(filePath, "# 2026-03-01\n- 09:00 기존 항목\n", "utf-8");

    const entry = makeEntry({ time: "10:53", prompt: "추가 항목" });
    appendEntry(config, entry, TEST_DATE);

    const content = readFileSync(filePath, "utf-8");
    const headerCount = (content.match(/# 2026-03-01/g) ?? []).length;
    expect(headerCount).toBe(1);
    expect(content).toContain("- 10:53 추가 항목");
  });
});
