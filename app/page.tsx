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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            IA Friendly
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1 text-sm">
            Vérifiez si votre site est lisible et optimisé pour l&apos;IA
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://exemple.com"
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-3 text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              disabled={loading}
              aria-label="URL à analyser"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-sky-600 hover:bg-sky-700 disabled:bg-slate-400 text-white font-medium px-6 py-3 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
            >
              {loading ? "Analyse en cours…" : "Analyser"}
            </button>
          </div>
          {error && (
            <p className="text-red-600 dark:text-red-400 text-sm" role="alert">
              {error}
            </p>
          )}
        </form>

        {result && (
          <section className="mt-10 space-y-8" aria-labelledby="results-heading">
            <h2 id="results-heading" className="sr-only">
              Résultats de l&apos;analyse
            </h2>

            <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <h3 className="font-semibold text-slate-900 dark:text-white">
                  Score de lisibilité IA
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                  {result.url}
                </p>
              </div>
              <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-4xl font-bold tabular-nums ${
                      result.score >= 7
                        ? "text-emerald-600 dark:text-emerald-400"
                        : result.score >= 4
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {result.score}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    / {result.maxScore}
                  </span>
                </div>
                <ShareSection result={result} />
              </div>
            </div>

            {result.improvements.length > 0 && (
              <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <h3 className="font-semibold text-slate-900 dark:text-white">
                    Éléments à améliorer
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                    Ces modifications amélioreront la lisibilité pour les IA
                  </p>
                </div>
                <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                  {result.improvements.map((item) => (
                    <ImprovementItem key={item.id} item={item} />
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <h3 className="font-semibold text-slate-900 dark:text-white">
                  Aperçu IA (ce que verrait un assistant comme ChatGPT)
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                  Représentation structurée du contenu de la page
                </p>
              </div>
              <div className="p-4 overflow-auto preview-scroll max-h-[420px] bg-slate-900 rounded-b-xl">
                <pre className="text-sm font-mono text-slate-300 whitespace-pre">
                  {result.aiPreviewYaml}
                </pre>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="mt-16 py-8 border-t border-slate-200 dark:border-slate-700 text-center text-sm text-slate-500 dark:text-slate-400">
        IA Friendly — Analyse de lisibilité pour l&apos;IA
      </footer>
    </div>
  );
}

function ImprovementItem({ item }: { item: Improvement }) {
  const severityStyles = {
    critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    info: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  };
  return (
    <li className="px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${severityStyles[item.severity]}`}
        >
          {item.severity === "critical"
            ? "Critique"
            : item.severity === "warning"
            ? "Attention"
            : "Info"}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {item.category}
        </span>
      </div>
      <h4 className="font-medium text-slate-900 dark:text-white mt-2">
        {item.title}
      </h4>
      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
        {item.description}
      </p>
      {item.suggestion && (
        <p className="text-sm text-slate-700 dark:text-slate-300 mt-2 font-mono bg-slate-100 dark:bg-slate-700/50 rounded px-2 py-1.5">
          {item.suggestion}
        </p>
      )}
    </li>
  );
}
