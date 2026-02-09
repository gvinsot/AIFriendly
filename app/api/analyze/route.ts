import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import type { AnalysisResult, Improvement, AIPreviewContent } from "@/lib/types";
import { validateAndNormalizeUrl, isUrlSafeForFetch } from "@/lib/urlSecurity";
import { checkRateLimit } from "@/lib/rateLimit";

const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5 Mo max
const FETCH_TIMEOUT_MS = 15000;

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
  lines.push(`  canonical: ${preview.meta.canonical ? escapeYamlString(preview.meta.canonical) : "null"}`);
  lines.push(`lang: ${preview.lang ? escapeYamlString(preview.lang) : "null"}`);
  lines.push("structure:");
  lines.push("  headings:");
  for (const h of preview.headings.slice(0, 25)) {
    lines.push(`    - level: ${h.level}`);
    lines.push(`      text: ${escapeYamlString(h.text.slice(0, 120))}`);
  }
  lines.push(`  hasStructuredData: ${preview.structuredData}`);
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

    const aiPreview: AIPreviewContent = {
      url,
      title,
      meta: {
        description: metaDesc,
        ogTitle,
        ogDescription: ogDesc,
        canonical,
      },
      headings,
      mainContent: mainClean.slice(0, 2000),
      images: images.slice(0, 20),
      links: links.slice(0, 30),
      structuredData: hasStructuredData,
      lang,
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
