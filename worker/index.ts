/**
 * AI Friendly — Worker
 *
 * Scheduled analysis runner that:
 * 1. Checks which sites need analysis (based on frequency)
 * 2. Runs the analysis for each due site
 * 3. Stores results in the database
 * 4. Cleans up results older than 60 days
 *
 * Runs as a long-lived process, checking every 5 minutes.
 */

import { PrismaClient } from "@prisma/client";
import * as cheerio from "cheerio";

const prisma = new PrismaClient();
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RETENTION_DAYS = 60;
const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;

const AI_BOT_AGENTS = [
  "GPTBot", "ChatGPT-User", "Google-Extended", "CCBot",
  "anthropic-ai", "Claude-Web", "PerplexityBot", "Bytespider",
  "Amazonbot", "FacebookBot", "Applebot-Extended",
];

// ─── Frequency helpers ──────────────────────────────────────────────────────

function getFrequencyMs(frequency: string): number {
  switch (frequency) {
    case "6h": return 6 * 60 * 60 * 1000;
    case "daily": return 24 * 60 * 60 * 1000;
    case "weekly": return 7 * 24 * 60 * 60 * 1000;
    case "monthly": return 30 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

// ─── Analysis logic (self-contained, no Next.js deps) ───────────────────────

interface Improvement {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  category: string;
  suggestion?: string;
}

async function fetchTextFile(baseUrl: string, path: string): Promise<string | null> {
  try {
    const fileUrl = new URL(path, baseUrl).href;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(fileUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "IAFriendly/1.0 (Worker)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.text()).slice(0, 50000);
  } catch {
    return null;
  }
}

function escapeYaml(s: string): string {
  if (/[\n"\\]/.test(s)) return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  return s;
}

async function analyzeUrl(targetUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "IAFriendly/1.0 (Worker; +https://aifriendly.fr)" },
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

  // Robots analysis
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

  // Check sitemap
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
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || null;
  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim() || null;

  if (!title || title.length < 10) {
    score -= 1.5;
    improvements.push({ id: "title", title: "Titre de page manquant ou trop court", description: "Un titre explicite aide les IA.", severity: "critical", category: "Métadonnées" });
  }
  if (!metaDesc || metaDesc.length < 50) {
    score -= 1;
    improvements.push({ id: "meta-description", title: "Meta description absente ou trop courte", description: "La meta description est utilisée comme résumé.", severity: metaDesc ? "warning" : "critical", category: "Métadonnées" });
  }

  const headings: { level: number; text: string }[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = parseInt(el.tagName[1], 10);
    const text = $(el).text().trim();
    if (text) headings.push({ level, text });
  });
  if (headings.filter((h) => h.level === 1).length === 0) {
    score -= 1;
    improvements.push({ id: "h1", title: "Aucun titre H1", description: "Un seul H1 par page.", severity: "critical", category: "Structure" });
  }

  const mainContent = $("main").text().trim() || $("article").first().text().trim() || $("body").text().trim();
  const mainClean = mainContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
  if (mainClean.length < 100) {
    score -= 0.5;
    improvements.push({ id: "content", title: "Peu de contenu texte", description: "Les IA s'appuient sur le texte.", severity: "warning", category: "Contenu" });
  }

  let imgNoAlt = 0;
  const images: { src: string; alt: string | null }[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    const alt = $(el).attr("alt");
    if (src) {
      images.push({ src, alt: alt?.trim() || null });
      if (!alt?.trim()) imgNoAlt++;
    }
  });
  if (imgNoAlt > 0) {
    score -= Math.min(0.5, imgNoAlt * 0.2);
    improvements.push({ id: "alt", title: `Images sans alt (${imgNoAlt})`, description: "L'attribut alt est important.", severity: imgNoAlt > 3 ? "warning" : "info", category: "Images" });
  }

  if (!lang) { score -= 0.3; improvements.push({ id: "lang", title: "Langue non indiquée", description: "L'attribut lang aide l'interprétation.", severity: "info", category: "Métadonnées" }); }
  if (!robotsExists) { score -= 0.3; improvements.push({ id: "robots-txt", title: "robots.txt absent", description: "Guide les crawlers.", severity: "warning", category: "Accessibilité Bots" }); }
  else if (blocksAI.length > 0) { score -= 0.5; improvements.push({ id: "robots-blocks-ai", title: `Crawlers IA bloqués`, description: `Bloqués: ${blocksAI.join(", ")}`, severity: "warning", category: "Accessibilité Bots" }); }
  if (!sitemapExists) { score -= 0.3; improvements.push({ id: "sitemap", title: "Sitemap XML absent", description: "Aide à l'indexation.", severity: "warning", category: "Accessibilité Bots" }); }
  if (llmsExists) score += 0.2;

  const metaRobots = $('meta[name="robots"]').attr("content")?.toLowerCase() || "";
  if (metaRobots.includes("noindex")) {
    score -= 1;
    improvements.push({ id: "noindex", title: "Page noindex", description: "Non indexable.", severity: "critical", category: "Accessibilité Bots" });
  }

  const semanticCount = [$("nav").length, $("header").length, $("footer").length, $("main").length, $("article").length, $("section").length].filter(n => n > 0).length;
  if (semanticCount < 3) {
    score -= 0.5;
    improvements.push({ id: "semantic-html", title: "Peu de HTML sémantique", description: "Utilisez nav, header, main, etc.", severity: "warning", category: "Structure" });
  }

  const h1Count = headings.filter(h => h.level === 1).length;
  if (h1Count > 1) { score -= 0.3; improvements.push({ id: "multiple-h1", title: `${h1Count} H1 détectés`, description: "Un seul H1 recommandé.", severity: "warning", category: "Structure" }); }

  const missingOg: string[] = [];
  if (!ogImage) missingOg.push("og:image");
  if (!ogType) missingOg.push("og:type");
  if (missingOg.length > 0) {
    score -= Math.min(0.5, missingOg.length * 0.15);
    improvements.push({ id: "open-graph", title: `OG manquants: ${missingOg.join(", ")}`, description: "Améliore le partage.", severity: "info", category: "Métadonnées" });
  }

  const hasStructuredData = $('script[type="application/ld+json"]').length > 0;

  // Build YAML
  const yaml: string[] = ["# Aperçu IA", "", `url: ${escapeYaml(targetUrl)}`];
  yaml.push(`title: ${title ? escapeYaml(title) : "null"}`);
  yaml.push(`description: ${metaDesc ? escapeYaml(metaDesc.slice(0, 200)) : "null"}`);
  yaml.push(`lang: ${lang || "null"}`);
  yaml.push(`score: ${Math.max(0, Math.min(10, Math.round(score * 10) / 10))}/10`);
  yaml.push(`structuredData: ${hasStructuredData}`);
  yaml.push(`robotsTxt: ${robotsExists}`);
  yaml.push(`sitemap: ${sitemapExists}`);
  yaml.push(`llmsTxt: ${llmsExists}`);
  yaml.push(`images: ${images.length}`);

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
        metaRobots: {
          noindex: metaRobots.includes("noindex"),
          nofollow: metaRobots.includes("nofollow"),
          nosnippet: metaRobots.includes("nosnippet"),
          noai: metaRobots.includes("noai"),
        },
      },
      analyzedAt: new Date().toISOString(),
    },
  };
}

