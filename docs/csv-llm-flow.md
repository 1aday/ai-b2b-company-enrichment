# CSV to company intelligence

## 1. Validate input

```csv
source_record_id,company_name,domain,website_url,segment
acct-001,Example Company,example.com,https://example.com,mid-market
```

The first four fields are required. `segment` is preserved as source context.

## 2. Scrape websites

```bash
npm run scrape -- --input=/absolute/path/to/companies.csv --limit=20
```

The scraper stores every successful page as Markdown with source metadata. Failed fetches are visible in the run summary.

## 3. Prepare packets

```bash
npm run packets -- --run-dir=/absolute/path/to/scrape-run
```

Packets prefer useful first-party pages and keep secondary context separate.

## 4. Enrich

```bash
npm run enrich -- \
  --packet-root=/absolute/path/to/prepared_for_llm \
  --provider=openrouter \
  --model=openai/gpt-4.1-mini
```

Or run all stages with `npm run flow`.

## Failure behavior

- Missing required identity fields stop before scraping.
- Empty scrapes stop before model execution.
- Retryable provider failures are retried up to the configured limit.
- Malformed or incomplete responses remain in the response directory and fail validation.
- Missing evidence never becomes an accepted company record.
