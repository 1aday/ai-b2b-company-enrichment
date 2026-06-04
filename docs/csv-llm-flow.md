# CSV scrape to LLM enrichment flow

This is the primary standalone workflow.

Default model:

```text
nvidia/nemotron-3-super-120b-a12b
```

Any OpenRouter-compatible chat model can be passed with `--model=...`.

## Command

```bash
npm run flow -- \
  --input=/path/to/entities.csv \
  --run-id=capital-source-$(date +%Y%m%d-%H%M%S) \
  --limit=100 \
  --scrape-concurrency=12 \
  --enrich-concurrency=4 \
  --max-nav-pages=0
```

## Flow

1. `src/enrich-investor-companies-master.ts` scrapes each entity website.
2. Same-domain navigation links are discovered from homepage/domain-root pages.
3. Markdown pages are stored under each company folder with page name and page path.
4. `_company_index.json` stores page inventory, logo candidates, favicon fallback, address, postal code, and source summaries.
5. `src/prepare-company-llm-packets.ts` creates `llm_input.md` and `llm_input.json`.
6. `src/enrich-prepared-packets.ts` skips empty/no-signal packets, calls the model, validates strict JSON, and writes outputs.

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

## Production local run

```bash
npm run flow:screen -- \
  --input=/path/to/entities.csv \
  --run-id=capital-source-$(date +%Y%m%d-%H%M%S) \
  --scrape-concurrency=12 \
  --enrich-concurrency=4 \
  --max-nav-pages=0
```

## Prompt discipline

- Use scraped Markdown only.
- First-party pages are primary evidence.
- Third-party pages are secondary evidence when present.
- Do not carry over CSV labels into final truth.
- Unknown beats plausible guessing.
- If `verification.is_capital_source` is false, status must be `rejected` and type must be `not_lp_target`.
- The rejection reason must be one sentence max.
- Do not invent principals, check sizes, AUM, fund appetite, sectors, stages, geographies, or contacts.
- Logo should come from scraped site assets or favicon fallback.
- Full address should include street, city, state/region, country, and ZIP/postal code when present.

## Failure handling

- Empty/no-content packets are skipped before LLM spend.
- Non-JSON and partial/truncated model responses are retried.
- Strict parser validation blocks provider envelopes and partial objects from becoming enriched records.
- Raw responses are retained for audit and retry.
