# Local Self Review

`review-list.json` stores recurring review findings as executable local gates.

Run before pushing PR updates:

```bash
bun run self-review -- --mode staged
bun run typecheck
bun test
```

Useful modes:

```bash
bun run self-review -- --mode branch --base origin/develop
bun run self-review -- --mode staged
```

The script appends every run to `docs/review/history.jsonl`.
It fails when an applicable rule lacks required evidence.
