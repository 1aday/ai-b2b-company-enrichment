import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { compact, ensureDir, numberValue, parseArgs, slug, writeJson } from "./shared.js";

type PageIndex = {
  page_name: string;
  page_path: string;
  source_family: string;
  requested_url: string;
  final_url: string;
  fetch_status: string;
  http_status: number;
  markdown_file: string;
  got: string;
};

type CompanyIndex = {
  run_id: string;
  row_index: number;
  source_record_id: string;
  company_name: string;
  legal_name: string;
  domain: string;
  website_url: string;
  investor_type: string;
  industry_primary: string;
  logo_url: string;
  logo_source: string;
  favicon_url: string;
  favicon_source: string;
  full_address: string;
  postal_code: string;
  address_source: string;
  address_confidence: string;
  markdown_dir: string;
  pages: PageIndex[];
  source_context?: Record<string, string>;
};

type ParsedPage = PageIndex & {
  frontmatter: Record<string, unknown>;
  raw_markdown: string;
  raw_body: string;
  cleaned_text: string;
  raw_chars: number;
  clean_chars: number;
  content_hash: string;
  score: number;
  keep: boolean;
  keep_reasons: string[];
  drop_reasons: string[];
  source_bucket: "first_party" | "third_party" | "unknown";
};

type PreparedPacket = {
  entity: Record<string, unknown>;
  candidates: Record<string, unknown>;
  first_party_sources: PreparedSource[];
  third_party_sources: PreparedSource[];
  dropped_sources: Array<Record<string, unknown>>;
  source_inventory: Array<Record<string, unknown>>;
  quality: Record<string, unknown>;
};

type PreparedSource = {
  page_name: string;
  page_path: string;
  source_bucket: string;
  source_family: string;
  final_url: string;
  score: number;
  keep_reasons: string[];
  clean_text: string;
  markdown_file: string;
};

const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
const currentRunPath = path.join(rootDir, "data", "company_enrichment", "current-run.json");
const currentRun = existsSync(currentRunPath) ? JSON.parse(readFileSync(currentRunPath, "utf8")) as { run_dir?: string } : {};
const runDir = path.resolve(args["run-dir"] ?? currentRun.run_dir ?? "");
if (!runDir || !existsSync(runDir)) throw new Error(`Run dir not found: ${runDir || "<empty>"}`);

const markdownRoot = path.join(runDir, "markdown");
if (!existsSync(markdownRoot)) throw new Error(`Markdown root not found: ${markdownRoot}`);

const outRoot = path.resolve(args.outdir ?? path.join(runDir, "prepared_for_llm"));
const limit = numberValue(args.limit, 0);
const offset = numberValue(args.offset, 0);
const maxPagesPerCompany = Math.max(1, numberValue(args["max-pages-per-company"], 999));
const maxCharsPerPage = Math.max(500, numberValue(args["max-chars-per-page"], 60_000));
const maxTotalChars = Math.max(2_000, numberValue(args["max-total-chars"], 1_000_000));
const minUsefulChars = Math.max(80, numberValue(args["min-useful-chars"], 220));

ensureDir(outRoot);

const companyDirs = readdirSync(markdownRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(markdownRoot, entry.name))
  .filter((dir) => existsSync(path.join(dir, "_company_index.json")))
  .sort();

const selectedDirs = limit > 0 ? companyDirs.slice(offset, offset + limit) : companyDirs.slice(offset);
const reports: Record<string, unknown>[] = [];
const startedAt = new Date().toISOString();

for (const companyDir of selectedDirs) {
  const index = readCompanyIndex(companyDir);
  const packet = prepareCompany(index, companyDir);
  const companyOut = path.join(outRoot, companyOutputDir(index));
  ensureDir(companyOut);
  ensureDir(path.join(companyOut, "clean"));
  ensureDir(path.join(companyOut, "evidence"));

  writeJson(path.join(companyOut, "evidence", "source_inventory.json"), packet.source_inventory);
  writeJson(path.join(companyOut, "evidence", "extracted_candidates.json"), packet.candidates);
  writeJson(path.join(companyOut, "llm_input.json"), packet);
  writeFileSync(path.join(companyOut, "llm_input.md"), renderLlmInputMarkdown(index, packet));
  writeFileSync(path.join(companyOut, "clean", "first_party_clean.md"), renderCleanSourceMarkdown(index, packet.first_party_sources, "Primary source: scraped content from the company's own site"));
  writeFileSync(path.join(companyOut, "clean", "third_party_clean.md"), renderCleanSourceMarkdown(index, packet.third_party_sources, "Secondary source: scraped content from third-party sites"));
  reports.push({
    company_name: index.company_name,
    domain: index.domain,
    output_dir: companyOut,
    ...packet.quality,
  });
}

