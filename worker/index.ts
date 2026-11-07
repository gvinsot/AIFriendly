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
import { createHash } from "crypto";
import { assertPatchedNodeRuntime, installBrotliSafeFetch } from "./lib/node-security.js";
import { safeFetch, readBodyLimited } from "./lib/ssrf-guard.js";
// Scanner de sécurité partagé avec la webapp et le serveur MCP : les scans
// planifiés exécutent exactement les mêmes tests que les scans manuels.
import { scanSecurity } from "./lib/security-scanner.js";

// Mitigation CVE-2026-111497 (Node2Shell) — voir webapp/lib/node-security.ts
assertPatchedNodeRuntime("aifriendly-worker");
installBrotliSafeFetch();

const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════════
// LLM CONFIGURATION (vLLM / OpenAI-compatible)
// ═══════════════════════════════════════════════════════════════
const RAW_VLLM_API_URL = process.env.VLLM_API_URL || "";   // e.g. http://vllm:8000/v1
// Normalize: ensure base URL ends with /v1 for OpenAI-compatible API
const VLLM_API_URL = RAW_VLLM_API_URL
  ? RAW_VLLM_API_URL.replace(/\/+$/, "").replace(/\/v1$/, "") + "/v1"
  : "";
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
    const res = await safeFetch(fileUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "AIFriendly/1.0 (Worker)" },
      maxBodyBytes: 50000,
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
    const res = await safeFetch(url, { ...options, signal: controller.signal });
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
// LLM CALL OPTIMIZATION
// ═══════════════════════════════════════════════════════════════

/** Minimum content length (chars) to justify an LLM call */
const LLM_MIN_CONTENT_LENGTH = 200;

/** Delay between consecutive LLM calls to avoid vLLM overload */
const LLM_CALL_DELAY_MS = parseInt(process.env.LLM_CALL_DELAY_MS || "5000", 10);

/** Compute a stable hash of the text content sent to the LLM */
function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Parse frequency string to milliseconds */
function frequencyToMs(freq: string): number {
  switch (freq) {
    case "6h":      return 6 * 60 * 60 * 1000;
    case "daily":   return 24 * 60 * 60 * 1000;
    case "weekly":  return 7 * 24 * 60 * 60 * 1000;
    case "monthly": return 30 * 24 * 60 * 60 * 1000;
    default:        return 24 * 60 * 60 * 1000;
  }
}

/** Simple sequential queue to limit LLM concurrency to 1 at a time */
let llmQueuePromise = Promise.resolve();
function enqueueLLMCall<T>(fn: () => Promise<T>): Promise<T> {
  const result = llmQueuePromise.then(async () => {
    await new Promise(r => setTimeout(r, LLM_CALL_DELAY_MS));
    return fn();
  });
  llmQueuePromise = result.then(() => {}, () => {});
  return result;
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
      const body = await res.text().catch(() => "");
      console.error(`  [LLM] API error: ${res.status} ${res.statusText} — URL: ${VLLM_API_URL}/chat/completions, model: ${VLLM_MODEL}${body ? `, body: ${body.slice(0, 200)}` : ""}`);
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

interface PreviousLLMResult {
  contentHash: string;
  llmScores: LLMScores | null;
}

async function analyzeUrl(targetUrl: string, previousResult?: PreviousLLMResult) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await safeFetch(targetUrl, {
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

  const { text: rawHtml, truncated } = await readBodyLimited(res, MAX_HTML_BYTES);
  if (truncated) throw new Error("Page too large");

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
  // Compute content hash to detect unchanged pages
  const currentHash = contentHash(mainClean);

  // Skip LLM if content is too short for meaningful analysis
  // or if content hasn't changed since last analysis (reuse cached scores)
  let llmResult: LLMScores | null = null;
  if (mainClean.length < LLM_MIN_CONTENT_LENGTH) {
    console.log(`    -> LLM skipped: content too short (${mainClean.length} chars)`);
  } else if (previousResult?.contentHash === currentHash && previousResult?.llmScores) {
    llmResult = previousResult.llmScores;
    console.log(`    -> LLM skipped: content unchanged (hash=${currentHash})`);
  } else {
    llmResult = await enqueueLLMCall(() => analyzWithLLM(mainClean, title, lang, targetUrl));
  }

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
      contentHash: currentHash,
      llmScores: llmResult,
    },
  };
}

async function processAIAnalysis() {
  const now = new Date();
  console.log(`[${now.toISOString()}] [AI] Checking sites for scheduled analysis...`);

  const sites = await prisma.site.findMany({
    where: { isActive: true },
    include: {
      analyses: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, details: true } },
    },
  });

  let analyzed = 0;
  let skipped = 0;
  for (const site of sites) {
    const lastAnalysis = site.analyses[0];
    // Respect site.frequency instead of fixed 1h interval
    const intervalMs = frequencyToMs(site.frequency);
    const isDue = !lastAnalysis?.createdAt || (now.getTime() - lastAnalysis.createdAt.getTime() > intervalMs);

    if (!isDue) {
      skipped++;
      continue;
    }

    console.log(`  [AI] Analyzing: ${site.name} (${site.url}) [freq=${site.frequency}]`);
    try {
      // Extract previous content hash and LLM scores for deduplication
      let previousResult: PreviousLLMResult | undefined;
      if (lastAnalysis?.details && typeof lastAnalysis.details === "object") {
        const details = lastAnalysis.details as Record<string, unknown>;
        if (details.contentHash && typeof details.contentHash === "string") {
          previousResult = {
            contentHash: details.contentHash,
            llmScores: (details.llmScores as LLMScores) || null,
          };
        }
      }

      const result = await analyzeUrl(site.url, previousResult);
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

  console.log(`  [AI] Done. Analyzed ${analyzed}/${sites.length} sites (${skipped} skipped, not due).`);
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
      await safeFetch(targetUrl, {
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
      const fullRes = await safeFetch(targetUrl, {
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
  console.log(`  LLM call delay: ${LLM_CALL_DELAY_MS}ms, min content: ${LLM_MIN_CONTENT_LENGTH} chars`);

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
