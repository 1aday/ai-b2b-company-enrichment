"use client";

import { useEffect, useMemo, useState } from "react";

type Entity = {
  row_index: number;
  company_name: string;
  legal_name: string;
  domain: string;
  website_url: string;
  status: string;
  successful_sources: number;
  failed_sources: number;
  logo_url: string;
  logo_source: string;
  favicon_url: string;
  favicon_source: string;
  full_address: string;
  postal_code: string;
  address_source: string;
  address_confidence: string;
  city: string;
  state: string;
  country: string;
  investor_type: string;
  industry_primary: string;
  final_contact_count: string;
  sources?: Array<{ source_family: string; fetch_status: string; http_status: number; requested_url: string; got: string }>;
};

type Progress = {
  status?: string;
  message?: string;
  run_id?: string;
  input_path?: string;
  started_at?: string;
  updated_at?: string;
  total_entities?: number;
  completed_entities?: number;
  successful_entities?: number;
  failed_entities?: number;
  empty_entities?: number;
  source_ok?: number;
  source_failed?: number;
  logo_count?: number;
  favicon_count?: number;
  address_count?: number;
  postal_code_count?: number;
  rate_per_minute?: number;
  eta?: string;
  current_entity?: string;
  cloudflare_bucket?: string;
  cloudflare_prefix?: string;
  cloudflare_last_sync_at?: string;
  cloudflare_last_error?: string;
  output_files?: Record<string, string>;
  recent_entities?: Entity[];
  files?: { entities_csv_size?: number; sources_csv_size?: number };
  generated_at?: string;
};

const steps = [
  ["1", "Load master file", "Read 89k entity rows, preserve existing firm metadata."],
  ["2", "Scrape first party", "Fetch homepage/contact pages and store markdown evidence."],
  ["3", "Extract assets", "Prefer CSV logo, then scraped logo, then favicon fallback."],
  ["4", "Address pass", "Keep city/state/country and add best-effort street/ZIP from site text."],
  ["5", "Cloudflare R2", "Checkpoint CSV/progress and upload final archive to R2."],
];

