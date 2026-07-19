"use client";

import {
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
  Tooltip,
} from "recharts";
import { TOOLTIP_STYLE } from "./theme";

/**
 * You-vs-competitor radar. Values must be pre-normalized to 0-100 so axes
 * are comparable (raw follower counts would drown the other dimensions).
 */
export function RadarCompare({
  data,
  youLabel,
  themLabel,
  height = 300,
}: {
  data: { metric: string; you: number; them: number }[];
  youLabel: string;
  themLabel: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis
          dataKey="metric"
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Tooltip {...TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Radar
          name={youLabel}
          dataKey="you"
          stroke="var(--chart-1)"
          fill="var(--chart-1)"
          fillOpacity={0.25}
          strokeWidth={2}
        />
        <Radar
          name={themLabel}
          dataKey="them"
          stroke="var(--chart-5)"
          fill="var(--chart-5)"
          fillOpacity={0.15}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
