/**
 * AI Friendly — Worker (Multi-task orchestrator v3.0)
 *
 * 3 parallel loops:
 * 1. AI Analysis — checks every 5 min, runs based on site frequency
 * 2. Availability Check — runs every 1 min for all active sites
 * 3. Security Scan — runs every 1 hour for all active sites
 *
 * Also handles 60-day data retention cleanup.
 */

import { PrismaClient } from "@prisma/client";
import * as cheerio from "cheerio";

const prisma = new PrismaClient();

const AI_CHECK_INTERVAL_MS = 5 * 60 * 1000;       // 5 minutes
const AVAILABILITY_INTERVAL_MS = 60 * 1000;        // 1 minute
const SECURITY_INTERVAL_MS = 60 * 60 * 1000;       // 1 hour
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;        // 1 hour
const RETENTION_DAYS = 60;
const FETCH_TIMEOUT_MS = 15000;
const AVAILABILITY_TIMEOUT_MS = 30000;
const SECURITY_TIMEOUT_MS = 60000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;

const AI_BOT_AGENTS = [
  "GPTBot", "ChatGPT-User", "Google-Extended", "CCBot",
  "anthropic-ai", "Claude-Web", "PerplexityBot", "Bytespider",
  "Amazonbot", "FacebookBot", "Applebot-Extended",
];

// ═══════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════