// ─── Main loop ──────────────────────────────────────────────────────────────

async function processSites() {
  const now = new Date();
  console.log(`[${now.toISOString()}] Checking sites for scheduled analysis...`);

  const sites = await prisma.site.findMany({
    where: { isActive: true },
    include: {
      analyses: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  let analyzed = 0;
  for (const site of sites) {
    const lastAnalysis = site.analyses[0]?.createdAt;
    const frequencyMs = getFrequencyMs(site.frequency);
    const isDue = !lastAnalysis || (now.getTime() - lastAnalysis.getTime() > frequencyMs);

    if (!isDue) continue;

    console.log(`  Analyzing: ${site.name} (${site.url})`);
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
      console.log(`    -> Score: ${result.score}/10`);
    } catch (err) {
      console.error(`    -> Error: ${err instanceof Error ? err.message : err}`);
    }

    // Small delay between analyses to be polite
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`  Done. Analyzed ${analyzed}/${sites.length} sites.`);
}

async function cleanupOldResults() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const result = await prisma.analysisResult.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  if (result.count > 0) {
    console.log(`[Cleanup] Deleted ${result.count} results older than ${RETENTION_DAYS} days.`);
  }
}

async function main() {
  console.log("AI Friendly Worker started.");
  console.log(`  Check interval: ${CHECK_INTERVAL_MS / 1000}s`);
  console.log(`  Retention: ${RETENTION_DAYS} days`);

  // Run immediately on startup
  await processSites();
  await cleanupOldResults();

  // Then schedule periodic checks
  setInterval(async () => {
    try {
      await processSites();
      await cleanupOldResults();
    } catch (err) {
      console.error("Worker loop error:", err);
    }
  }, CHECK_INTERVAL_MS);
}

main().catch((err) => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
