import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string; analysisId: string }> };

// GET /api/sites/:id/history/:analysisId — full analysis detail
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id, analysisId } = await context.params;

  // Verify ownership
  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }

  const analysis = await prisma.analysisResult.findFirst({
    where: { id: analysisId, siteId: id },
  });
  if (!analysis) {
    return NextResponse.json({ error: "Analyse introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    id: analysis.id,
    score: analysis.score,
    maxScore: analysis.maxScore,
    createdAt: analysis.createdAt,
    details: analysis.details,
  });
}
