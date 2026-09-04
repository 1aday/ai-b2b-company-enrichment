import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { fetchMarkdownPage, type MarkdownPage } from "./markdown-scrape.js";
import { additionalSourceContext, validateCompanySourceRows } from "./input.js";
import { DEFAULT_SOURCE_CSV, compact, csvEscape, ensureDir, normalizeDomain, nowStamp, numberValue, parseArgs, readCsv, slug, text, writeJson } from "./shared.js";

type RawRow = Record<string, string>;

type Entity = {
  row_index: number;
  source_record_id: string;
  company_name: string;
  legal_name: string;
  domain: string;
  website_url: string;
  description: string;
  industry_primary: string;
  investor_type: string;
  classification_notes: string;
  city: string;
  state: string;
  region: string;
  country: string;
  latitude: string;
  longitude: string;
  location_json: string;
  csv_logo_url: string;
  phone_number: string;
  company_emails_all: string;
  linkedin_url: string;
  employee_count_range: string;
  employee_count: string;
  founded_year: string;
  revenue_range: string;
  total_revenue: string;
  final_contact_count: string;
  rank_1_contact_count: string;
  rank_2_contact_count: string;
  corporate_priority_contact_count: string;
  source_context: Record<string, string>;
};

type SourceResult = {
  source_type: string;
  source_family: string;
  reason: string;
  requested_url: string;
  final_url: string;
  page_name: string;
  page_path: string;
  fetch_status: "ok" | "failed";
  http_status: number;
  title: string;
  markdown_chars: number;
  text_chars: number;
  markdown_file: string;
  error: string;
  got: string;
  logo_candidates: string[];
  favicon_candidates: string[];
};

type EntityResult = {
  run_id: string;
  row_index: number;
  source_record_id: string;
  company_name: string;
  legal_name: string;
  domain: string;
  website_url: string;
  status: "complete" | "empty";
  successful_sources: number;
  failed_sources: number;
  source_count: number;
  logo_url: string;
  logo_source: string;
  favicon_url: string;
  favicon_source: string;
  full_address: string;
  postal_code: string;
  address_source: string;
  address_confidence: "high" | "medium" | "low" | "none";
  city: string;
  state: string;
  country: string;
  latitude: string;
  longitude: string;
  phone_number: string;
  company_emails_all: string;
  linkedin_url: string;
  description: string;
  industry_primary: string;
  investor_type: string;
  classification_notes: string;
  employee_count_range: string;
  employee_count: string;
  founded_year: string;
  revenue_range: string;
  total_revenue: string;
  final_contact_count: string;
  rank_1_contact_count: string;
  rank_2_contact_count: string;
  corporate_priority_contact_count: string;
  source_context: Record<string, string>;
  sources: SourceResult[];
  source_evidence: string;
};

type ProgressSnapshot = {
  run_id: string;
  status: "running" | "completed" | "failed";
  input_path: string;
  started_at: string;
  updated_at: string;
  finished_at: string;
  total_entities: number;
  completed_entities: number;
  successful_entities: number;
  failed_entities: number;
  empty_entities: number;
  source_ok: number;
  source_failed: number;
  logo_count: number;
  favicon_count: number;
  address_count: number;
  postal_code_count: number;
  rate_per_minute: number;
  eta: string;
  current_entity: string;
  cloudflare_bucket: string;
  cloudflare_prefix: string;
  cloudflare_last_sync_at: string;
  cloudflare_last_error: string;
  output_files: Record<string, string>;
  recent_entities: EntityResult[];
};

