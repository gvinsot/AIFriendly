import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { DashboardContent } from "./DashboardContent";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const [siteCount, recentAnalyses] = await Promise.all([
    prisma.site.count({ where: { userId: session.user.id } }),
    prisma.analysisResult.findMany({
      where: { site: { userId: session.user.id } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { site: { select: { name: true, url: true } } },
    }),
  ]);

  const avgScore =
    recentAnalyses.length > 0
      ? Math.round(
          (recentAnalyses.reduce((sum, a) => sum + a.score, 0) /
            recentAnalyses.length) *
            10
        ) / 10
      : null;

  // Serialize for client component
  const serializedAnalyses = recentAnalyses.map((a) => ({
    id: a.id,
    score: a.score,
    createdAt: a.createdAt.toISOString(),
    siteName: a.site.name,
    siteUrl: a.site.url,
  }));

  return (
    <DashboardContent
      siteCount={siteCount}
      avgScore={avgScore}
      recentAnalyses={serializedAnalyses}
    />
  );
}
