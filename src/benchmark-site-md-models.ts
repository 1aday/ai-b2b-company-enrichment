import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ENRICHMENT_FIELD_FILLING_CONTRACT } from "./field-contract.js";
import { ENRICHMENT_OUTPUT_SCHEMA } from "./schema.js";
import { compact, ensureDir, loadLocalEnv, nowStamp, numberValue, parseArgs, parseJsonObject, slug, writeCsv, writeJson } from "./shared.js";

type PacketCase = {
  case_id: string;
  packet_dir: string;
  packet_path: string;
  company_name: string;
  domain: string;
  md: string;
  md_chars: number;
};

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: Record<string, string>;
  supported_parameters?: string[];
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
};

type ModelPrice = {
  prompt_per_token: number;
  completion_per_token: number;
  request_price: number;
  input_per_1m: number;
  output_per_1m: number;
  blended_90_10_per_1m: number;
};

type ModelSelection = {
  id: string;
  name: string;
  context_length: number;
  supported_parameters: string[];
  pricing: ModelPrice;
};

type ApiResult = {
  ok: boolean;
  model: string;
  response_id: string;
  parsed: Record<string, unknown> | null;
  raw_text: string;
  usage: Record<string, unknown>;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  elapsed_ms: number;
  used_fallback_response_format: boolean;
  error?: string;
};

type CaseScore = {
  model: string;
  case_id: string;
  company_name: string;
  domain: string;
  ok: boolean;
  parse_ok: boolean;
  schema_shape_score: number;
  agreement_score: number;
  known_field_recall: number;
  quality_score: number;
  cost_usd: number;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  used_fallback_response_format: boolean;
  error: string;
};

const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
loadLocalEnv(rootDir);

const currentRunPath = path.join(rootDir, "data", "investor_company_enrichment", "current-run.json");
const currentRun = existsSync(currentRunPath) ? JSON.parse(readFileSync(currentRunPath, "utf8")) as { run_dir?: string } : {};
const sourceRunDir = path.resolve(args["run-dir"] ?? currentRun.run_dir ?? "");
if (!sourceRunDir || !existsSync(sourceRunDir)) throw new Error(`Run dir not found: ${sourceRunDir || "<empty>"}`);

