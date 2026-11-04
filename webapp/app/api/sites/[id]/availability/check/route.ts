import { NextRequest, NextResponse } from "next/server";
import { requireSubscribedUser } from "@/lib/api-auth";
import { SsrfBlockedError } from "@/lib/ssrf-guard";
import { prisma } from "@/lib/prisma";
import { checkAvailability } from "@/lib/availability-checker";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/sites/:id/availability/check — trigger manual availability check
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
    const result = await checkAvailability(site.url);

    const check = await prisma.availabilityCheck.create({
      data: {
        siteId: site.id,
        score: result.score,
        httpStatus: result.httpStatus,
        pingMs: result.pingMs,
        ttfbMs: result.ttfbMs,
        loadTimeMs: result.loadTimeMs,
        responseSize: result.responseSize,
        sslValid: result.sslValid,
        sslExpiry: result.sslExpiry ? new Date(result.sslExpiry) : null,
        details: JSON.parse(JSON.stringify(result.details)),
      },
    });

    return NextResponse.json({
      id: check.id,
      score: check.score,
      httpStatus: check.httpStatus,
      pingMs: check.pingMs,
      loadTimeMs: check.loadTimeMs,
      createdAt: check.createdAt,
    });
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json({ error: "Cette URL n'est pas autorisée." }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Erreur lors du check.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
