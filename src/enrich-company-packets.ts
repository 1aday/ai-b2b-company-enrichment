import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { icpPrompt, loadIcp, type IcpDefinition } from "./icp.js";
import { isEmptyScrapedPacket, isRetryableResponse, mergeValidation, validateQualificationMode } from "./enrichment-validation.js";
import { getPreset } from "./presets/index.js";
import type { EnrichmentPreset } from "./presets/types.js";
import { compact, ensureDir, loadLocalEnv, nowStamp, numberValue, parseArgs, parseJsonObject, slug, writeCsv, writeJson } from "./shared.js";

type Provider = "fixture" | "openrouter";

type PacketCase = {
  caseId: string;
  directory: string;
  markdownPath: string;
  markdown: string;
  packet: Record<string, unknown>;
  entity: Record<string, unknown>;
};

type ProviderResult = {
  ok: boolean;
  parsed: Record<string, unknown> | null;
  rawText: string;
  responseId: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  elapsedMs: number;
  error: string;
};

type OutputIndexRow = Record<string, unknown> & {
  case_id: string;
  preset: string;
  provider: Provider;
  model: string;
  ok: boolean;
  validation_errors: string;
  cost_usd: number;
  latency_ms: number;
  json_file: string;
  response_file: string;
  packet_path: string;
};

const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
loadLocalEnv(rootDir);

const preset = getPreset(args.preset);
const provider = providerValue(args.provider);
if (preset.id === "capital-source" && args.icp) throw new Error("--icp is supported only by the company preset.");
if (provider === "openrouter" && preset.id !== "company") {
  throw new Error("OpenRouter capital-source runs use npm run flow:capital-source so the validated legacy execution path remains unchanged.");
}

