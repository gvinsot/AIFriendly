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
 * La connexion elle-même est ouverte via `node:http`/`node:https` avec une
 * fonction `lookup` personnalisée qui revalide CHAQUE adresse résolue au
 * moment précis où le socket est créé : `fetch()` résolvait le nom une
 * seconde fois, indépendamment de la validation (TOCTOU / DNS rebinding —
 * un domaine à TTL 0 pouvait répondre une IP publique à la vérification puis
 * 127.0.0.1 à la connexion).
 *
 * `scanFetch` fait passer en plus la connexion par le proxy SOCKS5 du VPN : les
 * scans de sécurité ne sortent jamais par l'IP du serveur (voir `readScanProxy`).
 *
 * Fichier partagé : utilisé par la webapp, le serveur MCP et le worker
 * (copié dans `lib/` par leurs Dockerfiles). Aucune dépendance externe.
 */

import dns from "node:dns";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net, { isIP } from "node:net";
import { Readable } from "node:stream";
import tls from "node:tls";
import zlib from "node:zlib";

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

// ─── Connexion avec validation DNS au moment du connect ────────────────────
//
// C'est le point de contrôle réel contre le DNS rebinding : la fonction
// `lookup` ci-dessous est celle que le socket appelle pour ouvrir la
// connexion, et elle ne retourne que des adresses publiques validées.

function ssrfLookupError(hostname: string): Error {
  const err = new Error(
    `SSRF : la résolution de "${hostname}" vers une adresse non publique est refusée.`
  ) as Error & { code: string };
  err.code = "ESSRFBLOCKED";
  return err;
}

/**
 * `lookup` de connexion : résout le hostname et refuse la connexion si une
 * des adresses retournées n'est pas publique. Appelée par le socket au moment
 * de l'ouverture de la connexion, donc aucune résolution non validée n'est
 * jamais utilisée pour se connecter.
 */
const validatingLookup = ((
  hostname: string,
  options: { all?: boolean },
  callback: (err: NodeJS.ErrnoException | null, addresses?: unknown, family?: number) => void
) => {
  const finish = (addresses: { address: string; family: number }[]) => {
    for (const a of addresses) {
      if (isBlockedIp(a.address)) return callback(ssrfLookupError(hostname));
    }
    if (options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  };

  const version = isIP(hostname);
  if (version !== 0) {
    if (isBlockedIp(hostname)) return callback(ssrfLookupError(hostname));
    return finish([{ address: hostname, family: version }]);
  }

  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err || !Array.isArray(addresses) || addresses.length === 0) {
      return callback(err ?? new Error(`Échec de la résolution DNS de "${hostname}".`));
    }
    finish(addresses as { address: string; family: number }[]);
  });
}) as NonNullable<http.RequestOptions["lookup"]>;

// ─── Sortie des scans par proxy SOCKS5 ─────────────────────────────────────
//
// Le nom est résolu et validé ICI, puis le proxy reçoit l'adresse IP : il ne
// résout jamais rien lui-même, sinon le DNS rebinding contournerait la
// validation. TLS reste de bout en bout : le proxy ne voit que du chiffré.

const SOCKS_TIMEOUT_MS = 15_000;
const SOCKS_MAX_ADDRESSES = 3;
const SOCKS_REPLY_NOT_ALLOWED = 2;

export type ScanEgressFailure = "not_configured" | "unavailable" | "blocked";

/**
 * Le scan ne peut pas sortir par le VPN, ou le site refuse son IP de sortie.
 * Aucun score ne doit être calculé, et on ne se rabat jamais sur une connexion
 * directe. Le message ne contient jamais les identifiants du proxy.
 */
export class ScanEgressError extends Error {
  readonly reason: ScanEgressFailure;
  constructor(reason: ScanEgressFailure, message: string) {
    super(message);
    this.name = "ScanEgressError";
    this.reason = reason;
  }
}

/**
 * Message affiché quand le site refuse l'IP de sortie du VPN. Le fournisseur VPN
 * répartit les connexions sur plusieurs serveurs (DNS tournant) : selon l'IP de
 * sortie obtenue, un même site peut bloquer un scan et laisser passer le suivant.
 */
