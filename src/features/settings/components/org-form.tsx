"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOrganization } from "@/features/settings/actions";

export function OrgForm({
  initial,
  readOnly,
}: {
  initial: { name: string; timezone: string; industry_niche: string[] };
  readOnly: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [niche, setNiche] = useState(initial.industry_niche.join(", "));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
