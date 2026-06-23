/**
 * Hook Input Schema — Source of Truth
 *
 * Claude Code and Codex send this JSON payload via stdin when a
 * UserPromptSubmit hook fires.
 * All fields are validated at runtime by parseHookInput().
 */

/** A single content part in the message */
export interface HookInputPart {
  type: "text";
  text: string;
}

/** The message object nested inside hook input */
export interface HookInputMessage {
  content: string;
}

/**
 * Full UserPromptSubmit hook payload.
 *
 * Required fields: hook_event_name, session_id, cwd
 * Codex requires `prompt`. Claude compatibility keeps older fallback shapes.
 */
export interface HookInput {
  hook_event_name: "UserPromptSubmit";
  session_id: string;
  cwd: string;
  /** Path to the session transcript JSONL file */
  transcript_path?: string | null;
  /** Codex/Claude permission mode (e.g. "default", "acceptEdits") */
  permission_mode?: string;
  /** Codex-specific active model slug */
  model?: string;
  /** Codex-specific active turn id */
  turn_id?: string;
  /** Direct prompt text — required for Codex, preferred for Claude */
  prompt?: string;
  /** Claude/backward-compatibility fallback if prompt is absent */
  message?: HookInputMessage;
  /** Claude/backward-compatibility fallback if prompt and message are absent */
  parts?: HookInputPart[];
}

/** Parsed, normalized result after validating hook input */
export interface ParsedHookInput {
  sessionId: string;
  cwd: string;
  prompt: string;
  transcriptPath?: string;
}

export interface ParseHookInputOptions {
  source?: "claude" | "codex";
}

/**
 * Parse and validate raw hook stdin JSON.
 *
 * Codex extraction:
 *   1. input.prompt (required by Codex UserPromptSubmit)
 *
 * Claude/backward-compatibility extraction priority:
 *   1. input.prompt
 *   2. input.message.content
 *   3. input.parts[0].text (first text part)
 *
 * @throws {Error} if JSON is invalid or required fields are missing
 */
export function parseHookInput(raw: string, options: ParseHookInputOptions = {}): ParsedHookInput {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON in hook stdin");
  }

  if (typeof input !== "object" || input === null) {
    throw new Error("Hook input must be a JSON object");
  }

  const obj = input as Record<string, unknown>;

  if (obj["hook_event_name"] !== "UserPromptSubmit") {
    throw new Error("Missing or unsupported hook_event_name: UserPromptSubmit");
  }
  if (typeof obj["session_id"] !== "string" || !obj["session_id"]) {
    throw new Error("Missing required field: session_id");
  }
  if (typeof obj["cwd"] !== "string" || !obj["cwd"]) {
    throw new Error("Missing required field: cwd");
  }

  // Prompt extraction with fallback chain
  let prompt: string | undefined;

  if (typeof obj["prompt"] === "string" && obj["prompt"]) {
    prompt = obj["prompt"];
  } else if (options.source === "codex") {
    throw new Error("Missing required field for Codex UserPromptSubmit: prompt");
  } else if (
    typeof obj["message"] === "object" &&
    obj["message"] !== null &&
    typeof (obj["message"] as Record<string, unknown>)["content"] === "string"
  ) {
    prompt = (obj["message"] as Record<string, unknown>)["content"] as string;
  } else if (Array.isArray(obj["parts"])) {
    const textPart = (obj["parts"] as HookInputPart[]).find(
      (p) => p.type === "text" && typeof p.text === "string"
    );
    if (textPart) prompt = textPart.text;
  }

  if (!prompt) {
    throw new Error(
      "Cannot extract prompt: missing prompt, message.content, or parts[].text"
    );
  }

  return {
    sessionId: obj["session_id"] as string,
    cwd: obj["cwd"] as string,
    prompt,
    transcriptPath: typeof obj["transcript_path"] === "string" && obj["transcript_path"]
      ? obj["transcript_path"]
      : undefined,
  };
}
