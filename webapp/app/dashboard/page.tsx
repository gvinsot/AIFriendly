import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { DashboardContent } from "./DashboardContent";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const [sitesWithScores, sites, allAiAnalyses, allAvailabilityChecks, allSecurityScans] = await Promise.all([
    // Per-site summary with latest scores
    prisma.site.findMany({
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
    }),
    // Sites for chart legend
    prisma.site.findMany({
      where: { userId: session.user.id },
      select: { id: true, name: true },
    }),
    // Score history data (last 60 days)
    prisma.analysisResult.findMany({
      where: { site: { userId: session.user.id }, createdAt: { gte: sixtyDaysAgo } },
      orderBy: { createdAt: "asc" },
      select: { siteId: true, score: true, createdAt: true },
    }),
    prisma.availabilityCheck.findMany({
      where: { site: { userId: session.user.id }, createdAt: { gte: sixtyDaysAgo } },
      orderBy: { createdAt: "asc" },
      select: { siteId: true, score: true, createdAt: true },
    }),
    prisma.securityScan.findMany({
      where: { site: { userId: session.user.id }, createdAt: { gte: sixtyDaysAgo } },
      orderBy: { createdAt: "asc" },
      select: { siteId: true, score: true, createdAt: true },
    }),
  ]);

  // Serialize site summaries
  const serializedSites = sitesWithScores.map((s: typeof sitesWithScores[number]) => ({
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

  // Build score history data
  const siteMap = new Map(sites.map((s: typeof sites[number]) => [s.id, s.name]));
  const allScores = [
    ...allAiAnalyses.map((a: typeof allAiAnalyses[number]) => ({ siteId: a.siteId, score: a.score, date: a.createdAt })),
    ...allAvailabilityChecks.map((a: typeof allAvailabilityChecks[number]) => ({ siteId: a.siteId, score: a.score, date: a.createdAt })),
    ...allSecurityScans.map((a: typeof allSecurityScans[number]) => ({ siteId: a.siteId, score: a.score, date: a.createdAt })),
  ];

  const dailyMap = new Map<string, Map<string, { sum: number; count: number }>>();
  for (const entry of allScores) {
    const dateKey = entry.date.toISOString().slice(0, 10);
    if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, new Map());
    const siteScores = dailyMap.get(dateKey)!;
    if (!siteScores.has(entry.siteId)) siteScores.set(entry.siteId, { sum: 0, count: 0 });
    const acc = siteScores.get(entry.siteId)!;
    acc.sum += entry.score;
    acc.count += 1;
  }

  const siteNamesList = [...new Set(allScores.map((s) => s.siteId))].map((id) => ({
    id,
    name: siteMap.get(id) || id,
  }));

  const scoreHistory = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sitesData]) => {
      const point: Record<string, string | number> = { date };
      for (const { id, name } of siteNamesList) {
        const acc = sitesData.get(id);
        if (acc) point[name] = Math.round((acc.sum / acc.count) * 10) / 10;
      }
      return point;
    });

  return (
    <DashboardContent
      sites={serializedSites}
      scoreHistory={scoreHistory}
      siteNames={siteNamesList.map((s) => s.name)}
    />
  );
}
