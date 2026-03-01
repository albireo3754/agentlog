import { describe, it, expect } from "bun:test";
import {
  dailyNoteFileName,
  findTimeBlock,
  buildLogLine,
  KO_DAYS,
} from "../schema/daily-note.js";

describe("dailyNoteFileName", () => {
  // D1: correct format for a known date
  it("returns correct filename for 2026-03-01 (Sunday)", () => {
    const date = new Date(2026, 2, 1); // March 1, 2026 = Sunday
    expect(dailyNoteFileName(date)).toBe("2026-03-01-일.md");
  });

  // D2: zero-pads month and day
  it("zero-pads single-digit month and day", () => {
    const date = new Date(2026, 0, 5); // Jan 5 = Monday
    expect(dailyNoteFileName(date)).toBe("2026-01-05-월.md");
  });

  // D3: all 7 day names
  it("uses correct Korean day names for all 7 days", () => {
    // 2026-03-01 is Sunday (0), so shift by day index
    const sunday = new Date(2026, 2, 1);
    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      const name = dailyNoteFileName(d);
      expect(name).toContain(KO_DAYS[d.getDay()]);
    }
  });
});

describe("findTimeBlock", () => {
  // T1: hour 10 → "10 - 12"
  it("returns '10 - 12' for hour 10", () => {
    expect(findTimeBlock(10)).toBe("10 - 12");
  });

  // T2: hour 11 → "10 - 12"
  it("returns '10 - 12' for hour 11", () => {
    expect(findTimeBlock(11)).toBe("10 - 12");
  });

  // T3: hour 12 is boundary → "12 - 13" or start of next
  it("returns correct block for boundary hour 12", () => {
    const result = findTimeBlock(12);
    expect(result).not.toBeNull();
    // 12 starts a new block
    expect(result).toContain("12");
  });

  // T4: hour 8 → "8 - 9" (오전 첫 블록)
  it("returns '8 - 9' for hour 8", () => {
    expect(findTimeBlock(8)).toBe("8 - 9");
  });

  // T5: hour 0 → "0 - 2" (새벽 첫 블록)
  it("returns '0 - 2' for hour 0 (새벽 block)", () => {
    expect(findTimeBlock(0)).toBe("0 - 2");
  });

  // T6: hour 23 → "23 - 24" (저녁 마지막 블록)
  it("returns '23 - 24' for hour 23", () => {
    expect(findTimeBlock(23)).toBe("23 - 24");
  });
});

describe("buildLogLine", () => {
  // L1: basic format
  it("formats log line with time and prompt", () => {
    expect(buildLogLine("10:53", "hello world")).toBe("  - 10:53 hello world");
  });

  // L2: truncates prompt at 100 chars
  it("truncates prompt to 100 characters", () => {
    const long = "a".repeat(150);
    const line = buildLogLine("11:00", long);
    expect(line).toBe("  - 11:00 " + "a".repeat(100));
  });

  // L3: exact 100 chars not truncated
  it("keeps prompt of exactly 100 chars unchanged", () => {
    const exact = "b".repeat(100);
    const line = buildLogLine("11:00", exact);
    expect(line).toBe("  - 11:00 " + exact);
  });

  // L4: Korean text
  it("handles Korean text in prompt", () => {
    const line = buildLogLine("10:53", "agentlog 개발을 위해서 작업 진행");
    expect(line).toBe("  - 10:53 agentlog 개발을 위해서 작업 진행");
  });
});
