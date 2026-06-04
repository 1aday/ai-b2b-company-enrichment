import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, any>;

export async function GET() {
  const root = process.env.ENRICHMENT_ROOT || path.resolve(process.cwd(), "..");
  const artifactRoot = path.join(root, "autoresearch-results");
  const state = readJson(path.join(artifactRoot, "state.json"));
  const context = readJson(path.join(artifactRoot, "context.json"));
  const runtime = readJson(path.join(artifactRoot, "runtime.json"));
  const launch = readJson(path.join(artifactRoot, "launch.json"));
  const results = readTsv(path.join(artifactRoot, "results.tsv"));
  const runtimeLog = tailFile(path.join(artifactRoot, "runtime.log"), 90);
  const lessons = tailFile(path.join(artifactRoot, "lessons.md"), 120);
  const dashboardLog = tailFile(path.join(artifactRoot, "dashboard-publish-loop.log"), 40);
  const benchmarkRuns = discoverBenchmarkRuns(path.join(root, "runs"));

  return NextResponse.json({
    status: state?.state?.last_status || "unknown",
    root,
    artifact_root: artifactRoot,
    exists: existsSync(artifactRoot),
    state,
    context,
    runtime,
    launch,
    results,
    benchmark_runs: benchmarkRuns,
    logs: {
      runtime: runtimeLog,
      dashboard_publish: dashboardLog,
      lessons,
    },
    files: fileMap(artifactRoot, [
      "state.json",
      "context.json",
      "results.tsv",
      "runtime.json",
      "runtime.log",
      "launch.json",
      "lessons.md",
    ]),
    generated_at: new Date().toISOString(),
  });
}

function discoverBenchmarkRuns(runsRoot: string) {
  if (!existsSync(runsRoot)) return [];
  return readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("site-md-model-benchmark"))
    .map((entry) => {
      const runDir = path.join(runsRoot, entry.name);
      const config = readJson(path.join(runDir, "config.json"));
      const scores = readCombinedCaseScores(runDir);
      const storedLeaderboard = readJsonArray(path.join(runDir, "leaderboard.json"));
      const fieldComparison = buildFieldComparison(runDir, scores);
      const leaderboard = (scores.length ? aggregateLeaderboard(scores, config) : storedLeaderboard)
        .map((row) => ({ ...row, ...(fieldComparison.by_model[String(row.model || "")] || emptyFieldStats()) }));
      const expectedCases = Array.isArray(config?.cases) ? config.cases.length : Number(config?.cases || 0);
      const expectedModels = Array.isArray(config?.candidate_models) ? config.candidate_models.length : Number(config?.candidate_models_count || 0);
      const goldDir = path.join(runDir, "gold");
      const goldStats = countGoldCases(goldDir, config, expectedCases);
      const expectedScores = expectedCases * expectedModels;
      const completedFraction = expectedScores ? scores.length / expectedScores : 0;
      const best = leaderboard[0] || null;
      const cheapestEligible = [...leaderboard]
        .filter((row) => row.eligible_for_cheapest_pick)
        .sort((a, b) => Number(a.avg_cost_per_case_usd || Infinity) - Number(b.avg_cost_per_case_usd || Infinity))[0] || null;
      return {
        run_id: entry.name,
        run_dir: runDir,
        gold_model: config?.gold_model || "unknown",
        expected_cases: expectedCases,
        expected_models: expectedModels,
        expected_scores: expectedScores,
        scored: scores.length,
        completed_fraction: round4(completedFraction),
        gold_cases: goldStats.valid,
        gold_valid_cases: goldStats.valid,
        gold_invalid_cases: goldStats.invalid,
        gold_missing_cases: goldStats.missing,
        gold_file_cases: goldStats.files,
        best_model: best,
        cheapest_eligible_model: cheapestEligible,
        leaderboard: leaderboard.slice(0, 8),
        field_summary: fieldComparison.summary,
        field_breakdown: fieldComparison.breakdown.slice(0, 80),
        updated_at: newestMtime(runDir),
        files: fileMap(runDir, ["config.json", "case_scores.csv", "case_scores.json", "leaderboard.csv", "leaderboard.json", "summary.md"]),
      };
    })
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

