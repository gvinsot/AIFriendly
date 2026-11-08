import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireSubscribedUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  checkOwnershipProof,
  generateOwnershipToken,
  isOwnershipVerified,
  ownershipHost,
  ownershipInstructions,
} from "@/lib/site-ownership";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/sites/:id/ownership — état de la vérification et preuve à publier
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await context.params;
  let site = await prisma.site.findFirst({ where: { id, userId: session.user.id } });
  if (!site) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }

  if (!site.ownershipToken) {
    // updateMany conditionnel : deux onglets ouverts ne génèrent pas deux jetons différents.
    await prisma.site.updateMany({
      where: { id, ownershipToken: null },
      data: { ownershipToken: generateOwnershipToken() },
    });
    site = await prisma.site.findUniqueOrThrow({ where: { id } });
  }

  return NextResponse.json({
    verified: isOwnershipVerified(site),
    method: site.ownershipMethod,
    verifiedAt: site.ownershipVerifiedAt,
    instructions: ownershipInstructions(site.url, site.ownershipToken!),
  });
}

// POST /api/sites/:id/ownership — cherche la preuve publiée par l'utilisateur
export async function POST(req: NextRequest, context: RouteContext) {
  const guard = await requireSubscribedUser();
  if (guard.response) return guard.response;

  // Chaque appel déclenche une requête DNS et une requête HTTP vers le site.
  const rateLimit = checkRateLimit(req);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes. Réessayez dans quelques instants." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { id } = await context.params;
  const site = await prisma.site.findFirst({ where: { id, userId: guard.userId } });
  if (!site) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }
  if (!site.ownershipToken) {
    return NextResponse.json({ error: "Aucun jeton généré pour ce site." }, { status: 409 });
  }

  const proof = await checkOwnershipProof(site.url, site.ownershipToken);
  if (proof.status !== "verified") {
    return NextResponse.json({ verified: false, reason: proof.status });
  }

  const updated = await prisma.site.update({
    where: { id },
    data: {
      ownershipVerifiedAt: new Date(),
      ownershipVerifiedHost: ownershipHost(site.url),
      ownershipMethod: proof.method,
    },
  });
  return NextResponse.json({ verified: true, method: updated.ownershipMethod, verifiedAt: updated.ownershipVerifiedAt });
}
