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
import { GenerateStrategyButton } from "@/features/strategies/components/strategy-actions";
import { DeleteButton } from "@/components/delete-button";
import { deleteStrategy } from "@/features/strategies/actions";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Strategies" };

const KIND_LABELS: Record<string, string> = {
  gap_analysis: "Gap analysis",
  content_plan: "Content plan",
  posting_schedule: "Posting schedule",
  competitor_report: "Competitor report",
};

export default async function StrategiesPage() {
  const { orgId, supabase } = await getSessionContext();

  const { data: strategies } = await supabase
    .from("ai_strategies")
    .select("*, ai_recommendations(id, status)")
    .eq("org_id", orgId!)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">AI Strategies</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Gap analysis against your tracked competitors, with actionable
            recommendations
          </p>
        </div>
        <GenerateStrategyButton />
      </div>

      <div className="space-y-3">
        {(strategies ?? []).map((s) => {
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
        {(strategies ?? []).length === 0 && (
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
