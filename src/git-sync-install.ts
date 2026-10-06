import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, copyFileSync, unlinkSync, realpathSync } from "fs";
import { dirname, join, resolve, relative } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { digest } from "./event-merge.js";
import { configDir } from "./config.js";

const ATTRIBUTE = "# AgentLog immutable event merge\n*.md merge=agentlog\n";
const HOOK_MARKER = "# AgentLog journal replay v1";
export function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }
function git(vault: string, ...args: string[]): string {
  return execFileSync("git", ["-C", vault, ...args], { encoding: "utf8" }).trim();
}

export function installGitSync(vault: string, replayHook = true, notePath = join(vault, "agentlog-sync-check.md")): { attributes: string; hook: string | null } {
  const noteRelative = relative(resolve(vault), resolve(notePath));
  vault = realpathSync(vault);
  notePath = resolve(vault, noteRelative);
  const root = git(vault, "rev-parse", "--show-toplevel");
  const attributes = join(vault, ".gitattributes");
  const hook = resolve(root, git(vault, "rev-parse", "--git-path", "hooks/post-merge"));
  const original = existsSync(attributes) ? readFileSync(attributes, "utf8") : "";
  const priorHook = existsSync(hook) ? readFileSync(hook, "utf8") : "";
  // Do not replace another tool's hook or assume its language/exit behavior.
  if (replayHook && priorHook && !priorHook.includes(HOOK_MARKER)) {
    throw new Error("Existing post-merge hook preserved. Use --no-replay-hook, then run agentlog git-sync replay after sync.");
  }
  const sourceDriver = fileURLToPath(new URL("./git-sync-driver.ts", import.meta.url));
  const driver = existsSync(sourceDriver) ? sourceDriver : fileURLToPath(new URL("./git-sync-driver.js", import.meta.url));
  const command = `${shellQuote(process.execPath)} ${shellQuote(driver)}`;
  if (!original.includes(ATTRIBUTE)) {
    if (existsSync(attributes)) {
      const backupDir = join(configDir(), "backups");
      mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      copyFileSync(attributes, join(backupDir, `${digest(attributes)}-${Date.now()}.gitattributes`));
    }
    // Existing more-specific rules retain priority. Never replace another merge driver.
    writeFileSync(attributes, ATTRIBUTE + original);
  }
  const effective = git(vault, "check-attr", "-z", "merge", "--", notePath).split("\0")[2];
  if (effective !== "agentlog") {
    if (original) writeFileSync(attributes, original); else if (existsSync(attributes)) unlinkSync(attributes);
    throw new Error(`Daily Note effective merge attribute is ${effective}; existing rules were preserved. Configure this path for merge=agentlog before enabling Git sync.`);
  }
  git(vault, "config", "--local", "merge.agentlog.name", "AgentLog immutable events + handwritten three-way merge");
  git(vault, "config", "--local", "merge.agentlog.driver", `${command} merge %O %A %B`);
  git(vault, "config", "--local", "merge.agentlog.recursive", "binary");
  if (replayHook) {
    mkdirSync(dirname(hook), { recursive: true });
    writeFileSync(hook, `#!/bin/sh\n${HOOK_MARKER}\n# Resolve the current checkout: linked worktrees share hooks.\nagentlog_repo=$(git rev-parse --show-toplevel) || exit 0\nAGENTLOG_CONFIG_DIR=${shellQuote(configDir())} ${command} replay "$agentlog_repo"/${shellQuote(relative(root, vault))} || { echo '[agentlog] journal retained; run agentlog git-sync replay' >&2; }\n`);
    chmodSync(hook, 0o755);
  }
  return { attributes, hook: replayHook ? hook : null };
}

/** Remove only AgentLog-owned integration; the durable journal is intentionally retained. */
export function uninstallGitSync(vault: string): void {
  const root = git(vault, "rev-parse", "--show-toplevel");
  const attributes = join(vault, ".gitattributes");
  if (existsSync(attributes)) {
    const prior = readFileSync(attributes, "utf8");
    const next = prior.replace(ATTRIBUTE, "");
    if (next !== prior) { if (next) writeFileSync(attributes, next); else unlinkSync(attributes); }
  }
  const hook = resolve(root, git(vault, "rev-parse", "--git-path", "hooks/post-merge"));
  if (existsSync(hook) && readFileSync(hook, "utf8").includes(HOOK_MARKER)) unlinkSync(hook);
  // Missing section is already uninstalled.
  try { git(vault, "config", "--local", "--remove-section", "merge.agentlog"); }
  catch (error) { if ((error as { status?: number }).status !== 128) throw error; }
}
