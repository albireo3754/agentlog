import { existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

export type AgentlogChannel = "dev" | "prod";

export type RuntimeInfo = {
  version: string | null;
  channel: AgentlogChannel;
  commit: string | null;
  packageRoot: string;
};

type RuntimeInfoOptions = {
  env?: Record<string, string | undefined>;
  packageRoot?: string;
  moduleDir?: string;
};

function currentModuleDir(): string {
  return typeof import.meta.dir === "string"
    ? import.meta.dir
    : dirname(fileURLToPath(import.meta.url));
}

export function resolvePackageRoot(moduleDir: string = currentModuleDir()): string {
  return resolve(moduleDir, "..");
}

function hasGitMetadata(startDir: string): boolean {
  let currentDir = startDir;

  while (true) {
    if (existsSync(join(currentDir, ".git"))) return true;

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return false;
    currentDir = parentDir;
  }
}

export function readVersion(packageRoot: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as {
      version?: string;
    };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

export function detectPhase({
  env = process.env,
  packageRoot = resolvePackageRoot(),
}: RuntimeInfoOptions = {}): AgentlogChannel {
  const override = env.AGENTLOG_PHASE?.trim().toLowerCase();
  if (override === "dev" || override === "prod") return override;
  return hasGitMetadata(packageRoot) ? "dev" : "prod";
}

function readCommit(packageRoot: string, channel: AgentlogChannel): string | null {
  if (channel !== "dev") return null;

  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: packageRoot,
    encoding: "utf-8",
    timeout: 3000,
  });

  if (git.status !== 0) return null;
  const commit = git.stdout.trim();
  return commit.length > 0 ? commit : null;
}

export function getRuntimeInfo(options: RuntimeInfoOptions = {}): RuntimeInfo {
  const env = options.env ?? process.env;
  const packageRoot = options.packageRoot ?? resolvePackageRoot(options.moduleDir);
  const gitBacked = hasGitMetadata(packageRoot);
  const override = env.AGENTLOG_PHASE?.trim().toLowerCase();
  const channel: AgentlogChannel =
    override === "dev" || override === "prod" ? override : gitBacked ? "dev" : "prod";

  return {
    version: readVersion(packageRoot),
    channel,
    commit: channel === "dev" && gitBacked ? readCommit(packageRoot, channel) : null,
    packageRoot,
  };
}

export function formatVersionHeadline(info: Pick<RuntimeInfo, "version">): string {
  return `AgentLog ${info.version ?? "unknown"}`;
}

export function formatVersionOutput(info: RuntimeInfo): string {
  const lines = [formatVersionHeadline(info)];

  if (info.channel === "dev") {
    lines.push("channel: dev");
    if (info.commit) lines.push(`commit: ${info.commit}`);
  }

  return lines.join("\n");
}