const quality = buildQualityReport(reports, selectedDirs.length, companyDirs.length, startedAt);
writeJson(path.join(outRoot, "_quality_report.json"), quality);
writeFileSync(path.join(outRoot, "_quality_report.csv"), renderQualityCsv(reports));
console.log(JSON.stringify({
  run_dir: runDir,
  out_dir: outRoot,
  companies_available: companyDirs.length,
  companies_processed: reports.length,
  quality_report: path.join(outRoot, "_quality_report.json"),
  sample_outputs: reports.slice(0, 5).map((item) => item.output_dir),
  summary: quality.summary,
}, null, 2));

function prepareCompany(index: CompanyIndex, companyDir: string): PreparedPacket {
  const rawPages = index.pages
    .map((page) => parsePage(index, companyDir, page))
    .filter((page): page is ParsedPage => Boolean(page));

  const chromeLines = repeatedChromeLines(rawPages.map((page) => page.raw_body));
  const cleanedPages = rawPages.map((page) => {
    const cleaned = cleanPageText(page.raw_body, chromeLines);
    const scored = scorePage({ ...page, cleaned_text: cleaned, clean_chars: cleaned.length });
    return scored;
  });

  const deduped = dedupePages(cleanedPages);
  const keepable = deduped.filter((page) => page.keep).sort((a, b) => b.score - a.score || a.page_name.localeCompare(b.page_name));
  const kept = trimToBudget(keepable.slice(0, maxPagesPerCompany), maxTotalChars);
  const keptKeys = new Set(kept.map((page) => pageKey(page)));
  const finalPages = deduped.map((page) => keptKeys.has(pageKey(page)) ? page : page.keep ? { ...page, keep: false, drop_reasons: [...page.drop_reasons, "outside_llm_budget"] } : page);
  const finalKept = finalPages.filter((page) => page.keep);
  const dropped = finalPages.filter((page) => !page.keep);

  const candidates = extractCandidates(index, finalKept, rawPages);
  const firstParty = finalKept.filter((page) => page.source_bucket === "first_party").map(toPreparedSource);
  const thirdParty = finalKept.filter((page) => page.source_bucket === "third_party").map(toPreparedSource);
  const rawChars = rawPages.reduce((sum, page) => sum + page.raw_chars, 0);
  const cleanChars = finalKept.reduce((sum, page) => sum + page.clean_chars, 0);

  return {
    entity: entityBlock(index),
    candidates,
    first_party_sources: firstParty,
    third_party_sources: thirdParty,
    dropped_sources: dropped.map((page) => ({
      page_name: page.page_name,
      page_path: page.page_path,
      final_url: page.final_url,
      fetch_status: page.fetch_status,
      http_status: page.http_status,
      raw_chars: page.raw_chars,
      clean_chars: page.clean_chars,
      score: page.score,
      drop_reasons: page.drop_reasons,
      markdown_file: page.markdown_file,
    })),
    source_inventory: finalPages.map((page) => ({
      page_name: page.page_name,
      page_path: page.page_path,
      source_bucket: page.source_bucket,
      source_family: page.source_family,
      requested_url: page.requested_url,
      final_url: page.final_url,
      fetch_status: page.fetch_status,
      http_status: page.http_status,
      raw_chars: page.raw_chars,
      clean_chars: page.clean_chars,
      score: page.score,
      kept_for_llm: page.keep,
      keep_reasons: page.keep_reasons,
      drop_reasons: page.drop_reasons,
      markdown_file: page.markdown_file,
    })),
    quality: {
      raw_pages: rawPages.length,
      kept_pages: finalKept.length,
      dropped_pages: dropped.length,
      raw_chars: rawChars,
      llm_chars: cleanChars,
      reduction_pct: rawChars ? Math.round((1 - cleanChars / rawChars) * 1000) / 10 : 0,
      first_party_kept: firstParty.length,
      third_party_kept: thirdParty.length,
      emails_found: (candidates.emails as string[]).length,
      phones_found: (candidates.phones as string[]).length,
      address_found: Boolean((candidates.address as Record<string, unknown>).full_address),
      postal_code_found: Boolean((candidates.address as Record<string, unknown>).postal_code),
      logo_found: Boolean((candidates.assets as Record<string, unknown>).logo_url),
      drop_reasons: countReasons(dropped.flatMap((page) => page.drop_reasons)),
    },
  };
}

