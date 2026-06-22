#!/usr/bin/env bun

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { spawn } from "bun";
import { homedir } from "os";
import { dirname, join, resolve } from "path";

interface Result {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface Args {
  vault?: string;
  profiles: string[];
  allProfiles: boolean;
  skipLink: boolean;
  appendFixture: boolean;
}

async function run(cmd: string[], cwd = process.cwd()): Promise<Result> {
  const proc = spawn(cmd, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

function assertOk(result: Result, label: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    profiles: [],
    allProfiles: false,
    skipLink: false,
    appendFixture: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--vault") args.vault = argv[++i];
    else if (arg === "--profile") args.profiles.push(argv[++i]);
    else if (arg === "--all-profiles") args.allProfiles = true;
    else if (arg === "--skip-link") args.skipLink = true;
    else if (arg === "--append-fixture") args.appendFixture = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.profiles.length > 0 && args.allProfiles) {
    throw new Error("Choose either --profile or --all-profiles");
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage: bun run scripts/end-user-hermes-host-smoke.ts [--vault ~/Obsidian] [--profile name...] [--all-profiles] [--skip-link] [--append-fixture]

Mutates the real user environment:
  1. optionally links this checkout as the global agentlog command
  2. runs agentlog init --hermes against the real vault
  3. verifies agentlog doctor
  4. approves the hook in Hermes shell-hooks-allowlist.json
  5. verifies Hermes sees the installed hook and hooks doctor is healthy

--append-fixture also invokes agentlog hook --source hermes with the test fixture and writes one real Daily Note entry.
`);
}

function defaultVault(): string {
  const configPath = process.env.AGENTLOG_CONFIG_DIR
    ? join(process.env.AGENTLOG_CONFIG_DIR, "config.json")
    : join(homedir(), ".agentlog", "config.json");

  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as { vault?: string };
    if (config.vault) return config.vault;
  }
  return join(homedir(), "Obsidian");
}

function hookCommandPresent(output: string): boolean {
  return output.includes("agentlog hook --source hermes");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function hermesHookCommand(agentlogPath: string): string {
  return `${shellQuote(agentlogPath)} hook --source hermes`;
}

function hermesHomes(args: Args): string[] {
  const root = join(homedir(), ".hermes");
  if (args.allProfiles) {
    const homes = [root];
    const profilesRoot = join(root, "profiles");
    if (existsSync(profilesRoot)) {
      for (const name of readdirSync(profilesRoot).sort()) {
        const profileHome = join(profilesRoot, name);
        if (existsSync(join(profileHome, "config.yaml"))) homes.push(profileHome);
      }
    }
    return homes;
  }
  if (args.profiles.length > 0) {
    return args.profiles.map((profile) => join(root, "profiles", profile));
  }
  return [root];
}

function approveHermesHook(args: Args, command: string, agentlogPath: string): void {
  const approval = {
    event: "pre_llm_call",
    command,
    approved_at: new Date().toISOString().replace("+00:00", "Z"),
    script_mtime_at_approval: statSync(agentlogPath).mtime.toISOString().replace("+00:00", "Z"),
  };

  for (const home of hermesHomes(args)) {
    const allowlistPath = join(home, "shell-hooks-allowlist.json");
    let data: { approvals: unknown[] } = { approvals: [] };
    if (existsSync(allowlistPath)) {
      const parsed = JSON.parse(readFileSync(allowlistPath, "utf-8")) as { approvals?: unknown[] };
      data = { approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [] };
    }
    data.approvals = data.approvals.filter((entry) => {
      return !(typeof entry === "object" && entry !== null
        && "event" in entry
        && "command" in entry
        && (entry as { event?: unknown; command?: unknown }).event === approval.event
        && (entry as { event?: unknown; command?: unknown }).command === approval.command);
    });
    data.approvals.push(approval);
    mkdirSync(dirname(allowlistPath), { recursive: true });
    writeFileSync(allowlistPath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`approved Hermes hook: ${allowlistPath}`);
  }
}

async function main(): Promise<void> {
  const repoRoot = resolve(join(import.meta.dir, ".."));
  const args = parseArgs(Bun.argv.slice(2));
  const vault = resolve(args.vault ?? defaultVault());

  if (!existsSync(vault)) {
    throw new Error(`Vault not found: ${vault}`);
  }

  if (!args.skipLink) {
    const linked = await run([process.execPath, "link"], repoRoot);
    assertOk(linked, "bun link");
  }

  const resolved = await run(["/bin/sh", "-lc", "command -v agentlog"]);
  assertOk(resolved, "resolve agentlog");
  const agentlogPath = resolved.stdout.trim();
  console.log(`agentlog: ${agentlogPath}`);

  const version = await run(["agentlog", "version"]);
  assertOk(version, "agentlog version");
  console.log(version.stdout.trim());

  const initArgs = ["agentlog", "init", "--hermes"];
  for (const profile of args.profiles) initArgs.push("--hermes-profile", profile);
  if (args.allProfiles) initArgs.push("--hermes-all-profiles");
  initArgs.push(vault);

  const installed = await run(initArgs);
  assertOk(installed, initArgs.join(" "));
  console.log(installed.stdout.trim());

  const doctor = await run(["agentlog", "doctor"]);
  assertOk(doctor, "agentlog doctor");
  if (!doctor.stdout.includes("✅ hermes")) {
    throw new Error(`doctor did not report Hermes success\n${doctor.stdout}`);
  }
  console.log("agentlog doctor: hermes ok");

  const hermesListArgs = args.profiles.length === 1
    ? ["hermes", "-p", args.profiles[0], "hooks", "list"]
    : ["hermes", "hooks", "list"];
  const hooks = await run(hermesListArgs);
  assertOk(hooks, hermesListArgs.join(" "));
  if (!hookCommandPresent(hooks.stdout + hooks.stderr)) {
    throw new Error(`Hermes hook list did not include AgentLog command\nstdout:\n${hooks.stdout}\nstderr:\n${hooks.stderr}`);
  }
  console.log(hooks.stdout.trim());

  approveHermesHook(args, hermesHookCommand(agentlogPath), agentlogPath);

  const doctorArgs = args.profiles.length === 1
    ? ["hermes", "-p", args.profiles[0], "hooks", "doctor"]
    : ["hermes", "hooks", "doctor"];
  const hermesDoctor = await run(doctorArgs);
  assertOk(hermesDoctor, doctorArgs.join(" "));
  if (!hermesDoctor.stdout.includes("All shell hooks look healthy.")) {
    throw new Error(`Hermes hooks doctor did not report healthy hooks\nstdout:\n${hermesDoctor.stdout}\nstderr:\n${hermesDoctor.stderr}`);
  }
  console.log("hermes hooks doctor: healthy");

  if (args.appendFixture) {
    const fixturePath = join(repoRoot, "src", "__tests__", "fixtures", "hermes-pre-llm-call.json");
    const appended = Bun.spawn(["agentlog", "hook", "--source", "hermes"], {
      cwd: repoRoot,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    appended.stdin.write(readFileSync(fixturePath));
    appended.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(appended.stdout).text(),
      new Response(appended.stderr).text(),
      appended.exited,
    ]);
    assertOk({ stdout, stderr, exitCode }, "agentlog hook --source hermes fixture");
    console.log("fixture append: ok");
  }
}

await main();
