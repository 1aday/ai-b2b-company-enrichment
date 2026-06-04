export type JsonSchemaDefinition = {
  type: "json_schema";
  name: string;
  strict: boolean;
  schema: Record<string, unknown>;
};

export const VERIFICATION_OUTPUT_SCHEMA: JsonSchemaDefinition = {
  type: "json_schema",
  name: "capital_source_verification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "source_record_id",
      "canonical_name",
      "domain",
      "is_capital_source",
      "type",
      "confidence_score",
      "rationale",
      "reject_reason",
      "evidence",
      "recommended_next_action",
    ],
    properties: {
      source_record_id: { type: "string" },
      canonical_name: { type: "string" },
      domain: { type: "string" },
      is_capital_source: { type: "boolean" },
      type: {
        type: "string",
        enum: [
          "single_family_office",
          "multi_family_office",
          "private_investment_office",
          "family_investment_vehicle",
          "family_holding_company",
          "fund_of_funds",
          "pension_fund",
          "endowment",
          "foundation",
          "sovereign_wealth_fund",
          "insurance_company",
          "bank",
          "private_bank",
          "asset_manager",
          "wealth_manager",
          "ria",
          "outsourced_cio",
          "fund_manager",
          "corporate_investor",
          "strategic_investor",
          "government_allocator",
          "development_finance_institution",
          "angel_network",
          "hnwi_investor",
          "placement_agent",
          "consultant_gatekeeper",
          "not_lp_target",
          "unknown",
        ],
      },
      confidence_score: { type: "number", minimum: 0, maximum: 1 },
      rationale: { type: "string", maxLength: 800 },
      reject_reason: { type: "string", maxLength: 500 },
      evidence: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claim", "source_url", "source_type", "confidence_score"],
          properties: {
            claim: { type: "string", minLength: 8, maxLength: 320 },
            source_url: { type: "string", minLength: 8, maxLength: 500 },
            source_type: {
              type: "string",
              enum: ["official_website", "capital_source_directory", "investment_database", "credible_news", "linkedin", "regulatory_profile", "source_record", "other"],
            },
            confidence_score: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      recommended_next_action: {
        type: "string",
        enum: ["full_enrichment", "reject", "manual_review"],
      },
    },
  },
};

