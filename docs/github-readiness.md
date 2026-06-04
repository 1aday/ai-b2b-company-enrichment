# GitHub readiness status

This repo has been reduced to a standalone scrape-to-enrichment workflow.

## Ready

- Active workflow scripts are limited to scrape, packet prep, enrich, full flow, benchmark, UI, and rollback.
- Generated/local artifacts are ignored by `.gitignore`.
- Local secrets are excluded and `.env.example` is provided.
- Public sample input exists at `examples/input.sample.csv`.
- Legacy experiments are preserved locally by the rollback archive and excluded from the public repo.
- A local rollback archive exists under `.cleanup-backups/`.
- Rollback helper exists as `npm run restore:pre-cleanup`.
- Backup archive was smoke-extracted into `.local-artifacts/restore-smoke-20260604T0022` and confirmed readable.
- TypeScript compile passed after cleanup.
- A 20-entity paid end-to-end run completed after cleanup.
- CI workflow exists under `.github/workflows/ci.yml`.
- Public docs now cover architecture, operations, model selection, output contract, evaluation, troubleshooting, rollback, and contribution/security basics.

## Active entrypoints

```bash
npm run flow
npm run flow:screen
npm run scrape
npm run packets
npm run enrich
npm run benchmark
npm run verify:benchmark
npm run ui
npm run restore:pre-cleanup
npm run typecheck
```

## Latest validation

Latest local validation:

```text
runs/cleaned-flow-20-20260604T0028/
```

Summary:

- Input entities: 20.
- Prepared packets: 20.
- Sent to LLM: 14.
- Strict usable JSON: 14.
- Bad/truncated JSON: 0.
- Cost: `$0.074603`.

Recommended pre-push checks:

```bash
npm run typecheck
npm run flow -- --input=examples/input.sample.csv --dry-run=true --limit=2
```

## Rollback

```bash
npm run restore:pre-cleanup
```

Or:

```bash
tar -xzf .cleanup-backups/20260604T001513Z-pre-standalone-cleanup/source-config-docs.tgz
```
