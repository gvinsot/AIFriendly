"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Improvement } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SiteInfo {
  id: string;
  name: string;
  url: string;
  frequency: string;
  isActive: boolean;
}

interface AnalysisEntry {
  id: string;
  score: number;
  maxScore: number;
  createdAt: string;
}

interface AnalysisDetail {
  id: string;
  score: number;
  maxScore: number;
  createdAt: string;
  details: {
    improvements: Improvement[];
    aiPreviewYaml?: string;
    botAccess?: Record<string, unknown>;
  };
}

interface AvailabilityEntry {
  id: string;
  score: number;
  httpStatus: number | null;
  pingMs: number | null;
  loadTimeMs: number | null;
  createdAt: string;
}

interface AvailabilityDetail {
  id: string;
  score: number;
  httpStatus: number | null;
  pingMs: number | null;
  ttfbMs: number | null;
  loadTimeMs: number | null;
  responseSize: number | null;
  sslValid: boolean | null;
  sslExpiry: string | null;
  createdAt: string;
  details: {
    checks: { id: string; name: string; value: string; status: string; deduction: number }[];
    timestamp: string;
  };
}

interface SecurityEntry {
  id: string;
  score: number;
  headersScore: number;
  sslScore: number;
  cookiesScore: number;
  infoLeakScore: number;
  injectionScore: number;
  createdAt: string;
}

interface SecurityDetail {
  id: string;
  score: number;
  headersScore: number;
  sslScore: number;
  cookiesScore: number;
  infoLeakScore: number;
  injectionScore: number;
  createdAt: string;
  details: {
    tests: { id: string; name: string; category: string; status: string; severity: string; value: string; recommendation?: string; deduction: number }[];
    recommendations: { severity: string; text: string }[];
    timestamp: string;
  };
}

type TabId = "ai" | "availability" | "security";

// ─── Score Badge ────────────────────────────────────────────────────────────

function ScoreBadge({ score, max = 10, size = "md" }: { score: number; max?: number; size?: "sm" | "md" | "lg" }) {
  const color =
    score >= 7 ? "text-luxe-score-high bg-luxe-score-high/10 border-luxe-score-high/20"
    : score >= 4 ? "text-luxe-score-mid bg-luxe-score-mid/10 border-luxe-score-mid/20"
    : "text-luxe-score-low bg-luxe-score-low/10 border-luxe-score-low/20";
  const sizeClass = size === "lg" ? "px-4 py-2 text-lg" : size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <span className={`inline-flex items-center rounded-full font-semibold border ${color} ${sizeClass}`}>
      {score}/{max}
    </span>
  );
}

// ─── Score Bar Chart ────────────────────────────────────────────────────────

