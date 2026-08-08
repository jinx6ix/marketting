import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RecommendationActions } from "@/features/strategies/components/strategy-actions";
import { DeleteButton } from "@/components/delete-button";
import { deleteStrategy } from "@/features/strategies/actions";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Strategy" };

const CATEGORY_LABELS: Record<string, string> = {
  gap_destination: "Destination gap",
  gap_content_type: "Content-type gap",
  gap_timing: "Timing gap",
  gap_audience: "Audience gap",
  gap_hashtag: "Hashtag gap",
  action: "Action",
};

interface SuggestedCreateItem {
  type?: string;
  platforms?: string[];
  title?: string;
  body_draft?: string;
  hashtags?: string[];
  best_time?: string;
  destination?: string;
}

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { orgId, supabase } = await getSessionContext();

  const { data: strategy } = await supabase
    .from("ai_strategies")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId!)
    .single();
  if (!strategy) notFound();

  const { data: recommendations } = await supabase
    .from("ai_recommendations")
    .select("*")
    .eq("strategy_id", id)
    .order("priority")
    .order("created_at");

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strategy.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={strategy.status} />
            <span>· {relativeTime(strategy.created_at)}</span>
            {strategy.provider && (
              <span>
                · {strategy.provider}/{strategy.model}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
        <DeleteButton
  label={strategy.title}
  confirmText="Delete strategy?"
  variant="outline"
  onDelete={deleteStrategy.bind(null, id)}
/>
          <Link href="/strategies" className="text-sm text-primary hover:underline">
            ← All strategies
          </Link>
        </div>
      </div>

      {strategy.status === "failed" && (
        <Card className="border-destructive/50">
          <CardContent className="py-4 text-sm text-destructive">
            {strategy.error ?? "Generation failed"}
          </CardContent>
        </Card>
      )}

      {strategy.status === "running" && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Generating… refresh in a few seconds.
          </CardContent>
        </Card>
      )}

      {strategy.summary && (
        <Card>
          <CardHeader>
            <CardTitle>Executive summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{strategy.summary}</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {(recommendations ?? []).map((rec) => {
          const suggestion = (
            rec.suggested_action as { create_item?: SuggestedCreateItem } | null
          )?.create_item;
          return (
            <Card key={rec.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">P{rec.priority}</Badge>
                      <Badge variant="secondary">
                        {CATEGORY_LABELS[rec.category] ?? rec.category}
                      </Badge>
                      <StatusBadge status={rec.status} />
                    </div>
                    <CardTitle className="mt-2 text-base">{rec.title}</CardTitle>
                    {rec.rationale && (
                      <CardDescription className="mt-1">
                        {rec.rationale}
                      </CardDescription>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {suggestion && (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Suggested draft
                      </span>
                      {suggestion.platforms?.map((p) => (
                        <Badge key={p} variant="outline">
                          {p}
                        </Badge>
                      ))}
                      {suggestion.best_time && (
                        <span>· best time: {suggestion.best_time}</span>
                      )}
                      {suggestion.destination && (
                        <span>· {suggestion.destination}</span>
                      )}
                    </div>
                    {suggestion.title && (
                      <p className="font-medium">{suggestion.title}</p>
                    )}
                    {suggestion.body_draft && (
                      <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-muted-foreground">
                        {suggestion.body_draft}
                      </p>
                    )}
                    {suggestion.hashtags && suggestion.hashtags.length > 0 && (
                      <p className="mt-1.5 text-primary">
                        {suggestion.hashtags.map((h) => `#${h}`).join(" ")}
                      </p>
                    )}
                  </div>
                )}
                <RecommendationActions
                  id={rec.id}
                  status={rec.status}
                  createdItemId={rec.created_item_id}
                />
              </CardContent>
            </Card>
          );
        })}
        {(recommendations ?? []).length === 0 &&
          strategy.status === "completed" && (
            <p className="text-sm text-muted-foreground">
              No recommendations were produced.
            </p>
          )}
      </div>
    </div>
  );
}