const phase = args.phase ?? "all";
const caseLimit = Math.max(1, numberValue(args.cases, 20));
const offset = Math.max(0, numberValue(args.offset, 0));
const runId = args["run-id"] ?? `site-md-model-benchmark-${nowStamp()}`;
const outdir = path.resolve(args.outdir ?? path.join(rootDir, "runs", runId));
const packetRoot = path.resolve(args["packet-root"] ?? path.join(outdir, "prepared_for_llm"));
const maxMdChars = Math.max(4_000, numberValue(args["max-md-chars"], 80_000));
const prepareMaxCharsPerPage = Math.max(2_000, numberValue(args["prepare-max-chars-per-page"], 60_000));
const prepareMaxTotalChars = Math.max(maxMdChars, numberValue(args["prepare-max-total-chars"], maxMdChars));
const maxOutputTokens = Math.max(1_000, numberValue(args["max-output-tokens"], 12_000));
const timeoutMs = Math.max(10_000, numberValue(args["timeout-ms"], 90_000));
const maxFailuresPerModel = Math.max(1, numberValue(args["max-failures-per-model"], 3));
const goldModel = args["gold-model"] ?? "openai/gpt-4.1";
const candidateLimitRaw = numberValue(args["candidate-limit"], 12);
const allCheaper = args["all-cheaper"] === "true";
const candidateLimit = allCheaper ? 0 : Math.max(1, candidateLimitRaw);
const minQualityForCheapPick = Math.max(0, Math.min(1, numberValue(args["min-quality"], 0.78)));
const force = args.force === "true";
const preparePackets = args.prepare !== "false";
const fallbackJsonObject = args["fallback-json-object"] !== "false";
const requireResponseFormat = args["require-response-format"] !== "false";
const includeFree = args["include-free"] === "true";
const dryRun = args["dry-run"] === "true";
const explicitModels = (args.models ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const outputSchema = (ENRICHMENT_OUTPUT_SCHEMA as { schema?: unknown }).schema;
if (!outputSchema || typeof outputSchema !== "object") throw new Error("ENRICHMENT_OUTPUT_SCHEMA.schema is not an object.");

const BLOCKED_MODEL_PATTERNS = [
  /^~/,
  /^openrouter\//i,
  /(?:dall|stable-diffusion|midjourney|imagen|image|vision-only|whisper|tts|audio|music|lyria|clip|embedding|rerank|moderation|safeguard|guard)/i,
];

const FIELD_WEIGHTS = [
  { path: "canonical_name", weight: 3 },
  { path: "domain", weight: 3 },
  { path: "website_url", weight: 2 },
  { path: "logo_url", weight: 1 },
  { path: "type", weight: 6 },
  { path: "verification.is_capital_source", weight: 6 },
  { path: "verification.status", weight: 5 },
  { path: "verification.confidence_score", weight: 2 },
  { path: "profile.one_line_description", weight: 3 },
  { path: "profile.detailed_profile_summary", weight: 4 },
  { path: "profile.hq_location", weight: 3 },
  { path: "profile.address", weight: 4 },
  { path: "profile.postal_code", weight: 4 },
  { path: "profile.operating_geographies", weight: 3 },
  { path: "profile.capital_source_context", weight: 4 },
  { path: "profile.ownership_background", weight: 2 },
  { path: "profile.public_principal_name", weight: 2 },
  { path: "capital_profile.capital_role_summary", weight: 4 },
  { path: "capital_profile.invests_in_vc_funds", weight: 6 },
  { path: "capital_profile.invests_directly", weight: 5 },
  { path: "capital_profile.co_investment_appetite", weight: 3 },
  { path: "capital_profile.fund_commitment_appetite", weight: 6 },
  { path: "capital_profile.preferred_fund_stage", weight: 3 },
  { path: "capital_profile.emerging_manager_appetite", weight: 2 },
  { path: "capital_profile.first_time_fund_appetite", weight: 2 },
  { path: "capital_profile.fund_size_preference", weight: 2 },
  { path: "capital_profile.sector_focus", weight: 4 },
  { path: "capital_profile.stage_focus", weight: 4 },
  { path: "capital_profile.geography_focus", weight: 4 },
  { path: "capital_profile.business_model_preferences", weight: 3 },
  { path: "capital_profile.impact_or_values_themes", weight: 2 },
  { path: "portfolio_signals.known_fund_investments", weight: 3 },
  { path: "portfolio_signals.known_direct_investments", weight: 3 },
  { path: "outreach.fundraise_fit_notes", weight: 4 },
  { path: "outreach.fit_risk_notes", weight: 3 },
] as const;

ensureDir(outdir);
ensureDir(path.join(outdir, "gold"));
ensureDir(path.join(outdir, "responses"));
ensureDir(path.join(outdir, "models"));

await main();

async function main() {
  if (phase === "prepare" || phase === "gold" || phase === "eval" || phase === "all") {
    maybePreparePackets();
  }

  const packets = phase === "models" ? [] : loadPacketCases(packetRoot).slice(offset, offset + caseLimit);
  if (phase !== "models" && !packets.length) throw new Error(`No llm_input.md packets found in ${packetRoot}`);

  const models = await fetchOpenRouterModels();
  writeJson(path.join(outdir, "models", "all_openrouter_models.json"), models);
  const selectedModels = selectCandidateModels(models, packets);
  writeJson(path.join(outdir, "models", "selected_candidate_models.json"), selectedModels);
  writeJson(path.join(outdir, "config.json"), {
    run_id: runId,
    source_run_dir: sourceRunDir,
    packet_root: packetRoot,
    phase,
    cases: packets.map((item) => ({
      case_id: item.case_id,
      company_name: item.company_name,
      domain: item.domain,
      md_chars: item.md_chars,
      packet_path: item.packet_path,
    })),
    gold_model: goldModel,
    candidate_models: selectedModels.map((item) => item.id),
    candidate_limit: candidateLimit,
    all_cheaper: allCheaper,
    max_md_chars: maxMdChars,
    max_output_tokens: maxOutputTokens,
    max_failures_per_model: maxFailuresPerModel,
    min_quality_for_cheap_pick: minQualityForCheapPick,
    require_response_format: requireResponseFormat,
    fallback_json_object: fallbackJsonObject,
    include_free: includeFree,
    started_at: new Date().toISOString(),
  });

  console.log(JSON.stringify({
    run_id: runId,
    outdir,
    phase,
    packet_root: packetRoot,
    cases: packets.length,
    gold_model: goldModel,
    candidate_models: selectedModels.map((item) => item.id),
    dry_run: dryRun,
  }, null, 2));

  if (dryRun || phase === "models" || phase === "prepare") {
    writeSummary([], selectedModels, packets, []);
    return;
  }

  let goldRows: Array<Record<string, unknown>> = [];
  if (phase === "gold" || phase === "all") {
    goldRows = await ensureGoldRecords(packets, models);
  } else if (phase === "eval") {
    goldRows = loadExistingGoldRows(packets);
  }
  if (phase === "gold") {
    writeSummary([], selectedModels, packets, goldRows);
    return;
  }

  const scores = await evaluateCandidateModels(packets, selectedModels, models);
  writeLeaderboard(scores, selectedModels);
  writeSummary(scores, selectedModels, packets, goldRows);
}

function maybePreparePackets() {
  const existing = countPacketFiles(packetRoot);
  if (existing >= caseLimit || !preparePackets) return;
  execFileSync("npx", [
    "tsx",
    "src/prepare-company-llm-packets.ts",
    `--run-dir=${sourceRunDir}`,
    `--outdir=${packetRoot}`,
    `--limit=${caseLimit}`,
    `--offset=${offset}`,
    `--max-pages-per-company=999`,
    `--max-chars-per-page=${prepareMaxCharsPerPage}`,
    `--max-total-chars=${prepareMaxTotalChars}`,
  ], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
}

function loadExistingGoldRows(packets: PacketCase[]) {
  return packets.map((packet) => {
    const goldPath = path.join(outdir, "gold", `${packet.case_id}.json`);
    if (!existsSync(goldPath)) throw new Error(`Missing gold file for ${packet.case_id}: ${goldPath}`);
    const saved = JSON.parse(readFileSync(goldPath, "utf8")) as Record<string, unknown>;
    return {
      case_id: packet.case_id,
      company_name: packet.company_name,
      domain: packet.domain,
      ok: Boolean(saved.ok),
      cost_usd: saved.cost_usd,
      prompt_tokens: saved.prompt_tokens,
      completion_tokens: saved.completion_tokens,
    };
  });
}

function loadPacketCases(root: string): PacketCase[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => {
      const packetDir = path.join(root, entry.name);
      const packetPath = path.join(packetDir, "llm_input.md");
      if (!existsSync(packetPath)) return null;
      const raw = readFileSync(packetPath, "utf8");
      const md = trimMarkdownPacket(raw, maxMdChars);
      const companyName = firstMatch(md, /^Company:\s*(.+)$/m) || entry.name;
      const domain = firstMatch(md, /^Domain:\s*(.+)$/m) || "";
      return {
        case_id: entry.name,
        packet_dir: packetDir,
        packet_path: packetPath,
        company_name: companyName,
        domain,
        md,
        md_chars: md.length,
      };
    })
    .filter((item): item is PacketCase => Boolean(item))
    .sort((a, b) => a.case_id.localeCompare(b.case_id));
}

function trimMarkdownPacket(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  const taskIndex = value.lastIndexOf("\n## Task");
  const task = taskIndex >= 0 ? value.slice(taskIndex) : "";
  const prefixBudget = Math.max(1_000, maxChars - task.length - 120);
  return `${value.slice(0, prefixBudget).trim()}\n\n[Content trimmed to benchmark budget: ${maxChars} chars.]\n${task}`.trim();
}

function countPacketFiles(root: string) {
  if (!existsSync(root)) return 0;
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(path.join(root, entry.name, "llm_input.md")))
    .length;
}

