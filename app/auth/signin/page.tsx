"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SignInContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const error = searchParams.get("error");

  return (
    <div className="min-h-screen bg-luxe-bg flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            <span className="title-gradient title-glow">AI</span>
            <span className="text-luxe-fg"> Friendly</span>
          </h1>
          <p className="text-luxe-fg-muted mt-2 text-sm">
            Connectez-vous pour gérer vos sites
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-luxe-score-low/30 bg-luxe-score-low/10 px-4 py-3 text-sm text-luxe-score-low">
            {error === "OAuthAccountNotLinked"
              ? "Un compte existe déjà avec cette adresse email. Connectez-vous avec le fournisseur original."
              : "Erreur de connexion. Réessayez."}
          </div>
        )}

        <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe p-8 space-y-4">
          <button
            onClick={() => signIn("google", { callbackUrl })}
            className="w-full flex items-center justify-center gap-3 rounded-lg border border-luxe-border bg-luxe-bg px-4 py-3 text-sm font-medium text-luxe-fg hover:bg-luxe-bg-muted transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continuer avec Google
          </button>

          <button
            onClick={() => signIn("microsoft-entra-id", { callbackUrl })}
            className="w-full flex items-center justify-center gap-3 rounded-lg border border-luxe-border bg-luxe-bg px-4 py-3 text-sm font-medium text-luxe-fg hover:bg-luxe-bg-muted transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#F25022" d="M1 1h10v10H1z" />
              <path fill="#00A4EF" d="M1 13h10v10H1z" />
              <path fill="#7FBA00" d="M13 1h10v10H13z" />
              <path fill="#FFB900" d="M13 13h10v10H13z" />
            </svg>
            Continuer avec Microsoft
          </button>
        </div>

        <p className="text-center text-xs text-luxe-fg-muted mt-6">
          <a href="/" className="hover:text-luxe-gold transition-colors">
            &larr; Retour à l&apos;accueil
          </a>
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-luxe-bg flex items-center justify-center">
          <div className="size-6 rounded-full border-2 border-luxe-gold border-t-transparent animate-spin" />
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