export const WAF_BLOCKED_MESSAGE =
  "Le site a refusé l'IP de sortie du VPN (WAF ou anti-bot) : aucun score n'a été calculé. Réessayez plus tard ou autorisez le User-Agent AIFriendly.";

const WAF_BLOCK_RE = /just a moment|attention required|captcha|access denied|request blocked|ddos[- ]protection|ddos-guard|incapsula|sucuri|forbidden/i;

/** La réponse ressemble à un refus de l'IP de sortie du VPN plutôt qu'à la vraie page. */
export function looksBlockedByWaf(status: number, headers: Headers, html: string): boolean {
  if (status !== 403 && status !== 429 && status !== 503) return false;
  return headers.has("cf-mitigated") || WAF_BLOCK_RE.test(html.slice(0, 20_000));
}

/** Le proxy fonctionne, mais la cible n'a pas pu être jointe à cette adresse. */
class SocksTargetError extends Error {}

interface ScanProxy {
  host: string;
  port: number;
  username: string;
  password: string;
}

const SCAN_PROXY_INVALID = "SCAN_PROXY_SECRET est invalide (format attendu : socks5://user:motdepasse@hote:1080).";

/**
 * Lit `SCAN_PROXY_SECRET` (`socks5://user:motdepasse@hote:1080`). Sans proxy, les
 * scans sont refusés, sauf `SCAN_ALLOW_DIRECT=true` prévu pour le développement.
 */
function readScanProxy(): ScanProxy | null {
  const raw = process.env.SCAN_PROXY_SECRET?.trim();
  if (!raw) {
    if (process.env.SCAN_ALLOW_DIRECT === "true") return null;
    throw new ScanEgressError("not_configured", "Scan refusé : aucun proxy VPN n'est configuré (SCAN_PROXY_SECRET).");
  }
  let proxy: ScanProxy;
  try {
    const url = new URL(raw);
    if (url.protocol !== "socks5:" || !url.hostname) throw new Error("protocole");
    proxy = {
      host: unbracketHostname(url.hostname),
      port: Number(url.port) || 1080,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    throw new ScanEgressError("not_configured", SCAN_PROXY_INVALID);
  }
  // RFC 1929 : longueurs codées sur un octet, et un mot de passe vide n'est pas une authentification.
  const userBytes = Buffer.byteLength(proxy.username);
  const passBytes = Buffer.byteLength(proxy.password);
  if (userBytes > 255 || passBytes > 255 || (userBytes > 0 && passBytes === 0)) {
    throw new ScanEgressError("not_configured", SCAN_PROXY_INVALID);
  }
  return proxy;
}

/** Vrai si les scans sortent effectivement par le proxy VPN. */
export function isScanProxied(): boolean {
  return !!process.env.SCAN_PROXY_SECRET?.trim();
}

/** Lit exactement `n` octets ; le surplus reste dans le tampon du socket. */
function readBytes(socket: net.Socket, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("readable", onReadable);
      socket.off("close", onClose);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Connexion SOCKS fermée."));
    };
    const onReadable = () => {
      const chunk = socket.read(n) as Buffer | null;
      if (chunk === null) return;
      cleanup();
      if (chunk.length < n) reject(new Error("Réponse SOCKS tronquée."));
      else resolve(chunk);
    };
    socket.on("readable", onReadable);
    socket.once("close", onClose);
    onReadable();
  });
}

async function socksAuthenticate(socket: net.Socket, proxy: ScanProxy): Promise<void> {
  const method = proxy.username ? 2 : 0;
  socket.write(Buffer.from([5, 1, method]));
  const greeting = await readBytes(socket, 2);
  if (greeting[0] !== 5 || greeting[1] !== method) {
    throw new ScanEgressError("unavailable", "Proxy VPN : méthode d'authentification refusée.");
  }
  if (!proxy.username) return;
  const user = Buffer.from(proxy.username);
  const pass = Buffer.from(proxy.password);
  socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
  const reply = await readBytes(socket, 2);
  if (reply[1] !== 0) throw new ScanEgressError("unavailable", "Proxy VPN : identifiants refusés.");
}

