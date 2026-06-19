import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
import { appendEntry, dailyNotePath } from "./note-writer.js";
import { buildAgentLogEntry, buildSessionDivider, cwdToProject } from "./schema/daily-note.js";
import { prettyPrompt } from "./schema/pretty-prompt.js";
import type { AgentLogConfig, LogEntry, SourceType } from "./types.js";

export type BackfillSource = SourceType | "all";

export interface BackfillOptions {
  date?: Date;
  source?: BackfillSource;
  dryRun?: boolean;
  codexHome?: string;
  claudeHome?: string;
}

export interface BackfillResult {
  date: string;
  scanned: number;
  found: number;
  inserted: number;
  skipped: number;
  filePath: string | null;
}

type RawJson = Record<string, unknown>;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseDateArg(value: string | undefined, now: Date = new Date()): Date {
  if (!value) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error("date must be YYYY-MM-DD");
  const [, yyyy, mm, dd] = m;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function timeKey(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function sameLocalDate(timestamp: string | undefined, date: Date): boolean {
  if (!timestamp) return false;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return false;
  return dateKey(parsed) === dateKey(date);
}

function readJsonLines(filePath: string): RawJson[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return typeof parsed === "object" && parsed !== null ? [parsed as RawJson] : [];
      } catch {
        return [];
      }
    });
}

function walkJsonl(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) {
        stack.push(path);
      } else if (name.endsWith(".jsonl")) {
        out.push(path);
      }
    }
  }
  return out;
}

function extractTextParts(value: unknown, textType: string): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const parts = value
    .filter((part): part is RawJson => typeof part === "object" && part !== null)
    .filter((part) => part["type"] === textType && typeof part["text"] === "string")
    .map((part) => part["text"] as string);
  return parts.length > 0 ? parts.join("\n") : null;
}

function pushEntry(entries: LogEntry[], raw: string | null, timestamp: string | undefined, base: Omit<LogEntry, "time" | "prompt">, date: Date): void {
  if (!raw || !sameLocalDate(timestamp, date)) return;
  const prompt = prettyPrompt(raw);
  if (!prompt) return;
  entries.push({
    ...base,
    time: timeKey(new Date(timestamp!)),
    prompt,
  });
}

function collectCodexEntries(date: Date, codexHome = join(homedir(), ".codex")): { scanned: number; entries: LogEntry[] } {
  const root = join(codexHome, "sessions", String(date.getFullYear()), pad2(date.getMonth() + 1), pad2(date.getDate()));
  const files = walkJsonl(root);
  const entries: LogEntry[] = [];

  for (const file of files) {
    const lines = readJsonLines(file);
    const meta = lines.find((line) => line["type"] === "session_meta")?.["payload"] as RawJson | undefined;
    const sessionId = typeof meta?.["id"] === "string" ? meta["id"] : basename(file, ".jsonl");
    const cwd = typeof meta?.["cwd"] === "string" ? meta["cwd"] : process.cwd();
    if (meta?.["thread_source"] === "subagent") continue;

    const base = { sessionId, cwd, project: cwdToProject(cwd), source: "codex" as const };
    for (const line of lines) {
      if (line["type"] !== "event_msg") continue;
      const payload = line["payload"] as RawJson | undefined;
      if (payload?.["type"] !== "user_message") continue;
      const message = typeof payload["message"] === "string" ? payload["message"] : null;
      pushEntry(entries, message, line["timestamp"] as string | undefined, base, date);
    }
  }

  return { scanned: files.length, entries };
}

function collectClaudeEntries(date: Date, claudeHome = join(homedir(), ".claude")): { scanned: number; entries: LogEntry[] } {
  const files = walkJsonl(join(claudeHome, "projects")).filter((file) => !file.includes("/subagents/"));
  const entries: LogEntry[] = [];

  for (const file of files) {
    for (const line of readJsonLines(file)) {
      if (line["type"] !== "user") continue;
      if (line["isSidechain"] === true) continue;
      const sessionId = typeof line["sessionId"] === "string" ? line["sessionId"] : basename(file, ".jsonl");
      const cwd = typeof line["cwd"] === "string" ? line["cwd"] : process.cwd();
      const message = line["message"] as RawJson | undefined;
      if (message?.["role"] !== "user") continue;
      const raw = extractTextParts(message["content"], "text");
      const base = { sessionId, cwd, project: cwdToProject(cwd), source: "claude" as const };
      pushEntry(entries, raw, line["timestamp"] as string | undefined, base, date);
    }
  }

  return { scanned: files.length, entries };
}

export function collectBackfillEntries(options: BackfillOptions = {}): { scanned: number; entries: LogEntry[] } {
  const date = options.date ?? parseDateArg(undefined);
  const source = options.source ?? "all";
  const chunks = [];
  if (source === "all" || source === "codex") chunks.push(collectCodexEntries(date, options.codexHome));
  if (source === "all" || source === "claude") chunks.push(collectClaudeEntries(date, options.claudeHome));
  const entries = chunks.flatMap((chunk) => chunk.entries);
  entries.sort((a, b) => a.time.localeCompare(b.time) || a.source.localeCompare(b.source) || a.sessionId.localeCompare(b.sessionId));
  return {
    scanned: chunks.reduce((sum, chunk) => sum + chunk.scanned, 0),
    entries,
  };
}

function noteContainsEntry(config: AgentLogConfig, entry: LogEntry, date: Date): boolean {
  const path = dailyNotePath(config, date);
  if (!path || !existsSync(path)) return false;
  const content = readFileSync(path, "utf-8");
  const line = buildAgentLogEntry(entry.time, entry.prompt);
  if (config.plain) return content.includes(line);
  const divider = buildSessionDivider(entry.sessionId, entry.source);
  return content.includes(divider) && content.includes(line);
}

export function runBackfill(config: AgentLogConfig, options: BackfillOptions = {}): BackfillResult {
  const date = options.date ?? parseDateArg(undefined);
  const { scanned, entries } = collectBackfillEntries({ ...options, date });
  const filePath = dailyNotePath(config, date);
  let inserted = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (noteContainsEntry(config, entry, date)) {
      skipped++;
      continue;
    }
    if (!options.dryRun) appendEntry(config, entry, date);
    inserted++;
  }

  return {
    date: dateKey(date),
    scanned,
    found: entries.length,
    inserted,
    skipped,
    filePath,
  };
}