export const ENRICHMENT_OUTPUT_SCHEMA: JsonSchemaDefinition = {
  type: "json_schema",
  name: "capital_source_enrichment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
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
    ],
    properties: {
      source_record_id: { type: "string" },
      canonical_name: { type: "string" },
      domain: { type: "string" },
      website_url: { type: "string" },
      logo_url: { type: "string", maxLength: 500 },
      type: {
        type: "string",
        enum: [
          "single_family_office",
          "multi_family_office",
          "private_investment_office",
          "family_investment_vehicle",
          "family_holding_company",
          "fund_of_funds",
          "pension_fund",
          "endowment",
          "foundation",
          "sovereign_wealth_fund",
          "insurance_company",
          "bank",
          "private_bank",
          "asset_manager",
          "wealth_manager",
          "ria",
          "outsourced_cio",
          "fund_manager",
          "corporate_investor",
          "strategic_investor",
          "government_allocator",
          "development_finance_institution",
          "angel_network",
          "hnwi_investor",
          "placement_agent",
          "consultant_gatekeeper",
          "not_lp_target",
          "unknown",
        ],
      },
      verification: {
        type: "object",
        additionalProperties: false,
        required: ["is_capital_source", "status", "confidence_score", "rationale"],
        properties: {
          is_capital_source: { type: "boolean" },
          status: { type: "string", enum: ["verified", "rejected", "needs_review"] },
          confidence_score: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string", maxLength: 900 },
        },
      },
      profile: {
        type: "object",
        additionalProperties: false,
        required: [
          "one_line_description",
          "detailed_profile_summary",
          "hq_location",
          "address",
          "postal_code",
          "operating_geographies",
          "capital_source_context",
          "ownership_background",
          "public_principal_name",
        ],
        properties: {
          one_line_description: { type: "string", maxLength: 240 },
          detailed_profile_summary: { type: "string", maxLength: 1400 },
          hq_location: { type: "string", maxLength: 160 },
          address: { type: "string", maxLength: 320 },
          postal_code: { type: "string", maxLength: 40 },
          operating_geographies: { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } },
          capital_source_context: { type: "string", maxLength: 320 },
          ownership_background: { type: "string", maxLength: 600 },
          public_principal_name: { type: "string", maxLength: 160 },
        },
      },
      capital_profile: {
        type: "object",
        additionalProperties: false,
        required: [
          "capital_role_summary",
          "invests_directly",
          "preferred_fund_stage",
          "sector_focus",
          "stage_focus",
          "geography_focus",
          "business_model_preferences",
          "impact_or_values_themes",
          "exclusion_tags",
        ],
        properties: {
          capital_role_summary: { type: "string", maxLength: 700 },
          invests_in_vc_funds: { type: "string", enum: ["yes", "no", "unknown"] },
          invests_directly: { type: "string", enum: ["yes", "no", "unknown"] },
          co_investment_appetite: { type: "string", enum: ["yes", "no", "unknown"] },
          fund_commitment_appetite: { type: "string", enum: ["yes", "no", "unknown"] },
          preferred_fund_stage: { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } },
          emerging_manager_appetite: { type: "string", enum: ["yes", "no", "unknown"] },
          first_time_fund_appetite: { type: "string", enum: ["yes", "no", "unknown"] },
          fund_size_preference: { type: "string", maxLength: 220 },
          commitment_size_min_usd: { type: ["number", "null"], minimum: 0 },
          commitment_size_max_usd: { type: ["number", "null"], minimum: 0 },
          sector_focus: { type: "array", maxItems: 12, items: { type: "string", maxLength: 80 } },
          stage_focus: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
          geography_focus: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
          business_model_preferences: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
          impact_or_values_themes: { type: "array", maxItems: 10, items: { type: "string", maxLength: 100 } },
          exclusion_tags: { type: "array", maxItems: 10, items: { type: "string", maxLength: 100 } },
        },
      },
      portfolio_signals: {
        type: "object",
        additionalProperties: false,
        required: ["known_fund_investments", "known_direct_investments"],
        properties: {
          known_fund_investments: { type: "array", maxItems: 8, items: portfolioSignalSchema() },
          known_direct_investments: { type: "array", maxItems: 10, items: portfolioSignalSchema() },
          co_investors: { type: "array", maxItems: 10, items: { type: "string", maxLength: 120 } },
        },
      },
      contacts: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "title", "linkedin_url", "role_in_decision", "source_url", "confidence_score"],
          properties: {
            name: { type: "string", maxLength: 140 },
            title: { type: "string", maxLength: 180 },
            linkedin_url: { type: "string", maxLength: 500 },
            role_in_decision: { type: "string", enum: ["principal", "investment_team", "family_member", "advisor", "gatekeeper", "unknown"] },
            source_url: { type: "string", maxLength: 500 },
            confidence_score: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      outreach: {
        type: "object",
        additionalProperties: false,
        required: ["fundraise_fit_notes", "fit_risk_notes", "warm_intro_paths", "recent_trigger"],
        properties: {
          fundraise_fit_notes: { type: "string", maxLength: 620 },
          fit_risk_notes: { type: "string", maxLength: 420 },
          warm_intro_paths: { type: "array", maxItems: 6, items: { type: "string", maxLength: 160 } },
          recent_trigger: { type: "string", maxLength: 420 },
        },
      },
      compliance: {
        type: "object",
        additionalProperties: false,
        required: ["do_not_contact", "opt_out_status", "jurisdiction", "list_license_notes", "unsubscribe_required"],
        properties: {
          do_not_contact: { type: "boolean" },
          opt_out_status: { type: "string", enum: ["not_checked", "opted_out", "not_opted_out", "unknown"] },
          jurisdiction: { type: "string", maxLength: 120 },
          list_license_notes: { type: "string", maxLength: 360 },
          unsubscribe_required: { type: "boolean" },
        },
      },
      source_evidence: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field_path", "claim", "source_url", "source_type", "confidence_score"],
          properties: {
            field_path: { type: "string", minLength: 3, maxLength: 180 },
            claim: { type: "string", minLength: 8, maxLength: 360 },
            source_url: { type: "string", minLength: 8, maxLength: 500 },
            source_type: {
              type: "string",
              enum: ["official_website", "capital_source_directory", "investment_database", "credible_news", "portfolio_page", "linkedin", "regulatory_profile", "source_record", "other"],
            },
            confidence_score: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      quality: {
        type: "object",
        additionalProperties: false,
        required: ["data_completeness_score", "unsupported_claim_risk", "needs_review", "review_reasons"],
        properties: {
          data_completeness_score: { type: "integer", minimum: 0, maximum: 100 },
          unsupported_claim_risk: { type: "string", enum: ["low", "medium", "high"] },
          needs_review: { type: "boolean" },
          review_reasons: { type: "array", maxItems: 10, items: { type: "string", maxLength: 220 } },
        },
      },
    },
  },
};

