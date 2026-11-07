"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/context";

export interface SiteFormData {
  name: string;
  url: string;
}

interface SiteFormModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** "edit" shows the edit title, "add" the creation title. */
  mode: "add" | "edit";
  formData: SiteFormData;
  onChange: (data: SiteFormData) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
  /** Optional label override for the submit button. */
  submitLabel?: string;
}

/**
 * Accessible modal dialog used to add or edit a monitored site.
 * - Closes on Escape, on backdrop click and with the close/cancel buttons
 *   (except while a save is in progress).
 * - Locks page scroll, focuses the first field and keeps Tab focus inside.
 * - Restores focus to the element that opened it when closed.
 * - Rendered in a portal on document.body so parent layout/stacking never affects it.
 */
export function SiteFormModal({
  open,
  mode,
  formData,
  onChange,
  onSubmit,
  onClose,
  saving,
  error,
  submitLabel,
}: SiteFormModalProps) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  // Keep latest values in refs so the effect below only runs on open/close.
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(saving);
  onCloseRef.current = onClose;
  savingRef.current = saving;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstInputRef.current?.focus();
    firstInputRef.current?.select();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!savingRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      // Simple focus trap
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const inputClass =
    "w-full rounded-lg border border-luxe-border bg-luxe-bg px-4 py-2.5 text-sm text-luxe-fg placeholder-luxe-fg-muted/70 focus:outline-none focus:ring-1 focus:ring-luxe-border-focus";

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Close only when the press starts on the backdrop itself
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe"
      >
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="font-display text-lg font-semibold text-luxe-fg">
              {mode === "edit" ? t.sites.editSite : t.sites.addSiteForm}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label={t.common.close}
              className="rounded-lg p-1.5 text-luxe-fg-muted hover:text-luxe-fg hover:bg-luxe-bg-muted disabled:opacity-50 transition-colors"
            >
              <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>

          {error && (
            <p className="text-sm text-luxe-score-low" role="alert">
              {error}
            </p>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor={`${titleId}-name`} className="block text-xs text-luxe-fg-muted mb-1.5">
                {t.sites.siteName}
              </label>
              <input
                id={`${titleId}-name`}
                ref={firstInputRef}
                type="text"
                value={formData.name}
                onChange={(e) => onChange({ ...formData, name: e.target.value })}
                placeholder={t.sites.siteNamePlaceholder}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor={`${titleId}-url`} className="block text-xs text-luxe-fg-muted mb-1.5">
                {t.sites.url}
              </label>
              <input
                id={`${titleId}-url`}
                type="url"
                value={formData.url}
                onChange={(e) => onChange({ ...formData, url: e.target.value })}
                placeholder={t.sites.urlPlaceholder}
                required
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-luxe-border text-luxe-fg-muted px-6 py-2.5 text-sm hover:bg-luxe-bg-muted disabled:opacity-50 transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold px-6 py-2.5 text-sm font-medium hover:bg-luxe-gold/20 disabled:opacity-50 transition-colors"
            >
              {saving ? t.sites.savingButton : submitLabel ?? t.common.save}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
