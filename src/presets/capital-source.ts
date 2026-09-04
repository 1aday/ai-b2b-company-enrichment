import { ENRICHMENT_FIELD_FILLING_CONTRACT } from "../field-contract.js";
import { ENRICHMENT_OUTPUT_SCHEMA } from "../schema.js";
import type { EnrichmentPreset } from "./types.js";

export const capitalSourcePreset: EnrichmentPreset = {
  id: "capital-source",
  displayName: "Capital-source qualification",
  description: "The original validated VC allocator and capital-source enrichment contract.",
  schema: ENRICHMENT_OUTPUT_SCHEMA,
  systemPrompt: `Use the capital-source enrichment contract exactly. Classify allocator fit conservatively, preserve unknowns, and support every material claim with supplied evidence. Field contract: ${JSON.stringify(ENRICHMENT_FIELD_FILLING_CONTRACT)}`,
  keywordGate: {
    enabledByDefault: true,
    mode: "allocator_keyword_gate",
    terms: ["allocator", "fund commitment", "family office", "endowment", "pension", "fund of funds", "private markets", "emerging manager"],
  },
  benchmarkFields: [
    { path: "verification.is_capital_source", weight: 6 },
    { path: "type", weight: 5 },
    { path: "capital_profile.invests_in_vc_funds", weight: 6 },
    { path: "capital_profile.fund_commitment_appetite", weight: 6 },
    { path: "source_evidence", weight: 6 },
  ],
  validate(value) {
    const root = objectValue(value);
    const errors: string[] = [];
    if (!root) return { ok: false, errors: ["output must be an object"] };
    if (!objectValue(root.verification)) errors.push("verification must be an object");
    if (!objectValue(root.profile)) errors.push("profile must be an object");
    if (!objectValue(root.capital_profile)) errors.push("capital_profile must be an object");
    if (!Array.isArray(root.source_evidence) || root.source_evidence.length === 0) errors.push("source_evidence must contain at least one item");
    return { ok: errors.length === 0, errors };
  },
  flatten(value) {
    return flattenRecord(value);
  },
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function flattenRecord(value: Record<string, unknown>, prefix = "", output: Record<string, unknown> = {}) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(item)) output[path] = JSON.stringify(item);
    else if (item && typeof item === "object") flattenRecord(item as Record<string, unknown>, path, output);
    else output[path] = item ?? "";
  }
  return output;
}