export const LEAN_ENRICHMENT_OUTPUT_SCHEMA: JsonSchemaDefinition = {
  type: "json_schema",
  name: "capital_source_lean_enrichment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "source_record_id",
      "canonical_name",
      "domain",
      "website_url",
      "logo_url",
      "favicon_url",
      "type",
      "verification_status",
      "confidence_score",
      "detailed_profile_summary",
      "hq_location",
      "address",
      "postal_code",
      "aum_usd",
      "aum_notes",
      "geography_focus",
      "sector_focus",
      "stage_focus",
      "capital_source_role",
      "fund_allocation_signal",
      "vc_fund_lp_signal",
      "fund_asset_classes",
      "investment_routes",
      "allocator_capabilities",
      "evidence_strength",
      "invests_directly",
      "preferred_fund_stage",
      "fund_geography_preference",
      "direct_geography_preference",
      "geography_preference_notes",
      "known_fund_investments",
      "known_direct_investments",
      "fundraise_fit_notes",
      "fit_risk_notes",
      "unsubscribe_required",
      "source_freshness_date",
      "source_evidence",
      "evidence_urls",
      "evidence_summary",
      "embedding_text",
      "needs_review",
      "review_reasons",
    ],
    properties: {
      source_record_id: { type: "string" },
      canonical_name: { type: "string", maxLength: 180 },
      domain: { type: "string", maxLength: 180 },
      website_url: { type: "string", maxLength: 500 },
      logo_url: { type: "string", maxLength: 500 },
      favicon_url: { type: "string", maxLength: 500 },
      type: {
        type: "string",
        enum: [
          "single_family_office",
          "multi_family_office",
          "private_investment_office",
          "family_investment_vehicle",
          "family_holding_company",
          "fund_of_funds",
          "pension_fund",
          "endowment",
          "foundation",
          "sovereign_wealth_fund",
          "insurance_company",
          "bank",
          "private_bank",
          "asset_manager",
          "wealth_manager",
          "ria",
          "outsourced_cio",
          "fund_manager",
          "corporate_investor",
          "strategic_investor",
          "government_allocator",
          "development_finance_institution",
          "angel_network",
          "hnwi_investor",
          "placement_agent",
          "consultant_gatekeeper",
          "not_lp_target",
          "unknown",
        ],
      },
      verification_status: { type: "string", enum: ["verified", "needs_review", "rejected"] },
      confidence_score: { type: "number", minimum: 0, maximum: 1 },
      detailed_profile_summary: { type: "string", maxLength: 900 },
      hq_location: { type: "string", maxLength: 160 },
      address: { type: "string", maxLength: 320 },
      postal_code: { type: "string", maxLength: 40 },
      aum_usd: { type: ["number", "null"], minimum: 0 },
      aum_notes: { type: "string", maxLength: 260 },
      geography_focus: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
      sector_focus: { type: "array", maxItems: 12, items: { type: "string", maxLength: 80 } },
      stage_focus: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
      capital_source_role: {
        type: "string",
        enum: [
          "principal_capital",
          "client_advisory_allocator",
          "hybrid_principal_and_client",
          "operating_company_investor",
          "wealth_manager_no_clear_allocatable_capital",
          "unknown",
        ],
      },
      fund_allocation_signal: {
        type: "string",
        enum: [
          "explicit_vc_fund_lp",
          "explicit_private_market_fund_lp",
          "external_manager_allocator",
          "manager_selection_advisor",
          "fund_of_funds_platform",
          "generic_fund_language",
          "no_signal",
          "unknown",
        ],
      },
      vc_fund_lp_signal: {
        type: "string",
        enum: [
          "explicit_yes",
          "likely_private_markets_only",
          "manager_selection_only",
          "explicit_no",
          "no_signal",
          "unknown",
        ],
      },
      fund_asset_classes: { type: "array", maxItems: 12, items: { type: "string", maxLength: 80 } },
      investment_routes: { type: "array", maxItems: 12, items: { type: "string", maxLength: 80 } },
      allocator_capabilities: { type: "array", maxItems: 12, items: { type: "string", maxLength: 80 } },
      evidence_strength: {
        type: "string",
        enum: [
          "official_explicit",
          "regulatory_explicit",
          "third_party_explicit",
          "official_implicit",
          "source_record_only",
          "weak_context",
          "unknown",
        ],
      },
      invests_in_vc_funds: { type: "string", enum: ["yes", "no", "unknown"] },
      invests_directly: { type: "string", enum: ["yes", "no", "unknown"] },
      co_investment_appetite: { type: "string", enum: ["yes", "no", "unknown"] },
      fund_commitment_appetite: { type: "string", enum: ["yes", "no", "unknown"] },
      preferred_fund_stage: { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } },
      emerging_manager_appetite: { type: "string", enum: ["yes", "no", "unknown"] },
      first_time_fund_appetite: { type: "string", enum: ["yes", "no", "unknown"] },
      fund_size_preference: { type: "string", maxLength: 220 },
      commitment_size_min_usd: { type: ["number", "null"], minimum: 0 },
      commitment_size_max_usd: { type: ["number", "null"], minimum: 0 },
      fund_cheque_size_min_usd: { type: ["number", "null"], minimum: 0 },
      fund_cheque_size_max_usd: { type: ["number", "null"], minimum: 0 },
      direct_cheque_size_min_usd: { type: ["number", "null"], minimum: 0 },
      direct_cheque_size_max_usd: { type: ["number", "null"], minimum: 0 },
      cheque_size_basis: { type: "string", enum: ["stated_preference", "observed_historical", "mixed", "unknown"] },
      cheque_size_notes: { type: "string", maxLength: 260 },
      fund_geography_preference: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
      direct_geography_preference: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
      geography_preference_notes: { type: "string", maxLength: 260 },
      known_fund_investments: { type: "array", maxItems: 8, items: { type: "string", maxLength: 180 } },
      known_direct_investments: { type: "array", maxItems: 10, items: { type: "string", maxLength: 180 } },
      co_investors: { type: "array", maxItems: 10, items: { type: "string", maxLength: 120 } },
      best_contact: {
        type: "object",
        additionalProperties: false,
        required: ["name", "title", "linkedin_url", "role_in_decision", "source_url", "confidence_score"],
        properties: {
          name: { type: "string", maxLength: 140 },
          title: { type: "string", maxLength: 180 },
          linkedin_url: { type: "string", maxLength: 500 },
          role_in_decision: { type: "string", enum: ["principal", "investment_team", "family_member", "advisor", "gatekeeper", "unknown"] },
          source_url: { type: "string", maxLength: 500 },
          confidence_score: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      fundraise_fit_notes: { type: "string", maxLength: 620 },
      fit_risk_notes: { type: "string", maxLength: 420 },
      unsubscribe_required: { type: "boolean" },
      source_freshness_date: { type: "string", maxLength: 40 },
      source_evidence: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field_path", "claim", "source_url", "source_type", "confidence_score"],
          properties: {
            field_path: { type: "string", minLength: 3, maxLength: 180 },
            claim: { type: "string", minLength: 8, maxLength: 300 },
            source_url: { type: "string", minLength: 8, maxLength: 500 },
            source_type: {
              type: "string",
              enum: ["official_website", "capital_source_directory", "investment_database", "credible_news", "portfolio_page", "linkedin", "regulatory_profile", "source_record", "other"],
            },
            confidence_score: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      evidence_urls: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 8, maxLength: 500 } },
      evidence_summary: { type: "string", maxLength: 800 },
      embedding_text: { type: "string", maxLength: 2200 },
      needs_review: { type: "boolean" },
      review_reasons: { type: "array", maxItems: 8, items: { type: "string", maxLength: 220 } },
    },
  },
};

