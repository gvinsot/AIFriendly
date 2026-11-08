"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";

interface OwnershipState {
  verified: boolean;
  method: "dns" | "file" | null;
  instructions: {
    dns: { name: string; type: string; value: string } | null;
    file: { url: string; content: string };
  };
}

function ProofRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-luxe-fg-muted">{label}</p>
      <code className="mt-0.5 block break-all rounded bg-luxe-bg px-2 py-1 text-xs text-luxe-fg">{value}</code>
    </div>
  );
}

/** Prouver la propriété du site : préalable obligatoire aux scans de sécurité. */
export function SiteOwnershipPanel({ siteId }: { siteId: string }) {
  const { t } = useI18n();
  const copy = t.siteDetail.security;
  const [state, setState] = useState<OwnershipState | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sites/${siteId}/ownership`);
    if (res.ok) setState(await res.json());
  }, [siteId]);

  useEffect(() => {
    load().catch(() => setMessage(t.common.connectionError));
  }, [load, t.common.connectionError]);

  async function verify() {
    setChecking(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/ownership`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(data?.error || t.common.error);
      } else if (data?.verified) {
        await load();
      } else {
        setMessage(data?.reason === "unreachable" ? copy.ownershipUnreachable : copy.ownershipNotFound);
      }
    } catch {
      setMessage(t.common.connectionError);
    } finally {
      setChecking(false);
    }
  }

  if (!state) return null;

  if (state.verified) {
    return (
      <p className="text-sm text-luxe-fg-muted">
        ✓ {copy.ownershipVerified} ({state.method === "dns" ? copy.ownershipDnsTitle : copy.ownershipFileTitle})
      </p>
    );
  }

  return (
    <section className="rounded-lg border border-luxe-gold/40 bg-luxe-gold/5 p-4 space-y-4">
      <div>
        <h3 className="font-display text-base font-semibold text-luxe-fg">{copy.ownershipTitle}</h3>
        <p className="mt-1 text-sm text-luxe-fg-muted">{copy.ownershipRequired}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {state.instructions.dns && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-luxe-fg">{copy.ownershipDnsTitle}</p>
            <ProofRow label={copy.ownershipDnsName} value={state.instructions.dns.name} />
            <ProofRow label={copy.ownershipDnsValue} value={state.instructions.dns.value} />
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm font-medium text-luxe-fg">{copy.ownershipFileTitle}</p>
          <ProofRow label={copy.ownershipFileUrl} value={state.instructions.file.url} />
          <ProofRow label={copy.ownershipFileContent} value={state.instructions.file.content} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={verify}
          disabled={checking}
          className="rounded-lg border border-luxe-gold bg-luxe-gold text-luxe-bg px-5 py-2.5 text-sm font-medium hover:bg-luxe-gold/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {checking ? copy.ownershipCheckingButton : copy.ownershipCheckButton}
        </button>
        {message && <p role="status" className="text-sm text-luxe-fg-muted">{message}</p>}
      </div>
    </section>
  );
}
