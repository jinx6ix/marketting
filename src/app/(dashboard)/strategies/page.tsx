import Link from "next/link";
import { getSessionContext } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatTile } from "@/components/charts/stat-tile";
import { GenerateStrategyButton } from "@/features/strategies/components/strategy-actions";
import { DeleteButton } from "@/components/delete-button";
import { deleteStrategy } from "@/features/strategies/actions";
import { cn, relativeTime } from "@/lib/utils";

export const metadata = { title: "Strategies" };

const KIND_LABELS: Record<string, string> = {
  gap_analysis: "Gap analysis",
  content_plan: "Content plan",
  posting_schedule: "Posting schedule",
  competitor_report: "Competitor report",
};

type StatusFilter = "all" | "completed" | "running" | "failed";

export default async function StrategiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const { status: statusParam } = await searchParams;
  const status: StatusFilter =
    statusParam === "completed" || statusParam === "running" || statusParam === "failed"
      ? statusParam
      : "all";

  const { data: allStrategies } = await supabase
    .from("ai_strategies")
    .select("*, ai_recommendations(id, status)")
    .eq("org_id", orgId!)
    .order("created_at", { ascending: false })
    .limit(50);

  const strategies = allStrategies ?? [];
  const completedCount = strategies.filter((s) => s.status === "completed").length;
  const runningCount = strategies.filter((s) => s.status === "running").length;
  const failedCount = strategies.filter((s) => s.status === "failed").length;
  const openRecsTotal = strategies.reduce(
    (sum, s) =>
      sum + (s.ai_recommendations ?? []).filter((r) => r.status === "proposed").length,
    0
  );

  const visible =
    status === "all" ? strategies : strategies.filter((s) => s.status === status);

  const TABS: { label: string; value: StatusFilter; count: number }[] = [
    { label: "All", value: "all", count: strategies.length },
    { label: "Completed", value: "completed", count: completedCount },
    { label: "Running", value: "running", count: runningCount },
    { label: "Failed", value: "failed", count: failedCount },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI Strategies</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Gap analysis against your tracked competitors, with actionable
            recommendations
          </p>
        </div>
        <GenerateStrategyButton />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Completed" value={completedCount} format="raw" />
        <StatTile label="Open recommendations" value={openRecsTotal} format="raw" />
        <StatTile label="Failed" value={failedCount} format="raw" />
      </div>

      <div className="inline-flex rounded-md border p-0.5">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={t.value === "all" ? "/strategies" : `/strategies?status=${t.value}`}
            className={cn(
              "rounded px-3 py-1 text-xs transition-colors",
              status === t.value
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            {t.label} ({t.count})
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        {visible.map((s) => {
          const recs = s.ai_recommendations ?? [];
          const open = recs.filter((r) => r.status === "proposed").length;
          const accepted = recs.filter((r) =>
            ["accepted", "done"].includes(r.status)
          ).length;
          return (
            <div key={s.id} className="relative">
              <Link href={`/strategies/${s.id}`} className="block">
                <Card className="transition-colors hover:border-primary/50">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{s.title}</CardTitle>
                        <CardDescription>
                          {KIND_LABELS[s.kind] ?? s.kind} ·{" "}
                          {relativeTime(s.created_at)}
                          {s.model && <> · {s.model}</>}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={s.status} />
                        <DeleteButton
                          label={s.title}
                          confirmText="Delete?"
                          onDelete={deleteStrategy.bind(null, s.id)}
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {s.status === "failed" ? (
                      <span className="text-destructive">{s.error}</span>
                    ) : s.status === "running" ? (
                      <span>Generating — this can take a few minutes.</span>
                    ) : (
                      <>
                        {s.summary && <p className="line-clamp-2">{s.summary}</p>}
                        {recs.length > 0 && (
                          <p className="mt-2 text-xs">
                            {recs.length} recommendations · {open} open ·{" "}
                            {accepted} accepted
                          </p>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </Link>
            </div>
          );
        })}
        {visible.length === 0 && strategies.length > 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No {status} strategies.
            </CardContent>
          </Card>
        )}
        {strategies.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No strategies yet. Connect accounts, track a few competitors, then
              generate your first gap analysis.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}