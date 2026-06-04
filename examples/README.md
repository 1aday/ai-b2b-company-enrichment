# Examples

`input.sample.csv` is a tiny public CSV for dry runs and documentation.

No generated outputs are committed. Real workflow outputs are written under `runs/`, which is ignored by git.

No-cost dry run:

```bash
npm run flow -- --input=examples/input.sample.csv --dry-run=true --limit=2
```

Small paid run:

```bash
npm run flow -- --input=examples/input.sample.csv --limit=2 --max-nav-pages=5
```
