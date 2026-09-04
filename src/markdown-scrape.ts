import http from "node:http";
import https from "node:https";

import { compact, normalizeDomain } from "./shared.js";

export type MarkdownPage = {
  url: string;
  final_url: string;
  status: "ok" | "failed";
  http_status: number;
  content_type: string;
  title: string;
  markdown: string;
  text: string;
  assets: PageAssets;
  links: string[];
  html_chars: number;
  markdown_chars: number;
  error: string;
};

export type PageAssets = {
  favicon_urls: string[];
  logo_urls: string[];
  image_urls: string[];
};

export type MarkdownFetchOptions = {
  timeoutMs?: number;
  maxHtmlChars?: number;
  maxMarkdownChars?: number;
  userAgent?: string;
};

export async function fetchMarkdownPage(url: string, options: MarkdownFetchOptions = {}): Promise<MarkdownPage> {
  const timeoutMs = Math.max(500, options.timeoutMs ?? 8000);
  const maxHtmlChars = Math.max(10_000, options.maxHtmlChars ?? 1_500_000);
  const maxMarkdownChars = Math.max(2_000, options.maxMarkdownChars ?? 220_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": options.userAgent ?? "ai-b2b-company-enrichment/0.1",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2",
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const rawBody = (await response.text()).slice(0, maxHtmlChars);
    const assets = extractPageAssets(rawBody, response.url || url);
    const links = extractPageLinks(rawBody, response.url || url);
    const converted = contentType.includes("pdf")
      ? { title: "", markdown: compact(rawBody, maxMarkdownChars) }
      : htmlToMarkdown(rawBody, response.url || url, maxMarkdownChars);
    return {
      url,
      final_url: response.url || url,
      status: response.ok ? "ok" : "failed",
      http_status: response.status,
      content_type: contentType,
      title: converted.title,
      markdown: converted.markdown,
      text: markdownToText(converted.markdown),
      assets,
      links,
      html_chars: rawBody.length,
      markdown_chars: converted.markdown.length,
      error: response.ok ? "" : `HTTP ${response.status}`,
    };
  } catch (error) {
    const fallback = await tryInsecureTlsFetch(url, options, maxHtmlChars, maxMarkdownChars);
    if (fallback) return fallback;
    return {
      url,
      final_url: url,
      status: "failed",
      http_status: 0,
      content_type: "",
      title: "",
      markdown: "",
      text: "",
      assets: emptyPageAssets(),
      links: [],
      html_chars: 0,
      markdown_chars: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function tryInsecureTlsFetch(url: string, options: MarkdownFetchOptions, maxHtmlChars: number, maxMarkdownChars: number): Promise<MarkdownPage | null> {
  if (!/^https:/i.test(url)) return null;
  try {
    const response = await fetchTextWithInsecureTls(url, {
      timeoutMs: Math.max(500, options.timeoutMs ?? 8000),
      maxHtmlChars,
      userAgent: options.userAgent ?? "ai-b2b-company-enrichment/0.1",
    });
    const assets = extractPageAssets(response.body, response.finalUrl);
    const links = extractPageLinks(response.body, response.finalUrl);
    const converted = response.contentType.includes("pdf")
      ? { title: "", markdown: compact(response.body, maxMarkdownChars) }
      : htmlToMarkdown(response.body, response.finalUrl, maxMarkdownChars);
    return {
      url,
      final_url: response.finalUrl,
      status: response.status >= 200 && response.status < 300 ? "ok" : "failed",
      http_status: response.status,
      content_type: response.contentType,
      title: converted.title,
      markdown: converted.markdown,
      text: markdownToText(converted.markdown),
      assets,
      links,
      html_chars: response.body.length,
      markdown_chars: converted.markdown.length,
      error: response.status >= 200 && response.status < 300 ? "" : `HTTP ${response.status}`,
    };
  } catch {
    return null;
  }
}

function fetchTextWithInsecureTls(url: string, options: { timeoutMs: number; maxHtmlChars: number; userAgent: string }, redirects = 0): Promise<{ finalUrl: string; status: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.request(parsed, {
      method: "GET",
      timeout: options.timeoutMs,
      rejectUnauthorized: false,
      headers: {
        "user-agent": options.userAgent,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2",
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (location && status >= 300 && status < 400 && redirects < 5) {
        response.resume();
        fetchTextWithInsecureTls(new URL(location, url).toString(), options, redirects + 1).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        if (total >= options.maxHtmlChars) return;
        const next = chunk.slice(0, Math.max(0, options.maxHtmlChars - total));
        total += next.length;
        chunks.push(next);
      });
      response.on("end", () => {
        resolve({
          finalUrl: url,
          status,
          contentType: String(response.headers["content-type"] ?? ""),
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end();
  });
}

export function extractPageLinks(html: string, sourceUrl = "") {
  const links: string[] = [];
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = firstCapture(tag, /\bhref=["']([^"']+)["']/i);
    if (!href || /^#|^javascript:/i.test(href)) continue;
    const resolved = resolveHref(href, sourceUrl);
    if (!resolved) continue;
    try {
      const parsed = new URL(resolved);
      if (!/^https?:$/.test(parsed.protocol)) continue;
      parsed.hash = "";
      links.push(parsed.toString());
    } catch {
      continue;
    }
  }
  return unique(links);
}

export function extractPageAssets(html: string, sourceUrl = ""): PageAssets {
  const faviconUrls: string[] = [];
  const logoUrls: string[] = [];
  const imageUrls: string[] = [];

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = firstCapture(tag, /\brel=["']([^"']+)["']/i).toLowerCase();
    const href = firstCapture(tag, /\bhref=["']([^"']+)["']/i);
    if (!href || !/(icon|mask-icon|apple-touch-icon)/i.test(rel)) continue;
    const resolved = resolveHref(href, sourceUrl);
    if (resolved) faviconUrls.push(resolved);
  }

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const property = `${firstCapture(tag, /\bproperty=["']([^"']+)["']/i)} ${firstCapture(tag, /\bname=["']([^"']+)["']/i)}`.toLowerCase();
    const content = firstCapture(tag, /\bcontent=["']([^"']+)["']/i);
    if (!content || !/(og:image|twitter:image|image)/i.test(property)) continue;
    const resolved = resolveHref(content, sourceUrl);
    if (resolved) {
      imageUrls.push(resolved);
      logoUrls.push(resolved);
    }
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = firstCapture(tag, /\bsrc=["']([^"']+)["']/i) || firstCapture(tag, /\bdata-src=["']([^"']+)["']/i);
    if (!src) continue;
    const resolved = resolveHref(src, sourceUrl);
    if (!resolved) continue;
    imageUrls.push(resolved);
    const label = `${firstCapture(tag, /\balt=["']([^"']+)["']/i)} ${firstCapture(tag, /\bclass=["']([^"']+)["']/i)} ${firstCapture(tag, /\bid=["']([^"']+)["']/i)} ${src}`.toLowerCase();
    if (/\blogo\b|brand|mark/.test(label)) logoUrls.push(resolved);
  }

  const origin = originUrl(sourceUrl);
  if (origin) faviconUrls.push(`${origin}/favicon.ico`);

  return {
    favicon_urls: unique(faviconUrls).slice(0, 12),
    logo_urls: unique(logoUrls).slice(0, 12),
    image_urls: unique(imageUrls).slice(0, 24),
  };
}

export function htmlToMarkdown(html: string, sourceUrl = "", maxChars = 220_000) {
  const title = decodeEntities(firstCapture(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  body = body.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_full, attrs, label) => {
    const text = stripTags(label);
    const href = firstCapture(attrs, /\bhref=["']([^"']+)["']/i);
    if (!text) return "";
    if (!href || /^#|^javascript:/i.test(href)) return text;
    const resolved = resolveHref(href, sourceUrl);
    return resolved ? `[${escapeMarkdownInline(text)}](${resolved})` : text;
  });

  body = body
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_full, value) => `\n# ${stripTags(value)}\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_full, value) => `\n## ${stripTags(value)}\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_full, value) => `\n### ${stripTags(value)}\n`)
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_full, value) => `\n#### ${stripTags(value)}\n`)
    .replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, (_full, value) => `\n##### ${stripTags(value)}\n`)
    .replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, (_full, value) => `\n###### ${stripTags(value)}\n`)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<t[dh]\b[^>]*>/gi, " | ")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<\/tr>/gi, " |\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|aside|header|footer|nav|ul|ol|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const markdown = normalizeMarkdown(decodeEntities(body), maxChars);
  return {
    title,
    markdown: title && !markdown.toLowerCase().includes(title.toLowerCase())
      ? normalizeMarkdown(`# ${title}\n\n${markdown}`, maxChars)
      : markdown,
  };
}

