# Capital Source Enrichment

Scrape-first enrichment workflow for identifying entities that are plausible capital sources for VC funds, emerging managers, private funds, fund-of-funds, and alternative investment vehicles.

The core idea is simple: scrape and store source material cheaply, organize it into clean Markdown packets, then test different LLMs against the same packet corpus until you find the best cost/quality tradeoff.

## Why this exists

Most enrichment systems burn tokens too early. They send messy CSV rows and half-scraped context directly to an expensive model, then make it hard to audit why fields were filled.

This project separates the workflow into durable stages:

1. Scrape first-party source pages and store them locally as Markdown.
2. Clean and organize the scraped content per entity.
3. Skip empty or obviously irrelevant packets before any LLM spend.
4. Run cheap model candidates against the same packet format.
5. Validate full JSON shape before treating an output as enriched truth.
6. Preserve raw responses, packet paths, scrape files, and cost metrics for audit and retry.

## Validated status

The cleaned standalone workflow was tested end-to-end on 20 real CSV entities.

- TypeScript compile: passed.
- Scrape step: 20 of 20 entities completed.
- Packet prep: 20 packets created.
- LLM prefilter: 6 skipped before spend.
- LLM calls: 14 completed.
- Strict JSON parse: 14 of 14 usable.
- Bad/truncated JSON: 0.
- Test cost: `$0.074603`.

Latest local test output:

```text
runs/cleaned-flow-20-20260604T0028/
```

## Features

- CSV-driven entity workflow.
- First-party website scraping with same-domain nav discovery.
- Per-company Markdown storage with page name and page path.
- Deterministic logo extraction with favicon fallback.
- Deterministic address and postal-code hints.
- LLM-ready packet generation with clean first-party and third-party sections.
- Empty-content and keyword prefilters before LLM calls.
- OpenRouter-compatible chat model support.
- Strict enriched JSON validation.
- Raw provider-response retention for audit.
- Cost and latency reporting.
- Local progress UI under `ui/`.
- Screen-based long-run helper for local machines.
- Rollback helper for the cleanup migration.
- Local rollback support for the pre-cleanup workspace.

## Quickstart

```bash
npm install
cp .env.example .env.local
```

Set:

```bash
OPENROUTER_API_KEY=...
```

Run a full enrichment flow:

```bash
npm run flow -- \
  --input=/path/to/entities.csv \
  --run-id=capital-source-$(date +%Y%m%d-%H%M%S) \
  --limit=100 \
  --scrape-concurrency=12 \
  --enrich-concurrency=4 \
  --max-nav-pages=0
```

Run a long local job in `screen`:

```bash
npm run flow:screen -- \
  --input=/path/to/entities.csv \
  --limit=1000 \
  --max-nav-pages=0
```

Run the progress UI:

```bash
npm run ui
```

## CSV input

Minimum useful columns:

```text
source_record_id,company_name,domain,website_url,city,state,country
```

Sample:

```bash
cat examples/input.sample.csv
```

The workflow can tolerate extra columns. Existing CSV values are treated as identity and hints, not final truth.

## Commands

```bash
npm run flow
npm run flow:screen
npm run scrape
npm run packets
npm run enrich
npm run benchmark
npm run verify:benchmark
npm run ui
npm run typecheck
npm run restore:pre-cleanup
```

## Run steps separately

Scrape only:

```bash
npm run scrape -- --input=/path/to/entities.csv --limit=100
```

Prepare packets from a scrape run:

```bash
npm run packets -- --run-dir=/path/to/scrape-run
```

Enrich prepared packets:

```bash
npm run enrich -- \
  --packet-root=/path/to/prepared_for_llm \
  --model=nvidia/nemotron-3-super-120b-a12b
```

## Output layout

```text
runs/<run-id>/
  flow-manifest.json
  scrape_markdown.log
  prepare_llm_packets.log
  llm_enrichment.log
  scrape-runs/<run-id>-scrape/
    markdown/<company>/*.md
    markdown/<company>/_company_index.json
    prepared_for_llm/<company>/llm_input.md
    prepared_for_llm/<company>/llm_input.json
  llm-enrichment/
    enriched.csv
    enriched-index.json
    enriched_json/*.json
    responses/<model-slug>/*.json
    keyword-prefilter.json
    summary.json
```

## Quality rules

- First-party scraped pages are primary evidence.
- Third-party pages are secondary evidence when present.
- CSV/list labels are not final enrichment truth.
- Unknown beats guessing.
- Rejection reason must be one sentence max.
- Valid targets must appear able and likely to commit capital to VC funds, emerging managers, private funds, fund-of-funds, or alternative investment vehicles.
- Non-targets must be marked `verification.is_capital_source=false`, `verification.status=rejected`, and `type=not_lp_target`.
- Full enriched JSON must pass strict shape validation before import.

## Cost controls

- Scraping and packet prep cost no LLM tokens.
- Empty packets are skipped before model calls.
- Keyword prefiltering skips obvious no-signal packets.
- Model, concurrency, timeouts, retry count, and max output tokens are configurable.
- Raw responses are retained so parser failures can be audited without repaying for the same context.

## Documentation

- `docs/architecture.md`: system design and data flow.
- `docs/csv-llm-flow.md`: command-level workflow.
- `docs/output-contract.md`: output files and JSON shape.
- `docs/model-selection.md`: cheap-model benchmarking guidance.
- `docs/operations.md`: production runbook.
- `docs/evaluation.md`: quality and test notes.
- `docs/troubleshooting.md`: common failures and fixes.
- `docs/github-readiness.md`: current repo-readiness status.
- `docs/cleanup-and-rollback.md`: rollback policy.

## Rollback

Before the standalone cleanup, a local rollback snapshot was written under `.cleanup-backups/`.

Restore the cleanup snapshot:

```bash
npm run restore:pre-cleanup
```

Or restore manually:

```bash
tar -xzf .cleanup-backups/<snapshot>/source-config-docs.tgz
```

The backup is intentionally ignored by git.

## License

MIT. See `LICENSE`.
