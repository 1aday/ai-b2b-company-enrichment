"use client";

import { useEffect, useMemo, useState } from "react";

import { benchmarkRows, companies, pipelineSteps } from "../data/demo";

type DemoState = "ready" | "running" | "complete";

export default function Page() {
  const [selectedId, setSelectedId] = useState(companies[0].id);
  const [withIcp, setWithIcp] = useState(true);
  const [demoState, setDemoState] = useState<DemoState>("ready");
  const [activeStep, setActiveStep] = useState(0);
  const company = useMemo(() => companies.find((item) => item.id === selectedId) ?? companies[0], [selectedId]);

  useEffect(() => {
    if (demoState !== "running") return;
    const timer = window.setInterval(() => {
      setActiveStep((current) => {
        if (current >= pipelineSteps.length - 1) {
          window.clearInterval(timer);
          setDemoState("complete");
          return current;
        }
        return current + 1;
      });
    }, 520);
    return () => window.clearInterval(timer);
  }, [demoState]);

  function runDemo() {
    setActiveStep(0);
    setDemoState("running");
  }

  return (
    <main>
      <header className="nav shell">
        <a className="brand" href="#top" aria-label="SignalForge home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>SignalForge <small>company intelligence</small></span>
        </a>
        <div className="nav-links">
          <a href="#profiles">Profiles</a>
          <a href="#evidence">Evidence</a>
          <a href="#benchmarks">Benchmarks</a>
        </div>
        <a className="ghost-button" href="https://github.com/1aday/ai-b2b-company-enrichment">View source ↗</a>
      </header>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <div className="kicker"><span>Sample workspace</span> No keys · no paid calls</div>
          <h1>Turn a company list into <em>evidence you can act on.</em></h1>
          <p>Scrape first-party sources, structure B2B account intelligence, qualify against an optional ICP, and keep every material claim connected to its evidence.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={runDemo} disabled={demoState === "running"}>
              {demoState === "running" ? "Running fixture…" : demoState === "complete" ? "Run sample again" : "Run sample pipeline"}
            </button>
            <code>npm run fixture</code>
          </div>
          <div className="proof-strip">
            <div><strong>4</strong><span>identity fields required</span></div>
            <div><strong>$0</strong><span>fixture demo cost</span></div>
            <div><strong>2</strong><span>presets included</span></div>
          </div>
        </div>

        <div className="pipeline-card" aria-live="polite">
          <div className="panel-heading">
            <div><span className="overline">Pipeline run</span><h2>Evidence → account record</h2></div>
            <span className={`state-pill ${demoState}`}>{demoState}</span>
          </div>
          <div className="flow-line" />
          <div className="pipeline-list">
            {pipelineSteps.map((step, index) => {
              const complete = demoState === "complete" || (demoState === "running" && index < activeStep);
              const active = demoState === "running" && index === activeStep;
              return (
                <div className={`pipeline-step ${complete ? "complete" : ""} ${active ? "active" : ""}`} key={step.label}>
                  <b>{complete ? "✓" : index + 1}</b>
                  <div><strong>{step.label}</strong><span>{step.detail}</span></div>
                  <i>{complete ? "done" : active ? "working" : "queued"}</i>
                </div>
              );
            })}
          </div>
          <div className="run-footer"><span>fixture/deterministic-v1</span><strong>{demoState === "complete" ? "1 valid record" : "Local simulation"}</strong></div>
        </div>
      </section>

      <section className="workspace shell" id="profiles">
        <aside className="account-list panel">
          <div className="panel-heading compact">
            <div><span className="overline">Sample accounts</span><h2>Research queue</h2></div>
            <span className="count">{companies.length}</span>
          </div>
          <div className="accounts">
            {companies.map((item) => (
              <button className={item.id === company.id ? "selected" : ""} key={item.id} onClick={() => setSelectedId(item.id)}>
                <span className={`monogram ${item.id}`}>{item.monogram}</span>
                <span className="account-copy"><strong>{item.name}</strong><small>{item.industry}</small></span>
                <span className={`fit-dot ${item.status}`} />
              </button>
            ))}
          </div>
          <div className="preset-control">
            <div><strong>ICP qualification</strong><span>Optional scoring layer</span></div>
            <button className={withIcp ? "toggle on" : "toggle"} onClick={() => setWithIcp((value) => !value)} aria-pressed={withIcp}><i /></button>
          </div>
          <div className="safety-note"><b>Account-level only</b><span>No people, personal emails, or contact discovery.</span></div>
        </aside>

        <section className="profile-stack">
          <article className="profile-card panel">
            <div className="profile-top">
              <span className={`large-monogram ${company.id}`}>{company.monogram}</span>
              <div className="profile-title"><span className="overline">Enriched company profile</span><h2>{company.name}</h2><p>{company.domain} · {company.industry}</p></div>
              <ConfidenceRing value={company.confidence} />
            </div>
            <p className="company-summary">{company.summary}</p>
            <div className="facts-grid">
              <Fact label="Business model" value={company.businessModel} />
              <Fact label="Company type" value={company.companyType} />
              <Fact label="Geographies" value={company.geographies.join(" · ")} />
              <Fact label="Evidence coverage" value={`${Math.round(company.coverage * 100)}%`} />
            </div>
            <div className="offer-grid">
              <TagGroup title="Offering" values={company.offering} />
              <TagGroup title="Target customers" values={company.targetCustomers} />
            </div>
          </article>

          <div className="split-grid">
            <article className="qualification panel">
              <div className="panel-heading compact">
                <div><span className="overline">Qualification</span><h2>{withIcp ? labelStatus(company.status) : "Not scored"}</h2></div>
                <div className={`score-badge ${withIcp ? company.status : "off"}`}>{withIcp ? company.score : "—"}<small>{withIcp ? "/ 100" : "no ICP"}</small></div>
              </div>
              {withIcp ? <>
                <div className="score-track"><i style={{ width: `${company.score}%` }} /></div>
                <ListBlock title="Matched criteria" values={company.matched} positive />
                <ListBlock title="Evidence gaps" values={company.gaps} />
              </> : <div className="not-scored"><strong>qualification.status = not_scored</strong><p>No score is generated when an ICP is absent. The enrichment record remains useful without a fabricated fit number.</p></div>}
            </article>

            <article className="signals panel">
              <span className="overline">Commercial signals</span><h2>What the sources support</h2>
              <div className="signal-list">
                {company.signals.map((signal) => <div key={signal.label}><i className={signal.kind} /><div><strong>{signal.label}</strong><span>{signal.detail}</span></div></div>)}
              </div>
            </article>
          </div>
        </section>
      </section>

      <section className="lower-grid shell" id="evidence">
        <article className="evidence panel">
          <div className="panel-heading">
            <div><span className="overline">Source evidence</span><h2>Claims stay traceable</h2></div>
            <span className="verified-pill">{company.evidence.length} cited claims</span>
          </div>
          <div className="evidence-list">
            {company.evidence.map((item) => (
              <div className="evidence-row" key={`${item.field}-${item.source}`}>
                <div><code>{item.field}</code><p>{item.claim}</p></div>
                <div className="evidence-meta"><strong>{Math.round(item.confidence * 100)}%</strong><span>official site {item.source}</span></div>
              </div>
            ))}
          </div>
        </article>

        <article className="outreach panel">
          <span className="overline">Outreach context</span><h2>Useful, cautious angles</h2>
          <div className="angle-list">{company.outreach.map((angle, index) => <div key={angle}><b>0{index + 1}</b><p>{angle}</p></div>)}</div>
          <div className="guardrail"><strong>Grounded hypotheses only</strong><span>These prompts do not claim an unverified pain point or buying intent.</span></div>
        </article>
      </section>

      <section className="benchmark-section shell" id="benchmarks">
        <div className="section-intro"><span className="overline">Provider benchmark</span><h2>Compare quality, reliability, and cost without hiding the gaps.</h2><p>The public sample verifies the deterministic fixture path. Paid models remain visibly untested until a private key-backed run creates evidence.</p></div>
        <div className="benchmark-table panel">
          <div className="benchmark-row benchmark-head"><span>Provider / model</span><span>Role</span><span>Parse</span><span>Quality</span><span>Cost / account</span><span>Status</span></div>
          {benchmarkRows.map((row) => <div className="benchmark-row" key={row.model}><strong>{row.model}</strong><span>{row.role}</span><span>{row.parse}</span><span>{row.quality}</span><span>{row.cost}</span><i className={row.status === "verified" ? "verified" : "locked"}>{row.status}</i></div>)}
        </div>
      </section>

      <footer className="footer shell"><strong>SignalForge</strong><span>Fictional company fixtures · static sample mode · no API keys · no paid calls</span><a href="#top">Back to top ↑</a></footer>
    </main>
  );
}

function ConfidenceRing({ value }: { value: number }) {
  return <div className="confidence-ring" style={{ "--score": `${value * 360}deg` } as React.CSSProperties}><div><strong>{Math.round(value * 100)}%</strong><span>confidence</span></div></div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="fact"><span>{label}</span><strong>{value}</strong></div>;
}

function TagGroup({ title, values }: { title: string; values: string[] }) {
  return <div><h3>{title}</h3><div className="tag-list">{values.map((value) => <span key={value}>{value}</span>)}</div></div>;
}

function ListBlock({ title, values, positive = false }: { title: string; values: string[]; positive?: boolean }) {
  return <div className="list-block"><h3>{title}</h3>{values.map((value) => <p key={value}><i className={positive ? "positive" : "gap"}>{positive ? "✓" : "!"}</i>{value}</p>)}</div>;
}

function labelStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
