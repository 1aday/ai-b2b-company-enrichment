import { capitalSourcePreset } from "./capital-source.js";
import { companyPreset } from "./company.js";
import type { EnrichmentPreset, EnrichmentPresetId } from "./types.js";

const presets: Record<EnrichmentPresetId, EnrichmentPreset> = {
  company: companyPreset,
  "capital-source": capitalSourcePreset,
};

export function getPreset(value: string | undefined): EnrichmentPreset {
  const id = (value || "company") as EnrichmentPresetId;
  const preset = presets[id];
  if (!preset) throw new Error(`Unknown preset: ${value}. Expected company or capital-source.`);
  return preset;
}

export function listPresets() {
  return Object.values(presets);
}

export type { EnrichmentPreset, EnrichmentPresetId } from "./types.js";
