#!/usr/bin/env node

// Skip in CI environments
if (process.env.CI) process.exit(0);

// Only print for global installs (npm install -g sets npm_config_global=true)
const isGlobalNpm = process.env.npm_config_global === "true";

if (!isGlobalNpm) process.exit(0);

console.log(`
╔═══════════════════════════════════════════════════════════╗
║  agentlog installed! One more step:                       ║
╚═══════════════════════════════════════════════════════════╝

  Initialize your Obsidian vault:

    agentlog init ~/path/to/vault

  No Obsidian? Use plain mode:

    agentlog init --plain ~/Documents/notes

  Auto-detect vaults:

    agentlog detect
`);
