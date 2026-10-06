import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appendEntry } from "../note-writer.js";
import { splitEvents, mergeNotes } from "../event-merge.js";
import { replayJournal } from "../event-journal.js";
const date = new Date(2026, 9, 7, 12);
let root: string;
let oldConfig: string | undefined;
const entry = { time: "12:00", prompt: "same prompt", sessionId: "session-1", project: "test", cwd: "/test", source: "codex" as const };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentlog-events-"));
  oldConfig = process.env.AGENTLOG_CONFIG_DIR;
  process.env.AGENTLOG_CONFIG_DIR = join(root, "state");
});
afterEach(() => {
  if (oldConfig === undefined) delete process.env.AGENTLOG_CONFIG_DIR;
  else process.env.AGENTLOG_CONFIG_DIR = oldConfig;
  rmSync(root, { recursive: true, force: true });
});
it("writes independent immutable blocks and preserves repeated same-minute prompts", () => {
  const config = { vault: root, plain: true, gitSync: true };
  const result = appendEntry(config, entry, date);
  const first = readFileSync(result.filePath, "utf8");
  appendEntry(config, entry, date);
  const second = readFileSync(result.filePath, "utf8");
  expect(second.startsWith(first)).toBe(true);
  expect(splitEvents(second).events.size).toBe(2);
  expect(second).not.toContain("> 🕐");
});
it("replays captured records after a note replacement without duplicates", () => {
  const config = { vault: root, plain: true, gitSync: true };
  const { filePath } = appendEntry(config, entry, date);
  writeFileSync(filePath, "# Daily\nmanual edits\n");
  expect(replayJournal(root).inserted).toBe(1);
  expect(replayJournal(root).inserted).toBe(0);
  expect(readFileSync(filePath, "utf8")).toContain("manual edits");
  expect(splitEvents(readFileSync(filePath, "utf8")).events.size).toBe(1);
});
it("unions events deterministically while preserving manual text", () => {
  const config = { vault: root, plain: true, gitSync: true };
  const { filePath } = appendEntry(config, entry, date);
  const a = readFileSync(filePath, "utf8");
  const base = splitEvents(a).text;
  appendEntry(config, { ...entry, sessionId: "session-2" }, date);
  const both = readFileSync(filePath, "utf8");
  const blocks = [...splitEvents(both).events.values()];
  const b = base + blocks[1];
  const result = mergeNotes(base, a, b);
  expect(result.clean).toBe(true);
  expect(splitEvents(result.content).events.size).toBe(2);
  expect(mergeNotes(base, b, a).content).toBe(result.content);
  expect(mergeNotes(base, result.content, a).content).toBe(result.content);
});
it("keeps handwritten conflicts visible without dropping either event", () => {
  const config = { vault: root, plain: true, gitSync: true };
  const { filePath } = appendEntry(config, entry, date);
  const block = [...splitEvents(readFileSync(filePath, "utf8")).events.values()][0];
  const result = mergeNotes("# Daily\noriginal\n", "# Daily\nleft\n" + block, "# Daily\nright\n");
  expect(result.clean).toBe(false);
  expect(result.content).toContain("<<<<<<<");
  expect(result.content).toContain("left");
  expect(result.content).toContain("right");
  expect(splitEvents(result.content).events.size).toBe(1);
});

it("retains duplicate-looking source records during backfill and is idempotent", async () => {
  const { mkdirSync } = await import("fs");
  const { runBackfill } = await import("../backfill.js");
  const codexHome = join(root, "codex");
  const sessions = join(codexHome, "sessions/2026/10/07");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "rollout.jsonl"), [
    { type: "session_meta", payload: { id: entry.sessionId, cwd: entry.cwd } },
    ...["12:00:01", "12:00:02"].map(time => ({ timestamp: `2026-10-07T${time}`, type: "event_msg", payload: { type: "user_message", message: entry.prompt } })),
  ].map(row => JSON.stringify(row)).join("\n"));
  const config = { vault: root, plain: true, gitSync: true };
  const opts = { date, source: "codex" as const, codexHome };
  expect(runBackfill(config, opts).inserted).toBe(2);
  expect(runBackfill(config, opts).inserted).toBe(0);
  expect(splitEvents(readFileSync(join(root, "2026-10-07.md"), "utf8")).events.size).toBe(2);
});

it("keeps all matching session blocks available to EnglishAsk", async () => {
  const { buildEnglishAskContext } = await import("../english-ask.js");
  const config = { vault: root, plain: true, gitSync: true };
  const { filePath } = appendEntry(config, { ...entry, prompt: "earlier context" }, date);
  appendEntry(config, { ...entry, prompt: "next context" }, date);
  const context = buildEnglishAskContext(filePath, entry);
  expect(context).toContain("earlier context"); expect(context).toContain("next context");
});
it("fsyncs the journal directory after publishing the event", async () => {
  const fs = await import("fs");
  const { spyOn } = await import("bun:test");
  const actual = fs.fsyncSync;
  const directories: boolean[] = [];
  const spy = spyOn(fs, "fsyncSync").mockImplementation(fd => {
    directories.push(fs.fstatSync(fd).isDirectory()); actual(fd);
  });
  try {
    appendEntry({ vault: root, plain: true, gitSync: true }, entry, date);
    expect(directories).toContain(false);
    expect(directories.at(-1)).toBe(true);
  } finally { spy.mockRestore(); }
});
