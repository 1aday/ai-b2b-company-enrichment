import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ENRICHMENT_FIELD_FILLING_CONTRACT } from "./field-contract.js";
import { ENRICHMENT_OUTPUT_SCHEMA } from "./schema.js";
import { compact, csvEscape, ensureDir, loadLocalEnv, nowStamp, numberValue, parseArgs, parseJsonObject, slug, writeJson } from "./shared.js";

type PacketCase = {
  case_id: string;
  packet_path: string;
  company_name: string;
  domain: string;
  packet_json: Record<string, unknown>;
  md: string;
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
  error: string;
};

type EnrichedRow = {
  case_id: string;
  company_name: string;
  domain: string;
  ok: boolean;
  parse_ok: boolean;
  model: string;
  cost_usd: number;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  canonical_name: string;
  type: string;
  verification_status: string;
  is_capital_source: string;
  confidence_score: string;
  website_url: string;
  logo_url: string;
  hq_location: string;
  address: string;
  postal_code: string;
  fund_commitment_appetite: string;
  invests_in_vc_funds: string;
  invests_directly: string;
  sector_focus: string;
  stage_focus: string;
  geography_focus: string;
  needs_review: string;
  review_reasons: string;
  json_file: string;
  response_file: string;
  packet_path: string;
  error: string;
};

const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
loadLocalEnv(rootDir);

const currentRunPath = path.join(rootDir, "data", "investor_company_enrichment", "current-run.json");
const currentRun = existsSync(currentRunPath) ? JSON.parse(readFileSync(currentRunPath, "utf8")) as { run_dir?: string } : {};
const runDir = path.resolve(args["run-dir"] ?? currentRun.run_dir ?? "");
const packetRoot = path.resolve(args["packet-root"] ?? (runDir ? path.join(runDir, "prepared_for_llm") : ""));
if (!packetRoot || !existsSync(packetRoot)) throw new Error(`Packet root not found: ${packetRoot || "<empty>"}`);

