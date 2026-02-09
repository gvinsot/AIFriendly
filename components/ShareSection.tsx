"use client";

import { useState, useEffect } from "react";
import type { AnalysisResult } from "@/lib/types";

interface ShareSectionProps {
  result: AnalysisResult;
}

const SHARE_TEXT = (score: number, url: string) =>
  `Mon site ${url} a obtenu ${score}/10 sur Method AI — Vérifiez si votre site est lisible par l'IA !`;

export function ShareSection({ result }: ShareSectionProps) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => {
    setShareUrl(
      `${window.location.origin}?url=${encodeURIComponent(result.url)}&score=${result.score}`
    );
    setCanNativeShare(typeof navigator !== "undefined" && !!navigator.share);
  }, [result.url, result.score]);
  const text = SHARE_TEXT(result.score, result.url);

  function handleCopyLink() {
    const urlToCopy = shareUrl || `${window.location.origin}?url=${encodeURIComponent(result.url)}&score=${result.score}`;
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(urlToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleShareNative() {
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({
        title: "Method AI — Résultat d'analyse",
        text,
        url: shareUrl,
      }).catch(() => {});
    }
  }

  const encodedText = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(shareUrl);
  const twitterUrl = shareUrl ? `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}` : "#";
  const linkedInUrl = shareUrl ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}` : "#";
  const facebookUrl = shareUrl ? `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` : "#";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-luxe-fg-muted">
        Partager
      </span>
      <div className="flex items-center gap-1.5">
        <a
          href={twitterUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-luxe-border bg-luxe-bg-muted hover:border-luxe-gold hover:bg-[rgba(34,211,238,0.08)] text-luxe-fg-muted hover:text-luxe-gold transition-all duration-200"
          aria-label="Partager sur X (Twitter)"
        >
          <XIcon />
        </a>
        <a
          href={linkedInUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-luxe-border bg-luxe-bg-muted hover:border-luxe-gold hover:bg-[rgba(34,211,238,0.08)] text-luxe-fg-muted hover:text-luxe-gold transition-all duration-200"
          aria-label="Partager sur LinkedIn"
        >
          <LinkedInIcon />
        </a>
        <a
          href={facebookUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-luxe-border bg-luxe-bg-muted hover:border-luxe-gold hover:bg-[rgba(34,211,238,0.08)] text-luxe-fg-muted hover:text-luxe-gold transition-all duration-200"
          aria-label="Partager sur Facebook"
        >
          <FacebookIcon />
        </a>
        {canNativeShare && (
          <button
            type="button"
            onClick={handleShareNative}
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-luxe-border bg-luxe-bg-muted hover:border-luxe-gold hover:bg-[rgba(34,211,238,0.08)] text-luxe-fg-muted hover:text-luxe-gold transition-all duration-200"
            aria-label="Partager (menu natif)"
          >
            <ShareIcon />
          </button>
        )}
        <button
          type="button"
          onClick={handleCopyLink}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-luxe-border bg-luxe-bg-muted hover:border-luxe-gold hover:bg-[rgba(34,211,238,0.08)] text-luxe-fg-muted hover:text-luxe-gold text-sm transition-all duration-200"
          aria-label="Copier le lien"
        >
          {copied ? (
            <CheckIcon />
          ) : (
            <LinkIcon />
          )}
          <span className="sr-only sm:not-sr-only">
            {copied ? "Copié" : "Copier"}
          </span>
        </button>
      </div>
    </div>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
