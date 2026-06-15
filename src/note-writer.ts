import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname, resolve, relative, isAbsolute, sep } from "path";
import type { AgentLogConfig, LogEntry, WriteResult } from "./types.js";
import {
  KO_DAYS,
  dailyNoteFileName,
  buildAgentLogEntry,
  buildSessionDivider,
  buildLatestLine,
  buildProjectHeader,
  buildProjectMetadata,
} from "./schema/daily-note.js";
import { cliDailyPath } from "./obsidian-cli.js";

type DailyNotesConfig = {
  folder?: string;
  format?: string;
};

const FORMAT_TOKEN_RE = /YYYY|YY|MM|M|DD|D|dddd|ddd|dd|d/g;
const FORMAT_ALPHA_RE = /[A-Za-z]+/g;
const SUPPORTED_FORMAT_TOKENS = new Set([
  "YYYY",
  "YY",
  "MM",
  "M",
  "DD",
  "D",
  "dddd",
  "ddd",
  "dd",
  "d",
]);

function formatDailyNoteFileName(date: Date, format: string): string | null {
  const baseFormat = format.endsWith(".md") ? format.slice(0, -3) : format;
  const alphaTokens = baseFormat.match(FORMAT_ALPHA_RE) ?? [];
  if (alphaTokens.some((token) => !SUPPORTED_FORMAT_TOKENS.has(token))) return null;
  const dayShort = KO_DAYS[date.getDay()];
  const replacements: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MM: pad2(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad2(date.getDate()),
    D: String(date.getDate()),
    ddd: dayShort,
    dddd: `${dayShort}요일`,
    dd: dayShort,
    d: String(date.getDay()),
  };
  const replaced = baseFormat.replace(FORMAT_TOKEN_RE, (token) => replacements[token] ?? token);
  return `${replaced}.md`;
}

function safeVaultJoin(vault: string, ...segments: string[]): string | null {
  const root = resolve(vault);
  const target = resolve(root, ...segments);
  const rel = relative(root, target);
  if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) return target;
  return null;
}

/**
 * Read Daily Notes path from .obsidian/daily-notes.json.
 * Avoids spawning the Obsidian CLI binary, which causes renderer reloads.
 */
function vaultDailyPath(vault: string, date: Date): string | null {
  const cfgPath = join(vault, ".obsidian", "daily-notes.json");
  if (!existsSync(cfgPath)) return null;
  try {
    const raw = readFileSync(cfgPath, "utf-8");
    const cfg = JSON.parse(raw) as DailyNotesConfig;
    const folder = typeof cfg.folder === "string" ? cfg.folder.trim() : "Daily";
    const fileName = cfg.format?.trim()
      ? formatDailyNoteFileName(date, cfg.format.trim())
      : dailyNoteFileName(date);
    if (!fileName) return null;
    return safeVaultJoin(vault, folder, fileName);
  } catch {
    return null;
  }
}

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

  // Try .obsidian/daily-notes.json first (no CLI spawn, no renderer reload)
  const vaultPath = vaultDailyPath(config.vault, date);
  if (vaultPath) return vaultPath;

  // Try Obsidian CLI (respects user's Daily Notes folder setting)
  const relativePath = cliDailyPath();
  const cliPath = relativePath ? safeVaultJoin(config.vault, relativePath) : null;
  if (cliPath) return cliPath;

  // Fallback: hardcoded {vault}/Daily/
  return join(config.vault, "Daily", dailyNoteFileName(date));
}

/**
 * Appends a log entry to the Daily Note.
 *
 * For plain mode: simple append (unchanged behavior).
 * For normal mode: session-grouped ## AgentLog section.
 *   - Groups entries by project (derived from cwd).
 *   - Inserts session divider when session_id changes within a project.
 *   - Keeps a pinned "> 🕐" latest-entry line at the top of ## AgentLog.
 */
