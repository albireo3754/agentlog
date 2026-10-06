import { beforeEach, afterEach, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { installGitSync } from "../git-sync-install.js";
import { appendEntry } from "../note-writer.js";
import { splitEvents, mergeNotes } from "../event-merge.js";
import { replayJournal } from "../event-journal.js";
let root: string, a: string, b: string, prior: string | undefined;
const date = new Date(2026, 9, 7, 12);
const filename = "2026-10-07.md";
const entry = { time: "12:00", prompt: "same prompt", sessionId: "session-1", project: "test", cwd: "/test", source: "codex" as const };
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function setup(cwd: string) {
  git(cwd, "config", "user.name", "Test"); git(cwd, "config", "user.email", "test@example.com");
  installGitSync(cwd);
}
function commit(cwd: string) { git(cwd, "add", "."); git(cwd, "commit", "-qm", "records"); }
function record(cwd: string, text: string) { appendEntry({ vault: cwd, plain: true, gitSync: true }, { ...entry, prompt: text }, date); }
function contents(cwd: string) { return readFileSync(join(cwd, filename), "utf8"); }
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentlog-git-"));
  prior = process.env.AGENTLOG_CONFIG_DIR;
  process.env.AGENTLOG_CONFIG_DIR = join(root, "local-state");
  const remote = join(root, "remote.git");
  mkdirSync(remote); git(remote, "init", "--bare", "-q", "--initial-branch=main");
  a = join(root, "device a"); b = join(root, "device'b");
  git(root, "clone", "-q", remote, a); setup(a);
  writeFileSync(join(a, "README.md"), "initial\n"); commit(a); git(a, "push", "-q", "origin", "main");
  git(root, "clone", "-q", remote, b); setup(b);
});
afterEach(() => {
  if (prior === undefined) delete process.env.AGENTLOG_CONFIG_DIR; else process.env.AGENTLOG_CONFIG_DIR = prior;
  rmSync(root, { recursive: true, force: true });
});
it("merges independent creation of one daily note and converges across repeated sync", () => {
  record(a, "A first"); record(b, "B first"); commit(a); commit(b);
  git(a, "push", "-q"); git(b, "pull", "--no-rebase", "--no-edit"); git(b, "push", "-q"); git(a, "pull", "--no-rebase", "--no-edit");
  expect(contents(a)).toBe(contents(b));
  expect(splitEvents(contents(a)).events.size).toBe(2);
  record(a, "same prompt"); record(a, "same prompt"); record(b, "same prompt");
  commit(a); commit(b); git(b, "push", "-q"); git(a, "pull", "--no-rebase", "--no-edit"); git(a, "push", "-q"); git(b, "pull", "--no-rebase", "--no-edit");
  expect(contents(a)).toBe(contents(b));
  expect(splitEvents(contents(a)).events.size).toBe(5);
  expect(git(a, "ls-files", "-u")).toBe("");
  expect(git(b, "status", "--porcelain")).toBe("");
});
it("keeps genuine handwritten conflicts and both devices' records", () => {
  writeFileSync(join(a, filename), "# Day\nmanual original\n"); commit(a); git(a, "push", "-q"); git(b, "pull", "--no-rebase");
  writeFileSync(join(a, filename), "# Day\nmanual A\n"); record(a, "record A");
  writeFileSync(join(b, filename), "# Day\nmanual B\n"); record(b, "record B"); commit(a); commit(b); git(a, "push", "-q");
  expect(() => git(b, "pull", "--no-rebase", "--no-edit")).toThrow();
  expect(contents(b)).toContain("<<<<<<<");
  expect(contents(b)).toContain("manual A"); expect(contents(b)).toContain("manual B");
  expect(splitEvents(contents(b)).events.size).toBe(2);
  record(b, "during conflict");
  expect(splitEvents(contents(b)).events.size).toBe(3);
});
it("continues recording during Git operation markers", () => {
  for (const marker of ["MERGE_HEAD", "index.lock", "CHERRY_PICK_HEAD"]) {
    const path = join(a, ".git", marker); writeFileSync(path, "pending");
    record(a, marker); rmSync(path);
  }
  expect(splitEvents(contents(a)).events.size).toBe(3);
});
it("restores local events through post-merge replay after checkout replacement", () => {
  writeFileSync(join(a, filename), "# Day\n"); commit(a); git(a, "push", "-q"); git(b, "pull", "--no-rebase");
  record(a, "captured before replacement"); git(a, "restore", filename);
  record(b, "remote"); commit(b); git(b, "push", "-q"); git(a, "pull", "--no-rebase", "--no-edit");
  expect(splitEvents(contents(a)).events.size).toBe(2);
  expect(replayJournal(a).inserted).toBe(0);
});
it("preserves data and reports conflict if the receiving device lacks a driver", () => {
  record(a, "A"); record(b, "B"); commit(a); commit(b); git(a, "push", "-q");
  git(b, "config", "--remove-section", "merge.agentlog");
  expect(() => git(b, "pull", "--no-rebase", "--no-edit")).toThrow();
  expect(contents(b)).toContain("- 12:00 A"); expect(contents(b)).toContain("- 12:00 B");
});
it("refuses silent resolution of edited immutable blocks", () => {
  record(a, "original"); const content = contents(a);
  const result = mergeNotes(content, content.replace("- 12:00 original", "- 12:00 edited"), content);
  expect(result.clean).toBe(false); expect(result.content).toContain("original"); expect(result.content).toContain("edited");
});
it("does not recreate a deleted or archived daily note during replay", () => {
  record(a, "historical"); rmSync(join(a, filename));
  expect(replayJournal(a).missing).toBe(1); expect(existsSync(join(a, filename))).toBe(false);
});
it("preserves existing hooks and attribute rules and installs idempotently", () => {
  installGitSync(a); installGitSync(a);
  expect(readFileSync(join(a, ".gitattributes"), "utf8").match(/merge=agentlog/g)?.length).toBe(1);
  const hook = join(a, ".git/hooks/post-merge"); writeFileSync(hook, "#!/bin/sh\nexit 3\n");
  expect(() => installGitSync(a)).toThrow("Existing post-merge hook preserved");
  expect(readFileSync(hook, "utf8")).toBe("#!/bin/sh\nexit 3\n");
  writeFileSync(join(a, ".gitattributes"), "special.md merge=custom\n");
  installGitSync(a, false);
  expect(git(a, "check-attr", "merge", "special.md")).toContain("custom");
});
it("captures concurrent processes without overwrites or duplicate materialization", async () => {
  const script = join(root, "writer.ts");
  writeFileSync(script, `import { appendEntry } from ${JSON.stringify(resolve("src/note-writer.ts"))}; appendEntry({vault: process.argv[2], plain:true, gitSync:true}, ${JSON.stringify(entry)}, new Date(2026,9,7,12));`);
  const children = Array.from({ length: 12 }, () => Bun.spawn([process.execPath, script, a], { env: process.env, stdout: "pipe", stderr: "pipe" }));
  const codes = await Promise.all(children.map(child => child.exited));
  expect(codes).toEqual(Array(12).fill(0));
  expect(splitEvents(contents(a)).events.size).toBe(12);
  expect(replayJournal(a).inserted).toBe(0);
});
it("uninstalls only its integration and retains the original journal", async () => {
  const { uninstallGitSync } = await import("../git-sync-install.js");
  record(a, "kept");
  writeFileSync(join(a, ".gitattributes"), readFileSync(join(a, ".gitattributes"), "utf8") + "other.md merge=custom\n");
  uninstallGitSync(a);
  expect(readFileSync(join(a, ".gitattributes"), "utf8")).toBe("other.md merge=custom\n");
  expect(existsSync(join(a, ".git/hooks/post-merge"))).toBe(false);
  writeFileSync(join(a, filename), "# Day\n");
  expect(replayJournal(a).inserted).toBe(1);
  uninstallGitSync(a);
});
it("installs and merges in linked worktrees with a .git file", () => {
  const wt = join(root, "worktree");
  git(a, "worktree", "add", "-qb", "linked", wt);
  setup(wt);
  record(a, "main event"); commit(a);
  record(wt, "worktree event"); commit(wt);
  git(wt, "merge", "--no-edit", "main");
  expect(splitEvents(contents(wt)).events.size).toBe(2);
});
it("replay hooks shared with a linked worktree recover the checkout being merged", () => {
  writeFileSync(join(a, filename), "# Day\n"); commit(a);
  const wt = join(root, "linked replay");
  git(a, "worktree", "add", "-qb", "replay-branch", wt); setup(wt);
  record(a, "local pending"); git(a, "restore", filename);
  record(wt, "remote event"); commit(wt);
  git(a, "merge", "--no-edit", "replay-branch");
  expect(splitEvents(contents(a)).events.size).toBe(2);
});
it("does not enable a driver shadowed by existing broad merge attributes", () => {
  const attributes = join(b, ".gitattributes");
  writeFileSync(attributes, "*.md merge=union\n");
  expect(() => installGitSync(b)).toThrow("effective merge attribute");
  expect(readFileSync(attributes, "utf8")).toBe("*.md merge=union\n");
});
it("checks the actual Daily Note's specific merge attribute", () => {
  const attributes = join(b, ".gitattributes");
  writeFileSync(attributes, "2026-10-07.md merge=union\n");
  expect(() => installGitSync(b, true, join(b, filename))).toThrow("effective merge attribute");
});
