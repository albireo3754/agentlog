import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import type { AgentLogConfig, EnglishAskFeedback } from "./types.js";

export const ENGLISHASK_GUARD_ENV = "AGENTLOG_ENGLISHASK_EVAL";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_THRESHOLD = 3;
const DEFAULT_MAX_PROMPT_CHARS = 2_000;
const DEFAULT_MAX_OUTPUT_CHARS = 4_000;

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

function buildEvaluatorPrompt(prompt: string): string {
  return `Evaluate this Codex user prompt for answerability from prior context, not grammar.

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

export function evaluateEnglishAsk(config: AgentLogConfig, prompt: string, cwd: string): EnglishAskFeedback | null {
  if (!shouldEvaluateEnglishAsk(config, prompt)) return null;

  const englishAsk = config.englishAsk ?? {};
  const timeoutMs = englishAsk.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPromptChars = englishAsk.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  const maxOutputChars = englishAsk.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const command = englishAsk.evaluatorCommand ?? ["codex", "exec", "-"];
  const [bin, ...args] = command;
  if (!bin) return null;

  const sanitizedPrompt = truncate(redact(prompt), maxPromptChars);
  const input = buildEvaluatorPrompt(sanitizedPrompt);

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
  const nextHeading = /\n## /.exec(content.slice(bodyStart));
  const insertAt = nextHeading ? bodyStart + nextHeading.index : content.length;
  const before = content.slice(0, insertAt);
  const after = content.slice(insertAt);
  const prefix = before.endsWith("\n") ? "\n" : "\n\n";

  return `${before}${prefix}${block}\n${after}`;
}

export function appendEnglishAskFeedback(
  filePath: string,
  feedback: EnglishAskFeedback,
  entry: { time: string; project: string; cwd: string; sessionId: string },
  config: AgentLogConfig
): void {
  const mode = config.englishAsk?.mode ?? "log-only";
  const threshold = config.englishAsk?.threshold ?? DEFAULT_THRESHOLD;
  const scoreText = feedback.score === null ? "unknown" : `${feedback.score}/5`;
  const rewriteHint = mode === "suggest" && feedback.score !== null && feedback.score <= threshold
    ? "- action: rewrite suggested before next question"
    : "";
  const block = [
    `### ${entry.time} · ${entry.project}`,
    `<!-- cwd=${entry.cwd} -->`,
    `- session: [[codex_${entry.sessionId.slice(0, 8)}]]`,
    `- score: ${scoreText}`,
    `- prompt: ${listItemValue(feedback.prompt)}`,
    `${rewriteHint}`,
    "```text",
    indentFeedback(feedback.feedback),
    "```",
  ].filter(Boolean).join("\n");

  const content = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const next = insertFeedbackBlock(content, block);
  writeFileSync(filePath, next, "utf-8");
}
