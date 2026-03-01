import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import type { AgentLogConfig, LogEntry, WriteResult } from "./types.js";
import {
  KO_DAYS,
  findTimeBlock,
  buildLogLine,
  dailyNoteFileName,
} from "./schema/daily-note.js";

/** Zero-pads a number to 2 digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Returns daily note file path for a given date. */
export function dailyNotePath(config: AgentLogConfig, date: Date): string {
  if (config.plain) {
    const yyyy = date.getFullYear();
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    return join(config.vault, `${yyyy}-${mm}-${dd}.md`);
  }
  return join(config.vault, "Daily", dailyNoteFileName(date));
}

/**
 * Appends a log entry to the Daily Note.
 * - Finds the matching timeblock line and inserts after it (and any existing entries in that block).
 * - Falls back to an ## AgentLog section at end of file.
 * - Creates the file if it doesn't exist.
 */
export function appendEntry(
  config: AgentLogConfig,
  entry: LogEntry,
  date: Date = new Date()
): WriteResult {
  const filePath = dailyNotePath(config, date);
  const entryLine = buildLogLine(entry.time, entry.prompt);

  if (config.plain) {
    return appendPlain(filePath, entry, date);
  }

  const created = !existsSync(filePath);

  if (created) {
    mkdirSync(dirname(filePath), { recursive: true });
    const content = buildAgentLogSection([entryLine]);
    writeFileSync(filePath, content, "utf-8");
    return { filePath, created: true, section: "agentlog" };
  }

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const hour = parseInt(entry.time.split(":")[0], 10);
  const blockLabel = findTimeBlock(hour); // e.g. "10 - 12"

  if (blockLabel) {
    const blockIdx = findTimeBlockLine(lines, blockLabel);

    if (blockIdx !== -1) {
      // Insert after existing indented entries under this block
      let insertIdx = blockIdx + 1;
      while (
        insertIdx < lines.length &&
        lines[insertIdx].startsWith("  ")
      ) {
        insertIdx++;
      }
      lines.splice(insertIdx, 0, entryLine);
      writeFileSync(filePath, lines.join("\n"), "utf-8");
      return { filePath, created: false, section: "timeblock" };
    }
  }

  // No matching timeblock found — use ## AgentLog section
  return appendToAgentLogSection(filePath, lines, entryLine);
}

/**
 * Finds the index of the timeblock checkbox line matching the given label.
 * Matches both checked and unchecked, and handles zero-padded vs non-padded hours.
 * E.g. blockLabel "8 - 10" matches "- [ ] 08 - 10" or "- [ ] 8 - 10"
 */
function findTimeBlockLine(lines: string[], blockLabel: string): number {
  // Parse start/end from the schema label (e.g. "8 - 10" → [8, 10])
  const parts = blockLabel.split(" - ");
  if (parts.length !== 2) return -1;
  const labelStart = parseInt(parts[0], 10);
  const labelEnd = parseInt(parts[1], 10);

  // Regex: "- [ ] HH - HH" or "- [x] HH - HH" (any padding)
  const re = /^-\s+\[[ x]\]\s+(\d{1,2})\s+-\s+(\d{1,2})$/;

  return lines.findIndex((l) => {
    const m = l.trim().match(re);
    if (!m) return false;
    return parseInt(m[1], 10) === labelStart && parseInt(m[2], 10) === labelEnd;
  });
}

/** Appends to ## AgentLog section, or creates it at end of file. */
function appendToAgentLogSection(
  filePath: string,
  lines: string[],
  entryLine: string
): WriteResult {
  const sectionIdx = lines.findIndex((l) => l.trim() === "## AgentLog");

  if (sectionIdx !== -1) {
    // Insert before the next ## heading or at end of file
    let insertIdx = sectionIdx + 1;
    while (insertIdx < lines.length && !lines[insertIdx].startsWith("## ")) {
      insertIdx++;
    }
    lines.splice(insertIdx, 0, entryLine);
  } else {
    // Append new section at end
    if (lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push("## AgentLog", entryLine);
  }

  writeFileSync(filePath, lines.join("\n"), "utf-8");
  return { filePath, created: false, section: "agentlog" };
}

/** Plain mode: simple append without timeblock parsing. */
function appendPlain(
  filePath: string,
  entry: LogEntry,
  date: Date
): WriteResult {
  const created = !existsSync(filePath);

  if (created) {
    mkdirSync(dirname(filePath), { recursive: true });
    const yyyy = date.getFullYear();
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    const header = `# ${yyyy}-${mm}-${dd}\n`;
    writeFileSync(filePath, `${header}- ${entry.time} ${entry.prompt}\n`, "utf-8");
    return { filePath, created: true, section: "plain" };
  }

  const content = readFileSync(filePath, "utf-8");
  const appended = content.endsWith("\n")
    ? content + `- ${entry.time} ${entry.prompt}\n`
    : content + `\n- ${entry.time} ${entry.prompt}\n`;
  writeFileSync(filePath, appended, "utf-8");
  return { filePath, created: false, section: "plain" };
}

/** Builds file content with just an AgentLog section. */
function buildAgentLogSection(entryLines: string[]): string {
  return ["## AgentLog", ...entryLines, ""].join("\n");
}
