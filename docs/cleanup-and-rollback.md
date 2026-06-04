# Cleanup and rollback

This repository was reduced from a broad experiment workspace into a standalone enrichment workflow.

## Active surface

Active source files live in `src/` and support:

- CSV entity scraping.
- Markdown storage.
- LLM packet preparation.
- OpenRouter-compatible enrichment.
- Strict response validation.
- Cheap-model benchmarking.

Historical experiments are preserved by the local rollback snapshot, not by the public active source tree.

## Rollback snapshot

Before cleanup, a source/config/doc snapshot was stored under:

```text
.cleanup-backups/20260604T001513Z-pre-standalone-cleanup/
```

Restore command from the repo root:

```bash
tar -xzf .cleanup-backups/20260604T001513Z-pre-standalone-cleanup/source-config-docs.tgz
```

Or use the helper script:

```bash
npm run restore:pre-cleanup
```

To restore a specific snapshot:

```bash
npm run restore:pre-cleanup -- .cleanup-backups/20260604T001513Z-pre-standalone-cleanup
```

The snapshot is local and ignored by git.

## Legacy policy

Do not commit old experiment folders or generated artifacts. If an old workflow is needed, restore it from the local cleanup backup and reintroduce only the specific files required.

## Generated data policy

These are local artifacts and should not be committed:

- `runs/`
- `data/`
- `autoresearch-results/`
- `.firecrawl/`
- `.wrangler/`
- `.codex-autoresearch/`
- `.cleanup-backups/`
- `ui/.next/`
- `ui/node_modules/`