function parsePage(index: CompanyIndex, companyDir: string, page: PageIndex): ParsedPage | null {
  if (!page.markdown_file) return makeSyntheticPage(index, page);
  const filePath = path.join(runDir, page.markdown_file);
  if (!existsSync(filePath)) return makeSyntheticPage(index, page);
  const raw = readFileSync(filePath, "utf8");
  const parsed = splitFrontmatter(raw);
  return {
    ...page,
    frontmatter: parsed.frontmatter,
    raw_markdown: raw,
    raw_body: parsed.body,
    cleaned_text: "",
    raw_chars: raw.length,
    clean_chars: 0,
    content_hash: hashText(parsed.body),
    score: 0,
    keep: true,
    keep_reasons: [],
    drop_reasons: [],
    source_bucket: sourceBucket(parsed.frontmatter.source_type, page.source_family),
  };
}

function makeSyntheticPage(index: CompanyIndex, page: PageIndex): ParsedPage {
  const body = page.got || "";
  return {
    ...page,
    frontmatter: {
      company_name: index.company_name,
      domain: index.domain,
      source_type: page.source_family.includes("third") ? "third_party" : "first_party_external",
    },
    raw_markdown: body,
    raw_body: body,
    cleaned_text: "",
    raw_chars: body.length,
    clean_chars: 0,
    content_hash: hashText(body),
    score: 0,
    keep: true,
    keep_reasons: [],
    drop_reasons: [],
    source_bucket: sourceBucket("first_party_external", page.source_family),
  };
}