function readCombinedCaseScores(runDir: string) {
  const byKey = new Map<string, JsonObject>();
  for (const score of readJsonArray(path.join(runDir, "case_scores.json"))) {
    const model = String(score.model || "");
    const caseId = String(score.case_id || "");
    if (model && caseId) byKey.set(`${model}|||${caseId}`, score);
  }

  const shardRoot = path.join(runDir, "model_shards");
  if (existsSync(shardRoot)) {
    for (const entry of readdirSync(shardRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const score of readJsonArray(path.join(shardRoot, entry.name, "case_scores.json"))) {
        const model = String(score.model || "");
        const caseId = String(score.case_id || "");
        if (model && caseId) byKey.set(`${model}|||${caseId}`, score);
      }
    }
  }

  return [...byKey.values()];
}

function countGoldCases(goldDir: string, config: JsonObject, expectedCases: number) {
  const fileCaseIds = existsSync(goldDir)
    ? readdirSync(goldDir)
      .filter((name) => name.endsWith(".json") && name !== "gold_index.json")
      .map((name) => name.replace(/\.json$/, ""))
    : [];
  const configuredCaseIds = Array.isArray(config?.cases)
    ? config.cases.map((item: any) => typeof item === "string" ? item : String(item?.id || item?.case_id || item?.slug || "")).filter(Boolean)
    : [];
  const targetCaseIds = configuredCaseIds.length ? configuredCaseIds : fileCaseIds;
  let valid = 0;
  let invalid = 0;
  let missing = 0;

  for (const caseId of targetCaseIds) {
    const goldPath = path.join(goldDir, `${caseId}.json`);
    if (!existsSync(goldPath)) {
      missing++;
      continue;
    }
    const payload = readJson(goldPath);
    if (payload?.ok === true && payload?.parsed && typeof payload.parsed === "object") valid++;
    else invalid++;
  }

  if (!configuredCaseIds.length && expectedCases > targetCaseIds.length) {
    missing += expectedCases - targetCaseIds.length;
  }

  return { valid, invalid, missing, files: fileCaseIds.length };
}

function aggregateLeaderboard(scores: JsonObject[], config: JsonObject) {
  const expectedCases = Array.isArray(config?.cases) ? config.cases.length : Number(config?.cases || 0);
  const minQuality = Number(config?.min_quality_for_cheap_pick || 0.78);
  const byModel = new Map<string, JsonObject[]>();
  for (const score of scores) {
    const model = String(score.model || "");
    if (!model) continue;
    const rows = byModel.get(model) || [];
    rows.push(score);
    byModel.set(model, rows);
  }
  return [...byModel.entries()]
    .map(([model, rows]) => {
      const totalCost = rows.reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
      const quality = average(rows.map((row) => Number(row.quality_score || 0)));
      const parseRate = average(rows.map((row) => row.parse_ok === true ? 1 : 0));
      return {
        model,
        cases: rows.length,
        avg_quality_score: round4(quality),
        parse_rate: round4(parseRate),
        total_cost_usd: round6(totalCost),
        avg_cost_per_case_usd: round6(rows.length ? totalCost / rows.length : 0),
        total_latency_ms: Math.round(rows.reduce((sum, row) => sum + Number(row.latency_ms || 0), 0)),
        avg_latency_ms: Math.round(average(rows.map((row) => Number(row.latency_ms || 0)))),
        eligible_for_cheapest_pick: rows.length >= expectedCases && quality >= minQuality && parseRate >= 0.9,
      };
    })
    .sort((a, b) => Number(b.avg_quality_score || 0) - Number(a.avg_quality_score || 0));
}

