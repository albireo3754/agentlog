# AgentLog

Claude Code prompts → Obsidian Daily Note, automatically.

Every time you type a prompt in Claude Code, AgentLog captures it and appends it to your Obsidian Daily Note — with timestamps, organized by timeblock.

```
npx agentlog init ~/Obsidian
```

That's it. Start using Claude Code and your Daily Note fills itself.

## What It Does

```
Claude Code prompt → UserPromptSubmit hook → Daily Note append
```

**Before:** You finish a 3-hour Claude Code session. Your Daily Note is empty.

**After:**

```markdown
## 오전 (08-13)
- [x] 10 - 12
  - 10:53 agentlog 개발을 위해서 작업 진행
  - 11:07 스펙 문서 열어봐
  - 11:21 git init하고 vscode로 열어봐
- [ ] 12 - 13
```

No manual logging. No copy-paste. No AI summarization overhead.

## Install

```bash
# With Bun
bunx agentlog init ~/path/to/vault

# With npm
npx agentlog init ~/path/to/vault
```

### Requirements

- [Claude Code](https://claude.ai/code) (hook integration)
- [Obsidian](https://obsidian.md) (Daily Note target)
- [Bun](https://bun.sh) (>=1.0.0, supports `bunx`)
- [Node.js](https://nodejs.org) >=20 + npm (supports `npx`)

## Usage

### Setup

```bash
# Point to your Obsidian vault
agentlog init ~/Obsidian

# Or use any folder (no Obsidian required)
agentlog init --plain ~/notes
```

This does two things:
1. Creates `~/.agentlog/config.json` with your vault path
2. Registers a hook in `~/.claude/settings.json`

### That's It

Use Claude Code normally. Every prompt you type gets logged to your Daily Note.

### How It Works

1. You type a prompt in Claude Code
2. Claude Code fires the `UserPromptSubmit` hook
3. AgentLog reads the prompt from stdin
4. Finds your Daily Note: `{vault}/Daily/{YYYY-MM-DD}-{요일}.md`
5. Finds the matching timeblock (e.g., 10:53 → `10 - 12`)
6. Appends: `  - 10:53 your prompt here`
7. Marks the timeblock checkbox `[x]`

Total overhead: < 50ms per prompt. Fire-and-forget, never blocks Claude Code.

## Daily Note Format

### With Timeblocks (Korean format)

If your Daily Note has timeblock headers, entries go under the matching block:

```markdown
## 오전 (08-13)
- [ ] 08 - 09
- [x] 10 - 12
  - 10:53 agentlog 개발을 위해서 작업 진행
  - 11:07 스펙 문서 열어봐
- [ ] 12 - 13
```

Supported timeblocks:

| Period | Blocks |
|--------|--------|
| 새벽 (00-08) | 00-02, 02-04, 04-06, 06-08 |
| 오전 (08-13) | 08-09, 09-10, 10-12, 12-13 |
| 오후 (13-17) | 13-15, 15-17 |
| 저녁 (17-24) | 17-19, 19-21, 21-23, 23-24 |

### Without Timeblocks (fallback)

If no timeblock pattern is found, entries append to an `## AgentLog` section:

```markdown
## AgentLog
- 10:53 agentlog 개발을 위해서 작업 진행
```

### Plain Mode

With `--plain`, entries go to `{folder}/YYYY-MM-DD.md`:

```markdown
- 10:53 agentlog 개발을 위해서 작업 진행
```

## No Obsidian? No Problem

If Obsidian isn't installed, `agentlog init` tells you:

```
⚠ Obsidian vault가 감지되지 않았습니다.

1. Obsidian 설치: https://obsidian.md/download
2. vault 생성 후 다시 실행:
   npx agentlog init /path/to/your/vault

또는 일반 폴더에 기록하려면:
   npx agentlog init --plain ~/notes
```

## Uninstall

```bash
# Remove hook from Claude Code
# Edit ~/.claude/settings.json and remove the agentlog entry

# Remove config
rm -rf ~/.agentlog
```

## Project Structure

```
src/
├── cli.ts              # CLI entry point (init, hook)
├── hook.ts             # Claude Code hook handler
├── note-writer.ts      # Daily Note append logic
├── config.ts           # Config load/save
├── types.ts            # TypeScript interfaces
└── schema/
    ├── hook-input.ts   # Hook input schema (SOT)
    └── daily-note.ts   # Timeblock definitions (SOT)
```

## Development

```bash
bun install
bun test          # 74 tests
bun run typecheck # tsc --noEmit
bun run build     # compile to dist/
```

## Roadmap

- **Phase 2:** Obsidian plugin with timeline visualization UI
- **Phase 3:** Git log integration (commits → Daily Note)
- **Future:** `agentlog run` command for session replay from JSONL captures

## License

MIT
