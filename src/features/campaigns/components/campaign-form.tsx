"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCampaign, updateCampaign } from "../actions";
import type { CampaignFormValues } from "@/features/marketing-items/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CampaignForm({
  initial,
  campaignId,
}: {
  initial?: Partial<CampaignFormValues>;
  campaignId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<CampaignFormValues>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    objective: initial?.objective,
    destination: initial?.destination ?? "",
    tour_package: initial?.tour_package ?? "",
    start_date: initial?.start_date ?? "",
    end_date: initial?.end_date ?? "",
    budget: initial?.budget,
    status: initial?.status ?? "draft",
  });

  function set<K extends keyof CampaignFormValues>(
    key: K,
    value: CampaignFormValues[K]
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = campaignId
        ? await updateCampaign(campaignId, values)
        : await createCampaign(values);
      if (result.error) setError(result.error);
      else router.push("/campaigns");
    });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{campaignId ? "Edit campaign" : "New campaign"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Summer in the Greek Islands"
          />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            value={values.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Objective</Label>
            <Select
              value={values.objective ?? ""}
              onChange={(e) =>
                set(
                  "objective",
                  (e.target.value || undefined) as CampaignFormValues["objective"]
                )
              }
            >
              <option value="">Select…</option>
              <option value="awareness">Awareness</option>
              <option value="engagement">Engagement</option>
              <option value="bookings">Bookings</option>
              <option value="seasonal">Seasonal</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={values.status}
              onChange={(e) =>
                set("status", e.target.value as NonNullable<CampaignFormValues["status"]>)
              }
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Destination</Label>
            <Input
              value={values.destination ?? ""}
              onChange={(e) => set("destination", e.target.value)}
              placeholder="Santorini, Greece"
            />
          </div>
          <div className="space-y-2">
            <Label>Tour package</Label>
            <Input
              value={values.tour_package ?? ""}
              onChange={(e) => set("tour_package", e.target.value)}
              placeholder="7-day Island Hopper"
            />
          </div>
          <div className="space-y-2">
            <Label>Start date</Label>
            <Input
              type="date"
              value={values.start_date ?? ""}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>End date</Label>
            <Input
              type="date"
              value={values.end_date ?? ""}
              onChange={(e) => set("end_date", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Budget (USD)</Label>
            <Input
              type="number"
              value={values.budget?.toString() ?? ""}
              onChange={(e) =>
                set("budget", e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={submit} disabled={pending || !values.name}>
          {pending ? "Saving…" : campaignId ? "Save changes" : "Create campaign"}
        </Button>
      </CardContent>
    </Card>
  );
}