const FIELD_PATHS = [
  "canonical_name",
  "domain",
  "website_url",
  "logo_url",
  "type",
  "verification.is_capital_source",
  "verification.status",
  "verification.confidence_score",
  "profile.one_line_description",
  "profile.detailed_profile_summary",
  "profile.hq_location",
  "profile.address",
  "profile.postal_code",
  "profile.operating_geographies",
  "profile.capital_source_context",
  "profile.ownership_background",
  "profile.public_principal_name",
  "capital_profile.capital_role_summary",
  "capital_profile.invests_in_vc_funds",
  "capital_profile.invests_directly",
  "capital_profile.co_investment_appetite",
  "capital_profile.fund_commitment_appetite",
  "capital_profile.preferred_fund_stage",
  "capital_profile.emerging_manager_appetite",
  "capital_profile.first_time_fund_appetite",
  "capital_profile.fund_size_preference",
  "capital_profile.sector_focus",
  "capital_profile.stage_focus",
  "capital_profile.geography_focus",
  "capital_profile.business_model_preferences",
  "capital_profile.impact_or_values_themes",
  "portfolio_signals.known_fund_investments",
  "portfolio_signals.known_direct_investments",
  "outreach.fundraise_fit_notes",
  "outreach.fit_risk_notes",
];

function buildFieldComparison(runDir: string, scores: JsonObject[]) {
  const byModel: Record<string, JsonObject> = {};
  const byModelField = new Map<string, JsonObject>();

  for (const score of scores) {
    const model = String(score.model || "");
    const caseId = String(score.case_id || "");
    if (!model || !caseId) continue;
    const modelStats = byModel[model] || emptyFieldStats();
    byModel[model] = modelStats;

    const goldEnvelope = readJson(path.join(runDir, "gold", `${caseId}.json`));
    const gold = goldEnvelope?.ok === true && goldEnvelope?.parsed && typeof goldEnvelope.parsed === "object" ? goldEnvelope.parsed : null;
    if (!gold) continue;
    const candidate = readJson(path.join(runDir, "responses", slug(model), `${caseId}.json`))?.parsed || null;

    for (const field of FIELD_PATHS) {
      const goldValue = gold ? valueAt(gold, field) : undefined;
      const candidateValue = candidate ? valueAt(candidate, field) : undefined;
      const result = classifyField(candidateValue, goldValue);
      bumpFieldStats(modelStats, result);

      const fieldKey = `${model}|||${field}`;
      const fieldStats = byModelField.get(fieldKey) || {
        model,
        field,
        field_total: 0,
        field_correct: 0,
        field_partial: 0,
        field_incorrect: 0,
        field_missing: 0,
      };
      bumpFieldStats(fieldStats, result);
      byModelField.set(fieldKey, fieldStats);
    }
  }

  for (const stats of Object.values(byModel)) finalizeFieldStats(stats);
  const breakdown = [...byModelField.values()].map((row) => finalizeFieldStats(row))
    .sort((a, b) => String(a.model).localeCompare(String(b.model)) || Number(a.field_accuracy || 0) - Number(b.field_accuracy || 0));
  const summary = Object.entries(byModel)
    .map(([model, stats]) => ({ model, ...stats }))
    .sort((a, b) => Number(b.field_accuracy || 0) - Number(a.field_accuracy || 0));
  return { by_model: byModel, breakdown, summary };
}

function emptyFieldStats() {
  return {
    field_total: 0,
    field_correct: 0,
    field_partial: 0,
    field_incorrect: 0,
    field_missing: 0,
    field_accuracy: 0,
  };
}

function bumpFieldStats(stats: JsonObject, result: "correct" | "partial" | "incorrect" | "missing") {
  stats.field_total = Number(stats.field_total || 0) + 1;
  if (result === "correct") stats.field_correct = Number(stats.field_correct || 0) + 1;
  if (result === "partial") stats.field_partial = Number(stats.field_partial || 0) + 1;
  if (result === "incorrect") stats.field_incorrect = Number(stats.field_incorrect || 0) + 1;
  if (result === "missing") {
    stats.field_missing = Number(stats.field_missing || 0) + 1;
    stats.field_incorrect = Number(stats.field_incorrect || 0) + 1;
  }
}

function finalizeFieldStats<T extends JsonObject>(stats: T): T {
  const total = Number(stats.field_total || 0);
  const correct = Number(stats.field_correct || 0);
  const partial = Number(stats.field_partial || 0);
  stats.field_accuracy = total ? round4((correct + Number(stats.field_partial || 0) * 0.5) / total) : 0;
  return stats;
}

