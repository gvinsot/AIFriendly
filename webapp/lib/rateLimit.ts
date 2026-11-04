/**
 * Rate limiting en mémoire (par IP).
 * Limite le nombre d'appels à l'API d'analyse par fenêtre de temps.
 */

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();
/** Plafond d'entrées pour borner la mémoire même sous un flot d'IP distinctes. */
const MAX_STORE_ENTRIES = 50_000;

/**
 * Nombre de reverse proxies de confiance devant l'application (Traefik = 1).
 * Chaque proxy AJOUTE l'IP de son client à droite de X-Forwarded-For : seules
 * les N dernières entrées sont fiables. L'ancienne implémentation prenait la
 * PREMIÈRE entrée, entièrement contrôlée par le client : il suffisait d'envoyer
 * un X-Forwarded-For aléatoire à chaque requête pour contourner la limite.
 */
const TRUSTED_PROXY_HOPS = Math.max(0, parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10) || 0);

function getClientKey(forwardedFor: string | null, realIp: string | null): string {
  if (TRUSTED_PROXY_HOPS > 0 && forwardedFor) {
    const chain = forwardedFor
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // IP vue par le proxy de confiance le plus externe
    const ip = chain[Math.max(0, chain.length - TRUSTED_PROXY_HOPS)];
    if (ip) return ip;
  }
  return realIp?.trim() || "unknown";
}

/**
 * Vérifie si la requête est autorisée. Incrémente le compteur si oui.
 * @returns { allowed: true } ou { allowed: false, retryAfterSeconds: number }
 */
export function checkRateLimit(request: Request): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const key = getClientKey(forwardedFor, realIp);

  const now = Date.now();
  let entry = store.get(key);

  if (entry) {
    if (now >= entry.resetAt) {
      entry = { count: 1, resetAt: now + WINDOW_MS };
      store.set(key, entry);
      return { allowed: true };
    }
    if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, retryAfterSeconds };
    }
    entry.count += 1;
    return { allowed: true };
  }

  if (store.size >= MAX_STORE_ENTRIES) cleanup();
  if (store.size >= MAX_STORE_ENTRIES) {
    // Saturation (attaque distribuée) : refuser plutôt que croître sans borne
    return { allowed: false, retryAfterSeconds: Math.ceil(WINDOW_MS / 1000) };
  }
  store.set(key, { count: 1, resetAt: now + WINDOW_MS });
  return { allowed: true };
}

/** Nettoyage périodique des entrées expirées (éviter fuite mémoire). */
function cleanup(): void {
  const now = Date.now();
  Array.from(store.entries()).forEach(([k, v]) => {
    if (now >= v.resetAt) store.delete(k);
  });
}

// Nettoyer toutes les 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(cleanup, 5 * 60 * 1000);
}
