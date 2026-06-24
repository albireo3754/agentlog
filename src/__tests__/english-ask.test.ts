import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ENGLISHASK_GUARD_ENV,
  appendEnglishAskFeedback,
  buildEnglishAskContext,
  englishAskSuggestion,
  evaluateEnglishAsk,
  shouldEvaluateEnglishAsk,
} from "../english-ask.js";
import type { AgentLogConfig, EnglishAskFeedback } from "../types.js";

let tmp: string;

function makeTmp(): string {
  const dir = join(tmpdir(), `agentlog-englishask-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fakeEvaluator(output: string): { command: string[]; inputPath: string } {
  const script = join(tmp, "fake-englishask.sh");
  const inputPath = join(tmp, "evaluator-input.txt");
  writeFileSync(
    script,
    `#!/bin/sh
test "$${ENGLISHASK_GUARD_ENV}" = "1" || exit 7
cat > "$1"
printf '%s' '${output.replace(/'/g, "'\\''")}'
`,
    "utf-8"
  );
  chmodSync(script, 0o755);
  return { command: [script, inputPath], inputPath };
}

describe("EnglishAsk", () => {
  beforeEach(() => {
    tmp = makeTmp();
  });

  afterEach(() => {
    delete process.env[ENGLISHASK_GUARD_ENV];
    rmSync(tmp, { recursive: true, force: true });
  });

  it("is off by default", () => {
    expect(shouldEvaluateEnglishAsk({ vault: tmp }, "What should I do next?")).toBe(false);
  });

  it("skips recursive evaluator notify calls", () => {
    process.env[ENGLISHASK_GUARD_ENV] = "1";
    expect(
      shouldEvaluateEnglishAsk({ vault: tmp, englishAsk: { enabled: true } }, "What should I do next?")
    ).toBe(false);
  });

  it("skips non-English prompts", () => {
    expect(
      shouldEvaluateEnglishAsk({ vault: tmp, englishAsk: { enabled: true } }, "다음에 뭐 할까?")
    ).toBe(false);
  });

  it("runs evaluator with recursion guard and parses score", () => {
    const { command, inputPath } = fakeEvaluator(
      "Score: 3/5\nNatural version: What should I do next?\nMissing context: target\nRewrite with: target/result"
    );
    const config: AgentLogConfig = {
      vault: tmp,
      englishAsk: {
        enabled: true,
        evaluatorCommand: command,
      },
    };

    const result = evaluateEnglishAsk(config, "What should I do next?", tmp);

    expect(result?.score).toBe(3);
    expect(result?.feedback).toContain("Score: 3/5");
    expect(readFileSync(inputPath, "utf-8")).toContain("User prompt:\nWhat should I do next?");
  });

  it("uses a low-overhead Codex exec command by default", () => {
    const binDir = join(tmp, "bin");
    const argsPath = join(tmp, "codex-args.txt");
    const envPath = join(tmp, "codex-env.txt");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(binDir, "codex"),
      `#!/bin/sh
