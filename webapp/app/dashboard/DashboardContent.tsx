"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { ScoreHistoryChart } from "./ScoreHistoryChart";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SiteSummary {
  id: string;
  name: string;
  url: string;
  frequency: string;
  isActive: boolean;
  latestAi: { id: string; score: number; createdAt: string } | null;
  latestAvailability: {
    id: string;
    score: number;
    httpStatus: number | null;
    pingMs: number | null;
    loadTimeMs: number | null;
    createdAt: string;
  } | null;
  latestSecurity: {
    id: string;
    score: number;
    headersScore: number;
    sslScore: number;
    cookiesScore: number;
    infoLeakScore: number;
    injectionScore: number;
    createdAt: string;
  } | null;
}

interface DashboardContentProps {
  sites: SiteSummary[];
  scoreHistory: Record<string, string | number>[];
  siteNames: string[];
}

export function DashboardContent({ sites: initialSites, scoreHistory, siteNames }: DashboardContentProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const dateLocale = locale === "fr" ? "fr-FR" : locale === "es" ? "es-ES" : locale === "de" ? "de-DE" : "en-US";

  const [sites, setSites] = useState(initialSites);
  const [showForm, setShowForm] = useState(false);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", url: "", frequency: "daily" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Compute global stats
  const allScores: number[] = [];
  for (const s of sites) {
    if (s.latestAi) allScores.push(s.latestAi.score);
    if (s.latestAvailability) allScores.push(s.latestAvailability.score);
    if (s.latestSecurity) allScores.push(s.latestSecurity.score);
  }
  const avgScore = allScores.length > 0
    ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10
    : null;

  // ─── Site CRUD ───────────────────────────────────────────────────────────

  const refreshPage = useCallback(() => {
    router.refresh();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const method = editingSiteId ? "PUT" : "POST";
      const url = editingSiteId ? `/api/sites/${editingSiteId}` : "/api/sites";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error || t.sites.saveError);
        return;
      }
      setShowForm(false);
      setEditingSiteId(null);
      setFormData({ name: "", url: "", frequency: "daily" });
      refreshPage();
    } catch {
      setFormError(t.common.connectionError);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(siteId: string) {
    if (!confirm(t.sites.confirmDelete)) return;
    await fetch(`/api/sites/${siteId}`, { method: "DELETE" });
    setSites((prev) => prev.filter((s) => s.id !== siteId));
    refreshPage();
  }

  function startEdit(site: SiteSummary) {
    setEditingSiteId(site.id);
    setFormData({ name: site.name, url: site.url, frequency: site.frequency });
    setShowForm(true);
    setFormError(null);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingSiteId(null);
    setFormData({ name: "", url: "", frequency: "daily" });
    setFormError(null);
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-luxe-fg">
            {t.dashboard.title}
          </h1>
          <p className="text-sm text-luxe-fg-muted mt-1">
            {t.dashboard.overviewSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!showForm && (
            <button
              onClick={() => {
                setShowForm(true);
                setEditingSiteId(null);
                setFormData({ name: "", url: "", frequency: "daily" });
                setFormError(null);
              }}
              className="rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold px-5 py-2.5 text-sm font-medium hover:bg-luxe-gold/20 transition-colors"
            >
              {t.sites.addSiteButton}
            </button>
          )}
        </div>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe p-6 space-y-4"
        >
          <h2 className="font-display text-lg font-semibold text-luxe-fg">
            {editingSiteId ? t.sites.editSite : t.sites.addSiteForm}
          </h2>

          {formError && (
            <p className="text-sm text-luxe-score-low">{formError}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-luxe-fg-muted mb-1.5">
                {t.sites.siteName}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t.sites.siteNamePlaceholder}
                required
                className="w-full rounded-lg border border-luxe-border bg-luxe-bg px-4 py-2.5 text-sm text-luxe-fg placeholder-luxe-fg-muted/70 focus:outline-none focus:ring-1 focus:ring-luxe-border-focus"
              />
            </div>
            <div>
              <label className="block text-xs text-luxe-fg-muted mb-1.5">
                {t.sites.url}
              </label>
              <input
                type="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder={t.sites.urlPlaceholder}
                required
                className="w-full rounded-lg border border-luxe-border bg-luxe-bg px-4 py-2.5 text-sm text-luxe-fg placeholder-luxe-fg-muted/70 focus:outline-none focus:ring-1 focus:ring-luxe-border-focus"
              />
            </div>
            <div>
              <label className="block text-xs text-luxe-fg-muted mb-1.5">
                {t.sites.analysisFrequency}
              </label>
              <select
                value={formData.frequency}
                onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                className="w-full rounded-lg border border-luxe-border bg-luxe-bg px-4 py-2.5 text-sm text-luxe-fg focus:outline-none focus:ring-1 focus:ring-luxe-border-focus"
              >
                <option value="6h">{t.sites.frequencyOptions["6h"]}</option>
                <option value="daily">{t.sites.frequencyOptions.daily}</option>
                <option value="weekly">{t.sites.frequencyOptions.weekly}</option>
                <option value="monthly">{t.sites.frequencyOptions.monthly}</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold px-6 py-2.5 text-sm font-medium hover:bg-luxe-gold/20 disabled:opacity-50 transition-colors"
            >
              {saving ? t.sites.savingButton : editingSiteId ? t.common.edit : t.common.add}
            </button>
            <button
              type="button"
              onClick={cancelForm}
              className="rounded-lg border border-luxe-border text-luxe-fg-muted px-6 py-2.5 text-sm hover:bg-luxe-bg-muted transition-colors"
            >
              {t.common.cancel}
            </button>
          </div>
        </form>
      )}

      {/* Global stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label={t.dashboard.registeredSites} value={String(sites.length)} />
        <StatCard label={t.dashboard.averageScore} value={avgScore !== null ? `${avgScore}/10` : "\u2014"} />
        <StatCard
          label={t.dashboard.availabilityScore}
          value={(() => {
            const scores = sites.filter(s => s.latestAvailability).map(s => s.latestAvailability!.score);
            return scores.length ? `${(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10)}/10` : "\u2014";
          })()}
        />
        <StatCard
          label={t.dashboard.securityScore}
          value={(() => {
            const scores = sites.filter(s => s.latestSecurity).map(s => s.latestSecurity!.score);
            return scores.length ? `${(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10)}/10` : "\u2014";
          })()}
        />
      </div>

      {/* Empty state */}
      {sites.length === 0 && !showForm && (
        <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe p-12 text-center">
          <div className="inline-flex items-center justify-center size-16 rounded-2xl bg-luxe-gold/10 border border-luxe-gold/20 mb-4">
            <svg className="size-8 text-luxe-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-semibold text-luxe-fg mb-2">{t.dashboard.noSitesTitle}</h3>
          <p className="text-sm text-luxe-fg-muted mb-6 max-w-md mx-auto">{t.dashboard.noSitesDescription}</p>
          <button
            onClick={() => {
              setShowForm(true);
              setEditingSiteId(null);
              setFormData({ name: "", url: "", frequency: "daily" });
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold px-6 py-3 text-sm font-medium hover:bg-luxe-gold/20 transition-colors"
          >
            {t.dashboard.addFirstSite}
          </button>
        </div>
      )}

      {/* Site cards grid */}
      {sites.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {sites.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              dateLocale={dateLocale}
              onEdit={() => startEdit(site)}
              onDelete={() => handleDelete(site.id)}
            />
          ))}
        </div>
      )}

      {/* Score history chart */}
      {scoreHistory.length > 0 && siteNames.length > 0 && (
        <section className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
          <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50">
            <h2 className="font-display text-lg font-semibold text-luxe-fg">
              {t.dashboard.scoreHistory}
            </h2>
          </div>
          <div className="p-6">
            <ScoreHistoryChart data={scoreHistory} siteNames={siteNames} />
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Site Card ───────────────────────────────────────────────────────────────

function SiteCard({
  site,
  dateLocale,
  onEdit,
  onDelete,
}: {
  site: DashboardContentProps["sites"][number];
  dateLocale: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();

  const overallScores = [site.latestAi?.score, site.latestAvailability?.score, site.latestSecurity?.score].filter((s): s is number => s != null);
  const overallAvg = overallScores.length > 0
    ? Math.round((overallScores.reduce((a, b) => a + b, 0) / overallScores.length) * 10) / 10
    : null;

  return (
    <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden hover:border-luxe-border-focus transition-colors">
      {/* Site header */}
      <div className="px-5 py-4 border-b border-luxe-border bg-luxe-bg-muted/30 flex items-center justify-between">
        <div className="min-w-0 flex items-center gap-3">
          {overallAvg !== null && <ScoreRing score={overallAvg} />}
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-luxe-fg truncate">{site.name}</h3>
            <p className="text-xs text-luxe-fg-muted truncate mt-0.5">{site.url}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-3">
          {!site.isActive && (
            <span className="text-[10px] text-luxe-fg-muted border border-luxe-border rounded-full px-2 py-0.5">
              {t.sites.inactive}
            </span>
          )}
          <button
            onClick={onEdit}
            className="rounded-lg border border-luxe-border text-luxe-fg-muted px-2.5 py-1.5 text-[10px] hover:bg-luxe-bg-muted transition-colors"
            title={t.common.edit}
          >
            {t.common.edit}
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-luxe-score-low/30 text-luxe-score-low px-2.5 py-1.5 text-[10px] hover:bg-luxe-score-low/10 transition-colors"
            title={t.common.delete}
          >
            {t.common.delete}
          </button>
        </div>
      </div>

      {/* 3-column score grid — each links directly to the history tab */}
      <div className="grid grid-cols-3 divide-x divide-luxe-border">
        {/* AI Accessibility */}
        <Link
          href={`/dashboard/sites/${site.id}?tab=ai`}
          className="px-4 py-4 hover:bg-luxe-bg-muted/30 transition-colors group"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <svg className="size-3.5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            <span className="text-[10px] uppercase tracking-wider text-luxe-fg-muted font-medium">{t.dashboard.aiScore}</span>
          </div>
          {site.latestAi ? (
            <>
              <ScoreBadge score={site.latestAi.score} />
              <p className="text-[10px] text-luxe-fg-muted mt-1.5">
                {formatRelativeDate(site.latestAi.createdAt, dateLocale)}
              </p>
            </>
          ) : (
            <p className="text-xs text-luxe-fg-muted italic">{t.dashboard.notScanned}</p>
          )}
          <p className="text-[10px] text-luxe-gold opacity-0 group-hover:opacity-100 transition-opacity mt-1">
            {t.dashboard.viewDetails} &rarr;
          </p>
        </Link>

        {/* Availability */}
        <Link
          href={`/dashboard/sites/${site.id}?tab=availability`}
          className="px-4 py-4 hover:bg-luxe-bg-muted/30 transition-colors group"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <svg className="size-3.5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            <span className="text-[10px] uppercase tracking-wider text-luxe-fg-muted font-medium">{t.dashboard.availabilityScore}</span>
          </div>
          {site.latestAvailability ? (
            <>
              <ScoreBadge score={site.latestAvailability.score} />
              <div className="flex items-center gap-2 mt-1.5">
                {site.latestAvailability.httpStatus && (
                  <span className={`text-[10px] font-mono ${site.latestAvailability.httpStatus < 400 ? "text-luxe-score-high" : "text-luxe-score-low"}`}>
                    {site.latestAvailability.httpStatus}
                  </span>
                )}
                {site.latestAvailability.pingMs != null && (
                  <span className="text-[10px] text-luxe-fg-muted">{site.latestAvailability.pingMs}ms</span>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-luxe-fg-muted italic">{t.dashboard.notScanned}</p>
          )}
          <p className="text-[10px] text-luxe-gold opacity-0 group-hover:opacity-100 transition-opacity mt-1">
            {t.dashboard.viewDetails} &rarr;
          </p>
        </Link>

        {/* Security */}
        <Link
          href={`/dashboard/sites/${site.id}?tab=security`}
          className="px-4 py-4 hover:bg-luxe-bg-muted/30 transition-colors group"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <svg className="size-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <span className="text-[10px] uppercase tracking-wider text-luxe-fg-muted font-medium">{t.dashboard.securityScore}</span>
          </div>
          {site.latestSecurity ? (
            <>
              <ScoreBadge score={site.latestSecurity.score} />
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                {[
                  { label: "H", score: site.latestSecurity.headersScore },
                  { label: "S", score: site.latestSecurity.sslScore },
                  { label: "C", score: site.latestSecurity.cookiesScore },
                ].map(({ label, score }) => (
                  <span key={label} className={`text-[9px] font-mono px-1 rounded ${scoreColor(score)}`}>
                    {label}:{score}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-luxe-fg-muted italic">{t.dashboard.notScanned}</p>
          )}
          <p className="text-[10px] text-luxe-gold opacity-0 group-hover:opacity-100 transition-opacity mt-1">
            {t.dashboard.viewDetails} &rarr;
          </p>
        </Link>
      </div>
    </div>
  );
}

// ─── Score Ring (circular gauge) ─────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = score >= 7 ? "#34d399" : score >= 4 ? "#fbbf24" : "#f87171";

  return (
    <div className="relative size-12 shrink-0">
      <svg className="size-12 -rotate-90" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-luxe-bg-muted" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset} className="transition-all duration-500" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold text-luxe-fg">{score}</span>
      </div>
    </div>
  );
}

// ─── Shared Components ───────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-luxe-bg-elevated border border-luxe-border p-4">
      <p className="text-[10px] text-luxe-fg-muted uppercase tracking-wider">
        {label}
      </p>
      <p className="font-display text-xl font-semibold text-luxe-fg mt-1">
        {value}
      </p>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 7
      ? "text-luxe-score-high"
      : score >= 4
      ? "text-luxe-score-mid"
      : "text-luxe-score-low";

  return (
    <span className={`font-display text-xl font-bold ${color}`}>
      {score}<span className="text-sm font-normal text-luxe-fg-muted">/10</span>
    </span>
  );
}

function scoreColor(score: number): string {
  if (score >= 7) return "text-luxe-score-high bg-luxe-score-high/10";
  if (score >= 4) return "text-luxe-score-mid bg-luxe-score-mid/10";
  return "text-luxe-score-low bg-luxe-score-low/10";
}

function formatRelativeDate(iso: string, dateLocale: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return dateLocale.startsWith("fr") ? "il y a un instant" : dateLocale.startsWith("es") ? "hace un momento" : dateLocale.startsWith("de") ? "gerade eben" : "just now";
  if (diffMins < 60) return dateLocale.startsWith("fr") ? `il y a ${diffMins}min` : dateLocale.startsWith("es") ? `hace ${diffMins}min` : dateLocale.startsWith("de") ? `vor ${diffMins}min` : `${diffMins}min ago`;
  if (diffHours < 24) return dateLocale.startsWith("fr") ? `il y a ${diffHours}h` : dateLocale.startsWith("es") ? `hace ${diffHours}h` : dateLocale.startsWith("de") ? `vor ${diffHours}h` : `${diffHours}h ago`;
  if (diffDays < 7) return dateLocale.startsWith("fr") ? `il y a ${diffDays}j` : dateLocale.startsWith("es") ? `hace ${diffDays}d` : dateLocale.startsWith("de") ? `vor ${diffDays}T` : `${diffDays}d ago`;
  return date.toLocaleDateString(dateLocale, { day: "numeric", month: "short" });
}
