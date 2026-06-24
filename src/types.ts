/** AgentLog core types */

/** Config stored at ~/.agentlog/config.json */
export interface AgentLogConfig {
  vault: string;
  plain?: boolean;
  claudeHookInstalled?: boolean;
  codexHookInstalled?: boolean;
  hermesHookInstalled?: boolean;
  hermesProfiles?: string[];
  /** Legacy metadata for pre-hook Codex notify installs. */
  codexNotifyRestore?: string[] | null;
  englishAsk?: EnglishAskConfig;
}

export interface EnglishAskConfig {
  enabled?: boolean;
  mode?: "log-only" | "suggest";
  threshold?: number;
  timeoutMs?: number;
  maxPromptChars?: number;
  maxContextChars?: number;
  maxOutputChars?: number;
  evaluatorCommand?: string[];
}

export interface EnglishAskFeedback {
  score: number | null;
  prompt: string;
  feedback: string;
}

/** Source of the log entry — which AI tool produced it */
export const SOURCE_TYPES = ["claude", "codex", "hermes"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export function isSourceType(value: string | undefined): value is SourceType {
  return SOURCE_TYPES.includes(value as SourceType);
}

/** A single log entry to be written into a Daily Note */
export interface LogEntry {
  time: string;     // "HH:MM"
  prompt: string;   // sanitized by prettyPrompt()
  sessionId: string; // from hook session_id
  project: string;  // derived from cwd: parent/basename
  cwd: string;      // full cwd path, used as section matching key
  source: SourceType;
}

/** Result of writing a log entry */
export interface WriteResult {
  filePath: string;
  created: boolean; // true if new file was created
  section: "agentlog" | "plain";
}