async function ensureGoldRecords(packets: PacketCase[], models: OpenRouterModel[]) {
  const rows: Array<Record<string, unknown>> = [];
  const goldModelInfo = models.find((item) => item.id === goldModel);
  for (const packet of packets) {
    const goldPath = path.join(outdir, "gold", `${packet.case_id}.json`);
    if (!force && existsSync(goldPath)) {
      const saved = JSON.parse(readFileSync(goldPath, "utf8")) as Record<string, unknown>;
      if (saved.ok === true && saved.parsed && typeof saved.parsed === "object") {
        rows.push({
          case_id: packet.case_id,
          company_name: packet.company_name,
          domain: packet.domain,
          ok: true,
          cost_usd: saved.cost_usd,
          prompt_tokens: saved.prompt_tokens,
          completion_tokens: saved.completion_tokens,
        });
        continue;
      }
    }
    const result = await callOpenRouter({
      model: goldModel,
      packet,
      modelInfo: goldModelInfo,
      purpose: "gold",
      allowFallback: fallbackJsonObject,
    });
    writeJson(goldPath, {
      ...result,
      case_id: packet.case_id,
      company_name: packet.company_name,
      domain: packet.domain,
      packet_path: packet.packet_path,
      gold_model: goldModel,
    });
    rows.push({
      case_id: packet.case_id,
      company_name: packet.company_name,
      domain: packet.domain,
      ok: result.ok,
      cost_usd: result.cost_usd,
      prompt_tokens: result.prompt_tokens,
      completion_tokens: result.completion_tokens,
    });
    console.log(JSON.stringify({
      phase: "gold",
      case_id: packet.case_id,
      model: goldModel,
      ok: result.ok,
      cost_usd: round6(result.cost_usd),
      elapsed_ms: result.elapsed_ms,
      error: result.error ?? "",
    }));
  }
  writeJson(path.join(outdir, "gold", "gold_index.json"), rows);
  return rows;
}

