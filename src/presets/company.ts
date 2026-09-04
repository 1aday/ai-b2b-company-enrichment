import type { EnrichmentPreset, ValidationResult } from "./types.js";

const confidence = { type: "number", minimum: 0, maximum: 1 } as const;
const shortString = { type: "string", maxLength: 500 } as const;
const stringArray = (maxItems: number, maxLength = 160) => ({
  type: "array",
  maxItems,
  items: { type: "string", maxLength },
});

export const COMPANY_ENRICHMENT_SCHEMA = {
  type: "json_schema" as const,
  name: "b2b_company_enrichment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "source_record_id",
      "identity",
      "firmographics",
      "offering",
      "commercial_signals",
      "qualification",
      "outreach",
      "source_evidence",
      "quality",
    ],
    properties: {
      source_record_id: { type: "string" },
      identity: {
        type: "object",
        additionalProperties: false,
        required: ["canonical_name", "legal_name", "domain", "website_url", "logo_url", "one_line_description"],
        properties: {
          canonical_name: { type: "string", maxLength: 180 },
          legal_name: { type: "string", maxLength: 220 },
          domain: { type: "string", maxLength: 240 },
          website_url: { type: "string", maxLength: 500 },
          logo_url: { type: "string", maxLength: 500 },
          one_line_description: { type: "string", maxLength: 280 },
        },
      },
      firmographics: {
        type: "object",
        additionalProperties: false,
        required: [
          "primary_industry",
          "secondary_industries",
          "business_model",
          "company_type",
          "employee_range",
          "revenue_range",
          "founded_year",
          "headquarters",
          "operating_geographies",
        ],
        properties: {
          primary_industry: { type: "string", maxLength: 120 },
          secondary_industries: stringArray(8, 120),
          business_model: { type: "string", enum: ["b2b", "b2c", "b2b2c", "marketplace", "nonprofit", "government", "unknown"] },
          company_type: { type: "string", enum: ["software", "services", "commerce", "manufacturer", "financial_institution", "investor", "media", "nonprofit", "government", "other", "unknown"] },
          employee_range: { type: "string", maxLength: 80 },
          revenue_range: { type: "string", maxLength: 100 },
          founded_year: { type: ["integer", "null"], minimum: 1600, maximum: 2200 },
          headquarters: {
            type: "object",
            additionalProperties: false,
            required: ["city", "region", "country", "full_address"],
            properties: {
              city: { type: "string", maxLength: 100 },
              region: { type: "string", maxLength: 100 },
              country: { type: "string", maxLength: 100 },
              full_address: { type: "string", maxLength: 320 },
            },
          },
          operating_geographies: stringArray(10, 100),
        },
      },
      offering: {
        type: "object",
        additionalProperties: false,
        required: ["products_and_services", "target_customers", "value_proposition", "differentiators"],
        properties: {
          products_and_services: stringArray(12, 180),
          target_customers: stringArray(10, 180),
          value_proposition: { type: "string", maxLength: 700 },
          differentiators: stringArray(8, 220),
        },
      },
      commercial_signals: {
        type: "object",
        additionalProperties: false,
        required: ["growth_signals", "hiring_signals", "technology_signals", "recent_events"],
        properties: {
          growth_signals: stringArray(8, 240),
          hiring_signals: stringArray(8, 240),
          technology_signals: stringArray(12, 160),
          recent_events: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["event", "date", "source_url"],
              properties: {
                event: { type: "string", maxLength: 280 },
                date: { type: "string", maxLength: 40 },
                source_url: { type: "string", maxLength: 500 },
              },
            },
          },
        },
      },
      qualification: {
        type: "object",
        additionalProperties: false,
        required: ["status", "icp_score", "matched_criteria", "gaps", "disqualifiers", "rationale"],
        properties: {
          status: { type: "string", enum: ["not_scored", "strong_fit", "possible_fit", "weak_fit", "disqualified", "manual_review"] },
          icp_score: { type: ["number", "null"], minimum: 0, maximum: 100 },
          matched_criteria: stringArray(12, 220),
          gaps: stringArray(12, 220),
          disqualifiers: stringArray(8, 220),
          rationale: { type: "string", maxLength: 700 },
        },
      },
      outreach: {
        type: "object",
        additionalProperties: false,
        required: ["account_summary", "likely_priorities", "personalization_angles", "risk_notes"],
        properties: {
          account_summary: { type: "string", maxLength: 700 },
          likely_priorities: stringArray(8, 220),
          personalization_angles: stringArray(6, 260),
          risk_notes: stringArray(8, 220),
        },
      },
      source_evidence: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "claim", "source_url", "source_type", "confidence_score"],
          properties: {
            field: { type: "string", maxLength: 120 },
            claim: { type: "string", minLength: 8, maxLength: 360 },
            source_url: { type: "string", minLength: 8, maxLength: 500 },
            source_type: { type: "string", enum: ["official_website", "credible_news", "regulatory_profile", "source_record", "other"] },
            confidence_score: confidence,
          },
        },
      },
      quality: {
        type: "object",
        additionalProperties: false,
        required: ["confidence_score", "evidence_coverage_score", "missing_fields", "review_flags"],
        properties: {
          confidence_score: confidence,
          evidence_coverage_score: confidence,
          missing_fields: stringArray(20, 120),
          review_flags: stringArray(12, 220),
        },
      },
    },
  },
};

