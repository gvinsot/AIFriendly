import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { redirect } from "next/navigation";

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-luxe-fg">
          Tableau de bord
        </h1>
        <p className="text-sm text-luxe-fg-muted mt-1">
          Vue d&apos;ensemble de vos analyses
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Sites enregistrés" value={String(siteCount)} />
        <StatCard
          label="Score moyen"
          value={avgScore !== null ? `${avgScore}/10` : "—"}
        />
        <StatCard
          label="Dernières analyses"
          value={String(recentAnalyses.length)}
        />
      </div>

      {/* Recent analyses */}
      <section className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
        <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-luxe-fg">
            Analyses récentes
          </h2>
          <Link
            href="/dashboard/sites"
            className="text-sm text-luxe-gold hover:underline"
          >
            Voir tous les sites &rarr;
          </Link>
        </div>
        {recentAnalyses.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-luxe-fg-muted mb-4">
              Aucune analyse pour le moment.
            </p>
            <Link
              href="/dashboard/sites"
              className="inline-flex items-center gap-2 rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold px-5 py-2.5 text-sm font-medium hover:bg-luxe-gold/20 transition-colors"
            >
              Ajouter un site
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-luxe-border">
            {recentAnalyses.map((analysis) => (
              <li key={analysis.id} className="px-6 py-4 flex items-center justify-between hover:bg-luxe-bg-muted/30 transition-colors">
                <div>
                  <p className="text-sm font-medium text-luxe-fg">
                    {analysis.site.name}
                  </p>
                  <p className="text-xs text-luxe-fg-muted mt-0.5">
                    {new Date(analysis.createdAt).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <ScoreBadge score={analysis.score} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-luxe-bg-elevated border border-luxe-border p-5">
      <p className="text-xs text-luxe-fg-muted uppercase tracking-wider">
        {label}
      </p>
      <p className="font-display text-2xl font-semibold text-luxe-fg mt-1">
        {value}
      </p>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 7
      ? "text-luxe-score-high bg-luxe-score-high/10 border-luxe-score-high/20"
      : score >= 4
      ? "text-luxe-score-mid bg-luxe-score-mid/10 border-luxe-score-mid/20"
      : "text-luxe-score-low bg-luxe-score-low/10 border-luxe-score-low/20";

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold border ${color}`}
    >
      {score}/10
    </span>
  );
}