async function socksConnect(socket: net.Socket, ip: string, family: number, port: number): Promise<void> {
  const address =
    family === 6
      ? Buffer.from(expandIPv6(ip)!.flatMap((word) => [word >> 8, word & 0xff]))
      : Buffer.from(ip.split(".").map(Number));
  socket.write(
    Buffer.concat([Buffer.from([5, 1, 0, family === 6 ? 4 : 1]), address, Buffer.from([port >> 8, port & 0xff])])
  );
  const head = await readBytes(socket, 4);
  if (head[0] !== 5) throw new ScanEgressError("unavailable", "Proxy VPN : réponse invalide.");
  if (head[1] === SOCKS_REPLY_NOT_ALLOWED) {
    throw new ScanEgressError("unavailable", "Proxy VPN : connexion interdite par le serveur.");
  }
  if (head[1] !== 0) throw new SocksTargetError(`Cible injoignable via le proxy (code SOCKS ${head[1]}).`);
  const addressLength = head[3] === 1 ? 4 : head[3] === 4 ? 16 : (await readBytes(socket, 1))[0];
  await readBytes(socket, addressLength + 2);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("This operation was aborted", "AbortError");
}

/**
 * Ouvre un tunnel vers `ip:port`. Une panne avant l'authentification incrimine
 * le proxy (scan refusé) ; une panne après incrimine la cible, ce qui est un
 * résultat normal, par exemple un port 80 fermé.
 */
function openSocksTunnel(
  proxy: ScanProxy,
  ip: string,
  family: number,
  port: number,
  signal?: AbortSignal | null
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    let authenticated = false;
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.off("error", onError);
    };
    const fail = (err: unknown) => {
      cleanup();
      socket.on("error", () => {}); // erreur tardive pendant destroy()
      socket.destroy();
      // L'abandon vient de l'appelant (y compris AbortSignal.timeout) : ni le proxy ni la cible ne sont en cause.
      if (signal?.aborted) {
        reject(abortReason(signal));
      } else if (err instanceof ScanEgressError || err instanceof SocksTargetError) {
        reject(err);
      } else if (authenticated) {
        reject(new SocksTargetError("Cible injoignable via le proxy."));
      } else {
        reject(new ScanEgressError("unavailable", "Proxy VPN injoignable."));
      }
    };
    const onError = (err: Error) => fail(err);
    const onAbort = () => fail(abortReason(signal!));
    const timer = setTimeout(() => fail(new Error("Délai SOCKS dépassé.")), SOCKS_TIMEOUT_MS);
    socket.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("connect", () => {
      socksAuthenticate(socket, proxy)
        .then(() => {
          authenticated = true;
          return socksConnect(socket, ip, family, port);
        })
        .then(() => {
          cleanup();
          resolve(socket);
        })
        .catch(fail);
    });
  });
}

/** Chiffre le tunnel de bout en bout en vérifiant le certificat de la cible. */
function upgradeToTls(socket: net.Socket, host: string, signal?: AbortSignal | null): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({
      socket,
      host, // nom utilisé pour vérifier le certificat
      servername: isIP(host) ? undefined : host,
      ALPNProtocols: ["http/1.1"],
    });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      secure.off("error", fail);
    };
    const fail = (err: Error) => {
      cleanup();
      secure.on("error", () => {});
      secure.destroy();
      reject(err);
    };
    const onAbort = () => fail(abortReason(signal!));
    const timer = setTimeout(() => fail(new Error("Délai de négociation TLS dépassé.")), SOCKS_TIMEOUT_MS);
    secure.once("error", fail);
    signal?.addEventListener("abort", onAbort, { once: true });
    secure.once("secureConnect", () => {
      cleanup();
      resolve(secure);
    });
  });
}