const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
const inputPath = path.resolve(args.input ?? DEFAULT_SOURCE_CSV);
const outdir = path.resolve(args.outdir ?? path.join(rootDir, "data", "company_enrichment", "runs"));
const runId = args["run-id"] ?? `companies-${nowStamp()}`;
const runDir = path.join(outdir, runId);
const markdownDir = path.join(runDir, "markdown");
const limit = numberValue(args.limit, 0);
const offset = numberValue(args.offset, 0);
const concurrency = Math.max(1, numberValue(args.concurrency, 16));
const timeoutMs = Math.max(500, numberValue(args["timeout-ms"], 8000));
const maxEntityMs = Math.max(0, numberValue(args["max-entity-ms"] ?? args["entity-timeout-ms"], 120_000));
const maxMarkdownChars = Math.max(2_000, numberValue(args["max-markdown-chars"], 90_000));
const maxHtmlChars = Math.max(10_000, numberValue(args["max-html-chars"], 900_000));
const terminalEvery = Math.max(1, numberValue(args["terminal-every"], 50));
const progressEvery = Math.max(1, numberValue(args["progress-every"], 25));
const cloudflareBucket = text(args["cloudflare-bucket"] ?? "");
const cloudflarePrefix = text(args["cloudflare-prefix"] ?? `company-enrichment/${runId}`);
const cloudflareSyncEvery = Math.max(0, numberValue(args["cloudflare-sync-every"], 500));
const sitePages = unique((args["site-pages"] ?? "home").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
const scrapeNavPages = args["scrape-nav-pages"] !== "false";
const maxNavPages = Math.max(0, numberValue(args["max-nav-pages"], 0));

if (!existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`);
ensureDir(markdownDir);
ensureDir(path.dirname(currentRunPath()));

const rawRows = readCsv(inputPath) as RawRow[];
validateCompanySourceRows(rawRows);
const entities = rawRows.map(normalizeEntity).filter((entity) => entity.domain || entity.website_url || entity.company_name);
const selectedEntities = limit > 0 ? entities.slice(offset, offset + limit) : entities.slice(offset);

const startedAt = new Date().toISOString();
const entityJsonlPath = path.join(runDir, `${runId}.entities.jsonl`);
const entityCsvPath = path.join(runDir, `${runId}.entities.csv`);
const progressPath = path.join(runDir, `${runId}.progress.json`);
const summaryPath = path.join(runDir, `${runId}.summary.json`);
const sourceCsvPath = path.join(runDir, `${runId}.sources.csv`);
const archivePath = path.join(outdir, `${runId}.tar.gz`);
const logEventsPath = path.join(runDir, `${runId}.events.jsonl`);

const entityCsvHeaders = [
  "run_id", "row_index", "source_record_id", "company_name", "legal_name", "domain", "website_url", "status",
  "successful_sources", "failed_sources", "source_count", "logo_url", "logo_source", "favicon_url", "favicon_source",
  "full_address", "postal_code", "address_source", "address_confidence", "city", "state", "country", "latitude", "longitude",
  "phone_number", "company_emails_all", "linkedin_url", "description", "industry_primary", "investor_type", "classification_notes",
  "employee_count_range", "employee_count", "founded_year", "revenue_range", "total_revenue", "final_contact_count",
  "rank_1_contact_count", "rank_2_contact_count", "corporate_priority_contact_count", "source_context", "source_evidence",
];
const sourceCsvHeaders = [
  "run_id", "row_index", "company_name", "domain", "source_type", "source_family", "reason", "requested_url", "final_url",
  "page_name", "page_path", "fetch_status", "http_status", "title", "markdown_chars", "text_chars", "markdown_file", "error", "got",
  "logo_candidates", "favicon_candidates",
];
writeFileSync(entityCsvPath, `${entityCsvHeaders.join(",")}\n`);
writeFileSync(sourceCsvPath, `${sourceCsvHeaders.join(",")}\n`);
writeJson(currentRunPath(), { run_id: runId, run_dir: runDir, progress_path: progressPath, entity_jsonl_path: entityJsonlPath, entity_csv_path: entityCsvPath, updated_at: startedAt });

let cursor = 0;
let completedEntities = 0;
let successfulEntities = 0;
let failedEntities = 0;
let emptyEntities = 0;
let sourceOk = 0;
let sourceFailed = 0;
let logoCount = 0;
let faviconCount = 0;
let addressCount = 0;
let postalCodeCount = 0;
let currentEntity = "";
let cloudflareLastSyncAt = "";
let cloudflareLastError = "";
const recentEntities: EntityResult[] = [];

writeEvent("run_started", { input_path: inputPath, raw_rows: rawRows.length, selected_entities: selectedEntities.length, site_pages: sitePages, scrape_nav_pages: scrapeNavPages, max_nav_pages: maxNavPages || "all", max_entity_ms: maxEntityMs || "none", cloudflare_bucket: cloudflareBucket });
writeProgress("running");
writeTerminalProgress(true);

await Promise.all(Array.from({ length: Math.min(concurrency, selectedEntities.length) }, async () => {
  while (true) {
    const index = cursor++;
    const entity = selectedEntities[index];
    if (!entity) return;
    currentEntity = `${entity.company_name || entity.domain}`;
    const result = await enrichEntity(entity);
    completedEntities += 1;
    if (result.status === "empty") emptyEntities += 1;
    else if (result.successful_sources > 0) successfulEntities += 1;
    else failedEntities += 1;
    sourceOk += result.successful_sources;
    sourceFailed += result.failed_sources;
    if (result.logo_url) logoCount += 1;
    if (result.favicon_url) faviconCount += 1;
    if (result.full_address) addressCount += 1;
    if (result.postal_code) postalCodeCount += 1;
    recentEntities.unshift(result);
    recentEntities.length = Math.min(recentEntities.length, 80);
    appendFileSync(entityJsonlPath, `${JSON.stringify(result)}\n`);
    appendCsv(entityCsvPath, entityCsvHeaders, result);
    for (const source of result.sources) appendCsv(sourceCsvPath, sourceCsvHeaders, { run_id: runId, row_index: result.row_index, company_name: result.company_name, domain: result.domain, ...source });
    if (completedEntities % progressEvery === 0 || completedEntities === selectedEntities.length) writeProgress("running");
    if (completedEntities % terminalEvery === 0 || completedEntities === selectedEntities.length) writeTerminalProgress(false);
    if (cloudflareBucket && cloudflareSyncEvery > 0 && completedEntities % cloudflareSyncEvery === 0) syncProgressToR2();
  }
}));

writeProgress("completed");
writeJson(summaryPath, {
  ...makeProgress("completed"),
  input_raw_rows: rawRows.length,
  selected_offset: offset,
  selected_limit: limit,
  site_pages: sitePages,
  scrape_nav_pages: scrapeNavPages,
  max_nav_pages: maxNavPages || "all",
  max_entity_ms: maxEntityMs || "none",
});
if (cloudflareBucket) {
  syncProgressToR2();
  archiveAndUploadRun();
}
writeTerminalProgress(false);
writeEvent("run_completed", { completed_entities: completedEntities, source_ok: sourceOk, source_failed: sourceFailed, logo_count: logoCount, favicon_count: faviconCount, address_count: addressCount, postal_code_count: postalCodeCount });
console.log(JSON.stringify({ run_id: runId, run_dir: runDir, progress: progressPath, entities_csv: entityCsvPath, cloudflare_bucket: cloudflareBucket || null, cloudflare_prefix: cloudflareBucket ? cloudflarePrefix : null }, null, 2));

async function enrichEntity(entity: Entity): Promise<EntityResult> {
  const sources = buildSources(entity);
  if (!sources.length) return makeEntityResult(entity, [], "empty");
  const entityStartedAt = Date.now();
  const queue = [...sources];
  const seen = new Set(queue.map((source) => canonicalUrl(source.url)).filter(Boolean));
  let navPagesQueued = 0;
  const sourceResults: SourceResult[] = [];
  let sourceIndex = 0;
  while (sourceIndex < queue.length) {
    if (maxEntityMs > 0 && Date.now() - entityStartedAt >= maxEntityMs) {
      sourceResults.push(makeEntityTimeoutResult(queue[sourceIndex], sourceIndex, queue.length - sourceIndex));
      break;
    }
    const currentIndex = sourceIndex++;
    const source = queue[currentIndex];
    if (!source) continue;
    const page = await fetchMarkdownPage(source.url, { timeoutMs, maxHtmlChars, maxMarkdownChars, userAgent: "ai-b2b-company-enrichment/0.1" });
    const markdownFile = markdownFileFor(entity, currentIndex, source, page);
    if (page.markdown) {
      const markdownPath = path.join(runDir, markdownFile);
      ensureDir(path.dirname(markdownPath));
      writeFileSync(markdownPath, markdownWithPageHeader(entity, source, page, markdownFile));
    }
    sourceResults.push({
      source_type: source.source_type,
      source_family: source.source_family,
      reason: source.reason,
      requested_url: source.url,
      final_url: page.final_url,
      page_name: pageNameFor(source, page),
      page_path: pagePathFor(page.final_url || source.url),
      fetch_status: page.status,
      http_status: page.http_status,
      title: page.title,
      markdown_chars: page.markdown_chars,
      text_chars: page.text.length,
      markdown_file: page.markdown ? markdownFile : "",
      error: page.error,
      got: summarizePage(page),
      logo_candidates: page.assets.logo_urls,
      favicon_candidates: page.assets.favicon_urls,
    });
    if (scrapeNavPages && page.status === "ok" && shouldDiscoverNavLinks(source)) {
      for (const navUrl of navLinksForEntity(page.links, entity, page.final_url || source.url)) {
        if (maxNavPages > 0 && navPagesQueued >= maxNavPages) break;
        const canonical = canonicalUrl(navUrl);
        if (!canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        navPagesQueued += 1;
        queue.push({
          source_type: "first_party_external",
          source_family: "nav_link",
          reason: "homepage_same_domain_link",
          url: navUrl,
        });
      }
    }
  }
  const result = makeEntityResult(entity, sourceResults, "complete");
  writeCompanyIndex(entity, result);
  return result;
}

function makeEntityTimeoutResult(source: { source_type: string; source_family: string; reason: string; url: string } | undefined, sourceIndex: number, remainingSources: number): SourceResult {
  const requestedUrl = source?.url ?? "";
  return {
    source_type: source?.source_type ?? "first_party_external",
    source_family: source?.source_family ?? "entity_timeout",
    reason: "entity_timeout",
    requested_url: requestedUrl,
    final_url: "",
    page_name: source?.source_family ? `${source.source_family} timeout` : "Entity timeout",
    page_path: requestedUrl ? pagePathFor(requestedUrl) : "",
    fetch_status: "failed",
    http_status: 0,
    title: "",
    markdown_chars: 0,
    text_chars: 0,
    markdown_file: "",
    error: `Entity scrape exceeded ${maxEntityMs}ms with ${remainingSources} queued source(s) remaining.`,
    got: `Stopped scraping this entity after ${maxEntityMs}ms to prevent a stalled site from blocking the run.`,
    logo_candidates: [],
    favicon_candidates: [],
  };
}

function makeEntityResult(entity: Entity, sources: SourceResult[], status: "complete" | "empty"): EntityResult {
  const okSources = sources.filter((source) => source.fetch_status === "ok");
  const logo = chooseLogo(entity, sources);
  const favicon = chooseFavicon(entity, sources);
  const address = chooseAddress(entity, sources);
  return {
    run_id: runId,
    row_index: entity.row_index,
    source_record_id: entity.source_record_id,
    company_name: entity.company_name,
    legal_name: entity.legal_name,
    domain: entity.domain,
    website_url: entity.website_url,
    status,
    successful_sources: okSources.length,
    failed_sources: sources.length - okSources.length,
    source_count: sources.length,
    logo_url: logo.url,
    logo_source: logo.source,
    favicon_url: favicon.url,
    favicon_source: favicon.source,
    full_address: address.full_address,
    postal_code: address.postal_code,
    address_source: address.source,
    address_confidence: address.confidence,
    city: entity.city,
    state: entity.state,
    country: entity.country,
    latitude: entity.latitude,
    longitude: entity.longitude,
    phone_number: entity.phone_number,
    company_emails_all: entity.company_emails_all,
    linkedin_url: entity.linkedin_url,
    description: compact(entity.description, 800),
    industry_primary: entity.industry_primary,
    investor_type: entity.investor_type,
    classification_notes: compact(entity.classification_notes, 700),
    employee_count_range: entity.employee_count_range,
    employee_count: entity.employee_count,
    founded_year: entity.founded_year,
    revenue_range: entity.revenue_range,
    total_revenue: entity.total_revenue,
    final_contact_count: entity.final_contact_count,
    rank_1_contact_count: entity.rank_1_contact_count,
    rank_2_contact_count: entity.rank_2_contact_count,
    corporate_priority_contact_count: entity.corporate_priority_contact_count,
    source_context: entity.source_context,
    sources,
    source_evidence: okSources.slice(0, 4).map((source) => `${source.source_family || source.source_type}: ${source.final_url || source.requested_url}`).join(" | "),
  };
}

function buildSources(entity: Entity) {
  const homepage = firstUrlLike(entity.website_url) || domainToUrl(entity.domain);
  const origin = homepage ? originUrl(homepage) : "";
  const sources: { source_type: string; source_family: string; reason: string; url: string }[] = [];
  if (sitePages.includes("home") && homepage) sources.push({ source_type: "first_party_external", source_family: "homepage", reason: "website_url_or_domain", url: homepage });
  if (sitePages.includes("domain") && entity.domain) sources.push({ source_type: "first_party_external", source_family: "domain_root", reason: "domain", url: domainToUrl(entity.domain) });
  if (sitePages.includes("home") || sitePages.includes("domain")) {
    for (const variantUrl of dehyphenatedDomainFallbackUrls(entity.domain)) {
      sources.push({ source_type: "first_party_external", source_family: "domain_variant", reason: "dehyphenated_domain_fallback", url: variantUrl });
    }
  }
  if (origin && sitePages.includes("contact")) {
    sources.push({ source_type: "first_party_external", source_family: "contact", reason: "address_zip_logo_discovery", url: `${origin}/contact` });
    sources.push({ source_type: "first_party_external", source_family: "contact", reason: "address_zip_logo_discovery", url: `${origin}/contact-us` });
  }
  if (origin && sitePages.includes("about")) {
    sources.push({ source_type: "first_party_external", source_family: "about", reason: "company_profile_discovery", url: `${origin}/about` });
    sources.push({ source_type: "first_party_external", source_family: "about", reason: "company_profile_discovery", url: `${origin}/about-us` });
  }
  if (origin && sitePages.includes("team")) sources.push({ source_type: "first_party_external", source_family: "team", reason: "team_discovery", url: `${origin}/team` });
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = canonicalUrl(source.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dehyphenatedDomainFallbackUrls(domain: string) {
  const normalized = normalizeDomain(domain);
  if (!normalized.includes("-")) return [];
  const dehyphenated = normalized.replace(/-/g, "");
  if (!dehyphenated || dehyphenated === normalized) return [];
  return [`https://${dehyphenated}/`, `https://www.${dehyphenated}/`];
}

function shouldDiscoverNavLinks(source: { source_family: string }) {
  return source.source_family === "homepage" || source.source_family === "domain_root" || source.source_family === "domain_variant";
}

function navLinksForEntity(links: string[], entity: Entity, sourceUrl: string) {
  const allowedDomains = unique([
    entity.domain,
    hostDomain(entity.website_url),
    hostDomain(sourceUrl),
  ].map((value) => normalizeDomain(value)).filter(Boolean));
  return unique(links)
    .filter((url) => {
      if (!isPageLikeUrl(url)) return false;
      const host = normalizeDomain(hostDomain(url));
      return allowedDomains.includes(host);
    })
    .sort((a, b) => navSortScore(a) - navSortScore(b) || a.localeCompare(b));
}

function isPageLikeUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const pathname = parsed.pathname.toLowerCase();
    return !/\.(?:png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|json|xml|txt|woff2?|ttf|eot|zip|gz|tar|mp4|mov|avi|mp3|wav)(?:$|\?)/i.test(pathname);
  } catch {
    return false;
  }
}

