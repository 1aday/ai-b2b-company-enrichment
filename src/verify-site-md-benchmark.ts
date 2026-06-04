import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { numberValue, parseArgs, writeJson } from "./shared.js";

const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
const runId = args["run-id"] ?? "site-md-model-benchmark-20-20260603-122424";
const runDir = path.resolve(args["run-dir"] ?? path.join(rootDir, "runs", runId));
const minQuality = Math.max(0, Math.min(1, numberValue(args["min-quality"], 0.78)));
const outPath = args.out ? path.resolve(args.out) : "";
const metricsOnly = args["metrics-only"] === "true";

const config = readJson(path.join(runDir, "config.json"));
const caseScores = readJsonArray(path.join(runDir, "case_scores.json"));
const storedLeaderboard = readJsonArray(path.join(runDir, "leaderboard.json"));
const goldDir = path.join(runDir, "gold");
const goldFiles = existsSync(goldDir)
  ? readdirSync(goldDir).filter((name) => name.endsWith(".json") && name !== "gold_index.json")
  : [];

const expectedCases = Number(config.cases?.length ?? config.cases ?? 0);
const expectedModels = Number(config.candidate_models?.length ?? config.candidate_models_count ?? 0);
const expectedCandidateScores = expectedCases * expectedModels;
const scoredCases = caseScores.length;
const completedFraction = expectedCandidateScores ? scoredCases / expectedCandidateScores : 0;
const parseRate = average(caseScores.map((item) => item.parse_ok === true ? 1 : 0));
const leaderboard = aggregateLeaderboard(caseScores, storedLeaderboard);
const bestQuality = maxNumber(leaderboard.map((item) => item.avg_quality_score));
const eligible = leaderboard.filter((item) =>
  item.eligible_for_cheapest_pick === true &&
  Number(item.avg_quality_score ?? 0) >= minQuality &&
  Number(item.parse_rate ?? 0) >= 0.9
);
const cheapestEligible = eligible.sort((a, b) =>
  Number(a.avg_cost_per_case_usd ?? Infinity) - Number(b.avg_cost_per_case_usd ?? Infinity)
)[0] ?? null;
const highestQuality = [...leaderboard].sort((a, b) =>
  Number(b.avg_quality_score ?? 0) - Number(a.avg_quality_score ?? 0)
)[0] ?? null;

const fullBenchmarkComplete = expectedCandidateScores > 0 && scoredCases >= expectedCandidateScores;
const primaryScore = fullBenchmarkComplete && cheapestEligible
  ? Math.max(0, 10_000 - Number(cheapestEligible.avg_cost_per_case_usd ?? 10_000) * 1_000_000) + Number(cheapestEligible.avg_quality_score ?? 0) * 100
  : 0;

const result = {
  run_id: runId,
  run_dir: runDir,
  gold_cases: goldFiles.length,
  expected_cases: expectedCases,
  expected_models: expectedModels,
  expected_candidate_scores: expectedCandidateScores,
  candidate_case_scores: scoredCases,
  completed_fraction: round4(completedFraction),
  full_benchmark_complete: fullBenchmarkComplete,
  parse_rate: round4(parseRate),
  best_quality_score: round4(bestQuality),
  min_quality: minQuality,
  eligible_models: eligible.length,
  cheapest_eligible_model: cheapestEligible,
  highest_quality_model: highestQuality,
  primary_score: round4(primaryScore),
};

if (outPath) writeJson(outPath, result);
console.log(JSON.stringify(metricsOnly ? {
  primary_score: result.primary_score,
  gold_cases: result.gold_cases,
  expected_cases: result.expected_cases,
  expected_models: result.expected_models,
  expected_candidate_scores: result.expected_candidate_scores,
  candidate_case_scores: result.candidate_case_scores,
  completed_fraction: result.completed_fraction,
  full_benchmark_complete: result.full_benchmark_complete ? 1 : 0,
  parse_rate: result.parse_rate,
  best_quality_score: result.best_quality_score,
  eligible_models: result.eligible_models,
} : result));

function readJson(filePath: string): Record<string, any> {
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, any>;
}

function readJsonArray(filePath: string): Array<Record<string, any>> {
  if (!existsSync(filePath)) return [];
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  return Array.isArray(parsed) ? parsed as Array<Record<string, any>> : [];
}

function aggregateLeaderboard(caseScores: Array<Record<string, any>>, fallback: Array<Record<string, any>>) {
  if (!caseScores.length) return fallback;
  const byModel = new Map<string, Array<Record<string, any>>>();
  for (const score of caseScores) {
    const model = String(score.model ?? "");
    if (!model) continue;
    const rows = byModel.get(model) ?? [];
    rows.push(score);
    byModel.set(model, rows);
  }
  if (!byModel.size) return fallback;
  return [...byModel.entries()].map(([model, rows]) => {
    const totalCost = rows.reduce((sum, item) => sum + Number(item.cost_usd ?? 0), 0);
    const avgQuality = average(rows.map((item) => Number(item.quality_score ?? 0)));
    const parseRate = average(rows.map((item) => item.parse_ok === true ? 1 : 0));
    const avgLatency = average(rows.map((item) => Number(item.latency_ms ?? 0)));
    return {
      model,
      cases: rows.length,
      avg_quality_score: round4(avgQuality),
      parse_rate: round4(parseRate),
      total_cost_usd: round4(totalCost),
      avg_cost_per_case_usd: rows.length ? round4(totalCost / rows.length) : 0,
      avg_latency_ms: Math.round(avgLatency),
      eligible_for_cheapest_pick: rows.length >= expectedCases && avgQuality >= minQuality && parseRate >= 0.9,
    };
  }).sort((a, b) => Number(b.avg_quality_score ?? 0) - Number(a.avg_quality_score ?? 0));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function maxNumber(values: unknown[]) {
  const parsed = values.map(Number).filter(Number.isFinite);
  return parsed.length ? Math.max(...parsed) : 0;
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
