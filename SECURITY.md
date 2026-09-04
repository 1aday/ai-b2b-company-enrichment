# Security

## Secrets

Never commit API keys, provider tokens, CSV exports with private data, or generated run artifacts.

The repo ignores:

- `.env`
- `.env.*`
- `runs/`
- `data/`
- `.cleanup-backups/`
- `.local-artifacts/`

Use `.env.example` as the public template.

## Responsible disclosure

If this repo becomes public and you find a security issue, open a private report with the repository owner or contact the maintainer through the GitHub organization.

## Data handling

This workflow stores scraped public web content and model outputs locally. Review generated files before sharing or publishing them, especially when source CSVs contain proprietary datasets.

The checked-in dashboard is static and uses fictional `.example` records. It contains no provider key input, server-side run browser, or paid-model trigger. Keep those boundaries intact for public deployments.

The company output contract is account-level. Do not extend it with personal contacts without a separate privacy, consent, and retention design.
