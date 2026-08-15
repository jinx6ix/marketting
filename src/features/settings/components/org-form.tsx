"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOrganization } from "@/features/settings/actions";
import { backfillDefaultHashtags } from "@/features/marketing-items/actions";

export function OrgForm({
  initial,
  readOnly,
}: {
  initial: {
    name: string;
    timezone: string;
    industry_niche: string[];
    default_hashtags: string[];
  };
  readOnly: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [niche, setNiche] = useState(initial.industry_niche.join(", "));
  const [defaultHashtags, setDefaultHashtags] = useState(
    initial.default_hashtags.join(" ")
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [backfillPending, setBackfillPending] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="org-name">Organization name</Label>
        <Input
          id="org-name"
          value={name}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="org-tz">Timezone (IANA)</Label>
        <Input
          id="org-tz"
          value={timezone}
          disabled={readOnly}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="Asia/Manila"
        />
        <p className="text-xs text-muted-foreground">
          Used as the default when scheduling posts.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="org-niche">Niches (comma-separated)</Label>
        <Input
          id="org-niche"
          value={niche}
          disabled={readOnly}
          onChange={(e) => setNiche(e.target.value)}
          placeholder="island hopping, honeymoon packages, adventure"
        />
        <p className="text-xs text-muted-foreground">
          Fed to the AI so generated content and strategies match your business.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="org-default-hashtags">
          Default hashtags (space or comma-separated)
        </Label>
        <Input
          id="org-default-hashtags"
          value={defaultHashtags}
          disabled={readOnly}
          onChange={(e) => setDefaultHashtags(e.target.value)}
          placeholder="#safari #eastafrica #travelmore"
        />
        <p className="text-xs text-muted-foreground">
          Automatically added to every item&apos;s hashtags on save, in
          addition to whatever you add per item.
        </p>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={backfillPending}
            onClick={async () => {
              setBackfillMessage(null);
              setBackfillPending(true);
              const result = await backfillDefaultHashtags();
              setBackfillPending(false);
              setBackfillMessage(
                result.error ??
                  `Applied to ${result.updated ?? 0} existing item${result.updated === 1 ? "" : "s"}.`
              );
            }}
          >
            {backfillPending ? "Applying…" : "Apply to existing items"}
          </Button>
        )}
        {backfillMessage && (
          <p className="text-xs text-muted-foreground">{backfillMessage}</p>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-success">{message}</p>}
      {!readOnly && (
        <Button
          disabled={pending || !name.trim()}
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await updateOrganization({
                name: name.trim(),
                timezone: timezone.trim() || "UTC",
                industry_niche: niche
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                default_hashtags: defaultHashtags
                  .split(/[\s,]+/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
              if (result.error) setError(result.error);
              else setMessage(result.message ?? "Saved.");
            });
          }}
        >
          {pending ? "Saving…" : "Save changes"}
        </Button>
      )}
    </div>
  );
}