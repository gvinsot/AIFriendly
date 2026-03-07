import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string; scanId: string }> };

// GET /api/sites/:id/security/:scanId — full scan detail
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id, scanId } = await context.params;

  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }

  const scan = await prisma.securityScan.findFirst({
    where: { id: scanId, siteId: id },
  });
  if (!scan) {
    return NextResponse.json({ error: "Scan introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    id: scan.id,
    score: scan.score,
    headersScore: scan.headersScore,
    sslScore: scan.sslScore,
    cookiesScore: scan.cookiesScore,
    infoLeakScore: scan.infoLeakScore,
    injectionScore: scan.injectionScore,
    createdAt: scan.createdAt,
    details: scan.details,
  });
}