function navSortScore(value: string) {
  try {
    const pathValue = new URL(value).pathname.toLowerCase();
    if (/contact|location|office|address/.test(pathValue)) return 0;
    if (/about|company|who-we-are/.test(pathValue)) return 1;
    if (/team|people|leadership|partner/.test(pathValue)) return 2;
    if (/portfolio|companies|investment|strategy|approach|capital|family-office/.test(pathValue)) return 3;
    return 10;
  } catch {
    return 99;
  }
}

function normalizeEntity(row: RawRow, index: number): Entity {
  const domain = normalizeDomain(row.domain || row.normalized_domain || row.website_url);
  return {
    row_index: index,
    source_record_id: text(row.source_record_id),
    company_name: text(row.company_name),
    legal_name: text(row.legal_name),
    domain,
    website_url: firstUrlLike(row.website_url) || domainToUrl(domain),
    description: text(row.description || row.company_overview),
    industry_primary: text(row.industry_primary || row.industry_raw),
    investor_type: text(row.INVESTOR_TYPE || row.investor_type),
    classification_notes: text(row.CLASSIFICATION_NOTES || row.classification_notes),
    city: text(row.city),
    state: text(row.state || row.region),
    region: text(row.region),
    country: text(row.country),
    latitude: text(row.latitude),
    longitude: text(row.longitude),
    location_json: text(row.location_json),
    csv_logo_url: firstUrlLike(row.logo_url),
    phone_number: text(row.phone_number),
    company_emails_all: text(row.company_emails_all),
    linkedin_url: firstUrlLike(row.linkedin_url),
    employee_count_range: text(row.employee_count_range),
    employee_count: text(row.employee_count),
    founded_year: text(row.founded_year),
    revenue_range: text(row.revenue_range),
    total_revenue: text(row.total_revenue),
    final_contact_count: text(row.final_contact_count),
    rank_1_contact_count: text(row.rank_1_contact_count),
    rank_2_contact_count: text(row.rank_2_contact_count),
    corporate_priority_contact_count: text(row.corporate_priority_contact_count),
    source_context: additionalSourceContext(row),
  };
}