export function markdownToText(markdown: string) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/[|`*_>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractMarkdownStructure(markdown: string) {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    headings: unique(lines.filter((line) => /^#{1,6}\s+/.test(line)).map((line) => line.replace(/^#{1,6}\s+/, "")).slice(0, 30)),
    key_value_lines: unique(lines.filter((line) => isKeyValueLine(line)).slice(0, 60)),
    table_like_lines: unique(lines.filter((line) => line.includes("|") && line.split("|").length >= 3).slice(0, 40)),
    link_count: (markdown.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length,
    sample_lines: lines.slice(0, 80),
  };
}

export function sameDomainUrl(url: string, baseDomain: string) {
  try {
    const parsed = new URL(url);
    return normalizeDomain(parsed.hostname) === normalizeDomain(baseDomain);
  } catch {
    return false;
  }
}

function normalizeMarkdown(value: string, maxChars: number) {
  const markdown = value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  return markdown.length <= maxChars ? markdown : `${markdown.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function isKeyValueLine(line: string) {
  if (/^[-*]\s+/.test(line)) return /:|\b(AUM|Asset Class|Investor Type|Founded|Headquarters|Location|Strategy|Geography|Sector|CRD|SEC|Fund|Commitment)\b/i.test(line);
  return /^(AUM|Assets under management|Asset classes?|Investor type|Institution type|Firm type|Founded|Headquarters|Location|Strategy|Strategies|Geograph(?:y|ies)|Sectors?|CRD|SEC|Known fund commitments?|Fund commitments?|Office|Website|Email|Phone)\b\s*[:|-]/i.test(line);
}

function resolveHref(href: string, sourceUrl: string) {
  try {
    return new URL(href, sourceUrl || "https://example.com").toString();
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

function stripTags(value: string) {
  return decodeEntities(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function firstCapture(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function escapeMarkdownInline(value: string) {
  return value.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&mdash;|&ndash;/gi, "-")
    .replace(/&#(\d+);/g, (_match, code) => {
      const valueCode = Number(code);
      return Number.isFinite(valueCode) ? String.fromCharCode(valueCode) : "";
    });
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function emptyPageAssets(): PageAssets {
  return {
    favicon_urls: [],
    logo_urls: [],
    image_urls: [],
  };
}
