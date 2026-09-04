# Operations

## No-cost checks

```bash
npm ci
npm run typecheck
npm test
npm run fixture
npm run fixture:icp
npm run fixture:capital-source
npm run flow -- --input=examples/input.sample.csv --dry-run=true --limit=2
npm run flow:capital-source -- --input=examples/input.sample.csv --dry-run=true --limit=2
npm run benchmark -- --packet-root=examples/fixtures/prepared_for_llm --phase=prepare --dry-run=true
npm run ui:build
```

## Paid provider setup

Create an ignored `.env.local` in the repository root:

```bash
OPENROUTER_API_KEY=your_key_here
```

The static dashboard never reads this file.

## Small company run

```bash
npm run flow -- \
  --input=/absolute/path/to/companies.csv \
  --provider=openrouter \
  --model=openai/gpt-4.1-mini \
  --limit=5 \
  --max-nav-pages=10 \
  --scrape-concurrency=4 \
  --enrich-concurrency=2
```

Add `--icp=/absolute/path/to/icp.json` only when the criteria are ready for scoring.

## Capital-source preset

```bash
npm run flow:capital-source -- \
  --input=/absolute/path/to/companies.csv \
  --provider=openrouter \
  --limit=5
```

This path continues through `src/enrich-prepared-packets.ts`, preserving the established capital-source prompt, filter, schema, and output behavior.

## Important flags

- `--preset=company|capital-source`
- `--provider=fixture|openrouter`
- `--icp=/absolute/path/to/icp.json`
- `--limit=20` and `--offset=0`
- `--max-nav-pages=10`
- `--max-entity-ms=120000`
- `--scrape-concurrency=8`
- `--enrich-concurrency=3`
- `--model=<openrouter-model-id>`
- `--retries=2`
- `--max-output-tokens=8000`
- `--dry-run=true`

## Scale gates

Before increasing volume:

1. Review empty and failed scrapes.
2. Manually inspect a representative set of source packets.
3. Review all accepted ICP matches and disqualifiers.
4. Measure parse rate, evidence coverage, latency, and actual provider cost.
5. Confirm the selected model supports strict response schemas.
6. Set a retention policy for real source records and raw provider responses.

Do not treat provider availability, price, or prior benchmark results as permanent.
