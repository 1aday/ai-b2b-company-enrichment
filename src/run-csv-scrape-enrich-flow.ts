import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_INVESTOR_COMPANIES_SOURCE_CSV, ensureDir, nowStamp, numberValue, parseArgs, writeJson } from "./shared.js";

const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
const inputPath = path.resolve(args.input ?? DEFAULT_INVESTOR_COMPANIES_SOURCE_CSV);
if (!existsSync(inputPath)) throw new Error(`Input CSV not found: ${inputPath}`);

const runId = args["run-id"] ?? `csv-llm-flow-${nowStamp()}`;
const flowRoot = path.resolve(args.outdir ?? path.join(rootDir, "runs", runId));
const scrapeRunId = `${runId}-scrape`;
const scrapeRunsRoot = path.join(flowRoot, "scrape-runs");
const scrapeRunDir = path.join(scrapeRunsRoot, scrapeRunId);
const packetRoot = path.join(scrapeRunDir, "prepared_for_llm");
const enrichOutdir = path.join(flowRoot, "llm-enrichment");
const limit = numberValue(args.limit, 0);
const offset = numberValue(args.offset, 0);
const scrapeConcurrency = Math.max(1, numberValue(args["scrape-concurrency"], 12));
const enrichConcurrency = Math.max(1, numberValue(args["enrich-concurrency"], 4));
const maxNavPages = Math.max(0, numberValue(args["max-nav-pages"], 0));
const timeoutMs = Math.max(1_000, numberValue(args["scrape-timeout-ms"], 10_000));
const maxEntityMs = Math.max(0, numberValue(args["max-entity-ms"] ?? args["entity-timeout-ms"], 120_000));
const model = args.model ?? "nvidia/nemotron-3-super-120b-a12b";
const baseUrl = args["base-url"] ?? "https://openrouter.ai/api/v1";
const maxMdChars = Math.max(4_000, numberValue(args["max-md-chars"], 140_000));
const maxTotalChars = Math.max(maxMdChars, numberValue(args["prepare-max-total-chars"], maxMdChars));
const maxCharsPerPage = Math.max(2_000, numberValue(args["prepare-max-chars-per-page"], 60_000));
const maxOutputTokens = Math.max(1_000, numberValue(args["max-output-tokens"], 12_000));
const enrichTimeoutMs = Math.max(10_000, numberValue(args["enrich-timeout-ms"], 120_000));
const retries = Math.max(0, numberValue(args.retries, 2));
const dryRun = args["dry-run"] === "true";

ensureDir(flowRoot);

const startedAt = new Date().toISOString();
const manifestPath = path.join(flowRoot, "flow-manifest.json");
const steps: Array<Record<string, unknown>> = [];
writeManifest("running");

runStep("scrape_markdown", [
  "tsx",
  "src/enrich-investor-companies-master.ts",
  `--input=${inputPath}`,
  `--outdir=${scrapeRunsRoot}`,
  `--run-id=${scrapeRunId}`,
  `--offset=${offset}`,
  `--limit=${limit}`,
  `--concurrency=${scrapeConcurrency}`,
  `--timeout-ms=${timeoutMs}`,
  `--max-entity-ms=${maxEntityMs}`,
  `--site-pages=${args["site-pages"] ?? "home"}`,
  "--scrape-nav-pages=true",
  `--max-nav-pages=${maxNavPages}`,
  `--terminal-every=${Math.max(1, numberValue(args["terminal-every"], 25))}`,
  `--progress-every=${Math.max(1, numberValue(args["progress-every"], 10))}`,
]);

runStep("prepare_llm_packets", [
  "tsx",
  "src/prepare-company-llm-packets.ts",
  `--run-dir=${scrapeRunDir}`,
  `--outdir=${packetRoot}`,
  `--limit=${limit}`,
  "--offset=0",
  "--max-pages-per-company=999",
  `--max-chars-per-page=${maxCharsPerPage}`,
  `--max-total-chars=${maxTotalChars}`,
]);

runStep("llm_enrichment", [
  "tsx",
  "src/enrich-prepared-packets.ts",
  `--packet-root=${packetRoot}`,
  `--outdir=${enrichOutdir}`,
  `--run-id=${runId}-llm-enrichment`,
  `--model=${model}`,
  `--base-url=${baseUrl}`,
  `--concurrency=${enrichConcurrency}`,
  `--timeout-ms=${enrichTimeoutMs}`,
  `--retries=${retries}`,
  `--max-output-tokens=${maxOutputTokens}`,
  `--max-md-chars=${maxMdChars}`,
]);

writeManifest("completed");
console.log(JSON.stringify({
  run_id: runId,
  status: "completed",
  flow_root: flowRoot,
  scrape_run_dir: scrapeRunDir,
  packet_root: packetRoot,
  enrichment_dir: enrichOutdir,
  enriched_csv: path.join(enrichOutdir, "enriched.csv"),
  enriched_json: path.join(enrichOutdir, "enriched_json"),
  manifest: manifestPath,
}, null, 2));

function runStep(name: string, command: string[]) {
  const started = new Date().toISOString();
  const logPath = path.join(flowRoot, `${name}.log`);
  const step = { name, status: dryRun ? "dry_run" : "running", started_at: started, finished_at: "", command, log_path: logPath };
  steps.push(step);
  writeManifest("running");
  if (dryRun) {
    step.finished_at = new Date().toISOString();
    writeFileSync(logPath, `${command.join(" ")}\n`);
    writeManifest("running");
    return;
  }
  const result = spawnSync("npx", command, {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 24 * 60 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 80,
  });
  writeFileSync(logPath, [
    `$ npx ${command.join(" ")}`,
    "",
    "STDOUT:",
    result.stdout ?? "",
    "",
    "STDERR:",
    result.stderr ?? "",
  ].join("\n"));
  step.status = result.status === 0 ? "completed" : "failed";
  step.finished_at = new Date().toISOString();
  writeManifest(result.status === 0 ? "running" : "failed");
  if (result.status !== 0) {
    throw new Error(`Step failed: ${name}. See ${logPath}\n${(result.stderr || result.stdout || "").slice(-2000)}`);
  }
}

function writeManifest(status: "running" | "completed" | "failed") {
  writeJson(manifestPath, {
    run_id: runId,
    status,
    input_csv: inputPath,
    started_at: startedAt,
    updated_at: new Date().toISOString(),
    finished_at: status === "completed" || status === "failed" ? new Date().toISOString() : "",
    model,
    provider: "openrouter",
    base_url: baseUrl,
    retries,
    scrape_run_dir: scrapeRunDir,
    packet_root: packetRoot,
    enrichment_dir: enrichOutdir,
    output_files: {
      flow_manifest: manifestPath,
      scrape_progress: path.join(scrapeRunDir, `${scrapeRunId}.progress.json`),
      scrape_summary: path.join(scrapeRunDir, `${scrapeRunId}.summary.json`),
      prepared_quality: path.join(packetRoot, "_quality_report.json"),
      enriched_csv: path.join(enrichOutdir, "enriched.csv"),
      enriched_index: path.join(enrichOutdir, "enriched-index.json"),
      enriched_json_dir: path.join(enrichOutdir, "enriched_json"),
      enrichment_summary: path.join(enrichOutdir, "summary.json"),
    },
    scrape_progress: readJsonIfExists(path.join(scrapeRunDir, `${scrapeRunId}.progress.json`)),
    enrichment_summary: readJsonIfExists(path.join(enrichOutdir, "summary.json")),
    steps,
  });
}

function readJsonIfExists(filePath: string) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
