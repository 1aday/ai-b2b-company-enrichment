# Troubleshooting

## Many packets skipped as empty

Likely cause:

- Scrape could not fetch useful site content.
- Site blocks bots or requires JavaScript.
- Domain is wrong, parked, or redirected.

What to inspect:

```text
prepared_for_llm/_quality_report.json
llm-enrichment/keyword-prefilter.json
scrape-runs/<run-id>-scrape/markdown/<company>/
```

## A single site stalls the scraper

Use or lower:

```bash
--max-entity-ms=120000
```

The scraper records an entity-timeout source result instead of blocking the whole run.

## Model returns non-JSON

Try:

```bash
--retries=4
--max-output-tokens=16000
--prepare-max-total-chars=100000
--prepare-max-chars-per-page=40000
```

Also inspect:

```text
llm-enrichment/responses/<model-slug>/
```

## Model response is truncated

Symptoms:

- Provider response has `finish_reason=length`.
- Stored response is a provider envelope rather than final enriched object.
- Strict parser blocks it.

Fixes:

- Increase `--max-output-tokens`.
- Reduce packet size.
- Use a model with stronger long-context JSON behavior.

## Too many false positives

Tighten the system prompt around fund-commitment evidence. Direct investing, GP activity, advisory work, brokerage, wealth language, or operating-company activity should not be enough unless the scraped content supports commitment to funds, managers, or alternative vehicles.

## Too many false negatives

Broaden valid-target wording and keyword prefilter terms. Prefer a few false matches before LLM over missing plausible allocators.

## Address contains footer noise

Inspect the source page summary and markdown. Address extraction is deterministic and conservative, but some pages collapse footer/contact text into one line. Treat deterministic address as a hint unless the final LLM JSON supports it.
