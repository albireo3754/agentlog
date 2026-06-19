import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { collectBackfillEntries, parseDateArg, runBackfill } from "../backfill.js";
import type { AgentLogConfig } from "../types.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `agentlog-backfill-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonl(path: string, rows: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf-8");
}

describe("backfill", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("collects Codex user_message entries without logging injected context", () => {
    const codexHome = join(root, ".codex");
    writeJsonl(join(codexHome, "sessions", "2026", "06", "19", "rollout.jsonl"), [
      {
        timestamp: "2026-06-19T10:00:00",
        type: "session_meta",
        payload: { id: "codex-session", cwd: "/Users/me/work/js/agentlog", thread_source: "user" },
      },
      {
        timestamp: "2026-06-19T10:00:01",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions" }] },
      },
      {
        timestamp: "2026-06-19T10:01:00",
        type: "event_msg",
        payload: { type: "user_message", message: "backfill this prompt" },
      },
    ]);

    const result = collectBackfillEntries({
      date: parseDateArg("2026-06-19"),
      source: "codex",
      codexHome,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      time: "10:01",
      prompt: "backfill this prompt",
      sessionId: "codex-session",
      project: "js/agentlog",
      source: "codex",
    });
  });

  it("collects Claude user text and skips tool-result shaped user messages", () => {
    const claudeHome = join(root, ".claude");
    const sessionPath = join(claudeHome, "projects", "-Users-me-work-js-agentlog", "claude-session.jsonl");
    writeJsonl(sessionPath, [
      {
        timestamp: "2026-06-19T11:00:00",
        type: "user",
        sessionId: "claude-session",
        cwd: "/Users/me/work/js/agentlog",
        isSidechain: false,
        message: { role: "user", content: "claude backfill prompt" },
      },
      {
        timestamp: "2026-06-19T11:01:00",
        type: "user",
        sessionId: "claude-session",
        cwd: "/Users/me/work/js/agentlog",
        message: { role: "user", content: [{ type: "tool_result", content: "not a prompt" }] },
      },
    ]);
    writeJsonl(join(claudeHome, "projects", "-Users-me-work-js-agentlog", "claude-session", "subagents", "agent.jsonl"), [
      {
        timestamp: "2026-06-19T11:02:00",
        type: "user",
        sessionId: "subagent",
        cwd: "/Users/me/work/js/agentlog",
        message: { role: "user", content: "subagent prompt" },
      },
    ]);

    const result = collectBackfillEntries({
      date: parseDateArg("2026-06-19"),
      source: "claude",
      claudeHome,
    });

    expect(result.entries.map((entry) => entry.prompt)).toEqual(["claude backfill prompt"]);
  });

  it("appends missing entries and skips duplicates on the next run", () => {
    const codexHome = join(root, ".codex");
    const vault = join(root, "notes");
    mkdirSync(vault, { recursive: true });
    writeJsonl(join(codexHome, "sessions", "2026", "06", "19", "rollout.jsonl"), [
      {
        timestamp: "2026-06-19T12:00:00",
        type: "session_meta",
        payload: { id: "codex-session", cwd: "/Users/me/work/js/agentlog", thread_source: "user" },
      },
      {
        timestamp: "2026-06-19T12:01:00",
        type: "event_msg",
        payload: { type: "user_message", message: "write once" },
      },
    ]);

    const config: AgentLogConfig = { vault, plain: true };
    const opts = { date: parseDateArg("2026-06-19"), source: "codex" as const, codexHome };
    const first = runBackfill(config, opts);
    const second = runBackfill(config, opts);

    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(1);
    const note = readFileSync(join(vault, "2026-06-19.md"), "utf-8");
    expect(note.match(/write once/g)?.length).toBe(1);
  });
});