export const COMPANY_SYSTEM_PROMPT = `You enrich B2B company accounts from supplied evidence packets.

Return only JSON matching the supplied schema. Use first-party website evidence as the primary source. Treat source CSV values as identity hints, not truth. Never invent employee counts, revenue, technologies, events, locations, products, or commercial signals. Use empty strings, empty arrays, nulls, and review flags when evidence is insufficient.

This is company-level enrichment only. Do not identify, infer, or output individual people or personal contact information.

If no ideal customer profile is supplied, qualification.status must be not_scored, qualification.icp_score must be null, and the rationale must say that no ICP was supplied. If an ICP is supplied, score only against its explicit criteria and cite evidence for every material match or disqualifier. Personalization angles must be conservative hypotheses grounded in the evidence, not fabricated pain points.`;

export const companyPreset: EnrichmentPreset = {
  id: "company",
  displayName: "B2B company enrichment",
  description: "Evidence-backed company profiles, commercial signals, and optional ICP qualification.",
  schema: COMPANY_ENRICHMENT_SCHEMA,
  systemPrompt: COMPANY_SYSTEM_PROMPT,
  keywordGate: {
    enabledByDefault: false,
    mode: "company_content_gate",
    terms: ["company", "about", "products", "services", "customers", "solutions", "platform", "software", "technology", "industry"],
  },
  benchmarkFields: [
    { path: "identity.canonical_name", weight: 5 },
    { path: "identity.one_line_description", weight: 4 },
    { path: "firmographics.primary_industry", weight: 5 },
    { path: "firmographics.business_model", weight: 4 },
    { path: "offering.products_and_services", weight: 5 },
    { path: "offering.target_customers", weight: 5 },
    { path: "commercial_signals.growth_signals", weight: 3 },
    { path: "qualification.status", weight: 4 },
    { path: "source_evidence", weight: 6 },
    { path: "quality.confidence_score", weight: 3 },
  ],
  validate: validateCompanyOutput,
  flatten: flattenCompanyOutput,
};

export function validateCompanyOutput(value: unknown): ValidationResult {
  const errors: string[] = [];
  const root = objectValue(value);
  if (!root) return { ok: false, errors: ["output must be an object"] };
  requiredString(root, "source_record_id", errors);
  for (const key of ["identity", "firmographics", "offering", "commercial_signals", "qualification", "outreach", "quality"]) {
    if (!objectValue(root[key])) errors.push(`${key} must be an object`);
  }
  const evidence = root.source_evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) errors.push("source_evidence must contain at least one item");
  const identity = objectValue(root.identity);
  if (identity) {
    for (const key of ["canonical_name", "domain", "website_url", "one_line_description"]) requiredString(identity, key, errors, `identity.${key}`);
  }
  const qualification = objectValue(root.qualification);
  if (qualification) {
    const status = qualification.status;
    const validStatuses = ["not_scored", "strong_fit", "possible_fit", "weak_fit", "disqualified", "manual_review"];
    if (!validStatuses.includes(String(status))) errors.push("qualification.status is invalid");
    if (status === "not_scored" && qualification.icp_score !== null) errors.push("qualification.icp_score must be null when status is not_scored");
    if (status !== "not_scored" && typeof qualification.icp_score !== "number") errors.push("qualification.icp_score must be a number when ICP scoring is active");
  }
  return { ok: errors.length === 0, errors };
}

export function flattenCompanyOutput(value: Record<string, unknown>) {
  const identity = objectValue(value.identity) ?? {};
  const firmographics = objectValue(value.firmographics) ?? {};
  const headquarters = objectValue(firmographics.headquarters) ?? {};
  const offering = objectValue(value.offering) ?? {};
  const signals = objectValue(value.commercial_signals) ?? {};
  const qualification = objectValue(value.qualification) ?? {};
  const outreach = objectValue(value.outreach) ?? {};
  const quality = objectValue(value.quality) ?? {};
  return {
    source_record_id: value.source_record_id ?? "",
    canonical_name: identity.canonical_name ?? "",
    domain: identity.domain ?? "",
    website_url: identity.website_url ?? "",
    one_line_description: identity.one_line_description ?? "",
    primary_industry: firmographics.primary_industry ?? "",
    business_model: firmographics.business_model ?? "",
    company_type: firmographics.company_type ?? "",
    employee_range: firmographics.employee_range ?? "",
    revenue_range: firmographics.revenue_range ?? "",
    founded_year: firmographics.founded_year ?? "",
    headquarters: [headquarters.city, headquarters.region, headquarters.country].filter(Boolean).join(", "),
    operating_geographies: joinArray(firmographics.operating_geographies),
    products_and_services: joinArray(offering.products_and_services),
    target_customers: joinArray(offering.target_customers),
    value_proposition: offering.value_proposition ?? "",
    growth_signals: joinArray(signals.growth_signals),
    technology_signals: joinArray(signals.technology_signals),
    qualification_status: qualification.status ?? "",
    icp_score: qualification.icp_score ?? "",
    qualification_rationale: qualification.rationale ?? "",
    account_summary: outreach.account_summary ?? "",
    personalization_angles: joinArray(outreach.personalization_angles),
    confidence_score: quality.confidence_score ?? "",
    evidence_coverage_score: quality.evidence_coverage_score ?? "",
    source_evidence: JSON.stringify(value.source_evidence ?? []),
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredString(value: Record<string, unknown>, key: string, errors: string[], label = key) {
  if (typeof value[key] !== "string" || !String(value[key]).trim()) errors.push(`${label} must be a non-empty string`);
}

function joinArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).join(" | ") : "";
}