export type ValidationIssue = {
  severity: "low" | "medium" | "high";
  path: string;
  detail: string;
};

const MATERIAL_FIELD_PREFIXES = [
  "verification",
  "profile.capital_source_context",
  "profile.ownership_background",
  "profile.public_principal_name",
  "capital_profile",
  "portfolio_signals",
  "contacts",
  "outreach.fundraise_fit_notes",
  "outreach.fit_risk_notes",
  "outreach.recent_trigger",
];

const LEAN_MATERIAL_FIELD_PREFIXES = [
  "logo_url",
  "favicon_url",
  "type",
  "detailed_profile_summary",
  "address",
  "postal_code",
  "aum_notes",
  "geography_focus",
  "sector_focus",
  "stage_focus",
  "capital_source_role",
  "fund_allocation_signal",
  "vc_fund_lp_signal",
  "fund_asset_classes",
  "investment_routes",
  "allocator_capabilities",
  "evidence_strength",
  "preferred_fund_stage",
  "fund_geography_preference",
  "direct_geography_preference",
  "geography_preference_notes",
  "known_fund_investments",
  "known_direct_investments",
  "fundraise_fit_notes",
  "fit_risk_notes",
];

export function validateVerification(record: Record<string, unknown>) {
  const issues: ValidationIssue[] = [];
  const evidence = Array.isArray(record.evidence) ? record.evidence as Record<string, unknown>[] : [];
  if (!evidence.length) {
    issues.push({ severity: "high", path: "evidence", detail: "Verification has no evidence." });
  }
  for (const item of evidence) validateEvidenceUrl(item, "evidence", issues);
  if (record.is_capital_source === true && Number(record.confidence_score ?? 0) < 0.55) {
    issues.push({ severity: "medium", path: "confidence_score", detail: "Record is marked capital source with low confidence." });
  }
  if (record.is_capital_source === true && record.type === "unknown") {
    issues.push({ severity: "medium", path: "type", detail: "Verified capital source needs a more specific institution/entity type or manual review." });
  }
  return issues;
}

