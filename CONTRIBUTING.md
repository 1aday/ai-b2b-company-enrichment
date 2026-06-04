# Contributing

This project is built around a scrape-first, audit-first enrichment workflow.

## Development loop

```bash
npm install
npm run typecheck
```

Run a no-cost flow dry run:

```bash
npm run flow -- --input=examples/input.sample.csv --dry-run=true --limit=2
```

Run a small real workflow only when you have an API key configured:

```bash
npm run flow -- --input=examples/input.sample.csv --limit=2 --max-nav-pages=5
```

## Contribution rules

- Keep generated artifacts out of commits.
- Keep active workflow code in `src/`.
- Keep historical experiments out of the public repo unless deliberately revived.
- Preserve first-party-source primacy in prompts and packet structure.
- Do not treat CSV labels as enrichment truth.
- Do not import dead experiment code unless deliberately reviving an old workflow.
- Prefer adding model/provider support behind flags rather than hardcoding one provider.

## Quality bar

- TypeScript must pass.
- Full enriched JSON must pass strict shape validation.
- Raw provider responses should remain available for audit.
- New fields need explicit schema and output documentation.
- Any new prefilter must prefer false positives over false negatives for plausible capital sources.
