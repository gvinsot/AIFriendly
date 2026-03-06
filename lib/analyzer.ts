import * as cheerio from "cheerio";

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;

const AI_BOT_AGENTS = [
  "GPTBot", "ChatGPT-User", "Google-Extended", "CCBot",
  "anthropic-ai", "Claude-Web", "PerplexityBot", "Bytespider",
  "Amazonbot", "FacebookBot", "Applebot-Extended",
];

interface Improvement {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  category: string;
  suggestion?: string;
}

interface RobotsAnalysis {
  exists: boolean;
  blocksAI: string[];
  allowsAI: string[];
  hasSitemapReference: boolean;
}

interface AnalysisOutput {
  url: string;
  score: number;
  maxScore: number;
  improvements: Improvement[];
  aiPreviewYaml: string;
  botAccess: Record<string, unknown>;
  analyzedAt: string;
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
    return text.slice(0, 50000);
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
    if (trimmed.startsWith("sitemap:")) hasSitemapReference = true;
    if (trimmed.startsWith("user-agent:")) {
      currentUserAgent = trimmed.replace("user-agent:", "").trim();
    }
    if (trimmed.startsWith("disallow:") && trimmed.includes("/")) {
      for (const bot of AI_BOT_AGENTS) {
        if (currentUserAgent === bot.toLowerCase() || currentUserAgent === "*") {
          if (currentUserAgent !== "*" && !blocksAI.includes(bot)) blocksAI.push(bot);
        }
      }
    }
    if (trimmed.startsWith("allow:")) {
      for (const bot of AI_BOT_AGENTS) {
        if (currentUserAgent === bot.toLowerCase() && !allowsAI.includes(bot)) allowsAI.push(bot);
      }
    }
  }
  return { exists: true, blocksAI, allowsAI, hasSitemapReference };
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