export function validateEnrichment(record: Record<string, unknown>) {
  const issues: ValidationIssue[] = [];
  const evidence = Array.isArray(record.source_evidence) ? record.source_evidence as Record<string, unknown>[] : [];
  const evidencePaths = evidence.map((item) => String(item.field_path ?? ""));
  const entityDomain = String(record.domain ?? "").replace(/^www\./, "").toLowerCase();
  if (!evidence.length) {
    issues.push({ severity: "high", path: "source_evidence", detail: "No source evidence captured." });
  }
  for (const item of evidence) {
    validateEvidenceUrl(item, "source_evidence", issues);
    const sourceUrl = String(item.source_url ?? "");
    if (item.source_type === "official_website" && entityDomain && !sameDomain(sourceUrl, entityDomain)) {
      issues.push({ severity: "medium", path: "source_evidence.source_type", detail: "official_website source_type is used for a non-entity domain." });
    }
    if (/\[[^\]]+\]\(|utm_source=openai/i.test(String(item.claim ?? "") + " " + sourceUrl)) {
      issues.push({ severity: "medium", path: "source_evidence.claim", detail: "Evidence contains markdown citation text or OpenAI tracking URL noise." });
    }
  }
  if (nested(record, ["verification", "is_capital_source"]) !== true) {
    issues.push({ severity: "high", path: "verification.is_capital_source", detail: "Full enrichment should only run for verified capital sources." });
  }
  for (const prefix of MATERIAL_FIELD_PREFIXES) {
    if (!materialValue(nested(record, prefix.split(".")))) continue;
    if (!evidencePaths.some((fieldPath) => pathMatches(prefix, fieldPath))) {
      issues.push({ severity: "medium", path: prefix, detail: "Material populated field has no matching source_evidence field_path." });
    }
  }
  const min = nested(record, ["capital_profile", "commitment_size_min_usd"]);
  const max = nested(record, ["capital_profile", "commitment_size_max_usd"]);
  if ((typeof min === "number" || typeof max === "number") && !evidencePaths.some((fieldPath) => fieldPath.includes("commitment_size"))) {
    issues.push({ severity: "high", path: "capital_profile.commitment_size", detail: "Commitment size must not be guessed; it needs explicit evidence." });
  }
  return issues;
}