printf '%s\\n' "$@" > "${argsPath}"
printf '%s\\n' "$${ENGLISHASK_GUARD_ENV}" > "${envPath}"
cat >/dev/null
printf 'Score: 5/5\\nNatural version: ok\\nMissing context: none\\nRewrite with: none\\n'
`,
      "utf-8"
    );
    chmodSync(join(binDir, "codex"), 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = `${binDir}:${oldPath ?? ""}`;

    try {
      const result = evaluateEnglishAsk(
        { vault: tmp, englishAsk: { enabled: true } },
        "What should I do next?",
        tmp
      );

      expect(result?.score).toBe(5);
      expect(readFileSync(argsPath, "utf-8")).toBe("exec\n--ignore-user-config\n--ephemeral\n-\n");
      expect(readFileSync(envPath, "utf-8")).toBe("1\n");
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("includes bounded prior context in evaluator input", () => {
    const { command, inputPath } = fakeEvaluator(
      "Score: 4/5\nNatural version: yes\nMissing context: none\nRewrite with: none"
    );

    const result = evaluateEnglishAsk(
      { vault: tmp, englishAsk: { enabled: true, evaluatorCommand: command } },
      "what about this session?",
      tmp,
      "10:01 Please inspect EnglishAsk\n10:02 Turn it on for hook providers"
    );

    const input = readFileSync(inputPath, "utf-8");
    expect(result?.score).toBe(4);
    expect(input).toContain("Prior user/model context:\n10:01 Please inspect EnglishAsk");
    expect(input).toContain("10:02 Turn it on for hook providers");
    expect(input).toContain("User prompt:\nwhat about this session?");
  });

  it("returns null when evaluator fails", () => {
    const script = join(tmp, "fail-englishask.sh");
    writeFileSync(script, "#!/bin/sh\nexit 42\n", "utf-8");
    chmodSync(script, 0o755);

    const result = evaluateEnglishAsk(
      { vault: tmp, englishAsk: { enabled: true, evaluatorCommand: [script] } },
      "What should I do next?",
      tmp
    );

    expect(result).toBeNull();
  });

  it("falls back to the current process cwd when the notify cwd is unavailable", () => {
    const { command, inputPath } = fakeEvaluator(
      "Score: 4/5\nNatural version: ok\nMissing context: none\nRewrite with: none"
    );

    const result = evaluateEnglishAsk(
      { vault: tmp, englishAsk: { enabled: true, evaluatorCommand: command } },
      "What should I do next?",
      join(tmp, "missing-cwd")
    );

    expect(result?.score).toBe(4);
    expect(readFileSync(inputPath, "utf-8")).toContain("User prompt:\nWhat should I do next?");
  });

  it("returns null when evaluator times out", () => {
    const script = join(tmp, "slow-englishask.sh");
    writeFileSync(script, "#!/bin/sh\nsleep 1\n", "utf-8");
    chmodSync(script, 0o755);

    const result = evaluateEnglishAsk(
      { vault: tmp, englishAsk: { enabled: true, evaluatorCommand: [script], timeoutMs: 20 } },
      "What should I do next?",
      tmp
    );

    expect(result).toBeNull();
  });

  it("redacts and truncates prompt before evaluator", () => {
    const { command, inputPath } = fakeEvaluator(
      "Score: 4/5\nNatural version: ok\nMissing context: none\nRewrite with: none"
    );
    const config: AgentLogConfig = {
      vault: tmp,
      englishAsk: {
        enabled: true,
        evaluatorCommand: command,
        maxPromptChars: 40,
      },
    };

    const result = evaluateEnglishAsk(config, "Use sk-abcdefghijklmnopqrstuvwxyz and explain the next action", tmp);

    expect(result?.prompt).toContain("[redacted-api-key]");
    expect(result?.prompt).toContain("[truncated]");
    expect(readFileSync(inputPath, "utf-8")).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });

  it("builds context from the matching source session section", () => {
    const filePath = join(tmp, "2026-03-02.md");
    writeFileSync(
      filePath,
      [
        "## AgentLog",
        "#### 10:00 · js/agentlog",
        "<!-- cwd=/Users/pray/work/js/agentlog -->",
        "- - - - [[codex_session-a]]",
        "- 10:00 Start EnglishAsk work",
        "- 10:01 Add hook support",
        "- - - - [[claude_session-a]]",
        "- 10:02 Different provider should not leak",
        "#### 10:03 · other/project",
        "- 10:03 Other prompt",
        "",
      ].join("\n"),
      "utf-8"
    );

    const context = buildEnglishAskContext(filePath, {
      source: "codex",
      sessionId: "session-a",
    });

    expect(context).toBe("10:00 Start EnglishAsk work\n10:01 Add hook support");
  });

  it("prefers transcript user and assistant turns over Daily Note prompt-only context", () => {
    const notePath = join(tmp, "2026-03-02.md");
    const transcriptPath = join(tmp, "transcript.jsonl");
    writeFileSync(
      notePath,
      [
        "## AgentLog",
        "#### 10:00 · js/agentlog",
        "<!-- cwd=/Users/pray/work/js/agentlog -->",
        "- - - - [[codex_session-a]]",
        "- 10:00 Daily note prompt only",
        "",
      ].join("\n"),
      "utf-8"
    );
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "Turn on EnglishAsk for hooks" },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "agent_message", message: "EnglishAsk now runs from hook.ts" },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "What about followups?" },
        }),
      ].join("\n"),
      "utf-8"
    );

    const context = buildEnglishAskContext(notePath, {
      source: "codex",
      sessionId: "session-a",
      transcriptPath,
    });

    expect(context).toContain("user: Turn on EnglishAsk for hooks");
    expect(context).toContain("assistant: EnglishAsk now runs from hook.ts");
    expect(context).toContain("user: What about followups?");
    expect(context).not.toContain("Daily note prompt only");
  });

  it("appends feedback to an EnglishAsk Daily Note section", () => {
    const filePath = join(tmp, "2026-03-02.md");
    writeFileSync(filePath, "## AgentLog\n- existing\n", "utf-8");
    const feedback: EnglishAskFeedback = {
      score: 3,
      prompt: "What should I do next?",
      feedback: "Score: 3/5\nNatural version: What should I do next?",
    };

    appendEnglishAskFeedback(
      filePath,
      feedback,
      {
        time: "10:53",
        project: "js/agentlog",
        cwd: "/Users/pray/work/js/agentlog",
        sessionId: "abcdef12-3456",
      },
      { vault: tmp, englishAsk: { enabled: true, mode: "log-only" } }
    );

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("## EnglishAsk");
    expect(content).toContain("### 10:53 · js/agentlog");
    expect(content).toContain("- session: [[codex_abcdef12-3456]]");
    expect(content).toContain("- score: 3/5");
    expect(content).toContain("What should I do next?");
  });

  it("keeps stored prompt metadata on one Markdown list line", () => {
    const filePath = join(tmp, "2026-03-02.md");
    const feedback: EnglishAskFeedback = {
      score: 3,
      prompt: "What should I do next?\n[truncated]",
      feedback: "Score: 3/5",
    };

    appendEnglishAskFeedback(
      filePath,
      feedback,
      {
        time: "10:53",
        project: "js/agentlog",
        cwd: "/Users/pray/work/js/agentlog",
        sessionId: "abcdef12-3456",
      },
      { vault: tmp, englishAsk: { enabled: true } }
    );

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("- prompt: What should I do next? [truncated]");
    expect(content).not.toContain("- prompt: What should I do next?\n[truncated]");
  });

  it("inserts new feedback inside an existing EnglishAsk section", () => {
    const filePath = join(tmp, "2026-03-02.md");
    writeFileSync(filePath, "## AgentLog\n- existing\n\n## EnglishAsk\n\n### old\n- score: 5/5\n\n## Other\n- keep\n", "utf-8");
    const feedback: EnglishAskFeedback = {
      score: 2,
      prompt: "Needs section placement",
      feedback: "Score: 2/5",
    };

    appendEnglishAskFeedback(
      filePath,
      feedback,
      {
        time: "10:54",
        project: "js/agentlog",
        cwd: "/Users/pray/work/js/agentlog",
        sessionId: "abcdef12-3456",
      },
      { vault: tmp, englishAsk: { enabled: true } }
    );

    const content = readFileSync(filePath, "utf-8");
    expect(content.indexOf("## EnglishAsk")).toBeLessThan(content.indexOf("Needs section placement"));
    expect(content.indexOf("Needs section placement")).toBeLessThan(content.indexOf("## Other"));
  });

  it("inserts feedback before an immediately following top-level section", () => {
    const filePath = join(tmp, "2026-03-02.md");
    writeFileSync(filePath, "## AgentLog\n- existing\n\n## EnglishAsk\n## Other\n- keep\n", "utf-8");
    const feedback: EnglishAskFeedback = {
      score: 2,
      prompt: "Needs immediate section placement",
      feedback: "Score: 2/5",
    };

    appendEnglishAskFeedback(
      filePath,
      feedback,
      {
        time: "10:54",
        project: "js/agentlog",
        cwd: "/Users/pray/work/js/agentlog",
        sessionId: "abcdef12-3456",
      },
      { vault: tmp, englishAsk: { enabled: true } }
    );

    const content = readFileSync(filePath, "utf-8");
    expect(content.indexOf("## EnglishAsk")).toBeLessThan(content.indexOf("Needs immediate section placement"));
    expect(content.indexOf("Needs immediate section placement")).toBeLessThan(content.indexOf("## Other"));
  });

  it("uses a longer Markdown fence when feedback contains backtick fences", () => {
    const filePath = join(tmp, "2026-03-02.md");
    const feedback: EnglishAskFeedback = {
      score: 2,
      prompt: "Needs fence safety",
      feedback: "Score: 2/5\n```\n## Injected\n```",
    };

    appendEnglishAskFeedback(
      filePath,
      feedback,
      {
        time: "10:54",
        project: "js/agentlog",
        cwd: "/Users/pray/work/js/agentlog",
        sessionId: "abcdef12-3456",
      },
      { vault: tmp, englishAsk: { enabled: true } }
    );

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("````text");
    expect(content).toContain("  ```\n  ## Injected\n  ```");
    expect(content.trimEnd().endsWith("````")).toBe(true);
  });

  it("emits optional rewrite guidance in suggest mode", () => {
    const suggestion = englishAskSuggestion(
      { vault: tmp, englishAsk: { enabled: true, mode: "suggest", threshold: 3 } },
      { score: 3, prompt: "What next?", feedback: "Score: 3/5" }
    );

    expect(suggestion).toContain("EnglishAsk score 3/5");
  });
});
