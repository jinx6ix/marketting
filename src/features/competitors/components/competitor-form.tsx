"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import { createCompetitor } from "@/features/competitors/actions";
import type { Platform } from "@/types/database";

const PLATFORMS = Object.keys(PLATFORM_LABELS) as Platform[];

interface AccountRow {
  platform: Platform;
  handle: string;
  profile_url: string;
}

export function CompetitorForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [destinations, setDestinations] = useState("");
  const [accounts, setAccounts] = useState<AccountRow[]>([
    { platform: "instagram", handle: "", profile_url: "" },
  ]);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createCompetitor({
        name,
        notes: notes || undefined,
        niche: [],
        destinations: destinations
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
        accounts: accounts
          .filter((a) => a.handle.trim())
          .map((a) => ({
            platform: a.platform,
            handle: a.handle,
            profile_url: a.profile_url || "",
          })),
      });
      if (result.error) setError(result.error);
      else router.push(`/competitors/${result.id}`);
    });
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Add competitor</CardTitle>
        <CardDescription>
          Track a rival agency&apos;s accounts — snapshots are polled
          automatically where the platform allows, or entered manually.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="comp-name">Name</Label>
          <Input
            id="comp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Island Dreams Travel"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="comp-destinations">Destinations (comma-separated)</Label>
          <Input
            id="comp-destinations"
            value={destinations}
            onChange={(e) => setDestinations(e.target.value)}
            placeholder="Bali, Santorini, Phuket"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="comp-notes">Notes</Label>
          <Textarea
            id="comp-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Their strengths, target audience…"
          />
        </div>

        <div className="space-y-2">
          <Label>Accounts</Label>
          {accounts.map((account, i) => (
            <div key={i} className="flex gap-2">
              <Select
                value={account.platform}
                className="w-36"
                onChange={(e) =>
                  setAccounts((prev) =>
                    prev.map((a, j) =>
                      j === i ? { ...a, platform: e.target.value as Platform } : a
                    )
                  )
                }
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </option>
                ))}
              </Select>
              <Input
                value={account.handle}
                placeholder="@handle"
                className="flex-1"
                onChange={(e) =>
                  setAccounts((prev) =>
                    prev.map((a, j) =>
                      j === i ? { ...a, handle: e.target.value } : a
                    )
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Remove account"
                onClick={() =>
                  setAccounts((prev) => prev.filter((_, j) => j !== i))
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setAccounts((prev) => [
                ...prev,
                { platform: "instagram", handle: "", profile_url: "" },
              ])
            }
          >
            <Plus /> Add account
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {pending ? "Saving…" : "Save competitor"}
          </Button>
          <Button variant="ghost" onClick={() => router.push("/competitors")}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
