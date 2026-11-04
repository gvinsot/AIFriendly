/**
 * Protection SSRF pour toutes les requêtes sortantes vers des URL fournies par
 * les utilisateurs (analyse IA, disponibilité, scan de sécurité).
 *
 * Problèmes corrigés par rapport à une simple vérification textuelle du
 * hostname :
 *  - un nom DNS public peut résoudre vers une IP interne
 *    (ex. 127.0.0.1.nip.io, enregistrement A pointant vers 10.0.0.5) ;
 *  - `fetch(..., { redirect: "follow" })` suit les redirections AVANT que
 *    l'appelant ne puisse vérifier la destination finale : la requête vers la
 *    cible interne a déjà eu lieu ;
 *  - formes IPv6 normalisées par WHATWG URL (`[::ffff:127.0.0.1]` devient
 *    `[::ffff:7f00:1]`), NAT64, 6to4, plages CGNAT / réservées oubliées.
 *
 * `safeFetch` résout le hostname, refuse toute adresse non publique, puis
 * suit les redirections manuellement en revalidant chaque saut.
 *
 * Fichier partagé : utilisé par la webapp, le serveur MCP et le worker
 * (copié dans `lib/` par leurs Dockerfiles). Aucune dépendance externe.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_REDIRECTS = 5;
/** Taille maximale par défaut d'un corps de réponse lu via `safeFetch`. */
export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Erreur levée lorsqu'une URL cible est refusée par la protection SSRF. */
export class SsrfBlockedError extends Error {
  constructor(message = "URL cible non autorisée.") {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

// ─── Plages d'adresses ─────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/** [réseau, longueur de préfixe] des plages IPv4 non routables publiquement. */
const BLOCKED_IPV4_CIDRS: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // CGNAT (RFC 6598)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (métadonnées cloud 169.254.169.254)
  ["172.16.0.0", 12], // RFC 1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // réservé + broadcast
];

const BLOCKED_IPV4_RANGES = BLOCKED_IPV4_CIDRS.map(([net, prefix]) => {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (ipv4ToInt(net)! & mask) >>> 0, mask };
});

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // forme inattendue : refuser par prudence
  return BLOCKED_IPV4_RANGES.some(({ base, mask }) => ((n & mask) >>> 0) === base);
}

/** Développe une IPv6 (éventuellement avec suffixe IPv4) en 8 mots de 16 bits. */
function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);

  // Suffixe IPv4 (ex. ::ffff:127.0.0.1)
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    addr =
      addr.slice(0, lastColon + 1) +
      ((v4 >>> 16) & 0xffff).toString(16) +
      ":" +
      (v4 & 0xffff).toString(16);
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;

  const words = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (words.length !== 8) return null;
  const out: number[] = [];
  for (const w of words) {
    if (!/^[0-9a-f]{1,4}$/.test(w)) return null;
    out.push(parseInt(w, 16));
  }
  return out;
}

function wordsToIPv4(hi: number, lo: number): string {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
}

