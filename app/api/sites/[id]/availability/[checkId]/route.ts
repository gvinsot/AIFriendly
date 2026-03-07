import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string; checkId: string }> };

// GET /api/sites/:id/availability/:checkId — full check detail
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id, checkId } = await context.params;

  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }

  const check = await prisma.availabilityCheck.findFirst({
    where: { id: checkId, siteId: id },
  });
  if (!check) {
    return NextResponse.json({ error: "Check introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    id: check.id,
    score: check.score,
    httpStatus: check.httpStatus,
    pingMs: check.pingMs,
    ttfbMs: check.ttfbMs,
    loadTimeMs: check.loadTimeMs,
    responseSize: check.responseSize,
    sslValid: check.sslValid,
    sslExpiry: check.sslExpiry,
    createdAt: check.createdAt,
    details: check.details,
  });
}
