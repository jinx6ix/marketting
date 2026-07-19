"use client";

import { ResponsiveContainer, LineChart, Line, YAxis } from "recharts";

/** Tiny inline trend line for table rows — no axes, no grid, no tooltip. */
export function Sparkline({
  values,
  color = "var(--chart-1)",
  height = 28,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  const data = values.map((v, i) => ({ i, v }));
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (
    <div style={{ width: 96, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <YAxis domain={[min, max]} hide />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
