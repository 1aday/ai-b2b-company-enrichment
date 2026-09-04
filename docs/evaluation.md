# Evaluation record

## Current deterministic validation

Run date: 2026-09-04.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 9 passed, 0 failed |
| `npm run fixture` | Passed, zero provider cost |
| `npm run fixture:icp` | Passed, zero provider cost |
| `npm run fixture:capital-source` | Passed, zero provider cost |
| Company dry run | Passed |
| Capital-source dry run | Passed |
| Offline benchmark preparation | Passed |
| Dashboard production build | Passed as static output |
| Dashboard dependency audit | 0 known vulnerabilities |

## What the tests exercise

- company output with no ICP;
- company output with an explicit ICP;
- capital-source preset preservation;
- missing website and missing evidence rejection;
- prohibition on a score without an ICP;
- malformed model JSON;
- empty scrape detection;
- timeout, throttling, and server-error retry classification;
- required input fields and additional-column preservation.

## What this does not prove

The deterministic fixture proves orchestration and contract behavior, not live website coverage or model accuracy. Paid-model quality, latency, and price require a separately recorded OpenRouter benchmark. The public demo does not imply real-company results.
