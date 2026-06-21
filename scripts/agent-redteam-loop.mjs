#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const DEFAULT_STEPS = [
  ["bun", ["test"]],
  ["bun", ["run", "typecheck"]],
  ["node", ["scripts/prd-redteam.mjs", "--output", "docs/plans/2026-06-21-hook-provider-prd-redteam-report.json"]],
];

function run(command, args) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", env: { ...process.env } });
  if (result.error) {
    console.error(result.error.message);
    return false;
  }
  return result.status === 0;
}

for (const [command, args] of DEFAULT_STEPS) {
  if (!run(command, args)) {
    console.error(`\nagent-redteam-loop: failed at ${command} ${args.join(" ")}`);
    process.exit(1);
  }
}

console.log("\nagent-redteam-loop: pass");
