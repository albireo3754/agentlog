/**
 * Daily Note Schema — Time block detection patterns
 *
 * Defines the Korean Obsidian Daily Note time-block format that agentlog
 * appends log entries into.
 */

import type { SourceType } from "../types.js";

/** Korean day names indexed by JS getDay() (0=Sunday) */
export const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

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
 * Uses Obsidian wiki-link format so the session ID becomes a navigable link.
 * Format: "- - - - [[claude_XXXXXXXX]]" or "- - - - [[codex_XXXXXXXX]]"
 */
export function buildSessionDivider(sessionId: string, source: SourceType = "claude"): string {
  return `- - - - [[${source}_${sessionId.slice(0, 8)}]]`;
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
 * Format: "#### HH:MM · project"
 */
export function buildProjectHeader(
  project: string,
  time: string,
): string {
  return `#### ${time} · ${project}`;
}

/**
 * Metadata comment line placed directly below the project header.
 * Stores cwd (matching key) for section identification.
 * Format: "<!-- cwd=<path> -->"
 *
 * Kept on a separate line so the #### heading remains visually clean.
 * HTML comments are hidden in Obsidian reading view.
 * Session tracking is done via - - - - (ses_XXXXXXXX) divider lines in content.
 */
export function buildProjectMetadata(cwd: string): string {
  return `<!-- cwd=${cwd} -->`;
}
