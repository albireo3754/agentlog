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
export const TIME_BLOCKS: Array<[number, number]> = [
  [8, 10],
  [10, 12],
  [12, 13],
  [13, 15],
  [15, 17],
  [17, 19],
  [19, 21],
  [21, 23],
];

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
 * Format: "  - HH:MM prompt text (max 100 chars)"
 */
export function buildLogLine(time: string, prompt: string): string {
  const truncated = prompt.slice(0, 100);
  return `  - ${time} ${truncated}`;
}
