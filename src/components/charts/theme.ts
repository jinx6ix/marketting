import type { Platform } from "@/types/database";

/**
 * Chart palette: reads the CSS custom properties defined in globals.css so
 * charts stay consistent across light/dark themes. One color per series,
 * platforms get stable assignments.
 */

export const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export const PLATFORM_COLORS: Record<Platform, string> = {
  facebook: "var(--chart-1)",
  instagram: "var(--chart-4)",
  x: "var(--chart-3)",
  tiktok: "var(--chart-2)",
  youtube: "var(--chart-5)",
  linkedin: "var(--chart-1)",
  pinterest: "var(--chart-5)",
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
};

export const AXIS_STYLE = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
} as const;

export const GRID_STYLE = {
  stroke: "var(--border)",
  strokeDasharray: "3 3",
  vertical: false,
} as const;

export const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    color: "var(--popover-foreground)",
    fontSize: "12px",
  },
  labelStyle: { color: "var(--muted-foreground)" },
} as const;
