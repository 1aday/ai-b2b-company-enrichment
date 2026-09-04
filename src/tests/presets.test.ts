import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { isEmptyScrapedPacket, isRetryableResponse, validateQualificationMode } from "../enrichment-validation.js";
import { loadIcp } from "../icp.js";
import { additionalSourceContext, validateCompanySourceRows } from "../input.js";
import { getPreset } from "../presets/index.js";
import { parseJsonObject } from "../shared.js";

const fixtureDir = path.join(process.cwd(), "examples", "fixtures", "prepared_for_llm", "northstar-cloud");

test("company fixture validates without fabricated ICP scoring", () => {
  const value = fixture("fixture_response.json");
  assert.equal(getPreset("company").validate(value).ok, true);
  assert.equal(validateQualificationMode(value, false).ok, true);
  assert.deepEqual((value.qualification as Record<string, unknown>).icp_score, null);
});

test("company fixture validates with explicit ICP scoring", () => {
  const value = fixture("fixture_response.icp.json");
  assert.equal(getPreset("company").validate(value).ok, true);
  assert.equal(validateQualificationMode(value, true).ok, true);
  assert.equal((value.qualification as Record<string, unknown>).icp_score, 86);
  assert.equal(loadIcp(path.join(process.cwd(), "examples", "icp.sample.json"))?.name, "North American cloud software");
});

test("capital-source fixture remains available behind its preset", () => {
  const value = fixture("fixture_response.capital-source.json");
  assert.equal(getPreset("capital-source").validate(value).ok, true);
});

test("company validator rejects missing websites and missing evidence", () => {
  const value = fixture("fixture_response.json");
  (value.identity as Record<string, unknown>).website_url = "";
  value.source_evidence = [];
  const result = getPreset("company").validate(value);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /website_url/);
  assert.match(result.errors.join(" "), /source_evidence/);
});

test("qualification mode rejects a score when no ICP was supplied", () => {
  const value = fixture("fixture_response.icp.json");
  const result = validateQualificationMode(value, false);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /not_scored/);
});

test("malformed model responses do not parse", () => {
  assert.equal(parseJsonObject("```json\n{broken}\n```"), null);
});

test("empty scrapes are recognized before model execution", () => {
  assert.equal(isEmptyScrapedPacket("No usable company-site content was kept after cleanup. No usable third-party content was kept after cleanup."), true);
  assert.equal(isEmptyScrapedPacket(readFileSync(path.join(fixtureDir, "llm_input.md"), "utf8")), false);
});

test("retry policy covers throttling, timeouts, and provider failures", () => {
  assert.equal(isRetryableResponse(0), true);
  assert.equal(isRetryableResponse(429), true);
  assert.equal(isRetryableResponse(503), true);
  assert.equal(isRetryableResponse(400), false);
});

test("input contract requires only the four identity columns and preserves the rest", () => {
  const row = {
    source_record_id: "row-1",
    company_name: "Northstar Cloud",
    domain: "northstarcloud.example",
    website_url: "https://northstarcloud.example",
    account_tier: "research",
  };
  assert.doesNotThrow(() => validateCompanySourceRows([row]));
  assert.deepEqual(additionalSourceContext(row), { account_tier: "research" });
  assert.throws(() => validateCompanySourceRows([{ ...row, website_url: "" }]), /website_url is required/);
});

function fixture(name: string) {
  return JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}
