# Changelog

## 0.2.0

- Generalized the workflow into preset-driven B2B company enrichment.
- Added optional ICP scoring with an explicit no-ICP invariant.
- Added deterministic company, ICP, and capital-source fixtures.
- Preserved the validated capital-source workflow as a preset.
- Added a static, fictional, keyless product dashboard.
- Added account-level data-safety boundaries and neutral output paths.
- Added a custom repository hero and social-preview asset.

## 0.1.0

- Created standalone scrape-to-LLM enrichment workflow.
- Added first-party Markdown scraping with nav discovery.
- Added packet preparation for LLM-ready Markdown.
- Added OpenRouter-compatible enrichment runner.
- Added strict enriched JSON validation.
- Added empty-content and keyword prefilters.
- Added local progress UI entrypoint.
- Added rollback helper for cleanup migration.
- Preserved older experiments under `legacy/`.
- Validated cleaned flow on a 20-entity real CSV run.
