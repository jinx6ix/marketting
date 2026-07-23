"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import type { Platform } from "@/types/database";

const PLATFORMS = Object.keys(PLATFORM_LABELS) as Platform[];

/**
 * Build a UTM-tagged link for campaign posts so bookings can be attributed
 * in your web analytics (utm_campaign = campaign slug).
 */
export function UtmBuilder({ campaignName }: { campaignName: string }) {
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<Platform>("instagram");
  const [copied, setCopied] = useState(false);

  const campaignSlug = campaignName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const tagged = useMemo(() => {
    if (!url.trim()) return "";
    try {
      const u = new URL(url.trim());
      u.searchParams.set("utm_source", source);
      u.searchParams.set("utm_medium", "social");
      u.searchParams.set("utm_campaign", campaignSlug || "campaign");
      return u.toString();
    } catch {
      return "";
    }
  }, [url, source, campaignSlug]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="utm-url">Landing page URL</Label>
          <Input
            id="utm-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://jaetravel.com/tours/bali-5d"
          />
        </div>
        <div className="w-36 space-y-1.5">
          <Label>Platform</Label>
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value as Platform)}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {url.trim() && !tagged && (
        <p className="text-sm text-destructive">
          Enter a full URL including https://
        </p>
      )}
      {tagged && (
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">
            {tagged}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(tagged);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Paste the tagged link into your post copy — bookings from it will show
        up in your web analytics under{" "}
        <code>utm_campaign={campaignSlug || "…"}</code>.
      </p>
    </div>
  );
}