async function evaluateCandidateModels(packets: PacketCase[], selectedModels: ModelSelection[], models: OpenRouterModel[]) {
  const scores: CaseScore[] = [];
  for (const model of selectedModels) {
    const modelInfo = models.find((item) => item.id === model.id);
    let consecutiveModelFailures = 0;
    let totalModelFailures = 0;
    for (const packet of packets) {
      const goldPath = path.join(outdir, "gold", `${packet.case_id}.json`);
      if (!existsSync(goldPath)) throw new Error(`Missing gold file for ${packet.case_id}: ${goldPath}`);
      const gold = JSON.parse(readFileSync(goldPath, "utf8")) as ApiResult;
      const responseDir = path.join(outdir, "responses", slug(model.id));
      ensureDir(responseDir);
      const responsePath = path.join(responseDir, `${packet.case_id}.json`);
      let result: ApiResult;
      if (!existsSync(responsePath) && (consecutiveModelFailures >= maxFailuresPerModel || totalModelFailures >= maxFailuresPerModel)) {
        const skipped = skippedScore(model.id, packet, `skipped_after_${totalModelFailures}_total_${consecutiveModelFailures}_consecutive_model_failures`);
        scores.push(skipped);
        persistScores(scores);
        console.log(JSON.stringify({
          phase: "eval",
          model: model.id,
          case_id: packet.case_id,
          ok: false,
          quality_score: 0,
          cost_usd: 0,
          elapsed_ms: 0,
          error: skipped.error,
        }));
        continue;
      }
      if (!force && existsSync(responsePath)) {
        result = JSON.parse(readFileSync(responsePath, "utf8")) as ApiResult;
      } else {
        result = await callOpenRouter({
          model: model.id,
          packet,
          modelInfo,
          purpose: "candidate",
          allowFallback: fallbackJsonObject,
        });
        writeJson(responsePath, {
          ...result,
          case_id: packet.case_id,
          company_name: packet.company_name,
          domain: packet.domain,
          packet_path: packet.packet_path,
          candidate_model: model.id,
          gold_model: goldModel,
        });
      }
      const score = scoreAgainstGold(model.id, packet, result, gold);
      scores.push(score);
      if (!score.ok || !score.parse_ok) {
        consecutiveModelFailures += 1;
        totalModelFailures += 1;
      } else {
        consecutiveModelFailures = 0;
      }
      persistScores(scores);
      console.log(JSON.stringify({
        phase: "eval",
        model: model.id,
        case_id: packet.case_id,
        ok: score.ok,
        quality_score: round4(score.quality_score),
        cost_usd: round6(score.cost_usd),
        elapsed_ms: score.latency_ms,
        error: score.error,
      }));
    }
  }
  persistScores(scores);
  return scores;
}

function skippedScore(model: string, packet: PacketCase, reason: string): CaseScore {
  return {
    model,
    case_id: packet.case_id,
    company_name: packet.company_name,
    domain: packet.domain,
    ok: false,
    parse_ok: false,
    schema_shape_score: 0,
    agreement_score: 0,
    known_field_recall: 0,
    quality_score: 0,
    cost_usd: 0,
    latency_ms: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    used_fallback_response_format: false,
    error: reason,
  };
}

function persistScores(scores: CaseScore[]) {
  writeJson(path.join(outdir, "case_scores.json"), scores);
  writeCsv(path.join(outdir, "case_scores.csv"), scores as unknown as Record<string, unknown>[]);
}

async function callOpenRouter(input: {
  model: string;
  packet: PacketCase;
  modelInfo?: OpenRouterModel;
  purpose: "gold" | "candidate";
  allowFallback: boolean;
}): Promise<ApiResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");

  const started = Date.now();
  const prompt = buildPrompt(input.packet, input.purpose);
  const body = buildRequestBody(input.model, prompt, true);
  const first = await postOpenRouter(apiKey, body);
  if (!first.ok && input.allowFallback && fallbackJsonObject && first.can_fallback) {
    const fallback = await postOpenRouter(apiKey, buildRequestBody(input.model, prompt, false));
    return formatApiResult(input.model, input.modelInfo, fallback, prompt, Date.now() - started, true);
  }
  return formatApiResult(input.model, input.modelInfo, first, prompt, Date.now() - started, false);
}

function buildRequestBody(model: string, prompt: string, structured: boolean) {
  const responseFormat = structured
    ? {
        type: "json_schema",
        json_schema: {
          name: "capital_source_enrichment",
          strict: true,
          schema: outputSchema,
        },
      }
    : { type: "json_object" };
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You fill one capital-source enrichment JSON object from scraped first-party company-site markdown.",
          "Use only the supplied markdown packet. Do not use CSV labels, bought-list type labels, or outside knowledge.",
          "If a fact is not directly supported by the markdown, use unknown, null, [], or a conservative negative enum as required by the schema.",
          "Return JSON only.",
        ].join(" "),
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    max_tokens: maxOutputTokens,
    response_format: responseFormat,
    provider: structured && requireResponseFormat ? { require_parameters: true } : undefined,
  };
}

