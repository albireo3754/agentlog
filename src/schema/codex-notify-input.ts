/**
 * Codex notify payload parsing.
 *
 * Codex invokes the configured notify command with a single JSON argument
 * after supported events (currently agent-turn-complete).
 */

export interface CodexNotifyInput {
  type: string;
  "thread-id"?: string;
  cwd?: string;
  "input-messages"?: string[];
  "turn-id"?: string;
  "last-assistant-message"?: string;
}

export interface ParsedCodexNotifyInput {
  sessionId: string;
  cwd: string;
  prompt: string;
}

export function parseCodexNotifyInput(raw: string): ParsedCodexNotifyInput | null {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON in Codex notify payload");
  }

  if (typeof input !== "object" || input === null) {
    throw new Error("Codex notify input must be a JSON object");
  }

  const obj = input as Record<string, unknown>;

  if (obj["type"] !== "agent-turn-complete") {
    return null;
  }
  if (typeof obj["thread-id"] !== "string" || !obj["thread-id"]) {
    throw new Error("Missing required field: thread-id");
  }
  if (typeof obj["cwd"] !== "string" || !obj["cwd"]) {
    throw new Error("Missing required field: cwd");
  }
  if (!Array.isArray(obj["input-messages"])) {
    throw new Error("Missing required field: input-messages");
  }

  const prompt = [...(obj["input-messages"] as unknown[])]
    .reverse()
    .find((message) => typeof message === "string" && message.trim().length > 0);

  if (typeof prompt !== "string") {
    throw new Error("Field input-messages must contain at least one non-empty string message");
  }

  return {
    sessionId: obj["thread-id"] as string,
    cwd: obj["cwd"] as string,
    prompt,
  };
}