export function validateLeanEnrichment(record: Record<string, unknown>) {
  const issues: ValidationIssue[] = [];
  const evidence = Array.isArray(record.source_evidence) ? record.source_evidence as Record<string, unknown>[] : [];
  const evidencePaths = evidence.map((item) => String(item.field_path ?? ""));
  const evidenceUrls = Array.isArray(record.evidence_urls) ? record.evidence_urls.map(String) : [];
  const entityDomain = String(record.domain ?? "").replace(/^www\./, "").toLowerCase();

  if (!evidence.length) {
    issues.push({ severity: "high", path: "source_evidence", detail: "No source evidence captured." });
  }
  if (!evidenceUrls.length) {
    issues.push({ severity: "high", path: "evidence_urls", detail: "No evidence URLs captured." });
  }
  for (const item of evidence) {
    validateEvidenceUrl(item, "source_evidence", issues);
    const sourceUrl = String(item.source_url ?? "");
    if (item.source_type === "official_website" && entityDomain && !sameDomain(sourceUrl, entityDomain)) {
      issues.push({ severity: "medium", path: "source_evidence.source_type", detail: "official_website source_type is used for a non-entity domain." });
    }
    if (leanPortfolioFieldPath(String(item.field_path ?? "")) && genericPortfolioEvidenceClaim(String(item.claim ?? ""))) {
      issues.push({ severity: "medium", path: "source_evidence.claim", detail: "Portfolio fields need explicit named evidence; generic source-backed evidence is not enough." });
    }
    if (leanSignalFieldPath(String(item.field_path ?? "")) && genericPortfolioEvidenceClaim(String(item.claim ?? ""))) {
      issues.push({ severity: "medium", path: "source_evidence.claim", detail: "Investment appetite fields need explicit signal evidence; generic source-backed evidence is not enough." });
    }
  }
  for (const sourceUrl of evidenceUrls) {
    if (sourceUrl !== "source_record" && !/^https?:\/\//.test(sourceUrl)) {
      issues.push({ severity: "high", path: "evidence_urls", detail: `Invalid evidence URL: ${sourceUrl.slice(0, 80)}` });
    }
  }
  if (record.verification_status === "verified" && record.type === "unknown") {
    issues.push({ severity: "medium", path: "type", detail: "Verified capital source needs a specific LP/institution type or manual review." });
  }
  if (record.verification_status === "verified" && Number(record.confidence_score ?? 0) < 0.55) {
    issues.push({ severity: "medium", path: "confidence_score", detail: "Record is marked verified with low confidence." });
  }
  for (const prefix of LEAN_MATERIAL_FIELD_PREFIXES) {
    if (!materialValue(nested(record, prefix.split(".")))) continue;
    if (!evidencePaths.some((fieldPath) => pathMatches(prefix, fieldPath))) {
      issues.push({ severity: "medium", path: prefix, detail: "Material populated field has no matching source_evidence field_path." });
    }
  }
  const min = nested(record, ["commitment_size_min_usd"]);
  const max = nested(record, ["commitment_size_max_usd"]);
  if ((typeof min === "number" || typeof max === "number") && !evidencePaths.some((fieldPath) => fieldPath.includes("commitment_size") || fieldPath.includes("fund_cheque_size"))) {
    issues.push({ severity: "high", path: "commitment_size", detail: "Commitment size must not be guessed; it needs explicit evidence." });
  }
  if (typeof nested(record, ["aum_usd"]) === "number" && !evidencePaths.some((fieldPath) => fieldPath.includes("aum"))) {
    issues.push({ severity: "high", path: "aum_usd", detail: "AUM must not be guessed; it needs explicit evidence." });
  }
  const logoUrl = String(record.logo_url ?? "").trim();
  if (materialValue(logoUrl) && !/^https?:\/\//.test(logoUrl)) {
    issues.push({ severity: "medium", path: "logo_url", detail: "Logo URL must be a valid HTTP(S) URL or unknown." });
  }
  const faviconUrl = String(record.favicon_url ?? "").trim();
  if (materialValue(faviconUrl) && !/^https?:\/\//.test(faviconUrl)) {
    issues.push({ severity: "medium", path: "favicon_url", detail: "Favicon URL must be a valid HTTP(S) URL or unknown." });
  }
  const fundChequeMin = nested(record, ["fund_cheque_size_min_usd"]);
  const fundChequeMax = nested(record, ["fund_cheque_size_max_usd"]);
  if ((typeof fundChequeMin === "number" || typeof fundChequeMax === "number") && !evidencePaths.some((fieldPath) => fieldPath.includes("fund_cheque_size") || fieldPath.includes("commitment_size") || fieldPath.includes("cheque_size"))) {
    issues.push({ severity: "high", path: "fund_cheque_size", detail: "Fund cheque size must not be guessed; it needs explicit evidence." });
  }
  const directChequeMin = nested(record, ["direct_cheque_size_min_usd"]);
  const directChequeMax = nested(record, ["direct_cheque_size_max_usd"]);
  if ((typeof directChequeMin === "number" || typeof directChequeMax === "number") && !evidencePaths.some((fieldPath) => fieldPath.includes("direct_cheque_size") || fieldPath.includes("cheque_size"))) {
    issues.push({ severity: "high", path: "direct_cheque_size", detail: "Direct cheque size must not be guessed; it needs explicit evidence." });
  }
  const hasNumericFundCheque = typeof fundChequeMin === "number" || typeof fundChequeMax === "number";
  const hasNumericDirectCheque = typeof directChequeMin === "number" || typeof directChequeMax === "number";
  if ((hasNumericFundCheque || hasNumericDirectCheque) && record.cheque_size_basis === "observed_historical") {
    issues.push({ severity: "high", path: "cheque_size_basis", detail: "Observed historical aggregate investment dollars must not be converted into fund/direct cheque-size preference fields." });
  }
  if (record.invests_in_vc_funds === "yes" && record.fund_commitment_appetite === "no") {
    issues.push({ severity: "high", path: "fund_commitment_appetite", detail: "VC-fund appetite cannot be yes while fund-commitment appetite is no without explicit contradictory evidence." });
  }
  if (record.vc_fund_lp_signal === "explicit_yes" && record.invests_in_vc_funds !== "yes") {
    issues.push({ severity: "medium", path: "vc_fund_lp_signal", detail: "Explicit VC-fund LP signal should align with invests_in_vc_funds=yes for backward compatibility." });
  }
  if (record.invests_in_vc_funds === "yes" && record.vc_fund_lp_signal !== "explicit_yes") {
    issues.push({ severity: "medium", path: "invests_in_vc_funds", detail: "invests_in_vc_funds=yes now requires vc_fund_lp_signal=explicit_yes; use private-market allocation signals for weaker fund evidence." });
  }
  const textBlob = [
    record.detailed_profile_summary,
    record.evidence_summary,
    record.fundraise_fit_notes,
    record.fit_risk_notes,
    record.embedding_text,
  ].map((value) => String(value ?? "")).join(" ");
  const optionalCapitalFields = ["invests_in_vc_funds", "fund_commitment_appetite"];
  for (const field of optionalCapitalFields) {
    const value = String(nested(record, [field]) ?? "");
    if (!value || value === "unknown") continue;
    const fieldEvidence = evidence.filter((item) => pathMatches(field, String(item.field_path ?? "")));
    if (fieldEvidence.length && fieldEvidence.every((item) => item.source_type === "source_record")) {
      issues.push({ severity: "low", path: field, detail: "Optional fund-appetite value is backed only by source_record evidence; upgrade when cheap." });
    }
    if (value === "no" && fieldEvidence.some((item) => genericAdvisoryNoFundEvidenceText(String(item.claim ?? "")))) {
      issues.push({ severity: "medium", path: field, detail: "Generic advisory, wealth-management, or client-service wording is not enough evidence to mark VC fund/LP appetite as no." });
    }
  }
  const supportingCapitalFields = ["invests_directly", "co_investment_appetite"];
  for (const field of supportingCapitalFields) {
    const value = String(nested(record, [field]) ?? "");
    if (value === "unknown") continue;
    const fieldEvidence = evidence.filter((item) => pathMatches(field, String(item.field_path ?? "")));
    if (fieldEvidence.length && fieldEvidence.every((item) => item.source_type === "source_record")) {
      issues.push({ severity: "low", path: field, detail: "Direct/co-invest values are supporting signals for VC fundraise matching; source_record-only evidence is acceptable for screening but should be upgraded when cheap." });
    }
  }
  validateFlatPortfolioValues(record, issues);
  const embeddingText = String(record.embedding_text ?? "").trim();
  if (embeddingText.length < 700) {
    issues.push({ severity: "medium", path: "embedding_text", detail: "Embedding text is too thin for useful vector retrieval." });
  }
  return issues;
}

