/** AgentLog core types */

/** Config stored at ~/.agentlog/config.json */
export interface AgentLogConfig {
  vault: string;
  plain?: boolean;
  codexNotifyRestore?: string[] | null;
}

export type Source = "claude" | "codex";

/** A single log entry to be written into a Daily Note */
export interface LogEntry {
  time: string;     // "HH:MM"
  prompt: string;   // sanitized by prettyPrompt()
  sessionId: string; // from hook session_id
  project: string;  // derived from cwd: parent/basename
  cwd: string;      // full cwd path, used as section matching key
  source: Source;
}

/** Result of writing a log entry */
export interface WriteResult {
  filePath: string;
  created: boolean; // true if new file was created
  section: "agentlog" | "plain";
}
