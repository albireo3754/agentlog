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
import {
  ENGLISHASK_GUARD_ENV,
  appendEnglishAskFeedback,
  buildEnglishAskContext,
  englishAskSuggestion,
  evaluateEnglishAsk,
} from "./english-ask.js";
import type { SourceType } from "./types.js";

function resolveSource(): SourceType {
  const sourceIndex = process.argv.indexOf("--source");
  const source = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "claude";
  return source === "codex" ? "codex" : "claude";
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
  if (process.env[ENGLISHASK_GUARD_ENV] === "1") return;

  const source = resolveSource();

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
    const result = appendEntry(config, entry, now);
    const context = buildEnglishAskContext(result.filePath, {
      ...entry,
      transcriptPath: parsed.transcriptPath,
    });
    const feedback = evaluateEnglishAsk(config, parsed.prompt, parsed.cwd, context);
    if (feedback) {
      try {
        appendEnglishAskFeedback(result.filePath, feedback, entry, config);
        const suggestion = englishAskSuggestion(config, feedback);
        if (suggestion) process.stderr.write(suggestion);
      } catch {
        // EnglishAsk is best-effort; the normal AgentLog entry is already written.
      }
    }
  } catch (err) {
    process.stderr.write(`[agentlog] write error: ${err}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[agentlog] fatal: ${err}\n`);
});
