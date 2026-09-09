import { headers } from "next/headers";

/**
 * Public base URL of the app, used to build Stripe return URLs.
 *
 * Auth.js v5 uses AUTH_URL (NEXTAUTH_URL is only the legacy v4 name and is not
 * injected in the Swarm stack), so relying on NEXTAUTH_URL alone silently fell
 * back to localhost in production. Fall back to the forwarded host set by
 * Traefik when no env var is configured.
 */
export async function getBaseUrl(): Promise<string> {
  const envUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto =
      h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }

  return "http://localhost:3000";
}