function scorePage(page: ParsedPage): ParsedPage {
  const dropReasons: string[] = [];
  const keepReasons: string[] = [];
  let score = 0;
  const pathValue = `${page.page_path} ${page.final_url}`.toLowerCase();
  const textValue = page.cleaned_text.toLowerCase();

  if (page.fetch_status !== "ok" || Number(page.http_status) >= 400) dropReasons.push("fetch_failed_or_error_status");
  if (page.cleaned_text.length < minUsefulChars) dropReasons.push("too_little_useful_text");
  if (/%7b%7b|{{|}}|\[object object\]/i.test(page.final_url + page.page_path)) dropReasons.push("placeholder_or_template_url");
  if (/\.(pdf|zip|gz|tar)(?:$|\?)/i.test(pathValue) || /^%pdf/i.test(page.cleaned_text.trim())) dropReasons.push("binary_or_pdf_not_text_ready");
  if (/\b(account|login|logout|signin|sign-in|register|cart|checkout|basket|password|auth|authentication)\b/.test(pathValue)) dropReasons.push("account_or_commerce_utility_page");
  if (/\b(privacy|terms|cookie|cookies|accessibility|sitemap|site-map|legal|disclaimer)\b/.test(pathValue)) dropReasons.push("legal_or_policy_page");
  if (/\b(search|\?s=|\?q=|filter=|tag=|category=)\b/.test(pathValue)) dropReasons.push("search_or_listing_noise");
  if (/\b404\b|page can.?t be found|page not found|page you are looking for does not|not found template/.test(textValue.slice(0, 1600))) dropReasons.push("not_found_template");
  if (/\bdomain geparkt\b|\bdomain parked\b|domainparking|easyname\.com|domain wird von .* verwaltet/.test(textValue.slice(0, 2200))) dropReasons.push("domain_parking_page");

  if (page.page_path === "/" || page.page_name === "homepage") {
    score += 36;
    keepReasons.push("homepage_identity_signal");
  }
  if (/contact|location|office|address/.test(pathValue)) {
    score += 62;
    keepReasons.push("contact_address_signal");
  }
  if (/about|company|who-we-are|who_we_are|overview|foundation|history|mission/.test(pathValue)) {
    score += 52;
    keepReasons.push("company_profile_signal");
  }
  if (/team|people|leadership|partner|founder|management/.test(pathValue)) {
    score += 42;
    keepReasons.push("team_people_signal");
  }
  if (/portfolio|investments|companies|startups|grants|funding|fund|strategy|approach|thesis|criteria/.test(pathValue)) {
    score += 46;
    keepReasons.push("capital_or_portfolio_signal");
  }
  if (/services|solutions|products|industries|markets|capabilities|sectors/.test(pathValue)) {
    score += 34;
    keepReasons.push("services_capabilities_signal");
  }
  if (/blog|news|press|article|insights|events/.test(pathValue)) {
    score += 8;
    keepReasons.push("news_or_blog_context");
  }

  const factBonus = factSignals(page.cleaned_text);
  score += factBonus.score;
  keepReasons.push(...factBonus.reasons);
  score += Math.min(20, Math.floor(page.cleaned_text.length / 900));

  if (dropReasons.includes("legal_or_policy_page") || dropReasons.includes("account_or_commerce_utility_page")) score -= 70;
  if (dropReasons.includes("binary_or_pdf_not_text_ready") || dropReasons.includes("placeholder_or_template_url")) score -= 90;
  if (dropReasons.includes("fetch_failed_or_error_status") || dropReasons.includes("not_found_template") || dropReasons.includes("domain_parking_page")) score -= 100;
  if (dropReasons.includes("too_little_useful_text")) score -= 25;

  const keep = dropReasons.length === 0 && score > 20;
  return { ...page, score, keep, keep_reasons: unique(keepReasons), drop_reasons: unique(dropReasons) };
}

function repeatedChromeLines(bodies: string[]) {
  const counts = new Map<string, { line: string; count: number }>();
  for (const body of bodies) {
    const seen = new Set<string>();
    for (const line of body.split(/\r?\n/)) {
      const cleaned = normalizeLine(line);
      if (!cleaned || cleaned.length > 180 || isFactLine(cleaned)) continue;
      seen.add(cleaned.toLowerCase());
    }
    for (const key of seen) {
      const current = counts.get(key) ?? { line: key, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
  }
  const threshold = Math.max(2, Math.ceil(bodies.length * 0.45));
  return new Set([...counts.entries()].filter(([, value]) => value.count >= threshold).map(([key]) => key));
}

function cleanPageText(body: string, chromeLines: Set<string>) {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of body.split(/\r?\n/)) {
    let line = normalizeLine(rawLine);
    if (!line) continue;
    if (/^(company|domain|page path|final url):/i.test(line)) continue;
    if (/^#\s+/.test(line) && line.length < 4) continue;
    if (/^(skip to content|menu|close|open menu|shopping cart|your cart|forgot your password|log in|register now|reset your password)$/i.test(line)) continue;
    if (/^(quick links|follow us|follow our socials|all rights reserved|copyright|©|developed by|powered by)/i.test(line)) continue;
    if (/^\[[^\]]{1,45}\]\(https?:\/\/[^)]+\)$/i.test(line) && !isFactLine(line)) continue;
    if (chromeLines.has(line.toLowerCase()) && !isFactLine(line)) continue;
    line = line.replace(/\s{2,}/g, " ").trim();
    const key = line.toLowerCase();
    if (seen.has(key) && !isFactLine(line)) continue;
    seen.add(key);
    output.push(line);
  }
  return clipText(output.join("\n"), maxCharsPerPage);
}

function dedupePages(pages: ParsedPage[]) {
  const byKey = new Map<string, ParsedPage>();
  for (const page of pages) {
    const key = canonicalPageKey(page) || page.content_hash;
    const existing = byKey.get(key);
    if (!existing || page.score > existing.score || (page.clean_chars > existing.clean_chars && page.score >= existing.score - 5)) {
      if (existing) {
        byKey.set(key, { ...page, keep_reasons: unique([...page.keep_reasons, "replaced_duplicate_with_better_copy"]) });
      } else {
        byKey.set(key, page);
      }
    }
  }
  const selected = new Set([...byKey.values()].map(pageKey));
  return pages.map((page) => selected.has(pageKey(page)) ? page : { ...page, keep: false, drop_reasons: unique([...page.drop_reasons, "duplicate_page_or_content"]) });
}

