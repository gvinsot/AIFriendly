"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useI18n } from "@/lib/i18n/context";

function SubscribeContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get("success");
  const canceled = searchParams.get("canceled");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const { update } = useSession();
  const { t } = useI18n();

  // After successful payment, activate subscription via API then refresh JWT
  useEffect(() => {
    if (!success) return;
    const sessionId = searchParams.get("session_id");
    let cancelled = false;

    const activate = async () => {
      // Call activate endpoint to write subscription data to DB
      if (sessionId) {
        try {
          await fetch("/api/stripe/activate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
        } catch (e) {
          console.error("Activation error:", e);
        }
      }
      // Refresh the JWT so isSubscribed picks up the new data
      await update();
      if (!cancelled) setSessionReady(true);
    };

    activate();
    return () => { cancelled = true; };
  }, [success, searchParams, update]);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePortal = async () => {
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    }
  };

  if (success) {
    return (
      <div className="max-w-md mx-auto text-center space-y-6">
        <div className="text-5xl">✓</div>
        <h1 className="font-display text-2xl font-bold text-luxe-fg">
          {t.subscribe.successTitle}
        </h1>
        <p className="text-luxe-fg-muted">{t.subscribe.successMessage}</p>
        {!sessionReady && (
          <div className="flex items-center justify-center gap-2 text-sm text-luxe-fg-muted">
            <div className="size-4 rounded-full border-2 border-luxe-gold border-t-transparent animate-spin" />
            {t.subscribe.activating}
          </div>
        )}
        <div className="flex flex-col gap-3">
          <a
            href="/dashboard"
            className={`rounded-lg bg-luxe-gold px-6 py-3 text-sm font-semibold text-luxe-bg hover:opacity-90 transition-opacity ${!sessionReady ? "pointer-events-none opacity-50" : ""}`}
          >
            {t.subscribe.goToDashboard}
          </a>
          <button
            onClick={handlePortal}
            className="text-sm text-luxe-fg-muted hover:text-luxe-gold transition-colors"
          >
            {t.subscribe.manageBilling}
          </button>
        </div>
      </div>
    );
  }

  if (canceled) {
    return (
      <div className="max-w-md mx-auto text-center space-y-6">
        <h1 className="font-display text-2xl font-bold text-luxe-fg">
          {t.subscribe.canceledTitle}
        </h1>
        <p className="text-luxe-fg-muted">{t.subscribe.canceledMessage}</p>
        <button
          onClick={handleCheckout}
          disabled={loading}
          className="rounded-lg bg-luxe-gold px-6 py-3 text-sm font-semibold text-luxe-bg hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? t.common.loading : t.subscribe.retryCheckout}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto text-center space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-luxe-fg">
          {t.subscribe.title}
        </h1>
        <p className="text-luxe-fg-muted mt-2">{t.subscribe.subtitle}</p>
      </div>

      <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe p-8 space-y-6">
        <div>
          <div className="text-4xl font-bold text-luxe-gold">10 €</div>
          <div className="text-sm text-luxe-fg-muted mt-1">
            {t.subscribe.perMonth}
          </div>
        </div>

        <ul className="text-left space-y-3 text-sm text-luxe-fg">
          {t.subscribe.features.map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-luxe-gold mt-0.5">✓</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full rounded-lg bg-luxe-gold px-6 py-3 text-sm font-semibold text-luxe-bg hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? t.common.loading : t.subscribe.checkoutButton}
        </button>
      </div>

      <a
        href="/"
        className="inline-block text-xs text-luxe-fg-muted hover:text-luxe-gold transition-colors"
      >
        &larr; {t.auth.backToHome}
      </a>
    </div>
  );
}

export default function SubscribePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="size-6 rounded-full border-2 border-luxe-gold border-t-transparent animate-spin" />
        </div>
      }
    >
      <SubscribeContent />
    </Suspense>
  );
}
