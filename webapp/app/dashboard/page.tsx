import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { DashboardContent } from "./DashboardContent";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const [siteCount, aiAnalyses, availabilityChecks, securityScans] = await Promise.all([
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
  ]);

  // Merge all analysis types and sort by date
  const allAnalyses = [
    ...aiAnalyses.map((a) => ({ id: a.id, score: a.score, createdAt: a.createdAt, siteName: a.site.name, siteUrl: a.site.url, type: "accessibility" as const })),
    ...availabilityChecks.map((a) => ({ id: a.id, score: a.score, createdAt: a.createdAt, siteName: a.site.name, siteUrl: a.site.url, type: "availability" as const })),
    ...securityScans.map((a) => ({ id: a.id, score: a.score, createdAt: a.createdAt, siteName: a.site.name, siteUrl: a.site.url, type: "security" as const })),
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
    score: a.score,
    createdAt: a.createdAt.toISOString(),
    siteName: a.siteName,
    siteUrl: a.siteUrl,
    type: a.type,
  }));

  return (
    <DashboardContent
      siteCount={siteCount}
      avgScore={avgScore}
      recentAnalyses={serializedAnalyses}
    />
  );
}
