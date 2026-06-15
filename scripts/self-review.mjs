#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

let ROOT = process.cwd();
ROOT = git(["rev-parse", "--show-toplevel"]).trim();
const DEFAULT_RULES = "docs/review/review-list.json";
const DEFAULT_HISTORY = "docs/review/history.jsonl";

function parseArgs(argv) {
  const args = {
    mode: "branch",
    base: null,
    head: "HEAD",
    rules: DEFAULT_RULES,
    history: DEFAULT_HISTORY,
    noHistory: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode") args.mode = argv[++i];
    else if (arg === "--base") args.base = argv[++i];
    else if (arg === "--head") args.head = argv[++i];
    else if (arg === "--rules") args.rules = argv[++i];
    else if (arg === "--history") args.history = argv[++i];
    else if (arg === "--no-history") args.noHistory = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  if (!["branch", "staged", "working"].includes(args.mode)) {
    fail(`Unsupported --mode: ${args.mode}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: bun run self-review -- [--mode branch|staged|working] [--base origin/develop] [--head HEAD]

Modes:
  branch   Review base...HEAD (default)
  staged   Review staged changes
  working  Review unstaged tracked changes
`);
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: ROOT ?? process.cwd(),
    encoding: "utf-8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
}

function fail(message) {
  console.error(`[self-review] ${message}`);
  process.exit(2);
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf-8"));
}

function defaultBase() {
  for (const ref of ["origin/develop", "develop", "origin/main", "main"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", ref]);
      return ref;
    } catch {
      // Try the next conventional base ref.
    }
  }
  return "HEAD~1";
}

function diffArgs(args) {
  if (args.mode === "staged") return ["diff", "--cached"];
  if (args.mode === "working") return ["diff"];
  const base = args.base ?? defaultBase();
  return ["diff", `${base}...${args.head}`];
}

function changedFiles(args) {
  const output = git([...diffArgs(args), "--name-only"]);
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

function diffText(args) {
  return git(diffArgs(args));
}

function fileContent(path, context) {
  if (context.contentRef) {
    try {
      return git(["show", `${context.contentRef}:${path}`]);
    } catch {
      return "";
    }
  }
  const abs = resolve(ROOT, path);
  if (!existsSync(abs)) return "";
  return readFileSync(abs, "utf-8");
}

function globToRegex(pattern) {
  const escaped = pattern
    .replace(/\*\*\//g, "__GLOBSTAR_SLASH__")
    .replace(/\*\*/g, "__GLOBSTAR__")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/__GLOBSTAR_SLASH__/g, "(?:.*/)?")
    .replace(/__GLOBSTAR__/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAnyPath(file, patterns = []) {
  return patterns.some((pattern) => globToRegex(pattern).test(file));
}

function relevantFiles(files, patterns = []) {
  return files.filter((file) => matchesAnyPath(file, patterns));
}

function ruleApplies(rule, context) {
  const applies = rule.appliesTo ?? {};
  const byPath = !applies.paths?.length || context.files.some((file) => matchesAnyPath(file, applies.paths));
  const byDiff = !applies.diffIncludesAny?.length || applies.diffIncludesAny.some((needle) => context.diff.includes(needle));
  return byPath && byDiff;
}

function checkRule(rule, check, context) {
  const regex = new RegExp(check.pattern, "m");
  const files = check.paths?.length ? relevantFiles(context.allKnownFiles, check.paths) : context.files;
  const joinedContent = files.map((file) => `\n--- ${file} ---\n${fileContent(file, context)}`).join("\n");

  if (check.type === "anyContentRegex") {
    return regex.test(joinedContent);
  }
  if (check.type === "noneContentRegex") {
    return !regex.test(joinedContent);
  }
  if (check.type === "changedPathRegex") {
    return context.files.some((file) => regex.test(file));
  }
  if (check.type === "diffRegex") {
    return regex.test(context.diff);
  }
  fail(`Unsupported check type in ${rule.id}: ${check.type}`);
}

function listKnownFiles(files, contentRef) {
  if (contentRef) {
    const trackedAtRef = git(["ls-tree", "-r", "--name-only", contentRef])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return Array.from(new Set([...trackedAtRef, ...files]));
  }
  const tracked = git(["ls-files"]).split("\n").map((line) => line.trim()).filter(Boolean);
  return Array.from(new Set([...tracked, ...files])).filter((file) => existsSync(resolve(ROOT, file)));
}

function runReview(args) {
  const config = readJson(args.rules);
  const files = changedFiles(args);
  const diff = diffText(args);
  const context = {
    mode: args.mode,
    base: args.base ?? (args.mode === "branch" ? defaultBase() : null),
    head: args.mode === "branch" ? args.head : null,
    files,
    diff,
    contentRef: args.mode === "branch" ? args.head : null,
    allKnownFiles: listKnownFiles(files, args.mode === "branch" ? args.head : null),
  };

  const applied = [];
  const findings = [];

  for (const rule of config.rules) {
    if (!ruleApplies(rule, context)) continue;
    const failed = [];
    for (const check of rule.checks ?? []) {
      if (!checkRule(rule, check, context)) {
        failed.push({
          type: check.type,
          pattern: check.pattern,
          message: check.message,
        });
      }
    }
    applied.push({ id: rule.id, severity: rule.severity, title: rule.title, passed: failed.length === 0 });
    for (const check of failed) {
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        title: rule.title,
        message: check.message,
        check,
      });
    }
  }

  const result = {
    timestamp: new Date().toISOString(),
    mode: context.mode,
    base: context.base,
    head: context.head,
    files,
    applied,
    verdict: findings.length === 0 ? "pass" : "fail",
    findings,
  };

  if (!args.noHistory) {
    const historyPath = resolve(ROOT, args.history);
    mkdirSync(dirname(historyPath), { recursive: true });
    appendFileSync(historyPath, `${JSON.stringify(result)}\n`, "utf-8");
  }

  printResult(result, args);
  return result;
}

function printResult(result, args) {
  console.log(`self-review: ${result.verdict}`);
  console.log(`mode: ${result.mode}${result.base ? ` base=${result.base}` : ""}${result.head ? ` head=${result.head}` : ""}`);
  console.log(`changed files: ${result.files.length}`);
  console.log(`applied rules: ${result.applied.length}`);
  for (const rule of result.applied) {
    console.log(`- ${rule.passed ? "PASS" : "FAIL"} ${rule.id} (${rule.severity})`);
  }
  if (result.findings.length > 0) {
    console.log("\nfindings:");
    for (const finding of result.findings) {
      console.log(`- [${finding.severity}] ${finding.rule}: ${finding.message}`);
    }
  }
  if (!args.noHistory) {
    console.log(`history: ${args.history}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const result = runReview(args);
process.exit(result.verdict === "pass" ? 0 : 1);
