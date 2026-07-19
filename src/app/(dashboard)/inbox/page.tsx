import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  MentionActions,
  MarkAllReadButton,
} from "@/features/inbox/components/mention-actions";
import { KeywordsPanel } from "@/features/inbox/components/keywords-panel";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import { cn, relativeTime } from "@/lib/utils";
import type { MentionKind, Platform, Sentiment } from "@/types/database";

export const metadata = { title: "Inbox" };

const SENTIMENT_VARIANT: Record<Sentiment, "success" | "secondary" | "destructive"> = {
  positive: "success",
  neutral: "secondary",
  negative: "destructive",
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; kind?: string; platform?: string }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const { filter, kind, platform } = await searchParams;

  let query = supabase
    .from("mentions")
    .select("*")
    .eq("org_id", orgId!)
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (filter === "unread") query = query.eq("is_read", false);
  if (filter === "unreplied") query = query.eq("replied", false);
  if (kind) query = query.eq("kind", kind as MentionKind);
  if (platform) query = query.eq("platform", platform as Platform);

  const [{ data: mentions }, { data: keywords }, { count: unreadCount }] =
    await Promise.all([
      query,
      supabase
        .from("tracked_keywords")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at"),
      supabase
        .from("mentions")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId!)
        .eq("is_read", false),
    ]);

  const withParam = (key: string, value?: string) => {
    const params = new URLSearchParams();
    if (filter) params.set("filter", filter);
    if (kind) params.set("kind", kind);
    if (platform) params.set("platform", platform);
    if (value) params.set(key, value);
    else params.delete(key);
    const s = params.toString();
    return s ? `/inbox?${s}` : "/inbox";
  };

  const FILTERS = [
    { label: "All", href: withParam("filter") },
    { label: "Unread", href: withParam("filter", "unread") },
    { label: "Unreplied", href: withParam("filter", "unreplied") },
  ];
  const KINDS = [
    { label: "Any kind", href: withParam("kind") },
    { label: "Mentions", href: withParam("kind", "mention") },
    { label: "Comments", href: withParam("kind", "comment") },
    { label: "Keywords", href: withParam("kind", "keyword_match") },
    { label: "Reviews", href: withParam("kind", "review") },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Inbox</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {unreadCount ?? 0} unread
          </p>
        </div>
        <MarkAllReadButton disabled={(unreadCount ?? 0) === 0} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Link
                key={f.label}
                href={f.href}
                className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
              >
                {f.label}
              </Link>
            ))}
            <span className="mx-1 border-l" />
            {KINDS.map((f) => (
              <Link
                key={f.label}
                href={f.href}
                className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
              >
                {f.label}
              </Link>
            ))}
          </div>

          <div className="space-y-3">
            {(mentions ?? []).map((m) => (
              <Card
                key={m.id}
                className={cn(!m.is_read && "border-primary/40 bg-primary/[0.03]")}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      {m.author_avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.author_avatar_url}
                          alt=""
                          className="size-7 shrink-0 rounded-full"
                        />
                      ) : (
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {(m.author_name ?? m.author_handle ?? "?")
                            .slice(0, 1)
                            .toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <span className="font-medium">
                          {m.author_name ?? m.author_handle ?? "Unknown"}
                        </span>
                        {m.author_handle && m.author_name && (
                          <span className="ml-1.5 text-muted-foreground">
                            @{m.author_handle}
                          </span>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {PLATFORM_LABELS[m.platform as Platform] ?? m.platform} ·{" "}
                          {m.kind.replace("_", " ")}
                          {m.occurred_at && <> · {relativeTime(m.occurred_at)}</>}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {m.sentiment && (
                        <Badge variant={SENTIMENT_VARIANT[m.sentiment]}>
                          {m.sentiment}
                        </Badge>
                      )}
                      {m.replied && <Badge variant="outline">replied</Badge>}
                    </div>
                  </div>

                  {m.content && (
                    <p className="mt-3 whitespace-pre-wrap text-sm">{m.content}</p>
                  )}

                  <div className="mt-3 flex items-center justify-between">
                    <MentionActions
                      id={m.id}
                      isRead={m.is_read}
                      replied={m.replied}
                    />
                    {m.external_url && (
                      <a
                        href={m.external_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Open on platform <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {(mentions ?? []).length === 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No mentions match this filter. Mentions are collected by the
                monitoring job from connected platforms and tracked keywords.
              </p>
            )}
          </div>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Tracked keywords</CardTitle>
              <CardDescription>
                Destinations, hashtags, and brand terms monitored across
                platforms
              </CardDescription>
            </CardHeader>
            <CardContent>
              <KeywordsPanel keywords={keywords ?? []} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
