import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return `${n.toFixed(digits)}%`;
}

/**
 * ISO timestamp `days` days before now. For dynamic server components,
 * where reading the clock per-request is intended.
 */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

/**
 * Formats a date in a specific IANA timezone, regardless of the server
 * process's own timezone. Node processes on Vercel always run in UTC
 * (independent of the deployment's region setting), while a local dev
 * machine inherits the OS's local timezone — so any Server Component that
 * formats a date with e.g. `.toLocaleString()` and no explicit timeZone
 * looks correct locally and then silently shifts by the server's UTC
 * offset once deployed. Always pass the org's configured timezone
 * (organizations.timezone) here instead of relying on the ambient one.
 */
export function formatInTimeZone(
  date: string | Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(d);
}

/** True if `date` is null/undefined, or older than `hours` hours ago. */
export function isStale(date: string | Date | null | undefined, hours: number): boolean {
  if (!date) return true;
  const d = typeof date === "string" ? new Date(date) : date;
  return Date.now() - d.getTime() > hours * 60 * 60 * 1000;
}

export function relativeTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}