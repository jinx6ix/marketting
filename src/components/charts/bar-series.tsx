"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { AXIS_STYLE, GRID_STYLE, TOOLTIP_STYLE, CHART_VARS } from "./theme";
import { formatNumber } from "@/lib/utils";
import type { SeriesDef } from "./line-series";

/** Grouped or stacked bar chart (e.g. content-type mix, per-platform engagement). */
export function BarSeries({
  data,
  series,
  xKey,
  stacked = false,
  height = 280,
}: {
  data: Record<string, unknown>[];
  series: SeriesDef[];
  xKey: string;
  stacked?: boolean;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID_STYLE} />
        <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v: number) => formatNumber(v)}
        />
        <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: "var(--muted)" }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color ?? CHART_VARS[i % CHART_VARS.length]}
            radius={stacked ? undefined : [4, 4, 0, 0]}
            {...(stacked ? { stackId: "stack" } : {})}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