function buildPrompt(packet: PacketCase, purpose: "gold" | "candidate") {
  const contract = {
    value_style: ENRICHMENT_FIELD_FILLING_CONTRACT.value_style,
    sensitive_field_rules: ENRICHMENT_FIELD_FILLING_CONTRACT.sensitive_field_rules,
    portfolio_rules: ENRICHMENT_FIELD_FILLING_CONTRACT.portfolio_rules,
    fit_assessment_rules: ENRICHMENT_FIELD_FILLING_CONTRACT.fit_assessment_rules,
    categorical_array_examples: ENRICHMENT_FIELD_FILLING_CONTRACT.categorical_array_examples,
  };
  return [
    `Benchmark role: ${purpose === "gold" ? "create the gold-standard reference JSON" : "create the candidate JSON to compare against the gold standard"}.`,
    "",
    "Use this schema exactly:",
    JSON.stringify(outputSchema),
    "",
    "Field-filling contract:",
    JSON.stringify(contract),
    "",
    "Scraped markdown packet:",
    packet.md,
    "",
    "Return exactly one JSON object matching the schema. No markdown. No commentary.",
  ].join("\n");
}

async function postOpenRouter(apiKey: string, body: Record<string, unknown>) {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/1aday/capital-source-enrichment",
        "X-Title": "Capital Source Site MD Model Benchmark",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      text,
      can_fallback: response.status === 400 || response.status === 404 || response.status === 422,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: error instanceof Error ? error.message : String(error),
      can_fallback: false,
    };
  }
}

function formatApiResult(
  model: string,
  modelInfo: OpenRouterModel | undefined,
  response: Awaited<ReturnType<typeof postOpenRouter>>,
  prompt: string,
  elapsedMs: number,
  usedFallback: boolean,
): ApiResult {
  const rawText = extractMessageText(response.json);
  const parsed = rawText ? parseJsonObject(rawText) : null;
  const usage = objectValue(response.json?.usage);
  const promptTokens = numberFromUnknown(usage.prompt_tokens) || estimateTokens(prompt);
  const completionTokens = numberFromUnknown(usage.completion_tokens) || estimateTokens(rawText);
  const costUsd = estimateCost(modelInfo, promptTokens, completionTokens);
  const error = response.ok ? "" : compact(response.text, 500);
  return {
    ok: response.ok && Boolean(parsed),
    model,
    response_id: String(response.json?.id ?? ""),
    parsed,
    raw_text: rawText || response.text,
    usage,
    cost_usd: costUsd,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    elapsed_ms: elapsedMs,
    used_fallback_response_format: usedFallback,
    error: error || (!parsed ? "response did not parse as JSON object" : undefined),
  };
}

