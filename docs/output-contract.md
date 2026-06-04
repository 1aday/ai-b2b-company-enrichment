# Output contract

The workflow writes both source artifacts and final enrichment artifacts.

## Scrape artifacts

```text
scrape-runs/<run-id>-scrape/markdown/<company>/*.md
scrape-runs/<run-id>-scrape/markdown/<company>/_company_index.json
```

Markdown files include:

- Company identity.
- Page name.
- Page path.
- Requested URL.
- Final URL.
- Fetch status.
- Page content.

`_company_index.json` includes:

- Source inventory.
- Logo URL and source.
- Favicon URL and source.
- Full address hint.
- Postal-code hint.
- Page summaries.

## Packet artifacts

```text
prepared_for_llm/<company>/llm_input.md
prepared_for_llm/<company>/llm_input.json
prepared_for_llm/<company>/clean/first_party_clean.md
prepared_for_llm/<company>/clean/third_party_clean.md
prepared_for_llm/_quality_report.json
```

The LLM packet should contain enough scraped content for the model to fill the JSON, but it should not carry CSV classification labels as final truth.

## Enrichment artifacts

```text
llm-enrichment/enriched.csv
llm-enrichment/enriched-index.json
llm-enrichment/enriched_json/*.json
llm-enrichment/responses/<model-slug>/*.json
llm-enrichment/keyword-prefilter.json
llm-enrichment/summary.json
```

## Required enriched JSON sections

Strict usable output must include:

- `source_record_id`
- `canonical_name`
- `domain`
- `website_url`
- `logo_url`
- `type`
- `verification`
- `profile`
- `capital_profile`
- `portfolio_signals`
- `outreach`
- `compliance`
- `source_evidence`
- `quality`

The strict parser also requires:

- `verification.is_capital_source` as a boolean.
- `verification.status` as a string.
- `profile` as an object.
- `capital_profile` as an object.

Provider envelopes, partial JSON, and truncated reasoning are not accepted as enriched records.

## Rejected entity contract

If an entity is not a valid target:

```json
{
  "type": "not_lp_target",
  "verification": {
    "is_capital_source": false,
    "status": "rejected",
    "rationale": "One sentence max."
  }
}
```

Unknown fields should remain `unknown` rather than guessed.
