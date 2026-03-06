import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { analyzeUrl } from "@/lib/analyzer";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/sites/:id/analyze — trigger manual analysis
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
    const result = await analyzeUrl(site.url);

    const analysis = await prisma.analysisResult.create({
      data: {
        siteId: site.id,
        score: result.score,
        maxScore: result.maxScore,
        details: JSON.parse(JSON.stringify({
          improvements: result.improvements,
          aiPreviewYaml: result.aiPreviewYaml,
          botAccess: result.botAccess,
          analyzedAt: result.analyzedAt,
        })),
      },
    });

    return NextResponse.json({
      id: analysis.id,
      score: analysis.score,
      maxScore: analysis.maxScore,
      createdAt: analysis.createdAt,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erreur lors de l'analyse.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
