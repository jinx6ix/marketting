import Link from "next/link";
import { Plug } from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import { DisconnectButton } from "@/features/settings/components/disconnect-button";
import type { Platform } from "@/types/database";

export const metadata = { title: "Connected accounts" };

const PLATFORMS = Object.keys(PLATFORM_LABELS) as Platform[];

const PLATFORM_NOTES: Partial<Record<Platform, string>> = {
  facebook: "Connects your Facebook Pages.",
  instagram: "Requires an Instagram Business account linked to a Facebook Page.",
  x: "Free tier is write-only; mentions and metrics need the paid Basic tier.",
  tiktok: "Unaudited apps can only post as private/self-view.",
  youtube: "Uses your Google account; competitor channels use the public API.",
  linkedin: "Posts to your member profile or organization pages.",
  pinterest: "Creates pins on your boards.",
};

export default async function AccountsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const { connected, error } = await searchParams;

  const { data: accounts } = await supabase
    .from("social_accounts")
    .select(
      "id, platform, handle, display_name, avatar_url, status, token_expires_at, created_at"
    )
    .eq("org_id", orgId!)
    .order("platform");

  const byPlatform = new Map<Platform, NonNullable<typeof accounts>>();
  for (const account of accounts ?? []) {
    const list = byPlatform.get(account.platform) ?? [];
    list.push(account);
    byPlatform.set(account.platform, list);
  }

  const mockMode = process.env.SOCIAL_MOCK === "1";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Connected accounts</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Connect the social profiles you publish to. Tokens are encrypted at
          rest and refreshed automatically.
        </p>
      </div>

      {connected && (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
          {PLATFORM_LABELS[connected as Platform] ?? connected} connected
          successfully.
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Connection failed: {error}
        </p>
      )}
      {mockMode && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <strong>Mock mode is on</strong> (SOCIAL_MOCK=1) — connecting creates a
          fake account and publishing is simulated. Turn it off in .env.local
          once real platform credentials are configured.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {PLATFORMS.map((platform) => {
          const platformAccounts = byPlatform.get(platform) ?? [];
          return (
            <Card key={platform}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {PLATFORM_LABELS[platform]}
                  </CardTitle>
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      href={`/api/social/${platform}/connect`}
                      className="flex items-center gap-1.5"
                    >
                      <Plug className="size-3.5" />
                      {platformAccounts.length > 0 ? "Add another" : "Connect"}
                    </Link>
                  </Button>
                </div>
                {PLATFORM_NOTES[platform] && (
                  <CardDescription>{PLATFORM_NOTES[platform]}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {platformAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between gap-2 rounded-md border p-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {account.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={account.avatar_url}
                          alt=""
                          className="size-8 shrink-0 rounded-full"
                        />
                      ) : (
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {(account.display_name ?? account.handle ?? "?")
                            .slice(0, 1)
                            .toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 text-sm">
                        <div className="truncate font-medium">
                          {account.display_name ?? account.handle ?? "Account"}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {account.handle && <span>@{account.handle}</span>}
                          <StatusBadge status={account.status} />
                          {account.token_expires_at && (
                            <span>
                              · token expires{" "}
                              {new Date(
                                account.token_expires_at
                              ).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <DisconnectButton
                      platform={platform}
                      accountId={account.id}
                      label={
                        account.display_name ??
                        account.handle ??
                        PLATFORM_LABELS[platform]
                      }
                    />
                  </div>
                ))}
                {platformAccounts.length === 0 && (
                  <p className="text-sm text-muted-foreground">Not connected.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
