import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import type { AnalysisResult, Improvement, AIPreviewContent, BotAccessInfo } from "@/lib/types";
import { validateAndNormalizeUrl, isUrlSafeForFetch } from "@/lib/urlSecurity";
import { checkRateLimit } from "@/lib/rateLimit";

const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5 Mo max
const FETCH_TIMEOUT_MS = 15000;

// AI-specific user agents that might be blocked
const AI_BOT_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "Google-Extended",
  "CCBot",
  "anthropic-ai",
  "Claude-Web",
  "PerplexityBot",
  "Bytespider",
  "Amazonbot",
  "FacebookBot",
  "Applebot-Extended",
];

interface RobotsAnalysis {
  exists: boolean;
  blocksAI: string[];
  allowsAI: string[];
  hasSitemapReference: boolean;
}

interface SitemapAnalysis {
  exists: boolean;
  url: string | null;
}

interface LlmsTxtAnalysis {
  exists: boolean;
  content: string | null;
}

async function fetchTextFile(baseUrl: string, path: string, timeoutMs = 5000): Promise<string | null> {
  try {
    const fileUrl = new URL(path, baseUrl).href;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(fileUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "IAFriendly/1.0 (Analysis)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 50000); // Limit size
  } catch {
    return null;
  }
}

function analyzeRobotsTxt(content: string | null): RobotsAnalysis {
  if (!content) {
    return { exists: false, blocksAI: [], allowsAI: [], hasSitemapReference: false };
  }
  
  const lines = content.toLowerCase().split("\n");
  const blocksAI: string[] = [];
  const allowsAI: string[] = [];
  let hasSitemapReference = false;
  let currentUserAgent = "";
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("sitemap:")) {
      hasSitemapReference = true;
    }
    if (trimmed.startsWith("user-agent:")) {
      currentUserAgent = trimmed.replace("user-agent:", "").trim();
    }
    if (trimmed.startsWith("disallow:") && trimmed.includes("/")) {
      for (const bot of AI_BOT_AGENTS) {
        if (currentUserAgent === bot.toLowerCase() || currentUserAgent === "*") {
          if (currentUserAgent !== "*" && !blocksAI.includes(bot)) {
            blocksAI.push(bot);
          }
        }
      }
    }
    if (trimmed.startsWith("allow:")) {
      for (const bot of AI_BOT_AGENTS) {
        if (currentUserAgent === bot.toLowerCase() && !allowsAI.includes(bot)) {
          allowsAI.push(bot);
        }
      }
    }
  }
  
  return { exists: true, blocksAI, allowsAI, hasSitemapReference };
}

async function checkSitemap(baseUrl: string, robotsHasSitemap: boolean): Promise<SitemapAnalysis> {
  const sitemapPaths = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap/sitemap.xml"];
  for (const path of sitemapPaths) {
    const content = await fetchTextFile(baseUrl, path);
    if (content && (content.includes("<urlset") || content.includes("<sitemapindex"))) {
      return { exists: true, url: new URL(path, baseUrl).href };
    }
  }
  return { exists: false, url: null };
}

