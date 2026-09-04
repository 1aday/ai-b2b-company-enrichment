import { readFileSync } from "node:fs";
import path from "node:path";

export type IcpDefinition = {
  name: string;
  description: string;
  target_industries: string[];
  target_geographies: string[];
  business_models: string[];
  employee_count_min: number | null;
  employee_count_max: number | null;
  must_have_signals: string[];
  disqualifiers: string[];
};

export function loadIcp(filePath: string | undefined): IcpDefinition | null {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  const parsed = JSON.parse(readFileSync(resolved, "utf8")) as Record<string, unknown>;
  const name = stringValue(parsed.name);
  const description = stringValue(parsed.description);
  if (!name) throw new Error(`ICP file ${resolved} must include a non-empty name.`);
  if (!description) throw new Error(`ICP file ${resolved} must include a non-empty description.`);
  const employeeMin = numberOrNull(parsed.employee_count_min);
  const employeeMax = numberOrNull(parsed.employee_count_max);
  if (employeeMin !== null && employeeMax !== null && employeeMin > employeeMax) {
    throw new Error(`ICP file ${resolved} has employee_count_min greater than employee_count_max.`);
  }
  return {
    name,
    description,
    target_industries: stringArray(parsed.target_industries),
    target_geographies: stringArray(parsed.target_geographies),
    business_models: stringArray(parsed.business_models),
    employee_count_min: employeeMin,
    employee_count_max: employeeMax,
    must_have_signals: stringArray(parsed.must_have_signals),
    disqualifiers: stringArray(parsed.disqualifiers),
  };
}

export function icpPrompt(icp: IcpDefinition | null) {
  if (!icp) return "No ideal customer profile was supplied. Do not score this company.";
  return `Score the company against this explicit ideal customer profile:\n${JSON.stringify(icp, null, 2)}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`ICP employee bounds must be non-negative numbers or null.`);
  return number;
}
