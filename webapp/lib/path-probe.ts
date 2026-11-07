/**
 * Sondage de chemins (fichiers sensibles, sauvegardes, docs API, pages serveur…)
 * sans faux positifs « soft 404 ».
 *
 * Beaucoup de sites renvoient HTTP 200 pour des chemins inexistants :
 *  - SPA (Lovable, Vercel, Netlify…) qui servent index.html partout ;
 *  - CMS / frameworks dont la page 404 est servie en 200 ;
 *  - API qui répondent `{"error":"Not found"}` en 200, ou en text/plain.
 *
 * Un chemin n'est donc signalé que si :
 *  1. il répond 200 ;
 *  2. la réponse n'est pas une page « introuvable » (marqueurs 404) ;
 *  3. elle diffère de la réponse à un chemin aléatoire de même extension ;
 *  4. son contenu ressemble réellement au fichier attendu (validateur).
 *
 * Module sans dépendance (fetch injecté), partagé par la webapp, le worker et
 * le serveur MCP (copié dans lib/ par leurs Dockerfiles).
 */

export type ProbeFetcher = (
  url: string,
  init: RequestInit,
  timeoutMs: number
) => Promise<Response | null>;

export interface ProbeResponse {
  status: number;
  headers: Headers;
  contentType: string;
  body: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const PROBE_UA = "AIFriendly/1.0 (SecurityScan)";

/** Lit au plus `maxBytes` du corps (les signatures sont toujours en début de fichier). */
async function readHead(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, maxBytes - bytes);
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
    await reader.cancel().catch(() => {});
  } catch {
    // Corps illisible : on garde ce qui a été lu.
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}

export async function probePath(
  fetcher: ProbeFetcher,
  url: string,
  init: RequestInit = {}
): Promise<ProbeResponse | null> {
  const res = await fetcher(url, { redirect: "manual", ...init, headers: { "User-Agent": PROBE_UA, ...(init.headers || {}) } }, 5000);
  if (!res) return null;
  return {
    status: res.status,
    headers: res.headers,
    contentType: (res.headers.get("content-type") || "").toLowerCase(),
    body: await readHead(res, MAX_BODY_BYTES),
  };
}

// ─── Heuristiques ────────────────────────────────────────────────────────────

/** Le corps est un document HTML (quel que soit le Content-Type annoncé). */
export function isHtmlDocument(body: string): boolean {
  return /^\s*(<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>])|<html[\s>][\s\S]*<\/(head|body)>/i.test(body.slice(0, 4096));
}

const NOT_FOUND_RE =
  /\b404\b|not\s+found|page\s+(introuvable|non\s+trouv[ée]e)|introuvable|n['’]existe\s+pas|cannot\s+be\s+found|could\s+not\s+be\s+found|does\s+not\s+exist|doesn['’]t\s+exist|no\s+encontrad[ao]|nicht\s+gefunden|non\s+trovat[ao]|no\s+such\s+file|file\s+not\s+found|resource\s+not\s+found|page\s+not\s+found|nothing\s+(here|found)/i;

function textContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** La réponse est une page/erreur « introuvable » servie en 200 (soft 404). */
export function looksLikeNotFound(body: string): boolean {
  const head = body.slice(0, 16 * 1024);
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const h1 = head.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
  if (NOT_FOUND_RE.test(title) || NOT_FOUND_RE.test(textContent(h1))) return true;

  // Erreur JSON : {"status":404}, {"error":"Not Found"}, {"message":"…not found"}
  const trimmed = head.trim();
  if (/^[{[]/.test(trimmed)) {
    if (/"(status|statusCode|code)"\s*:\s*"?404\b/i.test(trimmed)) return true;
    if (/"(error|message|detail|title)"\s*:\s*"[^"]*(not\s*found|introuvable|does\s+not\s+exist)/i.test(trimmed)) return true;
    return false;
  }

  // Petite page HTML dont le contenu dit « introuvable ».
  if (isHtmlDocument(head)) {
    const text = textContent(head);
    return text.length < 3000 && NOT_FOUND_RE.test(text);
  }
  // Texte brut très court (« 404 page not found ») — seuil bas pour ne pas
  // écarter un vrai fichier de log qui mentionnerait une erreur 404.
  return trimmed.length < 300 && NOT_FOUND_RE.test(trimmed);
}

/** Corps normalisé : retire ce qui change d'une requête à l'autre (nonces, tokens, chemin demandé…). */
function normalizeBody(body: string, path?: string): string {
  let b = body;
  if (path) b = b.split(path).join("");
  return b
    .replace(/\b(nonce|csrf[-_]?token|_token|request[-_]?id|ray[-_]?id|trace[-_]?id)\s*[=:]\s*["']?[\w+/=-]+["']?/gi, "")
    .replace(/aifriendly-probe-[a-z0-9]+(\.[\w.]+)?/gi, "")
    .replace(/[0-9a-f]{16,}/gi, "")
    .replace(/\d{1,4}[-/:.]\d{1,2}[-/:.]\d{1,4}([ T]\d{1,2}:\d{2}(:\d{2})?)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(body: string): string {
  return (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim().toLowerCase();
}

/** Deux corps sont (quasi) identiques — même page servie pour deux URL différentes. */
export function isSimilarBody(a: string, b: string, pathA?: string, pathB?: string): boolean {
  const na = normalizeBody(a, pathA);
  const nb = normalizeBody(b, pathB);
  if (na === nb) return true;
  const maxLen = Math.max(na.length, nb.length, 1);
  return extractTitle(a) === extractTitle(b) && Math.abs(na.length - nb.length) / maxLen < 0.05;
}

// ─── Référence « chemin inexistant » ─────────────────────────────────────────

function randomToken(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** Construit un chemin inexistant ayant la même « forme » que `path` (extension, dossier, fichier caché). */
function randomSiblingPath(path: string): { key: string; path: string } {
  const token = `aifriendly-probe-${randomToken()}`;
  if (path.endsWith("/")) return { key: "dir", path: `/${token}/` };
  const last = path.split("/").pop() || "";
  const hidden = last.startsWith(".");
  const dot = last.lastIndexOf(".");
  const ext = dot > 0 ? last.slice(dot) : "";
  const key = `${hidden ? "hidden" : "plain"}${ext}`;
  return { key, path: `/${hidden ? "." : ""}${token}${ext}` };
}

/**
 * Mémorise, par forme de chemin, la réponse du site à un chemin inexistant.
 * Une réponse identique à cette référence est une page catch-all, pas un fichier.
 */
export class NotFoundBaseline {
  private cache = new Map<string, Promise<{ res: ProbeResponse | null; path: string }>>();
  private baseUrl: string;
  private fetcher: ProbeFetcher;

  constructor(baseUrl: string, fetcher: ProbeFetcher) {
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  private baselineFor(path: string) {
    const sibling = randomSiblingPath(path);
    let entry = this.cache.get(sibling.key);
    if (!entry) {
      entry = probePath(this.fetcher, new URL(sibling.path, this.baseUrl).href).then((res) => ({ res, path: sibling.path }));
      this.cache.set(sibling.key, entry);
    }
    return entry;
  }

  /** Vrai si `res` (réponse à `path`) est la page servie pour n'importe quel chemin inexistant. */
  async matches(path: string, res: ProbeResponse): Promise<boolean> {
    const { res: base, path: basePath } = await this.baselineFor(path);
    if (!base || base.status !== res.status) return false;
    return isSimilarBody(res.body, base.body, path, basePath);
  }
}

// ─── Détection générique ─────────────────────────────────────────────────────

export interface PathSpec {
  path: string;
  /** Le contenu correspond-il réellement à la ressource attendue ? */
  validate: (res: ProbeResponse) => boolean;
}

/**
 * Renvoie les chemins réellement exposés : 200, pas une page 404, différent de
 * la page catch-all et dont le contenu passe le validateur.
 */
export async function detectExposedPaths<T extends PathSpec>(
  baseUrl: string,
  fetcher: ProbeFetcher,
  specs: T[],
  baseline: NotFoundBaseline = new NotFoundBaseline(baseUrl, fetcher)
): Promise<{ spec: T; res: ProbeResponse }[]> {
  const found: { spec: T; res: ProbeResponse }[] = [];
  await Promise.allSettled(
    specs.map(async (spec) => {
      const res = await probePath(fetcher, new URL(spec.path, baseUrl).href);
      if (!res || res.status !== 200 || !res.body.trim()) return;
      if (!spec.validate(res)) return;
      if (looksLikeNotFound(res.body)) return;
      if (await baseline.matches(spec.path, res)) return;
      found.push({ spec, res });
    })
  );
  found.sort((a, b) => specs.indexOf(a.spec) - specs.indexOf(b.spec));
  return found;
}

// ─── Validateurs de contenu ──────────────────────────────────────────────────

/** Fichier texte non HTML dont le contenu correspond à `re`. */
const textFile = (re: RegExp) => (r: ProbeResponse) => !isHtmlDocument(r.body) && re.test(r.body);
/** Objet JSON (même tronqué) contenant une des clés attendues. */
const jsonFile = (re: RegExp) => (r: ProbeResponse) => /^\s*\{/.test(r.body) && re.test(r.body);

const ENV_RE = /^\s*(export\s+)?[A-Z][A-Z0-9_]*\s*=/m;
const SQL_RE = /\b(CREATE\s+TABLE|INSERT\s+INTO|DROP\s+TABLE|CREATE\s+DATABASE|ALTER\s+TABLE)\b|--\s*(MySQL|MariaDB)\s+dump|PostgreSQL database dump/i;
const LOG_RE = /PHP\s+(Warning|Notice|Fatal error|Parse error|Deprecated)|\[(error|warn|warning|notice|crit|alert|emerg|debug|info)\]|\b(ERROR|WARN|WARNING|DEBUG|INFO)\b[\s\S]{0,80}\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}|stack\s*trace/i;
const DIR_LISTING_RE = /<title>\s*Index of \/|<h1>\s*Index of \/|Directory listing for \/|\[To Parent Directory\]/i;

export interface SensitiveFileSpec extends PathSpec {
  name: string;
  severity: "critical" | "warning";
}

export const SENSITIVE_FILES: SensitiveFileSpec[] = [
  { path: "/.env", name: ".env", severity: "critical", validate: textFile(ENV_RE) },
  { path: "/.env.local", name: ".env.local", severity: "critical", validate: textFile(ENV_RE) },
  { path: "/.env.production", name: ".env.production", severity: "critical", validate: textFile(ENV_RE) },
  { path: "/.git/HEAD", name: ".git/", severity: "critical", validate: textFile(/^\s*(ref:\s*refs\/|[0-9a-f]{40}\s*$)/m) },
  { path: "/.git/config", name: ".git/config", severity: "critical", validate: textFile(/^\s*\[(core|remote|branch)/m) },
  { path: "/.svn/entries", name: ".svn/", severity: "critical", validate: textFile(/^\s*\d+\s*$|<wc-entries|svn:/m) },
  { path: "/wp-config.php", name: "wp-config.php", severity: "critical", validate: textFile(/DB_(NAME|USER|PASSWORD|HOST)|<\?php/) },
  { path: "/wp-config.php.bak", name: "wp-config.php.bak", severity: "critical", validate: textFile(/DB_(NAME|USER|PASSWORD|HOST)|<\?php/) },
  { path: "/.htaccess", name: ".htaccess", severity: "warning", validate: textFile(/^\s*(RewriteEngine|RewriteRule|RewriteCond|Options|Deny\s+from|Allow\s+from|Order\s|Require\s|AuthType|AuthUserFile|Header\s|<IfModule|<Files|ErrorDocument|Redirect|SetEnv|php_value|DirectoryIndex)/im) },
  { path: "/.htpasswd", name: ".htpasswd", severity: "critical", validate: textFile(/^[^:\s<>]+:(\$apr1\$|\$2[aby]\$|\{SHA\}|[./0-9A-Za-z]{13}\s*$)/m) },
  { path: "/phpinfo.php", name: "phpinfo.php", severity: "critical", validate: (r) => /phpinfo\(\)|PHP Version\s*[\d.]+|PHP Version <\/td>/i.test(r.body) && /php\.ini|Zend Engine|PHP License/i.test(r.body) },
  { path: "/.DS_Store", name: ".DS_Store", severity: "warning", validate: (r) => r.body.includes("Bud1") },
  { path: "/web.config", name: "web.config", severity: "warning", validate: textFile(/<configuration[\s>]/i) },
  { path: "/composer.json", name: "composer.json", severity: "warning", validate: jsonFile(/"(require|require-dev|autoload|minimum-stability)"\s*:/) },
  { path: "/package.json", name: "package.json", severity: "warning", validate: jsonFile(/"(dependencies|devDependencies|scripts|peerDependencies)"\s*:/) },
  { path: "/Gemfile", name: "Gemfile", severity: "warning", validate: textFile(/^\s*(source|gem|ruby)\s+['"]/m) },
  { path: "/.npmrc", name: ".npmrc", severity: "critical", validate: textFile(/^\s*(registry|@[\w-]+:registry|\/\/[^\s=]+:_authToken|_auth|_authToken|always-auth|email|save-exact|engine-strict|legacy-peer-deps)\s*=/m) },
  { path: "/backup.sql", name: "backup.sql", severity: "critical", validate: textFile(SQL_RE) },
  { path: "/dump.sql", name: "dump.sql", severity: "critical", validate: textFile(SQL_RE) },
  { path: "/database.sql", name: "database.sql", severity: "critical", validate: textFile(SQL_RE) },
  { path: "/error_log", name: "error_log", severity: "warning", validate: textFile(LOG_RE) },
  { path: "/debug.log", name: "debug.log", severity: "warning", validate: textFile(LOG_RE) },
  { path: "/docker-compose.yml", name: "docker-compose.yml", severity: "warning", validate: textFile(/^\s*(services|version)\s*:/m) },
  { path: "/Dockerfile", name: "Dockerfile", severity: "warning", validate: textFile(/^\s*FROM\s+[\w./:@-]+/im) },
  { path: "/config.yml", name: "config.yml", severity: "warning", validate: (r) => textFile(/^[\w.-]+\s*:/m)(r) && !/^\s*[{[]/.test(r.body) },
  { path: "/credentials.json", name: "credentials.json", severity: "critical", validate: jsonFile(/"[\w-]*(key|secret|token|password|credential|client_id|client_email|type)[\w-]*"\s*:/i) },
];

export const BACKUP_FILES: PathSpec[] = [
  { path: "/index.php.bak", validate: textFile(/<\?php/) },
  { path: "/index.php.old", validate: textFile(/<\?php/) },
  { path: "/index.php~", validate: textFile(/<\?php/) },
  // Copie HTML : servie en HTML par le serveur = page normale, pas un fichier de sauvegarde téléchargeable.
  { path: "/index.html.bak", validate: (r) => !r.contentType.includes("text/html") && /<html|<!doctype/i.test(r.body) },
  { path: "/index.html.old", validate: (r) => !r.contentType.includes("text/html") && /<html|<!doctype/i.test(r.body) },
  { path: "/.backup", validate: (r) => !isHtmlDocument(r.body) },
  { path: "/backup/", validate: (r) => DIR_LISTING_RE.test(r.body) },
  { path: "/backups/", validate: (r) => DIR_LISTING_RE.test(r.body) },
];

const SWAGGER_RE = /swagger-ui|swagger|"openapi"\s*:|"swagger"\s*:|redoc/i;
const GRAPHQL_RE = /graphiql|graphql-playground|graphql|apollo|"errors"\s*:\s*\[/i;

export const API_DOC_PATHS: PathSpec[] = [
  { path: "/swagger", validate: (r) => SWAGGER_RE.test(r.body) },
  { path: "/swagger-ui", validate: (r) => SWAGGER_RE.test(r.body) },
  { path: "/swagger-ui.html", validate: (r) => SWAGGER_RE.test(r.body) },
  { path: "/api-docs", validate: (r) => SWAGGER_RE.test(r.body) },
  { path: "/graphql", validate: (r) => GRAPHQL_RE.test(r.body) },
  { path: "/graphiql", validate: (r) => GRAPHQL_RE.test(r.body) },
  { path: "/__graphql", validate: (r) => GRAPHQL_RE.test(r.body) },
  { path: "/api/explorer", validate: (r) => SWAGGER_RE.test(r.body) || /api explorer|loopback/i.test(r.body) },
];

export const SERVER_STATUS_PAGES: PathSpec[] = [
  { path: "/server-status", validate: (r) => /Apache Server Status for/i.test(r.body) || (/Server Version:/i.test(r.body) && /Server uptime|Current Time:/i.test(r.body)) },
  { path: "/server-info", validate: (r) => /Apache Server Information/i.test(r.body) || (/Server Settings/i.test(r.body) && /Module Name/i.test(r.body)) },
];

export const DIR_LISTING_PATHS: PathSpec[] = ["/icons/", "/images/", "/uploads/", "/static/", "/assets/"].map((path) => ({
  path,
  validate: (r: ProbeResponse) => DIR_LISTING_RE.test(r.body),
}));

// ─── Méthodes HTTP ───────────────────────────────────────────────────────────

/** TRACE réellement activé : le serveur renvoie la requête reçue (message/http). */
export function isTraceEcho(contentType: string, body: string): boolean {
  return /message\/http/i.test(contentType) || /^TRACE\s+\S+\s+HTTP\/\d/m.test(body);
}

/**
 * PUT/DELETE réellement acceptés : un 2xx dont le corps n'est pas simplement
 * la page servie en GET (hébergeurs statiques / SPA qui ignorent la méthode).
 */
export function isMethodReallyAccepted(status: number, body: string, getBody: string): boolean {
  if (![200, 201, 204].includes(status)) return false;
  if (status === 200 && body.trim() && (isSimilarBody(body, getBody) || looksLikeNotFound(body))) return false;
  if (status === 200 && isHtmlDocument(body) && isHtmlDocument(getBody)) return false;
  return true;
}
