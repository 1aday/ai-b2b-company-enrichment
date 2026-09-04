# Troubleshooting

## Input rejected

Confirm every row has `source_record_id`, `company_name`, `domain`, and `website_url`. Blank values are reported with their CSV row number.

## Empty evidence packet

Inspect the company Markdown directory and `_quality_report.json`. Common causes are a wrong domain, parked site, bot blocking, JavaScript-only content, redirects, or thin pages. Fix collection before changing the model prompt.

## OpenRouter key missing

`--provider=openrouter` requires `OPENROUTER_API_KEY` in the shell or ignored `.env.local`. `--provider=fixture` never requires a key.

## Provider response malformed

Inspect `enrichment/responses/<model>/<case>.json`. Reduce packet size, allow more output tokens, or select a model with reliable JSON-schema support. Do not import the result unless preset validation passes.

## Rate limit or server failure

Status `429`, timeouts, connection failures, and `5xx` errors are retryable. Increase `--retries` cautiously and reduce concurrency. Invalid `4xx` requests are not retried.

## Unexpected ICP result

Review the exact ICP JSON and cited evidence. A score should be treated as a transparent comparison to those supplied criteria, not objective company quality or buying intent. If no ICP was supplied, any score is a validation error.

## Dashboard build

```bash
cd ui
npm ci
npm run build
```

The production route should be static. If a server route appears, check that no local-artifact APIs or model execution endpoints were reintroduced.
