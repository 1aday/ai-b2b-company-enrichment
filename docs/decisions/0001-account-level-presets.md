# Decision 0001: Account-level preset architecture

Status: accepted.

## Context

The original repository solved a narrow capital-source qualification problem. The product needed to become a general B2B company enrichment system without losing the validated historical contract.

## Decision

Use a preset interface for schema, prompt, validation, keyword filters, CSV mapping, and benchmark fields. Make `company` the default and keep `capital-source` as an explicit preset.

Keep the company contract strictly account-level. People and personal contact discovery are excluded. Optional ICP scoring is allowed only when the operator supplies an explicit ICP file; otherwise the output must be `not_scored` with a null score.

Provide a deterministic fixture provider so setup, tests, documentation, and the public dashboard do not depend on a paid API key.

## Consequences

- The durable scraping and packet stages can serve multiple account-level use cases.
- The old capital-source output remains reproducible.
- New presets require a complete contract rather than ad hoc prompt flags.
- Personal-contact enrichment would require a separate product and privacy review.
