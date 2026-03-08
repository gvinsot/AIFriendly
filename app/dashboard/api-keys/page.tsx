"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";

interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  key?: string; // Only present on creation
}

export default function ApiKeysPage() {
  const { t } = useI18n();
  const ak = t.apiKeys;

  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/keys");
      if (res.ok) setKeys(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || ak.createError);
        return;
      }
      const data = await res.json();
      setNewKey(data.key);
      setName("");
      setShowForm(false);
      fetchKeys();
    } catch {
      setError(ak.createError);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(ak.confirmDelete)) return;
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    setKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const copyKey = async () => {
    if (newKey) {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-luxe-fg">
            {ak.title}
          </h1>
          <p className="text-luxe-fg-muted text-sm mt-1">{ak.subtitle}</p>
        </div>
        <button
          onClick={() => {
            setShowForm(true);
            setNewKey(null);
          }}
          className="px-4 py-2 bg-luxe-gold text-luxe-bg rounded-lg text-sm font-medium hover:bg-luxe-gold/90 transition-colors"
        >
          {ak.createButton}
        </button>
      </div>

      {/* New key banner (shown once after creation) */}
      {newKey && (
        <div className="border border-green-500/30 bg-green-500/10 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-green-400">
            {ak.keyCreated}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-luxe-bg px-3 py-2 rounded-lg text-sm font-mono text-luxe-fg border border-luxe-border break-all">
              {newKey}
            </code>
            <button
              onClick={copyKey}
              className="px-3 py-2 bg-luxe-bg-elevated border border-luxe-border rounded-lg text-sm hover:bg-luxe-bg-muted transition-colors whitespace-nowrap"
            >
              {copied ? t.common.copied : t.common.copy}
            </button>
          </div>
          <p className="text-xs text-luxe-fg-muted">{ak.keyWarning}</p>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="border border-luxe-border bg-luxe-bg-elevated rounded-xl p-4">
          <h3 className="text-sm font-semibold text-luxe-fg mb-3">
            {ak.createTitle}
          </h3>
          <form onSubmit={handleCreate} className="flex gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={ak.namePlaceholder}
              className="flex-1 px-3 py-2 bg-luxe-bg border border-luxe-border rounded-lg text-sm text-luxe-fg placeholder:text-luxe-fg-muted focus:outline-none focus:ring-1 focus:ring-luxe-gold/50"
              maxLength={100}
              autoFocus
            />
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="px-4 py-2 bg-luxe-gold text-luxe-bg rounded-lg text-sm font-medium hover:bg-luxe-gold/90 disabled:opacity-50 transition-colors"
            >
              {creating ? t.common.loading : t.common.save}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-luxe-border rounded-lg text-sm text-luxe-fg-muted hover:text-luxe-fg transition-colors"
            >
              {t.common.cancel}
            </button>
          </form>
          {error && (
            <p className="mt-2 text-sm text-red-400">{error}</p>
          )}
        </div>
      )}

      {/* MCP Connection info */}
      <div className="border border-luxe-border bg-luxe-bg-elevated rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-semibold text-luxe-fg">{ak.mcpTitle}</h3>
        <p className="text-xs text-luxe-fg-muted">{ak.mcpDescription}</p>
        <pre className="bg-luxe-bg px-3 py-2 rounded-lg text-xs font-mono text-luxe-fg border border-luxe-border overflow-x-auto whitespace-pre">
{`{
  "mcpServers": {
    "aifriendly": {
      "url": "https://mcp.aifriendly.eu/mcp",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}`}
        </pre>
      </div>

      {/* Keys list */}
      {loading ? (
        <p className="text-luxe-fg-muted text-sm">{t.common.loading}</p>
      ) : keys.length === 0 ? (
        <div className="border border-luxe-border bg-luxe-bg-elevated rounded-xl p-8 text-center">
          <p className="text-luxe-fg-muted">{ak.noKeys}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between border border-luxe-border bg-luxe-bg-elevated rounded-xl px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-luxe-fg truncate">
                  {k.name}
                </p>
                <div className="flex items-center gap-4 text-xs text-luxe-fg-muted mt-0.5">
                  <span className="font-mono">{k.keyPrefix}••••••••</span>
                  <span>
                    {ak.created}{" "}
                    {new Date(k.createdAt).toLocaleDateString()}
                  </span>
                  {k.lastUsedAt && (
                    <span>
                      {ak.lastUsed}{" "}
                      {new Date(k.lastUsedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(k.id)}
                className="ml-4 text-xs text-red-400 hover:text-red-300 transition-colors border border-red-400/20 hover:border-red-400/40 rounded-lg px-3 py-1.5"
              >
                {t.common.delete}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
