import { spawnSync } from "child_process";
import { loadConfig } from "./config.js";
import { appendEntry } from "./note-writer.js";
import { cwdToProject } from "./schema/daily-note.js";
import { parseCodexNotifyInput } from "./schema/codex-notify-input.js";
import { prettyPrompt } from "./schema/pretty-prompt.js";
import { appendEnglishAskFeedback, englishAskSuggestion, evaluateEnglishAsk } from "./english-ask.js";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}

function forwardNotify(raw: string, restore: string[] | null | undefined): void {
  if (!Array.isArray(restore) || restore.length === 0) return;

  const [command, ...args] = restore;
  const result = spawnSync(command, [...args, raw], {
    encoding: "utf-8",
    timeout: 10_000,
  });

  if (result.error || result.status !== 0) {
    process.stderr.write("[agentlog] codex forward notify failed\n");
  }
}

export async function runCodexNotify(rawArg?: string): Promise<void> {
  const config = loadConfig();
  const raw = rawArg ?? await readStdin();

  try {
    if (!config) {
      process.stderr.write("[agentlog] not initialized. Run: agentlog init --codex ~/path/to/vault\n");
      return;
    }

    const parsed = parseCodexNotifyInput(raw);
    if (!parsed) return;

    const prompt = prettyPrompt(parsed.prompt);
    if (!prompt) return;

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");

    const entry = {
      time: `${hh}:${mm}`,
      prompt,
      sessionId: parsed.sessionId,
      project: cwdToProject(parsed.cwd),
      cwd: parsed.cwd,
      source: "codex" as const,
    };

    const result = appendEntry(
      config,
      entry,
      now
    );

    const feedback = evaluateEnglishAsk(config, prompt, parsed.cwd);
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
    process.stderr.write(`[agentlog] codex notify error: ${err}\n`);
  } finally {
    forwardNotify(raw, config?.codexNotifyRestore);
  }
}