function trimToBudget(pages: ParsedPage[], budget: number) {
  const selected: ParsedPage[] = [];
  let total = 0;
  for (const page of pages) {
    const next = total + page.clean_chars;
    if (selected.length && next > budget) break;
    selected.push(page);
    total = next;
  }
  return selected;
}

function extractCandidates(index: CompanyIndex, keptPages: ParsedPage[], rawPages: ParsedPage[]) {
  const keptText = keptPages.map((page) => page.cleaned_text).join("\n");
  const allText = rawPages.map((page) => page.raw_body).join("\n");
  const keptEmails = extractEmails(keptText);
  const keptPhones = extractPhones(keptText);
  const emails = unique(keptEmails.length ? keptEmails : extractEmails(allText));
  const phones = unique(keptPhones.length ? keptPhones : extractPhones(allText)).slice(0, 8);
  const address = extractAddress(index, keptText || allText);
  const sourceCitations = keptPages.map((page) => ({
    page_name: page.page_name,
    page_path: page.page_path,
    url: page.final_url,
    markdown_file: page.markdown_file,
    score: page.score,
  }));
  return {
    identity: entityBlock(index),
    address,
    emails: emails.slice(0, 10),
    phones,
    assets: {
      logo_url: index.logo_url,
      logo_source: index.logo_source,
      favicon_url: index.favicon_url,
      favicon_source: index.favicon_source,
    },
    likely_profile: inferProfile(index, keptPages),
    source_citations: sourceCitations,
  };
}

function extractAddress(index: CompanyIndex, textValue: string) {
  const postalHints = unique([
    index.postal_code,
    ...[...textValue.matchAll(/\b([A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(?:-\d{4})?)\b/gi)].map((match) => match[1]?.toUpperCase() ?? ""),
  ]).slice(0, 8);
  return {
    raw_full_address: index.full_address || "",
    full_address: index.full_address || "",
    street_address: "",
    city: csvLocationPart(index.full_address, index, "city"),
    state: csvLocationPart(index.full_address, index, "state"),
    postal_code: index.postal_code || postalHints[0] || "",
    postal_code_hints: postalHints,
    country: csvLocationPart(index.full_address, index, "country"),
    evidence_snippets: evidenceSnippets(textValue, /\b(address|headquarters|office|location|phone|email|contact|[A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(?:-\d{4})?)\b/i, 12),
    source: index.address_source || (postalHints.length ? "prepared_text_hints" : ""),
    confidence: index.address_confidence || (index.full_address ? "medium" : postalHints.length ? "low" : "none"),
  };
}

function inferProfile(index: CompanyIndex, pages: ParsedPage[]) {
  const textValue = pages.map((page) => page.cleaned_text).join("\n");
  return {
    company_description_hint: clipText(firstMeaningfulSentence(textValue), 700),
    services_or_focus_terms: unique(extractTerms(textValue)).slice(0, 18),
  };
}

function renderLlmInputMarkdown(index: CompanyIndex, packet: PreparedPacket) {
  const firstParty = packet.first_party_sources.map(renderSourceContentOnly).join("\n\n");
  const thirdParty = packet.third_party_sources.map(renderSourceContentOnly).join("\n\n");
  const fullAddress = fullAddressForPrompt(packet);
  return `# Scraped content for ${index.company_name || index.domain}\n\nCompany: ${index.company_name || ""}\nDomain: ${index.domain || ""}\nFull address: ${fullAddress || ""}\n\n## Primary source: scraped content from the company's own site\nUse this as the primary source.\n\n${firstParty || "No usable company-site content was kept after cleanup."}\n\n## Secondary source: scraped content from third-party sites\nUse this only when the company's own site does not answer something or needs corroboration.\n\n${thirdParty || "No usable third-party content was kept after cleanup."}\n\n## Task\nFill the enriched JSON for this company using the scraped content above. Do not use CSV type/classification labels as truth. If something is not supported by the scraped content, leave it empty or mark it unresolved.\n`;
}

function renderCleanSourceMarkdown(index: CompanyIndex, sources: PreparedSource[], title: string) {
  return `# ${title}\n\nCompany: ${index.company_name}\nDomain: ${index.domain}\n\n${sources.map(renderSourceContentOnly).join("\n\n") || "No usable scraped content was kept after cleanup."}\n`;
}

function renderSourceForPrompt(source: PreparedSource) {
  return `### ${source.page_name}\nSource URL: ${source.final_url}\nPage path: ${source.page_path}\nRaw markdown file: ${source.markdown_file}\nUsefulness score: ${source.score}\nWhy kept: ${source.keep_reasons.join(", ") || "general signal"}\n\nScraped evidence text:\n${source.clean_text}`;
}

function renderSourceContentOnly(source: PreparedSource) {
  return `### ${source.page_name}\n\n${stripUrlsForLlmMarkdown(source.clean_text)}`;
}

function fullAddressForPrompt(packet: PreparedPacket) {
  const candidates = packet.candidates as Record<string, unknown>;
  const address = candidates.address as Record<string, unknown> | undefined;
  return typeof address?.full_address === "string" ? stripUrlsForLlmMarkdown(address.full_address) : "";
}

function stripUrlsForLlmMarkdown(value: string) {
  return value
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:|tel:)[^)]+\)/gi, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b(?:mailto|tel):\S+/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderDroppedSummary(dropped: Array<Record<string, unknown>>) {
  const counts = countReasons(dropped.flatMap((item) => Array.isArray(item.drop_reasons) ? item.drop_reasons as string[] : []));
  return Object.entries(counts).map(([reason, count]) => `- ${reason}: ${count}`).join("\n") || "No sources dropped.";
}

