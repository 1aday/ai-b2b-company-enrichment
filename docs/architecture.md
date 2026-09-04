# Architecture

The system separates collection, evidence preparation, model execution, and validation so each stage can be inspected and retried independently.

## Data flow

```text
CSV rows
  -> validate four required identity fields
  -> preserve all additional columns as source context
  -> scrape first-party website pages
  -> store raw Markdown and source metadata
  -> remove noise, rank pages, and build evidence packets
  -> select company or capital-source preset
  -> execute deterministic fixture or OpenRouter provider
  -> validate schema and cross-field invariants
  -> write JSON, CSV, raw response, usage, and summary
```

## Components

### Orchestrator

`src/run-company-enrichment-flow.ts` owns the run directory and manifest. `--provider=fixture` bypasses scraping and uses bundled packets. `--provider=openrouter` runs all three durable stages.

### Website collection

`src/scrape-company-websites.ts` validates the input contract, collects same-domain first-party pages, records fetch failures, and stores Markdown plus a per-company source index. It does not bypass access controls.

### Packet builder

`src/prepare-company-llm-packets.ts` removes repeated navigation chrome, thin pages, error pages, legal pages, and duplicates. It ranks useful sources and writes a bounded Markdown/JSON packet with first- and third-party sources separated.

### Presets

`src/presets/` is the product boundary. A preset defines:

- strict output schema;
- evidence and extraction prompt;
- keyword-gate configuration;
- benchmark field weights;
- output validation;
- flattened CSV mapping.

The `company` preset is the default. `capital-source` imports the original schema and field contract.

### Providers

`fixture` reads a checked-in deterministic response beside a prepared packet. It never uses a key or network request.

`openrouter` sends the preset schema and evidence packet to an OpenRouter-compatible chat-completions endpoint. It records raw text, usage, latency, calculated cost, and validation errors.

### Dashboard

`ui/` is a static Next.js product demo. Its data is imported from `ui/data/demo.ts`; no API route or server action is present. The interaction simulates the deterministic pipeline locally in the browser and cannot start a model call.

## Trust boundaries

| Boundary | Rule |
| --- | --- |
| CSV | Identity hint and preserved source context, not final truth |
| First-party pages | Preferred evidence for company claims |
| Third-party pages | Secondary context, labelled separately |
| Model output | Untrusted until parsing and preset validation pass |
| ICP | Optional, explicit criteria only |
| Unknown data | Empty, `null`, or review flag; never guessed |
| Person data | Outside the product contract |

## Retry design

Scraping and packet preparation are durable. Only transport failures, timeouts, rate limits, and provider server errors are retryable by the model executor. Invalid requests fail immediately. Malformed successful responses are retained and fail validation rather than silently entering the output CSV as truth.
