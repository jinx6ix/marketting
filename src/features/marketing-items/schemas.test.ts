import { describe, expect, it } from "vitest";
import { itemFormSchema, promoSchema } from "./schemas";

const validItem = {
  type: "social_post",
  title: "Maasai Mara sunrise safari",
  body: "Golden hour over the Mara.",
};

describe("itemFormSchema", () => {
  it("accepts a minimal valid item and applies defaults", () => {
    const parsed = itemFormSchema.parse(validItem);
    expect(parsed.hashtags).toEqual([]);
    expect(parsed.media).toEqual([]);
    expect(parsed.targets).toEqual([]);
    expect(parsed.ai_generated).toBe(false);
  });

  it("requires a non-empty title", () => {
    const res = itemFormSchema.safeParse({ ...validItem, title: "" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].message).toBe("Title is required");
    }
  });

  it("rejects unknown item types", () => {
    expect(
      itemFormSchema.safeParse({ ...validItem, type: "billboard" }).success
    ).toBe(false);
  });

  it("rejects non-uuid campaign and target account ids", () => {
    expect(
      itemFormSchema.safeParse({ ...validItem, campaign_id: "not-a-uuid" })
        .success
    ).toBe(false);
    expect(
      itemFormSchema.safeParse({
        ...validItem,
        targets: [{ social_account_id: "nope", platform: "facebook" }],
      }).success
    ).toBe(false);
  });

  it("caps hashtags at 30 and media at 10", () => {
    expect(
      itemFormSchema.safeParse({
        ...validItem,
        hashtags: Array.from({ length: 31 }, (_, i) => `#t${i}`),
      }).success
    ).toBe(false);
    expect(
      itemFormSchema.safeParse({
        ...validItem,
        media: Array.from({ length: 11 }, () => ({
          storage_path: "p",
          type: "image",
        })),
      }).success
    ).toBe(false);
  });
});

describe("promoSchema", () => {
  it("coerces discount_pct from string and enforces 0-100", () => {
    expect(promoSchema.parse({ discount_pct: "25" }).discount_pct).toBe(25);
    expect(promoSchema.safeParse({ discount_pct: 101 }).success).toBe(false);
    expect(promoSchema.safeParse({ discount_pct: -1 }).success).toBe(false);
  });
});
