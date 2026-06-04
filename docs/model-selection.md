# Model selection

The workflow is designed to compare cheap models against the same packet corpus.

## Default model

```text
nvidia/nemotron-3-super-120b-a12b
```

Override with:

```bash
npm run enrich -- \
  --packet-root=/path/to/prepared_for_llm \
  --model=qwen/qwen3.5-flash-02-23
```

## What to measure

- Cost per packet.
- Average latency.
- Parse success rate.
- Strict usable JSON rate.
- Accepted target quality.
- False-positive rate among accepted targets.
- False-negative risk among rejected or skipped records.
- Field fill quality for address, logo, capital profile, sectors, stages, and geography.

## Cheap-model strategy

1. Scrape once.
2. Prepare packets once.
3. Run candidate models against the same packet root.
4. Keep raw responses.
5. Compare strict parse rate before manual quality.
6. Manually review accepted positives before scaling.

## Prompt adjustment themes

If a model rejects too much:

- Make the valid target taxonomy explicit.
- Clarify that allocators, fund-of-funds, foundations, endowments, pensions, private banks, OCIOs, and discretionary platforms can be valid targets.
- Broaden keyword prefiltering before changing final classification.

If a model accepts too much:

- Emphasize that direct startup investing alone is not enough.
- Require evidence that the entity can commit capital to funds, managers, or alternative vehicles.
- Keep rejection reasons short and decisive.

If a model returns malformed JSON:

- Reduce packet size.
- Increase retries.
- Lower max pages per company.
- Increase `--max-output-tokens`.
- Prefer models with stronger JSON obedience even if token price is slightly higher.
