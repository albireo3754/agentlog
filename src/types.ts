/** AgentLog core types */

/** Config stored at ~/.agentlog/config.json */
export interface AgentLogConfig {
  vault: string;
  plain?: boolean;
  /**
   * Write strategy for Daily Notes:
   * - "auto" (default): try CLI first, fallback to file write
   * - "cli": prefer CLI, fallback to file write on failure
   * - "file": always use direct file write (skip CLI)
   */
  writeMode?: "cli" | "file" | "auto";
}

/** A single log entry to be written into a Daily Note */
export interface LogEntry {
  time: string;   // "HH:MM"
  prompt: string; // first 100 chars of user prompt
}

/** Result of writing a log entry */
export interface WriteResult {
  filePath: string;
  created: boolean; // true if new file was created
  section: "timeblock" | "agentlog" | "plain" | "cli";
}
