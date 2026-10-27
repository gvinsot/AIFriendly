/**
 * Durcissement du runtime Node.js face à CVE-2026-111497 ("Node2Shell").
 *
 * La faille est une écriture hors limites dans le décodeur Brotli embarqué par
 * Node.js (node:zlib), déclenchable par un flux Brotli malformé. Elle est
 * corrigée dans Node.js 22.23.4, 24.22.1 et 26.12.1. Les branches 20.x, 23.x
 * et 25.x sont en fin de vie et ne seront PAS corrigées.
 *
 * Le seul vrai correctif est la mise à jour de Node.js (images Docker). Ce
 * module ajoute une défense en profondeur :
 *  - refus de démarrer en production sur un runtime vulnérable ;
 *  - ne pas annoncer Brotli (Accept-Encoding) lors des fetch() sortants vers
 *    des sites tiers non fiables, et rejeter les réponses encodées en `br` ;
 *  - middleware HTTP rejetant les corps de requête `Content-Encoding: br`.
 *
 * Les mêmes versions (release sécurité Node.js du 21/10/2026) corrigent aussi
 * CVE-2026-105483, CVE-2026-106069, CVE-2026-106072 (validation du hostname
 * TLS), CVE-2026-105481 (keep-alive), CVE-2026-106074 (UUID prédictibles via
 * startup snapshot), CVE-2026-106071 et CVE-2026-106070 : la vérification de
 * version ci-dessous couvre donc l'ensemble du lot.
 *
 * Fichier partagé : utilisé par la webapp, le serveur MCP et le worker.
 */

/** Premières versions corrigées, par branche majeure maintenue. */
const PATCHED_VERSIONS: Record<number, [number, number]> = {
  22: [23, 4],
  24: [22, 1],
  26: [12, 1],
};

/**
 * Indique si une version de Node.js (ex. "v24.22.1") contient les correctifs
 * de la release sécurité du 21/10/2026 (CVE-2026-111497 et suivantes). Les branches EOL (≤ 21, 23, 25) sont considérées vulnérables.
 */
export function isNodeVersionPatched(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);

  const fixed = PATCHED_VERSIONS[major];
  if (fixed) {
    const [fMinor, fPatch] = fixed;
    return minor > fMinor || (minor === fMinor && patch >= fPatch);
  }
  // Branches futures (> 26) : publiées après le correctif.
  return major > 26;
}

/**
 * Vérifie le runtime au démarrage. En production, un runtime vulnérable
 * arrête le processus (fail closed) ; en dev, simple avertissement.
 */
export function assertPatchedNodeRuntime(service: string): void {
  if (isNodeVersionPatched(process.version)) return;

  const message =
    `[${service}] Node.js ${process.version} est vulnérable à CVE-2026-111497 (Node2Shell, RCE via Brotli) ` +
    "et aux autres CVE de la release sécurité Node.js du 21/10/2026. " +
    "Mettez à jour vers Node.js >= 22.23.4, 24.22.1 ou 26.12.1.";

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_VULNERABLE_NODE !== "1") {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
}

/** Valeur Accept-Encoding sûre : pas de Brotli. */
export const SAFE_ACCEPT_ENCODING = "gzip, deflate";

function hasBrotli(contentEncoding: string | null | undefined): boolean {
  return !!contentEncoding && /(^|,)\s*br\s*(,|$)/i.test(contentEncoding);
}

const SAFE_FETCH_FLAG = Symbol.for("aifriendly.safeFetchInstalled");

/**
 * Enveloppe globalThis.fetch pour :
 *  - forcer `Accept-Encoding: gzip, deflate` si l'appelant ne l'a pas défini,
 *    afin que les serveurs conformes n'envoient jamais de Brotli ;
 *  - rejeter (et annuler) toute réponse annoncée en `Content-Encoding: br`
 *    envoyée malgré tout par un serveur malveillant.
 *
 * Idempotent : sans effet si déjà installé.
 */
export function installBrotliSafeFetch(): void {
  const g = globalThis as typeof globalThis & { [SAFE_FETCH_FLAG]?: boolean };
  if (g[SAFE_FETCH_FLAG] || typeof g.fetch !== "function") return;

  const originalFetch = g.fetch.bind(g);

  const safeFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    if (!headers.has("accept-encoding")) {
      headers.set("accept-encoding", SAFE_ACCEPT_ENCODING);
    }

    const res = await originalFetch(input, { ...init, headers });

    if (hasBrotli(res.headers.get("content-encoding"))) {
      await res.body?.cancel().catch(() => {});
      throw new TypeError(
        "Réponse refusée : Content-Encoding Brotli non autorisé (mitigation CVE-2026-111497)"
      );
    }
    return res;
  };

  g.fetch = Object.assign(safeFetch, originalFetch);
  g[SAFE_FETCH_FLAG] = true;
}

/** Sous-ensemble minimal des objets requête/réponse Express / node:http. */
interface MinimalRequest {
  headers: Record<string, string | string[] | undefined>;
}
interface MinimalResponse {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Middleware (compatible Express) rejetant les corps de requête compressés en
 * Brotli avec un 415, avant qu'un body-parser ne les décompresse.
 */
export function rejectBrotliRequestBody(
  req: MinimalRequest,
  res: MinimalResponse,
  next: () => void
): void {
  const raw = req.headers["content-encoding"];
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  if (hasBrotli(value)) {
    res.status(415).json({ error: "Content-Encoding 'br' non supporté" });
    return;
  }
  next();
}
