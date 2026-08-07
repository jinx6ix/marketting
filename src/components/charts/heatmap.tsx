"use client";

import React from "react";

/**
 * Best-posting-times heatmap: day-of-week rows × hour columns.
 * Sequential single-hue scale (opacity ramp of --chart-1) so intensity
 * reads correctly in both themes.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface HeatCell {
  dow: number; // 0-6
  hour: number; // 0-23
  value: number;
}

export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const map = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.value]));
  const max = Math.max(...cells.map((c) => c.value), 1);

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[640px] gap-0.5"
        style={{ gridTemplateColumns: "40px repeat(24, 1fr)" }}
      >
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={h}
            className="text-center text-[10px] text-muted-foreground"
          >
            {h % 3 === 0 ? h : ""}
          </div>
        ))}
        {DAYS.map((day, dow) => (
          <React.Fragment key={`row-${dow}`}>
            <div
              className="pr-1 text-right text-[10px] leading-4 text-muted-foreground"
            >
              {day}
            </div>
            {Array.from({ length: 24 }, (_, hour) => {
              const value = map.get(`${dow}-${hour}`) ?? 0;
              const intensity = value / max;
              return (
                <div
                  key={`${dow}-${hour}`}
                  className="aspect-square rounded-[2px] bg-[var(--chart-1)]"
                  style={{ opacity: value === 0 ? 0.06 : 0.15 + intensity * 0.85 }}
                  title={`${day} ${hour}:00 — ${value.toFixed(1)}`}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>Less</span>
        {[0.1, 0.3, 0.55, 0.8, 1].map((o) => (
          <div
            key={o}
            className="size-3 rounded-[2px] bg-[var(--chart-1)]"
            style={{ opacity: o }}
          />
        ))}
        <span>More engagement</span>
      </div>
    </div>
  );
}
