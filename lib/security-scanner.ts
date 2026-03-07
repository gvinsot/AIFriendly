/**
 * Security Scanner — Passive OWASP-based security audit
 * Tests security headers, SSL/TLS, cookies, info leaks, injection/XSS vectors
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
    // CATEGORY 1: Security Headers
    // ═══════════════════════════════════════════

    // Content-Security-Policy
    const csp = headers.get("content-security-policy");
    if (!csp) {
      headersScore -= 1.5;
      tests.push({
        id: "csp-missing", name: "Content-Security-Policy", category: "headers",
        status: "fail", severity: "critical", value: "Absent",
        recommendation: "Ajoutez un header Content-Security-Policy pour prévenir les attaques XSS et injection de contenu.",
        deduction: 1.5,
      });
    } else {
      tests.push({
        id: "csp-present", name: "Content-Security-Policy", category: "headers",
        status: "pass", severity: "info", value: csp.slice(0, 100) + (csp.length > 100 ? "..." : ""),
        deduction: 0,
      });
    }

    // X-Frame-Options
    const xfo = headers.get("x-frame-options");
    if (!xfo) {
      headersScore -= 1;
      tests.push({
        id: "xfo-missing", name: "X-Frame-Options", category: "headers",
        status: "fail", severity: "critical", value: "Absent — vulnérable au clickjacking",
        recommendation: "Ajoutez X-Frame-Options: DENY ou SAMEORIGIN.",
        deduction: 1,
      });
    } else {
      tests.push({
        id: "xfo-present", name: "X-Frame-Options", category: "headers",
        status: "pass", severity: "info", value: xfo,
        deduction: 0,
      });
    }

    // X-Content-Type-Options
    const xcto = headers.get("x-content-type-options");
    if (!xcto || xcto !== "nosniff") {
      headersScore -= 0.5;
      tests.push({
        id: "xcto-missing", name: "X-Content-Type-Options", category: "headers",
        status: "warning", severity: "warning", value: xcto || "Absent",
        recommendation: "Ajoutez X-Content-Type-Options: nosniff.",
        deduction: 0.5,
      });
    } else {
      tests.push({
        id: "xcto-present", name: "X-Content-Type-Options", category: "headers",
        status: "pass", severity: "info", value: xcto,
        deduction: 0,
      });
    }

    // Strict-Transport-Security
    const hsts = headers.get("strict-transport-security");
    if (!hsts) {
      headersScore -= 1;
      tests.push({
        id: "hsts-missing", name: "Strict-Transport-Security", category: "headers",
        status: "fail", severity: "critical", value: "Absent",
        recommendation: "Ajoutez Strict-Transport-Security: max-age=31536000; includeSubDomains.",
        deduction: 1,
      });
    } else {
      // Check max-age
      const maxAgeMatch = hsts.match(/max-age=(\d+)/);
      const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 0;
      if (maxAge < 15768000) { // 6 months
        headersScore -= 0.5;
        tests.push({
          id: "hsts-short", name: "Strict-Transport-Security", category: "headers",
          status: "warning", severity: "warning", value: `max-age=${maxAge} (< 6 mois)`,
          recommendation: "Augmentez la durée HSTS à au moins 6 mois (15768000 secondes).",
          deduction: 0.5,
        });
      } else {
        tests.push({
          id: "hsts-present", name: "Strict-Transport-Security", category: "headers",
          status: "pass", severity: "info", value: hsts,
          deduction: 0,
        });
      }
    }

    // X-XSS-Protection
    const xxss = headers.get("x-xss-protection");
    if (!xxss) {
      headersScore -= 0.3;
      tests.push({
        id: "xxss-missing", name: "X-XSS-Protection", category: "headers",
        status: "warning", severity: "warning", value: "Absent",
        recommendation: "Ajoutez X-XSS-Protection: 1; mode=block.",
        deduction: 0.3,
      });
    } else {
      tests.push({
        id: "xxss-present", name: "X-XSS-Protection", category: "headers",
        status: "pass", severity: "info", value: xxss,
        deduction: 0,
      });
    }

    // Referrer-Policy
    const referrer = headers.get("referrer-policy");
    if (!referrer) {
      headersScore -= 0.3;
      tests.push({
        id: "referrer-missing", name: "Referrer-Policy", category: "headers",
        status: "warning", severity: "info", value: "Absent",
        recommendation: "Ajoutez Referrer-Policy: strict-origin-when-cross-origin.",
        deduction: 0.3,
      });
    } else {
      tests.push({
        id: "referrer-present", name: "Referrer-Policy", category: "headers",
        status: "pass", severity: "info", value: referrer,
        deduction: 0,
      });
    }

    // Permissions-Policy
    const permissions = headers.get("permissions-policy");
    if (!permissions) {
      headersScore -= 0.3;
      tests.push({
        id: "permissions-missing", name: "Permissions-Policy", category: "headers",
        status: "warning", severity: "info", value: "Absent",
        recommendation: "Ajoutez un header Permissions-Policy pour restreindre les API navigateur.",
        deduction: 0.3,
      });
    } else {
      tests.push({
        id: "permissions-present", name: "Permissions-Policy", category: "headers",
        status: "pass", severity: "info", value: permissions.slice(0, 100),
        deduction: 0,
      });
    }

    // ═══════════════════════════════════════════
    // CATEGORY 2: SSL/TLS
    // ═══════════════════════════════════════════

    if (targetUrl.startsWith("https://")) {
      tests.push({
        id: "ssl-https", name: "HTTPS", category: "ssl",
        status: "pass", severity: "info", value: "Le site utilise HTTPS",
        deduction: 0,
      });

      // Check HTTP redirect to HTTPS
      const httpUrl = targetUrl.replace("https://", "http://");
      const httpRes = await fetchWithTimeout(httpUrl, {
        redirect: "manual",
        headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" },
      });
      if (httpRes) {
        const location = httpRes.headers.get("location") || "";
        if (httpRes.status >= 300 && httpRes.status < 400 && location.startsWith("https://")) {
          tests.push({
            id: "http-redirect", name: "Redirection HTTP → HTTPS", category: "ssl",
            status: "pass", severity: "info", value: `${httpRes.status} → ${location.slice(0, 80)}`,
            deduction: 0,
          });
        } else {
          sslScore -= 1;
          tests.push({
            id: "http-no-redirect", name: "Redirection HTTP → HTTPS", category: "ssl",
            status: "warning", severity: "warning", value: "HTTP ne redirige pas vers HTTPS",
            recommendation: "Configurez une redirection automatique HTTP → HTTPS.",
            deduction: 1,
          });
        }
      }
    } else {
      sslScore -= 2;
      tests.push({
        id: "no-https", name: "HTTPS", category: "ssl",
        status: "fail", severity: "critical", value: "Le site n'utilise pas HTTPS",
        recommendation: "Migrez vers HTTPS avec un certificat SSL valide.",
        deduction: 2,
      });
    }

    // ═══════════════════════════════════════════
    // CATEGORY 3: Information Leaks
    // ═══════════════════════════════════════════

    // Server header
    const server = headers.get("server");
    if (server) {
      infoLeakScore -= 0.3;
      tests.push({
        id: "server-exposed", name: "Header Server exposé", category: "info_leak",
        status: "warning", severity: "info", value: server,
        recommendation: "Masquez le header Server pour ne pas révéler votre technologie.",
        deduction: 0.3,
      });
    } else {
      tests.push({
        id: "server-hidden", name: "Header Server", category: "info_leak",
        status: "pass", severity: "info", value: "Non exposé",
        deduction: 0,
      });
    }

    // X-Powered-By
    const poweredBy = headers.get("x-powered-by");
    if (poweredBy) {
      infoLeakScore -= 0.5;
      tests.push({
        id: "powered-by-exposed", name: "X-Powered-By exposé", category: "info_leak",
        status: "warning", severity: "warning", value: poweredBy,
        recommendation: "Supprimez le header X-Powered-By.",
        deduction: 0.5,
      });
    } else {
      tests.push({
        id: "powered-by-hidden", name: "X-Powered-By", category: "info_leak",
        status: "pass", severity: "info", value: "Non exposé",
        deduction: 0,
      });
    }

    // Sensitive files check
    const sensitiveFiles = [
      { path: "/.env", name: ".env" },
      { path: "/.git/HEAD", name: ".git/" },
      { path: "/wp-config.php", name: "wp-config.php" },
      { path: "/.htaccess", name: ".htaccess" },
      { path: "/phpinfo.php", name: "phpinfo.php" },
      { path: "/.DS_Store", name: ".DS_Store" },
    ];

    for (const file of sensitiveFiles) {
      const fileRes = await fetchWithTimeout(
        new URL(file.path, baseUrl).href,
        { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
        5000
      );
      if (fileRes && fileRes.status === 200) {
        const ct = fileRes.headers.get("content-type") || "";
        // Only flag if it's not returning the main site's HTML (custom 404)
        if (!ct.includes("text/html")) {
          infoLeakScore -= 2;
          tests.push({
            id: `sensitive-${file.name}`, name: `Fichier sensible accessible: ${file.name}`, category: "info_leak",
            status: "fail", severity: "critical", value: `${file.path} retourne HTTP 200`,
            recommendation: `Bloquez l'accès à ${file.path} dans votre serveur web.`,
            deduction: 2,
          });
        }
      }
    }

    // Directory listing check
    const dirRes = await fetchWithTimeout(
      new URL("/icons/", baseUrl).href,
      { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
      5000
    );
    if (dirRes && dirRes.status === 200) {
      const dirBody = await dirRes.text();
      if (dirBody.includes("Index of") || dirBody.includes("Directory listing")) {
        infoLeakScore -= 1;
        tests.push({
          id: "dir-listing", name: "Directory listing", category: "info_leak",
          status: "fail", severity: "critical", value: "Directory listing activé",
          recommendation: "Désactivez le directory listing dans la configuration de votre serveur.",
          deduction: 1,
        });
      }
    }

    // robots.txt sensitive paths
    const robotsRes = await fetchWithTimeout(
      new URL("/robots.txt", baseUrl).href,
      { headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
      5000
    );
    if (robotsRes && robotsRes.status === 200) {
      const robotsTxt = await robotsRes.text();
      const sensitivePaths = ["/admin", "/api/internal", "/backup", "/phpmyadmin", "/cpanel", "/wp-admin"];
      const exposed = sensitivePaths.filter(p => robotsTxt.toLowerCase().includes(p));
      if (exposed.length > 0) {
        infoLeakScore -= 0.5;
        tests.push({
          id: "robots-sensitive", name: "robots.txt expose des chemins sensibles", category: "info_leak",
          status: "warning", severity: "warning", value: exposed.join(", "),
          recommendation: "Évitez de lister des chemins sensibles dans robots.txt.",
          deduction: 0.5,
        });
      }
    }

    // ═══════════════════════════════════════════
    // CATEGORY 4: Cookies
    // ═══════════════════════════════════════════

    const setCookies = res.headers.getSetCookie?.() || [];
    if (setCookies.length > 0) {
      let hasInsecureCookie = false;
      let hasNoHttpOnly = false;
      let hasNoSameSite = false;

      for (const cookie of setCookies) {
        const lower = cookie.toLowerCase();
        if (!lower.includes("secure")) hasInsecureCookie = true;
        if (!lower.includes("httponly")) hasNoHttpOnly = true;
        if (!lower.includes("samesite")) hasNoSameSite = true;
      }

      if (hasInsecureCookie) {
        cookiesScore -= 1;
        tests.push({
          id: "cookie-no-secure", name: "Cookies sans flag Secure", category: "cookies",
          status: "fail", severity: "critical", value: "Des cookies sont envoyés sans le flag Secure",
          recommendation: "Ajoutez le flag Secure à tous les cookies.",
          deduction: 1,
        });
      }
      if (hasNoHttpOnly) {
        cookiesScore -= 0.5;
        tests.push({
          id: "cookie-no-httponly", name: "Cookies sans flag HttpOnly", category: "cookies",
          status: "warning", severity: "warning", value: "Des cookies sont accessibles via JavaScript",
          recommendation: "Ajoutez le flag HttpOnly aux cookies sensibles.",
          deduction: 0.5,
        });
      }
      if (hasNoSameSite) {
        cookiesScore -= 0.5;
        tests.push({
          id: "cookie-no-samesite", name: "Cookies sans flag SameSite", category: "cookies",
          status: "warning", severity: "warning", value: "Des cookies n'ont pas le flag SameSite",
          recommendation: "Ajoutez SameSite=Strict ou SameSite=Lax à vos cookies.",
          deduction: 0.5,
        });
      }

      if (!hasInsecureCookie && !hasNoHttpOnly && !hasNoSameSite) {
        tests.push({
          id: "cookies-ok", name: "Cookies", category: "cookies",
          status: "pass", severity: "info", value: `${setCookies.length} cookie(s) correctement configuré(s)`,
          deduction: 0,
        });
      }
    } else {
      tests.push({
        id: "no-cookies", name: "Cookies", category: "cookies",
        status: "pass", severity: "info", value: "Aucun cookie défini",
        deduction: 0,
      });
    }

    // ═══════════════════════════════════════════
    // CATEGORY 5: Injection / XSS
    // ═══════════════════════════════════════════

    // Check forms without CSRF tokens
    const forms = $("form");
    if (forms.length > 0) {
      let formsWithoutCsrf = 0;
      forms.each((_, form) => {
        const $form = $(form);
        const hasCsrf = $form.find('input[name*="csrf"], input[name*="token"], input[name*="_token"]').length > 0;
        if (!hasCsrf && $form.attr("method")?.toLowerCase() === "post") {
          formsWithoutCsrf++;
        }
      });
      if (formsWithoutCsrf > 0) {
        injectionScore -= 1;
        tests.push({
          id: "no-csrf", name: "Formulaires sans CSRF token", category: "injection",
          status: "fail", severity: "critical",
          value: `${formsWithoutCsrf} formulaire(s) POST sans token CSRF détecté(s)`,
          recommendation: "Ajoutez un token CSRF à tous les formulaires POST.",
          deduction: 1,
        });
      } else {
        tests.push({
          id: "csrf-ok", name: "Protection CSRF", category: "injection",
          status: "pass", severity: "info", value: "Tokens CSRF détectés dans les formulaires",
          deduction: 0,
        });
      }
    }

    // Check for reflected input (basic XSS check)
    // Test with a canary value in a common parameter
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
        injectionScore -= 1.5;
        tests.push({
          id: "reflected-input", name: "Entrées réfléchies détectées", category: "injection",
          status: "fail", severity: "critical",
          value: "Des paramètres d'URL sont réfléchis dans le HTML sans échappement apparent",
          recommendation: "Échappez toutes les entrées utilisateur avant de les injecter dans le HTML.",
          deduction: 1.5,
        });
      } else {
        tests.push({
          id: "no-reflected", name: "Entrées réfléchies", category: "injection",
          status: "pass", severity: "info", value: "Aucune réflexion détectée",
          deduction: 0,
        });
      }
    }

    // Check for open redirect
    const redirectTestUrl = new URL(targetUrl);
    redirectTestUrl.searchParams.set("redirect", "https://evil.com");
    redirectTestUrl.searchParams.set("url", "https://evil.com");
    redirectTestUrl.searchParams.set("next", "https://evil.com");
    const redirectRes = await fetchWithTimeout(
      redirectTestUrl.href,
      { redirect: "manual", headers: { "User-Agent": "AIFriendly/1.0 (SecurityScan)" } },
      10000
    );
    if (redirectRes && redirectRes.status >= 300 && redirectRes.status < 400) {
      const loc = redirectRes.headers.get("location") || "";
      if (loc.includes("evil.com")) {
        injectionScore -= 1;
        tests.push({
          id: "open-redirect", name: "Open redirect détecté", category: "injection",
          status: "fail", severity: "critical",
          value: `Redirection vers un domaine externe via paramètre URL`,
          recommendation: "Validez les URLs de redirection côté serveur.",
          deduction: 1,
        });
      }
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
