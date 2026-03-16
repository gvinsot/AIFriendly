import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// GET /api/dashboard/summary — per-site summary with latest scores for each type
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sites = await prisma.site.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      analyses: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, score: true, createdAt: true },
      },
      availabilityChecks: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, score: true, httpStatus: true, pingMs: true, loadTimeMs: true, createdAt: true },
      },
      securityScans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, score: true, headersScore: true, sslScore: true, cookiesScore: true, infoLeakScore: true, injectionScore: true, createdAt: true },
      },
    },
  });

  const result = sites.map((s: typeof sites[number]) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    isActive: s.isActive,
    latestAi: s.analyses[0]
      ? { id: s.analyses[0].id, score: s.analyses[0].score, createdAt: s.analyses[0].createdAt.toISOString() }
      : null,
    latestAvailability: s.availabilityChecks[0]
      ? {
          id: s.availabilityChecks[0].id,
          score: s.availabilityChecks[0].score,
          httpStatus: s.availabilityChecks[0].httpStatus,
          pingMs: s.availabilityChecks[0].pingMs,
          loadTimeMs: s.availabilityChecks[0].loadTimeMs,
          createdAt: s.availabilityChecks[0].createdAt.toISOString(),
        }
      : null,
    latestSecurity: s.securityScans[0]
      ? {
          id: s.securityScans[0].id,
          score: s.securityScans[0].score,
          headersScore: s.securityScans[0].headersScore,
          sslScore: s.securityScans[0].sslScore,
          cookiesScore: s.securityScans[0].cookiesScore,
          infoLeakScore: s.securityScans[0].infoLeakScore,
          injectionScore: s.securityScans[0].injectionScore,
          createdAt: s.securityScans[0].createdAt.toISOString(),
        }
      : null,
  }));

  return NextResponse.json(result);
}