function isBlockedIPv6(ip: string): boolean {
  const w = expandIPv6(ip);
  if (!w) return true;

  const allZeroPrefix = (n: number) => w.slice(0, n).every((x) => x === 0);

  // :: (non spécifiée) et ::1 (loopback)
  if (allZeroPrefix(7) && (w[7] === 0 || w[7] === 1)) return true;
  // ::ffff:a.b.c.d (IPv4 mappée) et ::a.b.c.d (IPv4 compatible, obsolète)
  if (allZeroPrefix(5) && (w[5] === 0xffff || w[5] === 0)) {
    return isBlockedIPv4(wordsToIPv4(w[6], w[7]));
  }
  // ::ffff:0:a.b.c.d (IPv4 translated, RFC 2765)
  if (allZeroPrefix(4) && w[4] === 0xffff && w[5] === 0) {
    return isBlockedIPv4(wordsToIPv4(w[6], w[7]));
  }
  // 64:ff9b::/96 et 64:ff9b:1::/48 (NAT64) : vérifier l'IPv4 embarquée
  if (w[0] === 0x64 && w[1] === 0xff9b) {
    return isBlockedIPv4(wordsToIPv4(w[6], w[7]));
  }
  // 2002::/16 (6to4) : IPv4 embarquée dans les mots 1-2
  if (w[0] === 0x2002) return isBlockedIPv4(wordsToIPv4(w[1], w[2]));
  // 2001:db8::/32 (documentation)
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true;
  // fc00::/7 (ULA)
  if ((w[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 (link-local) et fec0::/10 (site-local, obsolète)
  if ((w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0) return true;
  // ff00::/8 (multicast)
  if ((w[0] & 0xff00) === 0xff00) return true;
  return false;
}

/** Indique si une adresse IP littérale (v4 ou v6) n'est pas publique. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);
  return true;
}

// ─── Validation des hostnames / URL ────────────────────────────────────────

const INTERNAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".localdomain",
];

/** Retire les crochets d'une IPv6 littérale (`[::1]` → `::1`). */
export function unbracketHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Vérification synchrone (sans DNS) d'un hostname : IP littérale non
 * publique, `localhost`, suffixes internes, ou nom sans point (résolu via le
 * DNS interne Docker/Swarm, ex. `postgres`, `webapp`).
 */
export function isHostnameBlocked(rawHostname: string): boolean {
  const host = unbracketHostname(rawHostname.trim().toLowerCase()).replace(/\.$/, "");
  if (!host) return true;
  if (isIP(host)) return isBlockedIp(host);
  if (host === "localhost") return true;
  if (INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) return true;
  // Nom à un seul label (ex. "postgres", "mcp-server") : nom de service interne
  if (!host.includes(".")) return true;
  return false;
}

/**
 * Valide une URL cible (protocole, identifiants, hostname) puis résout son
 * hostname : toutes les adresses retournées doivent être publiques.
 * @throws SsrfBlockedError
 */
export async function assertPublicUrl(input: string | URL): Promise<URL> {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : new URL(input.href);
  } catch {
    throw new SsrfBlockedError("URL invalide.");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError("Seules les URL http et https sont acceptées.");
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError("Les identifiants dans l'URL ne sont pas autorisés.");
  }

  const host = unbracketHostname(url.hostname);
  if (isHostnameBlocked(host)) throw new SsrfBlockedError();

  if (!isIP(host)) {
    let addresses: { address: string }[];
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new SsrfBlockedError("Nom de domaine introuvable.");
    }
    if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
      throw new SsrfBlockedError();
    }
  }
  return url;
}

// ─── fetch protégé ─────────────────────────────────────────────────────────

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * `fetch` sécurisé pour les URL non fiables :
 *  - valide l'URL et la résolution DNS avant chaque requête ;
 *  - suit les redirections manuellement (max 5) en revalidant chaque saut,
 *    sans jamais contacter une cible interne ;
 *  - `redirect: "manual"` et `"error"` restent respectés ;
 *  - le corps de la réponse est tronqué à `maxBodyBytes` (10 Mo par défaut).
 *
 * La `Response` retournée a pour `url` la dernière URL réellement contactée.
 */
export async function safeFetch(
  input: string | URL,
  options: RequestInit & { maxBodyBytes?: number } = {}
): Promise<Response> {
  const { maxBodyBytes = DEFAULT_MAX_BODY_BYTES, ...init } = options;
  const mode = init.redirect ?? "follow";
  let current = await assertPublicUrl(input);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;

  for (let hop = 0; ; hop++) {
    const res = await fetch(current.href, { ...init, method, body, redirect: "manual" });

    if (!REDIRECT_STATUSES.has(res.status) || mode === "manual") {
      return limitResponseBody(res, maxBodyBytes);
    }
    const location = res.headers.get("location");
    if (mode === "error") {
      await res.body?.cancel().catch(() => {});
      throw new TypeError("Redirection refusée (redirect: \"error\").");
    }
    if (!location) return limitResponseBody(res, maxBodyBytes);

    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new TypeError("Trop de redirections.");

    current = await assertPublicUrl(new URL(location, current));
    // Sémantique fetch : 303 (ou 301/302 sur POST) → GET sans corps
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      if (method !== "HEAD") method = "GET";
      body = undefined;
    }
  }
}

/**
 * Retourne une `Response` équivalente dont le flux est coupé après `maxBytes`
 * (le reste du corps n'est jamais téléchargé). `url`/`redirected` conservés.
 */
export function limitResponseBody(res: Response, maxBytes: number): Response {
  if (!res.body) return res;
  let seen = 0;
  const limited = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const remaining = maxBytes - seen;
        if (remaining <= 0) {
          controller.terminate();
          return;
        }
        const part = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
        seen += part.byteLength;
        controller.enqueue(part);
        if (seen >= maxBytes) controller.terminate();
      },
    })
  );
  const out = new Response(limited, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
  Object.defineProperty(out, "url", { value: res.url });
  Object.defineProperty(out, "redirected", { value: res.redirected });
  return out;
}

/**
 * Lit le corps d'une réponse en s'arrêtant à `maxBytes` (évite qu'un site
 * malveillant n'épuise la mémoire avec une réponse gigantesque).
 */
export async function readBodyLimited(
  res: Response,
  maxBytes: number
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!res.body) return { text: "", bytes: 0, truncated: false };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - bytes));
        bytes = maxBytes;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const buf = new Uint8Array(bytes);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder().decode(buf), bytes, truncated };
}
