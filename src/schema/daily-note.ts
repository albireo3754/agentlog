/**
 * Daily Note Schema — Time block detection patterns
 *
 * Defines the Korean Obsidian Daily Note time-block format that agentlog
 * appends log entries into.
 */

/** Korean day names indexed by JS getDay() (0=Sunday) */
export const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** Named time-block periods with their hour ranges and block labels (SOT) */
export const TIMEBLOCK_PERIODS = {
  새벽: { range: "00-08", blocks: ["00 - 02", "02 - 04", "04 - 06", "06 - 08"] },
  오전: { range: "08-13", blocks: ["08 - 09", "09 - 10", "10 - 12", "12 - 13"] },
  오후: { range: "13-17", blocks: ["13 - 15", "15 - 17"] },
  저녁: { range: "17-24", blocks: ["17 - 19", "19 - 21", "21 - 23", "23 - 24"] },
} as const;

/** Time-block hour ranges as [startHour, endHour] pairs */
export const TIME_BLOCKS: Array<[number, number]> = Object.values(
  TIMEBLOCK_PERIODS
).flatMap((period) =>
  period.blocks.map((block) => {
    const [startText, endText] = block.split(" - ");
    return [Number.parseInt(startText, 10), Number.parseInt(endText, 10)] as [
      number,
      number
    ];
  })
);

/**
 * Returns the Daily Note file name for a given date.
 * Format: YYYY-MM-DD-요일.md  (e.g. 2026-03-01-일.md)
 */
export function dailyNoteFileName(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const day = KO_DAYS[date.getDay()];
  return `${yyyy}-${mm}-${dd}-${day}.md`;
}

/**
 * Returns the 2-hour time-block label that contains the given hour.
 * E.g. hour=11 → "10 - 12"
 * Returns null if the hour falls outside all defined blocks.
 */
export function findTimeBlock(hour: number): string | null {
  for (const [start, end] of TIME_BLOCKS) {
    if (hour >= start && hour < end) {
      return `${start} - ${end}`;
    }
  }
  return null;
}

/**
 * Pattern to match an existing time-block checkbox line.
 * Matches: "- [ ] 10 - 12" or "- [x] 10 - 12"
 */
export const TIME_BLOCK_LINE_RE =
  /^(\s*- \[[ x]\] )(\d{1,2} - \d{1,2})(.*)$/m;

/**
 * Build a log line for insertion into a Daily Note.
 * Format: "  - HH:MM prompt text"
 * @deprecated Use buildAgentLogEntry for new ## AgentLog section entries.
 */
export function buildLogLine(time: string, prompt: string): string {
  return `  - ${time} ${prompt}`;
}

/**
 * Derives project display name from cwd.
 * Always returns "parent/basename" (2-level, no special cases).
 * E.g. "/Users/pray/work/js/agentlog" → "js/agentlog"
 *      "/Users/pray/worktrees/v5/gate" → "v5/gate"
 */
export function cwdToProject(cwd: string): string {
  const parts = cwd.replace(/\/$/, "").split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] ?? cwd;
}

/**
 * Entry line within a #### project section.
 * Format: "- HH:MM prompt"
 */
export function buildAgentLogEntry(time: string, prompt: string): string {
  return `- ${time} ${prompt}`;
}

/**
 * Session divider line inserted when session_id changes within a project section.
 * Format: "- - - - (ses_XXXXXXXX)"
 */
export function buildSessionDivider(sessionId: string): string {
  return `- - - - (ses_${sessionId.slice(0, 8)})`;
}

/**
 * Latest entry blockquote pinned at top of ## AgentLog section.
 * Format: "> 🕐 HH:MM — project › prompt"
 */
export function buildLatestLine(time: string, project: string, prompt: string): string {
  return `> 🕐 ${time} — ${project} › ${prompt}`;
}

/**
 * Project subsection header line.
 * Format: "#### project · HH:MM"
 */
export function buildProjectHeader(
  project: string,
  time: string,
): string {
  return `#### ${project} · ${time}`;
}

/**
 * Metadata comment line placed directly below the project header.
 * Stores cwd (matching key) and session short hash for parsing.
 * Format: "<!-- cwd=<path> ses=<sessionShort> -->"
 *
 * Kept on a separate line so the #### heading remains visually clean.
 * HTML comments are hidden in Obsidian reading view.
 */
export function buildProjectMetadata(cwd: string, sessionShort: string): string {
  return `<!-- cwd=${cwd} ses=${sessionShort} -->`;
}
