import type { JsonSchemaDefinition } from "../schema.js";

export type EnrichmentPresetId = "company" | "capital-source";

export type KeywordGate = {
  enabledByDefault: boolean;
  mode: string;
  terms: string[];
};

export type WeightedField = {
  path: string;
  weight: number;
};

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

export type EnrichmentPreset = {
  id: EnrichmentPresetId;
  displayName: string;
  description: string;
  schema: JsonSchemaDefinition;
  systemPrompt: string;
  keywordGate: KeywordGate;
  benchmarkFields: WeightedField[];
  validate(value: unknown): ValidationResult;
  flatten(value: Record<string, unknown>): Record<string, unknown>;
};