export function appendEntry(
  config: AgentLogConfig,
  entry: LogEntry,
  date: Date = new Date()
): WriteResult {
  const filePath = dailyNotePath(config, date);

  if (config.plain) {
    return appendPlain(filePath, entry, date);
  }

  const created = !existsSync(filePath);
  if (created) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const content = created ? "" : readFileSync(filePath, "utf-8");
  const newContent = insertIntoAgentLogSection(content, entry);
  writeFileSync(filePath, newContent, "utf-8");
  return { filePath, created, section: "agentlog" };
}

/**
 * Insert entry into ## AgentLog section with session-grouped subsections.
 *
 * Output structure:
 *   ## AgentLog
 *   > 🕐 HH:MM — project › prompt        ← latest entry (always updated)
 *
 *   #### project · HH:MM                  ← one section per cwd
 *   - HH:MM entry
 *   - - - - [[claude_<session_id>]]      ← divider when session changes
 *   - HH:MM entry
 */
function insertIntoAgentLogSection(content: string, entry: LogEntry): string {
  const entryLine = buildAgentLogEntry(entry.time, entry.prompt);
  const latestLine = buildLatestLine(entry.time, entry.project, entry.prompt);

  const lines = content.split("\n");

  // 1. Find or create ## AgentLog
  let agentLogIdx = lines.findIndex((l) => l === "## AgentLog");
  if (agentLogIdx === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push("## AgentLog");
    agentLogIdx = lines.length - 1;
  }

  // Find end of ## AgentLog section (next ## heading or EOF)
  let agentLogEnd = lines.length;
  for (let i = agentLogIdx + 1; i < lines.length; i++) {
    if (/^## [^#]/.test(lines[i])) {
      agentLogEnd = i;
      break;
    }
  }

  // 2. Find > 🕐 latest line (first non-blank line after ## AgentLog)
  let latestLineIdx = -1;
  for (let i = agentLogIdx + 1; i < agentLogEnd; i++) {
    if (lines[i] === "") continue;
    if (lines[i].startsWith("> 🕐")) {
      latestLineIdx = i;
    }
    break; // only check the first non-blank line
  }

  // 3. Find #### project subsection matching entry.cwd
  // New format:    "#### HH:MM · project" + next line "<!-- cwd=<path> -->"
  // Legacy meta:   "#### HH:MM · project" + next line "<!-- cwd=<path> ses=<short> -->"
  // Legacy inline: "#### project · HH:MM <!-- cwd=<path> ses=<short> -->"
  const metaRe = /^<!-- cwd=(.+?) -->$/;
  const legacyMetaRe = /^<!-- cwd=(.+?) ses=([\w-]+) -->$/;
  const legacyHeaderRe = /^#### .+ <!-- cwd=(.+?) ses=([\w-]+) -->$/;
  // Match current [[claude_...]]/[[codex_...]] and legacy [[ses_...]]/(ses_...) dividers
  const dividerRe = /^- - - - (?:\[\[(?:claude|codex|ses)_([\w-]+)\]\]|\(ses_([\w-]+)\))$/;

  let projectIdx = -1;
  let projectMetaIdx = -1; // -1 means legacy inline format (no separate metadata line)
  let legacySes = ""; // ses from legacy metadata, used as fallback when no dividers exist
  let existingTime = entry.time;

  for (let i = agentLogIdx + 1; i < agentLogEnd; i++) {
    if (!lines[i].startsWith("#### ")) continue;

    // Try new format: metadata on next line (no ses)
    const meta = lines[i + 1]?.match(metaRe);
    if (meta) {
      const [, storedCwd] = meta;
      if (storedCwd !== entry.cwd) continue;
      projectIdx = i;
      projectMetaIdx = i + 1;
      const timeMatch = lines[i].match(/^#### (\d{2}:\d{2}) /);
      if (timeMatch) existingTime = timeMatch[1];
      break;
    }

    // Try legacy format: metadata with ses on next line
    const legacyMeta = lines[i + 1]?.match(legacyMetaRe);
    if (legacyMeta) {
      const [, storedCwd, commentSes] = legacyMeta;
      if (storedCwd !== entry.cwd) continue;
      projectIdx = i;
      projectMetaIdx = i + 1;
      legacySes = commentSes;
      const timeMatch = lines[i].match(/^#### (\d{2}:\d{2}) /);
      if (timeMatch) existingTime = timeMatch[1];
      break;
    }

    // Try legacy inline format
    const legacy = lines[i].match(legacyHeaderRe);
    if (legacy) {
      const [, storedCwd, commentSes] = legacy;
      if (storedCwd !== entry.cwd) continue;
      projectIdx = i;
      projectMetaIdx = -1;
      legacySes = commentSes;
      const timeMatch = lines[i].match(/· (\d{2}:\d{2}) /);
      if (timeMatch) existingTime = timeMatch[1];
      break;
    }
  }

  // 4. Insert entry
  if (projectIdx === -1) {
    // New project: create #### section with initial session divider at end of ## AgentLog.
    // The initial divider anchors the starting session so subsequent entries can compare.
    const header = buildProjectHeader(entry.project, entry.time);
    const meta = buildProjectMetadata(entry.cwd);
    const prevLine = lines[agentLogEnd - 1];
    const newSection: string[] = [];
    if (prevLine !== "" && prevLine !== "## AgentLog") {
      newSection.push("");
    }
    newSection.push(header, meta, buildSessionDivider(entry.sessionId, entry.source), entryLine);
    lines.splice(agentLogEnd, 0, ...newSection);
  } else {
    // Existing project: find end of this subsection
    let subsectionEnd = agentLogEnd;
    for (let i = projectIdx + 1; i < agentLogEnd; i++) {
      if (lines[i].startsWith("#### ")) {
        subsectionEnd = i;
        break;
      }
    }

    const firstContentIdx = projectMetaIdx === -1 ? projectIdx + 1 : projectMetaIdx + 1;
    let insertAt = subsectionEnd;
    while (insertAt > firstContentIdx && lines[insertAt - 1] === "") {
      insertAt--;
    }

    // Determine current session from the last divider in this subsection.
    // Falls back to legacySes (from old metadata format) if no dividers found.
    let currentSes = "";
    for (let i = firstContentIdx; i < subsectionEnd; i++) {
      const m = lines[i].match(dividerRe);
      if (m) currentSes = m[1] ?? m[2];
    }
    if (!currentSes) currentSes = legacySes;

    const sameSession = currentSes === entry.sessionId || currentSes === entry.sessionId.slice(0, 8);

    if (!sameSession) {
      // Session changed: insert divider + entry.
      lines.splice(insertAt, 0, buildSessionDivider(entry.sessionId, entry.source), entryLine);
      // Migrate legacy metadata format to new format (remove ses=).
      if (projectMetaIdx !== -1 && lines[projectMetaIdx].match(legacyMetaRe)) {
        lines[projectMetaIdx] = buildProjectMetadata(entry.cwd);
      } else if (projectMetaIdx === -1) {
        // Legacy inline header → migrate to split format
        lines[projectIdx] = buildProjectHeader(entry.project, existingTime);
        lines.splice(projectIdx + 1, 0, buildProjectMetadata(entry.cwd));
      }
    } else {
      lines.splice(insertAt, 0, entryLine);
    }
  }

  // 5. Update > 🕐 latest line
  // Note: latestLineIdx is always before insertAt, so it's unaffected by the splice above.
  if (latestLineIdx !== -1) {
    lines[latestLineIdx] = latestLine;
  } else {
    // Insert after ## AgentLog
    if (lines[agentLogIdx + 1] === "") {
      lines.splice(agentLogIdx + 1, 0, latestLine);
    } else {
      lines.splice(agentLogIdx + 1, 0, latestLine, "");
    }
  }

  return lines.join("\n");
}

/** Plain mode: simple append without session grouping. */
function appendPlain(filePath: string, entry: LogEntry, date: Date): WriteResult {
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
