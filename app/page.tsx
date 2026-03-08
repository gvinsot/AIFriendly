"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { AnalysisResult, Improvement } from "@/lib/types";
import { ShareSection } from "@/components/ShareSection";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/lib/i18n/context";

/* ── Icon components ────────────────────────────────────── */
function IconSignal() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 20V4" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function IconBot() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4M2 13h2M20 13h2M9 16h0M15 16h0" />
    </svg>
  );
}
function IconHistory() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}
function IconEyeOff() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M1 1l22 22" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    </svg>
  );
}
function IconPuzzle() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.611a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.61-1.611A2.404 2.404 0 0 1 12 2c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02z" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
function IconArrowRight() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}
function IconTerminal() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

const PROBLEM_ICONS: Record<string, () => JSX.Element> = {
  calendar: IconCalendar,
  clock: IconClock,
  "eye-off": IconEyeOff,
  puzzle: IconPuzzle,
};

const FEATURE_ICONS: Record<string, () => JSX.Element> = {
  signal: IconSignal,
  shield: IconShield,
  bot: IconBot,
  history: IconHistory,
};

/* ── Main Page ──────────────────────────────────────────── */
export default function Home() {
  const { t } = useI18n();
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
      setError(t.home.emptyUrlError);
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
        setError(data.error || t.home.analyzeError);
        return;
      }
      setResult(data as AnalysisResult);
    } catch {
      setError(t.common.connectionError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-luxe-bg">
      {/* Background effects */}
      <div className="fixed inset-0 hero-grid pointer-events-none" aria-hidden />
      <div className="fixed inset-0 bg-gradient-to-b from-[rgba(34,211,238,0.06)] via-transparent to-transparent pointer-events-none" aria-hidden />

      {/* ─── NAV ─── */}
      <nav className="relative z-10 border-b border-luxe-border bg-luxe-bg-elevated/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-display text-2xl font-bold tracking-tight">
              <span className="title-gradient title-glow">AI</span>
              <span className="text-luxe-fg">Friendly</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link
              href="/dashboard"
              className="rounded-lg border border-luxe-border text-sm text-luxe-fg-muted hover:text-luxe-gold hover:border-luxe-gold/30 px-4 py-2 transition-colors"
            >
              {t.home.dashboardLink}
            </Link>
            <Link
              href="/auth/signin"
              className="rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold hover:bg-luxe-gold/20 text-sm font-medium px-4 py-2 transition-all"
            >
              {t.home.heroCta}
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative z-10 pt-20 pb-16 sm:pt-28 sm:pb-24">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-luxe-border bg-luxe-bg-elevated/80 px-4 py-1.5 text-xs text-luxe-fg-muted mb-8 animate-fade-in-up">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--luxe-score-high)] animate-pulse" />
            {t.home.subtitle}
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-luxe-fg leading-[1.1] mb-6 animate-fade-in-up animation-delay-100">
            {t.home.heroHeadline.split(".").map((part, i) =>
              i === 0 ? (
                <span key={i}>
                  {part}.<br className="hidden sm:block" />
                </span>
              ) : (
                <span key={i} className="title-gradient title-glow">
                  {part.trim()}
                </span>
              )
            )}
          </h1>

          <p className="text-lg sm:text-xl text-luxe-fg-muted max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-in-up animation-delay-200">
            {t.home.heroSubheadline}
          </p>

          {/* Quick analyze form */}
          <form onSubmit={handleSubmit} className="max-w-xl mx-auto mb-6 animate-fade-in-up animation-delay-300">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t.home.urlPlaceholder}
                className="flex-1 rounded-xl border border-luxe-border bg-luxe-bg-elevated px-5 py-3.5 text-luxe-fg placeholder-luxe-fg-muted/70 focus:outline-none focus:ring-2 focus:ring-luxe-gold/40 focus:border-luxe-gold/40 transition-all disabled:opacity-60"
                disabled={loading}
                aria-label={t.home.urlLabel}
              />
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-luxe-gold text-luxe-bg font-semibold px-8 py-3.5 hover:opacity-90 disabled:opacity-50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-luxe-gold focus:ring-offset-2 focus:ring-offset-luxe-bg whitespace-nowrap"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="size-4 rounded-full border-2 border-luxe-bg border-t-transparent animate-spin" aria-hidden />
                    {t.home.analyzingButton}
                  </span>
                ) : (
                  t.home.analyzeButton
                )}
              </button>
            </div>
            {error && (
              <p className="text-luxe-score-low text-sm mt-3" role="alert">
                {error}
              </p>
            )}
          </form>

          <div className="flex items-center justify-center gap-6 text-xs text-luxe-fg-muted animate-fade-in-up animation-delay-400">
            <span className="flex items-center gap-1.5">
              <IconCheck />
              Free
            </span>
            <span className="flex items-center gap-1.5">
              <IconCheck />
              No credit card
            </span>
            <span className="flex items-center gap-1.5">
              <IconCheck />
              MCP ready
            </span>
          </div>
        </div>
      </section>

      {/* ─── ANALYSIS RESULTS (shown after analyze) ─── */}
      {result && (
        <section className="relative z-10 max-w-3xl mx-auto px-6 pb-16 space-y-10" aria-labelledby="results-heading">
          <h2 id="results-heading" className="sr-only">{t.home.resultsHeading}</h2>

          <article className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
            <div className="px-8 py-5 border-b border-luxe-border bg-luxe-bg-muted/50">
              <h3 className="font-display text-xl font-semibold text-luxe-fg">{t.home.scoreTitle}</h3>
              <p className="text-sm text-luxe-fg-muted mt-1 truncate max-w-full" title={result.url}>{result.url}</p>
            </div>
            <div className="p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
              <div className="flex items-baseline gap-2">
                <span className={`font-display text-5xl sm:text-6xl font-semibold tabular-nums tracking-tight ${
                  result.score >= 7 ? "text-[var(--luxe-score-high)]" : result.score >= 4 ? "text-[var(--luxe-score-mid)]" : "text-[var(--luxe-score-low)]"
                }`}>
                  {result.score}
                </span>
                <span className="text-luxe-fg-muted text-xl font-medium">/ {result.maxScore}</span>
              </div>
              <ShareSection result={result} />
            </div>
          </article>

          {result.improvements.length > 0 && (
            <article className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe overflow-hidden">
              <div className="px-8 py-5 border-b border-luxe-border bg-luxe-bg-muted/50">
                <h3 className="font-display text-xl font-semibold text-luxe-fg">{t.home.improvementsTitle}</h3>
                <p className="text-sm text-luxe-fg-muted mt-1">{t.home.improvementsSubtitle}</p>
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
              <h3 className="font-display text-xl font-semibold text-luxe-fg">{t.home.aiPreviewTitle}</h3>
              <p className="text-sm text-luxe-fg-muted mt-1">{t.home.aiPreviewSubtitle}</p>
            </div>
            <div className="p-5 overflow-auto preview-scroll max-h-[420px] bg-luxe-bg-muted rounded-b-2xl">
              <pre className="text-sm font-mono text-luxe-fg-muted whitespace-pre leading-relaxed">
                {result.aiPreviewYaml}
              </pre>
            </div>
          </article>
        </section>
      )}

      {/* ─── PROBLEM SECTION ─── */}
      <section className="relative z-10 py-20 sm:py-28">
        <div className="section-divider max-w-6xl mx-auto mb-20" />
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-luxe-fg mb-4">
              {t.home.problemTitle}
            </h2>
            <p className="text-luxe-fg-muted text-lg max-w-xl mx-auto">
              {t.home.problemSubtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {t.home.problemCards.map((card, i) => {
              const Icon = PROBLEM_ICONS[card.icon] || IconCalendar;
              return (
                <div
                  key={i}
                  className={`rounded-xl border border-luxe-border bg-luxe-bg-elevated/80 p-6 animate-fade-in-up animation-delay-${(i + 1) * 100}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-luxe-score-low/10 text-[var(--luxe-score-low)] flex items-center justify-center mb-4">
                    <Icon />
                  </div>
                  <h3 className="font-semibold text-luxe-fg mb-2">{card.title}</h3>
                  <p className="text-sm text-luxe-fg-muted leading-relaxed">{card.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── FEATURES SECTION ─── */}
      <section className="relative z-10 py-20 sm:py-28 bg-luxe-bg-elevated/40" id="features">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-luxe-fg mb-4">
              {t.home.featuresTitle}
            </h2>
            <p className="text-luxe-fg-muted text-lg max-w-xl mx-auto">
              {t.home.featuresSubtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {t.home.features.map((feat, i) => {
              const Icon = FEATURE_ICONS[feat.icon] || IconSignal;
              return (
                <div
                  key={i}
                  className="feature-card rounded-2xl border border-luxe-border bg-luxe-bg-elevated p-8"
                >
                  <div className="w-12 h-12 rounded-xl bg-luxe-gold/10 text-luxe-gold flex items-center justify-center mb-5">
                    <Icon />
                  </div>
                  <h3 className="font-display text-xl font-semibold text-luxe-fg mb-3">{feat.title}</h3>
                  <p className="text-luxe-fg-muted leading-relaxed">{feat.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── MCP SECTION ─── */}
      <section className="relative z-10 py-20 sm:py-28">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left: text */}
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-luxe-gold/30 bg-luxe-gold/5 px-3 py-1 text-xs text-luxe-gold mb-6">
                <IconTerminal />
                MCP Protocol
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-luxe-fg mb-4">
                {t.home.mcpTitle}
              </h2>
              <p className="text-luxe-fg-muted text-lg mb-6 leading-relaxed">
                {t.home.mcpDescription}
              </p>
              <ul className="space-y-3">
                {t.home.mcpFeatures.map((feat, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 text-luxe-gold"><IconCheck /></span>
                    <span className="text-luxe-fg-muted">{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: code block */}
            <div className="code-block rounded-2xl p-6 font-mono text-sm overflow-x-auto animate-pulse-glow">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
                <span className="w-3 h-3 rounded-full bg-[#28c840]" />
                <span className="ml-4 text-luxe-fg-muted text-xs">mcp.json</span>
              </div>
              <pre className="text-luxe-fg-muted leading-relaxed">
<span className="text-luxe-fg-muted/60">{t.home.mcpCodeComment}</span>{"\n"}
{"{"}{"\n"}
{"  "}<span className="text-luxe-gold">&quot;mcpServers&quot;</span>: {"{"}{"\n"}
{"    "}<span className="text-luxe-gold">&quot;aifriendly&quot;</span>: {"{"}{"\n"}
{"      "}<span className="text-[#a855f7]">&quot;url&quot;</span>: <span className="text-[var(--luxe-score-high)]">&quot;https://mcp.aifriendly.eu/mcp&quot;</span>,{"\n"}
{"      "}<span className="text-[#a855f7]">&quot;headers&quot;</span>: {"{"}{"\n"}
{"        "}<span className="text-[#a855f7]">&quot;x-api-key&quot;</span>: <span className="text-[var(--luxe-score-mid)]">&quot;your-api-key&quot;</span>{"\n"}
{"      }"}{"\n"}
{"    }"}{"\n"}
{"  }"}{"\n"}
{"}"}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section className="relative z-10 py-20 sm:py-28 bg-luxe-bg-elevated/40" id="how">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-luxe-fg mb-4">
              {t.home.howTitle}
            </h2>
          </div>

          <div className="space-y-8">
            {t.home.howSteps.map((step, i) => (
              <div key={i} className="flex gap-6 items-start">
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl border border-luxe-gold/30 bg-luxe-gold/5 flex items-center justify-center">
                  <span className="font-display text-xl font-bold text-luxe-gold">{step.step}</span>
                </div>
                <div className="pt-1">
                  <h3 className="font-semibold text-lg text-luxe-fg mb-1">{step.title}</h3>
                  <p className="text-luxe-fg-muted leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="relative z-10 py-20 sm:py-28">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-luxe-fg mb-4">
            {t.home.ctaTitle}
          </h2>
          <p className="text-luxe-fg-muted text-lg mb-8">
            {t.home.ctaSubtitle}
          </p>
          <Link
            href="/auth/signin"
            className="inline-flex items-center gap-2 rounded-xl bg-luxe-gold text-luxe-bg font-semibold px-8 py-4 text-lg hover:opacity-90 transition-all focus:outline-none focus:ring-2 focus:ring-luxe-gold focus:ring-offset-2 focus:ring-offset-luxe-bg"
          >
            {t.home.ctaButton}
            <IconArrowRight />
          </Link>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="relative z-10 border-t border-luxe-border py-12">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <span className="font-display text-xl font-bold tracking-tight">
                <span className="title-gradient">AI</span>
                <span className="text-luxe-fg">Friendly</span>
              </span>
              <p className="text-sm text-luxe-fg-muted mt-1">{t.home.footerTool}</p>
            </div>
            <div className="flex items-center gap-6">
              {t.home.footerLinks.map((link, i) => (
                <Link key={i} href={link.href} className="text-sm text-luxe-fg-muted hover:text-luxe-gold transition-colors">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <p className="text-xs text-luxe-fg-muted/60 mt-8 text-center">
            {t.home.footerSeo}
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ── Improvement item (from analysis results) ──────────── */
function ImprovementItem({ item }: { item: Improvement }) {
  const { t } = useI18n();
  const severityStyles = {
    critical: "bg-[var(--luxe-score-low)]/15 text-[var(--luxe-score-low)] border border-[var(--luxe-score-low)]/20",
    warning: "bg-[var(--luxe-score-mid)]/15 text-[var(--luxe-score-mid)] border border-[var(--luxe-score-mid)]/20",
    info: "bg-luxe-gold/10 text-luxe-gold-muted border border-luxe-border",
  };
  return (
    <li className="px-8 py-5 transition-colors hover:bg-luxe-bg-muted/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-wide ${severityStyles[item.severity]}`}>
          {t.common.severity[item.severity]}
        </span>
        <span className="text-xs text-luxe-fg-muted">{item.category}</span>
      </div>
      <h4 className="font-medium text-luxe-fg mt-3">{item.title}</h4>
      <p className="text-sm text-luxe-fg-muted mt-1.5 leading-relaxed">{item.description}</p>
      {item.suggestion && (
        <p className="text-sm text-luxe-fg-muted mt-3 font-mono bg-luxe-bg-muted border border-luxe-border rounded-lg px-4 py-2.5">
          {item.suggestion}
        </p>
      )}
    </li>
  );
}