const runId = args["run-id"] ?? `llm-enrichment-${nowStamp()}`;
const outdir = path.resolve(args.outdir ?? path.join(rootDir, "runs", runId));
const model = args.model ?? "nvidia/nemotron-3-super-120b-a12b";
const baseUrl = (args["base-url"] ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
const apiKey = args["api-key"] ?? process.env.OPENROUTER_API_KEY;
const limit = numberValue(args.limit, 0);
const offset = Math.max(0, numberValue(args.offset, 0));
const concurrency = Math.max(1, numberValue(args.concurrency, 4));
const timeoutMs = Math.max(10_000, numberValue(args["timeout-ms"], 120_000));
const maxRetries = Math.max(0, numberValue(args.retries, 2));
const maxOutputTokens = Math.max(1_000, numberValue(args["max-output-tokens"], 12_000));
const maxMdChars = Math.max(4_000, numberValue(args["max-md-chars"], 140_000));
const force = args.force === "true";
const fallbackJsonObject = args["fallback-json-object"] !== "false";
const inputCostPer1m = numberValue(args["input-cost-per-1m"], 0.15);
const outputCostPer1m = numberValue(args["output-cost-per-1m"], 0.6);
const ALLOCATOR_KEYWORD_GATE_TERMS = [
  { label: "investing/investment", pattern: /\binvest(?:s|ed|ing|ment|ments|or|ors)?\b/i },
  { label: "capital", pattern: /\bcapital\b/i },
  { label: "asset", pattern: /\bassets?\b/i },
  { label: "wealth", pattern: /\bwealth\b/i },
  { label: "financial", pattern: /\bfinancial\b/i },
  { label: "finance", pattern: /\bfinance\b/i },
  { label: "securities", pattern: /\bsecurities\b/i },
  { label: "holdings", pattern: /\bholdings?\b/i },
  { label: "trust", pattern: /\btrusts?\b/i },
  { label: "family", pattern: /\bfamily\b/i },
  { label: "office", pattern: /\boffices?\b/i },
  { label: "management", pattern: /\bmanagement\b/i },
  { label: "advisory", pattern: /\badvisory\b/i },
  { label: "allocator/allocation", pattern: /\ballocat(?:e|es|ed|ing|ion|ions|or|ors)?\b/i },
  { label: "capital commitment", pattern: /\bcommit(?:s|ted|ting|ment|ments)?\b/i },
  { label: "limited partner", pattern: /\blimited partners?\b/i },
  { label: "LP", pattern: /\blps?\b/i },
  { label: "fund/funds", pattern: /\bfunds?\b/i },
  { label: "manager", pattern: /\bmanagers?\b/i },
  { label: "partner", pattern: /\bpartners?\b/i },
  { label: "partnership", pattern: /\bpartnerships?\b/i },
  { label: "mandate", pattern: /\bmandates?\b/i },
  { label: "portfolio", pattern: /\bportfolios?\b/i },
  { label: "advisor", pattern: /\badvisors?\b/i },
  { label: "investment manager", pattern: /\binvestment managers?\b/i },
  { label: "external manager", pattern: /\bexternal managers?\b/i },
  { label: "external investment manager", pattern: /\bexternal investment managers?\b/i },
  { label: "external equity manager", pattern: /\bexternal equity managers?\b/i },
  { label: "manager selection", pattern: /\bmanager selection\b/i },
  { label: "prospective manager", pattern: /\bprospective managers?\b/i },
  { label: "private markets", pattern: /\bprivate markets?\b/i },
  { label: "private capital", pattern: /\bprivate capital\b/i },
  { label: "private", pattern: /\bprivate\b/i },
  { label: "equity", pattern: /\bequity\b/i },
  { label: "venture", pattern: /\bventures?\b/i },
  { label: "growth", pattern: /\bgrowth\b/i },
  { label: "buyout", pattern: /\bbuyouts?\b/i },
  { label: "debt", pattern: /\bdebt\b/i },
  { label: "absolute return", pattern: /\babsolute return\b/i },
  { label: "hedge", pattern: /\bhedge\b/i },
  { label: "alternatives", pattern: /\balternatives?\b/i },
  { label: "alternative investments", pattern: /\balternative investments?\b/i },
  { label: "family office", pattern: /\bfamily offices?\b/i },
  { label: "investment office", pattern: /\binvestment offices?\b/i },
  { label: "endowment", pattern: /\bendowments?\b/i },
  { label: "pension", pattern: /\bpensions?\b/i },
  { label: "foundation", pattern: /\bfoundations?\b/i },
  { label: "sovereign wealth", pattern: /\bsovereign wealth\b/i },
  { label: "OCIO", pattern: /\bocios?\b/i },
  { label: "fund-of-funds", pattern: /\bfund[- ]of[- ]funds\b/i },
  { label: "primary fund investment", pattern: /\bprimary fund investments?\b/i },
  { label: "fund partnership", pattern: /\bfund partnerships?\b/i },
  { label: "partnership interest", pattern: /\bpartnership interests?\b/i },
  { label: "secondary investment", pattern: /\bsecondary investments?\b/i },
  { label: "secondaries", pattern: /\bsecondaries\b/i },
  { label: "LP secondary", pattern: /\blp secondaries\b/i },
  { label: "separate account", pattern: /\bseparate accounts?\b/i },
  { label: "commingled fund", pattern: /\bcommingled funds?\b/i },
  { label: "evergreen fund", pattern: /\bevergreen funds?\b/i },
  { label: "co-investment", pattern: /\bco[- ]invest(?:s|ed|ing|ment|ments)?\b/i },
  { label: "general partner", pattern: /\bgeneral partners?\b/i },
  { label: "GP", pattern: /\bgps?\b/i },
  { label: "anchor", pattern: /\banchor\b/i },
  { label: "emerging", pattern: /\bemerging\b/i },
  { label: "diverse", pattern: /\bdiverse\b/i },
  { label: "emerging and diverse manager", pattern: /\bemerging and diverse managers?\b/i },
  { label: "first-time", pattern: /\bfirst[- ]time\b/i },
  { label: "institutional", pattern: /\binstitutional\b/i },
  { label: "asset allocation", pattern: /\basset allocation\b/i },
  { label: "strategic asset allocation", pattern: /\bstrategic asset allocation\b/i },
  { label: "asset liability management", pattern: /\basset liability management\b/i },
  { label: "portfolio allocation", pattern: /\bportfolio allocation\b/i },
  { label: "portfolio construction", pattern: /\bportfolio construction\b/i },
  { label: "capital allocation", pattern: /\bcapital allocation\b/i },
  { label: "capital deployment", pattern: /\bcapital deployment\b/i },
  { label: "capital commitments", pattern: /\bcapital commitments?\b/i },
  { label: "investment proposal", pattern: /\binvestment proposals?\b/i },
  { label: "investment mandate", pattern: /\binvestment mandates?\b/i },
  { label: "discretionary capital", pattern: /\bdiscretionary capital\b/i },
  { label: "customized investment solution", pattern: /\bcustomized investment solutions?\b/i },
  { label: "open architecture", pattern: /\bopen[- ]architecture\b/i },
  { label: "investment committee", pattern: /\binvestment committee\b/i },
  { label: "chief investment officer", pattern: /\bchief investment officer\b/i },
  { label: "outsourced CIO", pattern: /\boutsourced cio\b/i },
  { label: "CIO", pattern: /\bcio\b/i },
  { label: "mission-related investment", pattern: /\bmission[- ]related investments?\b/i },
  { label: "program-related investment", pattern: /\bprogram[- ]related investments?\b/i },
  { label: "endowment partner", pattern: /\bendowment partners?\b/i },
  { label: "qualified purchaser", pattern: /\bqualified purchasers?\b/i },
  { label: "accredited investor", pattern: /\baccredited investors?\b/i },
];
const keywordPrefilterEnabled = booleanArg(args["keyword-prefilter"] ?? args["prefilter-keywords"], true);
const prefilterOnly = booleanArg(args["prefilter-only"], false);

if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");

const outputSchema = (ENRICHMENT_OUTPUT_SCHEMA as { schema?: unknown }).schema;
if (!outputSchema || typeof outputSchema !== "object") throw new Error("ENRICHMENT_OUTPUT_SCHEMA.schema is not an object.");

const responsesDir = path.join(outdir, "responses", slug(model));
const jsonDir = path.join(outdir, "enriched_json");
ensureDir(responsesDir);
ensureDir(jsonDir);

const loadedPackets = loadPacketCases(packetRoot).slice(offset, limit > 0 ? offset + limit : undefined);
if (!loadedPackets.length) throw new Error(`No llm_input.md packets found in ${packetRoot}`);

const emptyContentPackets = loadedPackets.filter((packet) => isEmptyScrapedContentPacket(packet.md));
const contentAvailablePackets = loadedPackets.filter((packet) => !isEmptyScrapedContentPacket(packet.md));
const skippedByKeywordPrefilter = keywordPrefilterEnabled ? contentAvailablePackets.filter((packet) => !passesAllocatorKeywordGate(packet.md)) : [];
const packets = keywordPrefilterEnabled ? contentAvailablePackets.filter((packet) => passesAllocatorKeywordGate(packet.md)) : contentAvailablePackets;

const startedAt = new Date().toISOString();
writeJson(path.join(outdir, "keyword-prefilter.json"), {
  enabled: keywordPrefilterEnabled,
  mode: "allocator_keyword_gate",
  input_packets: loadedPackets.length,
  empty_content_packets: emptyContentPackets.length,
  passed_packets: packets.length,
  skipped_packets: skippedByKeywordPrefilter.length + emptyContentPackets.length,
  skipped_empty_content: emptyContentPackets.map((packet) => ({
    case_id: packet.case_id,
    company_name: packet.company_name,
    domain: packet.domain,
    reason: "No usable scraped company-site or third-party content was kept; route to scrape retry, not LLM enrichment.",
  })),
  skipped_no_keywords: skippedByKeywordPrefilter.map((packet) => ({
    case_id: packet.case_id,
    company_name: packet.company_name,
    domain: packet.domain,
    reason: "No allocator/fundraising keywords found in scraped markdown packet.",
  })),
  skipped: [
    ...emptyContentPackets.map((packet) => ({
      case_id: packet.case_id,
      company_name: packet.company_name,
      domain: packet.domain,
      reason: "No usable scraped company-site or third-party content was kept; route to scrape retry, not LLM enrichment.",
      skip_type: "empty_scraped_content",
    })),
    ...skippedByKeywordPrefilter.map((packet) => ({
      case_id: packet.case_id,
      company_name: packet.company_name,
      domain: packet.domain,
      reason: "No allocator/fundraising keywords found in scraped markdown packet.",
      skip_type: "no_allocator_keywords",
    })),
  ],
  keywords: ALLOCATOR_KEYWORD_GATE_TERMS.map((term) => term.label),
});

writeJson(path.join(outdir, "config.json"), {
  run_id: runId,
  provider: "openrouter",
  base_url: baseUrl,
  model,
  packet_root: packetRoot,
  input_packet_count: loadedPackets.length,
  packet_count: packets.length,
  skipped_empty_content: emptyContentPackets.length,
  skipped_by_keyword_prefilter: skippedByKeywordPrefilter.length,
  skipped_before_llm: skippedByKeywordPrefilter.length + emptyContentPackets.length,
  keyword_prefilter: keywordPrefilterEnabled,
  prefilter_only: prefilterOnly,
  offset,
  limit,
  concurrency,
  timeout_ms: timeoutMs,
  max_output_tokens: maxOutputTokens,
  max_md_chars: maxMdChars,
  retries: maxRetries,
  started_at: startedAt,
});

const rows: EnrichedRow[] = [];
let cursor = 0;
let completed = 0;

if (prefilterOnly) {
  persistRows();
  writeJson(path.join(outdir, "summary.json"), {
    run_id: runId,
    provider: "openrouter",
    base_url: baseUrl,
    model,
    packet_root: packetRoot,
    input_packets: loadedPackets.length,
    packets: packets.length,
    completed: 0,
    skipped_empty_content: emptyContentPackets.length,
    skipped_by_keyword_prefilter: skippedByKeywordPrefilter.length,
    skipped_before_llm: skippedByKeywordPrefilter.length + emptyContentPackets.length,
    parse_ok: 0,
    total_cost_usd: 0,
    avg_latency_ms: 0,
    prefilter_only: true,
    output_files: {
      enriched_csv: path.join(outdir, "enriched.csv"),
      enriched_json_dir: jsonDir,
      responses_dir: responsesDir,
      config: path.join(outdir, "config.json"),
      keyword_prefilter: path.join(outdir, "keyword-prefilter.json"),
    },
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  });
  console.log(JSON.stringify({
    run_id: runId,
    outdir,
    model,
    provider: "openrouter",
    input_packets: loadedPackets.length,
    packets_would_pass_to_llm: packets.length,
    skipped_empty_content: emptyContentPackets.length,
    skipped_by_keyword_prefilter: skippedByKeywordPrefilter.length,
    skipped_before_llm: skippedByKeywordPrefilter.length + emptyContentPackets.length,
    total_cost_usd: 0,
    prefilter_only: true,
    keyword_prefilter: path.join(outdir, "keyword-prefilter.json"),
    summary: path.join(outdir, "summary.json"),
  }, null, 2));
  process.exit(0);
}

if (!packets.length) {
  persistRows();
  writeJson(path.join(outdir, "summary.json"), {
    run_id: runId,
    provider: "openrouter",
    base_url: baseUrl,
    model,
    packet_root: packetRoot,
    input_packets: loadedPackets.length,
    packets: 0,
    completed: 0,
    skipped_empty_content: emptyContentPackets.length,
    skipped_by_keyword_prefilter: skippedByKeywordPrefilter.length,
    skipped_before_llm: skippedByKeywordPrefilter.length + emptyContentPackets.length,
    parse_ok: 0,
    total_cost_usd: 0,
    avg_latency_ms: 0,
    output_files: {
      enriched_csv: path.join(outdir, "enriched.csv"),
      enriched_json_dir: jsonDir,
      responses_dir: responsesDir,
      config: path.join(outdir, "config.json"),
      keyword_prefilter: path.join(outdir, "keyword-prefilter.json"),
    },
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  });
  console.log(JSON.stringify({
    run_id: runId,
    outdir,
    model,
    provider: "openrouter",
    packets: 0,
    skipped_empty_content: emptyContentPackets.length,
    skipped_by_keyword_prefilter: skippedByKeywordPrefilter.length,
    skipped_before_llm: skippedByKeywordPrefilter.length + emptyContentPackets.length,
    total_cost_usd: 0,
    enriched_csv: path.join(outdir, "enriched.csv"),
    keyword_prefilter: path.join(outdir, "keyword-prefilter.json"),
    summary: path.join(outdir, "summary.json"),
  }, null, 2));
  process.exit(0);
}

await Promise.all(Array.from({ length: Math.min(concurrency, packets.length) }, async () => {
  while (true) {
    const index = cursor++;
    const packet = packets[index];
    if (!packet) return;
    const responsePath = path.join(responsesDir, `${packet.case_id}.json`);
    const jsonPath = path.join(jsonDir, `${packet.case_id}.json`);
    let result: ApiResult;
    if (!force && existsSync(responsePath)) {
      result = JSON.parse(readFileSync(responsePath, "utf8")) as ApiResult;
    } else {
      result = await callChatCompletion(packet);
      writeJson(responsePath, {
        ...result,
        case_id: packet.case_id,
        company_name: packet.company_name,
        domain: packet.domain,
        packet_path: packet.packet_path,
        provider: "openrouter",
        base_url: baseUrl,
      });
    }
    if (result.parsed) {
      result = {
        ...result,
        parsed: applyDeterministicDefaults(result.parsed, packet),
      };
      writeJson(jsonPath, result.parsed);
    }
    rows.push(summarizeResult(packet, result, result.parsed ? jsonPath : "", responsePath));
    completed += 1;
    persistRows();
    console.log(JSON.stringify({
      phase: "enrich",
      completed,
      total: packets.length,
      model,
      case_id: packet.case_id,
      ok: result.ok,
      parse_ok: Boolean(result.parsed),
      cost_usd: round6(result.cost_usd),
      elapsed_ms: result.elapsed_ms,
      error: result.error,
    }));
  }
}));

persistRows();
writeJson(path.join(outdir, "summary.json"), {
  run_id: runId,
  provider: "openrouter",
  base_url: baseUrl,
  model,
  packet_root: packetRoot,
  input_packets: loadedPackets.length,
  packets: packets.length,
  completed: rows.length,
  skipped_empty_content: emptyContentPackets.length,
  skipped_by_keyword_prefilter: skippedByKeywordPrefilter.length,
  skipped_before_llm: skippedByKeywordPrefilter.length + emptyContentPackets.length,
  parse_ok: rows.filter((row) => row.parse_ok).length,
  total_cost_usd: round6(rows.reduce((sum, row) => sum + row.cost_usd, 0)),
  avg_latency_ms: Math.round(average(rows.map((row) => row.latency_ms))),
  output_files: {
    enriched_csv: path.join(outdir, "enriched.csv"),
    enriched_json_dir: jsonDir,
    responses_dir: responsesDir,
    config: path.join(outdir, "config.json"),
    keyword_prefilter: path.join(outdir, "keyword-prefilter.json"),
  },
  started_at: startedAt,
  finished_at: new Date().toISOString(),
});

console.log(JSON.stringify({
  run_id: runId,
  outdir,
  model,
  provider: "openrouter",
  input_packets: loadedPackets.length,
  packets: packets.length,
  skipped_empty_content: emptyContentPackets.length,
  skipped_by_keyword_prefilter: skippedByKeywordPrefilter.length,
  skipped_before_llm: skippedByKeywordPrefilter.length + emptyContentPackets.length,
  enriched_csv: path.join(outdir, "enriched.csv"),
  enriched_json_dir: jsonDir,
  summary: path.join(outdir, "summary.json"),
}, null, 2));

async function callChatCompletion(packet: PacketCase): Promise<ApiResult> {
  const prompt = buildPrompt(packet);
  let last: ApiResult | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const started = Date.now();
    const first = await postChatCompletion(buildRequestBody(prompt, true));
    let result: ApiResult;
    if (!first.ok && fallbackJsonObject && (first.status === 400 || first.status === 404 || first.status === 422)) {
      const fallback = await postChatCompletion(buildRequestBody(prompt, false));
      result = formatApiResult(fallback, prompt, Date.now() - started, true);
    } else {
      result = formatApiResult(first, prompt, Date.now() - started, false);
    }
    last = result;
    if (result.parsed) return result;
    if (attempt < maxRetries) {
      console.log(JSON.stringify({
        phase: "retry",
        model,
        case_id: packet.case_id,
        attempt: attempt + 1,
        max_retries: maxRetries,
        error: result.error || compact(result.raw_text, 120),
      }));
    }
  }
  return last as ApiResult;
}

