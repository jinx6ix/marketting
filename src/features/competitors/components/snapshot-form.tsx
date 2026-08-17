"use client";

import { useState, useTransition } from "react";
import { Trash2, Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  addManualSnapshot,
  deleteCompetitor,
  setCompetitorActive,
} from "@/features/competitors/actions";

/** Manual snapshot entry for platforms without public APIs. */
export function ManualSnapshotForm({
  accounts,
}: {
  accounts: { id: string; label: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [followers, setFollowers] = useState("");
  const [postsCount, setPostsCount] = useState("");
  const [avgEngagement, setAvgEngagement] = useState("");

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add an account first to record snapshots.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Account</Label>
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="ms-followers">Followers</Label>
          <Input
            id="ms-followers"
            inputMode="numeric"
            value={followers}
            onChange={(e) => setFollowers(e.target.value)}
            placeholder="12400"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ms-posts">Posts</Label>
          <Input
            id="ms-posts"
            inputMode="numeric"
            value={postsCount}
            onChange={(e) => setPostsCount(e.target.value)}
            placeholder="310"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ms-eng">Avg. engagement</Label>
          <Input
            id="ms-eng"
            inputMode="decimal"
            value={avgEngagement}
            onChange={(e) => setAvgEngagement(e.target.value)}
            placeholder="245"
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-success">Snapshot recorded.</p>}
      <Button
        size="sm"
        disabled={pending || !accountId}
        onClick={() => {
          setError(null);
          setSaved(false);
          startTransition(async () => {
            const result = await addManualSnapshot({
              competitor_account_id: accountId,
              followers: followers || undefined,
              posts_count: postsCount || undefined,
              avg_engagement: avgEngagement || undefined,
            });
            if (result.error) setError(result.error);
            else {
              setSaved(true);
              setFollowers("");
              setPostsCount("");
              setAvgEngagement("");
            }
          });
        }}
      >
        {pending ? "Saving…" : "Record snapshot"}
      </Button>
    </div>
  );
}

export function ArchiveCompetitorButton({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => setCompetitorActive(id, !active).then(() => {}))}
    >
      {active ? (
        <>
          <Archive /> Archive
        </>
      ) : (
        <>
          <ArchiveRestore /> Reactivate
        </>
      )}
    </Button>
  );
}

export function DeleteCompetitorButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      disabled={pending}
      onClick={() => {
        if (confirm(`Delete competitor "${name}" and all its data?`)) {
          startTransition(() => deleteCompetitor(id).then(() => {}));
        }
      }}
    >
      <Trash2 /> Delete
    </Button>
  );
}