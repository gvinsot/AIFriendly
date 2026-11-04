import { NextRequest, NextResponse } from "next/server";
import { requireSubscribedUser } from "@/lib/api-auth";
import { SsrfBlockedError } from "@/lib/ssrf-guard";
import { prisma } from "@/lib/prisma";
import { scanSecurity } from "@/lib/security-scanner";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/sites/:id/security/scan — trigger manual security scan
export async function POST(_req: NextRequest, context: RouteContext) {
  const guard = await requireSubscribedUser();
  if (guard.response) return guard.response;

  const { id } = await context.params;
  const site = await prisma.site.findFirst({
    where: { id, userId: guard.userId },
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
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json({ error: "Cette URL n'est pas autorisée." }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Erreur lors du scan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
