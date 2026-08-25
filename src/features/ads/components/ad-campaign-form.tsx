"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createAdCampaign } from "@/features/ads/actions";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import { cn } from "@/lib/utils";
import type { Platform } from "@/types/database";

const OBJECTIVES = [
  { value: "awareness", label: "Awareness" },
  { value: "traffic", label: "Traffic" },
  { value: "engagement", label: "Engagement" },
  { value: "leads", label: "Leads" },
  { value: "conversions", label: "Conversions" },
  { value: "bookings", label: "Bookings" },
];

const LIVE_PLATFORMS: Platform[] = ["facebook", "instagram"];

interface AccountOption {
  id: string;
  platform: Platform;
  handle: string | null;
  display_name: string | null;
}
interface ItemOption {
  id: string;
  title: string;
}

export function AdCampaignForm({
  accounts,
  items,
}: {
  accounts: AccountOption[];
  items: ItemOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [objective, setObjective] = useState("awareness");
  const [mode, setMode] = useState<"internal" | "live">("internal");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [targetingNotes, setTargetingNotes] = useState("");
  const [destination, setDestination] = useState("");
  const [linkedItemId, setLinkedItemId] = useState("");
  const [socialAccountId, setSocialAccountId] = useState("");
  const [metaAdAccountId, setMetaAdAccountId] = useState("");

  const liveEligibleAccounts = accounts.filter((a) => LIVE_PLATFORMS.includes(a.platform));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createAdCampaign({
        name,
        platform,
        objective,
        management_mode: mode,
        budget: budget ? Number(budget) : null,
        currency,
        start_date: startDate || null,
        end_date: endDate || null,
        targeting_notes: targetingNotes || null,
        destination: destination || null,
        linked_item_id: linkedItemId || null,
        social_account_id: mode === "live" ? socialAccountId || null : null,
        meta_ad_account_id: mode === "live" ? metaAdAccountId || null : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/ads/${result.id}`);
      router.refresh();
    });
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Campaign details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Maasai Mara safari — August push" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                {(["facebook", "instagram", "x", "tiktok", "youtube", "linkedin", "pinterest"] as Platform[]).map(
                  (p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABELS[p]}
                    </option>
                  )
                )}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Objective</Label>
              <Select value={objective} onChange={(e) => setObjective(e.target.value)}>
                {OBJECTIVES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Budget</Label>
              <Input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="500"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
            <div className="space-y-1.5">
              <Label>Destination</Label>
              <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Maasai Mara" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Targeting notes</Label>
            <Textarea
              value={targetingNotes}
              onChange={(e) => setTargetingNotes(e.target.value)}
              rows={3}
              placeholder="Age 28-55, interested in East Africa travel, past website visitors…"
            />
          </div>

          {items.length > 0 && (
            <div className="space-y-1.5">
              <Label>Linked creative (optional)</Label>
              <Select value={linkedItemId} onChange={(e) => setLinkedItemId(e.target.value)}>
                <option value="">None</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Management mode</CardTitle>
          <CardDescription>How should this campaign actually run?</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("internal")}
              className={cn(
                "rounded-md border p-3 text-left text-sm",
                mode === "internal" ? "border-primary bg-primary/5" : "hover:bg-accent"
              )}
            >
              <div className="font-medium">Internal tracker</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Plan budget, dates, and targeting here. You run the ad
                yourself and enter performance numbers manually.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode("live")}
              className={cn(
                "rounded-md border p-3 text-left text-sm",
                mode === "live" ? "border-primary bg-primary/5" : "hover:bg-accent"
              )}
            >
              <div className="font-medium">Live via Meta</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Actually creates the campaign on Meta and pulls real
                performance. Requires ads_management permission — see note
                below.
              </div>
            </button>
          </div>

          {mode === "live" && (
            <div className="space-y-3 rounded-md border border-dashed p-3">
              <p className="text-xs text-muted-foreground">
                This needs a connected Facebook/Instagram account whose
                token has Meta&apos;s <code>ads_management</code> permission
                (a separate, harder approval than ordinary posting access —
                Meta requires business verification for it), plus your
                numeric Ad Account ID from Business Manager. If the
                permission isn&apos;t there yet, the campaign still saves —
                it just won&apos;t launch until you add it.
              </p>
              {liveEligibleAccounts.length === 0 ? (
                <p className="text-xs text-destructive">
                  No connected Facebook/Instagram accounts found — connect one
                  under Settings → Accounts first.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <Label>Connected account</Label>
                  <Select
                    value={socialAccountId}
                    onChange={(e) => setSocialAccountId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {liveEligibleAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {PLATFORM_LABELS[a.platform]} — {a.display_name ?? a.handle}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Meta Ad Account ID</Label>
                <Input
                  value={metaAdAccountId}
                  onChange={(e) => setMetaAdAccountId(e.target.value)}
                  placeholder="123456789012345"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={submit} disabled={pending || !name.trim()}>
        {pending ? "Creating…" : "Create campaign"}
      </Button>
    </div>
  );
}