export async function analyzeUrl(targetUrl: string): Promise<AnalysisOutput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "IAFriendly/1.0 (Analysis; +https://aifriendly.fr)" },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error("Not HTML");
  }

  const rawHtml = await res.text();
  if (rawHtml.length > MAX_HTML_BYTES) throw new Error("Page too large");

  const $ = cheerio.load(rawHtml);
  const baseUrl = new URL(targetUrl).origin;

  const [robotsTxtContent, llmsTxtContent] = await Promise.all([
    fetchTextFile(baseUrl, "/robots.txt"),
    fetchTextFile(baseUrl, "/llms.txt"),
  ]);

  const robotsAnalysis = analyzeRobotsTxt(robotsTxtContent);
  const llmsTxtExists = !!(llmsTxtContent && llmsTxtContent.length > 10);

  // Check sitemap
  let sitemapExists = false;
  const sitemapPaths = ["/sitemap.xml", "/sitemap_index.xml"];
  for (const path of sitemapPaths) {
    const content = await fetchTextFile(baseUrl, path);
    if (content && (content.includes("<urlset") || content.includes("<sitemapindex"))) {
      sitemapExists = true;
      break;
    }
  }

  const improvements: Improvement[] = [];
  let score = 10;
  const maxScore = 10;

  const title = $("title").first().text().trim() || $('meta[property="og:title"]').attr("content")?.trim() || null;
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() || null;
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || null;
  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim() || null;
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim() || null;
  const ogType = $('meta[property="og:type"]').attr("content")?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const twitterCard = $('meta[name="twitter:card"]').attr("content")?.trim() || null;
  const lang = $("html").attr("lang") || null;

  if (!title || title.length < 10) {
    score -= 1.5;
    improvements.push({ id: "title", title: "Titre de page manquant ou trop court", description: "Un titre explicite aide les IA à comprendre le sujet de la page.", severity: "critical", category: "Métadonnées", suggestion: "Ajoutez un <title> unique et descriptif (50–60 caractères)." });
  }
  if (!metaDesc || metaDesc.length < 50) {
    score -= 1;
    improvements.push({ id: "meta-description", title: "Meta description absente ou trop courte", description: "La meta description est souvent utilisée comme résumé par les IA.", severity: metaDesc ? "warning" : "critical", category: "Métadonnées", suggestion: 'Ajoutez <meta name="description" content="..."> (150–160 caractères).' });
  }

  const headings: { level: number; text: string }[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = parseInt(el.tagName[1], 10);
    const text = $(el).text().trim();
    if (text) headings.push({ level, text });
  });

  if (headings.filter((h) => h.level === 1).length === 0) {
    score -= 1;
    improvements.push({ id: "h1", title: "Aucun titre H1", description: "Un seul H1 par page améliore la compréhension de la structure.", severity: "critical", category: "Structure", suggestion: "Utilisez un unique <h1> pour le titre principal de la page." });
  }

  const mainContent = $("main").text().trim() || $("article").first().text().trim() || $("body").text().trim();
  const mainClean = stripHtml(mainContent).slice(0, 3000);
  if (mainClean.length < 100) {
    score -= 0.5;
    improvements.push({ id: "content", title: "Peu de contenu texte détecté", description: "Les IA s'appuient sur le texte pour comprendre la page.", severity: "warning", category: "Contenu", suggestion: "Privilégiez le contenu dans <main> ou <article>." });
  }

  let imagesWithoutAlt = 0;
  const images: { src: string; alt: string | null }[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    const alt = $(el).attr("alt");
    if (src) {
      const fullSrc = src.startsWith("http") ? src : new URL(src, targetUrl).href;
      images.push({ src: fullSrc, alt: alt?.trim() || null });
      if (!alt?.trim()) imagesWithoutAlt++;
    }
  });
  if (imagesWithoutAlt > 0) {
    score -= Math.min(0.5, imagesWithoutAlt * 0.2);
    improvements.push({ id: "alt", title: `Images sans attribut alt (${imagesWithoutAlt})`, description: "L'attribut alt décrit l'image pour les IA et l'accessibilité.", severity: imagesWithoutAlt > 3 ? "warning" : "info", category: "Images", suggestion: "Ajoutez un attribut alt descriptif à chaque <img>." });
  }

  if (!lang) {
    score -= 0.3;
    improvements.push({ id: "lang", title: "Langue du document non indiquée", description: "L'attribut lang sur <html> aide à l'interprétation du contenu.", severity: "info", category: "Métadonnées", suggestion: 'Ajoutez <html lang="fr"> (ou la langue appropriée).' });
  }

  if (!robotsAnalysis.exists) {
    score -= 0.3;
    improvements.push({ id: "robots-txt", title: "Fichier robots.txt absent", description: "Le robots.txt guide les crawlers sur les zones accessibles du site.", severity: "warning", category: "Accessibilité Bots", suggestion: "Créez un fichier robots.txt à la racine de votre site." });
  } else if (robotsAnalysis.blocksAI.length > 0) {
    score -= 0.5;
    improvements.push({ id: "robots-blocks-ai", title: `Crawlers IA bloqués (${robotsAnalysis.blocksAI.join(", ")})`, description: "Certains crawlers IA sont explicitement bloqués dans votre robots.txt.", severity: "warning", category: "Accessibilité Bots", suggestion: "Vérifiez si ce blocage est intentionnel." });
  }

  if (!sitemapExists) {
    score -= 0.3;
    improvements.push({ id: "sitemap", title: "Sitemap XML non trouvé", description: "Un sitemap aide les bots à découvrir et indexer toutes vos pages.", severity: "warning", category: "Accessibilité Bots", suggestion: "Créez un sitemap.xml et référencez-le dans votre robots.txt." });
  }

  if (llmsTxtExists) {
    score += 0.2;
  } else {
    improvements.push({ id: "llms-txt", title: "Fichier llms.txt absent", description: "Le llms.txt est un standard émergent pour guider les LLM sur votre site.", severity: "info", category: "Accessibilité Bots", suggestion: "Créez un fichier llms.txt avec des instructions pour les IA." });
  }

  const metaRobots = $('meta[name="robots"]').attr("content")?.toLowerCase() || "";
  const hasNoindex = metaRobots.includes("noindex");
  const hasNofollow = metaRobots.includes("nofollow");
  const hasNosnippet = metaRobots.includes("nosnippet");
  const hasNoai = metaRobots.includes("noai") || metaRobots.includes("noimageai");

  if (hasNoindex) {
    score -= 1;
    improvements.push({ id: "noindex", title: "Page marquée noindex", description: "Cette page ne sera pas indexée par les moteurs de recherche ni les IA.", severity: "critical", category: "Accessibilité Bots", suggestion: "Retirez noindex si vous souhaitez que la page soit visible des IA." });
  }

  const hasNav = $("nav").length > 0;
  const hasHeader = $("header").length > 0;
  const hasFooter = $("footer").length > 0;
  const hasMain = $("main").length > 0;
  const hasArticle = $("article").length > 0;
  const hasSection = $("section").length > 0;
  const semanticCount = [hasNav, hasHeader, hasFooter, hasMain, hasArticle, hasSection].filter(Boolean).length;
  if (semanticCount < 3) {
    score -= 0.5;
    improvements.push({ id: "semantic-html", title: "Peu de balises HTML sémantiques", description: "Les balises sémantiques aident les IA à comprendre la structure.", severity: "warning", category: "Structure", suggestion: "Utilisez des balises sémantiques HTML5." });
  }

  const h1Count = headings.filter((h) => h.level === 1).length;
  if (h1Count > 1) {
    score -= 0.3;
    improvements.push({ id: "multiple-h1", title: `Plusieurs H1 détectés (${h1Count})`, description: "Une page ne devrait avoir qu'un seul H1.", severity: "warning", category: "Structure", suggestion: "Gardez un seul <h1>." });
  }

  const missingOg: string[] = [];
  if (!ogImage) missingOg.push("og:image");
  if (!ogType) missingOg.push("og:type");
  if (!ogTitle && !title) missingOg.push("og:title");
  if (missingOg.length > 0) {
    score -= Math.min(0.5, missingOg.length * 0.15);
    improvements.push({ id: "open-graph", title: `Balises Open Graph manquantes (${missingOg.join(", ")})`, description: "Open Graph améliore le partage social et la compréhension par les IA.", severity: missingOg.length > 1 ? "warning" : "info", category: "Métadonnées", suggestion: "Ajoutez og:title, og:description, og:image et og:type." });
  }

  const hasStructuredData = $('script[type="application/ld+json"]').length > 0;

  const links: { href: string; text: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href && (href.startsWith("http") || href.startsWith("/"))) {
      const fullHref = href.startsWith("http") ? href : new URL(href, targetUrl).href;
      links.push({ href: fullHref, text: text || fullHref });
    }
  });

  // Build YAML preview
  const yamlLines: string[] = [];
  yamlLines.push("# Aperçu structuré tel que vu par une IA");
  yamlLines.push("");
  yamlLines.push(`url: ${escapeYamlString(targetUrl)}`);
  yamlLines.push(`title: ${title ? escapeYamlString(title) : "null"}`);
  yamlLines.push("meta:");
  yamlLines.push(`  description: ${metaDesc ? escapeYamlString(metaDesc.slice(0, 200)) : "null"}`);
  yamlLines.push(`  ogTitle: ${ogTitle ? escapeYamlString(ogTitle) : "null"}`);
  yamlLines.push(`  ogDescription: ${ogDesc ? escapeYamlString(ogDesc?.slice(0, 200) || "") : "null"}`);
  yamlLines.push(`  ogImage: ${ogImage ? escapeYamlString(ogImage) : "null"}`);
  yamlLines.push(`lang: ${lang ? escapeYamlString(lang) : "null"}`);
  yamlLines.push("structure:");
  yamlLines.push("  headings:");
  for (const h of headings.slice(0, 15)) {
    yamlLines.push(`    - level: ${h.level}`);
    yamlLines.push(`      text: ${escapeYamlString(h.text.slice(0, 120))}`);
  }
  yamlLines.push(`  hasStructuredData: ${hasStructuredData}`);
  yamlLines.push("botAccess:");
  yamlLines.push(`  robotsTxt: ${robotsAnalysis.exists}`);
  yamlLines.push(`  sitemap: ${sitemapExists}`);
  yamlLines.push(`  llmsTxt: ${llmsTxtExists}`);
  yamlLines.push(`  blockedAIBots: [${robotsAnalysis.blocksAI.join(", ")}]`);
  yamlLines.push("content_preview: |");
  const contentLines = mainClean.slice(0, 800).split("\n");
  for (const line of contentLines) yamlLines.push("  " + (line || " "));
  yamlLines.push(`images_count: ${images.length}`);
  yamlLines.push(`links_count: ${links.length}`);

  const finalScore = Math.max(0, Math.min(maxScore, Math.round(score * 10) / 10));

  return {
    url: targetUrl,
    score: finalScore,
    maxScore,
    improvements,
    aiPreviewYaml: yamlLines.join("\n"),
    botAccess: {
      robotsTxt: robotsAnalysis,
      sitemap: { exists: sitemapExists },
      llmsTxt: { exists: llmsTxtExists },
      metaRobots: { noindex: hasNoindex, nofollow: hasNofollow, nosnippet: hasNosnippet, noai: hasNoai },
    },
    analyzedAt: new Date().toISOString(),
  };
}