async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const headers: Record<string, string> = {};
  if (process.env.OPENROUTER_API_KEY) headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`OpenRouter models request failed: ${response.status} ${await response.text()}`);
  const payload = await response.json() as { data?: OpenRouterModel[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

function selectCandidateModels(models: OpenRouterModel[], packets: PacketCase[]): ModelSelection[] {
  const byId = new Map(models.map((model) => [model.id, model]));
  const goldInfo = byId.get(goldModel);
  const goldPrice = priceInfo(goldInfo);
  const maxPacketTokens = packets.length
    ? Math.max(...packets.map((item) => estimateTokens(item.md))) + maxOutputTokens + 4_000
    : Math.ceil(maxMdChars / 4) + maxOutputTokens + 4_000;

  if (explicitModels.length) {
    return explicitModels
      .map((id) => byId.get(id))
      .filter((item): item is OpenRouterModel => Boolean(item))
      .map((model) => modelSelection(model));
  }

  const ranked = models.filter((model) => isCandidateModel(model, goldPrice, maxPacketTokens))
    .map((model) => modelSelection(model))
    .sort((a, b) => a.pricing.blended_90_10_per_1m - b.pricing.blended_90_10_per_1m || a.id.localeCompare(b.id));

  return candidateLimit > 0 ? ranked.slice(0, candidateLimit) : ranked;
}

function isCandidateModel(model: OpenRouterModel, goldPrice: ModelPrice, minContextTokens: number) {
  if (/gpt-5/i.test(model.id)) return false;
  if (BLOCKED_MODEL_PATTERNS.some((pattern) => pattern.test(model.id))) return false;
  const arch = model.architecture;
  const inputModalities = arch?.input_modalities ?? ["text"];
  const outputModalities = arch?.output_modalities ?? ["text"];
  if (!inputModalities.includes("text") || !outputModalities.includes("text")) return false;
  const supported = model.supported_parameters ?? [];
  if (requireResponseFormat && !supported.includes("response_format")) return false;
  const contextLength = model.top_provider?.context_length ?? model.context_length ?? 0;
  if (contextLength && contextLength < minContextTokens) return false;
  const pricing = priceInfo(model);
  if (!includeFree && pricing.blended_90_10_per_1m === 0) return false;
  if (!Number.isFinite(pricing.blended_90_10_per_1m)) return false;
  return pricing.blended_90_10_per_1m < goldPrice.blended_90_10_per_1m;
}

function modelSelection(model: OpenRouterModel): ModelSelection {
  return {
    id: model.id,
    name: model.name ?? model.id,
    context_length: model.top_provider?.context_length ?? model.context_length ?? 0,
    supported_parameters: model.supported_parameters ?? [],
    pricing: priceInfo(model),
  };
}

function priceInfo(model?: OpenRouterModel): ModelPrice {
  const pricing = model?.pricing ?? {};
  const prompt = priceNumber(pricing.prompt);
  const completion = priceNumber(pricing.completion);
  const request = priceNumber(pricing.request);
  const inputPer1m = prompt * 1_000_000;
  const outputPer1m = completion * 1_000_000;
  return {
    prompt_per_token: prompt,
    completion_per_token: completion,
    request_price: request,
    input_per_1m: inputPer1m,
    output_per_1m: outputPer1m,
    blended_90_10_per_1m: inputPer1m * 0.9 + outputPer1m * 0.1,
  };
}

function priceNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateCost(model: OpenRouterModel | undefined, promptTokens: number, completionTokens: number) {
  const pricing = priceInfo(model);
  return pricing.request_price + promptTokens * pricing.prompt_per_token + completionTokens * pricing.completion_per_token;
}

function scoreAgainstGold(model: string, packet: PacketCase, result: ApiResult, gold: ApiResult): CaseScore {
  const parsed = result.parsed;
  const goldParsed = gold.parsed;
  const parseOk = Boolean(parsed);
  const fieldScores = FIELD_WEIGHTS.map((field) => {
    const actualValue = parsed ? valueAt(parsed, field.path) : undefined;
    const goldValue = goldParsed ? valueAt(goldParsed, field.path) : undefined;
    return {
      path: field.path,
      weight: field.weight,
      score: scoreValue(actualValue, goldValue),
      gold_known: !isUnknownValue(goldValue),
      actual_known: !isUnknownValue(actualValue),
    };
  });
  const totalWeight = fieldScores.reduce((sum, item) => sum + item.weight, 0) || 1;
  const agreementScore = fieldScores.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
  const goldKnown = fieldScores.filter((item) => item.gold_known);
  const knownRecall = goldKnown.length ? goldKnown.filter((item) => item.actual_known).length / goldKnown.length : 1;
  const schemaShapeScore = parsed ? schemaShape(parsed) : 0;
  const qualityScore = parseOk ? agreementScore * 0.82 + schemaShapeScore * 0.12 + knownRecall * 0.06 : 0;
  return {
    model,
    case_id: packet.case_id,
    company_name: packet.company_name,
    domain: packet.domain,
    ok: result.ok,
    parse_ok: parseOk,
    schema_shape_score: round4(schemaShapeScore),
    agreement_score: round4(agreementScore),
    known_field_recall: round4(knownRecall),
    quality_score: round4(qualityScore),
    cost_usd: round6(result.cost_usd),
    latency_ms: result.elapsed_ms,
    prompt_tokens: result.prompt_tokens,
    completion_tokens: result.completion_tokens,
    used_fallback_response_format: result.used_fallback_response_format,
    error: result.error ?? "",
  };
}

function scoreValue(actual: unknown, gold: unknown): number {
  const actualUnknown = isUnknownValue(actual);
  const goldUnknown = isUnknownValue(gold);
  if (goldUnknown && actualUnknown) return 1;
  if (goldUnknown && !actualUnknown) return 0.45;
  if (!goldUnknown && actualUnknown) return 0;
  if (typeof actual === "boolean" || typeof gold === "boolean") return actual === gold ? 1 : 0;
  if (typeof actual === "number" || typeof gold === "number") return scoreNumber(actual, gold);
  if (Array.isArray(actual) || Array.isArray(gold)) return scoreArray(actual, gold);
  if (typeof actual === "object" || typeof gold === "object") return tokenJaccard(normalizeText(JSON.stringify(actual)), normalizeText(JSON.stringify(gold)));
  return scoreString(String(actual ?? ""), String(gold ?? ""));
}

function scoreString(actual: string, gold: string): number {
  const a = normalizeText(actual);
  const g = normalizeText(gold);
  if (!a || !g) return a === g ? 1 : 0;
  if (a === g) return 1;
  if (a.includes(g) || g.includes(a)) return 0.76;
  return Math.min(0.82, tokenJaccard(a, g));
}

function scoreNumber(actual: unknown, gold: unknown): number {
  const a = Number(actual);
  const g = Number(gold);
  if (!Number.isFinite(a) || !Number.isFinite(g)) return 0;
  if (a === g) return 1;
  const diff = Math.abs(a - g);
  if (g >= 0 && g <= 1 && a >= 0 && a <= 1) return Math.max(0, 1 - diff);
  return Math.max(0, 1 - diff / Math.max(1, Math.abs(g)));
}

function scoreArray(actual: unknown, gold: unknown): number {
  const actualItems = arrayTerms(actual);
  const goldItems = arrayTerms(gold);
  if (!goldItems.length && !actualItems.length) return 1;
  if (!goldItems.length && actualItems.length) return 0.45;
  if (goldItems.length && !actualItems.length) return 0;
  const intersection = actualItems.filter((item) => goldItems.includes(item)).length;
  const union = new Set([...actualItems, ...goldItems]).size || 1;
  return intersection / union;
}

function arrayTerms(value: unknown) {
  const array = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(array.map((item) => {
    if (typeof item === "object") return normalizeText(JSON.stringify(item));
    return normalizeText(String(item));
  }).filter(Boolean))];
}

function schemaShape(value: Record<string, unknown>) {
  const rootRequired = [
    "source_record_id",
    "canonical_name",
    "domain",
    "website_url",
    "logo_url",
    "type",
    "verification",
    "profile",
    "capital_profile",
    "portfolio_signals",
    "outreach",
    "compliance",
    "source_evidence",
    "quality",
  ];
  const present = rootRequired.filter((key) => key in value).length / rootRequired.length;
  const objectPaths = ["verification", "profile", "capital_profile", "portfolio_signals", "outreach", "compliance", "quality"];
  const objects = objectPaths.filter((key) => {
    const item = value[key];
    return item && typeof item === "object" && !Array.isArray(item);
  }).length / objectPaths.length;
  const arrays = [value.source_evidence].filter(Array.isArray).length;
  return present * 0.72 + objects * 0.22 + arrays * 0.06;
}

function valueAt(value: Record<string, unknown>, pathValue: string): unknown {
  let current: unknown = value;
  for (const part of pathValue.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isUnknownValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(isUnknownValue);
  if (typeof value === "object") return Object.keys(value).length === 0;
  const normalized = normalizeText(String(value));
  return !normalized || ["unknown", "n/a", "na", "none", "not disclosed", "not available", "no information available"].includes(normalized);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9_]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenJaccard(actual: string, gold: string) {
  const a = new Set(actual.split(/\s+/).filter((item) => item.length > 2));
  const g = new Set(gold.split(/\s+/).filter((item) => item.length > 2));
  if (!a.size && !g.size) return 1;
  if (!a.size || !g.size) return 0;
  const intersection = [...a].filter((item) => g.has(item)).length;
  return intersection / new Set([...a, ...g]).size;
}

function writeLeaderboard(scores: CaseScore[], selectedModels: ModelSelection[]) {
  const byModel = new Map<string, CaseScore[]>();
  for (const score of scores) {
    const rows = byModel.get(score.model) ?? [];
    rows.push(score);
    byModel.set(score.model, rows);
  }
  const modelById = new Map(selectedModels.map((item) => [item.id, item]));
  const leaderboard = [...byModel.entries()].map(([model, rows]) => {
    const selection = modelById.get(model);
    const totalCost = rows.reduce((sum, item) => sum + item.cost_usd, 0);
    const avgQuality = average(rows.map((item) => item.quality_score));
    const parseRate = average(rows.map((item) => item.parse_ok ? 1 : 0));
    const fallbackRate = average(rows.map((item) => item.used_fallback_response_format ? 1 : 0));
    const avgLatencyMs = average(rows.map((item) => item.latency_ms));
    return {
      model,
      cases: rows.length,
      avg_quality_score: round4(avgQuality),
      parse_rate: round4(parseRate),
      fallback_response_format_rate: round4(fallbackRate),
      total_cost_usd: round6(totalCost),
      avg_cost_per_case_usd: round6(totalCost / Math.max(1, rows.length)),
      avg_latency_ms: Math.round(avgLatencyMs),
      input_per_1m_usd: round6(selection?.pricing.input_per_1m ?? 0),
      output_per_1m_usd: round6(selection?.pricing.output_per_1m ?? 0),
      blended_90_10_per_1m_usd: round6(selection?.pricing.blended_90_10_per_1m ?? 0),
      context_length: selection?.context_length ?? 0,
      best_value_score: totalCost > 0 ? round4(avgQuality / (totalCost / Math.max(1, rows.length))) : round4(avgQuality * 10_000),
      eligible_for_cheapest_pick: avgQuality >= minQualityForCheapPick && parseRate >= 0.9,
    };
  }).sort((a, b) => {
    if (a.eligible_for_cheapest_pick !== b.eligible_for_cheapest_pick) return a.eligible_for_cheapest_pick ? -1 : 1;
    if (a.eligible_for_cheapest_pick && b.eligible_for_cheapest_pick) return a.avg_cost_per_case_usd - b.avg_cost_per_case_usd;
    return b.avg_quality_score - a.avg_quality_score || a.avg_cost_per_case_usd - b.avg_cost_per_case_usd;
  });
  writeJson(path.join(outdir, "leaderboard.json"), leaderboard);
  writeCsv(path.join(outdir, "leaderboard.csv"), leaderboard);
}

function writeSummary(
  scores: CaseScore[],
  selectedModels: ModelSelection[],
  packets: PacketCase[],
  goldRows: Array<Record<string, unknown>>,
) {
  const leaderboardPath = path.join(outdir, "leaderboard.json");
  const leaderboard = existsSync(leaderboardPath)
    ? JSON.parse(readFileSync(leaderboardPath, "utf8")) as Array<Record<string, unknown>>
    : [];
  const cheapestEligible = leaderboard.find((item) => item.eligible_for_cheapest_pick === true);
  const highestQuality = [...leaderboard].sort((a, b) => Number(b.avg_quality_score ?? 0) - Number(a.avg_quality_score ?? 0))[0];
  const goldCost = goldRows.reduce((sum, item) => sum + Number(item.cost_usd ?? 0), 0);
  const summary = {
    run_id: runId,
    outdir,
    source_run_dir: sourceRunDir,
    packet_root: packetRoot,
    cases: packets.length,
    phase,
    gold_model: goldModel,
    gold_total_cost_usd: round6(goldCost),
    candidate_models_count: selectedModels.length,
    candidate_case_scores: scores.length,
    min_quality_for_cheap_pick: minQualityForCheapPick,
    cheapest_eligible_model: cheapestEligible ?? null,
    highest_quality_model: highestQuality ?? null,
    artifacts: {
      config: path.join(outdir, "config.json"),
      selected_models: path.join(outdir, "models", "selected_candidate_models.json"),
      gold_index: path.join(outdir, "gold", "gold_index.json"),
      case_scores_json: path.join(outdir, "case_scores.json"),
      leaderboard_json: leaderboardPath,
      leaderboard_csv: path.join(outdir, "leaderboard.csv"),
    },
    finished_at: new Date().toISOString(),
  };
  writeJson(path.join(outdir, "summary.json"), summary);
  writeFileSync(path.join(outdir, "summary.md"), renderSummaryMarkdown(summary, leaderboard));
}

function renderSummaryMarkdown(summary: Record<string, unknown>, leaderboard: Array<Record<string, unknown>>) {
  const lines = [
    "# Site Markdown Model Benchmark",
    "",
    `Run ID: ${runId}`,
    `Gold model: ${goldModel}`,
    `Cases: ${summary.cases}`,
    `Candidate models: ${summary.candidate_models_count}`,
    `Gold cost: $${summary.gold_total_cost_usd}`,
    "",
    "## Recommendation",
    "",
  ];
  const cheapest = summary.cheapest_eligible_model as Record<string, unknown> | null;
  const best = summary.highest_quality_model as Record<string, unknown> | null;
  if (cheapest) {
    lines.push(`Cheapest eligible model: ${cheapest.model} at $${cheapest.avg_cost_per_case_usd}/case with quality ${cheapest.avg_quality_score}.`);
  } else {
    lines.push(`No model cleared the quality floor of ${minQualityForCheapPick}.`);
  }
  if (best) {
    lines.push(`Highest quality model: ${best.model} with quality ${best.avg_quality_score} at $${best.avg_cost_per_case_usd}/case.`);
  }
  lines.push("", "## Top leaderboard", "");
  for (const row of leaderboard.slice(0, 12)) {
    lines.push(`- ${row.model}: quality ${row.avg_quality_score}, cost/case $${row.avg_cost_per_case_usd}, parse ${row.parse_rate}, eligible ${row.eligible_for_cheapest_pick}`);
  }
  lines.push("", "## Artifacts", "");
  lines.push(`- ${path.join(outdir, "leaderboard.csv")}`);
  lines.push(`- ${path.join(outdir, "leaderboard.json")}`);
  lines.push(`- ${path.join(outdir, "case_scores.csv")}`);
  lines.push(`- ${path.join(outdir, "gold")}`);
  return `${lines.join("\n")}\n`;
}

function extractMessageText(json: Record<string, unknown> | null) {
  const choices = Array.isArray(json?.choices) ? json.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const value = (part as Record<string, unknown>).text ?? (part as Record<string, unknown>).content;
        return typeof value === "string" ? value : "";
      }
      return "";
    }).join("");
  }
  return "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberFromUnknown(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function firstMatch(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  return match ? match[1].trim() : "";
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function round6(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
