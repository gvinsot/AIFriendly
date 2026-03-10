import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { scanSecurity } from "@/lib/security-scanner";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/sites/:id/security/scan — trigger manual security scan
export async function POST(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await context.params;
  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!site) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }

  try {
    const result = await scanSecurity(site.url);

    const scan = await prisma.securityScan.create({
      data: {
        siteId: site.id,
        score: result.score,
        headersScore: result.headersScore,
        sslScore: result.sslScore,
        cookiesScore: result.cookiesScore,
        infoLeakScore: result.infoLeakScore,
        injectionScore: result.injectionScore,
        details: JSON.parse(JSON.stringify(result.details)),
      },
    });

    return NextResponse.json({
      id: scan.id,
      score: scan.score,
      headersScore: scan.headersScore,
      sslScore: scan.sslScore,
      cookiesScore: scan.cookiesScore,
      infoLeakScore: scan.infoLeakScore,
      injectionScore: scan.injectionScore,
      createdAt: scan.createdAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur lors du scan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
