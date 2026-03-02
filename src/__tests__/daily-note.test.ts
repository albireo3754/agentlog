import { describe, it, expect } from "bun:test";
import {
  dailyNoteFileName,
  KO_DAYS,
  cwdToProject,
  buildAgentLogEntry,
  buildSessionDivider,
  buildLatestLine,
  buildProjectHeader,
  buildProjectMetadata,
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

describe("cwdToProject", () => {
  it("returns parent/basename for standard work path", () => {
    expect(cwdToProject("/Users/pray/work/js/agentlog")).toBe("js/agentlog");
  });

  it("returns parent/basename for another language path", () => {
    expect(cwdToProject("/Users/pray/work/kotlin/my-project")).toBe("kotlin/my-project");
  });

  it("returns parent/basename for worktree path", () => {
    expect(cwdToProject("/Users/pray/worktrees/feature-branch/app")).toBe("feature-branch/app");
  });

  it("returns basename only when single segment", () => {
    expect(cwdToProject("/agentlog")).toBe("agentlog");
  });

  it("strips trailing slash", () => {
    expect(cwdToProject("/Users/pray/work/js/agentlog/")).toBe("js/agentlog");
  });
});

describe("buildAgentLogEntry", () => {
  it("formats entry as '- HH:MM prompt'", () => {
    expect(buildAgentLogEntry("10:53", "hello world")).toBe("- 10:53 hello world");
  });

  it("handles Korean text", () => {
    expect(buildAgentLogEntry("10:53", "작업 진행")).toBe("- 10:53 작업 진행");
  });
});

describe("buildSessionDivider", () => {
  it("returns divider with first 8 chars of sessionId", () => {
    expect(buildSessionDivider("abc12345-def6-7890-abcd-ef1234567890")).toBe("- - - - [[ses_abc12345]]");
  });

  it("uses full sessionId when shorter than 8 chars", () => {
    expect(buildSessionDivider("abc")).toBe("- - - - [[ses_abc]]");
  });
});

describe("buildLatestLine", () => {
  it("formats latest line blockquote", () => {
    expect(buildLatestLine("17:32", "kotlin/my-project", "API 응답 수정")).toBe(
      "> 🕐 17:32 — kotlin/my-project › API 응답 수정"
    );
  });
});

describe("buildProjectHeader", () => {
  it("formats project header without cwd/session metadata", () => {
    expect(buildProjectHeader("js/agentlog", "10:53")).toBe("#### 10:53 · js/agentlog");
  });
});

describe("buildProjectMetadata", () => {
  it("formats metadata comment with cwd only (no ses)", () => {
    expect(buildProjectMetadata("/Users/pray/work/js/agentlog")).toBe(
      "<!-- cwd=/Users/pray/work/js/agentlog -->"
    );
  });

  it("handles cwd with spaces correctly", () => {
    expect(buildProjectMetadata("/Users/John Doe/work/js/agentlog")).toBe(
      "<!-- cwd=/Users/John Doe/work/js/agentlog -->"
    );
  });
});