const packetRoot = path.resolve(args["packet-root"] ?? "examples/fixtures/prepared_for_llm");
if (!existsSync(packetRoot)) throw new Error(`Packet root not found: ${packetRoot}`);
const icp = loadIcp(args.icp);
const runId = args["run-id"] ?? `${preset.id}-enrichment-${nowStamp()}`;
const outdir = path.resolve(args.outdir ?? path.join(rootDir, "runs", runId));
const model = provider === "fixture" ? "fixture/deterministic-v1" : args.model ?? "openai/gpt-4.1-mini";
const baseUrl = (args["base-url"] ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
const apiKey = args["api-key"] ?? process.env.OPENROUTER_API_KEY;
const limit = Math.max(0, numberValue(args.limit, 0));
const offset = Math.max(0, numberValue(args.offset, 0));
const concurrency = Math.max(1, numberValue(args.concurrency, 3));
const timeoutMs = Math.max(10_000, numberValue(args["timeout-ms"], 120_000));
const retries = Math.max(0, numberValue(args.retries, 2));
const maxOutputTokens = Math.max(1_000, numberValue(args["max-output-tokens"], 8_000));
const maxMarkdownChars = Math.max(4_000, numberValue(args["max-md-chars"], 120_000));
const inputCostPer1m = Math.max(0, numberValue(args["input-cost-per-1m"], 0.4));
const outputCostPer1m = Math.max(0, numberValue(args["output-cost-per-1m"], 1.6));

if (provider === "openrouter" && !apiKey) throw new Error("OPENROUTER_API_KEY is required when --provider=openrouter.");

const responseDir = path.join(outdir, "responses", slug(model));
const jsonDir = path.join(outdir, "enriched_json");
ensureDir(responseDir);
ensureDir(jsonDir);

const packets = loadPackets(packetRoot).slice(offset, limit > 0 ? offset + limit : undefined);
if (!packets.length) throw new Error(`No llm_input.md packets found in ${packetRoot}`);

const startedAt = new Date().toISOString();
writeJson(path.join(outdir, "config.json"), {
  run_id: runId,
  preset: preset.id,
  provider,
  model,
  packet_root: packetRoot,
  icp: icp ? { name: icp.name, supplied: true } : { supplied: false },
  account_level_only: true,
  personal_contact_discovery: false,
  started_at: startedAt,
});

const rows: OutputIndexRow[] = [];
await runPool(packets, concurrency, async (packet) => {
  const result = isEmptyScrapedPacket(packet.markdown)
    ? failedResult("empty scrape packet requires a scrape retry and was not sent to the provider", 0)
    : provider === "fixture"
      ? loadFixtureResult(packet, preset, icp)
      : await callOpenRouter(packet, preset, icp);
  const validation = result.parsed
    ? mergeValidation(
        preset.validate(result.parsed),
        preset.id === "company" ? validateQualificationMode(result.parsed, Boolean(icp)) : { ok: true, errors: [] },
      )
    : { ok: false, errors: [result.error || "response was not valid JSON"] };
  const ok = result.ok && validation.ok && Boolean(result.parsed);
  const responseFile = path.join(responseDir, `${packet.caseId}.json`);
  const jsonFile = path.join(jsonDir, `${packet.caseId}.json`);

  writeJson(responseFile, {
    case_id: packet.caseId,
    preset: preset.id,
    provider,
    model,
    ok,
    response_id: result.responseId,
    raw_text: result.rawText,
    validation,
    usage: {
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      cost_usd: result.costUsd,
      elapsed_ms: result.elapsedMs,
    },
    error: result.error,
  });

  if (result.parsed) writeJson(jsonFile, result.parsed);
  const flattened = result.parsed ? preset.flatten(result.parsed) : {};
  const sourceContext = objectValue(packet.entity.source_context);
  rows.push({
    case_id: packet.caseId,
    preset: preset.id,
    provider,
    model,
    ok,
    validation_errors: validation.errors.join(" | "),
    cost_usd: result.costUsd,
    latency_ms: result.elapsedMs,
    ...prefixRecord(sourceContext, "source_"),
    ...flattened,
    json_file: result.parsed ? jsonFile : "",
    response_file: responseFile,
    packet_path: packet.markdownPath,
  });
});

rows.sort((a, b) => a.case_id.localeCompare(b.case_id));
writeJson(path.join(outdir, "enriched-index.json"), rows);
writeCsv(path.join(outdir, "enriched.csv"), rows);
const successful = rows.filter((row) => row.ok).length;
const totalCost = rows.reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
writeJson(path.join(outdir, "summary.json"), {
  run_id: runId,
  preset: preset.id,
  provider,
  model,
  status: successful === rows.length ? "completed" : "completed_with_errors",
  input_packets: rows.length,
  successful,
  failed: rows.length - successful,
  total_cost_usd: totalCost,
  icp_supplied: Boolean(icp),
  account_level_only: true,
  personal_contact_discovery: false,
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  output_files: {
    csv: path.join(outdir, "enriched.csv"),
    index: path.join(outdir, "enriched-index.json"),
    json_dir: jsonDir,
  },
});

console.log(JSON.stringify({
  run_id: runId,
  preset: preset.id,
  provider,
  model,
  input_packets: rows.length,
  successful,
  failed: rows.length - successful,
  total_cost_usd: totalCost,
  outdir,
}, null, 2));

if (successful !== rows.length) process.exitCode = 1;

function providerValue(value: string | undefined): Provider {
  const normalized = value ?? "openrouter";
  if (normalized !== "fixture" && normalized !== "openrouter") {
    throw new Error(`Unknown provider: ${normalized}. Expected fixture or openrouter.`);
  }
  return normalized;
}

function loadPackets(root: string): PacketCase[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((directory) => existsSync(path.join(directory, "llm_input.md")))
    .sort()
    .map((directory) => {
      const markdownPath = path.join(directory, "llm_input.md");
      const jsonPath = path.join(directory, "llm_input.json");
      const packet = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown> : {};
      return {
        caseId: path.basename(directory),
        directory,
        markdownPath,
        markdown: readFileSync(markdownPath, "utf8"),
        packet,
        entity: objectValue(packet.entity),
      };
    });
}

function loadFixtureResult(packet: PacketCase, presetValue: EnrichmentPreset, icpValue: IcpDefinition | null): ProviderResult {
  const started = Date.now();
  const preferred = presetValue.id === "capital-source"
    ? "fixture_response.capital-source.json"
    : icpValue ? "fixture_response.icp.json" : "fixture_response.json";
  const fixturePath = path.join(packet.directory, preferred);
  if (!existsSync(fixturePath)) {
    return failedResult(`Fixture file not found: ${fixturePath}`, Date.now() - started);
  }
  const rawText = readFileSync(fixturePath, "utf8");
  const parsed = parseJsonObject(rawText);
  return {
    ok: Boolean(parsed),
    parsed,
    rawText,
    responseId: `fixture-${packet.caseId}`,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    elapsedMs: Date.now() - started,
    error: parsed ? "" : "fixture response is malformed JSON",
  };
}

async function callOpenRouter(packet: PacketCase, presetValue: EnrichmentPreset, icpValue: IcpDefinition | null): Promise<ProviderResult> {
  const prompt = [
    "Create one evidence-backed company enrichment object from this packet.",
    "Preserve source_record_id exactly. Use only packet evidence and source context.",
    icpPrompt(icpValue),
    "Scraped packet:",
    packet.markdown.slice(0, maxMarkdownChars),
    "Return JSON only.",
  ].join("\n\n");

  let last = failedResult("OpenRouter request did not run", 0);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/1aday/ai-b2b-company-enrichment",
          "X-Title": "AI B2B Company Enrichment",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: presetValue.systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0,
          max_tokens: maxOutputTokens,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: presetValue.schema.name,
              strict: presetValue.schema.strict,
              schema: presetValue.schema.schema,
            },
          },
          provider: { require_parameters: true },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseText = await response.text();
      const envelope = parseJsonObject(responseText);
      const rawText = messageText(envelope) || responseText;
      const parsed = parseJsonObject(rawText);
      const usage = objectValue(envelope?.usage);
      const promptTokens = numberFromUnknown(usage.prompt_tokens) || estimateTokens(prompt);
      const completionTokens = numberFromUnknown(usage.completion_tokens) || estimateTokens(rawText);
      last = {
        ok: response.ok && Boolean(parsed),
        parsed,
        rawText,
        responseId: String(envelope?.id ?? ""),
        promptTokens,
        completionTokens,
        costUsd: promptTokens * inputCostPer1m / 1_000_000 + completionTokens * outputCostPer1m / 1_000_000,
        elapsedMs: Date.now() - started,
        error: response.ok ? (parsed ? "" : "response was not valid JSON") : `OpenRouter ${response.status}: ${compact(responseText, 500)}`,
      };
      if (!last.ok && !isRetryableResponse(response.status)) return last;
    } catch (error) {
      last = failedResult(error instanceof Error ? error.message : String(error), Date.now() - started);
    }
    if (last.ok) return last;
  }
  return last;
}

function messageText(envelope: Record<string, unknown> | null) {
  const choices = Array.isArray(envelope?.choices) ? envelope.choices : [];
  const first = objectValue(choices[0]);
  const message = objectValue(first.message);
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.map((item) => objectValue(item).text).filter((item): item is string => typeof item === "string").join("\n");
}

function failedResult(error: string, elapsedMs: number): ProviderResult {
  return { ok: false, parsed: null, rawText: "", responseId: "", promptTokens: 0, completionTokens: 0, costUsd: 0, elapsedMs, error };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberFromUnknown(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateTokens(value: string) {
  return Math.ceil(value.length / 4);
}

function prefixRecord(value: Record<string, unknown>, prefix: string) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [`${prefix}${key}`, item]));
}

async function runPool<T>(values: T[], size: number, worker: (value: T) => Promise<void>) {
  let cursor = 0;
  async function runWorker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await worker(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, values.length) }, runWorker));
}
