# Operations runbook

## Environment

Required for paid enrichment:

```bash
OPENROUTER_API_KEY=...
```

Optional:

```bash
OPENAI_API_KEY=...
```

## Smoke checks

No-cost compile check:

```bash
npm run typecheck
```

No-cost orchestration check:

```bash
npm run flow -- --input=examples/input.sample.csv --dry-run=true --limit=2
```

## Small paid run

```bash
npm run flow -- \
  --input=/path/to/entities.csv \
  --run-id=smoke-$(date +%Y%m%d-%H%M%S) \
  --limit=20 \
  --scrape-concurrency=8 \
  --enrich-concurrency=4 \
  --max-nav-pages=20
```

## Production local run

```bash
npm run flow:screen -- \
  --input=/path/to/entities.csv \
  --run-id=capital-source-$(date +%Y%m%d-%H%M%S) \
  --scrape-concurrency=12 \
  --enrich-concurrency=4 \
  --max-nav-pages=0
```

Attach:

```bash
screen -r <session-name>
```

## Important flags

- `--limit=100`: process only the first 100 selected rows.
- `--offset=200`: start from row offset 200.
- `--max-nav-pages=0`: no artificial nav-page cap.
- `--max-nav-pages=20`: bounded smoke crawl.
- `--max-entity-ms=120000`: stop a single entity after 120 seconds.
- `--scrape-concurrency=12`: concurrent entity scrapes.
- `--enrich-concurrency=4`: concurrent model calls.
- `--model=...`: OpenRouter model id.
- `--retries=2`: malformed-response retry count.
- `--max-output-tokens=12000`: response cap.

## Reading results

Start with:

```text
runs/<run-id>/flow-manifest.json
runs/<run-id>/llm-enrichment/summary.json
runs/<run-id>/llm-enrichment/enriched.csv
```

Then inspect:

```text
runs/<run-id>/scrape-runs/<run-id>-scrape/prepared_for_llm/_quality_report.json
runs/<run-id>/llm-enrichment/keyword-prefilter.json
runs/<run-id>/llm-enrichment/responses/<model-slug>/
```

## Stop conditions

- If many packets are skipped as empty, improve scrape coverage before changing the prompt.
- If many responses are malformed, lower packet size or increase retries.
- If accepted records look overbroad, tighten the system prompt and review accepted positives manually.
- If likely targets are skipped before LLM, broaden keyword prefilter terms before scaling.
