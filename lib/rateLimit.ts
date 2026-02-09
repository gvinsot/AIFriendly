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

function getClientKey(forwardedFor: string | null, realIp: string | null): string {
  const first = forwardedFor?.split(",")[0]?.trim() || realIp || "unknown";
  return first;
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
