"use client";

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
  return (
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
        <Legend wrapperStyle={{ fontSize: 13 }} />
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
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