/** Résout le nom et ne retourne que des adresses publiques (même contrôle qu'en direct). */
function resolveValidated(hostname: string): Promise<{ address: string; family: number }[]> {
  return new Promise((resolve, reject) => {
    (validatingLookup as unknown as (
      host: string,
      options: { all: boolean },
      callback: (err: Error | null, addresses?: { address: string; family: number }[]) => void
    ) => void)(hostname, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses ?? [])));
  });
}

async function openProxiedSocket(proxy: ScanProxy, target: URL, signal?: AbortSignal | null): Promise<net.Socket> {
  const host = unbracketHostname(target.hostname);
  const isHttps = target.protocol === "https:";
  const port = Number(target.port) || (isHttps ? 443 : 80);
  const addresses = (await resolveValidated(host))
    .sort((a, b) => a.family - b.family) // IPv4 d'abord : prise en charge plus large côté proxy
    .slice(0, SOCKS_MAX_ADDRESSES);

  let lastError: unknown = new SocksTargetError("Aucune adresse à contacter.");
  for (const { address, family } of addresses) {
    try {
      const tunnel = await openSocksTunnel(proxy, address, family, port, signal);
      return isHttps ? await upgradeToTls(tunnel, host, signal) : tunnel;
    } catch (err) {
      if (!(err instanceof SocksTargetError)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/** En-têtes à ne jamais propager vers une autre origine (redirect cross-origin). */
const CROSS_ORIGIN_STRIPPED_HEADERS = ["authorization", "cookie", "proxy-authorization"];

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of headers.entries()) record[key] = value;
  return record;
}

/**
 * Requête HTTP(S) de bas niveau dont la résolution DNS est validée au moment
 * de la connexion (voir `validatingLookup`). Remplace `fetch()` ici car fetch
 * re-résout le hostname indépendamment de toute validation préalable.
 *
 * Compatibilité avec le fetch d'avant : `Accept-Encoding` sans Brotli
 * (mitigation CVE-2026-111497), décompression gzip/deflate, rejet des autres
 * encodages (dont `br`), `Response.url` renseignée.
 */
function rawRequest(
  target: URL,
  init: { method: string; headers: Headers; body?: unknown; signal?: AbortSignal | null; egress?: "scan" }
): Promise<Response> {
  const lib = target.protocol === "https:" ? https : http;
  const proxy = init.egress === "scan" ? readScanProxy() : null;
  // Avec `createConnection` et sans `agent`, Node utilise exactement ce socket.
  const connection: http.RequestOptions = proxy
    ? {
        // Sans agent, Node ignore le port par défaut et écrirait `Host: site:80`.
        defaultPort: target.protocol === "https:" ? 443 : 80,
        createConnection: ((_options: unknown, callback: (err: Error | null, socket?: net.Socket) => void) => {
          openProxiedSocket(proxy, target, init.signal).then(
            (socket) => callback(null, socket),
            (err) => callback(err)
          );
          return undefined;
        }) as unknown as http.RequestOptions["createConnection"],
      }
    : {
        agent: false, // connexion dédiée : le lookup est revalidé à chaque requête
        lookup: validatingLookup,
      };
  const headers = new Headers(init.headers);
  if (!headers.has("accept-encoding")) headers.set("accept-encoding", "gzip, deflate");
  if (!headers.has("user-agent")) headers.set("user-agent", "AIFriendly/1.0 (ssrf-guard)");

  const body = init.body;
  if (body != null && !headers.has("content-length") && !headers.has("transfer-encoding")) {
    const len =
      typeof body === "string"
        ? Buffer.byteLength(body)
        : (body as Uint8Array).byteLength;
    if (Number.isFinite(len)) headers.set("content-length", String(len));
  }

  return new Promise<Response>((resolve, reject) => {
    const req = lib.request(
      target,
      {
        method: init.method,
        headers: headersToRecord(headers),
        ...connection,
        signal: init.signal ?? undefined,
      },
      (res) => {
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
        // Mitigation CVE-2026-111497 (Node2Shell) : jamais de Brotli en réponse
        if (/(^|,)\s*br\s*(,|$)/.test(encoding)) {
          res.resume();
          reject(
            new TypeError(
              "Réponse refusée : Content-Encoding Brotli non autorisé (mitigation CVE-2026-111497)."
            )
          );
          return;
        }

        // HEAD / 204 / 304 : pas de corps, ne jamais décompresser
        const noBody =
          init.method === "HEAD" || res.statusCode === 204 || res.statusCode === 304;
        let stream: Readable = res;
        let decompressed = false;
        if (!noBody && (encoding === "gzip" || encoding === "x-gzip")) {
          stream = res.pipe(zlib.createGunzip());
          decompressed = true;
        } else if (!noBody && encoding === "deflate") {
          stream = res.pipe(zlib.createInflate());
          decompressed = true;
        } else if (!noBody && encoding && encoding !== "identity") {
          res.resume();
          reject(new TypeError(`Content-Encoding non supporté : ${encoding}.`));
          return;
        }

        const outHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          if (decompressed && (key === "content-encoding" || key === "content-length")) continue;
          if (Array.isArray(value)) {
            for (const v of value) outHeaders.append(key, v);
          } else {
            outHeaders.set(key, value);
          }
        }

        const status = res.statusCode ?? 502;
        const response = new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
          status: status >= 200 && status <= 599 ? status : 502,
          statusText: res.statusMessage ?? "",
          headers: outHeaders,
        });
        Object.defineProperty(response, "url", { value: target.href });
        Object.defineProperty(response, "redirected", { value: false });
        resolve(response);
      }
    );
    req.on("error", reject);
    if (body != null) req.write(body as string | Uint8Array);
    req.end();
  });
}