async function checkLlmsTxt(baseUrl: string): Promise<LlmsTxtAnalysis> {
  const content = await fetchTextFile(baseUrl, "/llms.txt");
  if (content && content.length > 10) {
    return { exists: true, content: content.slice(0, 2000) };
  }
  return { exists: false, content: null };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeYamlString(s: string): string {
  if (/[\n"\\]/.test(s)) return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  return s;
}

function buildAiPreviewYaml(preview: AIPreviewContent): string {
  const lines: string[] = [];
  lines.push("# Aperçu structuré tel que vu par une IA (format YAML)");
  lines.push("");
  lines.push(`url: ${escapeYamlString(preview.url)}`);
  lines.push(`title: ${preview.title ? escapeYamlString(preview.title) : "null"}`);
  lines.push("meta:");
  lines.push(`  description: ${preview.meta.description ? escapeYamlString(preview.meta.description.slice(0, 200)) : "null"}`);
  lines.push(`  ogTitle: ${preview.meta.ogTitle ? escapeYamlString(preview.meta.ogTitle) : "null"}`);
  lines.push(`  ogDescription: ${preview.meta.ogDescription ? escapeYamlString((preview.meta.ogDescription || "").slice(0, 200)) : "null"}`);
  lines.push(`  ogImage: ${preview.meta.ogImage ? escapeYamlString(preview.meta.ogImage) : "null"}`);
  lines.push(`  ogType: ${preview.meta.ogType || "null"}`);
  lines.push(`  canonical: ${preview.meta.canonical ? escapeYamlString(preview.meta.canonical) : "null"}`);
  lines.push(`  twitterCard: ${preview.meta.twitterCard || "null"}`);
  lines.push(`lang: ${preview.lang ? escapeYamlString(preview.lang) : "null"}`);
  lines.push("structure:");
  lines.push("  headings:");
  for (const h of preview.headings.slice(0, 25)) {
    lines.push(`    - level: ${h.level}`);
    lines.push(`      text: ${escapeYamlString(h.text.slice(0, 120))}`);
  }
  lines.push(`  hasStructuredData: ${preview.structuredData}`);
  lines.push("  semanticHtml:");
  lines.push(`    hasNav: ${preview.semanticHtml.hasNav}`);
  lines.push(`    hasHeader: ${preview.semanticHtml.hasHeader}`);
  lines.push(`    hasMain: ${preview.semanticHtml.hasMain}`);
  lines.push(`    hasArticle: ${preview.semanticHtml.hasArticle}`);
  lines.push(`    hasFooter: ${preview.semanticHtml.hasFooter}`);
  lines.push("botAccess:");
  lines.push(`  robotsTxt: ${preview.botAccess.robotsTxt.exists}`);
  lines.push(`  sitemap: ${preview.botAccess.sitemap.exists}`);
  lines.push(`  llmsTxt: ${preview.botAccess.llmsTxt.exists}`);
  lines.push(`  blockedAIBots: [${preview.botAccess.robotsTxt.blocksAI.join(", ")}]`);
  lines.push("  metaRobots:");
  lines.push(`    noindex: ${preview.botAccess.metaRobots.noindex}`);
  lines.push(`    nofollow: ${preview.botAccess.metaRobots.nofollow}`);
  lines.push(`    nosnippet: ${preview.botAccess.metaRobots.nosnippet}`);
  lines.push(`    noai: ${preview.botAccess.metaRobots.noai}`);
  lines.push("content_preview: |");
  const content = preview.mainContent.slice(0, 1500).split("\n");
  for (const line of content) {
    lines.push("  " + (line || " "));
  }
  lines.push("");
  lines.push(`images_count: ${preview.images.length}`);
  lines.push(`links_count: ${preview.links.length}`);
  return lines.join("\n");
}

function safeJsonBody(request: NextRequest): Promise<unknown> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error("CONTENT_TYPE");
  }
  return request.json();
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(request);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Trop de requêtes. Réessayez dans quelques instants.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  try {
    let body: unknown;
    try {
      body = await safeJsonBody(request);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "CONTENT_TYPE") {
        return NextResponse.json(
          { error: "Content-Type doit être application/json." },
          { status: 415 }
        );
      }
      return NextResponse.json(
        { error: "Corps de requête JSON invalide." },
        { status: 400 }
      );
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Un objet avec une propriété 'url' est attendu." },
        { status: 400 }
      );
    }

    const urlInput = typeof (body as { url?: unknown }).url === "string" ? (body as { url: string }).url : "";
    const validation = validateAndNormalizeUrl(urlInput);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const url = validation.url.href;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "IAFriendly/1.0 (Analysis; +https://ia-friendly.vercel.app)",
        },
        redirect: "follow",
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!isUrlSafeForFetch(res.url)) {
      return NextResponse.json(
        { error: "Impossible d'analyser cette URL." },
        { status: 422 }
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Impossible d'accéder au site (HTTP ${res.status}).` },
        { status: 422 }
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return NextResponse.json(
        { error: "La réponse n'est pas une page HTML." },
        { status: 422 }
      );
    }

    const rawHtml = await res.text();
    if (rawHtml.length > MAX_HTML_BYTES) {
      return NextResponse.json(
        { error: "La page est trop volumineuse pour être analysée." },
        { status: 422 }
      );
    }

    const $ = cheerio.load(rawHtml);

    // Fetch robots.txt, sitemap, and llms.txt in parallel
    const baseUrl = new URL(url).origin;
    const [robotsTxtContent, llmsTxtResult] = await Promise.all([
      fetchTextFile(baseUrl, "/robots.txt"),
      checkLlmsTxt(baseUrl),
    ]);
    
    const robotsAnalysis = analyzeRobotsTxt(robotsTxtContent);
    const sitemapResult = await checkSitemap(baseUrl, robotsAnalysis.hasSitemapReference);

    const improvements: Improvement[] = [];
    let score = 10;
    const maxScore = 10;

    const title =
      $("title").first().text().trim() ||
      $('meta[property="og:title"]').attr("content")?.trim() ||
      null;
    const metaDesc = $('meta[name="description"]').attr("content")?.trim() || null;
    const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || null;
    const ogDesc = $('meta[property="og:description"]').attr("content")?.trim() || null;
    const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
    const lang = $("html").attr("lang") || null;

    if (!title || title.length < 10) {
      score -= 1.5;
      improvements.push({
        id: "title",
        title: "Titre de page manquant ou trop court",
        description:
          "Un titre explicite aide les IA à comprendre le sujet de la page.",
        severity: "critical",
        category: "Métadonnées",
        suggestion: "Ajoutez un <title> unique et descriptif (50–60 caractères).",
      });
    }

    if (!metaDesc || metaDesc.length < 50) {
      score -= 1;
      improvements.push({
        id: "meta-description",
        title: "Meta description absente ou trop courte",
        description: "La meta description est souvent utilisée comme résumé par les IA.",
        severity: metaDesc ? "warning" : "critical",
        category: "Métadonnées",
        suggestion:
          'Ajoutez <meta name="description" content="..."> (150–160 caractères).',
      });
    }

    const headings: { level: number; text: string }[] = [];
    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
      const level = parseInt(el.tagName[1], 10);
      const text = $(el).text().trim();
      if (text) headings.push({ level, text });
    });

    if (headings.filter((h) => h.level === 1).length === 0) {
      score -= 1;
      improvements.push({
        id: "h1",
        title: "Aucun titre H1",
        description: "Un seul H1 par page améliore la compréhension de la structure.",
        severity: "critical",
        category: "Structure",
        suggestion: "Utilisez un unique <h1> pour le titre principal de la page.",
      });
    }

    const mainContent =
      $("main").text().trim() ||
      $('article').first().text().trim() ||
      $("body").text().trim();
    const mainClean = stripHtml(mainContent).slice(0, 3000);
    if (mainClean.length < 100) {
      score -= 0.5;
      improvements.push({
        id: "content",
        title: "Peu de contenu texte détecté",
        description: "Les IA s'appuient sur le texte pour comprendre la page.",
        severity: "warning",
        category: "Contenu",
        suggestion: "Privilégiez le contenu dans <main> ou <article>.",
      });
    }

    const images: { src: string; alt: string | null }[] = [];
    let imagesWithoutAlt = 0;
    $("img").each((_, el) => {
      const src = $(el).attr("src");
      const alt = $(el).attr("alt");
      if (src) {
        const fullSrc = src.startsWith("http") ? src : new URL(src, url).href;
        images.push({ src: fullSrc, alt: alt?.trim() || null });
        if (!alt?.trim()) imagesWithoutAlt++;
      }
    });

    if (imagesWithoutAlt > 0) {
      score -= Math.min(0.5, imagesWithoutAlt * 0.2);
      improvements.push({
        id: "alt",
        title: `Images sans attribut alt (${imagesWithoutAlt})`,
        description: "L'attribut alt décrit l'image pour les IA et l'accessibilité.",
        severity: imagesWithoutAlt > 3 ? "warning" : "info",
        category: "Images",
        suggestion: 'Ajoutez un attribut alt descriptif à chaque <img>.',
      });
    }

    if (!lang) {
      score -= 0.3;
      improvements.push({
        id: "lang",
        title: "Langue du document non indiquée",
        description: "L'attribut lang sur <html> aide à l'interprétation du contenu.",
        severity: "info",
        category: "Métadonnées",
        suggestion: 'Ajoutez <html lang="fr"> (ou la langue appropriée).',
      });
    }

    // Test: robots.txt
    if (!robotsAnalysis.exists) {
      score -= 0.3;
      improvements.push({
        id: "robots-txt",
        title: "Fichier robots.txt absent",
        description: "Le robots.txt guide les crawlers sur les zones accessibles du site.",
        severity: "warning",
        category: "Accessibilité Bots",
        suggestion: "Créez un fichier robots.txt à la racine de votre site.",
      });
    } else if (robotsAnalysis.blocksAI.length > 0) {
      score -= 0.5;
      improvements.push({
        id: "robots-blocks-ai",
        title: `Crawlers IA bloqués (${robotsAnalysis.blocksAI.join(", ")})`,
        description: "Certains crawlers IA sont explicitement bloqués dans votre robots.txt.",
        severity: "warning",
        category: "Accessibilité Bots",
        suggestion: "Vérifiez si ce blocage est intentionnel. Sinon, autorisez ces agents.",
      });
    }

    // Test: Sitemap
    if (!sitemapResult.exists) {
      score -= 0.3;
      improvements.push({
        id: "sitemap",
        title: "Sitemap XML non trouvé",
        description: "Un sitemap aide les bots à découvrir et indexer toutes vos pages.",
        severity: "warning",
        category: "Accessibilité Bots",
        suggestion: "Créez un sitemap.xml et référencez-le dans votre robots.txt.",
      });
    }

    // Test: llms.txt (emerging standard for LLMs)
    if (llmsTxtResult.exists) {
      score += 0.2; // Bonus for having llms.txt
    } else {
      improvements.push({
        id: "llms-txt",
        title: "Fichier llms.txt absent",
        description: "Le llms.txt est un standard émergent pour guider les LLM sur votre site.",
        severity: "info",
        category: "Accessibilité Bots",
        suggestion: "Créez un fichier llms.txt avec des instructions pour les IA.",
      });
    }

    // Test: Meta robots restrictions
    const metaRobots = $('meta[name="robots"]').attr("content")?.toLowerCase() || "";
    const xRobotsTag = $('meta[name="googlebot"]').attr("content")?.toLowerCase() || "";
    const hasNoindex = metaRobots.includes("noindex") || xRobotsTag.includes("noindex");
    const hasNofollow = metaRobots.includes("nofollow") || xRobotsTag.includes("nofollow");
    const hasNosnippet = metaRobots.includes("nosnippet");
    const hasNoai = metaRobots.includes("noai") || metaRobots.includes("noimageai");
    
    if (hasNoindex) {
      score -= 1;
      improvements.push({
        id: "noindex",
        title: "Page marquée noindex",
        description: "Cette page ne sera pas indexée par les moteurs de recherche ni les IA.",
        severity: "critical",
        category: "Accessibilité Bots",
        suggestion: "Retirez noindex si vous souhaitez que la page soit visible des IA.",
      });
    }
    if (hasNosnippet) {
      improvements.push({
        id: "nosnippet",
        title: "Snippets désactivés (nosnippet)",
        description: "Les IA ne pourront pas générer d'extraits de votre contenu.",
        severity: "info",
        category: "Accessibilité Bots",
        suggestion: "Retirez nosnippet pour permettre aux IA d'afficher des extraits.",
      });
    }
    if (hasNoai) {
      improvements.push({
        id: "noai",
        title: "Balise noai détectée",
        description: "Vous avez explicitement demandé l'exclusion de l'entraînement IA.",
        severity: "info",
        category: "Accessibilité Bots",
        suggestion: "Vérifiez si cette restriction correspond à votre intention.",
      });
    }

    // Test: Semantic HTML elements
    const hasNav = $("nav").length > 0;
    const hasHeader = $("header").length > 0;
    const hasFooter = $("footer").length > 0;
    const hasMain = $("main").length > 0;
    const hasArticle = $("article").length > 0;
    const hasSection = $("section").length > 0;
    const hasAside = $("aside").length > 0;
    const semanticElementsCount = [hasNav, hasHeader, hasFooter, hasMain, hasArticle, hasSection].filter(Boolean).length;
    
    if (semanticElementsCount < 3) {
      score -= 0.5;
      improvements.push({
        id: "semantic-html",
        title: "Peu de balises HTML sémantiques",
        description: "Les balises sémantiques (nav, header, main, article, section, footer) aident les IA à comprendre la structure.",
        severity: "warning",
        category: "Structure",
        suggestion: "Utilisez des balises sémantiques HTML5 pour structurer votre contenu.",
      });
    }

    // Test: Heading hierarchy
    const h1Count = headings.filter((h) => h.level === 1).length;
    const h2Count = headings.filter((h) => h.level === 2).length;
    const headingLevels = headings.map((h) => h.level);
    let hasSkippedLevel = false;
    for (let i = 1; i < headingLevels.length; i++) {
      if (headingLevels[i] - headingLevels[i - 1] > 1) {
        hasSkippedLevel = true;
        break;
      }
    }
    
    if (h1Count > 1) {
      score -= 0.3;
      improvements.push({
        id: "multiple-h1",
        title: `Plusieurs H1 détectés (${h1Count})`,
        description: "Une page ne devrait avoir qu'un seul H1 pour clarifier le sujet principal.",
        severity: "warning",
        category: "Structure",
        suggestion: "Gardez un seul <h1> et utilisez <h2>-<h6> pour les sous-sections.",
      });
    }
    if (hasSkippedLevel) {
      improvements.push({
        id: "heading-hierarchy",
        title: "Hiérarchie des titres incohérente",
        description: "Des niveaux de titre sont sautés (ex: H1 → H3), ce qui peut dérouter les IA.",
        severity: "info",
        category: "Structure",
        suggestion: "Respectez une progression logique: H1 → H2 → H3, etc.",
      });
    }

    // Test: Open Graph completeness
    const ogImage = $('meta[property="og:image"]').attr("content")?.trim() || null;
    const ogType = $('meta[property="og:type"]').attr("content")?.trim() || null;
    const ogUrl = $('meta[property="og:url"]').attr("content")?.trim() || null;
    const ogSiteName = $('meta[property="og:site_name"]').attr("content")?.trim() || null;
    const missingOg: string[] = [];
    if (!ogImage) missingOg.push("og:image");
    if (!ogType) missingOg.push("og:type");
    if (!ogTitle && !title) missingOg.push("og:title");
    
    if (missingOg.length > 0) {
      score -= Math.min(0.5, missingOg.length * 0.15);
      improvements.push({
        id: "open-graph",
        title: `Balises Open Graph manquantes (${missingOg.join(", ")})`,
        description: "Open Graph améliore le partage social et la compréhension par les IA.",
        severity: missingOg.length > 1 ? "warning" : "info",
        category: "Métadonnées",
        suggestion: "Ajoutez les balises og:title, og:description, og:image et og:type.",
      });
    }

    // Test: Twitter Card
    const twitterCard = $('meta[name="twitter:card"]').attr("content")?.trim() || null;
    if (!twitterCard && ogImage) {
      improvements.push({
        id: "twitter-card",
        title: "Balises Twitter Card absentes",
        description: "Les Twitter Cards améliorent l'affichage sur les réseaux sociaux.",
        severity: "info",
        category: "Métadonnées",
        suggestion: 'Ajoutez <meta name="twitter:card" content="summary_large_image">.',
      });
    }

    const hasStructuredData =
      $('script[type="application/ld+json"]').length > 0;
    if (!hasStructuredData && mainClean.length > 500) {
      improvements.push({
        id: "structured-data",
        title: "Aucune donnée structurée (JSON-LD)",
        description: "Le JSON-LD améliore la compréhension sémantique par les IA.",
        severity: "info",
        category: "Structure",
        suggestion:
          "Envisagez d'ajouter du JSON-LD (Schema.org) pour les articles, produits, etc.",
      });
    }

    const links: { href: string; text: string }[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href && (href.startsWith("http") || href.startsWith("/"))) {
        const fullHref = href.startsWith("http") ? href : new URL(href, url).href;
        links.push({ href: fullHref, text: text || fullHref });
      }
    });

    const botAccessInfo: BotAccessInfo = {
      robotsTxt: robotsAnalysis,
      sitemap: sitemapResult,
      llmsTxt: llmsTxtResult,
      metaRobots: {
        noindex: hasNoindex,
        nofollow: hasNofollow,
        nosnippet: hasNosnippet,
        noai: hasNoai,
      },
    };

    const aiPreview: AIPreviewContent = {
      url,
      title,
      meta: {
        description: metaDesc,
        ogTitle,
        ogDescription: ogDesc,
        ogImage,
        ogType,
        canonical,
        twitterCard,
      },
      headings,
      mainContent: mainClean.slice(0, 2000),
      images: images.slice(0, 20),
      links: links.slice(0, 30),
      structuredData: hasStructuredData,
      semanticHtml: {
        hasNav,
        hasHeader,
        hasFooter,
        hasMain,
        hasArticle,
        hasSection,
        hasAside,
      },
      lang,
      botAccess: botAccessInfo,
    };

    const aiPreviewYaml = buildAiPreviewYaml(aiPreview);

    const finalScore = Math.max(0, Math.min(maxScore, Math.round(score * 10) / 10));
    const analyzedAt = new Date().toISOString();

    const result: AnalysisResult = {
      url,
      score: finalScore,
      maxScore,
      improvements,
      aiPreview,
      aiPreviewYaml,
      botAccess: botAccessInfo,
      analyzedAt,
    };

    return NextResponse.json(result);
  } catch (err) {
    const isAbort =
      (err as { name?: string }).name === "AbortError" ||
      (err instanceof Error && err.message.includes("abort"));
    const safeMessage = isAbort
      ? "La requête a expiré. Le site est peut-être trop lent."
      : "Une erreur est survenue lors de l'analyse. Réessayez plus tard.";
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
