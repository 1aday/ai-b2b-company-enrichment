# Output contract

## Company preset

The strict company object contains these required sections:

```text
source_record_id
identity
firmographics
offering
commercial_signals
qualification
outreach
source_evidence
quality
```

Important invariants:

- `source_evidence` contains at least one cited claim.
- identity name, domain, website, and description are non-empty.
- confidence values are between 0 and 1.
- no ICP means `qualification.status=not_scored` and `icp_score=null`.
- an active ICP score is between 0 and 100.
- company output contains no people or personal contact fields.

See `src/presets/company.ts` for the complete JSON schema.

## Capital-source preset

The original `ENRICHMENT_OUTPUT_SCHEMA` from `src/schema.ts` remains the source of truth. Its verification, profile, capital profile, portfolio, outreach, compliance, evidence, and quality sections are unchanged by the general company preset.

## Source-context preservation

The four required CSV fields are mapped into identity. Every additional source column is retained in `entity.source_context` in the packet. The flattened company CSV prefixes those original columns with `source_` to distinguish input context from enriched claims.

## Files

```text
flow-manifest.json                      run configuration and stages
enrichment/config.json                  preset, provider, model, and safety scope
enrichment/enriched.csv                 flattened rows
enrichment/enriched-index.json          flattened rows plus artifact pointers
enrichment/enriched_json/<case>.json    validated structured output
enrichment/responses/<model>/<case>.json raw text, errors, validation, usage
enrichment/summary.json                 counts, cost, timestamps, output paths
```

An invalid result can have a response artifact without an enriched JSON artifact. Consumers should require `ok=true` in `enriched-index.json` before import.
