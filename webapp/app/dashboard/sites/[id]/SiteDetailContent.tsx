"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { ScoreHistoryChart } from "../../ScoreHistoryChart";
import ShareSection from "@/components/ShareSection";

// ─── Types ──────────────────────────────────────────────────────────────────

type TabType = "ai" | "availability" | "security";

interface AnalysisRow {
  id: string;
  score: number;
  maxScore: number;
  ethicsScore: number | null;
  coherenceScore: number | null;
  aiGeneratedScore: number | null;
  details: unknown;
  createdAt: string;
}

interface AvailabilityRow {
  id: string;
  score: number;
  httpStatus: number | null;
  pingMs: number | null;
  ttfbMs: number | null;
  loadTimeMs: number | null;
  responseSize: number | null;
  sslValid: boolean | null;
  sslExpiry: string | null;
  details: unknown;
  createdAt: string;
}

interface SecurityRow {
  id: string;
  score: number;
  headersScore: number;
  sslScore: number;
  cookiesScore: number;
  infoLeakScore: number;
  injectionScore: number;
  details: unknown;
  createdAt: string;
}

interface SiteDetail {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
  analyses: AnalysisRow[];
  availabilityChecks: AvailabilityRow[];
  securityScans: SecurityRow[];
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function scoreColor(v: number, max = 10): string {
  const pct = (v / max) * 100;
  if (pct >= 70) return "text-luxe-score-high";
  if (pct >= 40) return "text-luxe-score-mid";
  return "text-luxe-score-low";
}

function scoreBg(v: number, max = 10): string {
  const pct = (v / max) * 100;
  if (pct >= 70) return "bg-luxe-score-high/10 border-luxe-score-high/20";
  if (pct >= 40) return "bg-luxe-score-mid/10 border-luxe-score-mid/20";
  return "bg-luxe-score-low/10 border-luxe-score-low/20";
}

// Format the JSON details into displayable items
interface DetailItem {
  id: string;
  label: string;
  description: string;
  points: number;
  maxPoints: number;
  severity: string;
}

function parseDetails(raw: unknown): DetailItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as DetailItem[];
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as DetailItem[];
    if (Array.isArray(obj.details)) return obj.details as DetailItem[];
  }
  return [];
}