function chooseLogo(entity: Entity, sources: SourceResult[]) {
  if (entity.csv_logo_url) return { url: entity.csv_logo_url, source: "csv.logo_url" };
  const scraped = firstMaterial(sources.flatMap((source) => source.logo_candidates));
  if (scraped) return { url: scraped, source: "scraped_site_asset" };
  const favicon = chooseFavicon(entity, sources);
  if (favicon.url) return { url: favicon.url, source: "favicon_fallback" };
  return { url: "", source: "" };
}

function chooseFavicon(entity: Entity, sources: SourceResult[]) {
  const scraped = firstMaterial(sources.flatMap((source) => source.favicon_candidates));
  if (scraped) return { url: scraped, source: "scraped_icon_link" };
  const homepage = firstUrlLike(entity.website_url) || domainToUrl(entity.domain);
  const origin = homepage ? originUrl(homepage) : "";
  if (origin) return { url: `${origin}/favicon.ico`, source: "origin_favicon_fallback" };
  return { url: "", source: "" };
}

function chooseAddress(entity: Entity, sources: SourceResult[]) {
  const combinedText = sources.map((source) => source.got).join(" \n");
  const postalCode = extractPostalCode(combinedText, entity);
  const street = cleanAddressCandidate(extractStreetAddress(combinedText));
  const csvLocation = compact([entity.city, entity.state, entity.country].filter(Boolean).join(", "), 300);
  if (street) {
    const full = cleanAddressCandidate(compact([street, entity.city, entity.state, postalCode, entity.country].filter(Boolean).join(", "), 420));
    return { full_address: full, postal_code: postalCode, source: "scraped_site_text", confidence: postalCode ? "high" as const : "medium" as const };
  }
  if (postalCode && csvLocation) return { full_address: compact([csvLocation, postalCode].join(" "), 320), postal_code: postalCode, source: "csv_location_plus_scraped_postal_code", confidence: "medium" as const };
  if (csvLocation) return { full_address: csvLocation, postal_code: "", source: "csv_city_state_country", confidence: "low" as const };
  return { full_address: "", postal_code: postalCode, source: postalCode ? "scraped_postal_code_only" : "", confidence: postalCode ? "low" as const : "none" as const };
}

