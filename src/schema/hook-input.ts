/**
 * Hook Input Schema — Source of Truth
 *
 * Claude Code sends this JSON payload via stdin when a UserPromptSubmit hook fires.
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
 * Full UserPromptSubmit hook payload from Claude Code.
 *
 * Required fields: hook_event_name, session_id, cwd
 * Prompt is sourced from `prompt` (preferred) or `message.content` fallback.
 */
export interface HookInput {
  hook_event_name: "UserPromptSubmit";
  session_id: string;
  cwd: string;
  /** Direct prompt text — preferred source */
  prompt?: string;
  /** Nested message object — fallback if prompt is absent */
  message?: HookInputMessage;
  /** Structured content parts — secondary fallback */
  parts?: HookInputPart[];
}

/** Parsed, normalized result after validating hook input */
export interface ParsedHookInput {
  sessionId: string;
  cwd: string;
  prompt: string;
}

/**
 * Parse and validate raw hook stdin JSON.
 *
 * Prompt extraction priority:
 *   1. input.prompt
 *   2. input.message.content
 *   3. input.parts[0].text (first text part)
 *
 * @throws {Error} if JSON is invalid or required fields are missing
 */
export function parseHookInput(raw: string): ParsedHookInput {
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
  };
}
