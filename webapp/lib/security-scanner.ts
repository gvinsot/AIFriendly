/**
 * Security Scanner — audit de sécurité basé sur les recommandations OWASP / Mozilla.
 * 5 catégories : headers, SSL/TLS, cookies, fuites d'information, injection/XSS.
 * Retourne un score sur 10 et un sous-score par catégorie.
 *
 * Partagé par la webapp, le worker (scans planifiés) et le serveur MCP : tous
 * exécutent exactement les mêmes tests.
 *
 * Principes : ne pénaliser que ce qui a un impact réel (en-têtes obsolètes non
 * exigés, signatures vérifiées contre la page normale, soft 404 écartés), et
 * graduer la sévérité selon le contexte (cookie de session ou non, HTTPS…).
 */

import * as cheerio from "cheerio";
import { ScanEgressError, isScanProxied, scanFetch, type SafeFetchOptions } from "./ssrf-guard";
import { detectAdminPanels } from "./admin-panel-detection";
import {
  API_DOC_PATHS,
  BACKUP_FILES,
  DIR_LISTING_PATHS,
  NotFoundBaseline,
  SENSITIVE_FILES,
  SERVER_STATUS_PAGES,
  detectExposedPaths,
} from "./path-probe";

const SECURITY_TIMEOUT_MS = 60000;

interface SecurityTestResult {
  id: string;
  name: string;
  category: "headers" | "ssl" | "cookies" | "info_leak" | "injection";
  status: "pass" | "fail" | "warning";
  severity: "critical" | "warning" | "info";
  value: string;
  recommendation?: string;
  deduction: number;
}

interface SecurityScanResult {
  score: number;
  headersScore: number;
  sslScore: number;
  cookiesScore: number;
  infoLeakScore: number;
  injectionScore: number;
  details: {
    tests: SecurityTestResult[];
    recommendations: { severity: string; text: string }[];
    timestamp: string;
  };
}

async function fetchWithTimeout(url: string, options: SafeFetchOptions = {}, timeoutMs = 10000): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await scanFetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    // Une panne du VPN n'est pas un résultat de test : elle doit annuler le scan.
    if (err instanceof ScanEgressError) throw err;
    return null;
  }
}

/**
 * "full" sonde des chemins sensibles et envoie des en-têtes forgés : réservé aux
 * sites dont la propriété est vérifiée. "passive" se limite à lire la page, ses
 * en-têtes, robots.txt et security.txt, pour les URL quelconques.
 */
export type ScanDepth = "full" | "passive";

const WAF_BLOCK_RE = /just a moment|attention required|captcha|access denied|request blocked|ddos[- ]protection|ddos-guard|incapsula|sucuri|forbidden/i;

/** La réponse ressemble à un refus de l'IP de sortie du VPN plutôt qu'à la vraie page. */
function looksBlockedByWaf(status: number, headers: Headers, html: string): boolean {
  if (status !== 403 && status !== 429 && status !== 503) return false;
  return headers.has("cf-mitigated") || WAF_BLOCK_RE.test(html.slice(0, 20_000));
}

function addTest(tests: SecurityTestResult[], test: SecurityTestResult) {
  tests.push(test);
}

/** Découpe une CSP en directives : { "script-src": ["'self'", "https://cdn.x"] }. */
function parseCsp(policy: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    // Une directive répétée est ignorée par les navigateurs : seule la première compte.
    if (name && !(name.toLowerCase() in directives)) directives[name.toLowerCase()] = values;
  }
  return directives;
}

