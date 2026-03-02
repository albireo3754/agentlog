import { describe, it, expect } from "bun:test";
import { prettyPrompt } from "../schema/pretty-prompt.js";

describe("prettyPrompt", () => {
  // --- SKIP patterns ---
  it("skips [Request interrupted] messages", () => {
    expect(prettyPrompt("[Request interrupted by user for tool use]## AgentLog")).toBeNull();
  });

  it("skips <local-command-caveat>", () => {
    expect(prettyPrompt("<local-command-caveat>Caveat: The messages...</local-command-caveat>")).toBeNull();
  });

  it("skips <local-command-stdout>", () => {
    expect(prettyPrompt("<local-command-stdout>Set model to sonnet</local-command-stdout>")).toBeNull();
  });

  it("skips <command-name> (slash commands)", () => {
    expect(prettyPrompt("<command-name>/clear</command-name>")).toBeNull();
  });

  it("skips <task-notification>", () => {
    expect(prettyPrompt("<task-notification><task-id>bkezw</task-id></task-notification>")).toBeNull();
  });

  it("skips skill injections", () => {
    expect(prettyPrompt("Base directory for this skill: /Users/pray/.claude/skills")).toBeNull();
  });

  it("skips continuation messages", () => {
    expect(prettyPrompt("This session is being continued from a previous conversation...")).toBeNull();
  });

  it("skips skill markdown blobs", () => {
    expect(prettyPrompt("# wt — Sub-Worktree Manager\nUsage: /wt add ...")).toBeNull();
  });

  it("skips hook feedback", () => {
    expect(prettyPrompt("Stop hook feedback: some text")).toBeNull();
    expect(prettyPrompt("[AUTOPILOT] iteration 3")).toBeNull();
    expect(prettyPrompt("[RALPH LOOP] continuing")).toBeNull();
    expect(prettyPrompt("[MAGIC KEYWORD: ultrawork]")).toBeNull();
  });

  // --- EXTRACT from AgentLog feedback ---
  it("extracts real prompt from AgentLog feedback block", () => {
    const input = `## AgentLog
> 🕐 14:24 — js/agentlog › agentlog 가 제대로 동작안하는중인데 원인파악

#### js/agentlog · 14:22`;
    expect(prettyPrompt(input)).toBe("agentlog 가 제대로 동작안하는중인데 원인파악");
  });

  // --- Normal prompts ---
  it("passes through simple prompts", () => {
    expect(prettyPrompt("fix the login bug")).toBe("fix the login bug");
  });

  it("collapses 2-line prompts by joining", () => {
    expect(prettyPrompt("line one\nline two")).toBe("line one line two");
  });

  it("collapses 3+ line prompts with (+N lines) summary", () => {
    expect(prettyPrompt("line one\nline two\nline three")).toBe("line one (+1 lines) line three");
    expect(prettyPrompt("a\nb\nc\nd\ne")).toBe("a (+3 lines) e");
  });

  it("excludes empty lines from collapsed count", () => {
    expect(prettyPrompt("first\n\n\nlast")).toBe("first last");
    expect(prettyPrompt("first\nsecond\n\nthird\nfourth")).toBe("first (+2 lines) fourth");
  });

  it("strips markdown headings", () => {
    expect(prettyPrompt("## AgentLog section")).toBe("AgentLog section");
    expect(prettyPrompt("### Some Heading")).toBe("Some Heading");
  });

  it("strips blockquote markers", () => {
    expect(prettyPrompt("> some quoted text")).toBe("some quoted text");
  });

  it("strips XML tags", () => {
    expect(prettyPrompt("<system-reminder>hello</system-reminder>")).toBe("hello");
  });

  it("strips HTML comments", () => {
    expect(prettyPrompt("text <!-- cwd=/some/path ses=abc --> more")).toBe("text more");
  });

  it("strips ANSI escape codes", () => {
    expect(prettyPrompt("\x1b[31mred text\x1b[0m")).toBe("red text");
  });

  it("strips code fences", () => {
    // After stripping ``` markers, only "const x = 1;" remains (1 non-empty line)
    expect(prettyPrompt("```typescript\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("returns full text for long prompts (no truncation)", () => {
    const long = "a".repeat(200);
    const result = prettyPrompt(long)!;
    expect(result.length).toBe(200);
  });

it("returns null for empty/whitespace input", () => {
    expect(prettyPrompt("")).toBeNull();
    expect(prettyPrompt("   \n  ")).toBeNull();
  });

  it("returns null for single-char noise after cleanup", () => {
    expect(prettyPrompt(">")).toBeNull();
    expect(prettyPrompt("#")).toBeNull();
  });

  // --- Korean prompts ---
  it("handles Korean prompts correctly", () => {
    expect(prettyPrompt("로그인 버그 수정해줘")).toBe("로그인 버그 수정해줘");
  });

  it("handles mixed Korean/English multi-line", () => {
    expect(prettyPrompt("fix bug\n버그 수정")).toBe("fix bug 버그 수정");
  });
});
