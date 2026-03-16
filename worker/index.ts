/**
 * AI Friendly — Worker (Multi-task orchestrator v3.0)
 *
 * 3 parallel loops:
 * 1. AI Analysis — runs every 1 hour for all active sites
 * 2. Availability Check — runs every 1 minute for all active sites
 * 3. Security Scan — runs every 1 hour for all active sites
 *
 * Also handles 60-day data retention cleanup.
 */

import { PrismaClient } from "@prisma/client";
import * as cheerio from "cheerio";

const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════════
// LLM CONFIGURATION (vLLM / OpenAI-compatible)
// ═══════════════════════════════════════════════════════════════
const VLLM_API_URL = process.env.VLLM_API_URL || "";      // e.g. http://vllm:8000/v1
const VLLM_API_KEY = process.env.VLLM_API_KEY || "";       // API key (optional for local vLLM)
const VLLM_MODEL = process.env.VLLM_MODEL || "default";    // Model name served by vLLM
const LLM_ENABLED = !!VLLM_API_URL;
const LLM_TIMEOUT_MS = 30000;

const AI_CHECK_INTERVAL_MS = 60 * 60 * 1000;       // 1 hour
const AVAILABILITY_INTERVAL_MS = 60 * 1000;         // 1 minute
const SECURITY_INTERVAL_MS = 60 * 60 * 1000;        // 1 hour
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
// LLM-BASED CONTENT ANALYSIS
// ═══════════════════════════════════════════════════════════════

interface LLMScores {
  ethicsScore: number;
  coherenceScore: number;
  aiGeneratedScore: number;
  ethicsImprovements: { title: string; description: string; severity: "critical" | "warning" | "info" }[];
  coherenceImprovements: { title: string; description: string; severity: "critical" | "warning" | "info" }[];
  aiDetectionImprovements: { title: string; description: string; severity: "critical" | "warning" | "info" }[];
}