function targetSchema() {
  return {
    company_name: "string",
    legal_name: "string|null",
    domain: "string",
    website_url: "string",
    logo_url: "string|null",
    favicon_url: "string|null",
    description: "string|null",
    investor_type: "string|null",
    industry_primary: "string|null",
    is_capital_source: "boolean|null",
    capital_source_role: "string|null",
    investment_focus: ["string"],
    funding_stage_focus: ["string"],
    portfolio_or_client_examples: ["string"],
    services: ["string"],
    target_customers: ["string"],
    geographies: ["string"],
    full_address: "string|null",
    street_address: "string|null",
    city: "string|null",
    state: "string|null",
    postal_code: "string|null",
    country: "string|null",
    phone_numbers: ["string"],
    emails: ["string"],
    linkedin_url: "string|null",
    founded_year: "string|null",
    confidence_by_field: { field_name: "low|medium|high" },
    evidence_by_field: { field_name: [{ source_url: "string", page_path: "string", quote_or_summary: "string" }] },
    unresolved_fields: ["string"],
  };
}

function buildQualityReport(reports: Record<string, unknown>[], selectedCount: number, availableCount: number, startedAt: string) {
  const sum = (key: string) => reports.reduce((total, item) => total + Number(item[key] ?? 0), 0);
  const reasonCounts: Record<string, number> = {};
  for (const report of reports) {
    const reasons = report.drop_reasons as Record<string, number> | undefined;
    if (!reasons) continue;
    for (const [reason, count] of Object.entries(reasons)) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + count;
  }
  return {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    run_dir: runDir,
    out_dir: outRoot,
    companies_available: availableCount,
    companies_selected: selectedCount,
    summary: {
      companies_processed: reports.length,
      raw_pages: sum("raw_pages"),
      kept_pages: sum("kept_pages"),
      dropped_pages: sum("dropped_pages"),
      raw_chars: sum("raw_chars"),
      llm_chars: sum("llm_chars"),
      reduction_pct: sum("raw_chars") ? Math.round((1 - sum("llm_chars") / sum("raw_chars")) * 1000) / 10 : 0,
      avg_kept_pages: reports.length ? Math.round((sum("kept_pages") / reports.length) * 10) / 10 : 0,
      companies_with_address: sum("address_found"),
      companies_with_postal_code: sum("postal_code_found"),
      companies_with_logo: sum("logo_found"),
      drop_reasons: reasonCounts,
    },
    samples: reports.slice(0, 10),
  };
}

