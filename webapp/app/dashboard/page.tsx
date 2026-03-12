import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { DashboardContent } from "./DashboardContent";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const [siteCount, aiAnalyses, availabilityChecks, securityScans, sites, allAiAnalyses, allAvailabilityChecks, allSecurityScans] = await Promise.all([
    prisma.site.count({ where: { userId: session.user.id } }),
    prisma.analysisResult.findMany({
      where: { site: { userId: session.user.id } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { site: { select: { name: true, url: true } } },
    }),
    prisma.availabilityCheck.findMany({
      where: { site: { userId: session.user.id } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { site: { select: { name: true, url: true } } },
    }),
    prisma.securityScan.findMany({
      where: { site: { userId: session.user.id } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { site: { select: { name: true, url: true } } },
    }),
    // Fetch sites for chart
    prisma.site.findMany({
      where: { userId: session.user.id },
      select: { id: true, name: true },
    }),
    // Fetch all analyses from last 60 days for the chart
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

  // Merge all analysis types and sort by date
  const allAnalyses = [
    ...aiAnalyses.map((a) => ({ id: a.id, siteId: a.siteId, score: a.score, createdAt: a.createdAt, siteName: a.site.name, siteUrl: a.site.url, type: "accessibility" as const })),
    ...availabilityChecks.map((a) => ({ id: a.id, siteId: a.siteId, score: a.score, createdAt: a.createdAt, siteName: a.site.name, siteUrl: a.site.url, type: "availability" as const })),
    ...securityScans.map((a) => ({ id: a.id, siteId: a.siteId, score: a.score, createdAt: a.createdAt, siteName: a.site.name, siteUrl: a.site.url, type: "security" as const })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5);

  const avgScore =
    allAnalyses.length > 0
      ? Math.round(
          (allAnalyses.reduce((sum, a) => sum + a.score, 0) /
            allAnalyses.length) *
            10
        ) / 10
      : null;

  // Serialize for client component
  const serializedAnalyses = allAnalyses.map((a) => ({
    id: a.id,
    siteId: a.siteId,
    score: a.score,
    createdAt: a.createdAt.toISOString(),
    siteName: a.siteName,
    siteUrl: a.siteUrl,
    type: a.type,
  }));

  // Build score history data: daily average score per site
  const siteMap = new Map(sites.map((s) => [s.id, s.name]));
  const allScores = [
    ...allAiAnalyses.map((a) => ({ siteId: a.siteId, score: a.score, date: a.createdAt })),
    ...allAvailabilityChecks.map((a) => ({ siteId: a.siteId, score: a.score, date: a.createdAt })),
    ...allSecurityScans.map((a) => ({ siteId: a.siteId, score: a.score, date: a.createdAt })),
  ];

  // Group by date (YYYY-MM-DD) + siteId -> average score
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

  const siteNames = [...new Set(allScores.map((s) => s.siteId))].map((id) => ({
    id,
    name: siteMap.get(id) || id,
  }));

  const scoreHistory = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sitesData]) => {
      const point: Record<string, string | number> = { date };
      for (const { id, name } of siteNames) {
        const acc = sitesData.get(id);
        if (acc) point[name] = Math.round((acc.sum / acc.count) * 10) / 10;
      }
      return point;
    });

  return (
    <DashboardContent
      siteCount={siteCount}
      avgScore={avgScore}
      recentAnalyses={serializedAnalyses}
      scoreHistory={scoreHistory}
      siteNames={siteNames.map((s) => s.name)}
    />
  );
}
