/**
 * Security Scanner — Comprehensive OWASP-based security audit
 * 50+ tests across 5 categories: headers, SSL/TLS, cookies, info leaks, injection/XSS
 * Returns a score out of 10 with sub-scores by category.
 */

import * as cheerio from "cheerio";

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

function addTest(tests: SecurityTestResult[], test: SecurityTestResult) {
  tests.push(test);
}

export async function scanSecurity(targetUrl: string): Promise<SecurityScanResult> {
  const tests: SecurityTestResult[] = [];
  let headersScore = 10;
  let sslScore = 10;
  let cookiesScore = 10;
  let infoLeakScore = 10;
  let injectionScore = 10;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SECURITY_TIMEOUT_MS);

  try {
    // Main request to get headers, cookies, and HTML
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" },
    });

    const headers = res.headers;
    const html = await res.text();
    const $ = cheerio.load(html);
    const baseUrl = new URL(targetUrl).origin;

    // ═══════════════════════════════════════════
    // CATEGORY 1: Security Headers (15 tests)
    // ═══════════════════════════════════════════

    // 1.1 Content-Security-Policy
    const csp = headers.get("content-security-policy");
    if (!csp) {
      headersScore -= 1.5;
      addTest(tests, {
        id: "csp-missing", name: "Content-Security-Policy", category: "headers",
        status: "fail", severity: "critical", value: "Absent",
        recommendation: "Ajoutez un header Content-Security-Policy pour prévenir les attaques XSS et injection de contenu.",
        deduction: 1.5,
      });
    } else {
      addTest(tests, {
        id: "csp-present", name: "Content-Security-Policy", category: "headers",
        status: "pass", severity: "info", value: csp.slice(0, 100) + (csp.length > 100 ? "..." : ""),
        deduction: 0,
      });

      // 1.1b CSP unsafe-inline check
      if (csp.includes("unsafe-inline")) {
        headersScore -= 0.5;
        addTest(tests, {
          id: "csp-unsafe-inline", name: "CSP: unsafe-inline détecté", category: "headers",
          status: "warning", severity: "warning", value: "La directive 'unsafe-inline' affaiblit la protection XSS",
          recommendation: "Remplacez 'unsafe-inline' par des nonces ou hashes dans votre CSP.",
          deduction: 0.5,
        });
      }

      // 1.1c CSP unsafe-eval check
      if (csp.includes("unsafe-eval")) {
        headersScore -= 0.5;
        addTest(tests, {
          id: "csp-unsafe-eval", name: "CSP: unsafe-eval détecté", category: "headers",
          status: "warning", severity: "warning", value: "La directive 'unsafe-eval' permet l'exécution de code dynamique",
          recommendation: "Supprimez 'unsafe-eval' de votre CSP et refactorisez le code utilisant eval().",
          deduction: 0.5,
        });
      }

      // 1.1d CSP wildcard check
      if (csp.includes("* ") || csp.includes(" *") || csp.match(/:\s*\*/)) {
        headersScore -= 0.3;
        addTest(tests, {
          id: "csp-wildcard", name: "CSP: wildcard détecté", category: "headers",
          status: "warning", severity: "warning", value: "Un wildcard (*) dans le CSP autorise toutes les sources",
          recommendation: "Restreignez les sources autorisées dans votre CSP au lieu d'utiliser des wildcards.",
          deduction: 0.3,
        });
      }

      // 1.1e CSP frame-ancestors (clickjacking via CSP)
      if (!csp.includes("frame-ancestors")) {
        headersScore -= 0.2;
        addTest(tests, {
          id: "csp-no-frame-ancestors", name: "CSP: frame-ancestors absent", category: "headers",
          status: "warning", severity: "info", value: "La directive frame-ancestors n'est pas définie",
          recommendation: "Ajoutez 'frame-ancestors self' dans votre CSP pour une protection anti-clickjacking moderne.",
          deduction: 0.2,
        });
      }
    }

    // 1.2 X-Frame-Options
    const xfo = headers.get("x-frame-options");
    if (!xfo) {
      headersScore -= 1;
      addTest(tests, {
        id: "xfo-missing", name: "X-Frame-Options", category: "headers",
        status: "fail", severity: "critical", value: "Absent — vulnérable au clickjacking",
        recommendation: "Ajoutez X-Frame-Options: DENY ou SAMEORIGIN.",
        deduction: 1,
      });
    } else {
      const xfoVal = xfo.toUpperCase();
      if (xfoVal !== "DENY" && xfoVal !== "SAMEORIGIN") {
        headersScore -= 0.3;
        addTest(tests, {
          id: "xfo-weak", name: "X-Frame-Options", category: "headers",
          status: "warning", severity: "warning", value: `Valeur non standard: ${xfo}`,
          recommendation: "Utilisez X-Frame-Options: DENY ou SAMEORIGIN.",
          deduction: 0.3,
        });
      } else {
        addTest(tests, {
          id: "xfo-present", name: "X-Frame-Options", category: "headers",
          status: "pass", severity: "info", value: xfo,
          deduction: 0,
        });
      }
    }

    // 1.3 X-Content-Type-Options
    const xcto = headers.get("x-content-type-options");
    if (!xcto || xcto !== "nosniff") {
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
    const hsts = headers.get("strict-transport-security");
    if (!hsts) {
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

    // 1.5 X-XSS-Protection
    const xxss = headers.get("x-xss-protection");
    if (!xxss) {
      headersScore -= 0.3;
      addTest(tests, {
        id: "xxss-missing", name: "X-XSS-Protection", category: "headers",
        status: "warning", severity: "warning", value: "Absent",
        recommendation: "Ajoutez X-XSS-Protection: 1; mode=block (ou 0 si CSP est bien configuré).",
        deduction: 0.3,
      });
    } else {
      addTest(tests, {
        id: "xxss-present", name: "X-XSS-Protection", category: "headers",
        status: "pass", severity: "info", value: xxss,
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
      if (weakPolicies.includes(referrer.toLowerCase())) {
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
      headersScore -= 0.3;
      addTest(tests, {
        id: "permissions-missing", name: "Permissions-Policy", category: "headers",
        status: "warning", severity: "info", value: "Absent",
        recommendation: "Ajoutez un header Permissions-Policy pour restreindre les API navigateur (camera, microphone, geolocation, etc.).",
        deduction: 0.3,
      });
    } else {
      addTest(tests, {
        id: "permissions-present", name: "Permissions-Policy", category: "headers",
        status: "pass", severity: "info", value: permissions.slice(0, 100),
        deduction: 0,
      });
    }

    // 1.8 Cross-Origin-Embedder-Policy (COEP)
    const coep = headers.get("cross-origin-embedder-policy");
    if (!coep) {
      headersScore -= 0.2;
      addTest(tests, {
        id: "coep-missing", name: "Cross-Origin-Embedder-Policy", category: "headers",
        status: "warning", severity: "info", value: "Absent",
        recommendation: "Ajoutez Cross-Origin-Embedder-Policy: require-corp pour activer l'isolation cross-origin.",
        deduction: 0.2,
      });
    } else {
      addTest(tests, {
        id: "coep-present", name: "Cross-Origin-Embedder-Policy", category: "headers",
        status: "pass", severity: "info", value: coep,
        deduction: 0,
      });
    }

    // 1.9 Cross-Origin-Opener-Policy (COOP)
    const coop = headers.get("cross-origin-opener-policy");
    if (!coop) {
      headersScore -= 0.2;
      addTest(tests, {
        id: "coop-missing", name: "Cross-Origin-Opener-Policy", category: "headers",
        status: "warning", severity: "info", value: "Absent",
        recommendation: "Ajoutez Cross-Origin-Opener-Policy: same-origin pour isoler le contexte de navigation.",
        deduction: 0.2,
      });
    } else {
      addTest(tests, {
        id: "coop-present", name: "Cross-Origin-Opener-Policy", category: "headers",
        status: "pass", severity: "info", value: coop,
        deduction: 0,
      });
    }

    // 1.10 Cross-Origin-Resource-Policy (CORP)
    const corp = headers.get("cross-origin-resource-policy");
    if (!corp) {
      headersScore -= 0.2;
      addTest(tests, {
        id: "corp-missing", name: "Cross-Origin-Resource-Policy", category: "headers",
        status: "warning", severity: "info", value: "Absent",
        recommendation: "Ajoutez Cross-Origin-Resource-Policy: same-origin pour empêcher le chargement cross-origin non autorisé.",
        deduction: 0.2,
      });
    } else {
      addTest(tests, {
        id: "corp-present", name: "Cross-Origin-Resource-Policy", category: "headers",
        status: "pass", severity: "info", value: corp,
        deduction: 0,
      });
    }

    // 1.11 X-Permitted-Cross-Domain-Policies
    const xpcdp = headers.get("x-permitted-cross-domain-policies");
    if (!xpcdp) {
      headersScore -= 0.1;
      addTest(tests, {
        id: "xpcdp-missing", name: "X-Permitted-Cross-Domain-Policies", category: "headers",
        status: "warning", severity: "info", value: "Absent",
        recommendation: "Ajoutez X-Permitted-Cross-Domain-Policies: none pour bloquer Flash/PDF cross-domain.",
        deduction: 0.1,
      });
    } else {
      addTest(tests, {
        id: "xpcdp-present", name: "X-Permitted-Cross-Domain-Policies", category: "headers",
        status: "pass", severity: "info", value: xpcdp,
        deduction: 0,
      });
    }

    // 1.12 X-Download-Options
    const xdo = headers.get("x-download-options");
    if (!xdo) {
      headersScore -= 0.1;
      addTest(tests, {
        id: "xdo-missing", name: "X-Download-Options", category: "headers",
        status: "warning", severity: "info", value: "Absent",
        recommendation: "Ajoutez X-Download-Options: noopen pour empêcher l'exécution automatique des téléchargements dans IE.",
        deduction: 0.1,
      });
    } else {
      addTest(tests, {
        id: "xdo-present", name: "X-Download-Options", category: "headers",
        status: "pass", severity: "info", value: xdo,
        deduction: 0,
      });
    }

    // 1.13 Cache-Control for sensitive pages
    const cacheControl = headers.get("cache-control");
    if (!cacheControl || (!cacheControl.includes("no-store") && !cacheControl.includes("private"))) {
      headersScore -= 0.2;
      addTest(tests, {
        id: "cache-control-weak", name: "Cache-Control", category: "headers",
        status: "warning", severity: "info", value: cacheControl || "Absent",
        recommendation: "Utilisez Cache-Control: no-store ou private pour les pages sensibles afin d'empêcher la mise en cache de données privées.",
        deduction: 0.2,
      });
    } else {
      addTest(tests, {
        id: "cache-control-ok", name: "Cache-Control", category: "headers",
        status: "pass", severity: "info", value: cacheControl,
        deduction: 0,
      });
    }

    // 1.14 Expect-CT (Certificate Transparency)
    const expectCt = headers.get("expect-ct");
    if (targetUrl.startsWith("https://") && !expectCt) {
      addTest(tests, {
        id: "expect-ct-missing", name: "Expect-CT", category: "headers",
        status: "warning", severity: "info", value: "Absent (facultatif mais recommandé)",
        recommendation: "Ajoutez Expect-CT: max-age=86400, enforce pour garantir la transparence des certificats.",
        deduction: 0,
      });
    }

    // ═══════════════════════════════════════════
    // CATEGORY 2: SSL/TLS (6 tests)
    // ═══════════════════════════════════════════

    if (targetUrl.startsWith("https://")) {
      // 2.1 HTTPS present
      addTest(tests, {
        id: "ssl-https", name: "HTTPS", category: "ssl",
        status: "pass", severity: "info", value: "Le site utilise HTTPS",
        deduction: 0,
      });

      // 2.2 HTTP redirect to HTTPS
      const httpUrl = targetUrl.replace("https://", "http://");
      const httpRes = await fetchWithTimeout(httpUrl, {
        redirect: "manual",
        headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" },
      });
      if (httpRes) {
        const location = httpRes.headers.get("location") || "";
        if (httpRes.status >= 300 && httpRes.status < 400 && location.startsWith("https://")) {
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
      const httpResources: string[] = [];
      $("script[src], link[href], img[src], iframe[src], video[src], audio[src], source[src], object[data]").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("href") || $(el).attr("data") || "";
        if (src.startsWith("http://") && !src.includes("localhost")) {
          httpResources.push(src.slice(0, 80));
        }
      });
      if (httpResources.length > 0) {
        sslScore -= 1.5;
        addTest(tests, {
          id: "mixed-content", name: "Contenu mixte (HTTP sur HTTPS)", category: "ssl",
          status: "fail", severity: "critical",
          value: `${httpResources.length} ressource(s) HTTP chargée(s) sur une page HTTPS: ${httpResources.slice(0, 3).join(", ")}${httpResources.length > 3 ? "..." : ""}`,
          recommendation: "Chargez toutes les ressources via HTTPS pour éviter les attaques MitM.",
          deduction: 1.5,
        });
      } else {
        addTest(tests, {
          id: "no-mixed-content", name: "Contenu mixte", category: "ssl",
          status: "pass", severity: "info", value: "Aucune ressource HTTP détectée sur la page HTTPS",
          deduction: 0,
        });
      }

      // 2.4 Subresource Integrity (SRI) for external scripts
      let externalScriptsNoSri = 0;
      let totalExternalScripts = 0;
      $("script[src]").each((_, el) => {
        const src = $(el).attr("src") || "";
        if (src.startsWith("http") && !src.includes(new URL(targetUrl).hostname)) {
          totalExternalScripts++;
          if (!$(el).attr("integrity")) {
            externalScriptsNoSri++;
          }
        }
      });
      $("link[rel='stylesheet'][href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (href.startsWith("http") && !href.includes(new URL(targetUrl).hostname)) {
          totalExternalScripts++;
          if (!$(el).attr("integrity")) {
            externalScriptsNoSri++;
          }
        }
      });
      if (externalScriptsNoSri > 0) {
        sslScore -= 0.5;
        addTest(tests, {
          id: "sri-missing", name: "Subresource Integrity (SRI)", category: "ssl",
          status: "warning", severity: "warning",
          value: `${externalScriptsNoSri}/${totalExternalScripts} ressource(s) externe(s) sans attribut integrity`,
          recommendation: "Ajoutez l'attribut integrity (SRI) à toutes les ressources externes pour empêcher leur modification.",
          deduction: 0.5,
        });
      } else if (totalExternalScripts > 0) {
        addTest(tests, {
          id: "sri-ok", name: "Subresource Integrity (SRI)", category: "ssl",
          status: "pass", severity: "info", value: `${totalExternalScripts} ressource(s) externe(s) protégée(s) par SRI`,
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

    // 3.1 Server header
    const server = headers.get("server");
    if (server) {
      // Check for detailed version info
      const hasVersion = /\d+\.\d+/.test(server);
      const deduction = hasVersion ? 0.5 : 0.3;
      infoLeakScore -= deduction;
      addTest(tests, {
        id: "server-exposed", name: "Header Server exposé", category: "info_leak",
        status: hasVersion ? "fail" : "warning",
        severity: hasVersion ? "warning" : "info",
        value: server,
        recommendation: hasVersion
          ? "Masquez le numéro de version dans le header Server. Idéalement, supprimez-le complètement."
          : "Masquez le header Server pour ne pas révéler votre technologie.",
        deduction,
      });
    } else {
      addTest(tests, {
        id: "server-hidden", name: "Header Server", category: "info_leak",
        status: "pass", severity: "info", value: "Non exposé",
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

    // 3.4 Sensitive files check (expanded list)
    const sensitiveFiles = [
      { path: "/.env", name: ".env", severity: "critical" as const },
      { path: "/.env.local", name: ".env.local", severity: "critical" as const },
      { path: "/.env.production", name: ".env.production", severity: "critical" as const },
      { path: "/.git/HEAD", name: ".git/", severity: "critical" as const },
      { path: "/.git/config", name: ".git/config", severity: "critical" as const },
      { path: "/.svn/entries", name: ".svn/", severity: "critical" as const },
      { path: "/wp-config.php", name: "wp-config.php", severity: "critical" as const },
      { path: "/wp-config.php.bak", name: "wp-config.php.bak", severity: "critical" as const },
      { path: "/.htaccess", name: ".htaccess", severity: "warning" as const },
      { path: "/.htpasswd", name: ".htpasswd", severity: "critical" as const },
      { path: "/phpinfo.php", name: "phpinfo.php", severity: "critical" as const },
      { path: "/.DS_Store", name: ".DS_Store", severity: "warning" as const },
      { path: "/web.config", name: "web.config", severity: "warning" as const },
      { path: "/composer.json", name: "composer.json", severity: "warning" as const },
      { path: "/package.json", name: "package.json", severity: "warning" as const },
      { path: "/Gemfile", name: "Gemfile", severity: "warning" as const },
      { path: "/.npmrc", name: ".npmrc", severity: "critical" as const },
      { path: "/backup.sql", name: "backup.sql", severity: "critical" as const },
      { path: "/dump.sql", name: "dump.sql", severity: "critical" as const },
      { path: "/database.sql", name: "database.sql", severity: "critical" as const },
      { path: "/error_log", name: "error_log", severity: "warning" as const },
      { path: "/debug.log", name: "debug.log", severity: "warning" as const },
      { path: "/docker-compose.yml", name: "docker-compose.yml", severity: "warning" as const },
      { path: "/Dockerfile", name: "Dockerfile", severity: "warning" as const },
      { path: "/config.yml", name: "config.yml", severity: "warning" as const },
      { path: "/credentials.json", name: "credentials.json", severity: "critical" as const },
    ];

    const sensitiveFileChecks = sensitiveFiles.map(async (file) => {
      const fileRes = await fetchWithTimeout(
        new URL(file.path, baseUrl).href,
        { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
        5000
      );
      if (fileRes && fileRes.status === 200) {
        const ct = fileRes.headers.get("content-type") || "";
        // Only flag if it's not returning the main site's HTML (custom 404)
        if (!ct.includes("text/html")) {
          const ded = file.severity === "critical" ? 2 : 0.5;
          infoLeakScore -= ded;
          addTest(tests, {
            id: `sensitive-${file.name}`, name: `Fichier sensible accessible: ${file.name}`, category: "info_leak",
            status: "fail", severity: file.severity,
            value: `${file.path} retourne HTTP 200 (${ct || "type inconnu"})`,
            recommendation: `Bloquez l'accès à ${file.path} dans votre serveur web.`,
            deduction: ded,
          });
        }
      }
    });
    await Promise.allSettled(sensitiveFileChecks);

    // 3.5 Backup file extensions
    const backupPaths = [
      "/index.php.bak", "/index.php.old", "/index.php~",
      "/index.html.bak", "/index.html.old",
      "/.backup", "/backup/", "/backups/",
    ];
    const backupChecks = backupPaths.map(async (path) => {
      const backupRes = await fetchWithTimeout(
        new URL(path, baseUrl).href,
        { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
        5000
      );
      if (backupRes && backupRes.status === 200) {
        const ct = backupRes.headers.get("content-type") || "";
        if (!ct.includes("text/html")) {
          infoLeakScore -= 1;
          addTest(tests, {
            id: `backup-${path.replace(/\//g, "-")}`, name: `Fichier de sauvegarde accessible`, category: "info_leak",
            status: "fail", severity: "critical", value: `${path} retourne HTTP 200`,
            recommendation: `Supprimez ou bloquez l'accès aux fichiers de sauvegarde (${path}).`,
            deduction: 1,
          });
        }
      }
    });
    await Promise.allSettled(backupChecks);

    // 3.6 Admin panels detection
    const adminPaths = [
      "/admin", "/admin/", "/administrator", "/wp-admin", "/wp-login.php",
      "/phpmyadmin", "/adminer.php", "/cpanel", "/_admin",
      "/admin/login", "/manager/html", "/solr/", "/jenkins",
    ];
    const adminChecks = adminPaths.map(async (path) => {
      const adminRes = await fetchWithTimeout(
        new URL(path, baseUrl).href,
        { redirect: "manual", headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
        5000
      );
      if (adminRes && (adminRes.status === 200 || adminRes.status === 401 || adminRes.status === 403)) {
        infoLeakScore -= 0.3;
        addTest(tests, {
          id: `admin-${path.replace(/\//g, "-")}`, name: `Panneau admin détecté: ${path}`, category: "info_leak",
          status: "warning", severity: "warning",
          value: `${path} retourne HTTP ${adminRes.status}`,
          recommendation: `Restreignez l'accès à ${path} par IP ou VPN. Changez l'URL par défaut de l'admin.`,
          deduction: 0.3,
        });
      }
    });
    await Promise.allSettled(adminChecks);

    // 3.7 API documentation exposed
    const apiDocPaths = [
      "/swagger", "/swagger-ui", "/swagger-ui.html", "/api-docs",
      "/graphql", "/graphiql", "/__graphql", "/api/explorer",
    ];
    const apiDocChecks = apiDocPaths.map(async (path) => {
      const apiRes = await fetchWithTimeout(
        new URL(path, baseUrl).href,
        { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
        5000
      );
      if (apiRes && apiRes.status === 200) {
        infoLeakScore -= 0.5;
        addTest(tests, {
          id: `api-docs-${path.replace(/\//g, "-")}`, name: `Documentation API exposée: ${path}`, category: "info_leak",
          status: "warning", severity: "warning", value: `${path} retourne HTTP 200`,
          recommendation: `Protégez l'accès à la documentation API (${path}) par authentification.`,
          deduction: 0.5,
        });
      }
    });
    await Promise.allSettled(apiDocChecks);

    // 3.8 Directory listing check (multiple directories)
    const dirListPaths = ["/icons/", "/images/", "/uploads/", "/static/", "/assets/"];
    for (const dirPath of dirListPaths) {
      const dirRes = await fetchWithTimeout(
        new URL(dirPath, baseUrl).href,
        { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
        5000
      );
      if (dirRes && dirRes.status === 200) {
        const dirBody = await dirRes.text();
        if (dirBody.includes("Index of") || dirBody.includes("Directory listing") || dirBody.includes("[To Parent Directory]")) {
          infoLeakScore -= 1;
          addTest(tests, {
            id: `dir-listing-${dirPath.replace(/\//g, "")}`, name: `Directory listing: ${dirPath}`, category: "info_leak",
            status: "fail", severity: "critical", value: `Directory listing activé sur ${dirPath}`,
            recommendation: "Désactivez le directory listing dans la configuration de votre serveur (Options -Indexes).",
            deduction: 1,
          });
          break; // One is enough
        }
      }
    }

    // 3.9 robots.txt sensitive paths
    const robotsRes = await fetchWithTimeout(
      new URL("/robots.txt", baseUrl).href,
      { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
      5000
    );
    if (robotsRes && robotsRes.status === 200) {
      const robotsTxt = await robotsRes.text();
      const sensitivePaths = ["/admin", "/api/internal", "/backup", "/phpmyadmin", "/cpanel", "/wp-admin", "/private", "/secret", "/database", "/config"];
      const exposed = sensitivePaths.filter(p => robotsTxt.toLowerCase().includes(p));
      if (exposed.length > 0) {
        infoLeakScore -= 0.5;
        addTest(tests, {
          id: "robots-sensitive", name: "robots.txt expose des chemins sensibles", category: "info_leak",
          status: "warning", severity: "warning", value: exposed.join(", "),
          recommendation: "Évitez de lister des chemins sensibles dans robots.txt — cela les révèle aux attaquants.",
          deduction: 0.5,
        });
      }
    }

    // 3.10 HTML comments with sensitive info
    const htmlComments: string[] = [];
    const commentRegex = /<!--([\s\S]*?)-->/g;
    let match;
    while ((match = commentRegex.exec(html)) !== null) {
      const comment = match[1].toLowerCase();
      const sensitiveKeywords = ["password", "pwd", "secret", "api_key", "apikey", "token", "credentials", "private_key", "access_key", "mysql", "database"];
      if (sensitiveKeywords.some(kw => comment.includes(kw))) {
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
    const generator = $('meta[name="generator"]').attr("content");
    if (generator) {
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

    // 3.13 Source maps detection
    let hasSourceMaps = false;
    $("script[src]").each((_, el) => {
      const src = $(el).attr("src") || "";
      if (src && !hasSourceMaps) {
        const fullSrc = src.startsWith("http") ? src : new URL(src, baseUrl).href;
        // Check for sourceMappingURL in the page source
        if (html.includes("sourceMappingURL")) {
          hasSourceMaps = true;
        }
      }
    });
    if (hasSourceMaps || html.includes("sourceMappingURL")) {
      infoLeakScore -= 0.5;
      addTest(tests, {
        id: "source-maps", name: "Source maps exposées", category: "info_leak",
        status: "warning", severity: "warning",
        value: "Des references sourceMappingURL ont été détectées",
        recommendation: "Supprimez les source maps en production pour ne pas exposer le code source original.",
        deduction: 0.5,
      });
    }

    // 3.14 Email exposure in HTML
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = html.match(emailRegex) || [];
    const uniqueEmails = [...new Set(emails)].filter(e => !e.includes("example.com") && !e.includes("schema.org"));
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

    // 3.15 security.txt check
    const securityTxtRes = await fetchWithTimeout(
      new URL("/.well-known/security.txt", baseUrl).href,
      { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
      5000
    );
    if (!securityTxtRes || securityTxtRes.status !== 200) {
      addTest(tests, {
        id: "security-txt-missing", name: "security.txt", category: "info_leak",
        status: "warning", severity: "info",
        value: "Absent — pas de fichier /.well-known/security.txt",
        recommendation: "Créez un fichier security.txt (RFC 9116) pour indiquer comment signaler les vulnérabilités.",
        deduction: 0,
      });
    } else {
      addTest(tests, {
        id: "security-txt-ok", name: "security.txt", category: "info_leak",
        status: "pass", severity: "info", value: "Présent",
        deduction: 0,
      });
    }

    // 3.16 Server status/info pages (Apache)
    const statusPages = ["/server-status", "/server-info"];
    for (const path of statusPages) {
      const statusRes = await fetchWithTimeout(
        new URL(path, baseUrl).href,
        { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
        5000
      );
      if (statusRes && statusRes.status === 200) {
        const body = await statusRes.text();
        if (body.includes("Apache") || body.includes("Server Version")) {
          infoLeakScore -= 1;
          addTest(tests, {
            id: `server-page-${path.replace("/", "")}`, name: `Page serveur exposée: ${path}`, category: "info_leak",
            status: "fail", severity: "critical",
            value: `${path} est accessible publiquement`,
            recommendation: `Bloquez l'accès à ${path} — il expose des informations critiques sur le serveur.`,
            deduction: 1,
          });
        }
      }
    }

    // ═══════════════════════════════════════════
    // CATEGORY 4: Cookies (7 tests)
    // ═══════════════════════════════════════════

    const setCookies = res.headers.getSetCookie?.() || [];
    if (setCookies.length > 0) {
      let hasInsecureCookie = false;
      let hasNoHttpOnly = false;
      let hasNoSameSite = false;
      let hasWeakSameSite = false;
      let hasNoPrefixes = false;
      let hasBroadDomain = false;
      let sessionCookieNames: string[] = [];

      for (const cookie of setCookies) {
        const lower = cookie.toLowerCase();
        const cookieName = cookie.split("=")[0].trim();

        if (!lower.includes("secure")) hasInsecureCookie = true;
        if (!lower.includes("httponly")) hasNoHttpOnly = true;
        if (!lower.includes("samesite")) {
          hasNoSameSite = true;
        } else if (lower.includes("samesite=none")) {
          hasWeakSameSite = true;
        }

        // Check for __Secure- or __Host- prefixes on session-like cookies
        const isSessionCookie = ["session", "sess", "sid", "token", "auth", "jwt"].some(s => cookieName.toLowerCase().includes(s));
        if (isSessionCookie) {
          sessionCookieNames.push(cookieName);
          if (!cookieName.startsWith("__Secure-") && !cookieName.startsWith("__Host-")) {
            hasNoPrefixes = true;
          }
        }

        // Check for overly broad domain
        const domainMatch = cookie.match(/domain=([^;]+)/i);
        if (domainMatch) {
          const domain = domainMatch[1].trim();
          // If domain starts with . and has only 2 parts, it's overly broad
          if (domain.startsWith(".") && domain.split(".").filter(Boolean).length <= 2) {
            hasBroadDomain = true;
          }
        }
      }

      // 4.1 Secure flag
      if (hasInsecureCookie) {
        cookiesScore -= 1;
        addTest(tests, {
          id: "cookie-no-secure", name: "Cookies sans flag Secure", category: "cookies",
          status: "fail", severity: "critical", value: "Des cookies sont envoyés sans le flag Secure",
          recommendation: "Ajoutez le flag Secure à tous les cookies pour empêcher leur envoi sur HTTP.",
          deduction: 1,
        });
      }

      // 4.2 HttpOnly flag
      if (hasNoHttpOnly) {
        cookiesScore -= 0.5;
        addTest(tests, {
          id: "cookie-no-httponly", name: "Cookies sans flag HttpOnly", category: "cookies",
          status: "warning", severity: "warning", value: "Des cookies sont accessibles via JavaScript",
          recommendation: "Ajoutez le flag HttpOnly aux cookies sensibles pour empêcher l'accès via document.cookie.",
          deduction: 0.5,
        });
      }

      // 4.3 SameSite flag
      if (hasNoSameSite) {
        cookiesScore -= 0.5;
        addTest(tests, {
          id: "cookie-no-samesite", name: "Cookies sans flag SameSite", category: "cookies",
          status: "warning", severity: "warning", value: "Des cookies n'ont pas le flag SameSite",
          recommendation: "Ajoutez SameSite=Strict ou SameSite=Lax à vos cookies pour prévenir le CSRF.",
          deduction: 0.5,
        });
      }

      // 4.4 SameSite=None (weak)
      if (hasWeakSameSite) {
        cookiesScore -= 0.3;
        addTest(tests, {
          id: "cookie-samesite-none", name: "Cookies avec SameSite=None", category: "cookies",
          status: "warning", severity: "warning",
          value: "Des cookies utilisent SameSite=None — ils sont envoyés dans toutes les requêtes cross-site",
          recommendation: "Utilisez SameSite=Strict ou Lax sauf si le cookie doit absolument être cross-site.",
          deduction: 0.3,
        });
      }

      // 4.5 Cookie prefixes
      if (hasNoPrefixes && sessionCookieNames.length > 0) {
        cookiesScore -= 0.2;
        addTest(tests, {
          id: "cookie-no-prefix", name: "Cookies de session sans préfixe sécurisé", category: "cookies",
          status: "warning", severity: "info",
          value: `Cookies de session sans préfixe __Secure- ou __Host-: ${sessionCookieNames.join(", ")}`,
          recommendation: "Utilisez les préfixes __Secure- ou __Host- pour les cookies sensibles (protection contre l'override).",
          deduction: 0.2,
        });
      }

      // 4.6 Broad domain
      if (hasBroadDomain) {
        cookiesScore -= 0.5;
        addTest(tests, {
          id: "cookie-broad-domain", name: "Cookie avec domaine trop large", category: "cookies",
          status: "warning", severity: "warning",
          value: "Un cookie est défini sur un domaine parent trop large",
          recommendation: "Restreignez le domaine des cookies au sous-domaine spécifique.",
          deduction: 0.5,
        });
      }

      if (!hasInsecureCookie && !hasNoHttpOnly && !hasNoSameSite && !hasWeakSameSite) {
        addTest(tests, {
          id: "cookies-ok", name: "Cookies", category: "cookies",
          status: "pass", severity: "info", value: `${setCookies.length} cookie(s) correctement configuré(s)`,
          deduction: 0,
        });
      }
    } else {
      addTest(tests, {
        id: "no-cookies", name: "Cookies", category: "cookies",
        status: "pass", severity: "info", value: "Aucun cookie défini",
        deduction: 0,
      });
    }

    // ═══════════════════════════════════════════
    // CATEGORY 5: Injection / XSS (15+ tests)
    // ═══════════════════════════════════════════

    // 5.1 Check forms without CSRF tokens
    const forms = $("form");
    if (forms.length > 0) {
      let formsWithoutCsrf = 0;
      let formsWithAutocomplete = 0;
      forms.each((_, form) => {
        const $form = $(form);
        const hasCsrf = $form.find('input[name*="csrf"], input[name*="token"], input[name*="_token"], input[name*="authenticity"], input[name*="nonce"]').length > 0;
        if (!hasCsrf && $form.attr("method")?.toLowerCase() === "post") {
          formsWithoutCsrf++;
        }
        // Check for autocomplete on sensitive forms
        if ($form.find('input[type="password"]').length > 0 && $form.attr("autocomplete") !== "off") {
          formsWithAutocomplete++;
        }
      });
      if (formsWithoutCsrf > 0) {
        injectionScore -= 1;
        addTest(tests, {
          id: "no-csrf", name: "Formulaires sans CSRF token", category: "injection",
          status: "fail", severity: "critical",
          value: `${formsWithoutCsrf} formulaire(s) POST sans token CSRF détecté(s)`,
          recommendation: "Ajoutez un token CSRF à tous les formulaires POST.",
          deduction: 1,
        });
      } else {
        addTest(tests, {
          id: "csrf-ok", name: "Protection CSRF", category: "injection",
          status: "pass", severity: "info", value: "Tokens CSRF détectés dans les formulaires",
          deduction: 0,
        });
      }

      // 5.1b Autocomplete on password fields
      if (formsWithAutocomplete > 0) {
        injectionScore -= 0.2;
        addTest(tests, {
          id: "autocomplete-password", name: "Autocomplete sur champs sensibles", category: "injection",
          status: "warning", severity: "info",
          value: `${formsWithAutocomplete} formulaire(s) avec autocomplete activé sur des champs de mot de passe`,
          recommendation: "Ajoutez autocomplete='off' aux formulaires contenant des mots de passe.",
          deduction: 0.2,
        });
      }
    }

    // 5.2 Reflected XSS check (canary)
    const xssTestUrl = new URL(targetUrl);
    const canary = "aifriendly_xss_probe_12345";
    xssTestUrl.searchParams.set("q", canary);
    xssTestUrl.searchParams.set("search", canary);
    const xssRes = await fetchWithTimeout(
      xssTestUrl.href,
      { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
      10000
    );
    if (xssRes) {
      const xssBody = await xssRes.text();
      if (xssBody.includes(canary)) {
        // Check if it's properly escaped or raw
        const isInTag = xssBody.includes(`"${canary}"`) || xssBody.includes(`'${canary}'`) || xssBody.includes(`=${canary}`);
        injectionScore -= isInTag ? 2 : 1;
        addTest(tests, {
          id: "reflected-input", name: "Entrées réfléchies (XSS potentiel)", category: "injection",
          status: "fail", severity: "critical",
          value: isInTag
            ? "Des paramètres d'URL sont réfléchis DANS des attributs HTML — risque XSS élevé"
            : "Des paramètres d'URL sont réfléchis dans le HTML sans échappement apparent",
          recommendation: "Échappez toutes les entrées utilisateur avant de les injecter dans le HTML. Utilisez une bibliothèque d'échappement contextuel.",
          deduction: isInTag ? 2 : 1,
        });
      } else {
        addTest(tests, {
          id: "no-reflected", name: "Entrées réfléchies", category: "injection",
          status: "pass", severity: "info", value: "Aucune réflexion détectée",
          deduction: 0,
        });
      }
    }

    // 5.3 HTML injection test
    const htmlCanary = "<b>aifriendly_html_test</b>";
    const htmlTestUrl = new URL(targetUrl);
    htmlTestUrl.searchParams.set("q", htmlCanary);
    const htmlInjRes = await fetchWithTimeout(
      htmlTestUrl.href,
      { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
      10000
    );
    if (htmlInjRes) {
      const htmlInjBody = await htmlInjRes.text();
      if (htmlInjBody.includes(htmlCanary)) {
        injectionScore -= 1.5;
        addTest(tests, {
          id: "html-injection", name: "Injection HTML détectée", category: "injection",
          status: "fail", severity: "critical",
          value: "Du HTML injecté via les paramètres est rendu sans échappement",
          recommendation: "Échappez toutes les entrées utilisateur. Les balises HTML ne doivent jamais être rendues telles quelles.",
          deduction: 1.5,
        });
      }
    }

    // 5.4 Open redirect (multiple parameters)
    const redirectParams = ["redirect", "url", "next", "return", "returnUrl", "return_to", "goto", "continue", "dest", "destination", "redir", "redirect_uri", "callback"];
    let openRedirectFound = false;
    for (const param of redirectParams) {
      if (openRedirectFound) break;
      const redirectTestUrl = new URL(targetUrl);
      redirectTestUrl.searchParams.set(param, "https://evil.com");
      const redirectRes = await fetchWithTimeout(
        redirectTestUrl.href,
        { redirect: "manual", headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
        10000
      );
      if (redirectRes && redirectRes.status >= 300 && redirectRes.status < 400) {
        const loc = redirectRes.headers.get("location") || "";
        if (loc.includes("evil.com")) {
          injectionScore -= 1;
          addTest(tests, {
            id: "open-redirect", name: "Open redirect détecté", category: "injection",
            status: "fail", severity: "critical",
            value: `Redirection vers un domaine externe via le paramètre '${param}'`,
            recommendation: "Validez les URLs de redirection côté serveur. Utilisez une whitelist de domaines autorisés.",
            deduction: 1,
          });
          openRedirectFound = true;
        }
      }
    }

    // 5.5 SQL injection error-based detection
    const sqlPayloads = ["'", "1' OR '1'='1", "1; DROP TABLE", "' UNION SELECT 1--"];
    let sqlInjectionFound = false;
    const sqlErrorPatterns = [
      "SQL syntax", "mysql_fetch", "pg_query", "ORA-", "SQLite3::",
      "Unclosed quotation mark", "SQLSTATE", "syntax error at or near",
      "Microsoft OLE DB", "ODBC SQL Server Driver", "JET Database Engine",
      "valid MySQL result", "PostgreSQL query failed", "unterminated quoted string",
    ];
    for (const payload of sqlPayloads) {
      if (sqlInjectionFound) break;
      const sqlTestUrl = new URL(targetUrl);
      sqlTestUrl.searchParams.set("id", payload);
      sqlTestUrl.searchParams.set("q", payload);
      const sqlRes = await fetchWithTimeout(
        sqlTestUrl.href,
        { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
        10000
      );
      if (sqlRes) {
        const sqlBody = await sqlRes.text();
        if (sqlErrorPatterns.some(pattern => sqlBody.includes(pattern))) {
          injectionScore -= 2;
          addTest(tests, {
            id: "sql-injection", name: "Injection SQL potentielle", category: "injection",
            status: "fail", severity: "critical",
            value: "Des erreurs SQL sont retournées en réponse à des caractères spéciaux — injection SQL probable",
            recommendation: "Utilisez des requêtes préparées (parameterized queries) et un ORM. Ne jamais concaténer les entrées utilisateur dans les requêtes SQL.",
            deduction: 2,
          });
          sqlInjectionFound = true;
        }
      }
    }

    // 5.6 Path traversal detection
    const pathTraversalPayloads = ["../../etc/passwd", "..\\..\\windows\\win.ini", "....//....//etc/passwd"];
    let pathTraversalFound = false;
    for (const payload of pathTraversalPayloads) {
      if (pathTraversalFound) break;
      const ptTestUrl = new URL(targetUrl);
      ptTestUrl.searchParams.set("file", payload);
      ptTestUrl.searchParams.set("path", payload);
      const ptRes = await fetchWithTimeout(
        ptTestUrl.href,
        { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
        10000
      );
      if (ptRes) {
        const ptBody = await ptRes.text();
        if (ptBody.includes("root:x:") || ptBody.includes("[extensions]") || ptBody.includes("/bin/bash")) {
          injectionScore -= 2;
          addTest(tests, {
            id: "path-traversal", name: "Path traversal détecté", category: "injection",
            status: "fail", severity: "critical",
            value: "Le serveur retourne le contenu de fichiers système en réponse à des chemins relatifs",
            recommendation: "Validez et assainissez tous les chemins de fichiers. Utilisez une whitelist de fichiers autorisés.",
            deduction: 2,
          });
          pathTraversalFound = true;
        }
      }
    }

    // 5.7 CORS misconfiguration
    const corsRes = await fetchWithTimeout(
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
        injectionScore -= 0.5;
        addTest(tests, {
          id: "cors-wildcard", name: "CORS: wildcard Access-Control-Allow-Origin", category: "injection",
          status: "warning", severity: "warning",
          value: "Access-Control-Allow-Origin: * — toutes les origines sont autorisées",
          recommendation: "Restreignez CORS aux domaines de confiance au lieu d'utiliser *.",
          deduction: 0.5,
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

    // 5.8 TRACE method enabled (Cross-Site Tracing)
    const traceRes = await fetchWithTimeout(
      targetUrl,
      {
        method: "TRACE",
        headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" },
      },
      10000
    );
    if (traceRes && traceRes.status === 200) {
      const traceBody = await traceRes.text();
      if (traceBody.includes("TRACE")) {
        injectionScore -= 0.5;
        addTest(tests, {
          id: "trace-enabled", name: "Méthode TRACE activée (XST)", category: "injection",
          status: "fail", severity: "warning",
          value: "La méthode HTTP TRACE est activée — permet le Cross-Site Tracing",
          recommendation: "Désactivez la méthode TRACE dans la configuration de votre serveur web.",
          deduction: 0.5,
        });
      }
    }

    // 5.9 Dangerous HTTP methods (PUT, DELETE)
    const dangerousMethods = ["PUT", "DELETE"];
    for (const method of dangerousMethods) {
      const methodRes = await fetchWithTimeout(
        targetUrl,
        {
          method: method,
          headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" },
        },
        10000
      );
      if (methodRes && (methodRes.status === 200 || methodRes.status === 201 || methodRes.status === 204)) {
        injectionScore -= 0.5;
        addTest(tests, {
          id: `method-${method.toLowerCase()}`, name: `Méthode ${method} autorisée`, category: "injection",
          status: "warning", severity: "warning",
          value: `La méthode HTTP ${method} retourne ${methodRes.status} — potentiellement dangereux si non protégé`,
          recommendation: `Restreignez la méthode ${method} aux endpoints qui en ont besoin et protégez-les par authentification.`,
          deduction: 0.5,
        });
      }
    }

    // 5.10 DOM-based XSS indicators
    const dangerousDomPatterns = [
      { pattern: "document.write(", name: "document.write()" },
      { pattern: ".innerHTML =", name: "innerHTML assignment" },
      { pattern: ".innerHTML=", name: "innerHTML assignment" },
      { pattern: ".outerHTML =", name: "outerHTML assignment" },
      { pattern: "eval(", name: "eval()" },
      { pattern: "setTimeout(\"", name: "setTimeout with string" },
      { pattern: "setTimeout('", name: "setTimeout with string" },
      { pattern: "setInterval(\"", name: "setInterval with string" },
      { pattern: "setInterval('", name: "setInterval with string" },
    ];
    const foundDomPatterns: string[] = [];
    for (const { pattern, name } of dangerousDomPatterns) {
      if (html.includes(pattern)) {
        foundDomPatterns.push(name);
      }
    }
    if (foundDomPatterns.length > 0) {
      injectionScore -= 0.5;
      addTest(tests, {
        id: "dom-xss-patterns", name: "Patterns DOM XSS détectés", category: "injection",
        status: "warning", severity: "warning",
        value: `Patterns dangereux trouvés: ${foundDomPatterns.join(", ")}`,
        recommendation: "Évitez document.write(), innerHTML et eval(). Utilisez textContent et les API DOM sécurisées.",
        deduction: 0.5,
      });
    }

    // 5.11 JSONP endpoint detection
    const jsonpRes = await fetchWithTimeout(
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
      injectionScore -= 0.3;
      addTest(tests, {
        id: "inline-events", name: "Gestionnaires d'événements inline", category: "injection",
        status: "warning", severity: "info",
        value: `${inlineEventHandlers} attributs d'événements inline (onclick, onload, etc.) détectés`,
        recommendation: "Utilisez addEventListener() au lieu des attributs d'événements inline pour une meilleure séparation et compatibilité CSP.",
        deduction: 0.3,
      });
    }

    // 5.13 Forms with action to external domain
    let externalFormActions = 0;
    $("form[action]").each((_, form) => {
      const action = $(form).attr("action") || "";
      if (action.startsWith("http") && !action.includes(new URL(targetUrl).hostname)) {
        externalFormActions++;
      }
    });
    if (externalFormActions > 0) {
      injectionScore -= 0.5;
      addTest(tests, {
        id: "external-form-action", name: "Formulaires avec action externe", category: "injection",
        status: "warning", severity: "warning",
        value: `${externalFormActions} formulaire(s) envoient les données vers un domaine externe`,
        recommendation: "Vérifiez que les formulaires envoyant des données à des domaines externes sont légitimes.",
        deduction: 0.5,
      });
    }

    // 5.14 Password fields without autocomplete=off and in HTTP (non-HTTPS)
    if (!targetUrl.startsWith("https://")) {
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

    // 5.15 Clickjacking via iframe test (try to embed the site)
    // Already covered by X-Frame-Options and CSP frame-ancestors above

    // 5.16 Check for Content-Type header on API-like responses
    const contentType = headers.get("content-type");
    if (contentType && !contentType.includes("charset")) {
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
