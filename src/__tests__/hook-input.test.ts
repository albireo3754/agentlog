import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseHookInput } from "../schema/hook-input.js";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, "fixtures", name), "utf-8");
}

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

  // H2: Claude/backward-compatibility fallback to message.content
  it("falls back to message.content for non-Codex hook payloads when prompt is absent", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "abc123",
      cwd: "/some/dir",
      message: { content: "from message content" },
    });
    const result = parseHookInput(input);
    expect(result.prompt).toBe("from message content");
  });

  // H3: Claude/backward-compatibility fallback to parts[].text
  it("falls back to parts[0].text for non-Codex hook payloads when prompt and message absent", () => {
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

  it("parses the documented Codex UserPromptSubmit hook payload", () => {
    const result = parseHookInput(fixture("codex-hook-user-prompt-submit.json"), { source: "codex" });

    expect(result).toEqual({
      sessionId: "019cb123-ac48-7d22-b5bf-195ee34699af",
      cwd: "/Users/pray/opensource/agentlog",
      prompt: "Reply with exactly: OK",
    });
  });

  it("requires prompt for Codex UserPromptSubmit hook payloads", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "abc123",
      cwd: "/some/dir",
      model: "gpt-5.5",
      turn_id: "turn-123",
      message: { content: "Claude fallback must not satisfy Codex" },
    });

    expect(() => parseHookInput(input, { source: "codex" })).toThrow("prompt");
  });

  it("throws when hook_event_name is not UserPromptSubmit", () => {
    const input = JSON.stringify({
      hook_event_name: "Stop",
      session_id: "abc123",
      cwd: "/some/dir",
      prompt: "hello",
    });

    expect(() => parseHookInput(input)).toThrow("UserPromptSubmit");
  });

  it("parses a Hermes pre_llm_call shell-hook payload", () => {
    const result = parseHookInput(fixture("hermes-pre-llm-call.json"), { source: "hermes" });

    expect(result).toEqual({
      sessionId: "hermes-session-123",
      cwd: "/Users/pray/work/js/agentlog",
      prompt: "Hermes prompt capture",
    });
  });

  it("requires extra.user_message for Hermes pre_llm_call payloads", () => {
    const input = JSON.stringify({
      hook_event_name: "pre_llm_call",
      session_id: "hermes-session-123",
      cwd: "/some/dir",
      prompt: "top-level prompt must not satisfy Hermes",
      extra: {},
    });

    expect(() => parseHookInput(input, { source: "hermes" })).toThrow("extra.user_message");
  });

  it("requires pre_llm_call for Hermes source", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "hermes-session-123",
      cwd: "/some/dir",
      extra: { user_message: "hello" },
    });

    expect(() => parseHookInput(input, { source: "hermes" })).toThrow("pre_llm_call");
  });
});
