import { describe, it, expect } from "bun:test";
import { parseHookInput } from "../schema/hook-input.js";

/**
 * hook.ts itself is a CLI entry point that reads Bun.stdin and calls appendEntry.
 * We test the testable units it depends on:
 *   - parseHookInput (schema/hook-input.ts) — all parsing logic
 *   - prompt truncation behavior (slice to 100)
 *
 * Integration-level behavior (stdin → file) is covered by note-writer tests
 * since hook.ts delegates entirely to appendEntry.
 */

describe("parseHookInput", () => {
  // H1-compatible: valid input with all required fields
  it("parses valid hook input with prompt field", () => {
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "abc123",
      cwd: "/work",
      prompt: "agentlog 개발 진행",
    });

    const result = parseHookInput(input);
    expect(result.sessionId).toBe("abc123");
    expect(result.cwd).toBe("/work");
    expect(result.prompt).toBe("agentlog 개발 진행");
  });

  // H8: invalid JSON
  it("throws on invalid JSON stdin", () => {
    expect(() => parseHookInput("not-json")).toThrow("Invalid JSON");
  });

  // H7-compatible: missing session_id
  it("throws when session_id is missing", () => {
    const input = JSON.stringify({ cwd: "/work", prompt: "hello" });
    expect(() => parseHookInput(input)).toThrow("session_id");
  });

  it("throws when cwd is missing", () => {
    const input = JSON.stringify({ session_id: "abc", prompt: "hello" });
    expect(() => parseHookInput(input)).toThrow("cwd");
  });

  it("throws when no prompt source is available", () => {
    const input = JSON.stringify({ session_id: "abc", cwd: "/work" });
    expect(() => parseHookInput(input)).toThrow("prompt");
  });

  // H10: session_id is captured but session_id itself is not written to note
  //      (parseHookInput returns sessionId; note-writer never receives it)
  it("returns sessionId in parsed result", () => {
    const input = JSON.stringify({
      session_id: "session-xyz",
      cwd: "/work",
      prompt: "test",
    });
    const result = parseHookInput(input);
    expect(result.sessionId).toBe("session-xyz");
  });

  // Fallback: message.content
  it("extracts prompt from message.content when prompt field absent", () => {
    const input = JSON.stringify({
      session_id: "s1",
      cwd: "/work",
      message: { content: "메시지 컨텐츠" },
    });
    const result = parseHookInput(input);
    expect(result.prompt).toBe("메시지 컨텐츠");
  });

  // Fallback: parts[0].text
  it("extracts prompt from parts[0].text as last fallback", () => {
    const input = JSON.stringify({
      session_id: "s1",
      cwd: "/work",
      parts: [{ type: "text", text: "파츠 텍스트" }],
    });
    const result = parseHookInput(input);
    expect(result.prompt).toBe("파츠 텍스트");
  });

  it("throws when parts array is empty", () => {
    const input = JSON.stringify({
      session_id: "s1",
      cwd: "/work",
      parts: [],
    });
    expect(() => parseHookInput(input)).toThrow("prompt");
  });

  it("throws when input is not a JSON object", () => {
    expect(() => parseHookInput('"just a string"')).toThrow("JSON object");
  });
});

// Prompt truncation is now handled by prettyPrompt() — see pretty-prompt.test.ts
