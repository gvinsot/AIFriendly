import * as cheerio from "cheerio";

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;

// LLM Configuration (vLLM / OpenAI-compatible)
const VLLM_API_URL = process.env.VLLM_API_URL || "";
const VLLM_API_KEY = process.env.VLLM_API_KEY || "";
const VLLM_MODEL = process.env.VLLM_MODEL || "default";
const LLM_ENABLED = !!VLLM_API_URL;
const LLM_TIMEOUT_MS = 30000;

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
  ethicsScore: number;
  coherenceScore: number;
  aiGeneratedScore: number;
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

interface LLMScores {
  ethicsScore: number;
  coherenceScore: number;
  aiGeneratedScore: number;
  ethicsImprovements: { title: string; description: string; severity: "critical" | "warning" | "info" }[];
  coherenceImprovements: { title: string; description: string; severity: "critical" | "warning" | "info" }[];
  aiDetectionImprovements: { title: string; description: string; severity: "critical" | "warning" | "info" }[];
}

async function analyzeWithLLM(textContent: string, title: string | null, lang: string | null, url: string): Promise<LLMScores | null> {
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

    const headers: Record<string, string> = { "Content-Type": "application/json" };
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
      console.error(`[LLM] API error: ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);

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
    console.error(`[LLM] Error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export async function analyzeUrl(targetUrl: string): Promise<AnalysisOutput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "IAFriendly/1.0 (Analysis; +https://aifriendly.eu)" },
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
  const maxScore = 10;

  // Sub-scores: each starts at 10
  let ethicsScore = 10;    // Content risk / ethical concerns
  let coherenceScore = 10; // Content coherence & structure
  let aiGeneratedScore = 10; // AI-generated content detection

  const title = $("title").first().text().trim() || $('meta[property="og:title"]').attr("content")?.trim() || null;
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() || null;
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || null;
  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim() || null;
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim() || null;
  const ogType = $('meta[property="og:type"]').attr("content")?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const twitterCard = $('meta[name="twitter:card"]').attr("content")?.trim() || null;
  const lang = $("html").attr("lang") || null;

  // ── Coherence checks ──────────────────────────────────────────

  if (!title || title.length < 10) {
    coherenceScore -= 2;
    improvements.push({ id: "title", title: "Titre de page manquant ou trop court", description: "Un titre explicite aide les IA à comprendre le sujet de la page.", severity: "critical", category: "Cohérence", suggestion: "Ajoutez un <title> unique et descriptif (50–60 caractères)." });
  }
  if (!metaDesc || metaDesc.length < 50) {
    coherenceScore -= 1.5;
    improvements.push({ id: "meta-description", title: "Meta description absente ou trop courte", description: "La meta description est souvent utilisée comme résumé par les IA.", severity: metaDesc ? "warning" : "critical", category: "Cohérence", suggestion: 'Ajoutez <meta name="description" content="..."> (150–160 caractères).' });
  }

  const headings: { level: number; text: string }[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = parseInt(el.tagName[1], 10);
    const text = $(el).text().trim();
    if (text) headings.push({ level, text });
  });

  if (headings.filter((h) => h.level === 1).length === 0) {
    coherenceScore -= 1.5;
    improvements.push({ id: "h1", title: "Aucun titre H1", description: "Un seul H1 par page améliore la compréhension de la structure.", severity: "critical", category: "Cohérence", suggestion: "Utilisez un unique <h1> pour le titre principal de la page." });
  }

  const mainContent = $("main").text().trim() || $("article").first().text().trim() || $("body").text().trim();
  const mainClean = stripHtml(mainContent).slice(0, 3000);
  if (mainClean.length < 100) {
    coherenceScore -= 1;
    improvements.push({ id: "content", title: "Peu de contenu texte détecté", description: "Les IA s'appuient sur le texte pour comprendre la page.", severity: "warning", category: "Cohérence", suggestion: "Privilégiez le contenu dans <main> ou <article>." });
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
    coherenceScore -= Math.min(1, imagesWithoutAlt * 0.3);
    improvements.push({ id: "alt", title: `Images sans attribut alt (${imagesWithoutAlt})`, description: "L'attribut alt décrit l'image pour les IA et l'accessibilité.", severity: imagesWithoutAlt > 3 ? "warning" : "info", category: "Cohérence", suggestion: "Ajoutez un attribut alt descriptif à chaque <img>." });
  }

  if (!lang) {
    coherenceScore -= 0.5;
    improvements.push({ id: "lang", title: "Langue du document non indiquée", description: "L'attribut lang sur <html> aide à l'interprétation du contenu.", severity: "info", category: "Cohérence", suggestion: 'Ajoutez <html lang="fr"> (ou la langue appropriée).' });
  }

  const hasNav = $("nav").length > 0;
  const hasHeader = $("header").length > 0;
  const hasFooter = $("footer").length > 0;
  const hasMain = $("main").length > 0;
  const hasArticle = $("article").length > 0;
  const hasSection = $("section").length > 0;
  const semanticCount = [hasNav, hasHeader, hasFooter, hasMain, hasArticle, hasSection].filter(Boolean).length;
  if (semanticCount < 3) {
    coherenceScore -= 1;
    improvements.push({ id: "semantic-html", title: "Peu de balises HTML sémantiques", description: "Les balises sémantiques aident les IA à comprendre la structure.", severity: "warning", category: "Cohérence", suggestion: "Utilisez des balises sémantiques HTML5." });
  }

  const h1Count = headings.filter((h) => h.level === 1).length;
  if (h1Count > 1) {
    coherenceScore -= 0.5;
    improvements.push({ id: "multiple-h1", title: `Plusieurs H1 détectés (${h1Count})`, description: "Une page ne devrait avoir qu'un seul H1.", severity: "warning", category: "Cohérence", suggestion: "Gardez un seul <h1>." });
  }

  const missingOg: string[] = [];
  if (!ogImage) missingOg.push("og:image");
  if (!ogType) missingOg.push("og:type");
  if (!ogTitle && !title) missingOg.push("og:title");
  if (missingOg.length > 0) {
    coherenceScore -= Math.min(1, missingOg.length * 0.3);
    improvements.push({ id: "open-graph", title: `Balises Open Graph manquantes (${missingOg.join(", ")})`, description: "Open Graph améliore le partage social et la compréhension par les IA.", severity: missingOg.length > 1 ? "warning" : "info", category: "Cohérence", suggestion: "Ajoutez og:title, og:description, og:image et og:type." });
  }

  // ── Ethics / Risk checks ──────────────────────────────────────

  const metaRobots = $('meta[name="robots"]').attr("content")?.toLowerCase() || "";
  const hasNoindex = metaRobots.includes("noindex");
  const hasNofollow = metaRobots.includes("nofollow");
  const hasNosnippet = metaRobots.includes("nosnippet");
  const hasNoai = metaRobots.includes("noai") || metaRobots.includes("noimageai");

  if (!robotsAnalysis.exists) {
    ethicsScore -= 0.5;
    improvements.push({ id: "robots-txt", title: "Fichier robots.txt absent", description: "Le robots.txt guide les crawlers sur les zones accessibles du site.", severity: "warning", category: "Éthique & Risque", suggestion: "Créez un fichier robots.txt à la racine de votre site." });
  } else if (robotsAnalysis.blocksAI.length > 0) {
    ethicsScore -= 1;
    improvements.push({ id: "robots-blocks-ai", title: `Crawlers IA bloqués (${robotsAnalysis.blocksAI.join(", ")})`, description: "Certains crawlers IA sont explicitement bloqués dans votre robots.txt.", severity: "warning", category: "Éthique & Risque", suggestion: "Vérifiez si ce blocage est intentionnel." });
  }

  if (!sitemapExists) {
    ethicsScore -= 0.5;
    improvements.push({ id: "sitemap", title: "Sitemap XML non trouvé", description: "Un sitemap aide les bots à découvrir et indexer toutes vos pages.", severity: "warning", category: "Éthique & Risque", suggestion: "Créez un sitemap.xml et référencez-le dans votre robots.txt." });
  }

  if (llmsTxtExists) {
    ethicsScore += 0.3;
  } else {
    improvements.push({ id: "llms-txt", title: "Fichier llms.txt absent", description: "Le llms.txt est un standard émergent pour guider les LLM sur votre site.", severity: "info", category: "Éthique & Risque", suggestion: "Créez un fichier llms.txt avec des instructions pour les IA." });
  }

  if (hasNoindex) {
    ethicsScore -= 2;
    improvements.push({ id: "noindex", title: "Page marquée noindex", description: "Cette page ne sera pas indexée par les moteurs de recherche ni les IA.", severity: "critical", category: "Éthique & Risque", suggestion: "Retirez noindex si vous souhaitez que la page soit visible des IA." });
  }

  if (hasNoai) {
    ethicsScore -= 1.5;
    improvements.push({ id: "noai", title: "Directive noai détectée", description: "Le contenu est explicitement exclu du traitement par les IA.", severity: "warning", category: "Éthique & Risque", suggestion: "Retirez noai/noimageai si vous souhaitez être référencé par les IA." });
  }

  if (hasNosnippet) {
    ethicsScore -= 0.5;
    improvements.push({ id: "nosnippet", title: "Directive nosnippet détectée", description: "Les extraits de contenu ne seront pas affichés par les moteurs et IA.", severity: "info", category: "Éthique & Risque", suggestion: "Retirez nosnippet pour permettre aux IA d'utiliser des extraits." });
  }

  // ── AI-Generated Content Detection ────────────────────────────

  const hasStructuredData = $('script[type="application/ld+json"]').length > 0;

  // Heuristic signals for AI-generated content detection
  const textContent = mainClean;
  const sentences = textContent.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const wordCount = textContent.split(/\s+/).filter(w => w.length > 0).length;

  // 1. Repetition patterns (AI tends to repeat phrases)
  if (sentences.length > 5) {
    const sentenceSet = new Set(sentences.map(s => s.trim().toLowerCase()));
    const repetitionRatio = 1 - (sentenceSet.size / sentences.length);
    if (repetitionRatio > 0.3) {
      aiGeneratedScore -= 2;
      improvements.push({ id: "ai-repetition", title: "Contenu répétitif détecté", description: `${Math.round(repetitionRatio * 100)}% de phrases dupliquées — signe potentiel de contenu généré par IA.`, severity: "warning", category: "Détection IA", suggestion: "Variez le contenu et éliminez les répétitions." });
    } else if (repetitionRatio > 0.15) {
      aiGeneratedScore -= 1;
      improvements.push({ id: "ai-repetition", title: "Légère répétition de contenu", description: `${Math.round(repetitionRatio * 100)}% de phrases similaires détectées.`, severity: "info", category: "Détection IA", suggestion: "Diversifiez les formulations pour un contenu plus naturel." });
    }
  }

  // 2. Sentence length uniformity (AI generates similarly-sized sentences)
  if (sentences.length > 5) {
    const lengths = sentences.map(s => s.trim().split(/\s+/).length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avgLen, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const coeffVariation = avgLen > 0 ? stdDev / avgLen : 1;

    if (coeffVariation < 0.2) {
      aiGeneratedScore -= 2;
      improvements.push({ id: "ai-uniformity", title: "Longueur de phrases très uniforme", description: "Les phrases ont une longueur très homogène, ce qui est typique de contenus générés par IA.", severity: "warning", category: "Détection IA", suggestion: "Variez la longueur de vos phrases pour un style plus naturel." });
    } else if (coeffVariation < 0.35) {
      aiGeneratedScore -= 1;
      improvements.push({ id: "ai-uniformity", title: "Longueur de phrases assez uniforme", description: "La variation de longueur des phrases est faible.", severity: "info", category: "Détection IA", suggestion: "Alternez phrases courtes et longues pour plus de naturel." });
    }
  }

  // 3. Over-use of transitional/filler phrases typical of AI
  const aiPatterns = [
    /\ben conclusion\b/gi, /\bil est important de noter\b/gi, /\bil convient de\b/gi,
    /\bin conclusion\b/gi, /\bit is important to note\b/gi, /\bit's worth noting\b/gi,
    /\bfurthermore\b/gi, /\bmoreover\b/gi, /\badditionally\b/gi,
    /\ben résumé\b/gi, /\bde plus\b/gi, /\bpar ailleurs\b/gi,
    /\bin today's world\b/gi, /\bin the realm of\b/gi, /\bdans le monde d'aujourd'hui\b/gi,
    /\bdelve\b/gi, /\btapestry\b/gi, /\blandscape\b/gi,
    /\bvous l'aurez compris\b/gi, /\bforce est de constater\b/gi,
  ];
  let aiPhraseCount = 0;
  for (const pattern of aiPatterns) {
    const matches = textContent.match(pattern);
    if (matches) aiPhraseCount += matches.length;
  }

  const aiPhraseDensity = wordCount > 0 ? aiPhraseCount / (wordCount / 100) : 0;
  if (aiPhraseDensity > 3) {
    aiGeneratedScore -= 2;
    improvements.push({ id: "ai-phrases", title: "Forte densité de formulations typiques IA", description: `${aiPhraseCount} formulations typiques d'IA détectées dans le contenu.`, severity: "warning", category: "Détection IA", suggestion: "Reformulez avec un style plus personnel et authentique." });
  } else if (aiPhraseDensity > 1.5) {
    aiGeneratedScore -= 1;
    improvements.push({ id: "ai-phrases", title: "Formulations typiques IA détectées", description: `${aiPhraseCount} expressions fréquemment utilisées par les IA.`, severity: "info", category: "Détection IA", suggestion: "Privilégiez un vocabulaire plus varié et personnel." });
  }

  // 4. Lack of personal voice / first person
  const personalPatterns = [
    /\bje\b/gi, /\bmon\b/gi, /\bma\b/gi, /\bmes\b/gi, /\bnous\b/gi, /\bnotre\b/gi,
    /\bI\b/g, /\bmy\b/gi, /\bwe\b/gi, /\bour\b/gi,
  ];
  let personalCount = 0;
  for (const pattern of personalPatterns) {
    const matches = textContent.match(pattern);
    if (matches) personalCount += matches.length;
  }

  if (wordCount > 100 && personalCount === 0) {
    aiGeneratedScore -= 1;
    improvements.push({ id: "ai-impersonal", title: "Contenu impersonnel", description: "Aucune marque de voix personnelle détectée. Les contenus humains utilisent généralement la première personne.", severity: "info", category: "Détection IA", suggestion: "Ajoutez une touche personnelle avec des pronoms comme 'je', 'nous', 'notre'." });
  }

  // 5. Structured data and authorship (positive signals of human origin)
  if (hasStructuredData) {
    aiGeneratedScore += 0.5;
  }

  const hasAuthorMeta = !!($('meta[name="author"]').attr("content")?.trim());
  if (hasAuthorMeta) {
    aiGeneratedScore += 0.3;
  } else if (wordCount > 200) {
    aiGeneratedScore -= 0.5;
    improvements.push({ id: "ai-no-author", title: "Pas d'auteur identifié", description: "L'absence de meta author peut laisser supposer un contenu sans attribution humaine.", severity: "info", category: "Détection IA", suggestion: 'Ajoutez <meta name="author" content="Nom"> pour identifier l\'auteur.' });
  }

  // ── LLM-based analysis (blends with heuristic scores) ──
  const llmResult = await analyzeWithLLM(mainClean, title, lang, targetUrl);
  if (llmResult) {
    // Blend: 40% heuristic + 60% LLM
    ethicsScore = ethicsScore * 0.4 + llmResult.ethicsScore * 0.6;
    coherenceScore = coherenceScore * 0.4 + llmResult.coherenceScore * 0.6;
    aiGeneratedScore = aiGeneratedScore * 0.4 + llmResult.aiGeneratedScore * 0.6;

    for (const imp of llmResult.ethicsImprovements) {
      improvements.push({ id: `llm-ethics-${improvements.length}`, title: imp.title, description: imp.description, severity: imp.severity, category: "Éthique & Risque", suggestion: imp.description });
    }
    for (const imp of llmResult.coherenceImprovements) {
      improvements.push({ id: `llm-coherence-${improvements.length}`, title: imp.title, description: imp.description, severity: imp.severity, category: "Cohérence", suggestion: imp.description });
    }
    for (const imp of llmResult.aiDetectionImprovements) {
      improvements.push({ id: `llm-ai-${improvements.length}`, title: imp.title, description: imp.description, severity: imp.severity, category: "Détection IA", suggestion: imp.description });
    }
  }

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

  // Clamp sub-scores to [0, 10]
  ethicsScore = Math.max(0, Math.min(10, Math.round(ethicsScore * 10) / 10));
  coherenceScore = Math.max(0, Math.min(10, Math.round(coherenceScore * 10) / 10));
  aiGeneratedScore = Math.max(0, Math.min(10, Math.round(aiGeneratedScore * 10) / 10));

  // Overall score = average of sub-scores
  const finalScore = Math.max(0, Math.min(maxScore, Math.round(
    ((ethicsScore + coherenceScore + aiGeneratedScore) / 3) * 10
  ) / 10));

  return {
    url: targetUrl,
    score: finalScore,
    maxScore,
    ethicsScore,
    coherenceScore,
    aiGeneratedScore,
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
