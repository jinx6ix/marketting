"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Sparkles, Wand2, Hash, Upload, X as XIcon, Eye } from "lucide-react";
import * as tus from "tus-js-client";
import { createClient } from "@/lib/supabase/client";
import { compressVideo } from "@/lib/video/compress";
import { createItem, publishNow, updateItem } from "../actions";
import type { ItemFormValues } from "../schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import type { Platform } from "@/types/database";

interface AccountOption {
  id: string;
  platform: Platform;
  handle: string | null;
  display_name: string | null;
}

interface CampaignOption {
  id: string;
  name: string;
}

const MAX_LENGTHS: Record<Platform, number> = {
  facebook: 63206,
  instagram: 2200,
  x: 280,
  tiktok: 2200,
  youtube: 5000,
  linkedin: 3000,
  pinterest: 500,
};

const MEDIA_REQUIRED: Platform[] = ["instagram", "tiktok", "pinterest", "youtube"];

interface MediaEntry {
  storage_path: string;
  type: "image" | "video";
}

export function Composer({
  accounts,
  campaigns,
  orgId,
  initial,
  itemId,
}: {
  accounts: AccountOption[];
  campaigns: CampaignOption[];
  orgId: string;
  initial?: Partial<ItemFormValues>;
  itemId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState(initial?.type ?? "social_post");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [hashtags, setHashtags] = useState<string[]>(initial?.hashtags ?? []);
  const [hashtagInput, setHashtagInput] = useState("");
  const [media, setMedia] = useState<MediaEntry[]>(
    (initial?.media as MediaEntry[]) ?? []
  );
  const [campaignId, setCampaignId] = useState(initial?.campaign_id ?? "");
  const [scheduledAt, setScheduledAt] = useState(
    initial?.scheduled_at ? initial.scheduled_at.slice(0, 16) : ""
  );
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(
    new Set(initial?.targets?.map((t) => t.social_account_id) ?? [])
  );
  const [variants, setVariants] = useState<Record<string, string>>(
    Object.fromEntries(
      (initial?.targets ?? [])
        .filter((t) => t.variant_body)
        .map((t) => [t.social_account_id, t.variant_body!])
    )
  );
  const [activeVariantTab, setActiveVariantTab] = useState<string | null>(null);

  // promo fields
  const [showPromo, setShowPromo] = useState(!!initial?.promo);
  const [promoCode, setPromoCode] = useState(initial?.promo?.promo_code ?? "");
  const [discountPct, setDiscountPct] = useState(
    initial?.promo?.discount_pct?.toString() ?? ""
  );
  const [packageName, setPackageName] = useState(
    initial?.promo?.package_name ?? ""
  );

  // AI
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [visionInsights, setVisionInsights] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    file: string;
    pct: number;
  } | null>(null);
  const [compressProgress, setCompressProgress] = useState<{
    file: string;
    pct: number;
  } | null>(null);

  const hasVideo = media.some((m) => m.type === "video");
  const youtubeAccountIds = useMemo(
    () => new Set(accounts.filter((a) => a.platform === "youtube").map((a) => a.id)),
    [accounts]
  );

  // YouTube is video-only — derive the "actually usable" selection instead
  // of syncing selectedAccounts via an effect: if the item's media has no
  // video, any selected YouTube account is excluded here rather than
  // mutated out of state. selectedAccounts still holds the user's raw
  // clicks (so re-adding a video brings the prior selection right back);
  // every read below uses activeAccounts.
  const activeAccounts = useMemo(() => {
    if (hasVideo || youtubeAccountIds.size === 0) return selectedAccounts;
    let changed = false;
    const next = new Set(selectedAccounts);
    for (const id of youtubeAccountIds) {
      if (next.delete(id)) changed = true;
    }
    return changed ? next : selectedAccounts;
  }, [selectedAccounts, hasVideo, youtubeAccountIds]);

  const selectedPlatforms = useMemo(
    () =>
      [...activeAccounts]
        .map((id) => accounts.find((a) => a.id === id)?.platform)
        .filter((p): p is Platform => !!p),
    [activeAccounts, accounts]
  );

  const mediaWarning =
    media.length === 0 &&
    selectedPlatforms.some((p) => MEDIA_REQUIRED.includes(p))
      ? `Media required for: ${selectedPlatforms
          .filter((p) => MEDIA_REQUIRED.includes(p))
          .map((p) => PLATFORM_LABELS[p])
          .join(", ")}`
      : null;

  async function analyzeMedia() {
    if (!itemId || media.length === 0) return;
    setAiBusy("vision");
    setVisionInsights(null);
    try {
      const res = await fetch("/api/ai/media-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const data = (await res.json()) as {
        insights?: { results: { insight?: { description: string; suggested_hook: string; wildlife_or_landmarks: string[] } }[] };
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Vision analysis failed");
      const lines = (data.insights?.results ?? [])
        .filter((r) => r.insight)
        .map((r, i) => `Media ${i + 1}: ${r.insight!.suggested_hook} (${r.insight!.wildlife_or_landmarks.join(", ") || r.insight!.description})`);
      setVisionInsights(lines.join("\n") || "No insights returned.");
    } catch (e) {
      setVisionInsights(`Error: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setAiBusy(null);
    }
  }

  async function callAi(action: "generate" | "improve" | "hashtags") {
    setAiBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          brief: action === "generate" ? brief || title : undefined,
          text: action !== "generate" ? body : undefined,
          destination: destination || undefined,
          promo: showPromo
            ? {
                promo_code: promoCode || undefined,
                discount_pct: discountPct ? Number(discountPct) : undefined,
                package_name: packageName || undefined,
              }
            : undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `AI request failed (${res.status})`);
      }
      if (action === "hashtags") {
        const data = (await res.json()) as { hashtags: string[] };
        setHashtags((prev) => [...new Set([...prev, ...data.hashtags])].slice(0, 30));
      } else {
        // stream into the body field
        setBody("");
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setBody(acc);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI request failed");
    } finally {
      setAiBusy(null);
    }
  }

  // Supabase's standard upload() endpoint is a single POST — for large
  // video files that's slow to retry from scratch on any network blip and
  // prone to just failing outright. Files over the 6MB TUS chunk size go
  // through Supabase's resumable (TUS) upload endpoint instead, which
  // uploads in chunks and can resume after a dropped connection instead of
  // restarting the whole file.
  const TUS_THRESHOLD_BYTES = 6 * 1024 * 1024;

  // Supabase enforces a hard project-wide upload size cap regardless of any
  // bucket setting — 50MB on the Free plan, and even Pro defaults to a
  // limit that has to be manually raised. No code change can bypass that,
  // so any video over this threshold gets compressed client-side first
  // (see lib/video/compress.ts) rather than attempting an upload that's
  // very likely to 413.
  const AUTO_COMPRESS_THRESHOLD_BYTES = 40 * 1024 * 1024;
  // What we ask compressVideo to aim for — comfortably under the 50MB hard
  // cap, since bitrate-targeted encoding lands close to but not always
  // exactly at budget.
  const TARGET_UPLOAD_SIZE_BYTES = 35 * 1024 * 1024;
  // If the first pass still comes out above this (can happen for very long
  // videos even at the minimum sane bitrate), run a second, stricter pass
  // on the already-compressed file instead of giving up.
  const SAFETY_CEILING_BYTES = 45 * 1024 * 1024;

  async function uploadResumable(
    file: File,
    path: string,
    accessToken: string
  ): Promise<void> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) throw new Error("Missing Supabase URL configuration");

    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${accessToken}`,
          "x-upsert": "false",
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: "media",
          objectName: path,
          contentType: file.type || "application/octet-stream",
          cacheControl: "3600",
        },
        chunkSize: TUS_THRESHOLD_BYTES, // Supabase requires exactly 6MB chunks
        onError: reject,
        onProgress: (sent, total) => {
          setUploadProgress({ file: file.name, pct: Math.round((sent / total) * 100) });
        },
        onSuccess: () => resolve(),
      });

      upload
        .findPreviousUploads()
        .then((previous) => {
          if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
          upload.start();
        })
        .catch(reject);
    });
  }

  async function uploadFiles(files: FileList) {
    setUploading(true);
    setError(null);
    const supabase = createClient();
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      for (const rawFile of Array.from(files)) {
        let file = rawFile;

        if (
          file.type.startsWith("video") &&
          file.size > AUTO_COMPRESS_THRESHOLD_BYTES
        ) {
          setCompressProgress({ file: file.name, pct: 0 });
          try {
            file = await compressVideo(file, {
              targetSizeBytes: TARGET_UPLOAD_SIZE_BYTES,
              onProgress: (pct) => setCompressProgress({ file: rawFile.name, pct }),
            });

            // Very long videos can still land above budget even at the
            // encoder's sane minimum bitrate — one stricter pass on the
            // already-shrunk file, at a lower resolution too, rather than
            // handing the user a 413 after they thought compression had
            // already handled it.
            if (file.size > SAFETY_CEILING_BYTES) {
              setCompressProgress({ file: rawFile.name, pct: 0 });
              file = await compressVideo(file, {
                targetSizeBytes: TARGET_UPLOAD_SIZE_BYTES * 0.6,
                maxWidth: 854,
                onProgress: (pct) => setCompressProgress({ file: rawFile.name, pct }),
              });
            }
          } catch (compressErr) {
            // Previously this silently fell back to uploading the
            // untouched original — which meant a broken compression step
            // and "the file is genuinely too big" looked identical from
            // the outside (both ended in the same 413 message below,
            // with no way to tell which one actually happened). Surface
            // the real cause instead of masking it.
            console.error("Video compression failed:", compressErr);
            const reason =
              compressErr instanceof Error ? compressErr.message : String(compressErr);
            throw new Error(
              `Couldn't compress "${rawFile.name}" in your browser (${reason}). Full details are in the browser console (F12 → Console tab).`
            );
          } finally {
            setCompressProgress(null);
          }
        }

        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${orgId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

        try {
          if (file.size > TUS_THRESHOLD_BYTES && session?.access_token) {
            setUploadProgress({ file: file.name, pct: 0 });
            await uploadResumable(file, path, session.access_token);
          } else {
            const { error: upErr } = await supabase.storage
              .from("media")
              .upload(path, file, { contentType: file.type });
            if (upErr) throw new Error(upErr.message);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/413|maximum size exceeded/i.test(msg)) {
            throw new Error(
              `"${file.name}" is still too large for your Supabase project's upload limit. This is a project-level plan setting (Free plan caps at 50MB total, independent of anything in this app) — raise it under Supabase Dashboard → Project Settings → Storage → Global file size limit, or trim/compress the file further.`
            );
          }
          throw e;
        }

        setMedia((prev) => [
          ...prev,
          {
            storage_path: path,
            type: file.type.startsWith("video") ? "video" : "image",
          },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setCompressProgress(null);
    }
  }

  function submit(publish = false) {
    setError(null);
    if (publish && activeAccounts.size === 0) {
      setError("Select at least one account under “Publish to” first.");
      return;
    }
    const values: ItemFormValues = {
      type,
      title,
      body,
      campaign_id: campaignId || null,
      destination: destination || undefined,
      hashtags,
      media,
      promo: showPromo
        ? {
            promo_code: promoCode || undefined,
            discount_pct: discountPct ? Number(discountPct) : undefined,
            package_name: packageName || undefined,
          }
        : null,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ai_generated: false,
      targets: [...activeAccounts].map((id) => {
        const account = accounts.find((a) => a.id === id)!;
        return {
          social_account_id: id,
          platform: account.platform,
          variant_body: variants[id] || null,
        };
      }),
    };

    startTransition(async () => {
      const result = itemId
        ? await updateItem(itemId, values)
        : await createItem(values);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (publish && result.id) {
        // Targets are now saved — safe to queue the actual publish.
        const pub = await publishNow(result.id);
        if (pub.error) {
          setError(pub.error);
          return;
        }
        router.push(`/items/${result.id}`);
        router.refresh();
        return;
      }
      router.push("/items");
    });
  }

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{itemId ? "Edit item" : "Create marketing item"}</CardTitle>
            <CardDescription>
              Master copy — adapt per platform in the variant tabs below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                >
                  <option value="social_post">Social post</option>
                  <option value="promotion">Promotion / deal</option>
                  <option value="announcement">Announcement</option>
                  <option value="email">Email</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Campaign</Label>
                <Select
                  value={campaignId ?? ""}
                  onChange={(e) => setCampaignId(e.target.value)}
                >
                  <option value="">No campaign</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Title (internal)</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Bali early-bird promo — June"
              />
            </div>

            <div className="space-y-2">
              <Label>Destination</Label>
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Bali, Indonesia"
              />
            </div>

            {/* AI toolbar */}
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <span className="text-sm font-medium">AI assist</span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Input
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="Brief: 20% off 5-day Bali package for solo travelers…"
                  className="sm:flex-1"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={aiBusy !== null || (!brief && !title)}
                    onClick={() => callAi("generate")}
                  >
                    <Wand2 />
                    {aiBusy === "generate" ? "Writing…" : "Generate"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={aiBusy !== null || !body}
                    onClick={() => callAi("improve")}
                  >
                    {aiBusy === "improve" ? "Improving…" : "Improve"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={aiBusy !== null || !body}
                    onClick={() => callAi("hashtags")}
                  >
                    <Hash />
                    {aiBusy === "hashtags" ? "…" : "Hashtags"}
                  </Button>
                  {itemId && media.length > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={aiBusy !== null}
                      onClick={analyzeMedia}
                    >
                      <Eye />
                      {aiBusy === "vision" ? "Analyzing…" : "Analyze media"}
                    </Button>
                  )}
                </div>
              </div>
              {visionInsights && (
                <div className="rounded border bg-background p-2 text-xs text-muted-foreground whitespace-pre-wrap">
                  {visionInsights}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Master copy</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={7}
                placeholder="Write or generate the post copy…"
              />
              <div className="text-right text-xs text-muted-foreground">
                {body.length} chars
              </div>
            </div>

            {/* Hashtags */}
            <div className="space-y-2">
              <Label>Hashtags</Label>
              <div className="flex flex-wrap gap-1.5">
                {hashtags.map((h) => (
                  <Badge key={h} variant="secondary" className="gap-1">
                    #{h}
                    <button
                      type="button"
                      onClick={() =>
                        setHashtags((prev) => prev.filter((x) => x !== h))
                      }
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                ))}
                <Input
                  value={hashtagInput}
                  onChange={(e) => setHashtagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && hashtagInput.trim()) {
                      e.preventDefault();
                      setHashtags((prev) => [
                        ...new Set([...prev, hashtagInput.trim().replace(/^#/, "")]),
                      ]);
                      setHashtagInput("");
                    }
                  }}
                  placeholder="Add + Enter"
                  className="h-7 w-32 text-xs"
                />
              </div>
            </div>

            {/* Promo */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showPromo}
                  onChange={(e) => setShowPromo(e.target.checked)}
                />
                This is a promotion / deal
              </label>
              {showPromo && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Package</Label>
                    <Input
                      value={packageName}
                      onChange={(e) => setPackageName(e.target.value)}
                      placeholder="5-day Bali Escape"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Discount %</Label>
                    <Input
                      type="number"
                      value={discountPct}
                      onChange={(e) => setDiscountPct(e.target.value)}
                      placeholder="20"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Promo code</Label>
                    <Input
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      placeholder="BALI20"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Media */}
            <div className="space-y-2">
              <Label>Media</Label>
              <div className="flex flex-wrap items-center gap-2">
                {media.map((m) => (
                  <Badge key={m.storage_path} variant="outline" className="gap-1">
                    {m.type} · {m.storage_path.split("/").pop()}
                    <button
                      type="button"
                      onClick={() =>
                        setMedia((prev) =>
                          prev.filter((x) => x.storage_path !== m.storage_path)
                        )
                      }
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                ))}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
                  <Upload className="size-3.5" />
                  {compressProgress
                    ? `Compressing ${compressProgress.file}… ${compressProgress.pct}%`
                    : uploadProgress
                      ? `Uploading ${uploadProgress.file}… ${uploadProgress.pct}%`
                      : uploading
                        ? "Uploading…"
                        : "Upload image/video"}
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => e.target.files && uploadFiles(e.target.files)}
                  />
                </label>
              </div>
              {mediaWarning && (
                <p className="text-xs text-warning">{mediaWarning}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Per-platform variants */}
        {activeAccounts.size > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Platform variants</CardTitle>
              <CardDescription>
                Optional per-platform copy. Empty = master copy + hashtags.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap gap-1">
                {[...activeAccounts].map((id) => {
                  const account = accounts.find((a) => a.id === id);
                  if (!account) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        setActiveVariantTab(activeVariantTab === id ? null : id)
                      }
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs",
                        activeVariantTab === id
                          ? "border-primary bg-primary/10 font-medium"
                          : "hover:bg-accent"
                      )}
                    >
                      {PLATFORM_LABELS[account.platform]}
                      {variants[id] ? " ●" : ""}
                    </button>
                  );
                })}
              </div>
              {activeVariantTab &&
                activeAccounts.has(activeVariantTab) &&
                (() => {
                  const account = accounts.find((a) => a.id === activeVariantTab);
                  if (!account) return null;
                  const limit = MAX_LENGTHS[account.platform];
                  const text = variants[activeVariantTab] ?? "";
                  const over = text.length > limit;
                  return (
                    <div className="space-y-2">
                      <Textarea
                        value={text}
                        onChange={(e) =>
                          setVariants((prev) => ({
                            ...prev,
                            [activeVariantTab]: e.target.value,
                          }))
                        }
                        rows={5}
                        placeholder={`Custom copy for ${PLATFORM_LABELS[account.platform]}…`}
                      />
                      <div
                        className={cn(
                          "text-right text-xs",
                          over ? "font-medium text-destructive" : "text-muted-foreground"
                        )}
                      >
                        {text.length} / {limit}
                      </div>
                    </div>
                  );
                })()}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right rail: targets + schedule */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Publish to</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {accounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No connected accounts.{" "}
                <a href="/settings/accounts" className="text-primary hover:underline">
                  Connect one
                </a>
                .
              </p>
            )}
            {accounts.map((a) => {
              const locked = a.platform === "youtube" && !hasVideo;
              return (
                <label
                  key={a.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border p-2 text-sm",
                    locked
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer hover:bg-accent"
                  )}
                  title={
                    locked
                      ? "YouTube only accepts video — add a video to enable this."
                      : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={activeAccounts.has(a.id)}
                    disabled={locked}
                    onChange={(e) => {
                      setSelectedAccounts((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(a.id);
                        else next.delete(a.id);
                        return next;
                      });
                    }}
                  />
                  <span className="font-medium">{PLATFORM_LABELS[a.platform]}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {a.handle ?? a.display_name}
                  </span>
                  {locked && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      Video required
                    </span>
                  )}
                </label>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {scheduledAt
                ? "Will auto-publish to selected accounts at this time."
                : "Leave empty to save as draft."}
            </p>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          className="w-full"
          size="lg"
          disabled={pending || !title || uploading}
          onClick={() => submit()}
        >
          {pending
            ? "Saving…"
            : scheduledAt
              ? "Schedule"
              : itemId
                ? "Save changes"
                : "Save draft"}
        </Button>
        {!scheduledAt && (
          <Button
            variant="secondary"
            className="w-full"
            size="lg"
            disabled={
              pending || !title || uploading || activeAccounts.size === 0
            }
            onClick={() => submit(true)}
            title={
              activeAccounts.size === 0
                ? "Select at least one account under “Publish to”"
                : undefined
            }
          >
            {pending ? "Saving…" : "Save & publish now"}
          </Button>
        )}
      </div>
    </div>
  );
}