function buildRequestBody(prompt: string, structured: boolean) {
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
          "You fill one VC-fundraising-target enrichment JSON object from scraped first-party company-site markdown.",
          "Use only the supplied markdown packet and packet metadata. Do not use bought-list labels or outside knowledge.",
          "A valid target is an entity that appears able and likely to commit capital to VC funds, emerging managers, private funds, fund-of-funds, or alternative investment vehicles.",
          "Valid target categories include single-family offices, multi-family offices, family-backed investment offices, private investment offices, family foundations with investment activity, private foundations, charitable foundations, university endowments, hospital or nonprofit endowments, public pension plans, corporate pension plans, Taft-Hartley or union pension plans, sovereign wealth funds, government investment funds, insurance company investment offices, bank treasury or investment offices, asset allocators, OCIOs with allocator discretion, fund-of-funds, venture fund-of-funds, private equity fund-of-funds, alternatives fund platforms, investment consultants or advisors that allocate discretionary capital, wealth management platforms with alternatives allocation, RIAs with private fund allocation, private banks, family-office advisory platforms with capital allocation, corporate investment arms that invest in funds, strategic investors that commit to external funds, foundations or trusts that allocate to alternatives, and institutional allocators to private markets.",
          "Evidence that supports a valid target includes explicit LP activity, fund commitments, investing in venture capital funds, investing in external managers, manager selection, fund investments, fund-of-funds activity, emerging manager programs, first-time fund consideration, alternatives allocation, private markets allocation, co-investment alongside funds, backing general partners, anchor investor language, investment committee allocation language, endowment or pension portfolio allocation, or family office capital allocation.",
          "If the scraped evidence does not fit the valid target definition and evidence triggers above, reject the entity.",
          "If the entity is rejected, the rejection rationale must be one sentence maximum.",
          "Be conservative: if a fact is not directly supported, use unknown, null, [], or a conservative negative enum as required by the schema.",
          "Hard invariant: if verification.is_capital_source is false, verification.status must be rejected and type must be not_lp_target.",
          "Never invent principals, check sizes, AUM, fund appetite, sectors, stages, geographies, or contacts.",
          "For address, use the fullest supported address in the scraped content, including postal or ZIP code when present.",
          "Identity metadata from the packet, including domain, website_url, logo_url, full_address, and postal_code, is allowed when it comes from scraped site metadata.",
          "Return JSON only.",
        ].join(" "),
      },
      { role: "user", content: prompt },
    ],
    max_tokens: maxOutputTokens,
    temperature: 0,
    response_format: responseFormat,
    provider: structured ? { require_parameters: true } : undefined,
  };
}

