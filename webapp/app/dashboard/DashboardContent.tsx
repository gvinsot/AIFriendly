"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";

type AnalysisType = "accessibility" | "availability" | "security";

interface Analysis {
  id: string;
  score: number;
  createdAt: string;
  siteName: string;
  siteUrl: string;
  type: AnalysisType;
}

interface DashboardContentProps {
  siteCount: number;
  avgScore: number | null;
  recentAnalyses: Analysis[];
}

export function DashboardContent({ siteCount, avgScore, recentAnalyses }: DashboardContentProps) {
  const { t, locale } = useI18n();

  const dateLocale = locale === "fr" ? "fr-FR" : locale === "es" ? "es-ES" : locale === "de" ? "de-DE" : "en-US";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-luxe-fg">
          {t.dashboard.title}
        </h1>
        <p className="text-sm text-luxe-fg-muted mt-1">
          {t.dashboard.subtitle}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t.dashboard.registeredSites} value={String(siteCount)} />
        <StatCard
          label={t.dashboard.averageScore}
          value={avgScore !== null ? `${avgScore}/10` : "—"}
        />
        <StatCard
          label={t.dashboard.recentAnalyses}
          value={String(recentAnalyses.length)}
        />
      </div>

      {/* Recent analyses */}
      <section className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
        <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-luxe-fg">
            {t.dashboard.recentAnalyses}
          </h2>
          <Link
            href="/dashboard/sites"
            className="text-sm text-luxe-gold hover:underline"
          >
            {t.dashboard.viewAllSites} &rarr;
          </Link>
        </div>
        {recentAnalyses.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-luxe-fg-muted mb-4">
              {t.dashboard.noAnalysesYet}
            </p>
            <Link
              href="/dashboard/sites"
              className="inline-flex items-center gap-2 rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold px-5 py-2.5 text-sm font-medium hover:bg-luxe-gold/20 transition-colors"
            >
              {t.dashboard.addSite}
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-luxe-border">
            {recentAnalyses.map((analysis) => (
              <li key={analysis.id} className="px-6 py-4 flex items-center justify-between hover:bg-luxe-bg-muted/30 transition-colors">
                <div>
                  <p className="text-sm font-medium text-luxe-fg flex items-center gap-2">
                    {analysis.siteName}
                    <AnalysisTypeBadge type={analysis.type} label={t.siteDetail.tabs[analysis.type === "accessibility" ? "ai" : analysis.type]} />
                  </p>
                  <p className="text-xs text-luxe-fg-muted mt-0.5">
                    {new Date(analysis.createdAt).toLocaleDateString(dateLocale, {
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

function AnalysisTypeBadge({ type, label }: { type: AnalysisType; label: string }) {
  const colors: Record<AnalysisType, string> = {
    accessibility: "text-violet-600 bg-violet-500/10 border-violet-500/20",
    availability: "text-sky-600 bg-sky-500/10 border-sky-500/20",
    security: "text-amber-600 bg-amber-500/10 border-amber-500/20",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${colors[type]}`}>
      {label}
    </span>
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
