import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/sites/:id/availability — list availability checks
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await context.params;
  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }

  const checks = await prisma.availabilityCheck.findMany({
    where: { siteId: id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      score: true,
      httpStatus: true,
      pingMs: true,
      loadTimeMs: true,
      createdAt: true,
    },
  });

  return NextResponse.json(checks);
}
