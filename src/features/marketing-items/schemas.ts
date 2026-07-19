import { z } from "zod";

export const mediaEntrySchema = z.object({
  storage_path: z.string(),
  type: z.enum(["image", "video"]),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
});

export const promoSchema = z.object({
  discount_pct: z.coerce.number().min(0).max(100).optional(),
  promo_code: z.string().max(40).optional(),
  valid_from: z.string().optional(),
  valid_until: z.string().optional(),
  package_name: z.string().max(200).optional(),
});

export const itemFormSchema = z.object({
  type: z.enum(["social_post", "promotion", "announcement", "email"]),
  title: z.string().min(1, "Title is required").max(200),
  body: z.string().max(10000),
  campaign_id: z.string().uuid().nullable().optional(),
  destination: z.string().max(200).optional(),
  hashtags: z.array(z.string().max(80)).max(30).default([]),
  media: z.array(mediaEntrySchema).max(10).default([]),
  promo: promoSchema.nullable().optional(),
  scheduled_at: z.string().nullable().optional(),
  timezone: z.string().optional(),
  ai_generated: z.boolean().default(false),
  /** account ids to publish to, with optional per-platform copy */
  targets: z
    .array(
      z.object({
        social_account_id: z.string().uuid(),
        platform: z.string(),
        variant_body: z.string().max(10000).nullable().optional(),
      })
    )
    .default([]),
});

export type ItemFormValues = z.input<typeof itemFormSchema>;

export const campaignFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  objective: z.enum(["awareness", "engagement", "bookings", "seasonal"]).optional(),
  destination: z.string().max(200).optional(),
  tour_package: z.string().max(200).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  budget: z.coerce.number().min(0).optional(),
  status: z
    .enum(["draft", "active", "paused", "completed", "archived"])
    .default("draft"),
});

export type CampaignFormValues = z.input<typeof campaignFormSchema>;
