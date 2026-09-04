# Examples

`input.sample.csv` is a tiny public CSV for dry runs and documentation. `icp.sample.json` shows the optional qualification contract. `fixtures/prepared_for_llm/` contains fictional deterministic inputs and responses.

No real generated outputs are committed. Workflow outputs are written under `runs/`, which is ignored by git.

No-cost deterministic runs:

```bash
npm run fixture
npm run fixture:icp
npm run fixture:capital-source
```

No-cost dry run:

```bash
npm run flow -- --input=examples/input.sample.csv --dry-run=true --limit=2
```

Small paid run:

```bash
npm run flow -- --input=examples/input.sample.csv --provider=openrouter --limit=2 --max-nav-pages=5
```