// ─── fetch protégé ─────────────────────────────────────────────────────────

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type SafeFetchOptions = RequestInit & {
  maxBodyBytes?: number;
  /** "scan" : sortie obligatoire par le proxy VPN. Préférer `scanFetch`. */
  egress?: "scan";
  /** Refuse de suivre une redirection vers une URL hors de ce périmètre. */
  allowRedirect?: (url: URL) => boolean;
};

/**
 * `fetch` sécurisé pour les URL non fiables :
 *  - valide l'URL et la résolution DNS avant chaque requête ;
 *  - ouvre la connexion via `rawRequest`, qui revalide la résolution DNS au
 *    moment du connect (anti DNS rebinding) ;
 *  - suit les redirections manuellement (max 5) en revalidant chaque saut,
 *    sans jamais contacter une cible interne, et sans propager les
 *    identifiants vers une autre origine ;
 *  - `redirect: "manual"` et `"error"` restent respectés ;
 *  - le corps de la réponse est tronqué à `maxBodyBytes` (10 Mo par défaut).
 *
 * La `Response` retournée a pour `url` la dernière URL réellement contactée.
 */
export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<Response> {
  const { maxBodyBytes = DEFAULT_MAX_BODY_BYTES, egress, allowRedirect, ...init } = options;
  const mode = init.redirect ?? "follow";
  let current = await assertPublicUrl(input);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  let headers = new Headers(init.headers);

  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await rawRequest(current, { method, headers, body, signal: init.signal, egress });
    } catch (err) {
      // Refus par le lookup de connexion (DNS rebinding, IP privée...) :
      // même erreur publique que la validation préalable.
      if ((err as { code?: string }).code === "ESSRFBLOCKED") throw new SsrfBlockedError();
      throw err;
    }

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

    const next = await assertPublicUrl(new URL(location, current));
    if (allowRedirect && !allowRedirect(next)) {
      throw new SsrfBlockedError("Redirection hors du périmètre autorisé.");
    }
    // Ne pas propager d'identifiants vers une autre origine
    if (next.origin !== current.origin) {
      headers = new Headers(headers);
      for (const h of CROSS_ORIGIN_STRIPPED_HEADERS) headers.delete(h);
    }
    current = next;
    // Sémantique fetch : 303 (ou 301/302 sur POST) → GET sans corps
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      if (method !== "HEAD") method = "GET";
      body = undefined;
    }
  }
}

/** `safeFetch` pour les scans de sécurité : sort uniquement par le proxy VPN. */
export function scanFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<Response> {
  return safeFetch(input, { ...options, egress: "scan" });
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
