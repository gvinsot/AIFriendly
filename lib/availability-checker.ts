/**
 * Availability Checker — Measures ping, TTFB, load time, SSL validity
 * Returns a score out of 10 based on availability metrics.
 */

const AVAILABILITY_TIMEOUT_MS = 30000;

interface AvailabilityResult {
  score: number;
  httpStatus: number | null;
  pingMs: number | null;
  ttfbMs: number | null;
  loadTimeMs: number | null;
  responseSize: number | null;
  sslValid: boolean | null;
  sslExpiry: string | null;
  details: {
    checks: AvailabilityCheckItem[];
    timestamp: string;
  };
}

interface AvailabilityCheckItem {
  id: string;
  name: string;
  value: string;
  status: "pass" | "warning" | "fail";
  deduction: number;
}

export async function checkAvailability(targetUrl: string): Promise<AvailabilityResult> {
  const checks: AvailabilityCheckItem[] = [];
  let score = 10;
  let httpStatus: number | null = null;
  let pingMs: number | null = null;
  let ttfbMs: number | null = null;
  let loadTimeMs: number | null = null;
  let responseSize: number | null = null;
  let sslValid: boolean | null = null;
  let sslExpiry: string | null = null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT_MS);

  try {
    // Measure ping (DNS + TCP connect via a HEAD request)
    const pingStart = performance.now();
    let pingRes: Response;
    try {
      pingRes = await fetch(targetUrl, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "AIFriendly/1.0 (AvailabilityCheck)" },
      });
      pingMs = Math.round(performance.now() - pingStart);
    } catch {
      // Site unreachable
      clearTimeout(timeout);
      return {
        score: 0,
        httpStatus: null,
        pingMs: null,
        ttfbMs: null,
        loadTimeMs: null,
        responseSize: null,
        sslValid: null,
        sslExpiry: null,
        details: {
          checks: [{
            id: "unreachable",
            name: "Accessibilité",
            value: "Site inaccessible (timeout ou erreur réseau)",
            status: "fail",
            deduction: 10,
          }],
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Full page load (GET request with body)
    const loadStart = performance.now();
    let fullRes: Response;
    try {
      fullRes = await fetch(targetUrl, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
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
        score: 0,
        httpStatus: null,
        pingMs,
        ttfbMs: null,
        loadTimeMs: null,
        responseSize: null,
        sslValid: null,
        sslExpiry: null,
        details: {
          checks: [{
            id: "load-fail",
            name: "Chargement",
            value: "Impossible de charger la page complète",
            status: "fail",
            deduction: 10,
          }],
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Check SSL (only for https URLs)
    if (targetUrl.startsWith("https://")) {
      try {
        // We check if the request succeeded over HTTPS — if it did, SSL is valid
        sslValid = true;
        checks.push({
          id: "ssl-valid",
          name: "Certificat SSL",
          value: "Valide",
          status: "pass",
          deduction: 0,
        });
      } catch {
        sslValid = false;
        score -= 2;
        checks.push({
          id: "ssl-invalid",
          name: "Certificat SSL",
          value: "Invalide ou expiré",
          status: "fail",
          deduction: 2,
        });
      }
    } else {
      // HTTP without HTTPS
      sslValid = false;
      score -= 1;
      checks.push({
        id: "no-https",
        name: "HTTPS",
        value: "Le site n'utilise pas HTTPS",
        status: "warning",
        deduction: 1,
      });
    }

    // Score: HTTP status
    if (httpStatus === 200) {
      checks.push({
        id: "http-status",
        name: "Code HTTP",
        value: `${httpStatus} OK`,
        status: "pass",
        deduction: 0,
      });
    } else if (httpStatus >= 300 && httpStatus < 400) {
      score -= 1;
      checks.push({
        id: "http-status",
        name: "Code HTTP",
        value: `${httpStatus} (redirection)`,
        status: "warning",
        deduction: 1,
      });
    } else if (httpStatus >= 400 && httpStatus < 500) {
      score -= 2;
      checks.push({
        id: "http-status",
        name: "Code HTTP",
        value: `${httpStatus} (erreur client)`,
        status: "fail",
        deduction: 2,
      });
    } else if (httpStatus >= 500) {
      score -= 3;
      checks.push({
        id: "http-status",
        name: "Code HTTP",
        value: `${httpStatus} (erreur serveur)`,
        status: "fail",
        deduction: 3,
      });
    }

    // Score: Ping
    if (pingMs !== null) {
      if (pingMs > 500) {
        score -= 3;
        checks.push({
          id: "ping",
          name: "Ping",
          value: `${pingMs}ms (très élevé)`,
          status: "fail",
          deduction: 3,
        });
      } else if (pingMs > 200) {
        score -= 1.5;
        checks.push({
          id: "ping",
          name: "Ping",
          value: `${pingMs}ms (élevé)`,
          status: "warning",
          deduction: 1.5,
        });
      } else if (pingMs > 100) {
        score -= 0.5;
        checks.push({
          id: "ping",
          name: "Ping",
          value: `${pingMs}ms (acceptable)`,
          status: "warning",
          deduction: 0.5,
        });
      } else {
        checks.push({
          id: "ping",
          name: "Ping",
          value: `${pingMs}ms (excellent)`,
          status: "pass",
          deduction: 0,
        });
      }
    }

    // Score: Load time
    if (loadTimeMs !== null) {
      if (loadTimeMs > 10000) {
        score -= 3;
        checks.push({
          id: "load-time",
          name: "Temps de chargement",
          value: `${(loadTimeMs / 1000).toFixed(1)}s (très lent)`,
          status: "fail",
          deduction: 3,
        });
      } else if (loadTimeMs > 5000) {
        score -= 2;
        checks.push({
          id: "load-time",
          name: "Temps de chargement",
          value: `${(loadTimeMs / 1000).toFixed(1)}s (lent)`,
          status: "warning",
          deduction: 2,
        });
      } else if (loadTimeMs > 2000) {
        score -= 1;
        checks.push({
          id: "load-time",
          name: "Temps de chargement",
          value: `${(loadTimeMs / 1000).toFixed(1)}s (moyen)`,
          status: "warning",
          deduction: 1,
        });
      } else if (loadTimeMs > 1000) {
        score -= 0.5;
        checks.push({
          id: "load-time",
          name: "Temps de chargement",
          value: `${(loadTimeMs / 1000).toFixed(1)}s (correct)`,
          status: "pass",
          deduction: 0.5,
        });
      } else {
        checks.push({
          id: "load-time",
          name: "Temps de chargement",
          value: `${loadTimeMs}ms (rapide)`,
          status: "pass",
          deduction: 0,
        });
      }
    }

    // Score: TTFB
    if (ttfbMs !== null) {
      if (ttfbMs > 3000) {
        checks.push({
          id: "ttfb",
          name: "TTFB",
          value: `${ttfbMs}ms (très lent)`,
          status: "fail",
          deduction: 0,
        });
      } else if (ttfbMs > 1000) {
        checks.push({
          id: "ttfb",
          name: "TTFB",
          value: `${ttfbMs}ms (lent)`,
          status: "warning",
          deduction: 0,
        });
      } else {
        checks.push({
          id: "ttfb",
          name: "TTFB",
          value: `${ttfbMs}ms`,
          status: "pass",
          deduction: 0,
        });
      }
    }

    // Response size info
    if (responseSize !== null) {
      const sizeKb = (responseSize / 1024).toFixed(1);
      checks.push({
        id: "response-size",
        name: "Taille de la réponse",
        value: `${sizeKb} Ko`,
        status: "pass",
        deduction: 0,
      });
    }
  } finally {
    clearTimeout(timeout);
  }

  const finalScore = Math.max(0, Math.min(10, Math.round(score * 10) / 10));

  return {
    score: finalScore,
    httpStatus,
    pingMs,
    ttfbMs,
    loadTimeMs,
    responseSize,
    sslValid,
    sslExpiry,
    details: {
      checks,
      timestamp: new Date().toISOString(),
    },
  };
}