function classifyField(candidate: unknown, gold: unknown): "correct" | "partial" | "incorrect" | "missing" {
  const candidateUnknown = isUnknownValue(candidate);
  const goldUnknown = isUnknownValue(gold);
  if (candidateUnknown && goldUnknown) return "correct";
  if (candidateUnknown && !goldUnknown) return "missing";
  if (!candidateUnknown && goldUnknown) return "partial";
  const score = scoreValue(candidate, gold);
  if (score >= 0.82) return "correct";
  if (score >= 0.45) return "partial";
  return "incorrect";
}

function scoreValue(candidate: unknown, gold: unknown): number {
  if (typeof candidate === "boolean" || typeof gold === "boolean") return candidate === gold ? 1 : 0;
  if (typeof candidate === "number" || typeof gold === "number") return scoreNumber(candidate, gold);
  if (Array.isArray(candidate) || Array.isArray(gold)) return scoreArray(candidate, gold);
  if (typeof candidate === "object" || typeof gold === "object") return tokenJaccard(normalizeText(JSON.stringify(candidate)), normalizeText(JSON.stringify(gold)));
  return scoreString(String(candidate ?? ""), String(gold ?? ""));
}

function scoreString(candidate: string, gold: string): number {
  const a = normalizeText(candidate);
  const g = normalizeText(gold);
  if (!a || !g) return a === g ? 1 : 0;
  if (a === g) return 1;
  if (a.includes(g) || g.includes(a)) return 0.76;
  return Math.min(0.82, tokenJaccard(a, g));
}

function scoreNumber(candidate: unknown, gold: unknown): number {
  const a = Number(candidate);
  const g = Number(gold);
  if (!Number.isFinite(a) || !Number.isFinite(g)) return 0;
  if (a === g) return 1;
  const diff = Math.abs(a - g);
  if (g >= 0 && g <= 1 && a >= 0 && a <= 1) return Math.max(0, 1 - diff);
  return Math.max(0, 1 - diff / Math.max(1, Math.abs(g)));
}

function scoreArray(candidate: unknown, gold: unknown): number {
  const actualItems = arrayTerms(candidate);
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
  return [...new Set(array.map((item) => typeof item === "object" ? normalizeText(JSON.stringify(item)) : normalizeText(String(item))).filter(Boolean))];
}

function valueAt(value: JsonObject, fieldPath: string): unknown {
  let current: unknown = value;
  for (const part of fieldPath.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as JsonObject)[part];
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

function tokenJaccard(candidate: string, gold: string) {
  const a = new Set(candidate.split(/\s+/).filter((item) => item.length > 2));
  const g = new Set(gold.split(/\s+/).filter((item) => item.length > 2));
  if (!a.size && !g.size) return 1;
  if (!a.size || !g.size) return 0;
  const intersection = [...a].filter((item) => g.has(item)).length;
  return intersection / new Set([...a, ...g]).size;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "item";
}

function readJson(filePath: string): JsonObject {
  try {
    return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function readJsonArray(filePath: string): JsonObject[] {
  const parsed = readJson(filePath);
  return Array.isArray(parsed) ? parsed : [];
}

function readTsv(filePath: string) {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"));
  if (!lines.length) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => Object.fromEntries(line.split("\t").map((value, index) => [headers[index] || `col_${index}`, value])));
}

function tailFile(filePath: string, maxLines: number) {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8").split(/\r?\n/).slice(-maxLines).join("\n");
}

function fileMap(root: string, names: string[]) {
  return Object.fromEntries(names.map((name) => {
    const filePath = path.join(root, name);
    return [name, {
      path: filePath,
      exists: existsSync(filePath),
      size: fileSize(filePath),
      updated_at: existsSync(filePath) ? statSync(filePath).mtime.toISOString() : "",
    }];
  }));
}

function fileSize(filePath: string) {
  try {
    return existsSync(filePath) ? statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}

function newestMtime(dir: string) {
  try {
    return readdirSync(dir).reduce((latest, name) => {
      const item = path.join(dir, name);
      const time = statSync(item).mtime.toISOString();
      return time > latest ? time : latest;
    }, "");
  } catch {
    return "";
  }
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
