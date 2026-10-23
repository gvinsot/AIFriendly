/**
 * Hook de démarrage Next.js (exécuté une fois par instance serveur).
 * Mitigation CVE-2026-111497 (Node2Shell) — voir lib/node-security.ts
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertPatchedNodeRuntime, installBrotliSafeFetch } = await import("./lib/node-security");
    assertPatchedNodeRuntime("aifriendly-webapp");
    installBrotliSafeFetch();
  }
}
