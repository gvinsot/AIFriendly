"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Site {
  id: string;
  name: string;
  url: string;
  frequency: string;
  isActive: boolean;
  createdAt: string;
  _count: { analyses: number };
  lastScore: number | null;
}

const FREQUENCY_LABELS: Record<string, string> = {
  "6h": "Toutes les 6h",
  daily: "Quotidienne",
  weekly: "Hebdomadaire",
  monthly: "Mensuelle",
};

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    frequency: "daily",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites");
      if (res.ok) {
        const data = await res.json();
        setSites(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const method = editingSite ? "PUT" : "POST";
      const url = editingSite ? `/api/sites/${editingSite.id}` : "/api/sites";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erreur lors de l'enregistrement.");
        return;
      }
      setShowForm(false);
      setEditingSite(null);
      setFormData({ name: "", url: "", frequency: "daily" });
      fetchSites();
    } catch {
      setError("Erreur de connexion.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(siteId: string) {
    if (!confirm("Supprimer ce site et tout son historique ?")) return;
    await fetch(`/api/sites/${siteId}`, { method: "DELETE" });
    fetchSites();
  }

  function startEdit(site: Site) {
    setEditingSite(site);
    setFormData({ name: site.name, url: site.url, frequency: site.frequency });
    setShowForm(true);
    setError(null);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingSite(null);
    setFormData({ name: "", url: "", frequency: "daily" });
    setError(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="size-6 rounded-full border-2 border-luxe-gold border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-luxe-fg">
            Mes sites
          </h1>
          <p className="text-sm text-luxe-fg-muted mt-1">
            Gérez vos sites et leurs analyses programmées
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => {
              setShowForm(true);
              setEditingSite(null);
              setFormData({ name: "", url: "", frequency: "daily" });
            }}
            className="rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold px-5 py-2.5 text-sm font-medium hover:bg-luxe-gold/20 transition-colors"
          >
            + Ajouter un site
          </button>
        )}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe p-6 space-y-4"
        >
          <h2 className="font-display text-lg font-semibold text-luxe-fg">
            {editingSite ? "Modifier le site" : "Ajouter un site"}
          </h2>

          {error && (
            <p className="text-sm text-luxe-score-low">{error}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-luxe-fg-muted mb-1.5">
                Nom du site
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Mon site web"
                required
                className="w-full rounded-lg border border-luxe-border bg-luxe-bg px-4 py-2.5 text-sm text-luxe-fg placeholder-luxe-fg-muted/70 focus:outline-none focus:ring-1 focus:ring-luxe-border-focus"
              />
            </div>
            <div>
              <label className="block text-xs text-luxe-fg-muted mb-1.5">
                URL
              </label>
              <input
                type="url"
                value={formData.url}
                onChange={(e) =>
                  setFormData({ ...formData, url: e.target.value })
                }
                placeholder="https://exemple.com"
                required
                className="w-full rounded-lg border border-luxe-border bg-luxe-bg px-4 py-2.5 text-sm text-luxe-fg placeholder-luxe-fg-muted/70 focus:outline-none focus:ring-1 focus:ring-luxe-border-focus"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-luxe-fg-muted mb-1.5">
              Fréquence d&apos;analyse
            </label>
            <select
              value={formData.frequency}
              onChange={(e) =>
                setFormData({ ...formData, frequency: e.target.value })
              }
              className="w-full sm:w-auto rounded-lg border border-luxe-border bg-luxe-bg px-4 py-2.5 text-sm text-luxe-fg focus:outline-none focus:ring-1 focus:ring-luxe-border-focus"
            >
              <option value="6h">Toutes les 6 heures</option>
              <option value="daily">Quotidienne</option>
              <option value="weekly">Hebdomadaire</option>
              <option value="monthly">Mensuelle</option>
            </select>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold px-6 py-2.5 text-sm font-medium hover:bg-luxe-gold/20 disabled:opacity-50 transition-colors"
            >
              {saving ? "Enregistrement…" : editingSite ? "Modifier" : "Ajouter"}
            </button>
            <button
              type="button"
              onClick={cancelForm}
              className="rounded-lg border border-luxe-border text-luxe-fg-muted px-6 py-2.5 text-sm hover:bg-luxe-bg-muted transition-colors"
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      {/* Sites list */}
      {sites.length === 0 && !showForm ? (
        <div className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe p-12 text-center">
          <p className="text-luxe-fg-muted mb-4">
            Vous n&apos;avez pas encore de site enregistré.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-luxe-gold bg-luxe-gold/10 text-luxe-gold px-5 py-2.5 text-sm font-medium hover:bg-luxe-gold/20 transition-colors"
          >
            + Ajouter votre premier site
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {sites.map((site) => (
            <div
              key={site.id}
              className="rounded-2xl bg-luxe-bg-elevated border border-luxe-border shadow-luxe p-5 flex flex-col sm:flex-row sm:items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-luxe-fg truncate">
                    {site.name}
                  </h3>
                  {!site.isActive && (
                    <span className="text-[10px] text-luxe-fg-muted border border-luxe-border rounded-full px-2 py-0.5">
                      Inactif
                    </span>
                  )}
                </div>
                <p className="text-xs text-luxe-fg-muted truncate mt-0.5">
                  {site.url}
                </p>
                <div className="flex items-center gap-3 mt-2 text-xs text-luxe-fg-muted">
                  <span>{FREQUENCY_LABELS[site.frequency] || site.frequency}</span>
                  <span>&middot;</span>
                  <span>{site._count.analyses} analyse(s)</span>
                </div>
              </div>

              <div className="flex items-center gap-3 sm:gap-2">
                {site.lastScore !== null && (
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold border ${
                      site.lastScore >= 7
                        ? "text-luxe-score-high bg-luxe-score-high/10 border-luxe-score-high/20"
                        : site.lastScore >= 4
                        ? "text-luxe-score-mid bg-luxe-score-mid/10 border-luxe-score-mid/20"
                        : "text-luxe-score-low bg-luxe-score-low/10 border-luxe-score-low/20"
                    }`}
                  >
                    {site.lastScore}/10
                  </span>
                )}

                <Link
                  href={`/dashboard/sites/${site.id}`}
                  className="rounded-lg border border-luxe-border text-luxe-fg-muted px-3 py-1.5 text-xs hover:bg-luxe-bg-muted transition-colors"
                >
                  Historique
                </Link>
                <button
                  onClick={() => startEdit(site)}
                  className="rounded-lg border border-luxe-border text-luxe-fg-muted px-3 py-1.5 text-xs hover:bg-luxe-bg-muted transition-colors"
                >
                  Modifier
                </button>
                <button
                  onClick={() => handleDelete(site.id)}
                  className="rounded-lg border border-luxe-score-low/30 text-luxe-score-low px-3 py-1.5 text-xs hover:bg-luxe-score-low/10 transition-colors"
                >
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