function renderQualityCsv(reports: Record<string, unknown>[]) {
  const headers = ["company_name", "domain", "raw_pages", "kept_pages", "dropped_pages", "raw_chars", "llm_chars", "reduction_pct", "emails_found", "phones_found", "address_found", "postal_code_found", "logo_found", "output_dir"];
  const rows = reports.map((report) => headers.map((header) => csvEscape(report[header])).join(","));
  return `${headers.join(",")}\n${rows.join("\n")}\n`;
}

function toPreparedSource(page: ParsedPage): PreparedSource {
  return {
    page_name: page.page_name,
    page_path: page.page_path,
    source_bucket: page.source_bucket,
    source_family: page.source_family,
    final_url: page.final_url,
    score: page.score,
    keep_reasons: page.keep_reasons,
    clean_text: page.cleaned_text,
    markdown_file: page.markdown_file,
  };
}

function entityBlock(index: CompanyIndex) {
  return {
    source_record_id: index.source_record_id,
    company_name: index.company_name,
    legal_name: index.legal_name,
    domain: index.domain,
    website_url: index.website_url,
    source_context: index.source_context ?? {},
  };
}

function splitFrontmatter(raw: string) {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const block = raw.slice(4, end).trim();
  const body = raw.slice(end + 5).trim();
  const frontmatter: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const rawValue = line.slice(sep + 1).trim();
    frontmatter[key] = parseFrontmatterValue(rawValue);
  }
  return { frontmatter, body };
}

function parseFrontmatterValue(value: string) {
  if (!value) return "";
  try {
    return JSON.parse(value);
  } catch {
    return value.replace(/^['"]|['"]$/g, "");
  }
}

function readCompanyIndex(companyDir: string) {
  return JSON.parse(readFileSync(path.join(companyDir, "_company_index.json"), "utf8")) as CompanyIndex;
}

function sourceBucket(sourceType: unknown, sourceFamily: string): ParsedPage["source_bucket"] {
  const value = `${sourceType ?? ""} ${sourceFamily}`.toLowerCase();
  if (value.includes("third")) return "third_party";
  if (value.includes("first") || value.includes("homepage") || value.includes("nav_link")) return "first_party";
  return "unknown";
}

function factSignals(value: string) {
  const reasons: string[] = [];
  let score = 0;
  if (extractEmails(value).length) { score += 12; reasons.push("email_signal"); }
  if (extractPhones(value).length) { score += 12; reasons.push("phone_signal"); }
  if (/\b\d{5}(?:-\d{4})?\b|\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i.test(value)) { score += 10; reasons.push("postal_code_signal"); }
  if (/\b(founded|established|headquarters|address|office|aum|assets under management|portfolio|invests|investment|venture|private equity|family office|grant|funding|seed|series a|growth equity)\b/i.test(value)) { score += 16; reasons.push("business_or_capital_signal"); }
  return { score, reasons };
}

function normalizeLine(value: string) {
  return value.replace(/\[[^\]]*\]\((mailto:|tel:)([^)]+)\)/gi, "$2").replace(/\s+/g, " ").trim();
}

function isFactLine(value: string) {
  return /@|\b\+?\d[\d\s().-]{7,}\d\b|\b\d{5}(?:-\d{4})?\b|\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b(address|phone|email|founded|headquarters|aum|portfolio|investment|invests|office)\b/i.test(value);
}