function ScoreChart({ entries, onClickEntry, title }: { entries: { id: string; score: number; createdAt: string }[]; onClickEntry?: (id: string) => void; title: string }) {
  const { locale } = useI18n();
  const dateLocale = locale === "fr" ? "fr-FR" : locale === "es" ? "es-ES" : locale === "de" ? "de-DE" : "en-US";

  if (entries.length === 0) return null;
  const display = entries.slice().reverse().slice(-30);
  return (
    <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
      <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50">
        <h2 className="font-display text-lg font-semibold text-luxe-fg">{title}</h2>
      </div>
      <div className="p-6">
        <div className="flex items-end gap-1 h-32">
          {display.map((a) => {
            const pct = (a.score / 10) * 100;
            const color = a.score >= 7 ? "bg-luxe-score-high" : a.score >= 4 ? "bg-luxe-score-mid" : "bg-luxe-score-low";
            return (
              <div key={a.id} className="flex-1 min-w-[6px] max-w-[20px] group relative cursor-pointer"
                onClick={() => onClickEntry?.(a.id)}>
                <div className={`${color} rounded-t opacity-70 group-hover:opacity-100 transition-opacity`} style={{ height: `${pct}%` }} />
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-luxe-bg-elevated border border-luxe-border rounded px-2 py-1 text-xs text-luxe-fg whitespace-nowrap shadow-luxe z-10">
                  {a.score}/10 — {new Date(a.createdAt).toLocaleDateString(dateLocale, { day: "numeric", month: "short" })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Line Chart (SVG) ────────────────────────────────────────────────────────

function LineChart({
  title,
  series,
  yMax: yMaxProp,
  ySteps = 5,
  formatY = (v: number) => `${v}`,
  onClickPoint,
}: {
  title: string;
  series: { label: string; color: string; data: { id: string; value: number; date: string }[] }[];
  yMax?: number;
  ySteps?: number;
  formatY?: (v: number) => string;
  onClickPoint?: (id: string) => void;
}) {
  const { locale } = useI18n();
  const dateLocale = locale === "fr" ? "fr-FR" : locale === "es" ? "es-ES" : locale === "de" ? "de-DE" : "en-US";
  const [hovered, setHovered] = useState<{ si: number; pi: number } | null>(null);

  const allValues = series.flatMap(s => s.data.map(d => d.value));
  if (allValues.length === 0) return null;

  const yMax = yMaxProp ?? Math.max(Math.ceil(Math.max(...allValues) * 1.1), 1);
  const pad = { top: 12, right: 20, bottom: 28, left: 45 };
  const cw = 600, ch = 150;
  const w = cw + pad.left + pad.right, h = ch + pad.top + pad.bottom;

  const plotSeries = series.map(s => ({
    ...s,
    data: s.data.slice().reverse().slice(-30),
  }));

  return (
    <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
      <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-luxe-fg">{title}</h2>
        <div className="flex flex-wrap gap-3">
          {series.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-luxe-fg-muted">
              <span className="inline-block w-3 h-[3px] rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 sm:p-6">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {Array.from({ length: ySteps + 1 }, (_, i) => {
            const val = (yMax / ySteps) * i;
            const y = pad.top + ch - (val / yMax) * ch;
            return (
              <g key={i}>
                <line x1={pad.left} y1={y} x2={w - pad.right} y2={y}
                  stroke="#374151" strokeWidth="0.5" strokeDasharray={i === 0 ? "0" : "3,3"} opacity="0.4" />
                <text x={pad.left - 8} y={y + 3} textAnchor="end" fontSize="9" fill="#9CA3AF">
                  {formatY(val)}
                </text>
              </g>
            );
          })}

          {plotSeries.map((s, si) => {
            if (s.data.length === 0) return null;
            const pts = s.data.map((d, i) => ({
              x: pad.left + (s.data.length === 1 ? cw / 2 : (i / (s.data.length - 1)) * cw),
              y: pad.top + ch - (Math.min(d.value, yMax) / yMax) * ch,
              ...d,
            }));
            const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
            const area = `${line} L${pts[pts.length - 1].x},${pad.top + ch} L${pts[0].x},${pad.top + ch} Z`;
            return (
              <g key={si}>
                <path d={area} fill={s.color} opacity="0.06" />
                <path d={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
                {pts.map((p, pi) => (
                  <g key={pi}>
                    <circle cx={p.x} cy={p.y} r={hovered?.si === si && hovered?.pi === pi ? 5 : 2.5}
                      fill={s.color} opacity={hovered?.si === si && hovered?.pi === pi ? 1 : 0.7}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setHovered({ si, pi })}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => onClickPoint?.(p.id)} />
                    {hovered?.si === si && hovered?.pi === pi && (
                      <g>
                        <rect x={p.x - 55} y={p.y - 30} width="110" height="20" rx="4"
                          fill="#1F2937" stroke="#374151" strokeWidth="0.5" />
                        <text x={p.x} y={p.y - 16} textAnchor="middle" fontSize="9" fill={s.color} fontWeight="600">
                          {formatY(p.value)} — {new Date(p.date).toLocaleDateString(dateLocale, { day: "numeric", month: "short" })}
                        </text>
                      </g>
                    )}
                  </g>
                ))}
              </g>
            );
          })}

          {plotSeries[0]?.data.length > 0 && (() => {
            const d = plotSeries[0].data;
            const idxs = d.length <= 5 ? d.map((_, i) => i) :
              d.length <= 10 ? [0, Math.floor(d.length / 3), Math.floor(2 * d.length / 3), d.length - 1] :
              [0, Math.floor(d.length / 4), Math.floor(d.length / 2), Math.floor(3 * d.length / 4), d.length - 1];
            return idxs.map(i => {
              const x = pad.left + (d.length === 1 ? cw / 2 : (i / (d.length - 1)) * cw);
              return (
                <text key={i} x={x} y={h - 5} textAnchor="middle" fontSize="8" fill="#9CA3AF">
                  {new Date(d[i].date).toLocaleDateString(dateLocale, { day: "numeric", month: "short" })}
                </text>
              );
            });
          })()}
        </svg>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function SiteDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const siteId = params.id as string;
  const { t, locale } = useI18n();

  const dateLocale = locale === "fr" ? "fr-FR" : locale === "es" ? "es-ES" : locale === "de" ? "de-DE" : "en-US";

  const tabParam = searchParams.get("tab");
  const initialTab: TabId = tabParam === "ai" || tabParam === "availability" || tabParam === "security" ? tabParam : "ai";

  const [site, setSite] = useState<SiteInfo | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [loading, setLoading] = useState(true);

  // AI state
  const [analyses, setAnalyses] = useState<AnalysisEntry[]>([]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisDetail | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Availability state
  const [availChecks, setAvailChecks] = useState<AvailabilityEntry[]>([]);
  const [selectedCheck, setSelectedCheck] = useState<AvailabilityDetail | null>(null);
  const [checking, setChecking] = useState(false);

  // Security state
  const [securityScans, setSecurityScans] = useState<SecurityEntry[]>([]);
  const [selectedScan, setSelectedScan] = useState<SecurityDetail | null>(null);
  const [scanning, setScanning] = useState(false);

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const TABS: { id: TabId; label: string }[] = [
    { id: "ai", label: t.siteDetail.tabs.ai },
    { id: "availability", label: t.siteDetail.tabs.availability },
    { id: "security", label: t.siteDetail.tabs.security },
  ];

  const fetchData = useCallback(async () => {
    try {
      const [siteRes, historyRes, availRes, secRes] = await Promise.all([
        fetch(`/api/sites/${siteId}`),
        fetch(`/api/sites/${siteId}/history`),
        fetch(`/api/sites/${siteId}/availability`),
        fetch(`/api/sites/${siteId}/security`),
      ]);
      if (siteRes.ok) setSite(await siteRes.json());
      if (historyRes.ok) setAnalyses(await historyRes.json());
      if (availRes.ok) setAvailChecks(await availRes.json());
      if (secRes.ok) setSecurityScans(await secRes.json());
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Actions ────────────────────────────────────────────────────────────

  async function handleAnalyzeNow() {
    setAnalyzing(true); setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/analyze`, { method: "POST" });
      if (!res.ok) { const d = await res.json(); setError(d.error || t.common.error); return; }
      fetchData();
    } catch { setError(t.common.connectionError); } finally { setAnalyzing(false); }
  }

  async function handleCheckNow() {
    setChecking(true); setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/availability/check`, { method: "POST" });
      if (!res.ok) { const d = await res.json(); setError(d.error || t.common.error); return; }
      fetchData();
    } catch { setError(t.common.connectionError); } finally { setChecking(false); }
  }

  async function handleScanNow() {
    setScanning(true); setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/security/scan`, { method: "POST" });
      if (!res.ok) { const d = await res.json(); setError(d.error || t.common.error); return; }
      fetchData();
    } catch { setError(t.common.connectionError); } finally { setScanning(false); }
  }

  // ─── Detail loaders ─────────────────────────────────────────────────────

  async function viewAnalysisDetail(id: string) {
    if (selectedAnalysis?.id === id) { setSelectedAnalysis(null); return; }
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/history/${id}`);
      if (res.ok) setSelectedAnalysis(await res.json());
    } finally { setLoadingDetail(false); }
  }

  async function viewCheckDetail(id: string) {
    if (selectedCheck?.id === id) { setSelectedCheck(null); return; }
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/availability/${id}`);
      if (res.ok) setSelectedCheck(await res.json());
    } finally { setLoadingDetail(false); }
  }

  async function viewScanDetail(id: string) {
    if (selectedScan?.id === id) { setSelectedScan(null); return; }
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/security/${id}`);
      if (res.ok) setSelectedScan(await res.json());
    } finally { setLoadingDetail(false); }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="size-6 rounded-full border-2 border-luxe-gold border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!site) {
    return (
      <div className="text-center py-20">
        <p className="text-luxe-fg-muted">{t.siteDetail.siteNotFound}</p>
        <Link href="/dashboard" className="text-sm text-luxe-gold hover:underline mt-2 inline-block">&larr; {t.dashboard.nav.dashboard}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-xs text-luxe-fg-muted hover:text-luxe-gold transition-colors">&larr; {t.dashboard.nav.dashboard}</Link>
          <h1 className="font-display text-2xl font-semibold text-luxe-fg mt-1">{site.name}</h1>
          <p className="text-sm text-luxe-fg-muted mt-0.5">{site.url}</p>
          <p className="text-xs text-luxe-fg-muted mt-1">{t.siteDetail.analysisLabel} {t.common.frequency[site.frequency as keyof typeof t.common.frequency]?.toLowerCase() || site.frequency}</p>
        </div>
      </div>

      {error && <p className="text-sm text-luxe-score-low">{error}</p>}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-luxe-bg-muted/50 border border-luxe-border p-1">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-luxe-bg-elevated text-luxe-fg shadow-sm border border-luxe-border"
                : "text-luxe-fg-muted hover:text-luxe-fg"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "ai" && (
        <AITab
          analyses={analyses} selectedAnalysis={selectedAnalysis}
          analyzing={analyzing} loadingDetail={loadingDetail}
          onAnalyze={handleAnalyzeNow} onViewDetail={viewAnalysisDetail}
          dateLocale={dateLocale}
        />
      )}
      {activeTab === "availability" && (
        <AvailabilityTab
          checks={availChecks} selectedCheck={selectedCheck}
          checking={checking} loadingDetail={loadingDetail}
          onCheck={handleCheckNow} onViewDetail={viewCheckDetail}
          dateLocale={dateLocale}
        />
      )}
      {activeTab === "security" && (
        <SecurityTab
          scans={securityScans} selectedScan={selectedScan}
          scanning={scanning} loadingDetail={loadingDetail}
          onScan={handleScanNow} onViewDetail={viewScanDetail}
          dateLocale={dateLocale}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: AI Analysis
// ═══════════════════════════════════════════════════════════════════════════

function AITab({ analyses, selectedAnalysis, analyzing, loadingDetail, onAnalyze, onViewDetail, dateLocale }: {
  analyses: AnalysisEntry[]; selectedAnalysis: AnalysisDetail | null;
  analyzing: boolean; loadingDetail: boolean;
  onAnalyze: () => void; onViewDetail: (id: string) => void;
  dateLocale: string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-luxe-fg">{t.siteDetail.ai.title}</h2>
        <ActionButton loading={analyzing} onClick={onAnalyze} label={t.siteDetail.ai.analyzeButton} loadingLabel={t.siteDetail.ai.analyzingButton} />
      </div>

      <ScoreChart entries={analyses} onClickEntry={onViewDetail} title={t.siteDetail.ai.scoreEvolution} />

      <HistoryList
        items={analyses}
        selectedId={selectedAnalysis?.id || null}
        onViewDetail={onViewDetail}
        title={t.siteDetail.ai.analysisHistory}
        hint={t.siteDetail.ai.analysisHistoryHint}
        emptyText={t.siteDetail.ai.noAnalysis}
        dateLocale={dateLocale}
        renderDetail={() => selectedAnalysis && (
          <div className="border-t border-luxe-border bg-luxe-bg-muted/20 px-6 py-5 space-y-4">
            {loadingDetail ? <Spinner /> : (
              <>
                {selectedAnalysis.details.improvements?.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-medium text-luxe-fg mb-3">{t.siteDetail.ai.suggestedImprovements}</h4>
                    <ul className="space-y-2">
                      {selectedAnalysis.details.improvements.map((imp: Improvement, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <SeverityBadge severity={imp.severity} />
                          <div>
                            <p className="text-luxe-fg">{imp.title}</p>
                            <p className="text-xs text-luxe-fg-muted mt-0.5">{imp.description}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-luxe-score-high">{t.siteDetail.ai.perfectScore}</p>
                )}
                {selectedAnalysis.details.aiPreviewYaml && (
                  <div>
                    <h4 className="text-sm font-medium text-luxe-fg mb-2">{t.siteDetail.ai.aiPreview}</h4>
                    <pre className="text-xs font-mono text-luxe-fg-muted bg-luxe-bg rounded-lg border border-luxe-border p-4 overflow-auto max-h-60 preview-scroll">
                      {selectedAnalysis.details.aiPreviewYaml}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: Availability
// ═══════════════════════════════════════════════════════════════════════════

function AvailabilityTab({ checks, selectedCheck, checking, loadingDetail, onCheck, onViewDetail, dateLocale }: {
  checks: AvailabilityEntry[]; selectedCheck: AvailabilityDetail | null;
  checking: boolean; loadingDetail: boolean;
  onCheck: () => void; onViewDetail: (id: string) => void;
  dateLocale: string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-luxe-fg">{t.siteDetail.availability.title}</h2>
        <ActionButton loading={checking} onClick={onCheck} label={t.siteDetail.availability.checkButton} loadingLabel={t.siteDetail.availability.checkingButton} />
      </div>

      {/* Quick stats */}
      {checks.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat label={t.siteDetail.availability.currentScore} value={<ScoreBadge score={checks[0].score} size="sm" />} />
          <MiniStat label={t.siteDetail.availability.http} value={checks[0].httpStatus ? `${checks[0].httpStatus}` : "—"} />
          <MiniStat label={t.siteDetail.availability.ping} value={checks[0].pingMs !== null ? `${checks[0].pingMs}ms` : "—"} />
          <MiniStat label={t.siteDetail.availability.loadTime} value={checks[0].loadTimeMs !== null ? `${(checks[0].loadTimeMs / 1000).toFixed(1)}s` : "—"} />
        </div>
      )}

      <LineChart
        title={t.siteDetail.availability.scoreTrend}
        yMax={10}
        series={[
          { label: t.common.score, color: "#22C55E", data: checks.map(c => ({ id: c.id, value: c.score, date: c.createdAt })) },
        ]}
        onClickPoint={onViewDetail}
      />

      {checks.some(c => c.pingMs !== null || c.loadTimeMs !== null) && (
        <LineChart
          title={t.siteDetail.availability.responseTime}
          formatY={(v) => `${Math.round(v)}ms`}
          series={[
            { label: t.siteDetail.availability.ping, color: "#60A5FA", data: checks.filter(c => c.pingMs !== null).map(c => ({ id: c.id, value: c.pingMs!, date: c.createdAt })) },
            { label: t.siteDetail.availability.loadTime, color: "#F59E0B", data: checks.filter(c => c.loadTimeMs !== null).map(c => ({ id: c.id, value: c.loadTimeMs!, date: c.createdAt })) },
          ]}
          onClickPoint={onViewDetail}
        />
      )}

      <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
        <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50">
          <h3 className="font-display text-lg font-semibold text-luxe-fg">{t.siteDetail.availability.checkHistory}</h3>
          <p className="text-xs text-luxe-fg-muted mt-0.5">{t.siteDetail.availability.checkHistoryHint}</p>
        </div>

        {checks.length === 0 ? (
          <div className="px-6 py-12 text-center text-luxe-fg-muted">{t.siteDetail.availability.noCheck} {t.siteDetail.availability.noCheckHint}</div>
        ) : (
          <ul className="divide-y divide-luxe-border">
            {checks.slice(0, 50).map((c) => (
              <li key={c.id}>
                <button onClick={() => onViewDetail(c.id)}
                  className={`w-full text-left px-6 py-3 flex items-center justify-between hover:bg-luxe-bg-muted/30 transition-colors ${selectedCheck?.id === c.id ? "bg-luxe-bg-muted/40" : ""}`}>
                  <div className="flex items-center gap-4">
                    <ScoreBadge score={c.score} size="sm" />
                    <div>
                      <p className="text-sm text-luxe-fg">
                        {new Date(c.createdAt).toLocaleDateString(dateLocale, { day: "numeric", month: "short" })}{" "}
                        {new Date(c.createdAt).toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </p>
                      <p className="text-xs text-luxe-fg-muted">
                        HTTP {c.httpStatus || "?"} — Ping {c.pingMs !== null ? `${c.pingMs}ms` : "?"} — Load {c.loadTimeMs !== null ? `${(c.loadTimeMs / 1000).toFixed(1)}s` : "?"}
                      </p>
                    </div>
                  </div>
                </button>

                {selectedCheck?.id === c.id && (
                  <div className="border-t border-luxe-border bg-luxe-bg-muted/20 px-6 py-5 space-y-4">
                    {loadingDetail ? <Spinner /> : (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <DetailCard label={t.siteDetail.availability.httpStatus} value={selectedCheck.httpStatus ? `${selectedCheck.httpStatus}` : "—"} />
                          <DetailCard label={t.siteDetail.availability.ping} value={selectedCheck.pingMs !== null ? `${selectedCheck.pingMs}ms` : "—"} />
                          <DetailCard label={t.siteDetail.availability.ttfb} value={selectedCheck.ttfbMs !== null ? `${selectedCheck.ttfbMs}ms` : "—"} />
                          <DetailCard label={t.siteDetail.availability.loadTime} value={selectedCheck.loadTimeMs !== null ? `${(selectedCheck.loadTimeMs / 1000).toFixed(2)}s` : "—"} />
                          <DetailCard label={t.siteDetail.availability.size} value={selectedCheck.responseSize !== null ? `${(selectedCheck.responseSize / 1024).toFixed(1)} Ko` : "—"} />
                          <DetailCard label={t.siteDetail.availability.ssl} value={selectedCheck.sslValid === true ? t.siteDetail.availability.sslValid : selectedCheck.sslValid === false ? t.siteDetail.availability.sslInvalid : "—"} />
                        </div>
                        {selectedCheck.details.checks.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium text-luxe-fg mb-3">{t.siteDetail.availability.checkDetails}</h4>
                            <ul className="space-y-1.5">
                              {selectedCheck.details.checks.map((ck, i) => (
                                <li key={i} className="flex items-center gap-2 text-sm">
                                  <StatusDot status={ck.status} />
                                  <span className="text-luxe-fg-muted">{ck.name}:</span>
                                  <span className="text-luxe-fg">{ck.value}</span>
                                  {ck.deduction > 0 && <span className="text-xs text-luxe-score-low">(-{ck.deduction})</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: Security
// ═══════════════════════════════════════════════════════════════════════════

function SecurityTab({ scans, selectedScan, scanning, loadingDetail, onScan, onViewDetail, dateLocale }: {
  scans: SecurityEntry[]; selectedScan: SecurityDetail | null;
  scanning: boolean; loadingDetail: boolean;
  onScan: () => void; onViewDetail: (id: string) => void;
  dateLocale: string;
}) {
  const { t } = useI18n();

  const catLabel: Record<string, string> = {
    headers: t.siteDetail.security.catHeaders,
    ssl: t.siteDetail.security.catSsl,
    cookies: t.siteDetail.security.catCookies,
    info_leak: t.siteDetail.security.catInfoLeak,
    injection: t.siteDetail.security.catInjection,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-luxe-fg">{t.siteDetail.security.title}</h2>
        <ActionButton loading={scanning} onClick={onScan} label={t.siteDetail.security.scanButton} loadingLabel={t.siteDetail.security.scanningButton} />
      </div>

      {/* Sub-scores */}
      {scans.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <MiniStat label={t.siteDetail.security.global} value={<ScoreBadge score={scans[0].score} size="sm" />} />
          <MiniStat label={t.siteDetail.security.headers} value={<ScoreBadge score={scans[0].headersScore} size="sm" />} />
          <MiniStat label={t.siteDetail.security.sslTls} value={<ScoreBadge score={scans[0].sslScore} size="sm" />} />
          <MiniStat label={t.siteDetail.security.cookies} value={<ScoreBadge score={scans[0].cookiesScore} size="sm" />} />
          <MiniStat label={t.siteDetail.security.infoLeak} value={<ScoreBadge score={scans[0].infoLeakScore} size="sm" />} />
          <MiniStat label={t.siteDetail.security.injection} value={<ScoreBadge score={scans[0].injectionScore} size="sm" />} />
        </div>
      )}

      {scans.length > 0 && (
        <LineChart
          title={t.siteDetail.security.scoreTrend}
          yMax={10}
          series={[
            { label: t.siteDetail.security.global, color: "#F59E0B", data: scans.map(s => ({ id: s.id, value: s.score, date: s.createdAt })) },
            { label: t.siteDetail.security.headers, color: "#60A5FA", data: scans.map(s => ({ id: s.id, value: s.headersScore, date: s.createdAt })) },
            { label: "SSL", color: "#34D399", data: scans.map(s => ({ id: s.id, value: s.sslScore, date: s.createdAt })) },
            { label: t.siteDetail.security.cookies, color: "#A78BFA", data: scans.map(s => ({ id: s.id, value: s.cookiesScore, date: s.createdAt })) },
            { label: t.siteDetail.security.infoLeak, color: "#FB923C", data: scans.map(s => ({ id: s.id, value: s.infoLeakScore, date: s.createdAt })) },
            { label: t.siteDetail.security.injection, color: "#F87171", data: scans.map(s => ({ id: s.id, value: s.injectionScore, date: s.createdAt })) },
          ]}
          onClickPoint={onViewDetail}
        />
      )}

      <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
        <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50">
          <h3 className="font-display text-lg font-semibold text-luxe-fg">{t.siteDetail.security.scanHistory}</h3>
          <p className="text-xs text-luxe-fg-muted mt-0.5">{t.siteDetail.security.scanHistoryHint}</p>
        </div>

        {scans.length === 0 ? (
          <div className="px-6 py-12 text-center text-luxe-fg-muted">{t.siteDetail.security.noScan} {t.siteDetail.security.noScanHint}</div>
        ) : (
          <ul className="divide-y divide-luxe-border">
            {scans.map((s) => (
              <li key={s.id}>
                <button onClick={() => onViewDetail(s.id)}
                  className={`w-full text-left px-6 py-3 flex items-center justify-between hover:bg-luxe-bg-muted/30 transition-colors ${selectedScan?.id === s.id ? "bg-luxe-bg-muted/40" : ""}`}>
                  <div className="flex items-center gap-4">
                    <ScoreBadge score={s.score} size="sm" />
                    <div>
                      <p className="text-sm text-luxe-fg">
                        {new Date(s.createdAt).toLocaleDateString(dateLocale, { weekday: "short", day: "numeric", month: "short" })}{" "}
                        {new Date(s.createdAt).toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <p className="text-xs text-luxe-fg-muted">
                        {t.siteDetail.security.headers} {s.headersScore}/10 — SSL {s.sslScore}/10 — {t.siteDetail.security.cookies} {s.cookiesScore}/10
                      </p>
                    </div>
                  </div>
                </button>

                {selectedScan?.id === s.id && (
                  <div className="border-t border-luxe-border bg-luxe-bg-muted/20 px-6 py-5 space-y-4">
                    {loadingDetail ? <Spinner /> : (
                      <>
                        <div className="grid grid-cols-5 gap-2">
                          <SubScoreBar label={t.siteDetail.security.headers} score={selectedScan.headersScore} />
                          <SubScoreBar label="SSL" score={selectedScan.sslScore} />
                          <SubScoreBar label={t.siteDetail.security.cookies} score={selectedScan.cookiesScore} />
                          <SubScoreBar label={t.siteDetail.security.infoLeak} score={selectedScan.infoLeakScore} />
                          <SubScoreBar label={t.siteDetail.security.injection} score={selectedScan.injectionScore} />
                        </div>

                        {(["headers", "ssl", "cookies", "info_leak", "injection"] as const).map((cat) => {
                          const catTests = selectedScan.details.tests.filter(ct => ct.category === cat);
                          if (catTests.length === 0) return null;
                          return (
                            <div key={cat}>
                              <h4 className="text-sm font-medium text-luxe-fg mb-2">{catLabel[cat] || cat}</h4>
                              <ul className="space-y-1.5">
                                {catTests.map((ct, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm">
                                    <StatusDot status={ct.status} />
                                    <div className="flex-1">
                                      <span className="text-luxe-fg">{ct.name}</span>
                                      <span className="text-luxe-fg-muted ml-2">— {ct.value}</span>
                                      {ct.deduction > 0 && <span className="text-xs text-luxe-score-low ml-1">(-{ct.deduction})</span>}
                                      {ct.recommendation && <p className="text-xs text-luxe-gold mt-0.5">{ct.recommendation}</p>}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}

                        {selectedScan.details.recommendations.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium text-luxe-fg mb-2">{t.siteDetail.security.recommendations}</h4>
                            <ul className="space-y-1">
                              {selectedScan.details.recommendations.map((r, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm">
                                  <SeverityBadge severity={r.severity as "critical" | "warning" | "info"} />
                                  <span className="text-luxe-fg">{r.text}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function ActionButton({ loading, onClick, label, loadingLabel }: { loading: boolean; onClick: () => void; label: string; loadingLabel: string }) {
  return (
    <button onClick={onClick} disabled={loading}
      className="rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold px-5 py-2.5 text-sm font-medium hover:bg-luxe-gold/20 disabled:opacity-50 transition-colors">
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="size-3 rounded-full border-2 border-luxe-gold border-t-transparent animate-spin" />
          {loadingLabel}
        </span>
      ) : label}
    </button>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-4">
      <div className="size-5 rounded-full border-2 border-luxe-gold border-t-transparent animate-spin" />
    </div>
  );
}

function HistoryList({ items, selectedId, onViewDetail, renderDetail, title, hint, emptyText, dateLocale }: {
  items: { id: string; score: number; maxScore?: number; createdAt: string }[];
  selectedId: string | null; onViewDetail: (id: string) => void;
  renderDetail: () => React.ReactNode;
  title: string; hint: string; emptyText: string; dateLocale: string;
}) {
  return (
    <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
      <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50">
        <h3 className="font-display text-lg font-semibold text-luxe-fg">{title}</h3>
        <p className="text-xs text-luxe-fg-muted mt-0.5">{hint}</p>
      </div>
      {items.length === 0 ? (
        <div className="px-6 py-12 text-center text-luxe-fg-muted">{emptyText}</div>
      ) : (
        <ul className="divide-y divide-luxe-border">
          {items.map((a) => (
            <li key={a.id}>
              <button onClick={() => onViewDetail(a.id)}
                className={`w-full text-left px-6 py-4 flex items-center justify-between hover:bg-luxe-bg-muted/30 transition-colors ${selectedId === a.id ? "bg-luxe-bg-muted/40" : ""}`}>
                <div>
                  <p className="text-sm font-medium text-luxe-fg">
                    {new Date(a.createdAt).toLocaleDateString(dateLocale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  </p>
                  <p className="text-xs text-luxe-fg-muted mt-0.5">
                    {new Date(a.createdAt).toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <ScoreBadge score={a.score} max={a.maxScore || 10} />
              </button>
              {selectedId === a.id && renderDetail()}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: "critical" | "warning" | "info" | string }) {
  const { t } = useI18n();
  const color =
    severity === "critical" ? "bg-luxe-score-low/15 text-luxe-score-low border-luxe-score-low/20"
    : severity === "warning" ? "bg-luxe-score-mid/15 text-luxe-score-mid border-luxe-score-mid/20"
    : "bg-luxe-gold/10 text-luxe-gold-muted border-luxe-border";
  const label = t.common.severity[severity as keyof typeof t.common.severity] || severity;
  return (
    <span className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${color}`}>
      {label}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "pass" ? "bg-luxe-score-high" : status === "warning" ? "bg-luxe-score-mid" : "bg-luxe-score-low";
  return <span className={`inline-block size-2 rounded-full ${color} mt-1.5 shrink-0`} />;
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-luxe-bg-elevated border border-luxe-border p-3 text-center">
      <p className="text-[10px] text-luxe-fg-muted uppercase tracking-wider mb-1">{label}</p>
      <div className="font-medium text-luxe-fg">{value}</div>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-luxe-bg border border-luxe-border p-3">
      <p className="text-[10px] text-luxe-fg-muted uppercase tracking-wider">{label}</p>
      <p className="text-sm font-medium text-luxe-fg mt-0.5">{value}</p>
    </div>
  );
}

function SubScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 7 ? "bg-luxe-score-high" : score >= 4 ? "bg-luxe-score-mid" : "bg-luxe-score-low";
  const pct = (score / 10) * 100;
  return (
    <div className="text-center">
      <div className="h-16 relative flex items-end justify-center mb-1">
        <div className={`w-6 ${color} rounded-t opacity-80`} style={{ height: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-luxe-fg-muted">{label}</p>
      <p className="text-xs font-medium text-luxe-fg">{score}/10</p>
    </div>
  );
}