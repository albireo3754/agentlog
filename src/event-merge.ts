import { createHash, randomUUID } from "crypto";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import type { LogEntry } from "./types.js";
import { buildSessionDivider } from "./schema/daily-note.js";

const START = "<!-- agentlog:event:v1 ";
const END = "<!-- /agentlog:event:v1 -->";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const singleLine = (value: string) => value.replace(/[\r\n]/g, " ").replace(/-->/g, "--&gt;");

/** Self-contained records never depend on a preceding project's/session's position. */
export function eventKey(entry: LogEntry, date: Date): string {
  const id = entry.eventId ? digest(entry.eventId) : randomUUID();
  return `${new Date(entry.timestamp ?? date).toISOString()}_${id}`;
}

export function eventBlock(entry: LogEntry, date: Date, body?: string): string {
  const key = eventKey(entry, date);
  const text = body ?? [
    `#### ${singleLine(entry.time)} · ${singleLine(entry.project)}`,
    `<!-- cwd=${singleLine(entry.cwd)} -->`,
    buildSessionDivider(singleLine(entry.sessionId), entry.source),
    `- ${singleLine(entry.time)} ${entry.prompt.replace(/\r?\n/g, "\n  ")}`,
  ].join("\n");
  // Indent any user-supplied protocol-looking line; the protocol is line anchored.
  const safeText = text.replace(/^(<!-- \/?agentlog:event:)/gm, "  $1");
  return `\n${START}${key} ${digest(safeText)} -->\n${safeText}\n${END}\n`;
}

export function splitEvents(content: string): { text: string; events: Map<string, string> } {
  const events = new Map<string, string>();
  const text = content.replace(/\n<!-- agentlog:event:v1 ([\w:.-]+) ([a-f0-9]{64}) -->\n([\s\S]*?)\n<!-- \/agentlog:event:v1 -->\n/g, (block, id, hash, body) => {
    if (digest(body) !== hash) throw new Error("An immutable AgentLog event was edited");
    if (events.has(id) && events.get(id) !== block) throw new Error("AgentLog event ID collision");
    events.set(id, block);
    return "";
  });
  if (/^<!-- \/?agentlog:event:/m.test(text)) throw new Error("Malformed AgentLog event block");
  return { text, events };
}

function mergeText(base: string, ours: string, theirs: string): { content: string; clean: boolean } {
  if (ours === theirs) return { content: ours, clean: true };
  if (ours === base) return { content: theirs, clean: true };
  if (theirs === base) return { content: ours, clean: true };
  const dir = mkdtempSync(join(tmpdir(), "agentlog-merge-"));
  try {
    for (const [name, value] of [["base", base], ["ours", ours], ["theirs", theirs]]) writeFileSync(join(dir, name), value);
    const result = spawnSync("git", ["merge-file", "--stdout", "--diff3", "-L", "ours", "-L", "base", "-L", "theirs", join(dir, "ours"), join(dir, "base"), join(dir, "theirs")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.error || result.status === null || result.status > 127) throw new Error("git merge-file failed");
    return { content: result.stdout, clean: result.status === 0 };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export function mergeNotes(base: string, ours: string, theirs: string): { content: string; clean: boolean } {
  try {
    const b = splitEvents(base), o = splitEvents(ours), t = splitEvents(theirs);
    const records = new Map<string, string>();
    for (const side of [b, o, t]) for (const [id, block] of side.events) {
      if (records.has(id) && records.get(id) !== block) throw new Error("AgentLog event ID collision");
      records.set(id, block);
    }
    const result = mergeText(b.text, o.text, t.text);
    result.content += [...records].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, block]) => block).join("");
    return result;
  } catch {
    // Never silently union an edited/corrupt event or discard any version.
    return { clean: false, content: `<<<<<<< ours\n${ours}\n||||||| base\n${base}\n=======\n${theirs}\n>>>>>>> theirs\n` };
  }
}
