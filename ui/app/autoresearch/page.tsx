"use client";

import { useEffect, useMemo, useState } from "react";

type Leader = {
  model: string;
  cases: number;
  avg_quality_score: number;
  parse_rate: number;
  total_cost_usd?: number;
  avg_cost_per_case_usd: number;
  total_latency_ms?: number;
  avg_latency_ms: number;
  field_total?: number;
  field_correct?: number;
  field_partial?: number;
  field_incorrect?: number;
  field_missing?: number;
  field_accuracy?: number;
  eligible_for_cheapest_pick?: boolean;
};

type FieldBreakdown = {
  model: string;
  field: string;
  field_total: number;
  field_correct: number;
  field_partial: number;
  field_incorrect: number;
  field_missing: number;
  field_accuracy: number;
};

type BenchRun = {
  run_id: string;
  run_dir: string;
  gold_model: string;
  expected_cases: number;
  expected_models: number;
  expected_scores: number;
  scored: number;
  completed_fraction: number;
  gold_cases: number;
  gold_valid_cases?: number;
  gold_invalid_cases?: number;
  gold_missing_cases?: number;
  gold_file_cases?: number;
  best_model?: Leader | null;
  cheapest_eligible_model?: Leader | null;
  leaderboard: Leader[];
  field_summary?: Leader[];
  field_breakdown?: FieldBreakdown[];
  updated_at: string;
};

type AutoData = {
  status?: string;
  artifact_root?: string;
  generated_at?: string;
  state?: any;
  runtime?: any;
  results?: Array<Record<string, string>>;
  benchmark_runs?: BenchRun[];
  logs?: {
    runtime?: string;
    dashboard_publish?: string;
    lessons?: string;
  };
};

