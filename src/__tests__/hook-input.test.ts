import { describe, it, expect } from "bun:test";
import { parseHookInput } from "../schema/hook-input.js";

describe("parseHookInput", () => {
  // H1: valid input with prompt field
  it("parses valid input with prompt field", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "abc123",
      cwd: "/some/dir",
      prompt: "hello world",
    });
    const result = parseHookInput(input);
    expect(result.sessionId).toBe("abc123");
    expect(result.cwd).toBe("/some/dir");
    expect(result.prompt).toBe("hello world");
  });

  // H2: fallback to message.content
  it("falls back to message.content when prompt is absent", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "abc123",
      cwd: "/some/dir",
      message: { content: "from message content" },
    });
    const result = parseHookInput(input);
    expect(result.prompt).toBe("from message content");
  });

  // H3: fallback to parts[].text
  it("falls back to parts[0].text when prompt and message absent", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "abc123",
      cwd: "/some/dir",
      parts: [{ type: "text", text: "from parts" }],
    });
    const result = parseHookInput(input);
    expect(result.prompt).toBe("from parts");
  });

  // H4: prompt preferred over message.content
  it("prefers prompt over message.content", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "abc123",
      cwd: "/some/dir",
      prompt: "direct prompt",
      message: { content: "message content" },
    });
    const result = parseHookInput(input);
    expect(result.prompt).toBe("direct prompt");
  });

  // H5: invalid JSON throws
  it("throws on invalid JSON", () => {
    expect(() => parseHookInput("{broken")).toThrow("Invalid JSON");
  });

  // H6: missing session_id throws
  it("throws when session_id is missing", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      cwd: "/some/dir",
      prompt: "hello",
    });
    expect(() => parseHookInput(input)).toThrow("session_id");
  });

  // H7: missing cwd throws
  it("throws when cwd is missing", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "abc123",
      prompt: "hello",
    });
    expect(() => parseHookInput(input)).toThrow("cwd");
  });

  // H8: no prompt source throws
  it("throws when no prompt source is available", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "abc123",
      cwd: "/some/dir",
    });
    expect(() => parseHookInput(input)).toThrow("prompt");
  });

  // H9: non-object input throws
  it("throws when input is not an object", () => {
    expect(() => parseHookInput('"just a string"')).toThrow();
  });

  // H10: Korean prompt text
  it("handles Korean prompt text correctly", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "abc123",
      cwd: "/some/dir",
      prompt: "agentlog 개발을 위해서 작업 진행",
    });
    const result = parseHookInput(input);
    expect(result.prompt).toBe("agentlog 개발을 위해서 작업 진행");
  });
});