async function analyzWithLLM(textContent: string, title: string | null, lang: string | null, url: string): Promise<LLMScores | null> {
  if (!LLM_ENABLED) return null;

  const truncatedContent = textContent.slice(0, 3000);

  const systemPrompt = `You are an expert web content analyst. You must analyze webpage content and return a JSON object with scores and improvement suggestions.

Score each category from 0 to 10 (10 = best):

1. **ethicsScore**: Is the content ethical and safe? Check for:
   - Misleading or deceptive content
   - Harmful, hateful, or discriminatory language
   - Spam or manipulative SEO content
   - Privacy-violating content or dark patterns
   - Inappropriate or offensive material

2. **coherenceScore**: Is the content well-structured and coherent? Check for:
   - Logical flow and organization
   - Grammar and readability quality
   - Clear purpose and messaging
   - Consistent tone and style
   - Proper use of headings and sections

3. **aiGeneratedScore**: Does the content appear human-written? (10 = clearly human, 0 = clearly AI-generated). Check for:
   - Overly generic or template-like phrasing
   - Lack of personal anecdotes or opinions
   - Unnaturally perfect structure
   - Repetitive transitional phrases
   - Missing personality or unique voice

Return ONLY valid JSON matching this exact structure (no markdown, no explanation):
{
  "ethicsScore": <number 0-10>,
  "coherenceScore": <number 0-10>,
  "aiGeneratedScore": <number 0-10>,
  "ethicsImprovements": [{"title": "...", "description": "...", "severity": "critical|warning|info"}],
  "coherenceImprovements": [{"title": "...", "description": "...", "severity": "critical|warning|info"}],
  "aiDetectionImprovements": [{"title": "...", "description": "...", "severity": "critical|warning|info"}]
}

Keep improvement arrays short (max 3 items each). Write in French.`;

  const userPrompt = `URL: ${url}
Title: ${title || "(absent)"}
Language: ${lang || "(non spécifié)"}

Content:
${truncatedContent}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (VLLM_API_KEY) headers["Authorization"] = `Bearer ${VLLM_API_KEY}`;

    const res = await fetch(`${VLLM_API_URL}/chat/completions`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: VLLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: "json_object" },
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`  [LLM] API error: ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);

    // Validate and clamp scores
    const clamp = (v: unknown) => Math.max(0, Math.min(10, Math.round((Number(v) || 0) * 10) / 10));
    const validImprovements = (arr: unknown) =>
      Array.isArray(arr)
        ? arr.slice(0, 3).map((item: Record<string, string>) => ({
            title: String(item.title || ""),
            description: String(item.description || ""),
            severity: (["critical", "warning", "info"].includes(item.severity) ? item.severity : "info") as "critical" | "warning" | "info",
          }))
        : [];

    return {
      ethicsScore: clamp(parsed.ethicsScore),
      coherenceScore: clamp(parsed.coherenceScore),
      aiGeneratedScore: clamp(parsed.aiGeneratedScore),
      ethicsImprovements: validImprovements(parsed.ethicsImprovements),
      coherenceImprovements: validImprovements(parsed.coherenceImprovements),
      aiDetectionImprovements: validImprovements(parsed.aiDetectionImprovements),
    };
  } catch (err) {
    console.error(`  [LLM] Error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
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
      headers: { "User-Agent": "AIFriendly/1.0 (Worker; +https://aifriendly.eu)" },
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

  // Sub-scores
  let ethicsScore = 10;
  let coherenceScore = 10;
  let aiGeneratedScore = 10;

  const title = $("title").first().text().trim() || $('meta[property="og:title"]').attr("content")?.trim() || null;
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() || null;
  const lang = $("html").attr("lang") || null;
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim() || null;
  const ogType = $('meta[property="og:type"]').attr("content")?.trim() || null;

  // ── Coherence ──
  if (!title || title.length < 10) { coherenceScore -= 2; improvements.push({ id: "title", title: "Titre de page manquant ou trop court", description: "Un titre explicite aide les IA.", severity: "critical", category: "Cohérence" }); }
  if (!metaDesc || metaDesc.length < 50) { coherenceScore -= 1.5; improvements.push({ id: "meta-description", title: "Meta description absente ou trop courte", description: "La meta description est utilisée comme résumé.", severity: metaDesc ? "warning" : "critical", category: "Cohérence" }); }

  const headings: { level: number; text: string }[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = parseInt(el.tagName[1], 10);
    const text = $(el).text().trim();
    if (text) headings.push({ level, text });
  });
  if (headings.filter((h) => h.level === 1).length === 0) { coherenceScore -= 1.5; improvements.push({ id: "h1", title: "Aucun titre H1", description: "Un seul H1 par page.", severity: "critical", category: "Cohérence" }); }

  const mainContent = $("main").text().trim() || $("article").first().text().trim() || $("body").text().trim();
  const mainClean = mainContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
  if (mainClean.length < 100) { coherenceScore -= 1; improvements.push({ id: "content", title: "Peu de contenu texte", description: "Les IA s'appuient sur le texte.", severity: "warning", category: "Cohérence" }); }

  let imgNoAlt = 0;
  $("img").each((_, el) => { if ($(el).attr("src") && !$(el).attr("alt")?.trim()) imgNoAlt++; });
  if (imgNoAlt > 0) { coherenceScore -= Math.min(1, imgNoAlt * 0.3); improvements.push({ id: "alt", title: `Images sans alt (${imgNoAlt})`, description: "L'attribut alt est important.", severity: imgNoAlt > 3 ? "warning" : "info", category: "Cohérence" }); }

  if (!lang) { coherenceScore -= 0.5; improvements.push({ id: "lang", title: "Langue non indiquée", description: "L'attribut lang aide l'interprétation.", severity: "info", category: "Cohérence" }); }

  const semanticCount = [$("nav").length, $("header").length, $("footer").length, $("main").length, $("article").length, $("section").length].filter(n => n > 0).length;
  if (semanticCount < 3) { coherenceScore -= 1; improvements.push({ id: "semantic-html", title: "Peu de HTML sémantique", description: "Utilisez nav, header, main, etc.", severity: "warning", category: "Cohérence" }); }

  const h1Count = headings.filter(h => h.level === 1).length;
  if (h1Count > 1) { coherenceScore -= 0.5; improvements.push({ id: "multiple-h1", title: `${h1Count} H1 détectés`, description: "Un seul H1 recommandé.", severity: "warning", category: "Cohérence" }); }

  const missingOg: string[] = [];
  if (!ogImage) missingOg.push("og:image");
  if (!ogType) missingOg.push("og:type");
  if (missingOg.length > 0) { coherenceScore -= Math.min(1, missingOg.length * 0.3); improvements.push({ id: "open-graph", title: `OG manquants: ${missingOg.join(", ")}`, description: "Améliore le partage.", severity: "info", category: "Cohérence" }); }

  // ── Ethics / Risk ──
  const metaRobots = $('meta[name="robots"]').attr("content")?.toLowerCase() || "";
  if (!robotsExists) { ethicsScore -= 0.5; improvements.push({ id: "robots-txt", title: "robots.txt absent", description: "Guide les crawlers.", severity: "warning", category: "Éthique & Risque" }); }
  else if (blocksAI.length > 0) { ethicsScore -= 1; improvements.push({ id: "robots-blocks-ai", title: `Crawlers IA bloqués`, description: `Bloqués: ${blocksAI.join(", ")}`, severity: "warning", category: "Éthique & Risque" }); }
  if (!sitemapExists) { ethicsScore -= 0.5; improvements.push({ id: "sitemap", title: "Sitemap XML absent", description: "Aide à l'indexation.", severity: "warning", category: "Éthique & Risque" }); }
  if (llmsExists) ethicsScore += 0.3;

  if (metaRobots.includes("noindex")) { ethicsScore -= 2; improvements.push({ id: "noindex", title: "Page noindex", description: "Non indexable.", severity: "critical", category: "Éthique & Risque" }); }
  if (metaRobots.includes("noai") || metaRobots.includes("noimageai")) { ethicsScore -= 1.5; improvements.push({ id: "noai", title: "Directive noai", description: "Contenu exclu du traitement IA.", severity: "warning", category: "Éthique & Risque" }); }
  if (metaRobots.includes("nosnippet")) { ethicsScore -= 0.5; improvements.push({ id: "nosnippet", title: "Directive nosnippet", description: "Pas d'extraits autorisés.", severity: "info", category: "Éthique & Risque" }); }

  // ── AI-Generated Detection ──
  const hasStructuredData = $('script[type="application/ld+json"]').length > 0;
  const textContent = mainClean;
  const sentences = textContent.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const wordCount = textContent.split(/\s+/).filter(w => w.length > 0).length;

  // Repetition patterns
  if (sentences.length > 5) {
    const sentenceSet = new Set(sentences.map(s => s.trim().toLowerCase()));
    const repetitionRatio = 1 - (sentenceSet.size / sentences.length);
    if (repetitionRatio > 0.3) { aiGeneratedScore -= 2; improvements.push({ id: "ai-repetition", title: "Contenu répétitif détecté", description: `${Math.round(repetitionRatio * 100)}% phrases dupliquées.`, severity: "warning", category: "Détection IA" }); }
    else if (repetitionRatio > 0.15) { aiGeneratedScore -= 1; improvements.push({ id: "ai-repetition", title: "Légère répétition", description: `${Math.round(repetitionRatio * 100)}% phrases similaires.`, severity: "info", category: "Détection IA" }); }
  }

  // Sentence length uniformity
  if (sentences.length > 5) {
    const lengths = sentences.map(s => s.trim().split(/\s+/).length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avgLen, 2), 0) / lengths.length;
    const coeffVariation = avgLen > 0 ? Math.sqrt(variance) / avgLen : 1;
    if (coeffVariation < 0.2) { aiGeneratedScore -= 2; improvements.push({ id: "ai-uniformity", title: "Phrases très uniformes", description: "Longueur de phrases homogène typique d'IA.", severity: "warning", category: "Détection IA" }); }
    else if (coeffVariation < 0.35) { aiGeneratedScore -= 1; improvements.push({ id: "ai-uniformity", title: "Phrases assez uniformes", description: "Faible variation de longueur.", severity: "info", category: "Détection IA" }); }
  }

  // AI typical phrases
  const aiPatterns = [
    /\ben conclusion\b/gi, /\bil est important de noter\b/gi, /\bil convient de\b/gi,
    /\bin conclusion\b/gi, /\bit is important to note\b/gi, /\bit's worth noting\b/gi,
    /\bfurthermore\b/gi, /\bmoreover\b/gi, /\badditionally\b/gi,
    /\ben résumé\b/gi, /\bde plus\b/gi, /\bpar ailleurs\b/gi,
    /\bin today's world\b/gi, /\bin the realm of\b/gi,
    /\bdelve\b/gi, /\btapestry\b/gi, /\blandscape\b/gi,
  ];
  let aiPhraseCount = 0;
  for (const pattern of aiPatterns) { const m = textContent.match(pattern); if (m) aiPhraseCount += m.length; }
  const aiPhraseDensity = wordCount > 0 ? aiPhraseCount / (wordCount / 100) : 0;
  if (aiPhraseDensity > 3) { aiGeneratedScore -= 2; improvements.push({ id: "ai-phrases", title: "Formulations typiques IA", description: `${aiPhraseCount} formulations IA détectées.`, severity: "warning", category: "Détection IA" }); }
  else if (aiPhraseDensity > 1.5) { aiGeneratedScore -= 1; improvements.push({ id: "ai-phrases", title: "Formulations IA détectées", description: `${aiPhraseCount} expressions IA.`, severity: "info", category: "Détection IA" }); }

  // Personal voice
  const personalPatterns = [/\bje\b/gi, /\bmon\b/gi, /\bma\b/gi, /\bmes\b/gi, /\bnous\b/gi, /\bnotre\b/gi, /\bI\b/g, /\bmy\b/gi, /\bwe\b/gi, /\bour\b/gi];
  let personalCount = 0;
  for (const p of personalPatterns) { const m = textContent.match(p); if (m) personalCount += m.length; }
  if (wordCount > 100 && personalCount === 0) { aiGeneratedScore -= 1; improvements.push({ id: "ai-impersonal", title: "Contenu impersonnel", description: "Aucune voix personnelle détectée.", severity: "info", category: "Détection IA" }); }

  // Positive signals
  if (hasStructuredData) aiGeneratedScore += 0.5;
  const hasAuthorMeta = !!($('meta[name="author"]').attr("content")?.trim());
  if (hasAuthorMeta) aiGeneratedScore += 0.3;
  else if (wordCount > 200) { aiGeneratedScore -= 0.5; improvements.push({ id: "ai-no-author", title: "Pas d'auteur identifié", description: "Absence de meta author.", severity: "info", category: "Détection IA" }); }

  // ── LLM-based analysis (blends with heuristic scores) ──
  const llmResult = await analyzWithLLM(mainClean, title, lang, targetUrl);
  if (llmResult) {
    // Blend: 40% heuristic + 60% LLM for more accurate scoring
    ethicsScore = ethicsScore * 0.4 + llmResult.ethicsScore * 0.6;
    coherenceScore = coherenceScore * 0.4 + llmResult.coherenceScore * 0.6;
    aiGeneratedScore = aiGeneratedScore * 0.4 + llmResult.aiGeneratedScore * 0.6;

    // Add LLM-sourced improvements
    for (const imp of llmResult.ethicsImprovements) {
      improvements.push({ id: `llm-ethics-${improvements.length}`, title: imp.title, description: imp.description, severity: imp.severity, category: "Éthique & Risque" });
    }
    for (const imp of llmResult.coherenceImprovements) {
      improvements.push({ id: `llm-coherence-${improvements.length}`, title: imp.title, description: imp.description, severity: imp.severity, category: "Cohérence" });
    }
    for (const imp of llmResult.aiDetectionImprovements) {
      improvements.push({ id: `llm-ai-${improvements.length}`, title: imp.title, description: imp.description, severity: imp.severity, category: "Détection IA" });
    }
    console.log(`    -> LLM scores: Ethics=${llmResult.ethicsScore}, Coherence=${llmResult.coherenceScore}, AI=${llmResult.aiGeneratedScore}`);
  }

  // Clamp sub-scores
  ethicsScore = Math.max(0, Math.min(10, Math.round(ethicsScore * 10) / 10));
  coherenceScore = Math.max(0, Math.min(10, Math.round(coherenceScore * 10) / 10));
  aiGeneratedScore = Math.max(0, Math.min(10, Math.round(aiGeneratedScore * 10) / 10));

  const yaml: string[] = ["# Aperçu IA", "", `url: ${escapeYaml(targetUrl)}`];
  yaml.push(`title: ${title ? escapeYaml(title) : "null"}`);
  yaml.push(`description: ${metaDesc ? escapeYaml(metaDesc.slice(0, 200)) : "null"}`);
  yaml.push(`lang: ${lang || "null"}`);

  const finalScore = Math.max(0, Math.min(10, Math.round(((ethicsScore + coherenceScore + aiGeneratedScore) / 3) * 10) / 10));

  yaml.push(`score: ${finalScore}/10`);
  yaml.push(`ethicsScore: ${ethicsScore}/10`);
  yaml.push(`coherenceScore: ${coherenceScore}/10`);
  yaml.push(`aiGeneratedScore: ${aiGeneratedScore}/10`);
  yaml.push(`structuredData: ${hasStructuredData}`);
  yaml.push(`robotsTxt: ${robotsExists}`);
  yaml.push(`sitemap: ${sitemapExists}`);
  yaml.push(`llmsTxt: ${llmsExists}`);

  return {
    score: finalScore,
    maxScore: 10,
    ethicsScore,
    coherenceScore,
    aiGeneratedScore,
    details: {
      improvements,
      aiPreviewYaml: yaml.join("\n"),
      botAccess: {
        robotsTxt: { exists: robotsExists, blocksAI },
        sitemap: { exists: sitemapExists },
        llmsTxt: { exists: llmsExists },
        metaRobots: { noindex: metaRobots.includes("noindex"), nofollow: metaRobots.includes("nofollow"), nosnippet: metaRobots.includes("nosnippet"), noai: metaRobots.includes("noai") || metaRobots.includes("noimageai") },
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
    const isDue = !lastAnalysis || (now.getTime() - lastAnalysis.getTime() > AI_CHECK_INTERVAL_MS);

    if (!isDue) continue;

    console.log(`  [AI] Analyzing: ${site.name} (${site.url})`);
    try {
      const result = await analyzeUrl(site.url);
      await prisma.analysisResult.create({
        data: {
          siteId: site.id,
          score: result.score,
          maxScore: result.maxScore,
          ethicsScore: result.ethicsScore,
          coherenceScore: result.coherenceScore,
          aiGeneratedScore: result.aiGeneratedScore,
          details: JSON.parse(JSON.stringify(result.details)),
        },
      });
      analyzed++;
      console.log(`    -> AI Score: ${result.score}/10 (Ethics: ${result.ethicsScore}, Coherence: ${result.coherenceScore}, AI Detection: ${result.aiGeneratedScore})`);
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

    // ═══════════════════════════════════════════
    // CATEGORY 1: Security Headers (14 tests)
    // ═══════════════════════════════════════════

    // 1.1 Content-Security-Policy + sub-checks
    const csp = headers.get("content-security-policy");
    if (!csp) {
      headersScore -= 1.5;
      tests.push({ id: "csp-missing", name: "CSP", category: "headers", status: "fail", severity: "critical", value: "Absent", recommendation: "Ajoutez Content-Security-Policy.", deduction: 1.5 });
    } else {
      tests.push({ id: "csp-ok", name: "CSP", category: "headers", status: "pass", severity: "info", value: "Présent", deduction: 0 });
      if (csp.includes("unsafe-inline")) { headersScore -= 0.5; tests.push({ id: "csp-unsafe-inline", name: "CSP: unsafe-inline", category: "headers", status: "warning", severity: "warning", value: "unsafe-inline affaiblit la protection XSS", recommendation: "Remplacez unsafe-inline par des nonces ou hashes.", deduction: 0.5 }); }
      if (csp.includes("unsafe-eval")) { headersScore -= 0.5; tests.push({ id: "csp-unsafe-eval", name: "CSP: unsafe-eval", category: "headers", status: "warning", severity: "warning", value: "unsafe-eval permet l'exécution de code dynamique", recommendation: "Supprimez unsafe-eval et refactorisez le code utilisant eval().", deduction: 0.5 }); }
      if (csp.includes("* ") || csp.includes(" *") || csp.match(/:\s*\*/)) { headersScore -= 0.3; tests.push({ id: "csp-wildcard", name: "CSP: wildcard", category: "headers", status: "warning", severity: "warning", value: "Wildcard (*) autorise toutes les sources", recommendation: "Restreignez les sources autorisées.", deduction: 0.3 }); }
      if (!csp.includes("frame-ancestors")) { headersScore -= 0.2; tests.push({ id: "csp-no-frame-ancestors", name: "CSP: frame-ancestors absent", category: "headers", status: "warning", severity: "info", value: "frame-ancestors non défini", recommendation: "Ajoutez frame-ancestors 'self' dans votre CSP.", deduction: 0.2 }); }
    }

    // 1.2 X-Frame-Options
    const xfo = headers.get("x-frame-options");
    if (!xfo) { headersScore -= 1; tests.push({ id: "xfo-missing", name: "X-Frame-Options", category: "headers", status: "fail", severity: "critical", value: "Absent", recommendation: "Ajoutez X-Frame-Options: DENY.", deduction: 1 }); }
    else {
      const xfoVal = xfo.toUpperCase();
      if (xfoVal !== "DENY" && xfoVal !== "SAMEORIGIN") { headersScore -= 0.3; tests.push({ id: "xfo-weak", name: "X-Frame-Options", category: "headers", status: "warning", severity: "warning", value: `Valeur non standard: ${xfo}`, recommendation: "Utilisez DENY ou SAMEORIGIN.", deduction: 0.3 }); }
      else { tests.push({ id: "xfo-ok", name: "X-Frame-Options", category: "headers", status: "pass", severity: "info", value: xfo, deduction: 0 }); }
    }

    // 1.3 X-Content-Type-Options
    if (headers.get("x-content-type-options") !== "nosniff") { headersScore -= 0.5; tests.push({ id: "xcto-missing", name: "X-Content-Type-Options", category: "headers", status: "warning", severity: "warning", value: headers.get("x-content-type-options") || "Absent", recommendation: "Ajoutez X-Content-Type-Options: nosniff.", deduction: 0.5 }); }
    else { tests.push({ id: "xcto-ok", name: "X-Content-Type-Options", category: "headers", status: "pass", severity: "info", value: "nosniff", deduction: 0 }); }

    // 1.4 HSTS + sub-checks
    const hsts = headers.get("strict-transport-security");
    if (!hsts) { headersScore -= 1; tests.push({ id: "hsts-missing", name: "HSTS", category: "headers", status: "fail", severity: "critical", value: "Absent", recommendation: "Ajoutez Strict-Transport-Security: max-age=31536000; includeSubDomains; preload.", deduction: 1 }); }
    else {
      const maxAge = parseInt(hsts.match(/max-age=(\d+)/)?.[1] || "0");
      if (maxAge < 15768000) { headersScore -= 0.5; tests.push({ id: "hsts-short", name: "HSTS", category: "headers", status: "warning", severity: "warning", value: `max-age=${maxAge}`, deduction: 0.5 }); }
      else { tests.push({ id: "hsts-ok", name: "HSTS", category: "headers", status: "pass", severity: "info", value: hsts, deduction: 0 }); }
      if (!hsts.toLowerCase().includes("includesubdomains")) { headersScore -= 0.2; tests.push({ id: "hsts-no-subdomains", name: "HSTS: includeSubDomains manquant", category: "headers", status: "warning", severity: "info", value: "includeSubDomains non défini", deduction: 0.2 }); }
    }

    // 1.5-1.7 X-XSS-Protection, Referrer-Policy, Permissions-Policy
    if (!headers.get("x-xss-protection")) { headersScore -= 0.3; tests.push({ id: "xxss-missing", name: "X-XSS-Protection", category: "headers", status: "warning", severity: "warning", value: "Absent", deduction: 0.3 }); }
    const referrer = headers.get("referrer-policy");
    if (!referrer) { headersScore -= 0.3; tests.push({ id: "referrer-missing", name: "Referrer-Policy", category: "headers", status: "warning", severity: "info", value: "Absent", deduction: 0.3 }); }
    else if (["unsafe-url", "no-referrer-when-downgrade"].includes(referrer.toLowerCase())) { headersScore -= 0.2; tests.push({ id: "referrer-weak", name: "Referrer-Policy faible", category: "headers", status: "warning", severity: "warning", value: referrer, recommendation: "Utilisez strict-origin-when-cross-origin ou no-referrer.", deduction: 0.2 }); }
    if (!headers.get("permissions-policy")) { headersScore -= 0.3; tests.push({ id: "permissions-missing", name: "Permissions-Policy", category: "headers", status: "warning", severity: "info", value: "Absent", deduction: 0.3 }); }

    // 1.8-1.10 Cross-Origin policies (COEP, COOP, CORP)
    if (!headers.get("cross-origin-embedder-policy")) { headersScore -= 0.2; tests.push({ id: "coep-missing", name: "Cross-Origin-Embedder-Policy", category: "headers", status: "warning", severity: "info", value: "Absent", recommendation: "Ajoutez COEP: require-corp.", deduction: 0.2 }); }
    if (!headers.get("cross-origin-opener-policy")) { headersScore -= 0.2; tests.push({ id: "coop-missing", name: "Cross-Origin-Opener-Policy", category: "headers", status: "warning", severity: "info", value: "Absent", recommendation: "Ajoutez COOP: same-origin.", deduction: 0.2 }); }
    if (!headers.get("cross-origin-resource-policy")) { headersScore -= 0.2; tests.push({ id: "corp-missing", name: "Cross-Origin-Resource-Policy", category: "headers", status: "warning", severity: "info", value: "Absent", recommendation: "Ajoutez CORP: same-origin.", deduction: 0.2 }); }

    // 1.11-1.12 X-Permitted-Cross-Domain-Policies, X-Download-Options
    if (!headers.get("x-permitted-cross-domain-policies")) { headersScore -= 0.1; tests.push({ id: "xpcdp-missing", name: "X-Permitted-Cross-Domain-Policies", category: "headers", status: "warning", severity: "info", value: "Absent", deduction: 0.1 }); }
    if (!headers.get("x-download-options")) { headersScore -= 0.1; tests.push({ id: "xdo-missing", name: "X-Download-Options", category: "headers", status: "warning", severity: "info", value: "Absent", deduction: 0.1 }); }

    // 1.13 Cache-Control
    const cacheControl = headers.get("cache-control");
    if (!cacheControl || (!cacheControl.includes("no-store") && !cacheControl.includes("private"))) { headersScore -= 0.2; tests.push({ id: "cache-control-weak", name: "Cache-Control", category: "headers", status: "warning", severity: "info", value: cacheControl || "Absent", recommendation: "Utilisez Cache-Control: no-store ou private pour les pages sensibles.", deduction: 0.2 }); }

    // ═══════════════════════════════════════════
    // CATEGORY 2: SSL/TLS (4 tests)
    // ═══════════════════════════════════════════

    if (targetUrl.startsWith("https://")) {
      tests.push({ id: "ssl-https", name: "HTTPS", category: "ssl", status: "pass", severity: "info", value: "Oui", deduction: 0 });

      // HTTP redirect check
      const httpRes = await fetchWithTimeout(targetUrl.replace("https://", "http://"), { redirect: "manual", headers: { "User-Agent": "AIFriendly/1.0" } });
      if (httpRes) {
        const loc = httpRes.headers.get("location") || "";
        if (!(httpRes.status >= 300 && httpRes.status < 400 && loc.startsWith("https://"))) {
          sslScore -= 1; tests.push({ id: "http-no-redirect", name: "HTTP→HTTPS redirect", category: "ssl", status: "warning", severity: "warning", value: "Pas de redirection", deduction: 1 });
        }
      }

      // Mixed content detection
      const httpResources: string[] = [];
      $("script[src], link[href], img[src], iframe[src], video[src], audio[src], source[src]").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("href") || "";
        if (src.startsWith("http://") && !src.includes("localhost")) httpResources.push(src.slice(0, 80));
      });
      if (httpResources.length > 0) {
        sslScore -= 1.5;
        tests.push({ id: "mixed-content", name: "Contenu mixte (HTTP sur HTTPS)", category: "ssl", status: "fail", severity: "critical", value: `${httpResources.length} ressource(s) HTTP`, recommendation: "Chargez toutes les ressources via HTTPS.", deduction: 1.5 });
      }

      // SRI check for external scripts
      let externalNoSri = 0, totalExternal = 0;
      $("script[src], link[rel='stylesheet'][href]").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("href") || "";
        if (src.startsWith("http") && !src.includes(new URL(targetUrl).hostname)) {
          totalExternal++;
          if (!$(el).attr("integrity")) externalNoSri++;
        }
      });
      if (externalNoSri > 0) { sslScore -= 0.5; tests.push({ id: "sri-missing", name: "SRI manquant", category: "ssl", status: "warning", severity: "warning", value: `${externalNoSri}/${totalExternal} sans integrity`, recommendation: "Ajoutez l'attribut integrity aux ressources externes.", deduction: 0.5 }); }
    } else {
      sslScore -= 2; tests.push({ id: "no-https", name: "HTTPS", category: "ssl", status: "fail", severity: "critical", value: "Non", recommendation: "Migrez vers HTTPS.", deduction: 2 });
    }

    // ═══════════════════════════════════════════
    // CATEGORY 3: Information Leaks (16+ tests)
    // ═══════════════════════════════════════════

    // Server header + version detection
    const server = headers.get("server");
    if (server) {
      const hasVersion = /\d+\.\d+/.test(server);
      const ded = hasVersion ? 0.5 : 0.3;
      infoLeakScore -= ded;
      tests.push({ id: "server-exposed", name: "Server header", category: "info_leak", status: hasVersion ? "fail" : "warning", severity: hasVersion ? "warning" : "info", value: server, recommendation: "Masquez le header Server.", deduction: ded });
    }

    // X-Powered-By
    if (headers.get("x-powered-by")) { infoLeakScore -= 0.5; tests.push({ id: "powered-by", name: "X-Powered-By", category: "info_leak", status: "warning", severity: "warning", value: headers.get("x-powered-by")!, recommendation: "Supprimez X-Powered-By.", deduction: 0.5 }); }

    // ASP.NET version
    const aspnetVer = headers.get("x-aspnet-version") || headers.get("x-aspnetmvc-version");
    if (aspnetVer) { infoLeakScore -= 0.3; tests.push({ id: "aspnet-version", name: "Version ASP.NET exposée", category: "info_leak", status: "warning", severity: "warning", value: aspnetVer, deduction: 0.3 }); }

    // Sensitive files (expanded)
    const sensitiveFiles = [
      { path: "/.env", sev: "critical" }, { path: "/.env.local", sev: "critical" }, { path: "/.env.production", sev: "critical" },
      { path: "/.git/HEAD", sev: "critical" }, { path: "/.git/config", sev: "critical" }, { path: "/.svn/entries", sev: "critical" },
      { path: "/wp-config.php", sev: "critical" }, { path: "/wp-config.php.bak", sev: "critical" },
      { path: "/.htpasswd", sev: "critical" }, { path: "/phpinfo.php", sev: "critical" },
      { path: "/.npmrc", sev: "critical" }, { path: "/backup.sql", sev: "critical" }, { path: "/dump.sql", sev: "critical" },
      { path: "/credentials.json", sev: "critical" },
      { path: "/.htaccess", sev: "warning" }, { path: "/.DS_Store", sev: "warning" },
      { path: "/web.config", sev: "warning" }, { path: "/composer.json", sev: "warning" },
      { path: "/package.json", sev: "warning" }, { path: "/docker-compose.yml", sev: "warning" },
      { path: "/error_log", sev: "warning" }, { path: "/debug.log", sev: "warning" },
    ];
    const fileChecks = sensitiveFiles.map(async (file) => {
      const fileRes = await fetchWithTimeout(new URL(file.path, baseUrl).href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 5000);
      if (fileRes && fileRes.status === 200) {
        const ct = fileRes.headers.get("content-type") || "";
        if (!ct.includes("text/html")) {
          const ded = file.sev === "critical" ? 2 : 0.5;
          infoLeakScore -= ded;
          tests.push({ id: `sensitive-${file.path}`, name: `Fichier sensible: ${file.path}`, category: "info_leak", status: "fail", severity: file.sev as "critical" | "warning", value: "Accessible", recommendation: `Bloquez l'accès à ${file.path}.`, deduction: ded });
        }
      }
    });
    await Promise.allSettled(fileChecks);

    // Admin panels
    const adminPaths = ["/admin", "/admin/", "/administrator", "/wp-admin", "/wp-login.php", "/phpmyadmin", "/adminer.php", "/cpanel"];
    const adminChecks = adminPaths.map(async (path) => {
      const adminRes = await fetchWithTimeout(new URL(path, baseUrl).href, { redirect: "manual", headers: { "User-Agent": "AIFriendly/1.0" } }, 5000);
      if (adminRes && (adminRes.status === 200 || adminRes.status === 401 || adminRes.status === 403)) {
        infoLeakScore -= 0.3;
        tests.push({ id: `admin-${path.replace(/\//g, "-")}`, name: `Admin: ${path}`, category: "info_leak", status: "warning", severity: "warning", value: `HTTP ${adminRes.status}`, recommendation: `Restreignez l'accès à ${path} par IP/VPN.`, deduction: 0.3 });
      }
    });
    await Promise.allSettled(adminChecks);

    // API docs exposed
    const apiDocPaths = ["/swagger", "/swagger-ui", "/swagger-ui.html", "/api-docs", "/graphql", "/graphiql"];
    const apiChecks = apiDocPaths.map(async (path) => {
      const apiRes = await fetchWithTimeout(new URL(path, baseUrl).href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 5000);
      if (apiRes && apiRes.status === 200) {
        infoLeakScore -= 0.5;
        tests.push({ id: `api-docs-${path.replace(/\//g, "-")}`, name: `API docs: ${path}`, category: "info_leak", status: "warning", severity: "warning", value: "Accessible", recommendation: `Protégez ${path} par authentification.`, deduction: 0.5 });
      }
    });
    await Promise.allSettled(apiChecks);

    // Directory listing
    for (const dirPath of ["/icons/", "/images/", "/uploads/", "/static/"]) {
      const dirRes = await fetchWithTimeout(new URL(dirPath, baseUrl).href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 5000);
      if (dirRes && dirRes.status === 200) {
        const dirBody = await dirRes.text();
        if (dirBody.includes("Index of") || dirBody.includes("Directory listing") || dirBody.includes("[To Parent Directory]")) {
          infoLeakScore -= 1;
          tests.push({ id: `dir-listing`, name: `Directory listing: ${dirPath}`, category: "info_leak", status: "fail", severity: "critical", value: "Activé", recommendation: "Désactivez le directory listing.", deduction: 1 });
          break;
        }
      }
    }

    // robots.txt sensitive paths
    const robotsRes = await fetchWithTimeout(new URL("/robots.txt", baseUrl).href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 5000);
    if (robotsRes && robotsRes.status === 200) {
      const robotsTxt = await robotsRes.text();
      const exposed = ["/admin", "/api/internal", "/backup", "/phpmyadmin", "/cpanel", "/wp-admin", "/private", "/secret", "/database"].filter(p => robotsTxt.toLowerCase().includes(p));
      if (exposed.length > 0) { infoLeakScore -= 0.5; tests.push({ id: "robots-sensitive", name: "robots.txt expose chemins sensibles", category: "info_leak", status: "warning", severity: "warning", value: exposed.join(", "), deduction: 0.5 }); }
    }

    // HTML comments with sensitive info
    const commentRegex = /<!--([\s\S]*?)-->/g;
    let commentMatch;
    const sensitiveKw = ["password", "pwd", "secret", "api_key", "apikey", "token", "credentials", "private_key", "access_key"];
    while ((commentMatch = commentRegex.exec(html)) !== null) {
      if (sensitiveKw.some(kw => commentMatch![1].toLowerCase().includes(kw))) {
        infoLeakScore -= 1.5;
        tests.push({ id: "html-comments-sensitive", name: "Commentaires HTML sensibles", category: "info_leak", status: "fail", severity: "critical", value: "Termes sensibles dans les commentaires HTML", recommendation: "Supprimez les commentaires contenant des infos sensibles.", deduction: 1.5 });
        break;
      }
    }

    // Meta generator
    const generator = $('meta[name="generator"]').attr("content");
    if (generator) { infoLeakScore -= 0.3; tests.push({ id: "meta-generator", name: "Meta generator", category: "info_leak", status: "warning", severity: "warning", value: generator, recommendation: "Supprimez la balise meta generator.", deduction: 0.3 }); }

    // Stack trace detection
    const stackPatterns = ["Traceback (most recent call last)", "Fatal error:", "Stack trace:", "java.lang.", "System.NullReferenceException", "Warning: mysql_", "Warning: pg_", "Parse error: syntax error", "SQLSTATE"];
    if (stackPatterns.some(p => html.includes(p))) {
      infoLeakScore -= 2;
      tests.push({ id: "stack-trace", name: "Stack trace exposée", category: "info_leak", status: "fail", severity: "critical", value: "Traces d'erreur visibles dans le HTML", recommendation: "Désactivez le mode debug en production.", deduction: 2 });
    }

    // Source maps
    if (html.includes("sourceMappingURL")) { infoLeakScore -= 0.5; tests.push({ id: "source-maps", name: "Source maps exposées", category: "info_leak", status: "warning", severity: "warning", value: "sourceMappingURL détecté", recommendation: "Supprimez les source maps en production.", deduction: 0.5 }); }

    // security.txt
    const secTxtRes = await fetchWithTimeout(new URL("/.well-known/security.txt", baseUrl).href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 5000);
    if (!secTxtRes || secTxtRes.status !== 200) {
      tests.push({ id: "security-txt-missing", name: "security.txt", category: "info_leak", status: "warning", severity: "info", value: "Absent", recommendation: "Créez /.well-known/security.txt (RFC 9116).", deduction: 0 });
    }

    // Server status pages
    for (const path of ["/server-status", "/server-info"]) {
      const sRes = await fetchWithTimeout(new URL(path, baseUrl).href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 5000);
      if (sRes && sRes.status === 200) {
        const body = await sRes.text();
        if (body.includes("Apache") || body.includes("Server Version")) {
          infoLeakScore -= 1;
          tests.push({ id: `server-page-${path.slice(1)}`, name: `Page serveur: ${path}`, category: "info_leak", status: "fail", severity: "critical", value: "Accessible", recommendation: `Bloquez l'accès à ${path}.`, deduction: 1 });
        }
      }
    }

    // ═══════════════════════════════════════════
    // CATEGORY 4: Cookies (6 tests)
    // ═══════════════════════════════════════════

    const setCookies = res.headers.getSetCookie?.() || [];
    if (setCookies.length > 0) {
      let insecure = false, noHttpOnly = false, noSameSite = false, weakSameSite = false, noPrefixes = false;
      const sessionNames: string[] = [];

      for (const c of setCookies) {
        const l = c.toLowerCase();
        const name = c.split("=")[0].trim();
        if (!l.includes("secure")) insecure = true;
        if (!l.includes("httponly")) noHttpOnly = true;
        if (!l.includes("samesite")) noSameSite = true;
        else if (l.includes("samesite=none")) weakSameSite = true;

        const isSession = ["session", "sess", "sid", "token", "auth", "jwt"].some(s => name.toLowerCase().includes(s));
        if (isSession) {
          sessionNames.push(name);
          if (!name.startsWith("__Secure-") && !name.startsWith("__Host-")) noPrefixes = true;
        }
      }

      if (insecure) { cookiesScore -= 1; tests.push({ id: "cookie-insecure", name: "Cookie Secure", category: "cookies", status: "fail", severity: "critical", value: "Absent", recommendation: "Ajoutez le flag Secure.", deduction: 1 }); }
      if (noHttpOnly) { cookiesScore -= 0.5; tests.push({ id: "cookie-httponly", name: "Cookie HttpOnly", category: "cookies", status: "warning", severity: "warning", value: "Absent", recommendation: "Ajoutez HttpOnly.", deduction: 0.5 }); }
      if (noSameSite) { cookiesScore -= 0.5; tests.push({ id: "cookie-samesite", name: "Cookie SameSite", category: "cookies", status: "warning", severity: "warning", value: "Absent", recommendation: "Ajoutez SameSite=Strict ou Lax.", deduction: 0.5 }); }
      if (weakSameSite) { cookiesScore -= 0.3; tests.push({ id: "cookie-samesite-none", name: "Cookie SameSite=None", category: "cookies", status: "warning", severity: "warning", value: "SameSite=None", recommendation: "Utilisez SameSite=Strict ou Lax.", deduction: 0.3 }); }
      if (noPrefixes && sessionNames.length > 0) { cookiesScore -= 0.2; tests.push({ id: "cookie-no-prefix", name: "Cookies session sans préfixe", category: "cookies", status: "warning", severity: "info", value: sessionNames.join(", "), recommendation: "Utilisez __Secure- ou __Host- pour les cookies sensibles.", deduction: 0.2 }); }
    }

    // ═══════════════════════════════════════════
    // CATEGORY 5: Injection / XSS (12+ tests)
    // ═══════════════════════════════════════════

    // CSRF check
    const forms = $("form");
    if (forms.length > 0) {
      let noCSRF = 0;
      forms.each((_, form) => {
        const $f = $(form);
        if ($f.attr("method")?.toLowerCase() === "post" && $f.find('input[name*="csrf"], input[name*="token"], input[name*="_token"], input[name*="nonce"]').length === 0) noCSRF++;
      });
      if (noCSRF > 0) { injectionScore -= 1; tests.push({ id: "no-csrf", name: "CSRF", category: "injection", status: "fail", severity: "critical", value: `${noCSRF} form(s) sans CSRF`, recommendation: "Ajoutez un token CSRF.", deduction: 1 }); }
    }

    // Reflected XSS
    const xssUrl = new URL(targetUrl);
    const canary = "aifriendly_probe_12345";
    xssUrl.searchParams.set("q", canary);
    xssUrl.searchParams.set("search", canary);
    const xssRes = await fetchWithTimeout(xssUrl.href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 10000);
    if (xssRes) {
      const xssBody = await xssRes.text();
      if (xssBody.includes(canary)) {
        const isInTag = xssBody.includes(`"${canary}"`) || xssBody.includes(`'${canary}'`) || xssBody.includes(`=${canary}`);
        injectionScore -= isInTag ? 2 : 1;
        tests.push({ id: "reflected", name: "XSS réfléchi", category: "injection", status: "fail", severity: "critical", value: isInTag ? "Réfléchi dans un attribut HTML" : "Entrée réfléchie détectée", recommendation: "Échappez toutes les entrées utilisateur.", deduction: isInTag ? 2 : 1 });
      }
    }

    // HTML injection
    const htmlCanary = "<b>aifriendly_html_test</b>";
    const htmlUrl = new URL(targetUrl);
    htmlUrl.searchParams.set("q", htmlCanary);
    const htmlRes = await fetchWithTimeout(htmlUrl.href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 10000);
    if (htmlRes) {
      const htmlBody = await htmlRes.text();
      if (htmlBody.includes(htmlCanary)) { injectionScore -= 1.5; tests.push({ id: "html-injection", name: "Injection HTML", category: "injection", status: "fail", severity: "critical", value: "HTML injecté rendu sans échappement", recommendation: "Échappez toutes les entrées.", deduction: 1.5 }); }
    }

    // Open redirect (expanded params)
    const redirectParams = ["redirect", "url", "next", "return", "returnUrl", "return_to", "goto", "continue", "dest", "destination", "redir", "redirect_uri", "callback"];
    let openRedirectFound = false;
    for (const param of redirectParams) {
      if (openRedirectFound) break;
      const redUrl = new URL(targetUrl);
      redUrl.searchParams.set(param, "https://evil.com");
      const redRes = await fetchWithTimeout(redUrl.href, { redirect: "manual", headers: { "User-Agent": "AIFriendly/1.0" } }, 10000);
      if (redRes && redRes.status >= 300 && redRes.status < 400) {
        const loc = redRes.headers.get("location") || "";
        if (loc.includes("evil.com")) {
          injectionScore -= 1;
          tests.push({ id: "open-redirect", name: "Open redirect", category: "injection", status: "fail", severity: "critical", value: `Via paramètre '${param}'`, recommendation: "Validez les URLs de redirection avec une whitelist.", deduction: 1 });
          openRedirectFound = true;
        }
      }
    }

    // SQL injection (error-based)
    const sqlPayloads = ["'", "1' OR '1'='1", "1; DROP TABLE"];
    const sqlErrors = ["SQL syntax", "mysql_fetch", "pg_query", "ORA-", "SQLSTATE", "unterminated quoted string", "valid MySQL result", "PostgreSQL query failed"];
    let sqlFound = false;
    for (const payload of sqlPayloads) {
      if (sqlFound) break;
      const sqlUrl = new URL(targetUrl);
      sqlUrl.searchParams.set("id", payload);
      const sqlRes = await fetchWithTimeout(sqlUrl.href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 10000);
      if (sqlRes) {
        const sqlBody = await sqlRes.text();
        if (sqlErrors.some(p => sqlBody.includes(p))) {
          injectionScore -= 2;
          tests.push({ id: "sql-injection", name: "Injection SQL potentielle", category: "injection", status: "fail", severity: "critical", value: "Erreurs SQL en réponse à des caractères spéciaux", recommendation: "Utilisez des requêtes préparées.", deduction: 2 });
          sqlFound = true;
        }
      }
    }

    // Path traversal
    const ptUrl = new URL(targetUrl);
    ptUrl.searchParams.set("file", "../../etc/passwd");
    const ptRes = await fetchWithTimeout(ptUrl.href, { headers: { "User-Agent": "AIFriendly/1.0" } }, 10000);
    if (ptRes) {
      const ptBody = await ptRes.text();
      if (ptBody.includes("root:x:") || ptBody.includes("/bin/bash")) {
        injectionScore -= 2;
        tests.push({ id: "path-traversal", name: "Path traversal", category: "injection", status: "fail", severity: "critical", value: "Fichiers système accessibles via chemins relatifs", recommendation: "Validez et assainissez tous les chemins de fichiers.", deduction: 2 });
      }
    }

    // CORS misconfiguration
    const corsRes = await fetchWithTimeout(targetUrl, { headers: { "User-Agent": "AIFriendly/1.0", "Origin": "https://evil-attacker.com" } }, 10000);
    if (corsRes) {
      const acao = corsRes.headers.get("access-control-allow-origin");
      const acac = corsRes.headers.get("access-control-allow-credentials");
      if (acao === "*") { injectionScore -= 0.5; tests.push({ id: "cors-wildcard", name: "CORS wildcard", category: "injection", status: "warning", severity: "warning", value: "Access-Control-Allow-Origin: *", recommendation: "Restreignez CORS aux domaines de confiance.", deduction: 0.5 }); }
      else if (acao?.includes("evil-attacker.com")) {
        injectionScore -= 1.5;
        tests.push({ id: "cors-reflection", name: "CORS réflexion d'origine", category: "injection", status: "fail", severity: "critical", value: "Le serveur reflète toute origine", recommendation: "Utilisez une whitelist stricte.", deduction: 1.5 });
        if (acac === "true") { injectionScore -= 0.5; tests.push({ id: "cors-credentials", name: "CORS + credentials", category: "injection", status: "fail", severity: "critical", value: "Allow-Credentials:true + réflexion", recommendation: "Ne combinez jamais réflexion d'origine avec credentials:true.", deduction: 0.5 }); }
      }
    }

    // TRACE method
    const traceRes = await fetchWithTimeout(targetUrl, { method: "TRACE", headers: { "User-Agent": "AIFriendly/1.0" } }, 10000);
    if (traceRes && traceRes.status === 200) {
      const traceBody = await traceRes.text();
      if (traceBody.includes("TRACE")) { injectionScore -= 0.5; tests.push({ id: "trace-enabled", name: "TRACE activé (XST)", category: "injection", status: "fail", severity: "warning", value: "Méthode TRACE activée", recommendation: "Désactivez TRACE.", deduction: 0.5 }); }
    }

    // Dangerous HTTP methods
    for (const method of ["PUT", "DELETE"]) {
      const mRes = await fetchWithTimeout(targetUrl, { method, headers: { "User-Agent": "AIFriendly/1.0" } }, 10000);
      if (mRes && [200, 201, 204].includes(mRes.status)) { injectionScore -= 0.5; tests.push({ id: `method-${method.toLowerCase()}`, name: `Méthode ${method} autorisée`, category: "injection", status: "warning", severity: "warning", value: `HTTP ${mRes.status}`, recommendation: `Restreignez ${method} par authentification.`, deduction: 0.5 }); }
    }

    // DOM XSS indicators
    const domPatterns = ["document.write(", ".innerHTML =", ".innerHTML=", ".outerHTML =", "eval("];
    const foundDom = domPatterns.filter(p => html.includes(p));
    if (foundDom.length > 0) { injectionScore -= 0.5; tests.push({ id: "dom-xss", name: "Patterns DOM XSS", category: "injection", status: "warning", severity: "warning", value: foundDom.join(", "), recommendation: "Utilisez textContent et les API DOM sécurisées.", deduction: 0.5 }); }

    // JSONP detection
    const jsonpRes = await fetchWithTimeout(`${targetUrl}${targetUrl.includes("?") ? "&" : "?"}callback=aifriendly_jsonp_test`, { headers: { "User-Agent": "AIFriendly/1.0" } }, 10000);
    if (jsonpRes) {
      const jsonpBody = await jsonpRes.text();
      if (jsonpBody.includes("aifriendly_jsonp_test(")) { injectionScore -= 0.5; tests.push({ id: "jsonp", name: "Endpoint JSONP", category: "injection", status: "warning", severity: "warning", value: "Endpoint JSONP détecté", recommendation: "Remplacez JSONP par CORS.", deduction: 0.5 }); }
    }

    // External form actions
    let extForms = 0;
    $("form[action]").each((_, form) => {
      const action = $(form).attr("action") || "";
      if (action.startsWith("http") && !action.includes(new URL(targetUrl).hostname)) extForms++;
    });
    if (extForms > 0) { injectionScore -= 0.5; tests.push({ id: "external-form", name: "Formulaires vers domaine externe", category: "injection", status: "warning", severity: "warning", value: `${extForms} formulaire(s)`, recommendation: "Vérifiez la légitimité des domaines externes.", deduction: 0.5 }); }

    // Passwords on HTTP
    if (!targetUrl.startsWith("https://") && $('input[type="password"]').length > 0) {
      injectionScore -= 1;
      tests.push({ id: "password-no-https", name: "Mots de passe sans HTTPS", category: "injection", status: "fail", severity: "critical", value: "Champs password sur HTTP", recommendation: "Les formulaires de connexion doivent être en HTTPS.", deduction: 1 });
    }

    // Charset in Content-Type
    const ct = headers.get("content-type");
    if (ct && !ct.includes("charset")) { injectionScore -= 0.1; tests.push({ id: "no-charset", name: "Charset absent", category: "injection", status: "warning", severity: "info", value: ct, recommendation: "Ajoutez charset=utf-8.", deduction: 0.1 }); }

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

