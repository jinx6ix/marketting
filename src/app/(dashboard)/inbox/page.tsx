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
import { StatTile } from "@/components/charts/stat-tile";
import {
  MentionActions,
  MarkAllReadButton,
} from "@/features/inbox/components/mention-actions";
import { KeywordsPanel } from "@/features/inbox/components/keywords-panel";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import { cn, daysAgoIso, relativeTime } from "@/lib/utils";
import type { MentionKind, Platform, Sentiment } from "@/types/database";

export const metadata = { title: "Inbox" };

const SENTIMENT_VARIANT: Record<Sentiment, "success" | "secondary" | "destructive"> = {
  positive: "success",
  neutral: "secondary",
  negative: "destructive",
};

const ALL_PLATFORMS: Platform[] = [
  "facebook",
  "instagram",
  "x",
  "tiktok",
  "youtube",
  "linkedin",
  "pinterest",
];

const PAGE_SIZE = 25;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    kind?: string;
    platform?: string;
    sentiment?: string;
    page?: string;
  }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const { filter, kind, platform, sentiment, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("mentions")
    .select("*", { count: "exact" })
    .eq("org_id", orgId!)
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .range(from, from + PAGE_SIZE - 1);
  if (filter === "unread") query = query.eq("is_read", false);
  if (filter === "unreplied") query = query.eq("replied", false);
  if (kind) query = query.eq("kind", kind as MentionKind);
  if (platform) query = query.eq("platform", platform as Platform);
  if (sentiment) query = query.eq("sentiment", sentiment as Sentiment);

  const since30 = daysAgoIso(30);

  const [
    { data: mentions, count: totalCount },
    { data: keywords },
    { count: unreadCount },
    { count: unrepliedCount },
    { count: last30Count },
  ] = await Promise.all([
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
    supabase
      .from("mentions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId!)
      .eq("replied", false),
    supabase
      .from("mentions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId!)
      .gte("occurred_at", since30),
  ]);

  const withParam = (key: string, value?: string) => {
    const params = new URLSearchParams();
    if (filter) params.set("filter", filter);
    if (kind) params.set("kind", kind);
    if (platform) params.set("platform", platform);
    if (sentiment) params.set("sentiment", sentiment);
    if (value) params.set(key, value);
    else params.delete(key);
    const s = params.toString();
    return s ? `/inbox?${s}` : "/inbox";
  };

  const totalPages = Math.max(1, Math.ceil((totalCount ?? 0) / PAGE_SIZE));

  const FILTERS = [
    { label: "All", value: undefined, href: withParam("filter") },
    { label: "Unread", value: "unread", href: withParam("filter", "unread") },
    { label: "Unreplied", value: "unreplied", href: withParam("filter", "unreplied") },
  ];
  const KINDS = [
    { label: "Any kind", value: undefined, href: withParam("kind") },
    { label: "Mentions", value: "mention", href: withParam("kind", "mention") },
    { label: "Comments", value: "comment", href: withParam("kind", "comment") },
    { label: "Keywords", value: "keyword_match", href: withParam("kind", "keyword_match") },
    { label: "Reviews", value: "review", href: withParam("kind", "review") },
  ];
  const SENTIMENTS = [
    { label: "Any sentiment", value: undefined, href: withParam("sentiment") },
    { label: "Positive", value: "positive", href: withParam("sentiment", "positive") },
    { label: "Neutral", value: "neutral", href: withParam("sentiment", "neutral") },
    { label: "Negative", value: "negative", href: withParam("sentiment", "negative") },
  ];

  return (
    <div className="space-y-6">
      <RealtimeRefresher table="mentions" orgId={orgId!} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Mentions, comments, keyword matches, and reviews collected across
            connected platforms
          </p>
        </div>
        <MarkAllReadButton disabled={(unreadCount ?? 0) === 0} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Unread" value={unreadCount ?? 0} format="raw" />
        <StatTile label="Unreplied" value={unrepliedCount ?? 0} format="raw" />
        <StatTile label="Last 30 days" value={last30Count ?? 0} format="raw" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <Link
                  key={f.label}
                  href={f.href}
                  className={cn(
                    "rounded-md border px-3 py-1 text-xs hover:bg-accent",
                    (f.value ?? undefined) === (filter ?? undefined)
                      ? "border-primary bg-primary/10 font-medium"
                      : undefined
                  )}
                >
                  {f.label}
                </Link>
              ))}
              <span className="mx-1 border-l" />
              {KINDS.map((f) => (
                <Link
                  key={f.label}
                  href={f.href}
                  className={cn(
                    "rounded-md border px-3 py-1 text-xs hover:bg-accent",
                    (f.value ?? undefined) === (kind ?? undefined)
                      ? "border-primary bg-primary/10 font-medium"
                      : undefined
                  )}
                >
                  {f.label}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {SENTIMENTS.map((f) => (
                <Link
                  key={f.label}
                  href={f.href}
                  className={cn(
                    "rounded-md border px-3 py-1 text-xs hover:bg-accent",
                    (f.value ?? undefined) === (sentiment ?? undefined)
                      ? "border-primary bg-primary/10 font-medium"
                      : undefined
                  )}
                >
                  {f.label}
                </Link>
              ))}
              <span className="mx-1 border-l" />
              {ALL_PLATFORMS.map((p) => (
                <Link
                  key={p}
                  href={platform === p ? withParam("platform") : withParam("platform", p)}
                  className={cn(
                    "rounded-md border px-3 py-1 text-xs hover:bg-accent",
                    platform === p ? "border-primary bg-primary/10 font-medium" : undefined
                  )}
                >
                  {PLATFORM_LABELS[p]}
                </Link>
              ))}
            </div>
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
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  No mentions match this filter. Mentions are collected by the
                  monitoring job from connected platforms and tracked
                  keywords.
                </CardContent>
              </Card>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex flex-col items-start justify-between gap-2 text-sm sm:flex-row sm:items-center">
              <span className="text-muted-foreground">
                Page {page} of {totalPages} · {totalCount} mentions
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={withParam("page", String(page - 1))}
                    className="rounded-md border px-3 py-1 hover:bg-accent"
                  >
                    ← Newer
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={withParam("page", String(page + 1))}
                    className="rounded-md border px-3 py-1 hover:bg-accent"
                  >
                    Older →
                  </Link>
                )}
              </div>
            </div>
          )}
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