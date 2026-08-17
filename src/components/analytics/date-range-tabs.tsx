import Link from "next/link";
import { cn } from "@/lib/utils";

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

export function DateRangeTabs({ current }: { current: number }) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {RANGES.map((r) => (
        <Link
          key={r.days}
          href={r.days === 30 ? "/analytics" : `/analytics?range=${r.days}`}
          className={cn(
            "rounded px-3 py-1 text-xs transition-colors",
            current === r.days
              ? "bg-primary text-primary-foreground font-medium"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );
}