function buildPrompt(packet: PacketCase) {
  const contract = {
    value_style: ENRICHMENT_FIELD_FILLING_CONTRACT.value_style,
    type_values: ENRICHMENT_FIELD_FILLING_CONTRACT.type_values,
    sensitive_field_rules: ENRICHMENT_FIELD_FILLING_CONTRACT.sensitive_field_rules,
    portfolio_rules: ENRICHMENT_FIELD_FILLING_CONTRACT.portfolio_rules,
    fit_assessment_rules: ENRICHMENT_FIELD_FILLING_CONTRACT.fit_assessment_rules,
    categorical_array_examples: ENRICHMENT_FIELD_FILLING_CONTRACT.categorical_array_examples,
  };
  return [
    "Task: create the final enrichment JSON for this one entity.",
    "",
    "Schema:",
    JSON.stringify(outputSchema),
    "",
    "Field-filling contract:",
    JSON.stringify(contract),
    "",
    "Additional extraction discipline:",
    "- Treat first_party_sources as primary evidence.",
    "- Treat third_party_sources as secondary context only.",
    "- Do not copy CSV/list type labels into type or investment fields.",
    "- Classify the entity against the explicit VC-fundraising-target taxonomy in the system message before filling enrichment fields.",
    "- Do not infer VC fund LP appetite unless the scraped evidence fits the valid target definition and evidence triggers in the system message.",
    "- If rejected, keep verification.rationale to one sentence maximum and do not include a long list of missing fields as the rejection reason.",
    "- Only fill logo_url from packet entity/candidates/source assets or explicit website assets; otherwise use unknown.",
    "- If packet entity metadata includes website_url, logo_url, full_address, or postal_code, copy those fields unless contradicted by scraped page text.",
    "- Use source_evidence for material claims; clean URLs only.",
    "- Before final JSON, silently check status/type consistency, unknown policy, full address, enum normalization, and unsupported overfilling.",
    "",
    "Scraped markdown packet:",
    packet.md.slice(0, maxMdChars),
    "",
    "Return exactly one JSON object matching the schema. No markdown. No commentary.",
  ].join("\n");
}