export function issueSummary(issues: ValidationIssue[]) {
  return {
    high: issues.filter((issue) => issue.severity === "high").length,
    medium: issues.filter((issue) => issue.severity === "medium").length,
    low: issues.filter((issue) => issue.severity === "low").length,
  };
}

function portfolioSignalSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["name", "relationship", "evidence_summary"],
    properties: {
      name: { type: "string", maxLength: 160 },
      relationship: { type: "string", maxLength: 180 },
      evidence_summary: { type: "string", maxLength: 360 },
    },
  };
}

function validateEvidenceUrl(item: Record<string, unknown>, path: string, issues: ValidationIssue[]) {
  const sourceUrl = String(item.source_url ?? "");
  if (item.source_type === "source_record") return;
  if (!/^https?:\/\//.test(sourceUrl)) {
    issues.push({ severity: "high", path, detail: `Invalid source URL for claim: ${String(item.claim ?? "").slice(0, 80)}` });
  }
}

function fundSignalText(text: string) {
  return /\b(vc fund|venture capital fund|fund manager|external manager|asset manager|fund\/manager allocation|fund commitment|limited partner|lp commitment|select investment funds?|funds? and partnerships?)\b/i.test(text);
}

function explicitNegativeFundText(text: string) {
  return /\b(no|not|without|does not|do not|avoid|avoids|excluding|rather than)\b.{0,100}\b(vc fund|venture capital fund|fund commitments?|fund investments?|external managers?|fund manager|limited partner|lp commitment)\b/i.test(text);
}

