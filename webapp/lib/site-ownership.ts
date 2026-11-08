/**
 * Vérification de propriété d'un site, préalable à tout scan de sécurité complet.
 *
 * Le scan cherche des fichiers sensibles (.env, .git, sauvegardes, pages
 * d'administration) et le pentest IA en lit le contenu : ces sondes ne doivent
 * viser qu'un site dont l'utilisateur a prouvé le contrôle, surtout depuis une
 * IP de sortie partagée qui ne permet plus à la cible de remonter jusqu'à nous.
 *
 * Deux preuves acceptées, avec un jeton propre à chaque site :
 *  - enregistrement DNS TXT sur `_aifriendly-verify.<hôte>` ;
 *  - fichier `/.well-known/aifriendly-verification.txt` à la racine du site.
 *
 * La preuve porte sur l'hôte (port inclus) et est recontrôlée tous les 30 jours :
 * changer l'URL d'un site vers un autre hôte ou retirer la preuve fait perdre
 * le droit de scanner.
 *
 * Fichier partagé : webapp, serveur MCP et worker (copié par leurs Dockerfiles).
 */

import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { isIP } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { readBodyLimited, safeFetch, unbracketHostname } from "./ssrf-guard";

const DNS_PREFIX = "_aifriendly-verify";
const FILE_PATH = "/.well-known/aifriendly-verification.txt";
const VALUE_PREFIX = "aifriendly-verify=";
const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 10_000;
const MAX_FILE_BYTES = 1024;

/** Message commun aux points d'entrée qui refusent un scan faute de preuve. */
export const OWNERSHIP_REQUIRED_MESSAGE =
  "Vérifiez d'abord que ce site vous appartient (DNS ou fichier) pour lancer un scan de sécurité.";

export type OwnershipMethod = "dns" | "file";
export type OwnershipProof =
  | { status: "verified"; method: OwnershipMethod }
  // Preuve réellement absente : autorise la révocation d'une vérification.
  | { status: "absent" }
  // Panne (DNS, réseau) : on ne conclut rien et on ne révoque pas.
  | { status: "unreachable" };

export interface OwnershipFields {
  id: string;
  url: string;
  ownershipToken: string | null;
  ownershipVerifiedAt: Date | null;
  ownershipVerifiedHost: string | null;
}

export function generateOwnershipToken(): string {
  return randomBytes(24).toString("hex");
}

/** Périmètre couvert par une preuve : l'hôte, port inclus. */
export function ownershipHost(url: string): string {
  return new URL(url).host.toLowerCase();
}

/** Ce que l'utilisateur doit publier pour prouver qu'il contrôle le site. */
export function ownershipInstructions(url: string, token: string) {
  const parsed = new URL(url);
  const value = `${VALUE_PREFIX}${token}`;
  const hostname = unbracketHostname(parsed.hostname);
  return {
    // Une adresse IP n'a pas de zone DNS : seul le fichier est possible.
    dns: isIP(hostname) ? null : { name: `${DNS_PREFIX}.${hostname}`, type: "TXT", value },
    file: { url: `${parsed.origin}${FILE_PATH}`, content: value },
  };
}

async function checkDnsProof(hostname: string, expected: string): Promise<OwnershipProof> {
  if (isIP(hostname)) return { status: "absent" };
  try {
    const records = await resolveTxt(`${DNS_PREFIX}.${hostname}`);
    // Un TXT long peut être découpé en plusieurs morceaux : on les recolle.
    return records.some((chunks) => chunks.join("").trim() === expected)
      ? { status: "verified", method: "dns" }
      : { status: "absent" };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? { status: "absent" } : { status: "unreachable" };
  }
}

async function checkFileProof(url: URL, expected: string): Promise<OwnershipProof> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    // Connexion directe : ce n'est pas un scan, et une IP de VPN bloquée par un
    // WAF empêcherait le propriétaire légitime de se vérifier.
    const res = await safeFetch(`${url.origin}${FILE_PATH}`, {
      signal: controller.signal,
      headers: { "User-Agent": "AIFriendly/1.0 (OwnershipCheck)" },
      maxBodyBytes: MAX_FILE_BYTES,
      // Seul un passage http → https sur le même hôte est suivi : une redirection
      // vers un autre domaine ne prouve rien sur celui-ci.
      allowRedirect: (next) => next.hostname === url.hostname,
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return { status: "absent" };
    }
    const body = await readBodyLimited(res, MAX_FILE_BYTES);
    // Égalité stricte : une page qui se contenterait de citer le jeton ne compte pas.
    return body.text.trim() === expected ? { status: "verified", method: "file" } : { status: "absent" };
  } catch (err) {
    return (err as { name?: string }).name === "SsrfBlockedError" ? { status: "absent" } : { status: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Cherche la preuve publiée pour `url`. Le DNS d'abord, puis le fichier. */
export async function checkOwnershipProof(url: string, token: string): Promise<OwnershipProof> {
  const parsed = new URL(url);
  const expected = `${VALUE_PREFIX}${token}`;
  const dns = await checkDnsProof(unbracketHostname(parsed.hostname), expected);
  if (dns.status === "verified") return dns;
  const file = await checkFileProof(parsed, expected);
  if (file.status === "verified") return file;
  return dns.status === "unreachable" || file.status === "unreachable"
    ? { status: "unreachable" }
    : { status: "absent" };
}

/** La vérification enregistrée couvre-t-elle l'hôte actuel du site ? */
export function isOwnershipVerified(site: OwnershipFields): boolean {
  return !!site.ownershipToken && !!site.ownershipVerifiedAt && site.ownershipVerifiedHost === ownershipHost(site.url);
}

/**
 * Point de contrôle à appeler avant tout scan complet. Sans preuve valide,
 * retourne false ; au-delà de 30 jours, recontrôle la preuve et révoque la
 * vérification si elle a disparu.
 */
export async function ensureSiteOwnership(
  db: Pick<PrismaClient, "site">,
  site: OwnershipFields,
  now = new Date()
): Promise<boolean> {
  if (!isOwnershipVerified(site)) return false;
  if (now.getTime() - site.ownershipVerifiedAt!.getTime() < RECHECK_AFTER_MS) return true;

  const proof = await checkOwnershipProof(site.url, site.ownershipToken!);
  if (proof.status === "verified") {
    await db.site.update({
      where: { id: site.id },
      data: { ownershipVerifiedAt: now, ownershipMethod: proof.method },
    });
    return true;
  }
  if (proof.status === "absent") {
    await db.site.update({
      where: { id: site.id },
      data: { ownershipVerifiedAt: null, ownershipVerifiedHost: null, ownershipMethod: null },
    });
  }
  return false;
}