function severityIcon(s: string) {
  switch (s) {
    case "success":
      return "✅";
    case "warning":
      return "⚠️";
    case "error":
      return "❌";
    default:
      return "ℹ️";
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SiteDetailContent({ site }: { site: SiteDetail }) {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const dateLocale =
    locale === "fr"
      ? "fr-FR"
      : locale === "es"
      ? "es-ES"
      : locale === "de"
      ? "de-DE"
      : "en-US";

  const initialTab = (searchParams.get("tab") as TabType) || "ai";
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  // Keep URL in sync
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") !== activeTab) {
      url.searchParams.set("tab", activeTab);
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [activeTab, router]);

  // Memoize latest entries
  const latestAnalysis = site.analyses[0] ?? null;
  const latestAvailability = site.availabilityChecks[0] ?? null;
  const latestSecurity = site.securityScans[0] ?? null;

  // ── Chart data builders ────────────────────────────────────────────────

  const aiChartData = useMemo(
    () =>
      [...site.analyses]
        .reverse()
        .map((a) => ({
          date: a.createdAt.slice(0, 10),
          [site.name]: a.score,
        })),
    [site.analyses, site.name]
  );

  const availChartData = useMemo(
    () =>
      [...site.availabilityChecks]
        .reverse()
        .map((a) => ({
          date: a.createdAt.slice(0, 10),
          [site.name]: a.score,
        })),
    [site.availabilityChecks, site.name]
  );

  const secChartData = useMemo(
    () =>
      [...site.securityScans]
        .reverse()
        .map((s) => ({
          date: s.createdAt.slice(0, 10),
          [site.name]: s.score,
        })),
    [site.securityScans, site.name]
  );

  // ── Renderers ─────────────────────────────────────────────────────────

  const renderAITab = useCallback(() => {
    if (!latestAnalysis) {
      return (
        <EmptyState
          icon="sparkles"
          title={t.siteDetail.noAiTitle}
          description={t.siteDetail.noAiDescription}
        />
      );
    }

    const details = parseDetails(latestAnalysis.details);
    const hasSubScores =
      latestAnalysis.ethicsScore != null ||
      latestAnalysis.coherenceScore != null ||
      latestAnalysis.aiGeneratedScore != null;

    return (
      <div className="space-y-6">
        {/* Big score */}
        <ScoreHero
          label={t.dashboard.aiScore}
          score={latestAnalysis.score}
          maxScore={latestAnalysis.maxScore}
          date={latestAnalysis.createdAt}
          dateLocale={dateLocale}
        />

        {/* Sub-scores */}
        {hasSubScores && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {latestAnalysis.ethicsScore != null && (
              <SubScoreCard label={t.siteDetail.ethicsScore} score={latestAnalysis.ethicsScore} />
            )}
            {latestAnalysis.coherenceScore != null && (
              <SubScoreCard label={t.siteDetail.coherenceScore} score={latestAnalysis.coherenceScore} />
            )}
            {latestAnalysis.aiGeneratedScore != null && (
              <SubScoreCard label={t.siteDetail.aiGeneratedScore} score={latestAnalysis.aiGeneratedScore} />
            )}
          </div>
        )}

        {/* Chart */}
        {aiChartData.length > 1 && (
          <ChartCard title={t.siteDetail.aiScoreTrend}>
            <ScoreHistoryChart data={aiChartData} siteNames={[site.name]} />
          </ChartCard>
        )}

        {/* Detail rows */}
        {details.length > 0 && (
          <DetailList title={t.siteDetail.analysisDetails} items={details} />
        )}
      </div>
    );
  }, [latestAnalysis, aiChartData, site.name, t, dateLocale]);

  const renderAvailabilityTab = useCallback(() => {
    if (!latestAvailability) {
      return (
        <EmptyState
          icon="bars"
          title={t.siteDetail.noAvailTitle}
          description={t.siteDetail.noAvailDescription}
        />
      );
    }

    return (
      <div className="space-y-6">
        {/* Big score */}
        <ScoreHero
          label={t.dashboard.availabilityScore}
          score={latestAvailability.score}
          maxScore={10}
          date={latestAvailability.createdAt}
          dateLocale={dateLocale}
        />

        {/* Metrics grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard
            label={t.siteDetail.httpStatus}
            value={latestAvailability.httpStatus != null ? String(latestAvailability.httpStatus) : "—"}
            good={latestAvailability.httpStatus != null && latestAvailability.httpStatus < 400}
          />
          <MetricCard
            label={t.siteDetail.pingMs}
            value={latestAvailability.pingMs != null ? `${latestAvailability.pingMs} ms` : "—"}
          />
          <MetricCard
            label={t.siteDetail.ttfbMs}
            value={latestAvailability.ttfbMs != null ? `${latestAvailability.ttfbMs} ms` : "—"}
          />
          <MetricCard
            label={t.siteDetail.loadTimeMs}
            value={latestAvailability.loadTimeMs != null ? `${latestAvailability.loadTimeMs} ms` : "—"}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <MetricCard
            label={t.siteDetail.responseSize}
            value={
              latestAvailability.responseSize != null
                ? latestAvailability.responseSize > 1024
                  ? `${(latestAvailability.responseSize / 1024).toFixed(1)} KB`
                  : `${latestAvailability.responseSize} B`
                : "—"
            }
          />
          <MetricCard
            label={t.siteDetail.sslValid}
            value={latestAvailability.sslValid != null ? (latestAvailability.sslValid ? "✓" : "✗") : "—"}
            good={latestAvailability.sslValid === true}
          />
          {latestAvailability.sslExpiry && (
            <MetricCard
              label={t.siteDetail.sslExpiry}
              value={new Date(latestAvailability.sslExpiry).toLocaleDateString(dateLocale)}
            />
          )}
        </div>

        {/* Chart */}
        {availChartData.length > 1 && (
          <ChartCard title={t.siteDetail.availScoreTrend}>
            <ScoreHistoryChart data={availChartData} siteNames={[site.name]} />
          </ChartCard>
        )}

        {/* Details */}
        {(() => {
          const items = parseDetails(latestAvailability.details);
          return items.length > 0 ? (
            <DetailList title={t.siteDetail.availDetails} items={items} />
          ) : null;
        })()}
      </div>
    );
  }, [latestAvailability, availChartData, site.name, t, dateLocale]);

  const renderSecurityTab = useCallback(() => {
    if (!latestSecurity) {
      return (
        <EmptyState
          icon="shield"
          title={t.siteDetail.noSecTitle}
          description={t.siteDetail.noSecDescription}
        />
      );
    }

    return (
      <div className="space-y-6">
        {/* Big score */}
        <ScoreHero
          label={t.dashboard.securityScore}
          score={latestSecurity.score}
          maxScore={10}
          date={latestSecurity.createdAt}
          dateLocale={dateLocale}
        />

        {/* Sub-scores */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <SubScoreCard label={t.siteDetail.headersScore} score={latestSecurity.headersScore} />
          <SubScoreCard label={t.siteDetail.sslScore} score={latestSecurity.sslScore} />
          <SubScoreCard label={t.siteDetail.cookiesScore} score={latestSecurity.cookiesScore} />
          <SubScoreCard label={t.siteDetail.infoLeakScore} score={latestSecurity.infoLeakScore} />
          <SubScoreCard label={t.siteDetail.injectionScore} score={latestSecurity.injectionScore} />
        </div>

        {/* Chart */}
        {secChartData.length > 1 && (
          <ChartCard title={t.siteDetail.secScoreTrend}>
            <ScoreHistoryChart data={secChartData} siteNames={[site.name]} />
          </ChartCard>
        )}

        {/* Details */}
        {(() => {
          const items = parseDetails(latestSecurity.details);
          return items.length > 0 ? (
            <DetailList title={t.siteDetail.secDetails} items={items} />
          ) : null;
        })()}
      </div>
    );
  }, [latestSecurity, secChartData, site.name, t, dateLocale]);

  // ── Main render ────────────────────────────────────────────────────────

  const tabs: { key: TabType; label: string; icon: string }[] = [
    { key: "ai", label: t.dashboard.aiScore, icon: "sparkles" },
    { key: "availability", label: t.dashboard.availabilityScore, icon: "bars" },
    { key: "security", label: t.dashboard.securityScore, icon: "shield" },
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-luxe-fg-muted">
        <Link href="/dashboard" className="hover:text-luxe-fg transition-colors">
          {t.dashboard.title}
        </Link>
        <span>/</span>
        <span className="text-luxe-fg font-medium">{site.name}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-luxe-bg-elevated border border-luxe-border p-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === key
                ? "bg-luxe-gold/15 text-luxe-gold border border-luxe-gold/30"
                : "text-luxe-fg-muted hover:text-luxe-fg hover:bg-luxe-bg-muted/50 border border-transparent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "ai" && renderAITab()}
      {activeTab === "availability" && renderAvailabilityTab()}
      {activeTab === "security" && renderSecurityTab()}

      {/* Share */}
      <ShareSection siteId={site.id} siteName={site.name} />
    </div>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function ScoreHero({
  label,
  score,
  maxScore,
  date,
  dateLocale,
}: {
  label: string;
  score: number;
  maxScore: number;
  date: string;
  dateLocale: string;
}) {
  return (
    <div className={`rounded-2xl border p-6 ${scoreBg(score, maxScore)}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-luxe-fg-muted mb-1">
            {label}
          </p>
          <p className={`font-display text-4xl font-bold ${scoreColor(score, maxScore)}`}>
            {score}
            <span className="text-lg text-luxe-fg-muted font-normal">/{maxScore}</span>
          </p>
        </div>
        <p className="text-xs text-luxe-fg-muted">
          {new Date(date).toLocaleDateString(dateLocale, {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div className="rounded-xl bg-luxe-bg-elevated border border-luxe-border p-4">
      <p className="text-[10px] uppercase tracking-wider text-luxe-fg-muted mb-1">
        {label}
      </p>
      <p
        className={`font-display text-xl font-semibold ${
          good === true
            ? "text-luxe-score-high"
            : good === false
            ? "text-luxe-score-low"
            : "text-luxe-fg"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function SubScoreCard({ label, score }: { label: string; score: number }) {
  return (
    <div className={`rounded-xl border p-4 text-center ${scoreBg(score)}`}>
      <p className="text-[10px] uppercase tracking-wider text-luxe-fg-muted mb-1">
        {label}
      </p>
      <p className={`font-display text-2xl font-bold ${scoreColor(score)}`}>
        {score}
        <span className="text-xs text-luxe-fg-muted font-normal">/10</span>
      </p>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border overflow-hidden">
      <div className="px-6 py-3 border-b border-luxe-border bg-luxe-bg-muted/30">
        <h3 className="text-sm font-semibold text-luxe-fg">{title}</h3>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function DetailList({
  title,
  items,
}: {
  title: string;
  items: DetailItem[];
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-luxe-fg">{title}</h3>
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-xl bg-luxe-bg-elevated border border-luxe-border p-4"
        >
          <div className="flex items-start gap-3">
            <span className="text-base mt-0.5">{severityIcon(item.severity)}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium text-luxe-fg truncate">
                  {item.label}
                </h4>
                <span
                  className={`text-xs font-mono shrink-0 ${scoreColor(
                    item.points,
                    item.maxPoints
                  )}`}
                >
                  {item.points}/{item.maxPoints}
                </span>
              </div>
              <p className="text-xs text-luxe-fg-muted mt-1 line-clamp-2">
                {item.description}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border p-12 text-center">
      <div className="inline-flex items-center justify-center size-16 rounded-2xl bg-luxe-gold/10 border border-luxe-gold/20 mb-4">
        {icon === "sparkles" && (
          <svg className="size-8 text-luxe-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        )}
        {icon === "bars" && (
          <svg className="size-8 text-luxe-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
          </svg>
        )}
        {icon === "shield" && (
          <svg className="size-8 text-luxe-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
        )}
      </div>
      <h3 className="font-display text-lg font-semibold text-luxe-fg mb-2">
        {title}
      </h3>
      <p className="text-sm text-luxe-fg-muted max-w-md mx-auto">
        {description}
      </p>
    </div>
  );
}