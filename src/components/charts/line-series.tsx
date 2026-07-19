"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { AXIS_STYLE, GRID_STYLE, TOOLTIP_STYLE, CHART_VARS } from "./theme";
import { formatNumber } from "@/lib/utils";

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
}

/** Multi-series line chart (e.g. follower growth per platform over time). */
export function LineSeries({
  data,
  series,
  xKey = "day",
  height = 280,
}: {
  data: Record<string, unknown>[];
  series: SeriesDef[];
  xKey?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID_STYLE} />
        <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v: number) => formatNumber(v)}
        />
        <Tooltip {...TOOLTIP_STYLE} />
        {series.length > 1 && (
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
        )}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? CHART_VARS[i % CHART_VARS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
