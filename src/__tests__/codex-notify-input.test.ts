import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseCodexNotifyInput } from "../schema/codex-notify-input.js";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, "fixtures", name), "utf-8");
}

describe("parseCodexNotifyInput", () => {
  it("parses the real captured agent-turn-complete payload", () => {
    const result = parseCodexNotifyInput(fixture("codex-notify-single.json"));

    expect(result).toEqual({
      sessionId: "019cb123-ac48-7d22-b5bf-195ee34699af",
      cwd: "/Users/pray/Obsidian",
      prompt: "Reply with exactly: OK",
    });
  });

  it("picks the last user message from input-messages", () => {
    const result = parseCodexNotifyInput(fixture("codex-notify-multi-message.json"));

    expect(result?.prompt).toBe("codex notify 지원 추가해줘");
  });

  it("returns null for non agent-turn-complete events", () => {
    expect(parseCodexNotifyInput(fixture("codex-notify-non-turn.json"))).toBeNull();
  });

  it("throws when thread-id is missing", () => {
    const raw = JSON.stringify({
      type: "agent-turn-complete",
      cwd: "/some/dir",
      "input-messages": ["hello"],
    });

    expect(() => parseCodexNotifyInput(raw)).toThrow("thread-id");
  });

  it("throws when cwd is missing", () => {
    const raw = JSON.stringify({
      type: "agent-turn-complete",
      "thread-id": "thread-123",
      "input-messages": ["hello"],
    });

    expect(() => parseCodexNotifyInput(raw)).toThrow("cwd");
  });

  it("throws when input-messages is missing", () => {
    const raw = JSON.stringify({
      type: "agent-turn-complete",
      "thread-id": "thread-123",
      cwd: "/some/dir",
    });

    expect(() => parseCodexNotifyInput(raw)).toThrow("input-messages");
  });

  it("handles Korean prompts correctly", () => {
    const raw = JSON.stringify({
      type: "agent-turn-complete",
      "thread-id": "thread-123",
      cwd: "/some/dir",
      "input-messages": ["첫 번째 메시지", "마지막 사용자 질문"],
    });

    expect(parseCodexNotifyInput(raw)?.prompt).toBe("마지막 사용자 질문");
  });
});
