import { notFound } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/supabase/server";
import { Composer } from "@/features/marketing-items/components/composer";
import { ApprovalBar } from "@/features/marketing-items/components/approval-bar";
import { PublishNowButton } from "@/features/marketing-items/components/publish-now-button";
import { DeleteButton } from "@/components/delete-button";
import { deleteItem } from "@/features/marketing-items/actions";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import { formatNumber } from "@/lib/utils";
import type { ItemFormValues } from "@/features/marketing-items/schemas";
import type { Platform } from "@/types/database";

export const metadata = { title: "Item" };

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, orgId, supabase } = await getSessionContext();

  const { data: item } = await supabase
    .from("marketing_items")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId!)
    .single();
  if (!item) notFound();

  const [{ data: targets }, { data: membership }] = await Promise.all([
    supabase
      .from("post_targets")
      .select("*, social_accounts(handle, display_name)")
      .eq("item_id", id),
    supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId!)
      .eq("user_id", user!.id)
      .single(),
  ]);
  const canApprove = ["owner", "admin"].includes(membership?.role ?? "");

  const editable = ["draft", "scheduled", "failed"].includes(item.status);

  if (editable) {
    const [{ data: accounts }, { data: campaigns }] = await Promise.all([
      supabase
        .from("social_accounts")
        .select("id, platform, handle, display_name")
        .eq("org_id", orgId!)
        .eq("status", "active")
        .order("platform"),
      supabase
        .from("campaigns")
        .select("id, name")
        .eq("org_id", orgId!)
        .order("name"),
    ]);

    const initial: Partial<ItemFormValues> = {
      type: item.type,
      title: item.title,
      body: item.body,
      campaign_id: item.campaign_id,
      destination: item.destination ?? undefined,
      hashtags: item.hashtags,
      media: item.media as ItemFormValues["media"],
      promo: item.promo as ItemFormValues["promo"],
      scheduled_at: item.scheduled_at,
      targets: (targets ?? []).map((t) => ({
        social_account_id: t.social_account_id,
        platform: t.platform,
        variant_body: t.variant_body,
      })),
    };

    return (
      <div className="space-y-4">
        {["draft", "failed"].includes(item.status) && (
          <ApprovalBar itemId={id} status={item.status} canApprove={canApprove} />
        )}
        <div className="flex items-center justify-between gap-2">
          {(targets ?? []).length > 0 && <PublishNowButton itemId={id} />}
          <DeleteButton
            label={item.title}
            confirmText="Delete item?"
            variant="outline"
            onDelete={() => deleteItem(id)}
            className="ml-auto"
          />
        </div>
        <Composer
          orgId={orgId!}
          itemId={id}
          initial={initial}
          accounts={(accounts ?? []) as { id: string; platform: Platform; handle: string | null; display_name: string | null }[]}
          campaigns={campaigns ?? []}
        />
      </div>
    );
  }
  // Published/read-only view with per-target results + latest metrics
  const targetIds = (targets ?? []).map((t) => t.id);
  const { data: snapshots } = targetIds.length
    ? await supabase
        .from("post_metric_snapshots")
        .select("post_target_id, likes, comments, shares, impressions, captured_at")
        .in("post_target_id", targetIds)
        .order("captured_at", { ascending: false })
    : { data: [] };

  const latestByTarget = new Map<string, NonNullable<typeof snapshots>[number]>();
  for (const s of snapshots ?? []) {
    if (!latestByTarget.has(s.post_target_id)) latestByTarget.set(s.post_target_id, s);
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-lg font-semibold sm:text-xl">
            {item.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={item.status} />
            {item.destination && <span>· {item.destination}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {item.status !== "archived" && (
            <PublishNowButton itemId={id} />
          )}
          <DeleteButton
            label={item.title}
            confirmText="Delete strategy?"
            variant="outline"
            onDelete={deleteItem.bind(null, id)}
          />
          <Link href="/items" className="text-sm text-primary hover:underline">
            ← All items
          </Link>
        </div>
      </div>

      {item.status === "in_review" && (
        <ApprovalBar itemId={id} status={item.status} canApprove={canApprove} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Copy</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap break-words text-sm">{item.body}</p>
          {item.hashtags.length > 0 && (
            <p className="mt-3 break-words text-sm text-primary">
              {item.hashtags.map((h) => `#${h}`).join(" ")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Publish results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Platform</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Likes</TableHead>
                <TableHead>Comments</TableHead>
                <TableHead>Impressions</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(targets ?? []).map((t) => {
                const m = latestByTarget.get(t.id);
                const account = t.social_accounts as {
                  handle: string | null;
                  display_name: string | null;
                } | null;
                const retryable =
                  t.status === "failed" || t.status === "skipped";
                return (
                  <TableRow key={t.id}>
                    <TableCell>{PLATFORM_LABELS[t.platform as Platform]}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {account?.handle ?? account?.display_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                      {t.error && (
                        <div className="mt-1 max-w-52 truncate text-xs text-destructive" title={t.error}>
                          {t.error}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{formatNumber(m?.likes)}</TableCell>
                    <TableCell>{formatNumber(m?.comments)}</TableCell>
                    <TableCell>{formatNumber(m?.impressions)}</TableCell>
                    <TableCell>
                      {t.external_url ? (
                        <a
                          href={t.external_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {retryable ? (
                        <PublishNowButton
                          itemId={id}
                          label="Retry"
                          icon="retry"
                          variant="outline"
                        />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