export default function Page() {
  const [data, setData] = useState<Progress>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`/api/progress?t=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!cancelled) setData(payload);
    }
    load();
    const timer = setInterval(load, 3500);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const pct = percent(data.completed_entities || 0, data.total_entities || 0);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data.recent_entities || []).filter((row) => {
      const text = `${row.company_name} ${row.domain} ${row.investor_type} ${row.city} ${row.state} ${row.country}`.toLowerCase();
      const issue = !row.logo_url || !row.favicon_url || !row.postal_code || row.failed_sources > 0;
      return (!needle || text.includes(needle)) && (!onlyIssues || issue);
    });
  }, [data.recent_entities, query, onlyIssues]);

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Capital Signal enrichment console</div>
          <a className="top-link" href="/autoresearch">Open autoresearch dashboard</a>
          <h1>Entity scrape, asset capture, address pass, Cloudflare archive.</h1>
          <p>Live command center for the Desktop investor-company master file. Every row is tracked from source fetch to logo, favicon, address, ZIP, local artifacts, and R2 storage.</p>
        </div>
        <div className="orbital-card">
          <div className="ring" />
          <div className="run-label">{data.status || "idle"}</div>
          <div className="run-id">{data.run_id || data.message || "waiting for active run"}</div>
          <div className="meter"><span style={{ width: `${pct}%` }} /></div>
          <div className="meter-row"><span>{pct.toFixed(1)}%</span><span>{number(data.completed_entities)} / {number(data.total_entities)}</span></div>
        </div>
      </section>

      <section className="metrics">
        <Metric label="Entities" value={number(data.completed_entities)} sub={`of ${number(data.total_entities)}`} tone="blue" />
        <Metric label="Source OK" value={number(data.source_ok)} sub={`${number(data.source_failed)} failed`} tone="green" />
        <Metric label="Logos" value={number(data.logo_count)} sub={`${number(data.favicon_count)} favicons`} tone="gold" />
        <Metric label="Addresses" value={number(data.address_count)} sub={`${number(data.postal_code_count)} ZIP/postal`} tone="rose" />
        <Metric label="Rate" value={`${data.rate_per_minute || 0}/m`} sub={`ETA ${data.eta || "calculating"}`} tone="ink" />
      </section>

      <section className="workspace">
        <aside className="rail">
          <div className="panel storage-panel">
            <h2>Storage state</h2>
            <div className="storage-line"><span>R2 bucket</span><strong>{data.cloudflare_bucket || "not enabled"}</strong></div>
            <div className="storage-line"><span>Prefix</span><strong>{data.cloudflare_prefix || "-"}</strong></div>
            <div className="storage-line"><span>Last sync</span><strong>{shortTime(data.cloudflare_last_sync_at)}</strong></div>
            {data.cloudflare_last_error ? <div className="error-box">{data.cloudflare_last_error}</div> : <div className="ok-box">Cloudflare credentials active when sync timestamp appears.</div>}
          </div>
          <div className="panel steps-panel">
            <h2>Pipeline steps</h2>
            {steps.map(([n, title, body], index) => <div className="step" key={title}><b>{n}</b><div><strong>{title}</strong><span>{body}</span></div><i className={index < completedStep(data) ? "done" : ""} /></div>)}
          </div>
        </aside>

        <section className="panel table-panel">
          <div className="table-head">
            <div>
              <h2>Recent enriched entities</h2>
              <p>Color-coded by provenance: CSV, scraped site, fallback, or missing.</p>
            </div>
            <div className="controls">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recent rows" />
              <button className={onlyIssues ? "active" : ""} onClick={() => setOnlyIssues(!onlyIssues)}>Issues only</button>
            </div>
          </div>
          <div className="current-line">Current entity: <strong>{data.current_entity || "starting"}</strong> <span>Updated {shortTime(data.generated_at || data.updated_at)}</span></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Type</th>
                  <th>Logo</th>
                  <th>Favicon</th>
                  <th>Address</th>
                  <th>ZIP</th>
                  <th>Sources</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => <EntityRow key={`${row.row_index}-${row.domain}`} row={row} />)}
                {!rows.length ? <tr><td colSpan={7} className="empty">No rows match yet. The run may still be starting.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function EntityRow({ row }: { row: Entity }) {
  return (
    <tr>
      <td>
        <div className="entity-name">{row.logo_url ? <img src={row.logo_url} alt="" /> : <span className="logo-hole" />}<div><strong>{row.company_name}</strong><small>{row.domain}</small></div></div>
      </td>
      <td><Chip tone={row.investor_type ? "csv" : "missing"}>{row.investor_type || "missing"}</Chip><small>{row.industry_primary}</small></td>
      <td><Chip tone={toneFor(row.logo_source)}>{label(row.logo_source)}</Chip></td>
      <td><Chip tone={toneFor(row.favicon_source)}>{label(row.favicon_source)}</Chip></td>
      <td><div className="address"><Chip tone={row.full_address ? "csv" : "missing"}>{row.address_confidence || "none"}</Chip><span>{row.full_address || "missing"}</span></div></td>
      <td><Chip tone={row.postal_code ? "scraped" : "missing"}>{row.postal_code || "missing"}</Chip></td>
      <td><div className="sources"><Chip tone="scraped">{row.successful_sources} ok</Chip><Chip tone={row.failed_sources ? "missing" : "csv"}>{row.failed_sources} fail</Chip></div></td>
    </tr>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

function percent(done: number, total: number) {
  return total ? Math.min(100, (done / total) * 100) : 0;
}

function number(value?: number) {
  return (value || 0).toLocaleString();
}

function shortTime(value?: string) {
  if (!value) return "-";
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function completedStep(data: Progress) {
  if (!data.completed_entities) return 1;
  if (data.cloudflare_last_sync_at) return 5;
  if (data.address_count || data.postal_code_count) return 4;
  if (data.logo_count || data.favicon_count) return 3;
  if (data.source_ok || data.source_failed) return 2;
  return 1;
}

function toneFor(source?: string) {
  if (!source) return "missing";
  if (source.includes("csv")) return "csv";
  if (source.includes("fallback")) return "fallback";
  return "scraped";
}

function label(value?: string) {
  return value ? value.replaceAll("_", " ") : "missing";
}