/**
 * Creates a named loop that waits for the task to complete before scheduling
 * the next run. Prevents overlapping executions that cause resource exhaustion.
 */
function startLoop(name: string, intervalMs: number, task: () => Promise<void>): void {
  const run = async () => {
    while (true) {
      try {
        await task();
      } catch (err) {
        console.error(`[${name}] Loop error:`, err);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  run();
}

async function main() {
  console.log("AI Friendly Worker started (v3.1 — sequential loops).");
  console.log(`  AI analysis interval: ${AI_CHECK_INTERVAL_MS / 1000}s`);
  console.log(`  Availability check interval: ${AVAILABILITY_INTERVAL_MS / 1000}s`);
  console.log(`  Security scan interval: ${SECURITY_INTERVAL_MS / 1000}s`);
  console.log(`  Retention: ${RETENTION_DAYS} days`);
  console.log(`  LLM analysis: ${LLM_ENABLED ? `enabled (${VLLM_API_URL}, model: ${VLLM_MODEL})` : "disabled (heuristic only)"}`);

  // Each loop waits for the previous run to finish before sleeping then re-running.
  // No overlap possible within a single loop.
  startLoop("AI",      AI_CHECK_INTERVAL_MS,    processAIAnalysis);
  startLoop("AVAIL",   AVAILABILITY_INTERVAL_MS, processAvailabilityChecks);
  startLoop("SEC",     SECURITY_INTERVAL_MS,     processSecurityScans);
  startLoop("Cleanup", CLEANUP_INTERVAL_MS,      cleanupOldData);
}

main().catch((err) => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