export default function AutoresearchPage() {
  const [data, setData] = useState<AutoData>({});
  const [selectedRun, setSelectedRun] = useState("");
  const [showLogs, setShowLogs] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`/api/autoresearch?t=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!cancelled) setData(payload);
    }
    load();
    const timer = setInterval(load, 4500);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const state = data.state?.state || {};
  const config = data.state?.config || {};
  const runs = data.benchmark_runs || [];
  const activeRun = useMemo(() => {
    if (!runs.length) return null;
    return runs.find((run) => run.run_id === selectedRun) || runs[0];
  }, [runs, selectedRun]);
  const best = runs.map((run) => run.cheapest_eligible_model || run.best_model).filter(Boolean)[0] as Leader | undefined;
  const activeModelForFields = activeRun?.cheapest_eligible_model?.model || activeRun?.best_model?.model || activeRun?.leaderboard?.[0]?.model || "";
  const fieldRows = useMemo(() => {
    return (activeRun?.field_breakdown || []).filter((row) => row.model === activeModelForFields).slice(0, 35);
  }, [activeRun, activeModelForFields]);
  const totalScores = runs.reduce((sum, run) => sum + (run.scored || 0), 0);
  const totalExpected = runs.reduce((sum, run) => sum + (run.expected_scores || 0), 0);
  const activeGoldValid = activeRun?.gold_valid_cases ?? activeRun?.gold_cases ?? 0;
  const activeGoldInvalid = activeRun?.gold_invalid_cases ?? 0;
  const activeGoldMissing = activeRun?.gold_missing_cases ?? 0;

  return (
    <main className="ar-shell">
      <nav className="ar-nav">
        <a href="/">Scrape console</a>
        <span>Autoresearch dashboard</span>
        <button onClick={() => setShowLogs(!showLogs)}>{showLogs ? "Hide logs" : "Show logs"}</button>
      </nav>

      <section className="ar-hero">
        <div>
          <div className="ar-eyebrow">Autonomous experiment control plane</div>
          <h1>Model search, gold set, scoreboards, and runtime traces in one place.</h1>
          <p>Tracks the `codex-autoresearch` state files plus the OpenRouter model benchmark runs fed by the same first-party site markdown packets.</p>
        </div>
        <div className="ar-command-card">
          <span className={`ar-state ${data.status || "unknown"}`}>{data.status || "unknown"}</span>
          <strong>{data.state?.run_tag || "no active run tag"}</strong>
          <code>{config.verify || "no verify command recorded"}</code>
          <div className="ar-meter"><i style={{ width: `${percent(totalScores, totalExpected)}%` }} /></div>
          <small>{totalScores.toLocaleString()} / {totalExpected.toLocaleString()} benchmark scores visible</small>
        </div>
      </section>

      <section className="ar-metrics">
        <Metric label="Iteration" value={String(state.iteration ?? 0)} sub={`last: ${state.last_status || "baseline"}`} />
        <Metric label="Current metric" value={fmt(state.current_metric)} sub={`best ${fmt(state.best_metric)}`} />
        <Metric label="Valid gold" value={String(Math.max(...runs.map((run) => run.gold_valid_cases ?? run.gold_cases ?? 0), 0))} sub={activeRun ? `${activeGoldInvalid} invalid · ${activeGoldMissing} missing · ${activeRun.gold_model}` : "gold reference"} />
        <Metric label="Bench scores" value={`${Math.round(percent(totalScores, totalExpected))}%`} sub={`${totalScores} of ${totalExpected}`} />
        <Metric label="Cheapest viable" value={best?.model ? shortModel(best.model) : "none"} sub={best ? `$${fmtMoney(best.avg_cost_per_case_usd)} / case` : "quality floor not cleared"} />
      </section>

      <section className="ar-grid">
        <aside className="ar-panel ar-run-list">
          <h2>Benchmark runs</h2>
          {runs.map((run) => (
            <button className={activeRun?.run_id === run.run_id ? "active" : ""} key={run.run_id} onClick={() => setSelectedRun(run.run_id)}>
              <strong>{run.run_id.replace("site-md-model-benchmark-20-", "")}</strong>
              <span>{run.gold_valid_cases ?? run.gold_cases ?? 0}/{run.expected_cases} gold · {run.scored}/{run.expected_scores} scores</span>
              <i><b style={{ width: `${percent(run.scored, run.expected_scores)}%` }} /></i>
            </button>
          ))}
          {!runs.length ? <div className="ar-empty">No benchmark runs found under `runs/`.</div> : null}
        </aside>

        <section className="ar-panel ar-leaderboard">
          <div className="ar-panel-head">
            <div>
              <h2>{activeRun?.run_id || "No selected run"}</h2>
              <p>{activeRun ? `${activeGoldValid}/${activeRun.expected_cases} valid gold, ${activeGoldInvalid} invalid, ${activeGoldMissing} missing, ${activeRun.expected_models} candidate models, updated ${shortTime(activeRun.updated_at)}` : "Waiting for run artifacts."}</p>
            </div>
            <span className="ar-pill">{activeRun ? `${Math.round(percent(activeRun.scored, activeRun.expected_scores))}% complete` : "idle"}</span>
          </div>
          <div className="ar-table-wrap">
            <table className="ar-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Cases</th>
                  <th>Quality</th>
                  <th>Parse</th>
                  <th>Cost</th>
                  <th>Time</th>
                  <th>Fields vs gold</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(activeRun?.leaderboard || []).map((row) => (
                  <tr key={row.model}>
                    <td><strong>{row.model}</strong></td>
                    <td>{row.cases}</td>
                    <td><Score value={row.avg_quality_score} /></td>
                    <td>{pct(row.parse_rate)}</td>
                    <td><strong>${fmtMoney(row.total_cost_usd)}</strong><small>${fmtMoney(row.avg_cost_per_case_usd)} / case</small></td>
                    <td><strong>{fmtDuration(row.total_latency_ms)}</strong><small>{Math.round(row.avg_latency_ms || 0).toLocaleString()}ms avg</small></td>
                    <td><FieldSplit row={row} /></td>
                    <td><span className={`ar-pill ${row.eligible_for_cheapest_pick ? "good" : "watch"}`}>{row.eligible_for_cheapest_pick ? "eligible" : "watch"}</span></td>
                  </tr>
                ))}
                {!activeRun?.leaderboard?.length ? <tr><td colSpan={8} className="ar-empty">No scored models yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section className="ar-grid lower">
        <section className="ar-panel">
          <div className="ar-panel-head">
            <div>
              <h2>Fields correct / incorrect vs gold</h2>
              <p>{activeModelForFields ? activeModelForFields : "Waiting for a scored model."}</p>
            </div>
            <span className="ar-pill">{fieldRows.length ? `${fieldRows.length} fields` : "empty"}</span>
          </div>
          <div className="ar-table-wrap short">
            <table className="ar-table">
              <thead><tr><th>Field</th><th>Correct</th><th>Partial</th><th>Incorrect</th><th>Missing</th><th>Accuracy</th></tr></thead>
              <tbody>
                {fieldRows.map((row) => (
                  <tr key={`${row.model}-${row.field}`}>
                    <td><strong>{row.field}</strong></td>
                    <td>{row.field_correct}</td>
                    <td>{row.field_partial}</td>
                    <td>{row.field_incorrect}</td>
                    <td>{row.field_missing}</td>
                    <td><Score value={row.field_accuracy} /></td>
                  </tr>
                ))}
                {!fieldRows.length ? <tr><td colSpan={6} className="ar-empty">No field comparison rows yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        {showLogs ? (
          <section className="ar-panel ar-log-panel">
            <h2>Runtime log tail</h2>
            <pre>{data.logs?.runtime || data.logs?.lessons || "No runtime log content yet."}</pre>
          </section>
        ) : null}
      </section>

      <section className="ar-panel ar-iterations">
        <h2>Autoresearch iterations</h2>
        <div className="ar-table-wrap short">
          <table className="ar-table">
            <thead><tr><th>Iteration</th><th>Status</th><th>Metric</th><th>Description</th></tr></thead>
            <tbody>
              {(data.results || []).slice(-12).reverse().map((row, index) => (
                <tr key={`${row.iteration}-${index}`}><td>{row.iteration}</td><td>{row.status}</td><td>{row.metric}</td><td>{row.description}</td></tr>
              ))}
              {!data.results?.length ? <tr><td colSpan={4} className="ar-empty">No iteration rows beyond baseline yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="ar-footer">
        <span>Artifacts: {data.artifact_root || "missing"}</span>
        <span>Refreshed {shortTime(data.generated_at)}</span>
      </footer>
    </main>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="ar-metric"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

function Score({ value }: { value: number }) {
  return <div className="ar-score"><span style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /><b>{value.toFixed(3)}</b></div>;
}

function FieldSplit({ row }: { row: Leader }) {
  const total = row.field_total || 0;
  const correctPct = percent(row.field_correct || 0, total);
  const partialPct = percent(row.field_partial || 0, total);
  const missingPct = percent(row.field_missing || 0, total);
  const incorrect = row.field_incorrect || 0;
  return (
    <div className="ar-field-split">
      <div className="ar-field-bars">
        <i className="ok" style={{ width: `${correctPct}%` }} />
        <i className="partial" style={{ width: `${partialPct}%` }} />
        <i className="missing" style={{ width: `${missingPct}%` }} />
      </div>
      <small>{row.field_correct || 0} correct · {row.field_partial || 0} partial · {incorrect} incorrect · {row.field_missing || 0} missing</small>
    </div>
  );
}

function percent(done?: number, total?: number) {
  return total ? Math.min(100, ((done || 0) / total) * 100) : 0;
}

function pct(value?: number) {
  return `${Math.round((value || 0) * 100)}%`;
}

function fmt(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(3).replace(/\.000$/, "") : "0";
}

function fmtMoney(value?: number) {
  return Number(value || 0).toFixed(6).replace(/0+$/, "0");
}

function fmtDuration(value?: number) {
  const ms = Number(value || 0);
  if (!ms) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function shortModel(value: string) {
  return value.replace(/^openai\//, "").replace(/^google\//, "").replace(/^mistralai\//, "").slice(0, 24);
}

function shortTime(value?: string) {
  if (!value) return "-";
  try { return new Date(value).toLocaleString(); } catch { return value; }
}
