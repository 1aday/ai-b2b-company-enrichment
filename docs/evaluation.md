# Evaluation

Evaluation is split into mechanical validation and enrichment quality review.

## Mechanical validation

Run:

```bash
npm run typecheck
```

Run a no-cost orchestration check:

```bash
npm run flow -- --input=examples/input.sample.csv --dry-run=true --limit=2
```

Mechanical success means:

- TypeScript compiles.
- The flow orchestrator can build commands and write a manifest.
- Active scripts do not depend on legacy files.

## End-to-end smoke test

The cleaned repo was tested with:

```bash
npm run flow -- \
  --input=/path/to/entities.csv \
  --run-id=cleaned-flow-20-20260604T0028 \
  --limit=20 \
  --scrape-concurrency=8 \
  --enrich-concurrency=4 \
  --max-nav-pages=20 \
  --terminal-every=5 \
  --progress-every=5
```

Results:

- Input entities: 20.
- Scrape completed: 20.
- Source pages OK: 211.
- Source pages failed: 8.
- Raw pages: 219.
- Kept LLM pages: 132.
- Dropped pages: 87.
- Logos found: 20.
- Addresses found: 20.
- Prepared packets: 20.
- Skipped before LLM: 6.
- Sent to LLM: 14.
- Completed LLM calls: 14.
- Parse OK: 14.
- Strict usable JSON: 14.
- Bad/truncated JSON: 0.
- Accepted capital sources: 0.
- Rejected/non-targets: 14.
- Cost: `$0.074603`.

## Manual quality review

Manual review should focus on:

- Accepted positives first.
- Rejected entities with allocator-like language.
- Skipped packets that may have weak scrape coverage.
- Addresses that include footer or contact-form noise.
- Logos that came from favicon fallback rather than real logo assets.
- Any provider response with `finish_reason=length`.

## Scale gate

Before scaling:

- Confirm the accepted positives are high quality.
- Confirm likely LP/allocator targets are not being skipped before LLM.
- Confirm strict parse rate is high enough for the selected model.
- Confirm cost per enriched packet is acceptable.
