import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatNumber } from "@/lib/utils";

export function StatTile({
  label,
  value,
  delta,
  deltaLabel = "vs 30d ago",
  format = "number",
}: {
  label: string;
  value: number | string | null | undefined;
  delta?: number | null;
  deltaLabel?: string;
  format?: "number" | "raw";
}) {
  const display =
    typeof value === "number" && format === "number"
      ? formatNumber(value)
      : (value ?? "—");

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{display}</div>
        {delta != null && (
          <div
            className={cn(
              "mt-1 flex items-center gap-1 text-xs",
              delta > 0
                ? "text-success"
                : delta < 0
                  ? "text-destructive"
                  : "text-muted-foreground"
            )}
          >
            {delta > 0 ? (
              <ArrowUpRight className="size-3" />
            ) : delta < 0 ? (
              <ArrowDownRight className="size-3" />
            ) : (
              <Minus className="size-3" />
            )}
            {delta > 0 ? "+" : ""}
            {formatNumber(delta)} {deltaLabel}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
