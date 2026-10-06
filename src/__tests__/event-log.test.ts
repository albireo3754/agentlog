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
it("recovers the first stable record when only the second identical record exists", async () => {
  const { mkdirSync } = await import("fs");
  const { collectBackfillEntries, runBackfill } = await import("../backfill.js");
  const codexHome = join(root, "codex"); const sessions = join(codexHome, "sessions/2026/10/07");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "rollout.jsonl"), [
    { type: "session_meta", payload: { id: entry.sessionId, cwd: entry.cwd } },
    ...["12:00:01", "12:00:02"].map(time => ({ timestamp: `2026-10-07T${time}`, type: "event_msg", payload: { type: "user_message", message: entry.prompt } })),
  ].map(row => JSON.stringify(row)).join("\n"));
  const config = { vault: root, plain: true, gitSync: true };
  const opts = { date, source: "codex" as const, codexHome };
  const entries = collectBackfillEntries(opts).entries;
  const { filePath } = appendEntry(config, entries[1], date);
  expect(runBackfill(config, opts).inserted).toBe(1);
  expect(splitEvents(readFileSync(filePath, "utf8")).events.size).toBe(2);
  expect(runBackfill(config, opts).inserted).toBe(0);
});
it("does not carry Git sync into a different vault during init", async () => {
  const { saveConfig } = await import("../config.js");
  const { saveMergedConfig } = await import("../cli-shared.js");
  saveConfig({ vault: root, gitSync: true });
  expect(saveMergedConfig(root, true).gitSync).toBe(true);
  expect(saveMergedConfig(join(root, "another"), true).gitSync).toBe(false);
});
it("preserves EnglishAsk as an H2 inside a Git sync event", async () => {
  const { appendEnglishAskFeedback } = await import("../english-ask.js");
  const config = { vault: root, plain: true, gitSync: true };
  const { filePath } = appendEntry(config, entry, date);
  appendEnglishAskFeedback(filePath, { score: 4, prompt: entry.prompt, feedback: "clear" }, entry, config);
  expect(readFileSync(filePath, "utf8")).toContain("\n## EnglishAsk\n");
});
it("backfills every subset of repeated source events without dropping or duplicating IDs", async () => {
  const { mkdirSync } = await import("fs");
  const { collectBackfillEntries, runBackfill } = await import("../backfill.js");
  const codexHome = join(root, "codex"); const sessions = join(codexHome, "sessions/2026/10/07");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "rollout.jsonl"), [
    { type: "session_meta", payload: { id: entry.sessionId, cwd: entry.cwd } },
    ...[1, 2, 3].map(second => ({ timestamp: `2026-10-07T12:00:0${second}`, type: "event_msg", payload: { type: "user_message", message: entry.prompt } })),
  ].map(row => JSON.stringify(row)).join("\n"));
  const opts = { date, source: "codex" as const, codexHome };
  const entries = collectBackfillEntries(opts).entries;
  for (let mask = 0; mask < 8; mask++) {
    const vault = join(root, `subset-${mask}`); mkdirSync(vault);
    const config = { vault, plain: true, gitSync: true };
    const filePath = join(vault, "2026-10-07.md"); writeFileSync(filePath, "# Daily\n");
    for (let i = 0; i < 3; i++) if (mask & (1 << i)) appendEntry(config, entries[i], date);
    runBackfill(config, opts);
    expect(splitEvents(readFileSync(filePath, "utf8")).events.size).toBe(3);
    expect(runBackfill(config, opts).inserted).toBe(0);
  }
});
it("keeps immutable blocks valid when legacy logging resumes after uninstall", async () => {
  const { mkdirSync } = await import("fs");
  const { appendEnglishAskFeedback } = await import("../english-ask.js");
  mkdirSync(join(root, ".obsidian"));
  writeFileSync(join(root, ".obsidian/daily-notes.json"), JSON.stringify({ folder: "", format: "YYYY-MM-DD" }));
  const filePath = join(root, "2026-10-07.md"); writeFileSync(filePath, "# Day\n\n## AgentLog\n");
  const config = { vault: root, gitSync: true };
  appendEntry(config, entry, date);
  appendEnglishAskFeedback(filePath, { score: 4, prompt: entry.prompt, feedback: "first" }, entry, config);
  const before = splitEvents(readFileSync(filePath, "utf8")).events;
  appendEntry({ vault: root }, { ...entry, prompt: "legacy again" }, date);
  appendEnglishAskFeedback(filePath, { score: 3, prompt: entry.prompt, feedback: "legacy feedback" }, entry, { vault: root });
  const after = splitEvents(readFileSync(filePath, "utf8"));
  expect(after.events).toEqual(before);
  expect(after.text).toContain("legacy again"); expect(after.text).toContain("legacy feedback");
});
