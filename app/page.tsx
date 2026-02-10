"use client";

import { useState, useEffect } from "react";
import type { AnalysisResult, Improvement } from "@/lib/types";
import { ShareSection } from "@/components/ShareSection";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = params.get("url");
    if (sharedUrl) setUrl(decodeURIComponent(sharedUrl));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Veuillez saisir une URL.");
      return;
    }
    let toFetch = trimmed;
    if (!/^https?:\/\//i.test(toFetch)) toFetch = `https://${toFetch}`;
    setUrl(toFetch);
    setLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: toFetch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de l'analyse.");
        return;
      }
      setResult(data as AnalysisResult);
    } catch {
      setError("Erreur de connexion. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-luxe-bg">
      {/* Subtle gradient overlay for depth */}
      <div className="fixed inset-0 bg-gradient-to-b from-[rgba(34,211,238,0.06)] via-transparent to-transparent pointer-events-none" aria-hidden />
      <header className="relative border-b border-luxe-border bg-luxe-bg-elevated/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
            <span className="title-gradient title-glow">AI</span>
            <span className="text-luxe-fg"> Friendly</span>
          </h1>
          <p className="text-luxe-fg-muted mt-2 text-sm tracking-wide">
            Vérifiez si votre site est lisible et optimisé pour l&apos;IA
          </p>
          <div className="absolute bottom-0 left-0 w-24 h-px bg-gradient-to-r from-luxe-gold to-transparent" aria-hidden />
        </div>
      </header>

      <main className="relative max-w-3xl mx-auto px-6 py-12">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex flex-col sm:flex-row gap-4">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://exemple.com"
              className="flex-1 rounded-lg border border-luxe-border bg-luxe-bg-elevated px-5 py-3.5 text-luxe-fg placeholder-luxe-fg-muted/70 focus:outline-none focus:ring-1 focus:ring-luxe-border-focus focus:border-luxe-border-focus transition-colors disabled:opacity-60"
              disabled={loading}
              aria-label="URL à analyser"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold hover:bg-luxe-gold/20 disabled:opacity-50 disabled:border-luxe-fg-muted/30 disabled:text-luxe-fg-muted font-medium px-8 py-3.5 transition-all duration-200 focus:outline-none focus:ring-1 focus:ring-luxe-gold focus:ring-offset-2 focus:ring-offset-luxe-bg"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="size-3 rounded-full border-2 border-luxe-gold border-t-transparent animate-spin" aria-hidden />
                  Analyse…
                </span>
              ) : (
                "Analyser"
              )}
            </button>
          </div>
          {error && (
            <p className="text-luxe-score-low text-sm" role="alert">
              {error}
            </p>
          )}
        </form>

        {result && (
          <section className="mt-14 space-y-10" aria-labelledby="results-heading">
            <h2 id="results-heading" className="sr-only">
              Résultats de l&apos;analyse
            </h2>

            <article className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
              <div className="px-8 py-5 border-b border-luxe-border bg-luxe-bg-muted/50">
                <h3 className="font-display text-xl font-semibold text-luxe-fg">
                  Score de lisibilité IA
                </h3>
                <p className="text-sm text-luxe-fg-muted mt-1 truncate max-w-full" title={result.url}>
                  {result.url}
                </p>
              </div>
              <div className="p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-display text-5xl sm:text-6xl font-semibold tabular-nums tracking-tight ${
                      result.score >= 7
                        ? "text-[var(--luxe-score-high)]"
                        : result.score >= 4
                        ? "text-[var(--luxe-score-mid)]"
                        : "text-[var(--luxe-score-low)]"
                    }`}
                  >
                    {result.score}
                  </span>
                  <span className="text-luxe-fg-muted text-xl font-medium">
                    / {result.maxScore}
                  </span>
                </div>
                <ShareSection result={result} />
              </div>
            </article>

            {result.improvements.length > 0 && (
              <article className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
                <div className="px-8 py-5 border-b border-luxe-border bg-luxe-bg-muted/50">
                  <h3 className="font-display text-xl font-semibold text-luxe-fg">
                    Éléments à améliorer
                  </h3>
                  <p className="text-sm text-luxe-fg-muted mt-1">
                    Ces modifications amélioreront la lisibilité pour les IA
                  </p>
                </div>
                <ul className="divide-y divide-luxe-border">
                  {result.improvements.map((item) => (
                    <ImprovementItem key={item.id} item={item} />
                  ))}
                </ul>
              </article>
            )}

            <article className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
              <div className="px-8 py-5 border-b border-luxe-border bg-luxe-bg-muted/50">
                <h3 className="font-display text-xl font-semibold text-luxe-fg">
                  Aperçu IA
                </h3>
                <p className="text-sm text-luxe-fg-muted mt-1">
                  Ce que verrait un assistant comme ChatGPT — représentation structurée
                </p>
              </div>
              <div className="p-5 overflow-auto preview-scroll max-h-[420px] bg-luxe-bg-muted rounded-b-2xl">
                <pre className="text-sm font-mono text-luxe-fg-muted whitespace-pre leading-relaxed">
                  {result.aiPreviewYaml}
                </pre>
              </div>
            </article>
          </section>
        )}
      </main>

      <footer className="mt-20 py-10 border-t border-luxe-border text-center text-sm text-luxe-fg-muted">
        AI Friendly — Analyse de lisibilité pour l&apos;IA
      </footer>
    </div>
  );
}

function ImprovementItem({ item }: { item: Improvement }) {
  const severityStyles = {
    critical: "bg-[var(--luxe-score-low)]/15 text-[var(--luxe-score-low)] border border-[var(--luxe-score-low)]/20",
    warning: "bg-[var(--luxe-score-mid)]/15 text-[var(--luxe-score-mid)] border border-[var(--luxe-score-mid)]/20",
    info: "bg-luxe-gold/10 text-luxe-gold-muted border border-luxe-border",
  };
  return (
    <li className="px-8 py-5 transition-colors hover:bg-luxe-bg-muted/30">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-wide ${severityStyles[item.severity]}`}
        >
          {item.severity === "critical"
            ? "Critique"
            : item.severity === "warning"
            ? "Attention"
            : "Info"}
        </span>
        <span className="text-xs text-luxe-fg-muted">
          {item.category}
        </span>
      </div>
      <h4 className="font-medium text-luxe-fg mt-3">
        {item.title}
      </h4>
      <p className="text-sm text-luxe-fg-muted mt-1.5 leading-relaxed">
        {item.description}
      </p>
      {item.suggestion && (
        <p className="text-sm text-luxe-fg-muted mt-3 font-mono bg-luxe-bg-muted border border-luxe-border rounded-lg px-4 py-2.5">
          {item.suggestion}
        </p>
      )}
    </li>
  );
}