async function postChatCompletion(body: Record<string, unknown>) {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/1aday/capital-source-enrichment",
        "X-Title": "Capital Source LLM Enrichment Flow",
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
    return { ok: response.ok, status: response.status, json, text };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatApiResult(response: Awaited<ReturnType<typeof postChatCompletion>>, prompt: string, elapsedMs: number, usedFallback: boolean): ApiResult {
  const rawText = extractMessageText(response.json) || response.text;
  const parsedCandidate = rawText ? parseJsonObject(rawText) : null;
  const parsed = isCompleteEnrichmentObject(parsedCandidate) ? parsedCandidate : null;
  const usage = objectValue(response.json?.usage);
  const promptTokens = numberFromUnknown(usage.prompt_tokens) || estimateTokens(prompt);
  const completionTokens = numberFromUnknown(usage.completion_tokens) || estimateTokens(rawText);
  const costUsd = promptTokens * inputCostPer1m / 1_000_000 + completionTokens * outputCostPer1m / 1_000_000;
  return {
    ok: response.ok && Boolean(parsed),
    model,
    response_id: String(response.json?.id ?? ""),
    parsed,
    raw_text: rawText,
    usage,
    cost_usd: costUsd,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    elapsed_ms: elapsedMs,
    used_fallback_response_format: usedFallback,
    error: response.ok ? (!parsed ? "response did not parse as complete enrichment JSON object" : "") : compact(response.text, 500),
  };
}

function isCompleteEnrichmentObject(value: Record<string, unknown> | null): value is Record<string, unknown> {
  if (!value) return false;
  const verification = objectValue(value.verification);
  return Boolean(
    stringValue(value.canonical_name)
    && stringValue(value.type)
    && typeof verification.is_capital_source === "boolean"
    && stringValue(verification.status)
    && value.profile
    && typeof value.profile === "object"
    && value.capital_profile
    && typeof value.capital_profile === "object"
  );
}

function summarizeResult(packet: PacketCase, result: ApiResult, jsonPath: string, responsePath: string): EnrichedRow {
  const parsed = result.parsed ?? {};
  const verification = objectValue(parsed.verification);
  const profile = objectValue(parsed.profile);
  const capitalProfile = objectValue(parsed.capital_profile);
  const quality = objectValue(parsed.quality);
  return {
    case_id: packet.case_id,
    company_name: packet.company_name,
    domain: packet.domain,
    ok: result.ok,
    parse_ok: Boolean(result.parsed),
    model,
    cost_usd: round6(result.cost_usd),
    latency_ms: result.elapsed_ms,
    prompt_tokens: result.prompt_tokens,
    completion_tokens: result.completion_tokens,
    canonical_name: stringValue(parsed.canonical_name),
    type: stringValue(parsed.type),
    verification_status: stringValue(verification.status),
    is_capital_source: stringValue(verification.is_capital_source),
    confidence_score: stringValue(verification.confidence_score),
    website_url: stringValue(parsed.website_url),
    logo_url: stringValue(parsed.logo_url),
    hq_location: stringValue(profile.hq_location),
    address: stringValue(profile.address),
    postal_code: stringValue(profile.postal_code),
    fund_commitment_appetite: stringValue(capitalProfile.fund_commitment_appetite),
    invests_in_vc_funds: stringValue(capitalProfile.invests_in_vc_funds),
    invests_directly: stringValue(capitalProfile.invests_directly),
    sector_focus: arrayValue(capitalProfile.sector_focus).join("|"),
    stage_focus: arrayValue(capitalProfile.stage_focus).join("|"),
    geography_focus: arrayValue(capitalProfile.geography_focus).join("|"),
    needs_review: stringValue(quality.needs_review),
    review_reasons: arrayValue(quality.review_reasons).join("|"),
    json_file: jsonPath ? path.relative(outdir, jsonPath).replaceAll("\\", "/") : "",
    response_file: path.relative(outdir, responsePath).replaceAll("\\", "/"),
    packet_path: packet.packet_path,
    error: result.error,
  };
}

function applyDeterministicDefaults(parsed: Record<string, unknown>, packet: PacketCase) {
  const next = structuredClone(parsed) as Record<string, unknown>;
  const packetJson = packet.packet_json;
  const entity = objectValue(packetJson.entity);
  const candidates = objectValue(packetJson.candidates);
  const assets = objectValue(candidates.assets);
  const address = objectValue(candidates.address);
  const profile = objectValue(next.profile);
  next.profile = profile;

  setIfUnknown(next, "source_record_id", firstString(entity.source_record_id, packet.case_id));
  setIfUnknown(next, "canonical_name", firstString(entity.company_name, entity.legal_name, packet.company_name));
  setIfUnknown(next, "domain", firstString(entity.domain, packet.domain));
  setIfUnknown(next, "website_url", firstString(entity.website_url));
  setIfUnknown(next, "logo_url", firstString(entity.logo_url, assets.logo_url, firstArrayString(assets.logo_candidates), firstArrayString(assets.favicon_candidates)));
  setIfUnknown(profile, "address", firstString(entity.full_address, address.full_address));
  setIfUnknown(profile, "postal_code", firstString(entity.postal_code, address.postal_code));
  setIfUnknown(profile, "hq_location", firstString(entity.hq_location, entity.full_address, address.full_address));
  return next;
}

function setIfUnknown(target: Record<string, unknown>, key: string, value: string) {
  if (!value) return;
  const current = stringValue(target[key]).trim();
  if (!current || current.toLowerCase() === "unknown" || current.toLowerCase() === "null") target[key] = value;
}

function persistRows() {
  const sorted = [...rows].sort((a, b) => a.case_id.localeCompare(b.case_id));
  writeJson(path.join(outdir, "enriched-index.json"), sorted);
  writeFileSync(path.join(outdir, "enriched.csv"), renderCsv(sorted));
}

function loadPacketCases(root: string): PacketCase[] {
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((dir) => existsSync(path.join(dir, "llm_input.md")))
    .sort();
  return dirs.map((dir) => {
    const packetPath = path.join(dir, "llm_input.md");
    const jsonPath = path.join(dir, "llm_input.json");
    const parsed = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")) as { entity?: Record<string, unknown> } : {};
    const entity = parsed.entity ?? {};
    const companyName = stringValue(entity.company_name) || stringValue(entity.canonical_name) || path.basename(dir);
    const domain = stringValue(entity.domain);
    return {
      case_id: path.basename(dir),
      packet_path: packetPath,
      company_name: companyName,
      domain,
      packet_json: parsed as Record<string, unknown>,
      md: readFileSync(packetPath, "utf8"),
    };
  });
}

function renderCsv(items: EnrichedRow[]) {
  if (!items.length) return "";
  const headers = Object.keys(items[0]) as Array<keyof EnrichedRow>;
  return `${headers.join(",")}\n${items.map((row) => headers.map((header) => csvEscape(row[header])).join(",")).join("\n")}\n`;
}

function booleanArg(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function passesAllocatorKeywordGate(markdown: string) {
  return ALLOCATOR_KEYWORD_GATE_TERMS.some((term) => term.pattern.test(stripPacketMetadataForKeywordGate(markdown)));
}

function isEmptyScrapedContentPacket(markdown: string) {
  return /No usable company-site content was kept after cleanup\./i.test(markdown)
    && /No usable third-party content was kept after cleanup\./i.test(markdown);
}

function stripPacketMetadataForKeywordGate(markdown: string) {
  return markdown
    .replace(/^Company:\s*.+$/gim, "")
    .replace(/^Domain:\s*.+$/gim, "")
    .replace(/^Full address:\s*.+$/gim, "")
    .replace(/^# Scraped content for .+$/gim, "");
}

function extractMessageText(json: Record<string, unknown> | null) {
  const choices = Array.isArray(json?.choices) ? json.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = objectValue(first?.message);
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => objectValue(item).text).filter((item): item is string => typeof item === "string").join("\n");
  }
  return "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const textValue = stringValue(value).trim();
    if (textValue && textValue !== "[]" && textValue !== "{}" && textValue.toLowerCase() !== "unknown" && textValue.toLowerCase() !== "null") return textValue;
  }
  return "";
}

function firstArrayString(value: unknown) {
  return arrayValue(value)[0] ?? "";
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => stringValue(item)).filter(Boolean).join("|");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function estimateTokens(textValue: string) {
  return Math.ceil((textValue || "").length / 4);
}

function average(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function round6(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
