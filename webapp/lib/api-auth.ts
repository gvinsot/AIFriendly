import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Garde d'accès pour les routes API réservées aux abonnés.
 *
 * Le proxy (proxy.ts) n'intercepte que les pages /dashboard : sans ce
 * contrôle, un utilisateur connecté mais non abonné pouvait appeler
 * directement /api/sites, /api/keys ou les déclenchements manuels d'analyse
 * et contourner le paywall. L'abonnement est vérifié en base (le flag du JWT
 * peut avoir jusqu'à 5 minutes de retard, ex. après une résiliation).
 *
 * @returns `{ userId }` si autorisé, sinon une réponse 401/403 à renvoyer.
 */
export async function requireSubscribedUser(): Promise<
  { userId: string; response?: undefined } | { userId?: undefined; response: NextResponse }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { response: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCurrentPeriodEnd: true },
  });
  const periodEnd = user?.stripeCurrentPeriodEnd;
  if (!periodEnd || periodEnd.getTime() <= Date.now()) {
    return {
      response: NextResponse.json({ error: "Abonnement actif requis." }, { status: 403 }),
    };
  }

  return { userId };
}

/** Lit un corps JSON objet ; retourne null si le corps est invalide. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