function genericAdvisoryNoFundEvidenceText(text: string) {
  return /\b(advisory\/wealth-management orientation without|no explicit fund|no public fund|wealth management|financial planning|investment advisory|financial advisory|advisor(?:y)? services?|serving (?:families|clients)|for (?:families|clients)|client portfolios?)\b/i.test(text) && !explicitNegativeFundText(text);
}

function directSignalText(text: string) {
  return /\b(direct investments?|investing directly|co-?invest|co investments?|primary investor|directly alongside|private markets?)\b/i.test(text);
}

function explicitNegativeDirectText(text: string) {
  return /\b(no|not|without|does not|do not|no explicit|no public)\b.{0,80}\b(direct investments?|investing directly|co-?invest|private markets?)\b/i.test(text);
}

function validateFlatPortfolioValues(record: Record<string, unknown>, issues: ValidationIssue[]) {
  for (const field of ["known_fund_investments", "known_direct_investments", "co_investors"]) {
    const values = nested(record, [field]);
    if (!Array.isArray(values)) continue;
    values.forEach((value, index) => {
      if (placeholderPortfolioValue(value)) {
        issues.push({ severity: "high", path: `${field}.${index}`, detail: `Portfolio field contains a placeholder or generic name: ${String(value).slice(0, 80)}` });
      }
    });
  }
}

function leanPortfolioFieldPath(fieldPath: string) {
  return ["known_fund_investments", "known_direct_investments", "co_investors"]
    .some((field) => pathMatches(field, fieldPath));
}

function leanSignalFieldPath(fieldPath: string) {
  return [
    "invests_in_vc_funds",
    "invests_directly",
    "co_investment_appetite",
    "fund_commitment_appetite",
    "capital_source_role",
    "fund_allocation_signal",
    "vc_fund_lp_signal",
    "fund_asset_classes",
    "investment_routes",
    "allocator_capabilities",
    "evidence_strength",
    "emerging_manager_appetite",
    "first_time_fund_appetite",
  ].some((field) => pathMatches(field, fieldPath));
}

function genericPortfolioEvidenceClaim(claim: string) {
  const normalized = claim.trim().toLowerCase();
  return normalized.startsWith("source-backed context supports") ||
    normalized.startsWith("source-record context supports") ||
    normalized === "source record portfolio examples support direct-investment history.";
}

function placeholderPortfolioValue(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const normalized = text.toLowerCase();
  const slugValue = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized || ["unknown", "n/a", "na", "none", "not disclosed", "not public"].includes(normalized)) return false;
  if (/^(portfolio |known |direct |fund )?(company|firm|fund|investment|investor|startup|portfolio company|portfolio firm|manager|asset|deal|holding|co-investor|co investor)( \d+)?$/.test(normalized)) return true;
  if (/^(financial services firm|real assets development|real estate platform|technology company|healthcare company|consumer company|industrial company|private equity fund|venture fund)( \d+)?$/.test(normalized)) return true;
  if (/^(company|firm|fund|investment|startup|portfolio_company|portfolio_firm|financial_services_firm|real_assets_development|real_estate_platform|technology_company|healthcare_company|consumer_company|industrial_company)_?\d+$/.test(slugValue)) return true;
  if (/^[a-z]+(_[a-z]+)*_\d+$/.test(slugValue) && !/[A-Z]/.test(text)) return true;
  return false;
}

function sameDomain(sourceUrl: string, entityDomain: string) {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return host === entityDomain || host.endsWith(`.${entityDomain}`);
  } catch {
    return false;
  }
}

function pathMatches(prefix: string, fieldPath: string) {
  const normalizedPrefix = normalizePath(prefix);
  const normalizedFieldPath = normalizePath(fieldPath);
  return normalizedFieldPath === normalizedPrefix ||
    normalizedFieldPath.startsWith(`${normalizedPrefix}.`) ||
    normalizedPrefix.startsWith(`${normalizedFieldPath}.`);
}

function normalizePath(value: string) {
  return value.replace(/\[(\d+)\]/g, ".$1").replace(/\.+/g, ".").replace(/^\./, "");
}

function nested(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function materialValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return Boolean(normalized) &&
      !["unknown", "not found", "not_publicly_disclosed", "not publicly disclosed", "not available", "n/a", "none"].includes(normalized) &&
      !/^no (publicly available |public |explicit )?(info|information|data|detail|details|disclosure|sizes?|cheque sizes?|check sizes?)\b/.test(normalized);
  }
  if (Array.isArray(value)) return value.some(materialValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(materialValue);
  return false;
}
