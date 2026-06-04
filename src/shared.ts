import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parse } from "csv-parse/sync";

export const DEFAULT_SOURCE_CSV = "examples/input.sample.csv";
export const DEFAULT_INVESTOR_COMPANIES_SOURCE_CSV = "examples/input.sample.csv";

export type RawInvestmentRow = Record<string, string>;

export type PortfolioExample = {
  investment_date: string;
  investment_stage: string;
  estimated_check_size: string;
  investor_role: string;
  company_name: string;
  company_domain: string;
  description: string;
  industry_tags: string;
  sectors: string;
  country: string;
};

export type InvestorCandidate = {
  source_record_id: string;
  investor_uuid: string;
  investor_name: string;
  investor_domain: string;
  investor_normalized_domain: string;
  investor_permalink: string;
  investor_industry: string;
  investor_total_investments: string;
  investor_total_exits: string;
  investor_crunchbase_rank: string;
  row_count: number;
  prefilter_score: number;
  prefilter_confidence: "high" | "medium" | "low";
  prefilter_reasons: string[];
  prefilter_warning: string;
  portfolio_examples: PortfolioExample[];
  source_profile?: {
    primary_data_source: string;
    investor_type: string;
    description: string;
    classification_notes: string;
    website_url: string;
    crunchbase_url: string;
    linkedin_url: string;
    location: string;
    employee_count_range: string;
    founded_year: string;
    sectors: string;
    categories: string;
    keywords?: string;
    total_investment_usd?: string;
    company_emails?: string;
    contact_counts: {
      final: number;
      rank_1: number;
      rank_2: number;
      corporate_priority: number;
    };
  };
};

export function parseArgs(values: string[]) {
  const parsed: Record<string, string> = {};
  for (const value of values) {
    if (!value.startsWith("--")) continue;
    const withoutPrefix = value.slice(2);
    const equals = withoutPrefix.indexOf("=");
    if (equals === -1) {
      parsed[withoutPrefix] = "true";
    } else {
      parsed[withoutPrefix.slice(0, equals)] = withoutPrefix.slice(equals + 1);
    }
  }
  return parsed;
}

export function readCsv(filePath: string): RawInvestmentRow[] {
  const content = readFileSync(filePath, "utf8");
  return parse(content, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as RawInvestmentRow[];
}

export function loadLocalEnv(rootDir: string) {
  const candidates = [
    path.join(rootDir, ".env.local"),
  ];
  const allowed = new Set(["OPENAI_API_KEY", "OPENROUTER_API_KEY"]);
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [rawKey, ...rest] = trimmed.split("=");
      const key = rawKey.trim();
      if (!allowed.has(key) || process.env[key]) continue;
      process.env[key] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

export function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

export function writeJson(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(sanitizeJsonValue(value), null, 2)}\n`);
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeJsonString(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      sanitizeJsonString(key),
      sanitizeJsonValue(item),
    ]),
  );
}

function sanitizeJsonString(value: string) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      } else {
        output += "\uFFFD";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      output += "\uFFFD";
    } else {
      output += value[index];
    }
  }
  return output;
}

export function writeCsv(filePath: string, rows: Record<string, unknown>[]) {
  ensureDir(path.dirname(filePath));
  if (!rows.length) {
    writeFileSync(filePath, "");
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }
  writeFileSync(filePath, `${lines.join("\n")}\n`);
}

export function csvEscape(value: unknown) {
  if (value === null || value === undefined) return "";
  const textValue = Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
}

export function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

export function numberValue(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeDomain(value: unknown) {
  let domain = text(value).toLowerCase();
  domain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return domain.split("/")[0].trim();
}

export function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "item";
}

export function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  const content = typeof value === "string" ? value : Array.isArray(value) ? value.join("") : JSON.stringify(value);
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const match = extractBalancedJsonObject(content);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function extractBalancedJsonObject(content: string) {
  const start = content.indexOf("{");
  if (start === -1) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return "";
}

export function compact(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}