function getFrequencyMs(frequency: string): number {
  switch (frequency) {
    case "6h": return 6 * 60 * 60 * 1000;
    case "daily": return 24 * 60 * 60 * 1000;
    case "weekly": return 7 * 24 * 60 * 60 * 1000;
    case "monthly": return 30 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

async function fetchTextFile(baseUrl: string, path: string): Promise<string | null> {
  try {
    const fileUrl = new URL(path, baseUrl).href;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(fileUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "AIFriendly/1.0 (Worker)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.text()).slice(0, 50000);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

function escapeYaml(s: string): string {
  if (/[\n"\\]/.test(s)) return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  return s;
}

// ═══════════════════════════════════════════════════════════════
// LOOP 1: AI ANALYSIS
// ═══════════════════════════════════════════════════════════════

interface Improvement {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  category: string;
  suggestion?: string;
}

async function analyzeUrl(targetUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "AIFriendly/1.0 (Worker; +https://aifriendly.fr)" },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html") && !ct.includes("application/xhtml")) throw new Error("Not HTML");

  const rawHtml = await res.text();
  if (rawHtml.length > MAX_HTML_BYTES) throw new Error("Page too large");

  const $ = cheerio.load(rawHtml);
  const baseUrl = new URL(targetUrl).origin;

  const [robotsTxt, llmsTxt] = await Promise.all([
    fetchTextFile(baseUrl, "/robots.txt"),
    fetchTextFile(baseUrl, "/llms.txt"),
  ]);

  const robotsExists = !!robotsTxt;
  const blocksAI: string[] = [];
  if (robotsTxt) {
    const lines = robotsTxt.toLowerCase().split("\n");
    let ua = "";
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("user-agent:")) ua = t.replace("user-agent:", "").trim();
      if (t.startsWith("disallow:") && t.includes("/")) {
        for (const bot of AI_BOT_AGENTS) {
          if (ua === bot.toLowerCase() && !blocksAI.includes(bot)) blocksAI.push(bot);
        }
      }
    }
  }

  let sitemapExists = false;
  for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
    const content = await fetchTextFile(baseUrl, path);
    if (content && (content.includes("<urlset") || content.includes("<sitemapindex"))) {
      sitemapExists = true;
      break;
    }
  }

  const llmsExists = !!(llmsTxt && llmsTxt.length > 10);
  const improvements: Improvement[] = [];
  let score = 10;

  const title = $("title").first().text().trim() || $('meta[property="og:title"]').attr("content")?.trim() || null;
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() || null;
  const lang = $("html").attr("lang") || null;
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim() || null;
  const ogType = $('meta[property="og:type"]').attr("content")?.trim() || null;

  if (!title || title.length < 10) { score -= 1.5; improvements.push({ id: "title", title: "Titre de page manquant ou trop court", description: "Un titre explicite aide les IA.", severity: "critical", category: "Métadonnées" }); }
  if (!metaDesc || metaDesc.length < 50) { score -= 1; improvements.push({ id: "meta-description", title: "Meta description absente ou trop courte", description: "La meta description est utilisée comme résumé.", severity: metaDesc ? "warning" : "critical", category: "Métadonnées" }); }

  const headings: { level: number; text: string }[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = parseInt(el.tagName[1], 10);
    const text = $(el).text().trim();
    if (text) headings.push({ level, text });
  });
  if (headings.filter((h) => h.level === 1).length === 0) { score -= 1; improvements.push({ id: "h1", title: "Aucun titre H1", description: "Un seul H1 par page.", severity: "critical", category: "Structure" }); }

  const mainContent = $("main").text().trim() || $("article").first().text().trim() || $("body").text().trim();
  const mainClean = mainContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
  if (mainClean.length < 100) { score -= 0.5; improvements.push({ id: "content", title: "Peu de contenu texte", description: "Les IA s'appuient sur le texte.", severity: "warning", category: "Contenu" }); }

  let imgNoAlt = 0;
  $("img").each((_, el) => { if ($(el).attr("src") && !$(el).attr("alt")?.trim()) imgNoAlt++; });
  if (imgNoAlt > 0) { score -= Math.min(0.5, imgNoAlt * 0.2); improvements.push({ id: "alt", title: `Images sans alt (${imgNoAlt})`, description: "L'attribut alt est important.", severity: imgNoAlt > 3 ? "warning" : "info", category: "Images" }); }

  if (!lang) { score -= 0.3; improvements.push({ id: "lang", title: "Langue non indiquée", description: "L'attribut lang aide l'interprétation.", severity: "info", category: "Métadonnées" }); }
  if (!robotsExists) { score -= 0.3; improvements.push({ id: "robots-txt", title: "robots.txt absent", description: "Guide les crawlers.", severity: "warning", category: "Accessibilité Bots" }); }
  else if (blocksAI.length > 0) { score -= 0.5; improvements.push({ id: "robots-blocks-ai", title: `Crawlers IA bloqués`, description: `Bloqués: ${blocksAI.join(", ")}`, severity: "warning", category: "Accessibilité Bots" }); }
  if (!sitemapExists) { score -= 0.3; improvements.push({ id: "sitemap", title: "Sitemap XML absent", description: "Aide à l'indexation.", severity: "warning", category: "Accessibilité Bots" }); }
  if (llmsExists) score += 0.2;

  const metaRobots = $('meta[name="robots"]').attr("content")?.toLowerCase() || "";
  if (metaRobots.includes("noindex")) { score -= 1; improvements.push({ id: "noindex", title: "Page noindex", description: "Non indexable.", severity: "critical", category: "Accessibilité Bots" }); }

  const semanticCount = [$("nav").length, $("header").length, $("footer").length, $("main").length, $("article").length, $("section").length].filter(n => n > 0).length;
  if (semanticCount < 3) { score -= 0.5; improvements.push({ id: "semantic-html", title: "Peu de HTML sémantique", description: "Utilisez nav, header, main, etc.", severity: "warning", category: "Structure" }); }

  const h1Count = headings.filter(h => h.level === 1).length;
  if (h1Count > 1) { score -= 0.3; improvements.push({ id: "multiple-h1", title: `${h1Count} H1 détectés`, description: "Un seul H1 recommandé.", severity: "warning", category: "Structure" }); }

  const missingOg: string[] = [];
  if (!ogImage) missingOg.push("og:image");
  if (!ogType) missingOg.push("og:type");
  if (missingOg.length > 0) { score -= Math.min(0.5, missingOg.length * 0.15); improvements.push({ id: "open-graph", title: `OG manquants: ${missingOg.join(", ")}`, description: "Améliore le partage.", severity: "info", category: "Métadonnées" }); }

  const hasStructuredData = $('script[type="application/ld+json"]').length > 0;

  const yaml: string[] = ["# Aperçu IA", "", `url: ${escapeYaml(targetUrl)}`];
  yaml.push(`title: ${title ? escapeYaml(title) : "null"}`);
  yaml.push(`description: ${metaDesc ? escapeYaml(metaDesc.slice(0, 200)) : "null"}`);
  yaml.push(`lang: ${lang || "null"}`);
  yaml.push(`score: ${Math.max(0, Math.min(10, Math.round(score * 10) / 10))}/10`);
  yaml.push(`structuredData: ${hasStructuredData}`);
  yaml.push(`robotsTxt: ${robotsExists}`);
  yaml.push(`sitemap: ${sitemapExists}`);
  yaml.push(`llmsTxt: ${llmsExists}`);

  const finalScore = Math.max(0, Math.min(10, Math.round(score * 10) / 10));

  return {
    score: finalScore,
    maxScore: 10,
    details: {
      improvements,
      aiPreviewYaml: yaml.join("\n"),
      botAccess: {
        robotsTxt: { exists: robotsExists, blocksAI },
        sitemap: { exists: sitemapExists },
        llmsTxt: { exists: llmsExists },
        metaRobots: { noindex: metaRobots.includes("noindex"), nofollow: metaRobots.includes("nofollow"), nosnippet: metaRobots.includes("nosnippet"), noai: metaRobots.includes("noai") },
      },
      analyzedAt: new Date().toISOString(),
    },
  };
}

async function processAIAnalysis() {
  const now = new Date();
  console.log(`[${now.toISOString()}] [AI] Checking sites for scheduled analysis...`);

  const sites = await prisma.site.findMany({
    where: { isActive: true },
    include: {
      analyses: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  let analyzed = 0;
  for (const site of sites) {
    const lastAnalysis = site.analyses[0]?.createdAt;
    const frequencyMs = getFrequencyMs(site.frequency);
    const isDue = !lastAnalysis || (now.getTime() - lastAnalysis.getTime() > frequencyMs);

    if (!isDue) continue;

    console.log(`  [AI] Analyzing: ${site.name} (${site.url})`);
    try {
      const result = await analyzeUrl(site.url);
      await prisma.analysisResult.create({
        data: {
          siteId: site.id,
          score: result.score,
          maxScore: result.maxScore,
          details: JSON.parse(JSON.stringify(result.details)),
        },
      });
      analyzed++;
      console.log(`    -> AI Score: ${result.score}/10`);
    } catch (err) {
      console.error(`    -> AI Error: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`  [AI] Done. Analyzed ${analyzed}/${sites.length} sites.`);
}

// ═══════════════════════════════════════════════════════════════
// LOOP 2: AVAILABILITY CHECKS
// ═══════════════════════════════════════════════════════════════

async function checkAvailability(targetUrl: string) {
  let score = 10;
  let httpStatus: number | null = null;
  let pingMs: number | null = null;
  let ttfbMs: number | null = null;
  let loadTimeMs: number | null = null;
  let responseSize: number | null = null;
  let sslValid: boolean | null = null;

  interface CheckItem { id: string; name: string; value: string; status: string; deduction: number; }
  const checks: CheckItem[] = [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT_MS);

  try {
    // Ping (HEAD request)
    const pingStart = performance.now();
    try {
      await fetch(targetUrl, {
        method: "HEAD", signal: controller.signal, redirect: "follow",
        headers: { "User-Agent": "AIFriendly/1.0 (AvailabilityCheck)" },
      });
      pingMs = Math.round(performance.now() - pingStart);
    } catch {
      clearTimeout(timeout);
      return {
        score: 0, httpStatus: null, pingMs: null, ttfbMs: null, loadTimeMs: null,
        responseSize: null, sslValid: null, sslExpiry: null as string | null,
        details: { checks: [{ id: "unreachable", name: "Accessibilité", value: "Site inaccessible", status: "fail", deduction: 10 }], timestamp: new Date().toISOString() },
      };
    }

    // Full GET
    const loadStart = performance.now();
    try {
      const fullRes = await fetch(targetUrl, {
        method: "GET", signal: controller.signal, redirect: "follow",
        headers: { "User-Agent": "AIFriendly/1.0 (AvailabilityCheck)" },
      });
      ttfbMs = Math.round(performance.now() - loadStart);
      httpStatus = fullRes.status;
      const body = await fullRes.text();
      loadTimeMs = Math.round(performance.now() - loadStart);
      responseSize = new TextEncoder().encode(body).length;
    } catch {
      clearTimeout(timeout);
      return {
        score: 0, httpStatus: null, pingMs, ttfbMs: null, loadTimeMs: null,
        responseSize: null, sslValid: null, sslExpiry: null as string | null,
        details: { checks: [{ id: "load-fail", name: "Chargement", value: "Échec du chargement", status: "fail", deduction: 10 }], timestamp: new Date().toISOString() },
      };
    }

    // SSL
    if (targetUrl.startsWith("https://")) {
      sslValid = true;
      checks.push({ id: "ssl-valid", name: "SSL", value: "Valide", status: "pass", deduction: 0 });
    } else {
      sslValid = false;
      score -= 1;
      checks.push({ id: "no-https", name: "HTTPS", value: "Non HTTPS", status: "warning", deduction: 1 });
    }

    // HTTP status scoring
    if (httpStatus === 200) {
      checks.push({ id: "http-status", name: "HTTP", value: `${httpStatus}`, status: "pass", deduction: 0 });
    } else if (httpStatus >= 300 && httpStatus < 400) {
      score -= 1; checks.push({ id: "http-status", name: "HTTP", value: `${httpStatus}`, status: "warning", deduction: 1 });
    } else if (httpStatus >= 400 && httpStatus < 500) {
      score -= 2; checks.push({ id: "http-status", name: "HTTP", value: `${httpStatus}`, status: "fail", deduction: 2 });
    } else if (httpStatus >= 500) {
      score -= 3; checks.push({ id: "http-status", name: "HTTP", value: `${httpStatus}`, status: "fail", deduction: 3 });
    }

    // Ping scoring
    if (pingMs !== null) {
      if (pingMs > 500) { score -= 3; checks.push({ id: "ping", name: "Ping", value: `${pingMs}ms`, status: "fail", deduction: 3 }); }
      else if (pingMs > 200) { score -= 1.5; checks.push({ id: "ping", name: "Ping", value: `${pingMs}ms`, status: "warning", deduction: 1.5 }); }
      else if (pingMs > 100) { score -= 0.5; checks.push({ id: "ping", name: "Ping", value: `${pingMs}ms`, status: "warning", deduction: 0.5 }); }
      else { checks.push({ id: "ping", name: "Ping", value: `${pingMs}ms`, status: "pass", deduction: 0 }); }
    }

    // Load time scoring
    if (loadTimeMs !== null) {
      if (loadTimeMs > 10000) { score -= 3; checks.push({ id: "load-time", name: "Chargement", value: `${(loadTimeMs / 1000).toFixed(1)}s`, status: "fail", deduction: 3 }); }
      else if (loadTimeMs > 5000) { score -= 2; checks.push({ id: "load-time", name: "Chargement", value: `${(loadTimeMs / 1000).toFixed(1)}s`, status: "warning", deduction: 2 }); }
      else if (loadTimeMs > 2000) { score -= 1; checks.push({ id: "load-time", name: "Chargement", value: `${(loadTimeMs / 1000).toFixed(1)}s`, status: "warning", deduction: 1 }); }
      else if (loadTimeMs > 1000) { score -= 0.5; checks.push({ id: "load-time", name: "Chargement", value: `${(loadTimeMs / 1000).toFixed(1)}s`, status: "pass", deduction: 0.5 }); }
      else { checks.push({ id: "load-time", name: "Chargement", value: `${loadTimeMs}ms`, status: "pass", deduction: 0 }); }
    }

    // TTFB info
    if (ttfbMs !== null) {
      checks.push({ id: "ttfb", name: "TTFB", value: `${ttfbMs}ms`, status: ttfbMs > 3000 ? "fail" : ttfbMs > 1000 ? "warning" : "pass", deduction: 0 });
    }

    // Response size info
    if (responseSize !== null) {
      checks.push({ id: "response-size", name: "Taille", value: `${(responseSize / 1024).toFixed(1)} Ko`, status: "pass", deduction: 0 });
    }
  } finally {
    clearTimeout(timeout);
  }

  return {
    score: Math.max(0, Math.min(10, Math.round(score * 10) / 10)),
    httpStatus, pingMs, ttfbMs, loadTimeMs, responseSize, sslValid, sslExpiry: null as string | null,
    details: { checks, timestamp: new Date().toISOString() },
  };
}

async function processAvailabilityChecks() {
  const now = new Date();
  console.log(`[${now.toISOString()}] [AVAIL] Running availability checks...`);

  const sites = await prisma.site.findMany({
    where: { isActive: true, availabilityEnabled: true },
  });

  let checked = 0;
  for (const site of sites) {
    try {
      const result = await checkAvailability(site.url);
      await prisma.availabilityCheck.create({
        data: {
          siteId: site.id,
          score: result.score,
          httpStatus: result.httpStatus,
          pingMs: result.pingMs,
          ttfbMs: result.ttfbMs,
          loadTimeMs: result.loadTimeMs,
          responseSize: result.responseSize,
          sslValid: result.sslValid,
          sslExpiry: result.sslExpiry ? new Date(result.sslExpiry) : null,
          details: JSON.parse(JSON.stringify(result.details)),
        },
      });
      checked++;
    } catch (err) {
      console.error(`  [AVAIL] Error checking ${site.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`  [AVAIL] Done. Checked ${checked}/${sites.length} sites.`);
}

// ═══════════════════════════════════════════════════════════════
// LOOP 3: SECURITY SCANS
// ═══════════════════════════════════════════════════════════════

async function scanSecurity(targetUrl: string) {
  let headersScore = 10;
  let sslScore = 10;
  let cookiesScore = 10;
  let infoLeakScore = 10;
  let injectionScore = 10;

  interface TestItem { id: string; name: string; category: string; status: string; severity: string; value: string; recommendation?: string; deduction: number; }
  const tests: TestItem[] = [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SECURITY_TIMEOUT_MS);

  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal, redirect: "follow",
      headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" },
    });

    const headers = res.headers;
    const html = await res.text();
    const $ = cheerio.load(html);
    const baseUrl = new URL(targetUrl).origin;

    // === HEADERS ===
    if (!headers.get("content-security-policy")) { headersScore -= 1.5; tests.push({ id: "csp-missing", name: "CSP", category: "headers", status: "fail", severity: "critical", value: "Absent", recommendation: "Ajoutez Content-Security-Policy.", deduction: 1.5 }); }
    else { tests.push({ id: "csp-ok", name: "CSP", category: "headers", status: "pass", severity: "info", value: "Présent", deduction: 0 }); }

    if (!headers.get("x-frame-options")) { headersScore -= 1; tests.push({ id: "xfo-missing", name: "X-Frame-Options", category: "headers", status: "fail", severity: "critical", value: "Absent", recommendation: "Ajoutez X-Frame-Options: DENY.", deduction: 1 }); }
    else { tests.push({ id: "xfo-ok", name: "X-Frame-Options", category: "headers", status: "pass", severity: "info", value: headers.get("x-frame-options")!, deduction: 0 }); }

    if (headers.get("x-content-type-options") !== "nosniff") { headersScore -= 0.5; tests.push({ id: "xcto-missing", name: "X-Content-Type-Options", category: "headers", status: "warning", severity: "warning", value: headers.get("x-content-type-options") || "Absent", recommendation: "Ajoutez X-Content-Type-Options: nosniff.", deduction: 0.5 }); }
    else { tests.push({ id: "xcto-ok", name: "X-Content-Type-Options", category: "headers", status: "pass", severity: "info", value: "nosniff", deduction: 0 }); }

    const hsts = headers.get("strict-transport-security");
    if (!hsts) { headersScore -= 1; tests.push({ id: "hsts-missing", name: "HSTS", category: "headers", status: "fail", severity: "critical", value: "Absent", recommendation: "Ajoutez Strict-Transport-Security.", deduction: 1 }); }
    else {
      const maxAge = parseInt(hsts.match(/max-age=(\d+)/)?.[1] || "0");
      if (maxAge < 15768000) { headersScore -= 0.5; tests.push({ id: "hsts-short", name: "HSTS", category: "headers", status: "warning", severity: "warning", value: `max-age=${maxAge}`, deduction: 0.5 }); }
      else { tests.push({ id: "hsts-ok", name: "HSTS", category: "headers", status: "pass", severity: "info", value: hsts, deduction: 0 }); }
    }

    if (!headers.get("x-xss-protection")) { headersScore -= 0.3; tests.push({ id: "xxss-missing", name: "X-XSS-Protection", category: "headers", status: "warning", severity: "warning", value: "Absent", deduction: 0.3 }); }
    if (!headers.get("referrer-policy")) { headersScore -= 0.3; tests.push({ id: "referrer-missing", name: "Referrer-Policy", category: "headers", status: "warning", severity: "info", value: "Absent", deduction: 0.3 }); }
    if (!headers.get("permissions-policy")) { headersScore -= 0.3; tests.push({ id: "permissions-missing", name: "Permissions-Policy", category: "headers", status: "warning", severity: "info", value: "Absent", deduction: 0.3 }); }

    // === SSL ===
    if (targetUrl.startsWith("https://")) {
      tests.push({ id: "ssl-https", name: "HTTPS", category: "ssl", status: "pass", severity: "info", value: "Oui", deduction: 0 });
      const httpRes = await fetchWithTimeout(targetUrl.replace("https://", "http://"), { redirect: "manual", headers: { "User-Agent": "AIFriendly/1.0" } });
      if (httpRes) {
        const loc = httpRes.headers.get("location") || "";
        if (!(httpRes.status >= 300 && httpRes.status < 400 && loc.startsWith("https://"))) {
          sslScore -= 1; tests.push({ id: "http-no-redirect", name: "HTTP→HTTPS redirect", category: "ssl", status: "warning", severity: "warning", value: "Pas de redirection", deduction: 1 });
        }
      }
    } else {
      sslScore -= 2; tests.push({ id: "no-https", name: "HTTPS", category: "ssl", status: "fail", severity: "critical", value: "Non", recommendation: "Migrez vers HTTPS.", deduction: 2 });
    }

    // === INFO LEAKS ===
    if (headers.get("server")) { infoLeakScore -= 0.3; tests.push({ id: "server-exposed", name: "Server header", category: "info_leak", status: "warning", severity: "info", value: headers.get("server")!, deduction: 0.3 }); }
    if (headers.get("x-powered-by")) { infoLeakScore -= 0.5; tests.push({ id: "powered-by", name: "X-Powered-By", category: "info_leak", status: "warning", severity: "warning", value: headers.get("x-powered-by")!, recommendation: "Supprimez X-Powered-By.", deduction: 0.5 }); }

    const sensitiveFiles = ["/.env", "/.git/HEAD", "/wp-config.php"];
    for (const path of sensitiveFiles) {
      const fileRes = await fetchWithTimeout(new URL(path, baseUrl).href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 5000);
      if (fileRes && fileRes.status === 200) {
        const ct = fileRes.headers.get("content-type") || "";
        if (!ct.includes("text/html")) {
          infoLeakScore -= 2;
          tests.push({ id: `sensitive-${path}`, name: `Fichier sensible: ${path}`, category: "info_leak", status: "fail", severity: "critical", value: "Accessible", recommendation: `Bloquez l'accès à ${path}.`, deduction: 2 });
        }
      }
    }

    // === COOKIES ===
    const setCookies = res.headers.getSetCookie?.() || [];
    if (setCookies.length > 0) {
      let insecure = false, noHttpOnly = false, noSameSite = false;
      for (const c of setCookies) {
        const l = c.toLowerCase();
        if (!l.includes("secure")) insecure = true;
        if (!l.includes("httponly")) noHttpOnly = true;
        if (!l.includes("samesite")) noSameSite = true;
      }
      if (insecure) { cookiesScore -= 1; tests.push({ id: "cookie-insecure", name: "Cookie Secure", category: "cookies", status: "fail", severity: "critical", value: "Absent", deduction: 1 }); }
      if (noHttpOnly) { cookiesScore -= 0.5; tests.push({ id: "cookie-httponly", name: "Cookie HttpOnly", category: "cookies", status: "warning", severity: "warning", value: "Absent", deduction: 0.5 }); }
      if (noSameSite) { cookiesScore -= 0.5; tests.push({ id: "cookie-samesite", name: "Cookie SameSite", category: "cookies", status: "warning", severity: "warning", value: "Absent", deduction: 0.5 }); }
    }

    // === INJECTION ===
    const forms = $("form");
    if (forms.length > 0) {
      let noCSRF = 0;
      forms.each((_, form) => {
        const $f = $(form);
        if ($f.attr("method")?.toLowerCase() === "post" && $f.find('input[name*="csrf"], input[name*="token"], input[name*="_token"]').length === 0) noCSRF++;
      });
      if (noCSRF > 0) { injectionScore -= 1; tests.push({ id: "no-csrf", name: "CSRF", category: "injection", status: "fail", severity: "critical", value: `${noCSRF} form(s) sans CSRF`, deduction: 1 }); }
    }

    const xssUrl = new URL(targetUrl);
    const canary = "aifriendly_probe_12345";
    xssUrl.searchParams.set("q", canary);
    const xssRes = await fetchWithTimeout(xssUrl.href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 10000);
    if (xssRes) {
      const xssBody = await xssRes.text();
      if (xssBody.includes(canary)) { injectionScore -= 1.5; tests.push({ id: "reflected", name: "XSS réfléchi", category: "injection", status: "fail", severity: "critical", value: "Entrée réfléchie détectée", deduction: 1.5 }); }
    }

  } catch (err) {
    clearTimeout(timeout);
    return {
      score: 0, headersScore: 0, sslScore: 0, cookiesScore: 0, infoLeakScore: 0, injectionScore: 0,
      details: { tests: [{ id: "error", name: "Erreur", category: "headers", status: "fail", severity: "critical", value: err instanceof Error ? err.message : "Erreur", deduction: 10 }], recommendations: [], timestamp: new Date().toISOString() },
    };
  } finally {
    clearTimeout(timeout);
  }

  headersScore = Math.max(0, Math.min(10, Math.round(headersScore * 10) / 10));
  sslScore = Math.max(0, Math.min(10, Math.round(sslScore * 10) / 10));
  cookiesScore = Math.max(0, Math.min(10, Math.round(cookiesScore * 10) / 10));
  infoLeakScore = Math.max(0, Math.min(10, Math.round(infoLeakScore * 10) / 10));
  injectionScore = Math.max(0, Math.min(10, Math.round(injectionScore * 10) / 10));

  const overallScore = Math.max(0, Math.min(10, Math.round(
    (headersScore * 0.25 + sslScore * 0.25 + cookiesScore * 0.15 + infoLeakScore * 0.15 + injectionScore * 0.20) * 10
  ) / 10));

  const recommendations = tests.filter(t => t.recommendation).map(t => ({ severity: t.severity, text: t.recommendation! }));

  return {
    score: overallScore, headersScore, sslScore, cookiesScore, infoLeakScore, injectionScore,
    details: { tests, recommendations, timestamp: new Date().toISOString() },
  };
}

async function processSecurityScans() {
  const now = new Date();
  console.log(`[${now.toISOString()}] [SEC] Running security scans...`);

  const sites = await prisma.site.findMany({
    where: { isActive: true, securityEnabled: true },
  });

  let scanned = 0;
  for (const site of sites) {
    console.log(`  [SEC] Scanning: ${site.name} (${site.url})`);
    try {
      const result = await scanSecurity(site.url);
      await prisma.securityScan.create({
        data: {
          siteId: site.id,
          score: result.score,
          headersScore: result.headersScore,
          sslScore: result.sslScore,
          cookiesScore: result.cookiesScore,
          infoLeakScore: result.infoLeakScore,
          injectionScore: result.injectionScore,
          details: JSON.parse(JSON.stringify(result.details)),
        },
      });
      scanned++;
      console.log(`    -> Security Score: ${result.score}/10`);
    } catch (err) {
      console.error(`    -> SEC Error: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`  [SEC] Done. Scanned ${scanned}/${sites.length} sites.`);
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════

async function cleanupOldData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const [analyses, checks, scans] = await Promise.all([
    prisma.analysisResult.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.availabilityCheck.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.securityScan.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);

  const total = analyses.count + checks.count + scans.count;
  if (total > 0) {
    console.log(`[Cleanup] Deleted ${total} records older than ${RETENTION_DAYS} days (${analyses.count} analyses, ${checks.count} checks, ${scans.count} scans).`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN — 3 PARALLEL LOOPS
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log("AI Friendly Worker started (v3.0 — multi-task).");
  console.log(`  AI analysis interval: ${AI_CHECK_INTERVAL_MS / 1000}s`);
  console.log(`  Availability check interval: ${AVAILABILITY_INTERVAL_MS / 1000}s`);
  console.log(`  Security scan interval: ${SECURITY_INTERVAL_MS / 1000}s`);
  console.log(`  Retention: ${RETENTION_DAYS} days`);

  // Run all once at startup
  await Promise.allSettled([
    processAIAnalysis(),
    processAvailabilityChecks(),
    processSecurityScans(),
    cleanupOldData(),
  ]);

  // Loop 1: AI Analysis (every 5 min)
  setInterval(async () => {
    try { await processAIAnalysis(); } catch (err) { console.error("[AI] Loop error:", err); }
  }, AI_CHECK_INTERVAL_MS);

  // Loop 2: Availability (every 1 min)
  setInterval(async () => {
    try { await processAvailabilityChecks(); } catch (err) { console.error("[AVAIL] Loop error:", err); }
  }, AVAILABILITY_INTERVAL_MS);

  // Loop 3: Security (every 1 hour)
  setInterval(async () => {
    try { await processSecurityScans(); } catch (err) { console.error("[SEC] Loop error:", err); }
  }, SECURITY_INTERVAL_MS);

  // Cleanup (every 1 hour)
  setInterval(async () => {
    try { await cleanupOldData(); } catch (err) { console.error("[Cleanup] Error:", err); }
  }, CLEANUP_INTERVAL_MS);
}

main().catch((err) => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
