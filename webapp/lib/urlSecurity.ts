/**
 * Validation et sécurisation des URL pour l'API d'analyse.
 * Protège contre SSRF, abus (longueur, schéma) et fuite d'identifiants.
 */

import { isHostnameBlocked, unbracketHostname } from "./ssrf-guard";

const MAX_URL_LENGTH = 2048;
const ALLOWED_PROTOCOLS = ["http:", "https:"];

/**
 * Vérification statique (sans DNS) du hostname. La résolution DNS et la
 * revalidation des redirections sont faites par `safeFetch` (ssrf-guard.ts).
 * L'ancienne implémentation par préfixes de chaînes laissait passer
 * `[::ffff:7f00:1]`, 100.64.0.0/10, etc. et bloquait à tort des domaines
 * publics commençant par "fc"/"fd" (ex. fcbarcelona.com).
 */
function isHostPrivate(hostname: string): boolean {
  return isHostnameBlocked(hostname);
}

function getHostnameFromURL(u: URL): string {
  return unbracketHostname(u.hostname);
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
