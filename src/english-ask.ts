import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { StringDecoder } from "string_decoder";
import type { AgentLogConfig, EnglishAskFeedback, SourceType } from "./types.js";

export const ENGLISHASK_GUARD_ENV = "AGENTLOG_ENGLISHASK_EVAL";

const DEFAULT_EVALUATOR_COMMAND = ["codex", "exec", "--ignore-user-config", "--ephemeral", "-"];
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_THRESHOLD = 3;
const DEFAULT_MAX_PROMPT_CHARS = 2_000;
const DEFAULT_MAX_CONTEXT_CHARS = 4_000;
const DEFAULT_MAX_OUTPUT_CHARS = 4_000;
const DEFAULT_CONTEXT_TURNS = 12;

type RawJson = Record<string, unknown>;
type ContextTurn = {
  role: "user" | "assistant";
  text: string;
};

function configured(config: AgentLogConfig): boolean {
  return config.englishAsk?.enabled === true;
}

function looksLikeEnglish(prompt: string): boolean {
  const letters = prompt.match(/[A-Za-z]/g)?.length ?? 0;
  const hangul = /[가-힣]/.test(prompt);
  return letters >= 3 && !hangul;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n[truncated]`;
}

function redact(value: string): string {
  return value
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, "[redacted-api-key]")
    .replace(/(gh[pousr]_[A-Za-z0-9_]{12,})/g, "[redacted-github-token]")
    .replace(/(npm_[A-Za-z0-9]{12,})/g, "[redacted-npm-token]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, "$1[redacted-token]");
}

function parseJsonLine(line: string): RawJson | null {
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? parsed as RawJson : null;
  } catch {
    return null;
  }
}

function* readJsonLines(filePath: string): Generator<RawJson> {
  if (!existsSync(filePath)) return;

  const fd = openSync(filePath, "r");
  const decoder = new StringDecoder("utf-8");
  const buffer = Buffer.alloc(64 * 1024);
  let carry = "";

  try {
    while (true) {
      const bytes = readSync(fd, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      carry += decoder.write(buffer.subarray(0, bytes));

      let newlineIndex = carry.indexOf("\n");
      while (newlineIndex >= 0) {
        const parsed = parseJsonLine(carry.slice(0, newlineIndex));
        if (parsed) yield parsed;
        carry = carry.slice(newlineIndex + 1);
        newlineIndex = carry.indexOf("\n");
      }
    }

    carry += decoder.end();
    const parsed = parseJsonLine(carry);
    if (parsed) yield parsed;
  } finally {
    closeSync(fd);
  }
}

function textFromParts(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const parts = value
    .filter((part): part is RawJson => typeof part === "object" && part !== null)
    .filter((part) =>
      ["text", "input_text", "output_text"].includes(String(part["type"])) &&
      typeof part["text"] === "string"
    )
    .map((part) => part["text"] as string);
  return parts.length > 0 ? parts.join("\n") : null;
}

function compactTurnText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function pushTurn(turns: ContextTurn[], role: ContextTurn["role"], raw: unknown): void {
  const text = typeof raw === "string" ? raw : textFromParts(raw);
  const compact = text ? compactTurnText(text) : "";
  if (!compact) return;
  const last = turns[turns.length - 1];
  if (last?.role === role && last.text === compact) return;
  turns.push({ role, text: compact });
}

function codexTranscriptTurns(line: RawJson): ContextTurn[] {
  const payload = line["payload"];
  if (typeof payload !== "object" || payload === null) return [];
  const p = payload as RawJson;

  if (line["type"] === "event_msg" && p["type"] === "user_message") {
    const message = typeof p["message"] === "string" ? p["message"] : null;
    return message ? [{ role: "user", text: compactTurnText(message) }] : [];
  }
  if (line["type"] === "event_msg" && p["type"] === "agent_message") {
    const message = typeof p["message"] === "string" ? p["message"] : null;
    return message ? [{ role: "assistant", text: compactTurnText(message) }] : [];
  }
  if (line["type"] === "response_item" && p["type"] === "message" && p["role"] === "assistant") {
    const text = textFromParts(p["content"]);
    return text ? [{ role: "assistant", text: compactTurnText(text) }] : [];
  }
  return [];
}

function claudeTranscriptTurns(line: RawJson): ContextTurn[] {
  if (line["isSidechain"] === true) return [];
  if (line["type"] !== "user" && line["type"] !== "assistant") return [];
  const message = line["message"];
  if (typeof message !== "object" || message === null) return [];
  const m = message as RawJson;
  if (m["role"] !== "user" && m["role"] !== "assistant") return [];
  const role = m["role"] as ContextTurn["role"];
  const text = textFromParts(m["content"]);
  return text ? [{ role, text: compactTurnText(text) }] : [];
}

function buildTranscriptContext(transcriptPath: string | undefined, maxTurns = DEFAULT_CONTEXT_TURNS): string | null {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  const turns: ContextTurn[] = [];
  for (const line of readJsonLines(transcriptPath)) {
    for (const turn of [...codexTranscriptTurns(line), ...claudeTranscriptTurns(line)]) {
      pushTurn(turns, turn.role, turn.text);
      if (turns.length > maxTurns) {
        turns.splice(0, turns.length - maxTurns);
      }
    }
  }
  const context = turns
    .map((turn) => `${turn.role}: ${turn.text}`)
    .join("\n")
    .trim();
  return context || null;
}

function buildEvaluatorPrompt(prompt: string, context: string | null): string {
  return `Evaluate this AgentLog user prompt for answerability from prior context, not grammar.

Score rubric:
5: directly answerable
4: answerable with small assumptions
3: missing key target, intent, or constraints
2: unclear requested action
1: impossible without context

Output exactly:
Score: N/5
Natural version: ...
Missing context: ...
Rewrite with: ...

Prior user/model context:
${context || "(none)"}

User prompt:
${prompt}`;
}

function scoreFrom(output: string): number | null {
  const match = output.match(/Score:\s*([1-5])\s*\/\s*5/i);
  return match ? Number(match[1]) : null;
}

function runnableCwd(cwd: string): string {
  try {
    return statSync(cwd).isDirectory() ? cwd : process.cwd();
  } catch {
    return process.cwd();
  }
}

export function shouldEvaluateEnglishAsk(config: AgentLogConfig, prompt: string): boolean {
  if (!configured(config)) return false;
  if (process.env[ENGLISHASK_GUARD_ENV] === "1") return false;
  return looksLikeEnglish(prompt);
}

export function evaluateEnglishAsk(
  config: AgentLogConfig,
  prompt: string,
  cwd: string,
  context: string | null = null
): EnglishAskFeedback | null {
  if (!shouldEvaluateEnglishAsk(config, prompt)) return null;

  const englishAsk = config.englishAsk ?? {};
  const timeoutMs = englishAsk.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPromptChars = englishAsk.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  const maxContextChars = englishAsk.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const maxOutputChars = englishAsk.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const command = englishAsk.evaluatorCommand ?? DEFAULT_EVALUATOR_COMMAND;
  const [bin, ...args] = command;
  if (!bin) return null;

  const sanitizedPrompt = truncate(redact(prompt), maxPromptChars);
  const sanitizedContext = context ? truncate(redact(context), maxContextChars) : null;
  const input = buildEvaluatorPrompt(sanitizedPrompt, sanitizedContext);

  try {
    const result = spawnSync(bin, args, {
      cwd: runnableCwd(cwd),
      input,
      encoding: "utf-8",
      timeout: timeoutMs,
      env: {
        ...process.env,
        [ENGLISHASK_GUARD_ENV]: "1",
      },
    });

    if (result.error || result.status !== 0 || result.signal !== null) {
      return null;
    }

    const raw = result.stdout ?? "";
    const feedback = truncate(redact(raw.trim()), maxOutputChars);
    if (!feedback) return null;

    return {
      score: scoreFrom(feedback),
      feedback,
      prompt: sanitizedPrompt,
    };
  } catch {
    return null;
  }
}

function plainPromptLines(lines: string[]): string[] {
  return lines
    .filter((line) => /^- \d{2}:\d{2} /.test(line))
    .map((line) => line.slice(2));
}

function sessionPromptLines(lines: string[], entry: { sessionId: string; source?: SourceType }): string[] {
  const source = entry.source ?? "codex";
  const divider = `- - - - [[${source}_${entry.sessionId}]]`;
  const start = lines.lastIndexOf(divider);
  if (start === -1) return [];

  const prompts: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("- - - - [[") || line.startsWith("#### ") || /^## [^#]/.test(line)) break;
    if (/^- \d{2}:\d{2} /.test(line)) prompts.push(line.slice(2));
  }
  return prompts;
}

export function buildEnglishAskContext(
  filePath: string,
  entry: { sessionId: string; source?: SourceType; transcriptPath?: string },
  maxLines = 8
): string | null {
  const transcriptContext = buildTranscriptContext(entry.transcriptPath);
  if (transcriptContext) return transcriptContext;

  if (!existsSync(filePath)) return null;
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const prompts = sessionPromptLines(lines, entry);
  const sourceLines = prompts.length > 0 ? prompts : plainPromptLines(lines);
  const context = sourceLines.slice(-maxLines).join("\n").trim();
  return context || null;
}

export function englishAskSuggestion(config: AgentLogConfig, feedback: EnglishAskFeedback): string | null {
  const mode = config.englishAsk?.mode ?? "log-only";
  const threshold = config.englishAsk?.threshold ?? DEFAULT_THRESHOLD;
  if (mode !== "suggest") return null;
  if (feedback.score === null || feedback.score > threshold) return null;
  return `[agentlog] EnglishAsk score ${feedback.score}/5. Rewrite with target/result, relevant context, constraints, and expected output.\n`;
}

function indentFeedback(feedback: string): string {
  return feedback
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function codeFenceFor(feedback: string): string {
  const longestBacktickRun = Math.max(2, ...(feedback.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
}

function listItemValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function insertFeedbackBlock(content: string, block: string): string {
  const sectionMatch = /(^|\n)## EnglishAsk[ \t]*(?:\n|$)/.exec(content);
  if (!sectionMatch) {
    const prefix = content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
    return `${content}${prefix}## EnglishAsk\n\n${block}\n`;
  }

  const bodyStart = sectionMatch.index + sectionMatch[0].length;
  const nextHeading = /(^|\n)## /.exec(content.slice(bodyStart));
  const insertAt = nextHeading ? bodyStart + nextHeading.index : content.length;
  const before = content.slice(0, insertAt);
  const after = content.slice(insertAt);
  const prefix = before.endsWith("\n") ? "\n" : "\n\n";

  return `${before}${prefix}${block}\n${after}`;
}

export function appendEnglishAskFeedback(
  filePath: string,
  feedback: EnglishAskFeedback,
  entry: { time: string; project: string; cwd: string; sessionId: string; source?: SourceType },
  config: AgentLogConfig
): void {
  const mode = config.englishAsk?.mode ?? "log-only";
  const threshold = config.englishAsk?.threshold ?? DEFAULT_THRESHOLD;
  const scoreText = feedback.score === null ? "unknown" : `${feedback.score}/5`;
  const rewriteHint = mode === "suggest" && feedback.score !== null && feedback.score <= threshold
    ? "- action: rewrite suggested before next question"
    : "";
  const fence = codeFenceFor(feedback.feedback);
  const block = [
    `### ${entry.time} · ${entry.project}`,
    `<!-- cwd=${entry.cwd} -->`,
    `- session: [[${entry.source ?? "codex"}_${entry.sessionId}]]`,
    `- score: ${scoreText}`,
    `- prompt: ${listItemValue(feedback.prompt)}`,
    `${rewriteHint}`,
    `${fence}text`,
    indentFeedback(feedback.feedback),
    fence,
  ].filter(Boolean).join("\n");

  const content = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const next = insertFeedbackBlock(content, block);
  writeFileSync(filePath, next, "utf-8");
}
