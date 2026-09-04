import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getPreset } from "./presets/index.js";
import { DEFAULT_SOURCE_CSV, ensureDir, nowStamp, numberValue, parseArgs, writeJson } from "./shared.js";

const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
const preset = getPreset(args.preset);
const provider = args.provider ?? "openrouter";
if (!["fixture", "openrouter"].includes(provider)) throw new Error(`Unknown provider: ${provider}`);
if (preset.id === "capital-source" && args.icp) throw new Error("--icp is available only for --preset=company.");

const inputPath = path.resolve(args.input ?? DEFAULT_SOURCE_CSV);
const runId = args["run-id"] ?? `${preset.id}-flow-${nowStamp()}`;
const flowRoot = path.resolve(args.outdir ?? path.join(rootDir, "runs", runId));
const scrapeRunId = `${runId}-scrape`;
const scrapeRunsRoot = path.join(flowRoot, "scrape-runs");
const scrapeRunDir = path.join(scrapeRunsRoot, scrapeRunId);
const generatedPacketRoot = path.join(scrapeRunDir, "prepared_for_llm");
const packetRoot = provider === "fixture"
  ? path.resolve(args["packet-root"] ?? path.join(rootDir, "examples", "fixtures", "prepared_for_llm"))
  : generatedPacketRoot;
const enrichmentDir = path.join(flowRoot, "enrichment");
const limit = numberValue(args.limit, 0);
const offset = numberValue(args.offset, 0);
const scrapeConcurrency = Math.max(1, numberValue(args["scrape-concurrency"], 12));
const enrichConcurrency = Math.max(1, numberValue(args["enrich-concurrency"], 3));
const maxNavPages = Math.max(0, numberValue(args["max-nav-pages"], 0));
const scrapeTimeoutMs = Math.max(1_000, numberValue(args["scrape-timeout-ms"], 10_000));
const maxEntityMs = Math.max(0, numberValue(args["max-entity-ms"] ?? args["entity-timeout-ms"], 120_000));
const model = args.model ?? (preset.id === "capital-source" ? "nvidia/nemotron-3-super-120b-a12b" : "openai/gpt-4.1-mini");
const baseUrl = args["base-url"] ?? "https://openrouter.ai/api/v1";
const maxMarkdownChars = Math.max(4_000, numberValue(args["max-md-chars"], 120_000));
const maxTotalChars = Math.max(maxMarkdownChars, numberValue(args["prepare-max-total-chars"], maxMarkdownChars));
const maxCharsPerPage = Math.max(2_000, numberValue(args["prepare-max-chars-per-page"], 60_000));
const maxOutputTokens = Math.max(1_000, numberValue(args["max-output-tokens"], 8_000));
const enrichTimeoutMs = Math.max(10_000, numberValue(args["enrich-timeout-ms"], 120_000));
const retries = Math.max(0, numberValue(args.retries, 2));
const dryRun = args["dry-run"] === "true";

if (provider === "openrouter" && !existsSync(inputPath)) throw new Error(`Input CSV not found: ${inputPath}`);
if (provider === "fixture" && !existsSync(packetRoot)) throw new Error(`Fixture packet root not found: ${packetRoot}`);
ensureDir(flowRoot);

const startedAt = new Date().toISOString();
const manifestPath = path.join(flowRoot, "flow-manifest.json");
const steps: Array<Record<string, unknown>> = [];
writeManifest("running");

if (provider === "openrouter") {
  runStep("scrape_company_websites", [
    "tsx",
    "src/scrape-company-websites.ts",
    `--input=${inputPath}`,
    `--outdir=${scrapeRunsRoot}`,
    `--run-id=${scrapeRunId}`,
    `--offset=${offset}`,
    `--limit=${limit}`,
    `--concurrency=${scrapeConcurrency}`,
    `--timeout-ms=${scrapeTimeoutMs}`,
    `--max-entity-ms=${maxEntityMs}`,
    `--site-pages=${args["site-pages"] ?? "home"}`,
    "--scrape-nav-pages=true",
    `--max-nav-pages=${maxNavPages}`,
  ]);

  runStep("prepare_evidence_packets", [
    "tsx",
    "src/prepare-company-llm-packets.ts",
    `--run-dir=${scrapeRunDir}`,
    `--outdir=${generatedPacketRoot}`,
    `--limit=${limit}`,
    "--offset=0",
    "--max-pages-per-company=999",
    `--max-chars-per-page=${maxCharsPerPage}`,
    `--max-total-chars=${maxTotalChars}`,
  ]);
}

