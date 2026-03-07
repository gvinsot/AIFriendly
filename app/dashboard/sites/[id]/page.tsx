"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Improvement } from "@/lib/types";

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

const FREQUENCY_LABELS: Record<string, string> = {
  "6h": "Toutes les 6h",
  daily: "Quotidienne",
  weekly: "Hebdomadaire",
  monthly: "Mensuelle",
};

const TABS: { id: TabId; label: string }[] = [
  { id: "ai", label: "Accessibilité IA" },
  { id: "availability", label: "Disponibilité" },
  { id: "security", label: "Sécurité" },
];

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

function ScoreChart({ entries, onClickEntry }: { entries: { id: string; score: number; createdAt: string }[]; onClickEntry?: (id: string) => void }) {
  if (entries.length === 0) return null;
  const display = entries.slice().reverse().slice(-30);
  return (
    <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
      <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50">
        <h2 className="font-display text-lg font-semibold text-luxe-fg">Évolution du score</h2>
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
                  {a.score}/10 — {new Date(a.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function SiteDetailPage() {
  const params = useParams();
  const siteId = params.id as string;

  const [site, setSite] = useState<SiteInfo | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("ai");
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
      if (!res.ok) { const d = await res.json(); setError(d.error || "Erreur."); return; }
      fetchData();
    } catch { setError("Erreur de connexion."); } finally { setAnalyzing(false); }
  }

  async function handleCheckNow() {
    setChecking(true); setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/availability/check`, { method: "POST" });
      if (!res.ok) { const d = await res.json(); setError(d.error || "Erreur."); return; }
      fetchData();
    } catch { setError("Erreur de connexion."); } finally { setChecking(false); }
  }

  async function handleScanNow() {
    setScanning(true); setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/security/scan`, { method: "POST" });
      if (!res.ok) { const d = await res.json(); setError(d.error || "Erreur."); return; }
      fetchData();
    } catch { setError("Erreur de connexion."); } finally { setScanning(false); }
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
        <p className="text-luxe-fg-muted">Site introuvable.</p>
        <Link href="/dashboard/sites" className="text-sm text-luxe-gold hover:underline mt-2 inline-block">&larr; Retour</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link href="/dashboard/sites" className="text-xs text-luxe-fg-muted hover:text-luxe-gold transition-colors">&larr; Mes sites</Link>
          <h1 className="font-display text-2xl font-semibold text-luxe-fg mt-1">{site.name}</h1>
          <p className="text-sm text-luxe-fg-muted mt-0.5">{site.url}</p>
          <p className="text-xs text-luxe-fg-muted mt-1">Analyse {FREQUENCY_LABELS[site.frequency]?.toLowerCase() || site.frequency}</p>
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
        />
      )}
      {activeTab === "availability" && (
        <AvailabilityTab
          checks={availChecks} selectedCheck={selectedCheck}
          checking={checking} loadingDetail={loadingDetail}
          onCheck={handleCheckNow} onViewDetail={viewCheckDetail}
        />
      )}
      {activeTab === "security" && (
        <SecurityTab
          scans={securityScans} selectedScan={selectedScan}
          scanning={scanning} loadingDetail={loadingDetail}
          onScan={handleScanNow} onViewDetail={viewScanDetail}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: AI Analysis
// ═══════════════════════════════════════════════════════════════════════════

function AITab({ analyses, selectedAnalysis, analyzing, loadingDetail, onAnalyze, onViewDetail }: {
  analyses: AnalysisEntry[]; selectedAnalysis: AnalysisDetail | null;
  analyzing: boolean; loadingDetail: boolean;
  onAnalyze: () => void; onViewDetail: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-luxe-fg">Accessibilité IA</h2>
        <ActionButton loading={analyzing} onClick={onAnalyze} label="Analyser" loadingLabel="Analyse…" />
      </div>

      <ScoreChart entries={analyses} onClickEntry={onViewDetail} />

      <HistoryList
        items={analyses}
        selectedId={selectedAnalysis?.id || null}
        onViewDetail={onViewDetail}
        renderDetail={() => selectedAnalysis && (
          <div className="border-t border-luxe-border bg-luxe-bg-muted/20 px-6 py-5 space-y-4">
            {loadingDetail ? <Spinner /> : (
              <>
                {selectedAnalysis.details.improvements?.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-medium text-luxe-fg mb-3">Améliorations suggérées</h4>
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
                  <p className="text-sm text-luxe-score-high">Score parfait !</p>
                )}
                {selectedAnalysis.details.aiPreviewYaml && (
                  <div>
                    <h4 className="text-sm font-medium text-luxe-fg mb-2">Aperçu IA</h4>
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

function AvailabilityTab({ checks, selectedCheck, checking, loadingDetail, onCheck, onViewDetail }: {
  checks: AvailabilityEntry[]; selectedCheck: AvailabilityDetail | null;
  checking: boolean; loadingDetail: boolean;
  onCheck: () => void; onViewDetail: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-luxe-fg">Disponibilité</h2>
        <ActionButton loading={checking} onClick={onCheck} label="Checker" loadingLabel="Check…" />
      </div>

      {/* Quick stats */}
      {checks.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat label="Score actuel" value={<ScoreBadge score={checks[0].score} size="sm" />} />
          <MiniStat label="HTTP" value={checks[0].httpStatus ? `${checks[0].httpStatus}` : "—"} />
          <MiniStat label="Ping" value={checks[0].pingMs !== null ? `${checks[0].pingMs}ms` : "—"} />
          <MiniStat label="Chargement" value={checks[0].loadTimeMs !== null ? `${(checks[0].loadTimeMs / 1000).toFixed(1)}s` : "—"} />
        </div>
      )}

      <ScoreChart entries={checks.map(c => ({ id: c.id, score: c.score, createdAt: c.createdAt }))} onClickEntry={onViewDetail} />

      <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
        <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50">
          <h3 className="font-display text-lg font-semibold text-luxe-fg">Historique des checks</h3>
          <p className="text-xs text-luxe-fg-muted mt-0.5">Check toutes les minutes — cliquez pour les détails</p>
        </div>

        {checks.length === 0 ? (
          <div className="px-6 py-12 text-center text-luxe-fg-muted">Aucun check. Cliquez sur &quot;Checker&quot; pour lancer le premier.</div>
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
                        {new Date(c.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}{" "}
                        {new Date(c.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
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
                          <DetailCard label="Statut HTTP" value={selectedCheck.httpStatus ? `${selectedCheck.httpStatus}` : "—"} />
                          <DetailCard label="Ping" value={selectedCheck.pingMs !== null ? `${selectedCheck.pingMs}ms` : "—"} />
                          <DetailCard label="TTFB" value={selectedCheck.ttfbMs !== null ? `${selectedCheck.ttfbMs}ms` : "—"} />
                          <DetailCard label="Chargement" value={selectedCheck.loadTimeMs !== null ? `${(selectedCheck.loadTimeMs / 1000).toFixed(2)}s` : "—"} />
                          <DetailCard label="Taille" value={selectedCheck.responseSize !== null ? `${(selectedCheck.responseSize / 1024).toFixed(1)} Ko` : "—"} />
                          <DetailCard label="SSL" value={selectedCheck.sslValid === true ? "Valide" : selectedCheck.sslValid === false ? "Invalide" : "—"} />
                        </div>
                        {selectedCheck.details.checks.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium text-luxe-fg mb-3">Détails du check</h4>
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

function SecurityTab({ scans, selectedScan, scanning, loadingDetail, onScan, onViewDetail }: {
  scans: SecurityEntry[]; selectedScan: SecurityDetail | null;
  scanning: boolean; loadingDetail: boolean;
  onScan: () => void; onViewDetail: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-luxe-fg">Sécurité OWASP</h2>
        <ActionButton loading={scanning} onClick={onScan} label="Scanner" loadingLabel="Scan…" />
      </div>

      {/* Sub-scores */}
      {scans.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <MiniStat label="Global" value={<ScoreBadge score={scans[0].score} size="sm" />} />
          <MiniStat label="Headers" value={<ScoreBadge score={scans[0].headersScore} size="sm" />} />
          <MiniStat label="SSL/TLS" value={<ScoreBadge score={scans[0].sslScore} size="sm" />} />
          <MiniStat label="Cookies" value={<ScoreBadge score={scans[0].cookiesScore} size="sm" />} />
          <MiniStat label="Fuites info" value={<ScoreBadge score={scans[0].infoLeakScore} size="sm" />} />
          <MiniStat label="Injection" value={<ScoreBadge score={scans[0].injectionScore} size="sm" />} />
        </div>
      )}

      <ScoreChart entries={scans.map(s => ({ id: s.id, score: s.score, createdAt: s.createdAt }))} onClickEntry={onViewDetail} />

      <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
        <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50">
          <h3 className="font-display text-lg font-semibold text-luxe-fg">Historique des scans</h3>
          <p className="text-xs text-luxe-fg-muted mt-0.5">Scan toutes les heures — cliquez pour les détails</p>
        </div>

        {scans.length === 0 ? (
          <div className="px-6 py-12 text-center text-luxe-fg-muted">Aucun scan. Cliquez sur &quot;Scanner&quot; pour lancer le premier.</div>
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
                        {new Date(s.createdAt).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}{" "}
                        {new Date(s.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <p className="text-xs text-luxe-fg-muted">
                        Headers {s.headersScore}/10 — SSL {s.sslScore}/10 — Cookies {s.cookiesScore}/10
                      </p>
                    </div>
                  </div>
                </button>

                {selectedScan?.id === s.id && (
                  <div className="border-t border-luxe-border bg-luxe-bg-muted/20 px-6 py-5 space-y-4">
                    {loadingDetail ? <Spinner /> : (
                      <>
                        {/* Sub-scores breakdown */}
                        <div className="grid grid-cols-5 gap-2">
                          <SubScoreBar label="Headers" score={selectedScan.headersScore} />
                          <SubScoreBar label="SSL" score={selectedScan.sslScore} />
                          <SubScoreBar label="Cookies" score={selectedScan.cookiesScore} />
                          <SubScoreBar label="Fuites" score={selectedScan.infoLeakScore} />
                          <SubScoreBar label="Injection" score={selectedScan.injectionScore} />
                        </div>

                        {/* Tests by category */}
                        {(["headers", "ssl", "cookies", "info_leak", "injection"] as const).map((cat) => {
                          const catTests = selectedScan.details.tests.filter(t => t.category === cat);
                          if (catTests.length === 0) return null;
                          const catLabel: Record<string, string> = { headers: "Headers de sécurité", ssl: "SSL/TLS", cookies: "Cookies", info_leak: "Fuites d'information", injection: "Injection / XSS" };
                          return (
                            <div key={cat}>
                              <h4 className="text-sm font-medium text-luxe-fg mb-2">{catLabel[cat] || cat}</h4>
                              <ul className="space-y-1.5">
                                {catTests.map((t, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm">
                                    <StatusDot status={t.status} />
                                    <div className="flex-1">
                                      <span className="text-luxe-fg">{t.name}</span>
                                      <span className="text-luxe-fg-muted ml-2">— {t.value}</span>
                                      {t.deduction > 0 && <span className="text-xs text-luxe-score-low ml-1">(-{t.deduction})</span>}
                                      {t.recommendation && <p className="text-xs text-luxe-gold mt-0.5">{t.recommendation}</p>}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}

                        {/* Recommendations */}
                        {selectedScan.details.recommendations.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium text-luxe-fg mb-2">Recommandations</h4>
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

function HistoryList({ items, selectedId, onViewDetail, renderDetail }: {
  items: { id: string; score: number; maxScore?: number; createdAt: string }[];
  selectedId: string | null; onViewDetail: (id: string) => void;
  renderDetail: () => React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
      <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50">
        <h3 className="font-display text-lg font-semibold text-luxe-fg">Historique des analyses</h3>
        <p className="text-xs text-luxe-fg-muted mt-0.5">Cliquez pour voir les détails (conservé 60 jours)</p>
      </div>
      {items.length === 0 ? (
        <div className="px-6 py-12 text-center text-luxe-fg-muted">Aucune analyse.</div>
      ) : (
        <ul className="divide-y divide-luxe-border">
          {items.map((a) => (
            <li key={a.id}>
              <button onClick={() => onViewDetail(a.id)}
                className={`w-full text-left px-6 py-4 flex items-center justify-between hover:bg-luxe-bg-muted/30 transition-colors ${selectedId === a.id ? "bg-luxe-bg-muted/40" : ""}`}>
                <div>
                  <p className="text-sm font-medium text-luxe-fg">
                    {new Date(a.createdAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  </p>
                  <p className="text-xs text-luxe-fg-muted mt-0.5">
                    {new Date(a.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
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
  const color =
    severity === "critical" ? "bg-luxe-score-low/15 text-luxe-score-low border-luxe-score-low/20"
    : severity === "warning" ? "bg-luxe-score-mid/15 text-luxe-score-mid border-luxe-score-mid/20"
    : "bg-luxe-gold/10 text-luxe-gold-muted border-luxe-border";
  const label = severity === "critical" ? "Critique" : severity === "warning" ? "Attention" : "Info";
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
