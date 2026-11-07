"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { LegendPayload } from "recharts";
import { useI18n } from "@/lib/i18n/context";

const COLORS = [
  "#8b5cf6", // violet
  "#0ea5e9", // sky
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#6366f1", // indigo
  "#ec4899", // pink
  "#14b8a6", // teal
];

interface ScoreHistoryChartProps {
  data: Record<string, string | number>[];
  siteNames: string[];
}

export function ScoreHistoryChart({ data, siteNames }: ScoreHistoryChartProps) {
  const { t } = useI18n();
  // Site currently isolated via a legend click (null = every site is shown).
  const [focusedSite, setFocusedSite] = useState<string | null>(null);
  // Ignore a stale focus if the site disappeared from the data set.
  const focused = focusedSite && siteNames.includes(focusedSite) ? focusedSite : null;

  // Clicking a site in the legend isolates it; clicking it again restores all.
  const handleLegendClick = (entry: LegendPayload) => {
    if (entry.dataKey == null) return;
    const name = String(entry.dataKey);
    setFocusedSite((current) => (current === name ? null : name));
  };

  return (
    <div>
      <div className="mb-2 flex min-h-8 items-center justify-between gap-3 text-xs text-luxe-fg-muted">
        <span>{focused ? t.dashboard.scoreHistoryFocused.replace("{site}", focused) : t.dashboard.scoreHistoryHint}</span>
        {focused && (
          <button
            type="button"
            onClick={() => setFocusedSite(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-luxe-border px-3 py-1.5 font-medium text-luxe-fg hover:bg-luxe-bg-muted transition-colors"
          >
            <span aria-hidden="true">×</span>
            {t.dashboard.scoreHistoryShowAll}
          </button>
        )}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            tickFormatter={(v: string) => {
              const [, m, d] = v.split("-");
              return `${d}/${m}`;
            }}
          />
          <YAxis
            domain={[0, 10]}
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            tickFormatter={(v: number) => `${v}/10`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(15,23,42,0.9)",
              border: "1px solid rgba(148,163,184,0.3)",
              borderRadius: "8px",
              color: "#e2e8f0",
              fontSize: 13,
            }}
            formatter={((value: number) => [`${value}/10`, undefined]) as never}
            labelFormatter={((label: string) => {
              const [y, m, d] = label.split("-");
              return `${d}/${m}/${y}`;
            }) as never}
          />
          <Legend
            wrapperStyle={{ fontSize: 13, cursor: "pointer" }}
            onClick={handleLegendClick}
          />
          {siteNames.map((name, i) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
              hide={focused !== null && focused !== name}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