function extractPostalCode(value: string, entity: Entity) {
  const textValue = value.replace(/\s+/g, " ");
  const stateOptions = unique([entity.state, usStateAbbrev(entity.state)].filter(Boolean));
  if (entity.city && stateOptions.length) {
    for (const state of stateOptions) {
      const cityStateZip = new RegExp(`${escapeRegExp(entity.city)}\\s*,?\\s*${escapeRegExp(state)}\\s+([A-Z]\\d[A-Z]\\s?\\d[A-Z]\\d|\\d{5}(?:-\\d{4})?)`, "i");
      const match = textValue.match(cityStateZip);
      if (match?.[1]) return match[1].toUpperCase();
    }
  }
  const generic = textValue.match(/\b([A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(?:-\d{4})?)\b/);
  return generic?.[1]?.toUpperCase() ?? "";
}

function extractStreetAddress(value: string) {
  const textValue = value.replace(/\s+/g, " ");
  const match = textValue.match(/\b\d{1,6}\s+[A-Za-z0-9.'#&\-\s]{2,90}\s(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Place|Pl\.?|Court|Ct\.?|Circle|Cir\.?|Parkway|Pkwy\.?|Highway|Hwy\.?|Suite|Ste\.?)\b[^|\n]{0,90}/i);
  return match ? cleanAddressCandidate(compact(match[0], 220)) : "";
}

function cleanAddressCandidate(value: string) {
  if (!value) return "";
  let cleaned = value.replace(/\s+/g, " ").trim();
  cleaned = cleaned
    .split(/\b(?:Email|E-mail|Phone|Tel|Fax|Contact|Subscribe|Newsletter|Privacy|Terms|Copyright|All Rights Reserved|LinkedIn|Twitter|Facebook|Instagram)\b/i)[0]
    .split(/(?:©|mailto:|https?:\/\/|www\.)/i)[0]
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return compact(cleaned, 260);
}

function summarizePage(page: MarkdownPage) {
  const textValue = compact(page.text || page.markdown || page.title || page.error, 900);
  return textValue || (page.status === "ok" ? `Fetched ${page.http_status}` : page.error);
}

function markdownFileFor(entity: Entity, sourceIndex: number, source: { source_family: string; url: string }, page: MarkdownPage) {
  const status = page.status === "ok" ? "ok" : "failed";
  return path.join(
    companyMarkdownDir(entity),
    `${String(sourceIndex + 1).padStart(3, "0")}-${slug(pageNameFor(source, page)).slice(0, 70)}-${status}.md`,
  ).replaceAll("\\", "/");
}

function companyMarkdownDir(entity: Entity) {
  return path.join(
    "markdown",
    `${String(entity.row_index + 1).padStart(6, "0")}-${slug(entity.company_name || entity.domain).slice(0, 52)}-${slug(entity.domain || entity.source_record_id).slice(0, 36)}`,
  ).replaceAll("\\", "/");
}

function markdownWithPageHeader(entity: Entity, source: { source_type: string; source_family: string; reason: string; url: string }, page: MarkdownPage, markdownFile: string) {
  const pageName = pageNameFor(source, page);
  const pagePath = pagePathFor(page.final_url || source.url);
  const metadata: Record<string, unknown> = {
    run_id: runId,
    row_index: entity.row_index,
    source_record_id: entity.source_record_id,
    company_name: entity.company_name,
    legal_name: entity.legal_name,
    domain: entity.domain,
    website_url: entity.website_url,
    investor_type: entity.investor_type,
    source_context: entity.source_context,
    csv_city: entity.city,
    csv_state: entity.state,
    csv_country: entity.country,
    source_type: source.source_type,
    source_family: source.source_family,
    reason: source.reason,
    requested_url: source.url,
    final_url: page.final_url,
    page_name: pageName,
    page_path: pagePath,
    page_title: page.title,
    markdown_file: markdownFile,
    fetched_at: new Date().toISOString(),
    fetch_status: page.status,
    http_status: page.http_status,
    content_type: page.content_type,
    markdown_chars: page.markdown_chars,
    text_chars: page.text.length,
    logo_candidates: page.assets.logo_urls,
    favicon_candidates: page.assets.favicon_urls,
  };
  const header = [
    "---",
    ...Object.entries(metadata).map(([key, value]) => `${key}: ${frontmatterValue(value)}`),
    "---",
    "",
    `# ${pageName}`,
    "",
    `Company: ${entity.company_name}`,
    `Domain: ${entity.domain}`,
    `Page path: ${pagePath}`,
    `Final URL: ${page.final_url || source.url}`,
    "",
  ].join("\n");
  return `${header}${page.markdown}\n`;
}

function writeCompanyIndex(entity: Entity, result: EntityResult) {
  const indexPath = path.join(runDir, companyMarkdownDir(entity), "_company_index.json");
  writeJson(indexPath, {
    run_id: runId,
    row_index: entity.row_index,
    source_record_id: entity.source_record_id,
    company_name: entity.company_name,
    legal_name: entity.legal_name,
    domain: entity.domain,
    website_url: entity.website_url,
    investor_type: entity.investor_type,
    industry_primary: entity.industry_primary,
    logo_url: result.logo_url,
    logo_source: result.logo_source,
    favicon_url: result.favicon_url,
    favicon_source: result.favicon_source,
    full_address: result.full_address,
    postal_code: result.postal_code,
    address_source: result.address_source,
    address_confidence: result.address_confidence,
    markdown_dir: companyMarkdownDir(entity),
    pages: result.sources.map((source) => ({
      page_name: source.page_name,
      page_path: source.page_path,
      source_family: source.source_family,
      requested_url: source.requested_url,
      final_url: source.final_url,
      fetch_status: source.fetch_status,
      http_status: source.http_status,
      markdown_file: source.markdown_file,
      got: source.got,
    })),
  });
}

function pageNameFor(source: { source_family: string; url: string }, page: Pick<MarkdownPage, "final_url" | "title">) {
  const url = page.final_url || source.url;
  const pathName = pagePathFor(url);
  if (pathName === "/") return source.source_family === "nav_link" ? "homepage" : source.source_family;
  const cleaned = pathName
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .slice(-3)
    .join(" / ")
    .replace(/[-_]+/g, " ");
  return compact(cleaned || page.title || source.source_family, 120);
}

function pagePathFor(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.pathname || "/";
  } catch {
    return "/";
  }
}

function frontmatterValue(value: unknown) {
  if (Array.isArray(value) || (value && typeof value === "object")) return JSON.stringify(value);
  const raw = text(value);
  if (!raw) return "\"\"";
  return JSON.stringify(raw);
}

function appendCsv(filePath: string, headers: string[], row: Record<string, unknown>) {
  appendFileSync(filePath, `${headers.map((header) => csvEscape(row[header])).join(",")}\n`);
}

function writeProgress(status: ProgressSnapshot["status"]) {
  const progress = makeProgress(status);
  writeJson(progressPath, progress);
  writeJson(currentRunPath(), { run_id: runId, run_dir: runDir, progress_path: progressPath, entity_jsonl_path: entityJsonlPath, entity_csv_path: entityCsvPath, updated_at: progress.updated_at });
}

function makeProgress(status: ProgressSnapshot["status"]): ProgressSnapshot {
  const elapsedMinutes = Math.max(0.001, (Date.now() - Date.parse(startedAt)) / 60000);
  const rate = completedEntities / elapsedMinutes;
  const remaining = Math.max(0, selectedEntities.length - completedEntities);
  const etaMinutes = rate > 0 ? remaining / rate : 0;
  return {
    run_id: runId,
    status,
    input_path: inputPath,
    started_at: startedAt,
    updated_at: new Date().toISOString(),
    finished_at: status === "completed" || status === "failed" ? new Date().toISOString() : "",
    total_entities: selectedEntities.length,
    completed_entities: completedEntities,
    successful_entities: successfulEntities,
    failed_entities: failedEntities,
    empty_entities: emptyEntities,
    source_ok: sourceOk,
    source_failed: sourceFailed,
    logo_count: logoCount,
    favicon_count: faviconCount,
    address_count: addressCount,
    postal_code_count: postalCodeCount,
    rate_per_minute: Math.round(rate * 10) / 10,
    eta: formatDuration(etaMinutes),
    current_entity: currentEntity,
    cloudflare_bucket: cloudflareBucket,
    cloudflare_prefix: cloudflareBucket ? cloudflarePrefix : "",
    cloudflare_last_sync_at: cloudflareLastSyncAt,
    cloudflare_last_error: cloudflareLastError,
    output_files: {
      run_dir: runDir,
      markdown_dir: markdownDir,
      entities_jsonl: entityJsonlPath,
      entities_csv: entityCsvPath,
      sources_csv: sourceCsvPath,
      progress_json: progressPath,
      summary_json: summaryPath,
      archive: archivePath,
    },
    recent_entities: recentEntities,
  };
}

function writeTerminalProgress(initial: boolean) {
  const pct = selectedEntities.length ? Math.round((completedEntities / selectedEntities.length) * 1000) / 10 : 100;
  const width = 32;
  const filled = Math.min(width, Math.round((pct / 100) * width));
  const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
  const lines = [
    "",
    "Capital Source enrichment",
    `${bar} ${pct.toFixed(1)}%`,
    `Entities: ${completedEntities.toLocaleString()}/${selectedEntities.length.toLocaleString()} | success ${successfulEntities.toLocaleString()} | failed ${failedEntities.toLocaleString()} | empty ${emptyEntities.toLocaleString()}`,
    `Sources: ok ${sourceOk.toLocaleString()} | failed ${sourceFailed.toLocaleString()} | logos ${logoCount.toLocaleString()} | favicons ${faviconCount.toLocaleString()} | address ${addressCount.toLocaleString()} | zip ${postalCodeCount.toLocaleString()}`,
    `Rate: ${makeProgress("running").rate_per_minute}/min | ETA ${makeProgress("running").eta} | Current: ${currentEntity || "starting"}`,
    cloudflareBucket ? `Cloudflare R2: ${cloudflareBucket}/${cloudflarePrefix}${cloudflareLastError ? ` | last error: ${cloudflareLastError}` : ""}` : "Cloudflare R2: disabled",
  ];
  if (process.stdout.isTTY && !initial) process.stdout.write(`\x1b[2J\x1b[H${lines.join("\n")}\n`);
  else console.log(lines.join("\n"));
}

function syncProgressToR2() {
  writeProgress("running");
  uploadToR2(progressPath, `${cloudflarePrefix}/progress.json`);
  uploadToR2(entityCsvPath, `${cloudflarePrefix}/entities.csv`);
  uploadToR2(sourceCsvPath, `${cloudflarePrefix}/sources.csv`);
}

function archiveAndUploadRun() {
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", runDir, "."], { encoding: "utf8", timeout: 30 * 60 * 1000 });
  if (tar.status !== 0) {
    cloudflareLastError = compact(tar.stderr || tar.stdout || "tar failed", 500);
    writeProgress("completed");
    return;
  }
  uploadToR2(summaryPath, `${cloudflarePrefix}/summary.json`);
  uploadToR2(progressPath, `${cloudflarePrefix}/progress.json`);
  uploadToR2(entityCsvPath, `${cloudflarePrefix}/entities.csv`);
  uploadToR2(sourceCsvPath, `${cloudflarePrefix}/sources.csv`);
  uploadToR2(archivePath, `${cloudflarePrefix}/${runId}.tar.gz`);
}

function uploadToR2(filePath: string, key: string) {
  if (!cloudflareBucket || !existsSync(filePath)) return;
  const target = `${cloudflareBucket}/${key}`;
  const result = spawnSync("npx", ["--yes", "wrangler", "r2", "object", "put", target, "--file", filePath], { encoding: "utf8", timeout: 10 * 60 * 1000 });
  if (result.status === 0) {
    cloudflareLastSyncAt = new Date().toISOString();
    cloudflareLastError = "";
  } else {
    cloudflareLastError = compact(result.stderr || result.stdout || `upload failed: ${target}`, 700);
  }
  writeJson(path.join(runDir, `${runId}.cloudflare.json`), { bucket: cloudflareBucket, prefix: cloudflarePrefix, last_sync_at: cloudflareLastSyncAt, last_error: cloudflareLastError });
}

function writeEvent(event: string, details: Record<string, unknown>) {
  appendFileSync(logEventsPath, `${JSON.stringify({ at: new Date().toISOString(), event, run_id: runId, details })}\n`);
}

function currentRunPath() {
  return path.join(rootDir, "data", "company_enrichment", "current-run.json");
}

function firstUrlLike(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : raw.includes(".") ? `https://${raw}` : raw;
  try {
    const url = new URL(withProtocol);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function domainToUrl(value: unknown) {
  const domain = normalizeDomain(value);
  return domain ? `https://${domain}/` : "";
}

function canonicalUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function originUrl(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function hostDomain(value: string) {
  const raw = text(value);
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return normalizeDomain(raw);
  }
}

function firstMaterial(values: unknown[]) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate && candidate !== "[]" && candidate !== "{}" && candidate.toLowerCase() !== "null") return candidate;
  }
  return "";
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDuration(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "calculating";
  if (minutes < 60) return `${Math.ceil(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.ceil(minutes % 60);
  return `${hours}h ${mins}m`;
}

function usStateAbbrev(value: string) {
  const key = value.trim().toLowerCase();
  switch (key) {
    case "alabama": return "AL";
    case "alaska": return "AK";
    case "arizona": return "AZ";
    case "arkansas": return "AR";
    case "california": return "CA";
    case "colorado": return "CO";
    case "connecticut": return "CT";
    case "delaware": return "DE";
    case "florida": return "FL";
    case "georgia": return "GA";
    case "hawaii": return "HI";
    case "idaho": return "ID";
    case "illinois": return "IL";
    case "indiana": return "IN";
    case "iowa": return "IA";
    case "kansas": return "KS";
    case "kentucky": return "KY";
    case "louisiana": return "LA";
    case "maine": return "ME";
    case "maryland": return "MD";
    case "massachusetts": return "MA";
    case "michigan": return "MI";
    case "minnesota": return "MN";
    case "mississippi": return "MS";
    case "missouri": return "MO";
    case "montana": return "MT";
    case "nebraska": return "NE";
    case "nevada": return "NV";
    case "new hampshire": return "NH";
    case "new jersey": return "NJ";
    case "new mexico": return "NM";
    case "new york": return "NY";
    case "north carolina": return "NC";
    case "north dakota": return "ND";
    case "ohio": return "OH";
    case "oklahoma": return "OK";
    case "oregon": return "OR";
    case "pennsylvania": return "PA";
    case "rhode island": return "RI";
    case "south carolina": return "SC";
    case "south dakota": return "SD";
    case "tennessee": return "TN";
    case "texas": return "TX";
    case "utah": return "UT";
    case "vermont": return "VT";
    case "virginia": return "VA";
    case "washington": return "WA";
    case "west virginia": return "WV";
    case "wisconsin": return "WI";
    case "wyoming": return "WY";
    case "district of columbia": return "DC";
    default: return "";
  }
}

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
