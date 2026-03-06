"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Improvement } from "@/lib/types";

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

const FREQUENCY_LABELS: Record<string, string> = {
  "6h": "Toutes les 6h",
  daily: "Quotidienne",
  weekly: "Hebdomadaire",
  monthly: "Mensuelle",
};

export default function SiteDetailPage() {
  const params = useParams();
  const siteId = params.id as string;

  const [site, setSite] = useState<SiteInfo | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisEntry[]>([]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [siteRes, historyRes] = await Promise.all([
        fetch(`/api/sites/${siteId}`),
        fetch(`/api/sites/${siteId}/history`),
      ]);
      if (siteRes.ok) setSite(await siteRes.json());
      if (historyRes.ok) setAnalyses(await historyRes.json());
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleAnalyzeNow() {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/analyze`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erreur lors de l'analyse.");
        return;
      }
      fetchData();
    } catch {
      setError("Erreur de connexion.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function viewDetail(analysisId: string) {
    if (selectedAnalysis?.id === analysisId) {
      setSelectedAnalysis(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/history/${analysisId}`);
      if (res.ok) {
        setSelectedAnalysis(await res.json());
      }
    } finally {
      setLoadingDetail(false);
    }
  }

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
        <Link
          href="/dashboard/sites"
          className="text-sm text-luxe-gold hover:underline mt-2 inline-block"
        >
          &larr; Retour à la liste
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/dashboard/sites"
              className="text-xs text-luxe-fg-muted hover:text-luxe-gold transition-colors"
            >
              &larr; Mes sites
            </Link>
          </div>
          <h1 className="font-display text-2xl font-semibold text-luxe-fg">
            {site.name}
          </h1>
          <p className="text-sm text-luxe-fg-muted mt-0.5">{site.url}</p>
          <p className="text-xs text-luxe-fg-muted mt-1">
            Analyse {FREQUENCY_LABELS[site.frequency]?.toLowerCase() || site.frequency}
          </p>
        </div>
        <button
          onClick={handleAnalyzeNow}
          disabled={analyzing}
          className="rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold px-5 py-2.5 text-sm font-medium hover:bg-luxe-gold/20 disabled:opacity-50 transition-colors self-start"
        >
          {analyzing ? (
            <span className="inline-flex items-center gap-2">
              <span className="size-3 rounded-full border-2 border-luxe-gold border-t-transparent animate-spin" />
              Analyse…
            </span>
          ) : (
            "Analyser maintenant"
          )}
        </button>
      </div>

      {error && (
        <p className="text-sm text-luxe-score-low">{error}</p>
      )}

      {/* Score chart (simple bar chart) */}
      {analyses.length > 0 && (
        <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
          <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50">
            <h2 className="font-display text-lg font-semibold text-luxe-fg">
              Évolution du score
            </h2>
          </div>
          <div className="p-6">
            <div className="flex items-end gap-1 h-32">
              {analyses
                .slice()
                .reverse()
                .slice(-30)
                .map((a) => {
                  const pct = (a.score / a.maxScore) * 100;
                  const color =
                    a.score >= 7
                      ? "bg-luxe-score-high"
                      : a.score >= 4
                      ? "bg-luxe-score-mid"
                      : "bg-luxe-score-low";
                  return (
                    <div
                      key={a.id}
                      className="flex-1 min-w-[6px] max-w-[20px] group relative cursor-pointer"
                      onClick={() => viewDetail(a.id)}
                    >
                      <div
                        className={`${color} rounded-t opacity-70 group-hover:opacity-100 transition-opacity`}
                        style={{ height: `${pct}%` }}
                      />
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-luxe-bg-elevated border border-luxe-border rounded px-2 py-1 text-xs text-luxe-fg whitespace-nowrap shadow-luxe z-10">
                        {a.score}/10 —{" "}
                        {new Date(a.createdAt).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* History list */}
      <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
        <div className="px-6 py-4 border-b border-luxe-border bg-luxe-bg-muted/50">
          <h2 className="font-display text-lg font-semibold text-luxe-fg">
            Historique des analyses
          </h2>
          <p className="text-xs text-luxe-fg-muted mt-0.5">
            Cliquez sur une date pour voir les détails (conservé 60 jours)
          </p>
        </div>

        {analyses.length === 0 ? (
          <div className="px-6 py-12 text-center text-luxe-fg-muted">
            Aucune analyse. Cliquez sur &quot;Analyser maintenant&quot; pour lancer la
            première.
          </div>
        ) : (
          <ul className="divide-y divide-luxe-border">
            {analyses.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => viewDetail(a.id)}
                  className={`w-full text-left px-6 py-4 flex items-center justify-between hover:bg-luxe-bg-muted/30 transition-colors ${
                    selectedAnalysis?.id === a.id ? "bg-luxe-bg-muted/40" : ""
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-luxe-fg">
                      {new Date(a.createdAt).toLocaleDateString("fr-FR", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                    <p className="text-xs text-luxe-fg-muted mt-0.5">
                      {new Date(a.createdAt).toLocaleTimeString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold border ${
                      a.score >= 7
                        ? "text-luxe-score-high bg-luxe-score-high/10 border-luxe-score-high/20"
                        : a.score >= 4
                        ? "text-luxe-score-mid bg-luxe-score-mid/10 border-luxe-score-mid/20"
                        : "text-luxe-score-low bg-luxe-score-low/10 border-luxe-score-low/20"
                    }`}
                  >
                    {a.score}/{a.maxScore}
                  </span>
                </button>

                {/* Detail panel */}
                {selectedAnalysis?.id === a.id && (
                  <div className="border-t border-luxe-border bg-luxe-bg-muted/20 px-6 py-5 space-y-4">
                    {loadingDetail ? (
                      <div className="flex justify-center py-4">
                        <div className="size-5 rounded-full border-2 border-luxe-gold border-t-transparent animate-spin" />
                      </div>
                    ) : (
                      <>
                        {selectedAnalysis.details.improvements?.length > 0 ? (
                          <div>
                            <h4 className="text-sm font-medium text-luxe-fg mb-3">
                              Améliorations suggérées
                            </h4>
                            <ul className="space-y-2">
                              {selectedAnalysis.details.improvements.map(
                                (imp: Improvement, i: number) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2 text-sm"
                                  >
                                    <span
                                      className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                                        imp.severity === "critical"
                                          ? "bg-luxe-score-low/15 text-luxe-score-low border-luxe-score-low/20"
                                          : imp.severity === "warning"
                                          ? "bg-luxe-score-mid/15 text-luxe-score-mid border-luxe-score-mid/20"
                                          : "bg-luxe-gold/10 text-luxe-gold-muted border-luxe-border"
                                      }`}
                                    >
                                      {imp.severity === "critical"
                                        ? "Critique"
                                        : imp.severity === "warning"
                                        ? "Attention"
                                        : "Info"}
                                    </span>
                                    <div>
                                      <p className="text-luxe-fg">
                                        {imp.title}
                                      </p>
                                      <p className="text-xs text-luxe-fg-muted mt-0.5">
                                        {imp.description}
                                      </p>
                                    </div>
                                  </li>
                                )
                              )}
                            </ul>
                          </div>
                        ) : (
                          <p className="text-sm text-luxe-score-high">
                            Aucune amélioration nécessaire — score parfait !
                          </p>
                        )}

                        {selectedAnalysis.details.aiPreviewYaml && (
                          <div>
                            <h4 className="text-sm font-medium text-luxe-fg mb-2">
                              Aperçu IA
                            </h4>
                            <pre className="text-xs font-mono text-luxe-fg-muted bg-luxe-bg rounded-lg border border-luxe-border p-4 overflow-auto max-h-60 preview-scroll">
                              {selectedAnalysis.details.aiPreviewYaml}
                            </pre>
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
