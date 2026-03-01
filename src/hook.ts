/**
 * AgentLog hook entry point.
 *
 * Invoked by Claude Code UserPromptSubmit hook via stdin JSON.
 * Reads prompt, determines Daily Note path, delegates to note-writer.
 *
 * Design: fail silently — never interrupt Claude Code.
 */

import { loadConfig } from "./config.js";
import { parseHookInput } from "./schema/hook-input.js";
import { appendEntry } from "./note-writer.js";

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
  // 1. Load config — if absent, hint and exit (not initialized)
  const config = loadConfig();
  if (!config) {
    process.stderr.write("[agentlog] not initialized. Run: agentlog init ~/path/to/vault\n");
    return;
  }

  // 2. Read stdin (cross-runtime: works with both Bun and Node.js)
  const raw = await readStdin();

  // 3. Parse hook input
  let parsed;
  try {
    parsed = parseHookInput(raw);
  } catch (err) {
    process.stderr.write(`[agentlog] parse error: ${err}\n`);
    return;
  }

  // 4. Build time string
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;

  // 5. Append entry to Daily Note
  const entry = {
    time,
    prompt: parsed.prompt.slice(0, 100),
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
