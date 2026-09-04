import type { ValidationResult } from "./presets/types.js";

export function validateQualificationMode(value: Record<string, unknown>, icpSupplied: boolean): ValidationResult {
  const errors: string[] = [];
  const qualification = objectValue(value.qualification);
  if (!qualification) return { ok: false, errors: ["qualification must be an object"] };
  if (!icpSupplied) {
    if (qualification.status !== "not_scored") errors.push("qualification.status must be not_scored when no ICP is supplied");
    if (qualification.icp_score !== null) errors.push("qualification.icp_score must be null when no ICP is supplied");
  } else if (qualification.status === "not_scored") {
    errors.push("qualification.status cannot be not_scored when an ICP is supplied");
  }
  return { ok: errors.length === 0, errors };
}

export function isEmptyScrapedPacket(markdown: string) {
  const normalized = markdown.replace(/---[\s\S]*?---/g, "").replace(/[#>*_`\-]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length < 80
    || (/No usable company-site content was kept after cleanup\./i.test(markdown)
      && /No usable third-party content was kept after cleanup\./i.test(markdown));
}

export function isRetryableResponse(status: number) {
  return status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
}

export function mergeValidation(...results: ValidationResult[]): ValidationResult {
  const errors = results.flatMap((result) => result.errors);
  return { ok: errors.length === 0, errors };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
