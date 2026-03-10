/**
 * Validation et sécurisation des URL pour l'API d'analyse.
 * Protège contre SSRF, abus (longueur, schéma) et fuite d'identifiants.
 */

const MAX_URL_LENGTH = 2048;
const ALLOWED_PROTOCOLS = ["http:", "https:"];

/** Plages d'IP privées ou locales (RFC 1918, localhost, link-local, etc.) */
const PRIVATE_IPV4_REGEX = /^(?:127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.)/;
const LOCALHOST_REGEX = /^localhost$/i;
const BRACKET_IPV6 = /^\[([^\]]+)\]$/;

function isPrivateIPv4(host: string): boolean {
  return PRIVATE_IPV4_REGEX.test(host) || LOCALHOST_REGEX.test(host);
}

function isPrivateIPv6(host: string): boolean {
  const lower = host.toLowerCase();
  // ::1, ::ffff:127.x, fe80:: (link-local), fc00:: (ULA)
  return (
    lower === "::1" ||
    lower === "localhost" ||
    lower.startsWith("::ffff:127.") ||
    lower.startsWith("::ffff:10.") ||
    lower.startsWith("::ffff:172.") ||
    lower.startsWith("::ffff:192.168.") ||
    lower.startsWith("fe80:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  );
}

function getHostnameFromURL(u: URL): string {
  const host = u.hostname;
  const ipv6Match = host.match(BRACKET_IPV6);
  return ipv6Match ? ipv6Match[1] : host;
}

function isHostPrivate(hostname: string): boolean {
  const normalized = hostname.toLowerCase().trim();
  if (isPrivateIPv4(normalized)) return true;
  if (isPrivateIPv6(normalized)) return true;
  // Hostname résolu en interne (ex. .local, .internal, .corp)
  if (
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".localhost")
  )
    return true;
  return false;
}

export interface UrlValidationResult {
  ok: true;
  url: URL;
  normalized: string;
}

export interface UrlValidationError {
  ok: false;
  error: string;
}

export function validateAndNormalizeUrl(input: string): UrlValidationResult | UrlValidationError {
  if (typeof input !== "string") {
    return { ok: false, error: "URL invalide." };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "URL invalide." };
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, error: "URL trop longue." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "URL invalide. Utilisez une URL complète (ex: https://example.com)." };
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { ok: false, error: "Seules les URL http et https sont acceptées." };
  }

  // Pas d'identifiants dans l'URL (éviter fuite en logs / redirects)
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Les identifiants dans l'URL ne sont pas autorisés." };
  }

  const hostname = getHostnameFromURL(parsed);
  if (isHostPrivate(hostname)) {
    return { ok: false, error: "Cette URL n'est pas autorisée." };
  }

  // Réassemblage sans fragment pour cohérence (optionnel)
  const normalized =
    parsed.origin + parsed.pathname + parsed.search;

  return {
    ok: true,
    url: parsed,
    normalized: normalized.endsWith("/") && parsed.pathname === "/" ? normalized : normalized.replace(/\/$/, "") || normalized,
  };
}

/** Vérifie que l'URL finale après redirects ne pointe pas vers une cible interne (SSRF). */
export function isUrlSafeForFetch(urlString: string): boolean {
  try {
    const u = new URL(urlString);
    const hostname = getHostnameFromURL(u);
    return !isHostPrivate(hostname);
  } catch {
    return false;
  }
}
