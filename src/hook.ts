/**
 * AgentLog hook entry point.
 *
 * Invoked by Claude Code or Codex UserPromptSubmit hook via stdin JSON.
 * Reads prompt, determines Daily Note path, delegates to note-writer.
 *
 * Design: fail silently — never interrupt the host agent (Claude Code or Codex).
 */

import { loadConfig } from "./config.js";
import { parseHookInput } from "./schema/hook-input.js";
import { cwdToProject } from "./schema/daily-note.js";
import { prettyPrompt } from "./schema/pretty-prompt.js";
import { appendEntry } from "./note-writer.js";
import { isSourceType, type SourceType } from "./types.js";

function resolveSource(): SourceType {
  const sourceIndex = process.argv.indexOf("--source");
  if (sourceIndex < 0) return "claude";
  const source = process.argv[sourceIndex + 1];
  if (isSourceType(source)) return source;
  throw new Error(`Unsupported source: ${source ?? ""}`);
}

/** Read all stdin as a string. Works with both Bun and Node.js. */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}

async function main(): Promise<void> {
  let source: SourceType;
  try {
    source = resolveSource();
  } catch (err) {
    process.stderr.write(`[agentlog] source error: ${err}\n`);
    return;
  }

  // 1. Load config — if absent, hint and exit (not initialized)
  const config = loadConfig();
  if (!config) {
    const initHint = source === "codex"
      ? "agentlog init --codex ~/path/to/vault"
      : "agentlog init ~/path/to/vault";
    process.stderr.write(`[agentlog] not initialized. Run: ${initHint}\n`);
    return;
  }

  // 2. Read stdin (cross-runtime: works with both Bun and Node.js)
  const raw = await readStdin();

  // 3. Parse hook input
  let parsed;
  try {
    parsed = parseHookInput(raw, { source });
  } catch (err) {
    process.stderr.write(`[agentlog] parse error: ${err}\n`);
    return;
  }

  // 4. Build time string
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;

  // 5. Sanitize prompt — skip system noise
  const prompt = prettyPrompt(parsed.prompt);
  if (!prompt) return;

  // 6. Append entry to Daily Note
  const entry = {
    time,
    prompt,
    sessionId: parsed.sessionId,
    project: cwdToProject(parsed.cwd),
    cwd: parsed.cwd,
    source,
  };

  try {
    appendEntry(config, entry, now);
  } catch (err) {
    process.stderr.write(`[agentlog] write error: ${err}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[agentlog] fatal: ${err}\n`);
});