function extractEmails(value: string) {
  return [...value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
    .map((match) => match[0].toLowerCase())
    .filter((email) => !/(example\.com|email\.com|email\.con|yourdomain|domain\.com|test\.com)/i.test(email));
}

function extractPhones(value: string) {
  return unique([...value.matchAll(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g)]
    .map((match) => normalizePhone(match[0]))
    .filter(Boolean));
}

function extractTerms(value: string) {
  const terms = ["venture capital", "private equity", "family office", "growth equity", "seed", "series a", "portfolio", "technology", "software", "healthcare", "fintech", "logistics", "real estate", "wealth management", "investment management", "grantmaking", "asset management", "3pl", "sourcing", "licensing"];
  const lower = value.toLowerCase();
  return terms.filter((term) => lower.includes(term));
}

function firstMeaningfulSentence(value: string) {
  return value
    .replace(/^#+\s+/gm, "")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .find((item) => item.length > 80 && !/^home|menu|skip to content|homepage/i.test(item)) ?? "";
}

function clipText(value: string, maxLength: number) {
  const cleaned = value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function extractStreetAddress(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  let fallback = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const street = line.match(/\b\d{1,6}\s+[A-Za-z0-9.'#&\-\s]{2,70}\s(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Place|Pl\.?|Court|Ct\.?|Circle|Cir\.?|Parkway|Pkwy\.?|Highway|Hwy\.?)\b/i)?.[0]?.trim();
    if (!street) continue;
    const next = lines.slice(index + 1, index + 4).filter((candidate) => !/^(email|phone|follow|quick links|company|#{1,6}\s)/i.test(candidate));
    const suite = next.find((candidate) => /^(suite|ste\.?|#)\s/i.test(candidate));
    const cityStateZip = next.find((candidate) => /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b|,\s*[A-Z]{2}\b|\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i.test(candidate));
    const block = [street, suite, cityStateZip].filter(Boolean).join(" ");
    if (cityStateZip || /\b\d{5}(?:-\d{4})?\b|\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i.test(line)) return clipText(block || street, 180);
    fallback ||= street;
  }
  return fallback;
}

function bestFullAddress(index: CompanyIndex, street: string, postalCode: string) {
  if (street && postalCode && new RegExp(`\\b${postalCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(street)) return street;
  if (street && postalCode && index.full_address) {
    const country = index.full_address.includes("United States") ? "United States" : "";
    return clipText([street, postalCode, country].filter(Boolean).join(", "), 260);
  }
  if (street) return street;
  return clipText(index.full_address || "", 400);
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits === "1234567890" || digits === "11234567890") return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return "";
}

function evidenceSnippets(value: string, pattern: RegExp, limit: number) {
  const lines = value.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const snippets: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!pattern.test(lines[index])) continue;
    snippets.push(clipText(lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 3)).join(" / "), 420));
    if (snippets.length >= limit) break;
  }
  return unique(snippets);
}

function firstMatch(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function csvLocationPart(_fullAddress: string, index: CompanyIndex, key: "city" | "state" | "country") {
  if (key === "city") return firstLocationFromAddress(index.full_address) || "";
  if (key === "state") return inferState(index.full_address) || "";
  if (key === "country") return index.full_address?.includes("United States") ? "United States" : "";
  return "";
}

function firstLocationFromAddress(value: string) {
  const match = value.match(/,\s*([^,]+),\s*[^,]+,\s*(?:[A-Z]\d[A-Z]|\d{5})/i);
  return match?.[1]?.trim() ?? "";
}

function inferState(value: string) {
  const match = value.match(/,\s*([A-Z]{2}|[A-Za-z ]{4,30}),\s*(?:[A-Z]\d[A-Z]|\d{5})/i);
  return match?.[1]?.trim() ?? "";
}

function canonicalPageKey(page: ParsedPage) {
  try {
    const parsed = new URL(page.final_url || page.requested_url);
    parsed.hash = "";
    parsed.search = "";
    return `${parsed.hostname.replace(/^www\./, "").toLowerCase()}${parsed.pathname.replace(/\/$/, "") || "/"}`;
  } catch {
    return page.page_path || page.content_hash;
  }
}

function pageKey(page: ParsedPage) {
  return `${page.markdown_file}|${page.final_url}|${page.content_hash}`;
}

function companyOutputDir(index: CompanyIndex) {
  return `${String(index.row_index + 1).padStart(6, "0")}-${slug(index.company_name || index.domain).slice(0, 52)}-${slug(index.domain || index.source_record_id).slice(0, 36)}`;
}

function hashText(value: string) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  return (hash >>> 0).toString(16);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function countReasons(reasons: string[]) {
  return reasons.reduce<Record<string, number>>((acc, reason) => {
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});
}

function renderObject(value: unknown) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return "";
  const textValue = Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
}
