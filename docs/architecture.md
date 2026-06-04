# Architecture

Capital Source Enrichment is a staged local workflow. Each stage writes durable artifacts so failures can be inspected and retried without repeating earlier work.

## Data flow

```text
CSV
  -> scrape first-party website pages
  -> store Markdown and source metadata
  -> build clean LLM packets
  -> skip empty or low-signal packets
  -> call OpenRouter-compatible model
  -> validate strict enriched JSON
  -> write JSON, CSV, responses, summary
```

## Stages

### 1. Scrape

Entrypoint:

```text
src/enrich-investor-companies-master.ts
```

Responsibilities:

- Read CSV entities.
- Resolve homepage/domain URLs.
- Scrape homepage/domain-root pages.
- Discover same-domain navigation links.
- Store per-page Markdown with frontmatter.
- Extract logo candidates, favicon candidates, address hints, and postal-code hints.
- Write `_company_index.json` per company.

### 2. Prepare packets

Entrypoint:

```text
src/prepare-company-llm-packets.ts
```

Responsibilities:

- Read scraped Markdown folders.
- Drop noisy pages such as legal pages, account flows, duplicates, and very thin pages.
- Preserve full useful content for LLM reasoning.
- Separate first-party and third-party sections.
- Write `llm_input.md` and `llm_input.json`.
- Write `_quality_report.json`.

### 3. Enrich

Entrypoint:

```text
src/enrich-prepared-packets.ts
```

Responsibilities:

- Load prepared packets.
- Skip packets with no usable content.
- Apply high-recall keyword prefilter.
- Call the configured model through an OpenRouter-compatible chat endpoint.
- Retry malformed responses.
- Validate strict enriched JSON.
- Store raw provider responses and parsed output.
- Write CSV/index/summary files.

### 4. Orchestrate

Entrypoint:

```text
src/run-csv-scrape-enrich-flow.ts
```

Responsibilities:

- Run scrape, prepare, and enrich as one flow.
- Write step logs.
- Maintain `flow-manifest.json`.
- Support `--dry-run=true` for no-cost orchestration checks.

## Source files

```text
src/run-csv-scrape-enrich-flow.ts
src/enrich-investor-companies-master.ts
src/prepare-company-llm-packets.ts
src/enrich-prepared-packets.ts
src/markdown-scrape.ts
src/schema.ts
src/field-contract.ts
src/shared.ts
src/benchmark-site-md-models.ts
src/verify-site-md-benchmark.ts
```

## Experiment boundary

Pre-cleanup experiments are not part of the public active workflow. The local rollback archive can restore them if needed, but package scripts and TypeScript config only target the standalone workflow.