const enrichmentCommand = preset.id === "capital-source" && provider === "openrouter"
  ? [
      "tsx", "src/enrich-prepared-packets.ts",
      `--packet-root=${packetRoot}`,
      `--outdir=${enrichmentDir}`,
      `--run-id=${runId}-capital-source`,
      `--model=${model}`,
      `--base-url=${baseUrl}`,
      `--concurrency=${enrichConcurrency}`,
      `--timeout-ms=${enrichTimeoutMs}`,
      `--retries=${retries}`,
      `--max-output-tokens=${maxOutputTokens}`,
      `--max-md-chars=${maxMarkdownChars}`,
    ]
  : [
      "tsx", "src/enrich-company-packets.ts",
      `--preset=${preset.id}`,
      `--provider=${provider}`,
      `--packet-root=${packetRoot}`,
      `--outdir=${enrichmentDir}`,
      `--run-id=${runId}-enrichment`,
      `--model=${model}`,
      `--base-url=${baseUrl}`,
      `--concurrency=${enrichConcurrency}`,
      `--timeout-ms=${enrichTimeoutMs}`,
      `--retries=${retries}`,
      `--max-output-tokens=${maxOutputTokens}`,
      `--max-md-chars=${maxMarkdownChars}`,
      ...(args.icp ? [`--icp=${path.resolve(args.icp)}`] : []),
    ];

runStep("enrich_accounts", enrichmentCommand);
writeManifest("completed");

console.log(JSON.stringify({
  run_id: runId,
  status: "completed",
  preset: preset.id,
  provider,
  flow_root: flowRoot,
  packet_root: packetRoot,
  enrichment_dir: enrichmentDir,
  enriched_csv: path.join(enrichmentDir, "enriched.csv"),
  manifest: manifestPath,
}, null, 2));

function runStep(name: string, command: string[]) {
  const logPath = path.join(flowRoot, `${name}.log`);
  const step = { name, status: dryRun ? "dry_run" : "running", started_at: new Date().toISOString(), finished_at: "", command, log_path: logPath };
  steps.push(step);
  writeManifest("running");
  if (dryRun) {
    step.finished_at = new Date().toISOString();
    writeFileSync(logPath, `${command.join(" ")}\n`);
    return;
  }
  const result = spawnSync("npx", command, {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 24 * 60 * 60 * 1_000,
    maxBuffer: 80 * 1_024 * 1_024,
  });
  writeFileSync(logPath, [`$ npx ${command.join(" ")}`, "", "STDOUT:", result.stdout ?? "", "", "STDERR:", result.stderr ?? ""].join("\n"));
  step.status = result.status === 0 ? "completed" : "failed";
  step.finished_at = new Date().toISOString();
  writeManifest(result.status === 0 ? "running" : "failed");
  if (result.status !== 0) throw new Error(`Step failed: ${name}. See ${logPath}\n${(result.stderr || result.stdout || "").slice(-2_000)}`);
}

function writeManifest(status: "running" | "completed" | "failed") {
  writeJson(manifestPath, {
    run_id: runId,
    status,
    preset: preset.id,
    provider,
    input_csv: provider === "openrouter" ? inputPath : null,
    packet_root: packetRoot,
    icp_file: args.icp ? path.resolve(args.icp) : null,
    account_level_only: true,
    personal_contact_discovery: false,
    started_at: startedAt,
    updated_at: new Date().toISOString(),
    finished_at: status === "completed" || status === "failed" ? new Date().toISOString() : "",
    model,
    retries,
    output_files: {
      flow_manifest: manifestPath,
      scrape_summary: path.join(scrapeRunDir, `${scrapeRunId}.summary.json`),
      prepared_quality: path.join(packetRoot, "_quality_report.json"),
      enriched_csv: path.join(enrichmentDir, "enriched.csv"),
      enriched_index: path.join(enrichmentDir, "enriched-index.json"),
      enrichment_summary: path.join(enrichmentDir, "summary.json"),
    },
    enrichment_summary: readJsonIfExists(path.join(enrichmentDir, "summary.json")),
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