/** Hôte d'une URL (absolue ou relative à `base`), ou null si invalide. */
function hostOf(url: string, base: string): string | null {
  try {
    return new URL(url, base).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** `host` est le site lui-même ou un de ses sous-domaines (ex. cdn.example.com pour example.com). */
function isSameSite(host: string | null, siteHost: string): boolean {
  if (!host) return true;
  const root = siteHost.replace(/^www\./, "");
  return host === siteHost || host === root || host.endsWith(`.${root}`);
}

/** Nom de cookie typique d'une session / d'un jeton d'authentification. */
const SESSION_COOKIE_RE = /sess|sid\b|^sid|token|auth|jwt|login|remember/i;

export async function scanSecurity(targetUrl: string, options: { depth: ScanDepth }): Promise<SecurityScanResult> {
  const tests: SecurityTestResult[] = [];
  // Les sondes tournent dans des Promise.allSettled qui avaleraient cette panne.
  const egressFailures: ScanEgressError[] = [];
  let headersScore = 10;
  let sslScore = 10;
  let cookiesScore = 10;
  let infoLeakScore = 10;
  let injectionScore = 10;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SECURITY_TIMEOUT_MS);

  try {
    // Main request to get headers, cookies, and HTML
    const res = await scanFetch(targetUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" },
    });

    const headers = res.headers;
    const html = await res.text();
    // Noter la page de blocage du WAF donnerait un score sans rapport avec le site.
    if (isScanProxied() && looksBlockedByWaf(res.status, headers, html)) {
      throw new ScanEgressError(
        "blocked",
        "Le site a refusé l'IP de sortie du VPN (WAF ou anti-bot) : aucun score n'a été calculé. Réessayez plus tard ou autorisez le User-Agent AIFriendly."
      );
    }
    const $ = cheerio.load(html);
    // URL finale après redirections : c'est elle qui détermine si la page est servie en HTTPS.
    const finalUrl = res.url || targetUrl;
    const isHttps = finalUrl.startsWith("https://");
    const siteHost = new URL(finalUrl).hostname;
    const baseUrl = new URL(finalUrl).origin;
    const setCookies = res.headers.getSetCookie?.() || [];

    // La preuve de propriété porte sur le domaine demandé : si le site redirige
    // ailleurs, ou si une sonde est redirigée ailleurs, on ne sonde pas ce tiers.
    const targetHost = new URL(targetUrl).hostname.toLowerCase();
    const inScope = (url: URL) => isSameSite(url.hostname.toLowerCase(), targetHost);
    const leftScope = !isSameSite(siteHost, targetHost);
    const probesAllowed = options.depth === "full" && !leftScope;
    const probe: typeof fetchWithTimeout = probesAllowed
      ? async (url, probeOptions = {}, timeoutMs) => {
          try {
            return await fetchWithTimeout(url, { ...probeOptions, allowRedirect: inScope }, timeoutMs);
          } catch (err) {
            if (err instanceof ScanEgressError) egressFailures.push(err);
            throw err;
          }
        }
      : async () => null;
    if (!probesAllowed) {
      addTest(tests, {
        id: "probes-skipped", name: "Sondes de chemins sensibles", category: "info_leak",
        status: "warning", severity: "info",
        value: leftScope
          ? "Non exécutées : le site redirige vers un autre domaine que celui vérifié"
          : "Non exécutées : analyse publique limitée aux informations visibles",
        deduction: 0,
      });
    }

    // CSP : en-tête HTTP, ou à défaut balise <meta http-equiv> (qui ne supporte pas frame-ancestors).
    const metaCsp = $('meta[http-equiv="Content-Security-Policy" i]').attr("content") || null;
    const cspReportOnly = headers.get("content-security-policy-report-only");
    const cspDirectives = parseCsp(headers.get("content-security-policy") || metaCsp || "");

    // ═══════════════════════════════════════════
    // CATEGORY 1: Security Headers (15 tests)
    // ═══════════════════════════════════════════

    // 1.1 Content-Security-Policy
    const csp = headers.get("content-security-policy") || metaCsp;
    if (!csp) {
      const ded = cspReportOnly ? 1 : 1.5;
      headersScore -= ded;
      addTest(tests, {
        id: "csp-missing", name: "Content-Security-Policy", category: "headers",
        status: "fail", severity: "critical",
        value: cspReportOnly ? "Uniquement en mode Report-Only (non appliquée)" : "Absent",
        recommendation: cspReportOnly
          ? "Passez la CSP de Content-Security-Policy-Report-Only à Content-Security-Policy une fois les rapports vérifiés."
          : "Ajoutez un header Content-Security-Policy pour prévenir les attaques XSS et injection de contenu.",
        deduction: ded,
      });
    } else {
      addTest(tests, {
        id: "csp-present", name: "Content-Security-Policy", category: "headers",
        status: "pass", severity: "info",
        value: (headers.get("content-security-policy") ? "" : "(balise meta) ") + csp.slice(0, 100) + (csp.length > 100 ? "..." : ""),
        deduction: 0,
      });

      // Les scripts sont régis par script-src, ou à défaut default-src.
      const scriptSrc = cspDirectives["script-src"] ?? cspDirectives["default-src"];
      const hasNonceOrHash = !!scriptSrc?.some((v) => /^'(nonce-|sha(256|384|512)-)/.test(v));
      const hasStrictDynamic = !!scriptSrc?.includes("'strict-dynamic'");

      if (!scriptSrc) {
        headersScore -= 0.5;
        addTest(tests, {
          id: "csp-no-script-src", name: "CSP: scripts non restreints", category: "headers",
          status: "warning", severity: "warning", value: "Ni script-src ni default-src ne sont définis",
          recommendation: "Ajoutez une directive script-src (ou default-src) pour restreindre l'origine des scripts.",
          deduction: 0.5,
        });
      } else {
        // 1.1b unsafe-inline : ignoré par les navigateurs si un nonce/hash est présent (CSP niveau 2+).
        if (scriptSrc.includes("'unsafe-inline'") && !hasNonceOrHash) {
          headersScore -= 0.5;
          addTest(tests, {
            id: "csp-unsafe-inline", name: "CSP: unsafe-inline dans script-src", category: "headers",
            status: "warning", severity: "warning", value: "'unsafe-inline' autorise tout script inline",
            recommendation: "Remplacez 'unsafe-inline' par des nonces ou hashes dans script-src.",
            deduction: 0.5,
          });
        }
        // 1.1c unsafe-eval
        if (scriptSrc.includes("'unsafe-eval'")) {
          headersScore -= 0.3;
          addTest(tests, {
            id: "csp-unsafe-eval", name: "CSP: unsafe-eval dans script-src", category: "headers",
            status: "warning", severity: "warning", value: "'unsafe-eval' permet l'exécution de code dynamique",
            recommendation: "Supprimez 'unsafe-eval' de script-src et évitez eval()/new Function().",
            deduction: 0.3,
          });
        }
        // 1.1d Sources trop larges pour les scripts (sans effet si 'strict-dynamic')
        const broad = scriptSrc.filter((v) => v === "*" || v === "http:" || v === "https:" || v === "data:");
        if (broad.length > 0 && !hasStrictDynamic) {
          headersScore -= 0.3;
          addTest(tests, {
            id: "csp-wildcard", name: "CSP: sources de scripts trop larges", category: "headers",
            status: "warning", severity: "warning", value: `script-src autorise ${broad.join(" ")}`,
            recommendation: "Listez explicitement les domaines autorisés dans script-src au lieu de *, https: ou data:.",
            deduction: 0.3,
          });
        }
      }

      // object-src / base-uri : recommandés par les guides CSP stricts.
      const objectSrc = cspDirectives["object-src"] ?? cspDirectives["default-src"];
      if (!objectSrc || !objectSrc.includes("'none'")) {
        addTest(tests, {
          id: "csp-object-src", name: "CSP: object-src", category: "headers",
          status: "warning", severity: "info", value: objectSrc ? objectSrc.join(" ") : "Non défini",
          recommendation: "Ajoutez object-src 'none' à votre CSP.",
          deduction: 0.1,
        });
        headersScore -= 0.1;
      }
      if (!cspDirectives["base-uri"]) {
        addTest(tests, {
          id: "csp-base-uri", name: "CSP: base-uri", category: "headers",
          status: "warning", severity: "info", value: "Non défini",
          recommendation: "Ajoutez base-uri 'self' (ou 'none') pour empêcher l'injection de balise <base>.",
          deduction: 0,
        });
      }
    }

    // 1.2 Protection anti-clickjacking : CSP frame-ancestors (moderne) ou X-Frame-Options
    const xfo = headers.get("x-frame-options");
    const frameAncestors = headers.get("content-security-policy") ? cspDirectives["frame-ancestors"] : undefined;
    const xfoVal = xfo?.trim().toUpperCase();
    const xfoValid = xfoVal === "DENY" || xfoVal === "SAMEORIGIN";
    if (frameAncestors && !frameAncestors.includes("*")) {
      addTest(tests, {
        id: "xfo-present", name: "Protection anti-clickjacking", category: "headers",
        status: "pass", severity: "info", value: `CSP frame-ancestors ${frameAncestors.join(" ")}`,
        deduction: 0,
      });
    } else if (xfoValid) {
      addTest(tests, {
        id: "xfo-present", name: "Protection anti-clickjacking", category: "headers",
        status: "pass", severity: "info", value: `X-Frame-Options: ${xfo}`,
        deduction: 0,
      });
    } else if (xfo) {
      headersScore -= 0.5;
      addTest(tests, {
        id: "xfo-weak", name: "X-Frame-Options", category: "headers",
        status: "warning", severity: "warning", value: `Valeur non standard (ignorée par les navigateurs): ${xfo}`,
        recommendation: "Utilisez X-Frame-Options: DENY ou SAMEORIGIN, ou CSP frame-ancestors 'self'.",
        deduction: 0.5,
      });
    } else {
      headersScore -= 1;
      addTest(tests, {
        id: "xfo-missing", name: "Protection anti-clickjacking", category: "headers",
        status: "fail", severity: "critical", value: "Ni X-Frame-Options ni CSP frame-ancestors — vulnérable au clickjacking",
        recommendation: "Ajoutez Content-Security-Policy: frame-ancestors 'self' (ou X-Frame-Options: SAMEORIGIN).",
        deduction: 1,
      });
    }

    // 1.3 X-Content-Type-Options
    const xcto = headers.get("x-content-type-options");
    if (!xcto || xcto.trim().toLowerCase() !== "nosniff") {
      headersScore -= 0.5;
      addTest(tests, {
        id: "xcto-missing", name: "X-Content-Type-Options", category: "headers",
        status: "warning", severity: "warning", value: xcto || "Absent",
        recommendation: "Ajoutez X-Content-Type-Options: nosniff.",
        deduction: 0.5,
      });
    } else {
      addTest(tests, {
        id: "xcto-present", name: "X-Content-Type-Options", category: "headers",
        status: "pass", severity: "info", value: xcto,
        deduction: 0,
      });
    }

    // 1.4 Strict-Transport-Security
    // (ignoré par les navigateurs sur HTTP : l'absence de HTTPS est déjà pénalisée en SSL/TLS)
    const hsts = isHttps ? headers.get("strict-transport-security") : null;
    if (!isHttps) {
      // rien : voir la catégorie SSL/TLS
    } else if (!hsts) {
      headersScore -= 1;
      addTest(tests, {
        id: "hsts-missing", name: "Strict-Transport-Security", category: "headers",
        status: "fail", severity: "critical", value: "Absent",
        recommendation: "Ajoutez Strict-Transport-Security: max-age=31536000; includeSubDomains; preload.",
        deduction: 1,
      });
    } else {
      const maxAgeMatch = hsts.match(/max-age=(\d+)/);
      const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 0;
      if (maxAge < 15768000) {
        headersScore -= 0.5;
        addTest(tests, {
          id: "hsts-short", name: "Strict-Transport-Security", category: "headers",
          status: "warning", severity: "warning", value: `max-age=${maxAge} (< 6 mois)`,
          recommendation: "Augmentez la durée HSTS à au moins 6 mois (15768000 secondes).",
          deduction: 0.5,
        });
      } else {
        addTest(tests, {
          id: "hsts-present", name: "Strict-Transport-Security", category: "headers",
          status: "pass", severity: "info", value: hsts,
          deduction: 0,
        });
      }

      // 1.4b Check includeSubDomains
      if (!hsts.toLowerCase().includes("includesubdomains")) {
        headersScore -= 0.2;
        addTest(tests, {
          id: "hsts-no-subdomains", name: "HSTS: includeSubDomains manquant", category: "headers",
          status: "warning", severity: "info", value: "includeSubDomains non défini",
          recommendation: "Ajoutez includeSubDomains à votre en-tête HSTS.",
          deduction: 0.2,
        });
      }

      // 1.4c Check preload
      if (!hsts.toLowerCase().includes("preload")) {
        addTest(tests, {
          id: "hsts-no-preload", name: "HSTS: preload manquant", category: "headers",
          status: "warning", severity: "info", value: "preload non défini — le site n'est pas éligible à la HSTS preload list",
          recommendation: "Ajoutez la directive preload et soumettez votre site à hstspreload.org.",
          deduction: 0,
        });
      }
    }

    // 1.5 X-XSS-Protection — obsolète : le filtre XSS a été retiré des navigateurs et
    // « 1 » pouvait introduire des fuites (XS-Leak). Recommandation actuelle : absent ou « 0 ».
    const xxss = headers.get("x-xss-protection");
    if (xxss && /^\s*1/.test(xxss)) {
      addTest(tests, {
        id: "xxss-legacy", name: "X-XSS-Protection", category: "headers",
        status: "warning", severity: "info", value: xxss,
        recommendation: "X-XSS-Protection est obsolète : utilisez X-XSS-Protection: 0 (ou supprimez-le) et appuyez-vous sur la CSP.",
        deduction: 0,
      });
    } else {
      addTest(tests, {
        id: "xxss-ok", name: "X-XSS-Protection", category: "headers",
        status: "pass", severity: "info", value: xxss || "Absent (comportement recommandé, en-tête obsolète)",
        deduction: 0,
      });
    }

    // 1.6 Referrer-Policy
    const referrer = headers.get("referrer-policy");
    if (!referrer) {
      headersScore -= 0.3;
      addTest(tests, {
        id: "referrer-missing", name: "Referrer-Policy", category: "headers",
        status: "warning", severity: "info", value: "Absent",
        recommendation: "Ajoutez Referrer-Policy: strict-origin-when-cross-origin ou no-referrer.",
        deduction: 0.3,
      });
    } else {
      const weakPolicies = ["unsafe-url", "no-referrer-when-downgrade"];
      // Plusieurs valeurs possibles (repli) : le navigateur applique la dernière qu'il comprend.
      const effectiveReferrer = referrer.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean).pop() || "";
      if (weakPolicies.includes(effectiveReferrer)) {
        headersScore -= 0.2;
        addTest(tests, {
          id: "referrer-weak", name: "Referrer-Policy", category: "headers",
          status: "warning", severity: "warning", value: `Politique faible: ${referrer}`,
          recommendation: "Utilisez strict-origin-when-cross-origin ou no-referrer.",
          deduction: 0.2,
        });
      } else {
        addTest(tests, {
          id: "referrer-present", name: "Referrer-Policy", category: "headers",
          status: "pass", severity: "info", value: referrer,
          deduction: 0,
        });
      }
    }

    // 1.7 Permissions-Policy
    const permissions = headers.get("permissions-policy");
    if (!permissions) {
      headersScore -= 0.2;
      addTest(tests, {
        id: "permissions-missing", name: "Permissions-Policy", category: "headers",
        status: "warning", severity: "info", value: "Absent",
        recommendation: "Ajoutez un header Permissions-Policy pour restreindre les API navigateur (camera, microphone, geolocation, etc.).",
        deduction: 0.2,
      });
    } else {
      addTest(tests, {
        id: "permissions-present", name: "Permissions-Policy", category: "headers",
        status: "pass", severity: "info", value: permissions.slice(0, 100),
        deduction: 0,
      });
    }

    // 1.8 Cross-Origin-Opener-Policy (COOP) — isole la fenêtre des popups cross-origin.
    const coop = headers.get("cross-origin-opener-policy");
    if (!coop) {
      headersScore -= 0.1;
      addTest(tests, {
        id: "coop-missing", name: "Cross-Origin-Opener-Policy", category: "headers",
        status: "warning", severity: "info", value: "Absent",
        recommendation: "Ajoutez Cross-Origin-Opener-Policy: same-origin (ou same-origin-allow-popups) pour isoler le contexte de navigation.",
        deduction: 0.1,
      });
    } else {
      addTest(tests, {
        id: "coop-present", name: "Cross-Origin-Opener-Policy", category: "headers",
        status: "pass", severity: "info", value: coop,
        deduction: 0,
      });
    }

    // COEP / CORP : utiles seulement pour l'isolation cross-origin ou les ressources
    // (pas pour une page HTML publique). Information, sans pénalité.
    const coep = headers.get("cross-origin-embedder-policy");
    const corp = headers.get("cross-origin-resource-policy");
    if (coep || corp) {
      addTest(tests, {
        id: "cross-origin-isolation", name: "COEP / CORP", category: "headers",
        status: "pass", severity: "info",
        value: [coep && `COEP: ${coep}`, corp && `CORP: ${corp}`].filter(Boolean).join(", "),
        deduction: 0,
      });
    }

    // 1.9 Cache-Control : important uniquement si la réponse est personnalisée (cookies posés),
    // sinon un cache partagé pourrait servir les données d'un utilisateur à un autre.
    const cacheControl = (headers.get("cache-control") || "").toLowerCase();
    if (setCookies.length > 0 && !/no-store|private/.test(cacheControl)) {
      headersScore -= 0.3;
      addTest(tests, {
        id: "cache-control-weak", name: "Cache-Control (réponse avec cookies)", category: "headers",
        status: "warning", severity: "warning", value: cacheControl || "Absent",
        recommendation: "La page pose des cookies : utilisez Cache-Control: private ou no-store pour éviter sa mise en cache par un proxy/CDN partagé.",
        deduction: 0.3,
      });
    }

    // X-Download-Options (IE uniquement), X-Permitted-Cross-Domain-Policies (Flash/PDF)
    // et Expect-CT (retiré des navigateurs, CT appliquée par défaut) sont obsolètes : non testés.

    // ═══════════════════════════════════════════
    // CATEGORY 2: SSL/TLS (6 tests)
    // ═══════════════════════════════════════════

    if (isHttps) {
      // 2.1 HTTPS present
      addTest(tests, {
        id: "ssl-https", name: "HTTPS", category: "ssl",
        status: "pass", severity: "info", value: "Le site utilise HTTPS",
        deduction: 0,
      });

      // 2.2 HTTP redirect to HTTPS
      // Suit jusqu'à 5 sauts (ex. http://site → http://www.site → https://www.site).
      let hopUrl = finalUrl.replace("https://", "http://");
      let httpRes: Response | null = null;
      let location = "";
      for (let hop = 0; hop < 5; hop++) {
        httpRes = await fetchWithTimeout(hopUrl, {
          redirect: "manual",
          headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" },
        });
        if (!httpRes || httpRes.status < 300 || httpRes.status >= 400) break;
        location = new URL(httpRes.headers.get("location") || "", hopUrl).href;
        if (location.startsWith("https://")) break;
        hopUrl = location;
      }
      if (httpRes) {
        if (location.startsWith("https://")) {
          addTest(tests, {
            id: "http-redirect", name: "Redirection HTTP → HTTPS", category: "ssl",
            status: "pass", severity: "info", value: `${httpRes.status} → ${location.slice(0, 80)}`,
            deduction: 0,
          });
        } else {
          sslScore -= 1;
          addTest(tests, {
            id: "http-no-redirect", name: "Redirection HTTP → HTTPS", category: "ssl",
            status: "warning", severity: "warning", value: "HTTP ne redirige pas vers HTTPS",
            recommendation: "Configurez une redirection automatique HTTP → HTTPS.",
            deduction: 1,
          });
        }
      }

      // 2.3 Mixed content detection
      // Actif (scripts, styles, iframes, objets) : bloqué par les navigateurs et dangereux.
      // Passif (images, médias) : mis à niveau automatiquement en HTTPS par les navigateurs récents.
      const activeHttp: string[] = [];
      const passiveHttp: string[] = [];
      const isHttpUrl = (u?: string) => !!u && /^http:\/\//i.test(u.trim()) && !/^http:\/\/(localhost|127\.)/i.test(u.trim());
      $("script[src], iframe[src], object[data], embed[src]").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("data");
        if (isHttpUrl(src)) activeHttp.push(src!.slice(0, 80));
      });
      // Seuls les <link> qui chargent réellement une ressource (pas canonical/alternate/preconnect…).
      $("link[href]").each((_, el) => {
        const rel = ($(el).attr("rel") || "").toLowerCase();
        const href = $(el).attr("href");
        if (/stylesheet|preload|modulepreload|manifest/.test(rel) && isHttpUrl(href)) activeHttp.push(href!.slice(0, 80));
        else if (/icon/.test(rel) && isHttpUrl(href)) passiveHttp.push(href!.slice(0, 80));
      });
      $("img[src], video[src], audio[src], source[src]").each((_, el) => {
        const src = $(el).attr("src");
        if (isHttpUrl(src)) passiveHttp.push(src!.slice(0, 80));
      });
      // Formulaire HTTPS qui envoie ses données en clair
      $("form[action]").each((_, el) => {
        const action = $(el).attr("action");
        if (isHttpUrl(action)) activeHttp.push(`form → ${action!.slice(0, 70)}`);
      });
      if (activeHttp.length > 0) {
        sslScore -= 1.5;
        addTest(tests, {
          id: "mixed-content", name: "Contenu mixte actif (HTTP sur HTTPS)", category: "ssl",
          status: "fail", severity: "critical",
          value: `${activeHttp.length} ressource(s) active(s) en HTTP: ${activeHttp.slice(0, 3).join(", ")}${activeHttp.length > 3 ? "..." : ""}`,
          recommendation: "Chargez scripts, styles, iframes et cibles de formulaires via HTTPS (sinon bloqués par le navigateur ou interceptables).",
          deduction: 1.5,
        });
      }
      if (passiveHttp.length > 0) {
        sslScore -= 0.3;
        addTest(tests, {
          id: "mixed-content-passive", name: "Contenu mixte passif (images/médias HTTP)", category: "ssl",
          status: "warning", severity: "warning",
          value: `${passiveHttp.length} ressource(s) passive(s) en HTTP: ${passiveHttp.slice(0, 3).join(", ")}${passiveHttp.length > 3 ? "..." : ""}`,
          recommendation: "Servez images et médias en HTTPS, ou ajoutez la directive CSP upgrade-insecure-requests.",
          deduction: 0.3,
        });
      }
      if (activeHttp.length === 0 && passiveHttp.length === 0) {
        addTest(tests, {
          id: "no-mixed-content", name: "Contenu mixte", category: "ssl",
          status: "pass", severity: "info", value: "Aucune ressource HTTP détectée sur la page HTTPS",
          deduction: 0,
        });
      }

      // 2.4 Subresource Integrity (SRI) for third-party scripts/styles
      // (les feuilles générées dynamiquement, ex. Google Fonts, ne peuvent pas avoir de hash fixe)
      const DYNAMIC_CSS_HOSTS = /(^|\.)fonts\.googleapis\.com$|(^|\.)use\.typekit\.net$/;
      let externalNoSri = 0;
      let totalExternal = 0;
      $("script[src], link[rel~='stylesheet' i][href]").each((_, el) => {
        const url = $(el).attr("src") || $(el).attr("href") || "";
        if (!/^(https?:)?\/\//i.test(url)) return; // relative = même origine
        const host = hostOf(url, finalUrl);
        if (isSameSite(host, siteHost)) return;
        if (el.tagName === "link" && host && DYNAMIC_CSS_HOSTS.test(host)) return;
        totalExternal++;
        if (!$(el).attr("integrity")) externalNoSri++;
      });
      if (externalNoSri > 0) {
        sslScore -= 0.5;
        addTest(tests, {
          id: "sri-missing", name: "Subresource Integrity (SRI)", category: "ssl",
          status: "warning", severity: "warning",
          value: `${externalNoSri}/${totalExternal} script(s)/style(s) tiers sans attribut integrity`,
          recommendation: "Ajoutez l'attribut integrity (SRI) aux scripts et styles chargés depuis des domaines tiers à version fixe.",
          deduction: 0.5,
        });
      } else if (totalExternal > 0) {
        addTest(tests, {
          id: "sri-ok", name: "Subresource Integrity (SRI)", category: "ssl",
          status: "pass", severity: "info", value: `${totalExternal} ressource(s) tierce(s) protégée(s) par SRI`,
          deduction: 0,
        });
      }

    } else {
      sslScore -= 2;
      addTest(tests, {
        id: "no-https", name: "HTTPS", category: "ssl",
        status: "fail", severity: "critical", value: "Le site n'utilise pas HTTPS",
        recommendation: "Migrez vers HTTPS avec un certificat SSL valide.",
        deduction: 2,
      });
    }

    // ═══════════════════════════════════════════
    // CATEGORY 3: Information Leaks (20+ tests)
    // ═══════════════════════════════════════════

    // 3.1 Server header — seul un numéro de version aide réellement un attaquant.
    const server = headers.get("server");
    if (server && /\d+\.\d+/.test(server)) {
      infoLeakScore -= 0.5;
      addTest(tests, {
        id: "server-exposed", name: "Header Server avec version", category: "info_leak",
        status: "warning", severity: "warning", value: server,
        recommendation: "Masquez le numéro de version dans le header Server (ex. server_tokens off; ServerTokens Prod).",
        deduction: 0.5,
      });
    } else {
      addTest(tests, {
        id: "server-hidden", name: "Header Server", category: "info_leak",
        status: "pass", severity: "info", value: server ? `${server} (sans version)` : "Non exposé",
        deduction: 0,
      });
    }

    // 3.2 X-Powered-By
    const poweredBy = headers.get("x-powered-by");
    if (poweredBy) {
      infoLeakScore -= 0.5;
      addTest(tests, {
        id: "powered-by-exposed", name: "X-Powered-By exposé", category: "info_leak",
        status: "warning", severity: "warning", value: poweredBy,
        recommendation: "Supprimez le header X-Powered-By.",
        deduction: 0.5,
      });
    } else {
      addTest(tests, {
        id: "powered-by-hidden", name: "X-Powered-By", category: "info_leak",
        status: "pass", severity: "info", value: "Non exposé",
        deduction: 0,
      });
    }

    // 3.3 X-AspNet-Version / X-AspNetMvc-Version
    const aspnetVersion = headers.get("x-aspnet-version") || headers.get("x-aspnetmvc-version");
    if (aspnetVersion) {
      infoLeakScore -= 0.3;
      addTest(tests, {
        id: "aspnet-version", name: "Version ASP.NET exposée", category: "info_leak",
        status: "warning", severity: "warning", value: aspnetVersion,
        recommendation: "Supprimez les headers X-AspNet-Version et X-AspNetMvc-Version.",
        deduction: 0.3,
      });
    }

    // 3.3b En-têtes de debug / framework laissés en production
    const debugHeaders = ["x-debug-token", "x-debug-token-link", "x-runtime", "x-generator", "x-drupal-cache", "x-backend-server", "x-sourcemap", "sourcemap"]
      .filter((h) => headers.has(h));
    if (debugHeaders.length > 0) {
      const critical = debugHeaders.some((h) => h.startsWith("x-debug-token"));
      const ded = critical ? 1 : 0.2;
      infoLeakScore -= ded;
      addTest(tests, {
        id: "debug-headers", name: "En-têtes de debug / framework exposés", category: "info_leak",
        status: critical ? "fail" : "warning", severity: critical ? "critical" : "info",
        value: debugHeaders.map((h) => `${h}: ${(headers.get(h) || "").slice(0, 60)}`).join(", "),
        recommendation: critical
          ? "Le profiler de debug (Symfony) est actif en production : désactivez-le immédiatement (APP_ENV=prod)."
          : "Supprimez les en-têtes révélant le framework, le backend ou les source maps.",
        deduction: ded,
      });
    }

    // Réponses du site aux chemins inexistants (détection des soft 404 / pages catch-all),
    // partagées par tous les tests de chemins ci-dessous.
    const notFoundBaseline = new NotFoundBaseline(baseUrl, probe);

    // 3.4 Sensitive files check — le contenu doit ressembler au vrai fichier
    // (une page 404 servie en HTTP 200 n'est pas signalée).
    const exposedFiles = await detectExposedPaths(baseUrl, probe, SENSITIVE_FILES, notFoundBaseline);
    for (const { spec: file, res } of exposedFiles) {
      const ded = file.severity === "critical" ? 2 : 0.5;
      infoLeakScore -= ded;
      addTest(tests, {
        id: `sensitive-${file.name}`, name: `Fichier sensible accessible: ${file.name}`, category: "info_leak",
        status: "fail", severity: file.severity,
        value: `${file.path} retourne HTTP 200 avec le contenu du fichier (${res.contentType || "type inconnu"})`,
        recommendation: `Bloquez l'accès à ${file.path} dans votre serveur web.`,
        deduction: ded,
      });
    }

    // 3.5 Backup file extensions
    const exposedBackups = await detectExposedPaths(baseUrl, probe, BACKUP_FILES, notFoundBaseline);
    for (const { spec } of exposedBackups) {
      infoLeakScore -= 1;
      addTest(tests, {
        id: `backup-${spec.path.replace(/\//g, "-")}`, name: `Fichier de sauvegarde accessible`, category: "info_leak",
        status: "fail", severity: "critical", value: `${spec.path} retourne HTTP 200`,
        recommendation: `Supprimez ou bloquez l'accès aux fichiers de sauvegarde (${spec.path}).`,
        deduction: 1,
      });
    }

    // 3.6 Admin panels detection (ignore les pages catch-all de SPA, les blocages WAF et les 403)
    const adminPanels = await detectAdminPanels(baseUrl, probe, undefined, notFoundBaseline);
    for (const panel of adminPanels.findings) {
      infoLeakScore -= 0.3;
      addTest(tests, {
        id: `admin-${panel.path.replace(/\//g, "-")}`, name: `Panneau admin détecté: ${panel.path}`, category: "info_leak",
        status: "warning", severity: "warning",
        value: `${panel.product} — ${panel.path} retourne HTTP ${panel.status}`,
        recommendation: `Restreignez l'accès à ${panel.path} par IP ou VPN. Changez l'URL par défaut de l'admin.`,
        deduction: 0.3,
      });
    }
    if (adminPanels.wafBlocked.length > 0) {
      const providers = [...new Set(adminPanels.wafBlocked.map((w) => w.provider))].join(", ");
      addTest(tests, {
        id: "admin-waf-protected", name: "Chemins d'administration bloqués par un WAF", category: "info_leak",
        status: "pass", severity: "info",
        value: `${providers} bloque ${adminPanels.wafBlocked.map((w) => w.path).join(", ")}`,
        deduction: 0,
      });
    }

    // 3.7 API documentation exposed
    const exposedApiDocs = await detectExposedPaths(baseUrl, probe, API_DOC_PATHS, notFoundBaseline);
    for (const { spec } of exposedApiDocs) {
      infoLeakScore -= 0.5;
      addTest(tests, {
        id: `api-docs-${spec.path.replace(/\//g, "-")}`, name: `Documentation API exposée: ${spec.path}`, category: "info_leak",
        status: "warning", severity: "warning", value: `${spec.path} retourne HTTP 200`,
        recommendation: `Protégez l'accès à la documentation API (${spec.path}) par authentification.`,
        deduction: 0.5,
      });
    }

    // 3.8 Directory listing check (multiple directories)
    const listedDirs = await detectExposedPaths(baseUrl, probe, DIR_LISTING_PATHS, notFoundBaseline);
    if (listedDirs.length > 0) {
      const dirPath = listedDirs[0].spec.path; // One is enough
      infoLeakScore -= 1;
      addTest(tests, {
        id: `dir-listing-${dirPath.replace(/\//g, "")}`, name: `Directory listing: ${dirPath}`, category: "info_leak",
        status: "fail", severity: "critical", value: `Directory listing activé sur ${dirPath}`,
        recommendation: "Désactivez le directory listing dans la configuration de votre serveur (Options -Indexes).",
        deduction: 1,
      });
    }

    // 3.9 robots.txt sensitive paths (seules les lignes Disallow révèlent des chemins)
    const robotsRes = await fetchWithTimeout(
      new URL("/robots.txt", baseUrl).href,
      { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
      5000
    );
    if (robotsRes && robotsRes.status === 200) {
      const robotsTxt = await robotsRes.text();
      const disallowed = robotsTxt
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*disallow\s*:\s*(\S+)/i)?.[1]?.toLowerCase())
        .filter((p): p is string => !!p);
      const sensitiveRe = /^\/(admin|administrator|api\/internal|backup|backups|phpmyadmin|cpanel|private|secret|database|db|config|internal|staging|dev|debug)(\/|$|\*)/;
      const exposed = [...new Set(disallowed.filter((p) => sensitiveRe.test(p)))];
      if (exposed.length > 0) {
        infoLeakScore -= 0.2;
        addTest(tests, {
          id: "robots-sensitive", name: "robots.txt révèle des chemins sensibles", category: "info_leak",
          status: "warning", severity: "info", value: exposed.slice(0, 8).join(", "),
          recommendation: "robots.txt est public : ne l'utilisez pas pour « cacher » des chemins sensibles, protégez-les par authentification.",
          deduction: 0.2,
        });
      }
    }

    // 3.10 HTML comments with sensitive info
    const htmlComments: string[] = [];
    const commentRegex = /<!--([\s\S]*?)-->/g;
    let match;
    while ((match = commentRegex.exec(html)) !== null) {
      const comment = match[1].toLowerCase();
      // Un mot-clé seul (« token », « database ») est fréquent dans des commentaires anodins :
      // on exige une affectation de valeur (password=…, api_key: …) ou une chaîne de connexion.
      const assigned = /\b(password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"'<>]{4,}/i;
      const connectionString = /\b(mysql|postgres(ql)?|mongodb(\+srv)?|redis|amqp):\/\/[^\s:@]+:[^\s@]+@/i;
      if (assigned.test(comment) || connectionString.test(comment)) {
        htmlComments.push(match[1].trim().slice(0, 100));
      }
    }
    if (htmlComments.length > 0) {
      infoLeakScore -= 1.5;
      addTest(tests, {
        id: "html-comments-sensitive", name: "Commentaires HTML sensibles", category: "info_leak",
        status: "fail", severity: "critical",
        value: `${htmlComments.length} commentaire(s) contenant des termes sensibles détecté(s)`,
        recommendation: "Supprimez tous les commentaires HTML contenant des informations sensibles (mots de passe, clés API, etc.).",
        deduction: 1.5,
      });
    }

    // 3.11 Meta generator tag (version disclosure)
    const generator = $('meta[name="generator" i]').attr("content");
    if (generator && /\d+\.\d+/.test(generator)) {
      infoLeakScore -= 0.3;
      addTest(tests, {
        id: "meta-generator", name: "Meta generator (version exposée)", category: "info_leak",
        status: "warning", severity: "warning", value: generator,
        recommendation: "Supprimez la balise meta generator pour ne pas révéler la technologie et version utilisées.",
        deduction: 0.3,
      });
    }

    // 3.12 Stack trace / debug info in HTML
    const stackTracePatterns = [
      "Traceback (most recent call last)",
      "at Object.<anonymous>",
      "Fatal error:",
      "Stack trace:",
      "Exception in thread",
      "java.lang.",
      "System.NullReferenceException",
      "Warning: mysql_",
      "Warning: pg_",
      "Parse error: syntax error",
      "Uncaught Exception",
    ];
    const hasStackTrace = stackTracePatterns.some(pattern => html.includes(pattern));
    if (hasStackTrace) {
      infoLeakScore -= 2;
      addTest(tests, {
        id: "stack-trace", name: "Stack trace / erreurs debug exposées", category: "info_leak",
        status: "fail", severity: "critical",
        value: "Des traces d'erreur ou de debug sont visibles dans le HTML",
        recommendation: "Désactivez le mode debug en production. Ne jamais afficher les stack traces aux utilisateurs.",
        deduction: 2,
      });
    }

    // 3.13 Source maps référencées dans le HTML (scripts inline) ou annoncées par en-tête
    if (/\/[/*]#\s*sourceMappingURL=/.test(html) || headers.has("sourcemap") || headers.has("x-sourcemap")) {
      infoLeakScore -= 0.3;
      addTest(tests, {
        id: "source-maps", name: "Source maps exposées", category: "info_leak",
        status: "warning", severity: "info",
        value: "Des références sourceMappingURL ont été détectées",
        recommendation: "Ne publiez pas les source maps en production (ou restreignez leur accès) pour ne pas exposer le code source original.",
        deduction: 0.3,
      });
    }

    // 3.14 Email exposure in HTML
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = html.match(emailRegex) || [];
    const uniqueEmails = [...new Set(emails.map((e) => e.toLowerCase()))].filter(
      (e) => !/example\.(com|org)|schema\.org|sentry|wixpress/.test(e) && !/\.(png|jpe?g|gif|svg|webp|avif)$/.test(e)
    );
    if (uniqueEmails.length > 3) {
      infoLeakScore -= 0.3;
      addTest(tests, {
        id: "email-exposure", name: "Adresses email exposées", category: "info_leak",
        status: "warning", severity: "info",
        value: `${uniqueEmails.length} adresse(s) email détectée(s) dans le HTML`,
        recommendation: "Protégez les adresses email contre le scraping (obfuscation, formulaires de contact).",
        deduction: 0.3,
      });
    }

    // 3.15 security.txt (RFC 9116) — le contenu doit contenir un champ Contact (sinon soft 404)
    let securityTxt: string | null = null;
    for (const path of ["/.well-known/security.txt", "/security.txt"]) {
      const r = await fetchWithTimeout(new URL(path, baseUrl).href, { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } }, 5000);
      if (r && r.status === 200) {
        const body = (await r.text()).slice(0, 32 * 1024);
        if (/^\s*Contact\s*:/im.test(body)) { securityTxt = body; break; }
      }
    }
    if (!securityTxt) {
      addTest(tests, {
        id: "security-txt-missing", name: "security.txt", category: "info_leak",
        status: "warning", severity: "info",
        value: "Absent — pas de fichier /.well-known/security.txt valide",
        recommendation: "Créez un fichier /.well-known/security.txt (RFC 9116) avec Contact et Expires pour indiquer comment signaler les vulnérabilités.",
        deduction: 0,
      });
    } else {
      const expires = securityTxt.match(/^\s*Expires\s*:\s*(.+)$/im)?.[1]?.trim();
      const expiresAt = expires ? Date.parse(expires) : NaN;
      if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) {
        addTest(tests, {
          id: "security-txt-expired", name: "security.txt", category: "info_leak",
          status: "warning", severity: "info", value: `Expiré depuis le ${expires}`,
          recommendation: "Mettez à jour le champ Expires de security.txt (RFC 9116).",
          deduction: 0,
        });
      } else {
        addTest(tests, {
          id: "security-txt-ok", name: "security.txt", category: "info_leak",
          status: "pass", severity: "info", value: expires ? `Présent (expire le ${expires})` : "Présent",
          deduction: 0,
        });
      }
    }

    // 3.16 Server status/info pages (Apache)
    const statusPages = await detectExposedPaths(baseUrl, probe, SERVER_STATUS_PAGES, notFoundBaseline);
    for (const { spec: { path } } of statusPages) {
      infoLeakScore -= 1;
      addTest(tests, {
        id: `server-page-${path.replace("/", "")}`, name: `Page serveur exposée: ${path}`, category: "info_leak",
        status: "fail", severity: "critical",
        value: `${path} est accessible publiquement`,
        recommendation: `Bloquez l'accès à ${path} — il expose des informations critiques sur le serveur.`,
        deduction: 1,
      });
    }

    // ═══════════════════════════════════════════
    // CATEGORY 4: Cookies (7 tests)
    // ═══════════════════════════════════════════

    // Analyse des attributs réels (pas une recherche de sous-chaîne : la valeur
    // d'un cookie peut contenir « secure »).
    const cookies = setCookies.map((raw) => {
      const [pair, ...attrParts] = raw.split(";");
      const name = pair.split("=")[0].trim();
      const attrs = new Map<string, string>();
      for (const part of attrParts) {
        const [k, ...v] = part.split("=");
        attrs.set(k.trim().toLowerCase(), v.join("=").trim());
      }
      return {
        name,
        secure: attrs.has("secure"),
        httpOnly: attrs.has("httponly"),
        sameSite: (attrs.get("samesite") || "").toLowerCase(),
        domain: (attrs.get("domain") || "").replace(/^\./, "").toLowerCase(),
        isSession: SESSION_COOKIE_RE.test(name),
      };
    });

    if (cookies.length > 0) {
      const sessionCookies = cookies.filter((c) => c.isSession);
      const list = (cs: typeof cookies) => cs.map((c) => c.name).slice(0, 6).join(", ");

      // 4.1 Secure — sur un site HTTPS tous les cookies devraient l'avoir ; critique pour les sessions.
      const noSecure = cookies.filter((c) => !c.secure);
      if (isHttps && noSecure.length > 0) {
        const critical = noSecure.some((c) => c.isSession);
        const ded = critical ? 1 : 0.3;
        cookiesScore -= ded;
        addTest(tests, {
          id: "cookie-no-secure", name: "Cookies sans flag Secure", category: "cookies",
          status: critical ? "fail" : "warning", severity: critical ? "critical" : "warning",
          value: `Sans Secure: ${list(noSecure)}`,
          recommendation: "Ajoutez le flag Secure aux cookies pour empêcher leur envoi en clair sur HTTP.",
          deduction: ded,
        });
      }

      // 4.2 HttpOnly — requis pour les cookies de session ; les cookies lus par le JS
      // (consentement, analytics, jeton CSRF « double submit ») n'en ont légitimement pas.
      const sessionNoHttpOnly = sessionCookies.filter((c) => !c.httpOnly);
      if (sessionNoHttpOnly.length > 0) {
        cookiesScore -= 1;
        addTest(tests, {
          id: "cookie-no-httponly", name: "Cookies de session sans HttpOnly", category: "cookies",
          status: "fail", severity: "critical", value: `Lisibles par JavaScript: ${list(sessionNoHttpOnly)}`,
          recommendation: "Ajoutez HttpOnly aux cookies de session pour qu'une faille XSS ne permette pas de les voler.",
          deduction: 1,
        });
      }

      // 4.3 SameSite absent — les navigateurs appliquent Lax par défaut (sauf Safari) : explicite recommandé.
      const noSameSite = cookies.filter((c) => !c.sameSite);
      if (noSameSite.length > 0) {
        const ded = noSameSite.some((c) => c.isSession) ? 0.3 : 0.1;
        cookiesScore -= ded;
        addTest(tests, {
          id: "cookie-no-samesite", name: "Cookies sans attribut SameSite", category: "cookies",
          status: "warning", severity: ded > 0.1 ? "warning" : "info", value: list(noSameSite),
          recommendation: "Déclarez explicitement SameSite=Lax (ou Strict) pour vous protéger du CSRF sur tous les navigateurs.",
          deduction: ded,
        });
      }

      // 4.4 SameSite=None — rejeté sans Secure ; à éviter pour les sessions.
      const sameSiteNone = cookies.filter((c) => c.sameSite === "none");
      if (sameSiteNone.length > 0) {
        const insecureNone = sameSiteNone.filter((c) => !c.secure);
        const ded = insecureNone.length > 0 || sameSiteNone.some((c) => c.isSession) ? 0.5 : 0.1;
        cookiesScore -= ded;
        addTest(tests, {
          id: "cookie-samesite-none", name: "Cookies avec SameSite=None", category: "cookies",
          status: "warning", severity: ded > 0.1 ? "warning" : "info",
          value: insecureNone.length > 0
            ? `SameSite=None sans Secure (rejetés par les navigateurs): ${list(insecureNone)}`
            : `Envoyés dans les requêtes cross-site: ${list(sameSiteNone)}`,
          recommendation: "Réservez SameSite=None (toujours avec Secure) aux cookies devant réellement être cross-site.",
          deduction: ded,
        });
      }

      // 4.5 Préfixes __Host- / __Secure- pour les cookies de session (défense en profondeur)
      const noPrefix = sessionCookies.filter((c) => !c.name.startsWith("__Host-") && !c.name.startsWith("__Secure-"));
      if (isHttps && noPrefix.length > 0) {
        addTest(tests, {
          id: "cookie-no-prefix", name: "Cookies de session sans préfixe sécurisé", category: "cookies",
          status: "warning", severity: "info", value: list(noPrefix),
          recommendation: "Utilisez le préfixe __Host- pour les cookies de session (impose Secure, Path=/ et l'absence de Domain).",
          deduction: 0,
        });
      }

      // 4.6 Domain parent du site : le cookie est partagé avec tous les sous-domaines du parent.
      const host = siteHost.toLowerCase();
      const broad = cookies.filter((c) => c.domain && c.domain !== host && host.endsWith(`.${c.domain}`) && (c.isSession || c.domain.split(".").length <= 2));
      if (broad.length > 0) {
        const ded = broad.some((c) => c.isSession) ? 0.5 : 0.2;
        cookiesScore -= ded;
        addTest(tests, {
          id: "cookie-broad-domain", name: "Cookie partagé avec le domaine parent", category: "cookies",
          status: "warning", severity: ded > 0.2 ? "warning" : "info",
          value: broad.map((c) => `${c.name} (Domain=${c.domain})`).slice(0, 4).join(", "),
          recommendation: "N'indiquez pas d'attribut Domain (cookie limité à l'hôte) sauf si le partage entre sous-domaines est nécessaire.",
          deduction: ded,
        });
      }

      if (!tests.some((t) => t.category === "cookies" && t.status !== "pass" && t.deduction > 0)) {
        addTest(tests, {
          id: "cookies-ok", name: "Cookies", category: "cookies",
          status: "pass", severity: "info", value: `${cookies.length} cookie(s) correctement configuré(s)`,
          deduction: 0,
        });
      }
    } else {
      addTest(tests, {
        id: "no-cookies", name: "Cookies", category: "cookies",
        status: "pass", severity: "info", value: "Aucun cookie défini sur la page d'accueil",
        deduction: 0,
      });
    }

    // ═══════════════════════════════════════════
    // CATEGORY 5: Injection / XSS (15+ tests)
    // ═══════════════════════════════════════════

    // 5.1 Formulaires POST (vers le site lui-même) sans jeton anti-CSRF.
    // Heuristique : un cookie de session SameSite=Lax/Strict atténue fortement le risque.
    let postForms = 0;
    let formsWithoutCsrf = 0;
    $("form").each((_, form) => {
      const $form = $(form);
      if (($form.attr("method") || "get").toLowerCase() !== "post") return;
      if (!isSameSite(hostOf($form.attr("action") || "", finalUrl), siteHost)) return; // newsletter, paiement… : hors périmètre
      postForms++;
      const hasCsrf = $form.find('input[type="hidden"]').toArray().some((el) =>
        /csrf|xsrf|token|authenticity|nonce|verification/i.test($(el).attr("name") || "")
      );
      if (!hasCsrf) formsWithoutCsrf++;
    });
    if (formsWithoutCsrf > 0) {
      const sessionProtected = cookies.some((c) => c.isSession && (c.sameSite === "lax" || c.sameSite === "strict"));
      const ded = sessionProtected ? 0.2 : 0.5;
      injectionScore -= ded;
      addTest(tests, {
        id: "no-csrf", name: "Formulaires POST sans jeton CSRF", category: "injection",
        status: "warning", severity: sessionProtected ? "info" : "warning",
        value: `${formsWithoutCsrf}/${postForms} formulaire(s) POST sans champ caché anti-CSRF${sessionProtected ? " (atténué par SameSite)" : ""}`,
        recommendation: "Ajoutez un jeton CSRF aux formulaires POST qui modifient des données, en plus de cookies SameSite=Lax/Strict.",
        deduction: ded,
      });
    } else if (postForms > 0) {
      addTest(tests, {
        id: "csrf-ok", name: "Protection CSRF", category: "injection",
        status: "pass", severity: "info", value: "Jetons CSRF détectés dans les formulaires POST",
        deduction: 0,
      });
    }
    // (L'ancien test « autocomplete=off sur les mots de passe » est supprimé : c'est un
    // anti-pattern selon OWASP/NIST — il gêne les gestionnaires de mots de passe et est ignoré.)

    // Modified 2026-11-08: standard scan checks configuration and public exposure.
    // No injected SQL/HTML/path traversal payloads or state-changing HTTP methods.

    // 5.7 CORS misconfiguration
    const corsRes = await probe(
      targetUrl,
      {
        headers: {
          "User-Agent": "AIFriendly/1.0 (SecurityScan)",
          "Origin": "https://evil-attacker.com",
        },
      },
      10000
    );
    if (corsRes) {
      const acao = corsRes.headers.get("access-control-allow-origin");
      const acac = corsRes.headers.get("access-control-allow-credentials");

      if (acao === "*") {
        // Sans credentials, « * » ne permet de lire que du contenu déjà public : faible impact.
        injectionScore -= 0.1;
        addTest(tests, {
          id: "cors-wildcard", name: "CORS: wildcard Access-Control-Allow-Origin", category: "injection",
          status: "warning", severity: "info",
          value: "Access-Control-Allow-Origin: * — lisible par toute origine (sans cookies)",
          recommendation: "Si la page ou l'API renvoie des données non publiques, restreignez CORS aux domaines de confiance au lieu de *.",
          deduction: 0.1,
        });
      } else if (acao && acao.includes("evil-attacker.com")) {
        injectionScore -= 1.5;
        addTest(tests, {
          id: "cors-reflection", name: "CORS: réflexion d'origine", category: "injection",
          status: "fail", severity: "critical",
          value: "Le serveur reflète n'importe quelle origine dans Access-Control-Allow-Origin",
          recommendation: "Ne reflétez pas l'en-tête Origin. Utilisez une whitelist stricte de domaines autorisés.",
          deduction: 1.5,
        });
        if (acac === "true") {
          injectionScore -= 0.5;
          addTest(tests, {
            id: "cors-credentials", name: "CORS: credentials avec réflexion", category: "injection",
            status: "fail", severity: "critical",
            value: "Access-Control-Allow-Credentials: true combiné avec réflexion d'origine — vol de données possible",
            recommendation: "Ne combinez jamais la réflexion d'origine avec Allow-Credentials: true.",
            deduction: 0.5,
          });
        }
      }
    }

    // 5.10 DOM-based XSS : un même script inline lit une source contrôlable par l'URL
    // et utilise un sink dangereux (la simple présence d'innerHTML n'est pas une faille).
    const domSources = /location\.(hash|search|href)|document\.(URL|documentURI|referrer)|window\.name|URLSearchParams/;
    const domSinks: [RegExp, string][] = [
      [/document\.write(ln)?\s*\(/, "document.write()"],
      [/\.(inner|outer)HTML\s*=(?!=)/, "innerHTML/outerHTML"],
      [/insertAdjacentHTML\s*\(/, "insertAdjacentHTML()"],
      [/\beval\s*\(/, "eval()"],
      [/set(Timeout|Interval)\s*\(\s*["'`]/, "setTimeout/setInterval avec chaîne"],
    ];
    const foundDomPatterns = new Set<string>();
    $("script:not([src])").each((_, el) => {
      const code = $(el).text();
      if (!domSources.test(code)) return;
      for (const [re, name] of domSinks) if (re.test(code)) foundDomPatterns.add(name);
    });
    if (foundDomPatterns.size > 0) {
      injectionScore -= 0.3;
      addTest(tests, {
        id: "dom-xss-patterns", name: "Indices de DOM XSS (source URL → sink)", category: "injection",
        status: "warning", severity: "warning",
        value: `Script inline lisant l'URL et utilisant: ${[...foundDomPatterns].join(", ")}`,
        recommendation: "N'injectez jamais location/referrer dans innerHTML, document.write ou eval : utilisez textContent ou une API de sanitisation (DOMPurify, Trusted Types).",
        deduction: 0.3,
      });
    }

    // 5.11 JSONP endpoint detection
    const jsonpRes = await probe(
      `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}callback=aifriendly_jsonp_test`,
      { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
      10000
    );
    if (jsonpRes) {
      const jsonpBody = await jsonpRes.text();
      if (jsonpBody.includes("aifriendly_jsonp_test(")) {
        injectionScore -= 0.5;
        addTest(tests, {
          id: "jsonp-endpoint", name: "Endpoint JSONP détecté", category: "injection",
          status: "warning", severity: "warning",
          value: "Un endpoint JSONP a été détecté — peut permettre des fuites de données cross-origin",
          recommendation: "Remplacez JSONP par CORS. Si JSONP est nécessaire, validez le paramètre callback strictement.",
          deduction: 0.5,
        });
      }
    }

    // 5.12 Inline event handlers (XSS surface)
    let inlineEventHandlers = 0;
    const eventAttrs = ["onclick", "onload", "onerror", "onmouseover", "onfocus", "onsubmit", "onchange", "onkeyup", "onkeydown"];
    $("*").each((_, el) => {
      for (const attr of eventAttrs) {
        if ($(el).attr(attr)) {
          inlineEventHandlers++;
        }
      }
    });
    if (inlineEventHandlers > 5) {
      injectionScore -= 0.1;
      addTest(tests, {
        id: "inline-events", name: "Gestionnaires d'événements inline", category: "injection",
        status: "warning", severity: "info",
        value: `${inlineEventHandlers} attributs d'événements inline (onclick, onload, etc.) détectés`,
        recommendation: "Utilisez addEventListener() au lieu des attributs d'événements inline pour une meilleure séparation et compatibilité CSP.",
        deduction: 0.1,
      });
    }

    // 5.13 Formulaires de connexion envoyés vers un domaine tiers (les formulaires de
    // newsletter/paiement vers un prestataire sont normaux et ne sont pas signalés).
    let externalCredentialForms = 0;
    $("form[action]").each((_, form) => {
      const $form = $(form);
      if ($form.find('input[type="password" i]').length === 0) return;
      if (!isSameSite(hostOf($form.attr("action") || "", finalUrl), siteHost)) externalCredentialForms++;
    });
    if (externalCredentialForms > 0) {
      injectionScore -= 0.5;
      addTest(tests, {
        id: "external-form-action", name: "Mot de passe envoyé à un domaine tiers", category: "injection",
        status: "warning", severity: "warning",
        value: `${externalCredentialForms} formulaire(s) avec mot de passe postent vers un autre domaine`,
        recommendation: "Vérifiez que le domaine destinataire des identifiants est bien le vôtre ou votre fournisseur d'authentification.",
        deduction: 0.5,
      });
    }

    // 5.14 Password fields without autocomplete=off and in HTTP (non-HTTPS)
    if (!isHttps) {
      const passwordFields = $('input[type="password"]').length;
      if (passwordFields > 0) {
        injectionScore -= 1;
        addTest(tests, {
          id: "password-no-https", name: "Mots de passe envoyés sans HTTPS", category: "injection",
          status: "fail", severity: "critical",
          value: `${passwordFields} champ(s) de mot de passe détecté(s) sur une page non-HTTPS`,
          recommendation: "Les formulaires de connexion DOIVENT être servis via HTTPS pour protéger les credentials.",
          deduction: 1,
        });
      }
    }

    // 5.16 Check for Content-Type header on API-like responses
    const contentType = headers.get("content-type");
    const hasMetaCharset = /<meta[^>]+charset\s*=/i.test(html.slice(0, 2048));
    if (contentType && contentType.includes("html") && !contentType.includes("charset") && !hasMetaCharset) {
      injectionScore -= 0.1;
      addTest(tests, {
        id: "no-charset", name: "Charset non défini dans Content-Type", category: "injection",
        status: "warning", severity: "info",
        value: `Content-Type: ${contentType} (pas de charset)`,
        recommendation: "Ajoutez charset=utf-8 au Content-Type pour prévenir les attaques par encodage.",
        deduction: 0.1,
      });
    }

  } catch (err) {
    // VPN indisponible ou IP refusée : ne jamais enregistrer de score à 0 pour le site.
    if (err instanceof ScanEgressError) throw err;
    // If the scan fails entirely, return minimal result
    clearTimeout(timeout);
    return {
      score: 0,
      headersScore: 0,
      sslScore: 0,
      cookiesScore: 0,
      infoLeakScore: 0,
      injectionScore: 0,
      details: {
        tests: [{
          id: "scan-error", name: "Erreur de scan", category: "headers",
          status: "fail", severity: "critical",
          value: err instanceof Error ? err.message : "Erreur inconnue",
          deduction: 10,
        }],
        recommendations: [],
        timestamp: new Date().toISOString(),
      },
    };
  } finally {
    clearTimeout(timeout);
  }

  if (egressFailures.length > 0) throw egressFailures[0];

  // Clamp sub-scores
  headersScore = Math.max(0, Math.min(10, Math.round(headersScore * 10) / 10));
  sslScore = Math.max(0, Math.min(10, Math.round(sslScore * 10) / 10));
  cookiesScore = Math.max(0, Math.min(10, Math.round(cookiesScore * 10) / 10));
  infoLeakScore = Math.max(0, Math.min(10, Math.round(infoLeakScore * 10) / 10));
  injectionScore = Math.max(0, Math.min(10, Math.round(injectionScore * 10) / 10));

  // Overall score = weighted average of sub-scores
  const overallScore = Math.max(0, Math.min(10, Math.round(
    (headersScore * 0.25 + sslScore * 0.25 + cookiesScore * 0.15 + infoLeakScore * 0.15 + injectionScore * 0.20) * 10
  ) / 10));

  // Build recommendations from failed tests
  const recommendations = tests
    .filter(t => t.recommendation)
    .sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2);
    })
    .map(t => ({ severity: t.severity, text: t.recommendation! }));

  return {
    score: overallScore,
    headersScore,
    sslScore,
    cookiesScore,
    infoLeakScore,
    injectionScore,
    details: {
      tests,
      recommendations,
      timestamp: new Date().toISOString(),
    },
  };
}
