/**
 * prettyPrompt — Sanitize raw hook prompt for Daily Note display.
 *
 * Handles: framework injections (skip), multi-line collapsing,
 * XML/HTML stripping, markdown flattening, and length truncation.
 *
 * Returns null when the prompt should not be logged (system noise).
 */

/** Prompts matching these are system/framework noise — skip entirely. */
const SKIP_PATTERNS: RegExp[] = [
  /^\[Request interrupted/,
  /^<local-command-caveat>/,
  /^<local-command-stdout>/,
  /^<command-name>/,
  /^<command-message>/,
  /^<task-notification>/,
  /^Base directory for this skill:/,
  /^This session is being continued from a previous conversation/,
  /^# \w.+ — /,
  /^Stop hook feedback:/,
  /^\[AUTOPILOT/,
  /^\[RALPH LOOP/,
  /^\[MAGIC KEYWORD/,
];

/**
 * Collapse multi-line text into a summary.
 * - 1-2 lines: join with space
 * - 3+ lines: "first line (+N lines) last line"
 * Empty lines after strip are excluded from count.
 */
function collapseLines(text: string): string {
  const lines = text.split("\n").map((l) => l.replace(/\s{2,}/g, " ").trim()).filter(Boolean);
  if (lines.length <= 2) {
    return lines.join(" ");
  }
  const skipped = lines.length - 2;
  return `${lines[0]} (+${skipped} lines) ${lines[lines.length - 1]}`;
}

/**
 * Sanitize a raw prompt string for single-line Daily Note display.
 * Returns null if the prompt is system noise and should not be logged.
 */
export function prettyPrompt(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Skip system/framework injections
  if (SKIP_PATTERNS.some((p) => p.test(trimmed))) return null;

  // 2. Extract real prompt from AgentLog feedback block
  //    e.g. "## AgentLog\n> 🕐 14:24 — project › actual prompt here"
  const agentLogMatch = trimmed.match(
    /^## AgentLog\n> [^\n]*?[›»]\s*(.+?)(?:\n|$)/m
  );
  if (agentLogMatch) return prettyPrompt(agentLogMatch[1]);

  let text = trimmed;

  // 3. Strip ANSI escape codes and control characters
  text = text.replace(/\x1b\[[0-9;]*m/g, "");
  text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

  // 4. Strip HTML/XML comments (<!-- ... -->)
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // 5. Strip wrapping XML tags (e.g. <system-reminder>...</system-reminder>)
  text = text.replace(/<\/?[\w-]+>/g, "");

  // 6. Strip markdown headings (##, ###, ####)
  text = text.replace(/^#{1,6}\s+/gm, "");

  // 7. Strip blockquote markers
  text = text.replace(/^>\s*/gm, "");

  // 8. Strip code fence markers
  text = text.replace(/^```\w*$/gm, "");

  // 9. Collapse multi-line: first line + (+N lines) + last line
  text = collapseLines(text);

  // 10. Trim again after all transformations
  text = text.trim();

  // 11. Too short after cleanup = noise
  if (text.length < 2) return null;

  return text;
}
