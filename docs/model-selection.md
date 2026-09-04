# Model selection

The benchmark compares models against the same evidence packets and a chosen gold output. Preset-defined field weights keep evaluation aligned with the product being tested.

## Prepare without model spend

```bash
npm run benchmark -- \
  --packet-root=examples/fixtures/prepared_for_llm \
  --phase=prepare \
  --dry-run=true
```

## Real comparison

```bash
npm run benchmark -- \
  --preset=company \
  --run-dir=/absolute/path/to/scrape-run \
  --cases=20 \
  --gold-model=openai/gpt-4.1 \
  --candidate-limit=8
```

Benchmark the historical workflow with `npm run benchmark:capital-source` and the same flags.

## Decision fields

- valid structured-response rate;
- weighted agreement with the gold record;
- recall on gold-known fields;
- evidence and schema completeness;
- average and total latency;
- average and total provider cost.

The cheapest model is not automatically the winner. A model is eligible only after it clears the configured quality and parse thresholds for the full case set.

The public dashboard deliberately marks paid candidates as not run. Add claims only after a reproducible benchmark artifact exists.
