/**
 * Seed a demo org with realistic travel-marketing data so every page and
 * chart has something to show.
 *
 * Usage: npm run seed   (requires SUPABASE_SERVICE_ROLE_KEY in .env.local)
 *
 * Idempotent: re-running wipes and recreates the demo org (slug below).
 * Login afterwards with demo@wanderlust.test / demo-password-123
 */
import { createClient } from "@supabase/supabase-js";
import { createCipheriv, randomBytes } from "crypto";
import { config } from "dotenv";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const DEMO_EMAIL = "demo@wanderlust.test";
const DEMO_PASSWORD = "demo-password-123";
const ORG_SLUG = "wanderlust-demo";

// Same format as src/lib/social/crypto.ts (can't import it here: "server-only")
function encryptToken(plaintext: string): string | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64");
}

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DAY = 86400_000;
const daysAgo = (n: number, hour = 12) => {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function main() {
  console.log("[seed] preparing demo user…");

  // ── user ──
  let userId: string | undefined;
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  userId = userList?.users.find((u) => u.email === DEMO_EMAIL)?.id;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Demo Marketer" },
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    userId = data.user.id;
  }

  // ── wipe previous demo org (cascades to all org-scoped tables) ──
  const { data: oldOrg } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", ORG_SLUG)
    .maybeSingle();
  if (oldOrg) {
    console.log("[seed] removing previous demo org…");
    await admin.from("organizations").delete().eq("id", oldOrg.id);
  }

  // ── org + membership ──
  console.log("[seed] creating org…");
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: "Wanderlust Demo Tours",
      slug: ORG_SLUG,
      timezone: "Asia/Manila",
      industry_niche: ["island hopping", "adventure", "honeymoon packages"],
    })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`org: ${orgError?.message}`);
  const orgId = org.id;

  await admin.from("org_members").upsert({ org_id: orgId, user_id: userId, role: "owner" });
  await admin
    .from("profiles")
    .upsert({ id: userId, full_name: "Demo Marketer", default_org_id: orgId });

  // ── social accounts (mock) ──
  console.log("[seed] connecting mock social accounts…");
  const token = encryptToken("mock-access-token");
  if (!token) {
    console.warn(
      "[seed]   TOKEN_ENCRYPTION_KEY missing/invalid — accounts seeded without tokens (set SOCIAL_MOCK=1 to publish)"
    );
  }
  const accountRows = [
    { platform: "instagram", handle: "wanderlust.demo", display_name: "Wanderlust Tours", base: 12400 },
    { platform: "facebook", handle: "WanderlustDemoTours", display_name: "Wanderlust Demo Tours", base: 8300 },
    { platform: "x", handle: "wanderlustdemo", display_name: "Wanderlust Tours", base: 3100 },
  ];
  const accounts: { id: string; platform: string; base: number }[] = [];
  for (const row of accountRows) {
    const { data, error } = await admin
      .from("social_accounts")
      .insert({
        org_id: orgId,
        platform: row.platform,
        external_id: `mock-${row.platform}-${ORG_SLUG}`,
        handle: row.handle,
        display_name: row.display_name,
        access_token_enc: token,
        refresh_token_enc: token,
        token_expires_at: new Date(Date.now() + 60 * DAY).toISOString(),
        scopes: ["mock"],
        status: "active",
        connected_by: userId,
        metadata: { mock: true },
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`social_accounts: ${error?.message}`);
    accounts.push({ id: data.id, platform: row.platform, base: row.base });
  }

  // ── campaigns ──
  console.log("[seed] creating campaigns + items…");
  const { data: campaign1 } = await admin
    .from("campaigns")
    .insert({
      org_id: orgId,
      name: "Summer in the Philippines",
      objective: "bookings",
      destination: "Palawan",
      tour_package: "5-day El Nido Island Hopper",
      start_date: daysAgo(20).slice(0, 10),
      end_date: daysAgo(-25).slice(0, 10),
      status: "active",
      created_by: userId,
    })
    .select("id")
    .single();
  const { data: campaign2 } = await admin
    .from("campaigns")
    .insert({
      org_id: orgId,
      name: "Bali Honeymoon Early Birds",
      objective: "awareness",
      destination: "Bali",
      status: "draft",
      created_by: userId,
    })
    .select("id")
    .single();

  // ── marketing items: published (past), scheduled (future), drafts ──
  const publishedSpecs = [
    { title: "El Nido lagoon tour — 20% off", dest: "Palawan", d: 25, hour: 9 },
    { title: "Sunset in Oslob: whale shark mornings", dest: "Cebu", d: 20, hour: 18 },
    { title: "Siargao surf week — beginner friendly", dest: "Siargao", d: 14, hour: 11 },
    { title: "Bali early-bird honeymoon promo", dest: "Bali", d: 8, hour: 9 },
    { title: "Hidden beaches of Coron (thread)", dest: "Palawan", d: 3, hour: 19 },
  ];
  for (const spec of publishedSpecs) {
    const { data: item } = await admin
      .from("marketing_items")
      .insert({
        org_id: orgId,
        campaign_id: campaign1?.id ?? null,
        type: "social_post",
        title: spec.title,
        body: `${spec.title}. Book now — limited slots!\n\nDM us or tap the link in bio.`,
        hashtags: ["travelph", spec.dest.toLowerCase(), "wanderlust"],
        destination: spec.dest,
        status: "published",
        scheduled_at: daysAgo(spec.d, spec.hour),
        created_by: userId,
      })
      .select("id")
      .single();
    if (!item) continue;
    for (const account of accounts) {
      const { data: target } = await admin
        .from("post_targets")
        .insert({
          org_id: orgId,
          item_id: item.id,
          social_account_id: account.id,
          platform: account.platform,
          status: "published",
          external_post_id: `mock-post-${item.id.slice(0, 8)}-${account.platform}`,
          external_url: `https://example.com/${account.platform}/mock-post`,
          published_at: daysAgo(spec.d, spec.hour),
        })
        .select("id")
        .single();
      if (!target) continue;
      // A few metric snapshots per published target
      for (const snapDay of [spec.d - 1, Math.max(spec.d - 5, 0), 0]) {
        const age = spec.d - snapDay;
        const likes = Math.round(40 + age * 25 + Math.random() * 60);
        await admin.from("post_metric_snapshots").insert({
          org_id: orgId,
          post_target_id: target.id,
          captured_at: daysAgo(snapDay, 13),
          likes,
          comments: Math.round(likes * 0.15),
          shares: Math.round(likes * 0.08),
          saves: Math.round(likes * 0.1),
          impressions: likes * 30,
          reach: likes * 22,
          engagement_rate: Number((2 + Math.random() * 4).toFixed(2)),
        });
      }
    }
  }

  // scheduled + drafts
  await admin.from("marketing_items").insert([
    {
      org_id: orgId,
      campaign_id: campaign1?.id ?? null,
      type: "promotion",
      title: "Flash sale: Coron 3D2N — code CORON15",
      body: "48-hour flash sale! 15% off our Coron 3D2N package. Use CORON15 at checkout.",
      promo: { discount_pct: 15, promo_code: "CORON15", package_name: "Coron 3D2N" },
      hashtags: ["coron", "flashsale"],
      destination: "Palawan",
      status: "scheduled",
      scheduled_at: daysAgo(-1, 10),
      created_by: userId,
    },
    {
      org_id: orgId,
      campaign_id: campaign2?.id ?? null,
      type: "social_post",
      title: "Bali temple sunrise — carousel",
      body: "Golden hour at Lempuyang. Slide for the full itinerary →",
      hashtags: ["bali", "honeymoon"],
      destination: "Bali",
      status: "scheduled",
      scheduled_at: daysAgo(-3, 9),
      created_by: userId,
    },
    {
      org_id: orgId,
      type: "announcement",
      title: "New office in Makati — open house",
      body: "",
      status: "draft",
      created_by: userId,
    },
  ]);

  // schedule targets for the scheduled items
  const { data: scheduledItems } = await admin
    .from("marketing_items")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "scheduled");
  for (const item of scheduledItems ?? []) {
    await admin.from("post_targets").insert(
      accounts.slice(0, 2).map((account) => ({
        org_id: orgId,
        item_id: item.id,
        social_account_id: account.id,
        platform: account.platform,
        status: "pending",
      }))
    );
  }

  // ── 30 days of account metric snapshots ──
  console.log("[seed] writing 30 days of account metrics…");
  const accountSnapshots = [];
  for (const account of accounts) {
    for (let d = 30; d >= 0; d--) {
      const growth = (30 - d) * (account.base * 0.004) + Math.random() * 20;
      accountSnapshots.push({
        org_id: orgId,
        social_account_id: account.id,
        captured_at: daysAgo(d, 6),
        followers: Math.round(account.base + growth),
        following: 350,
        posts_count: 180 + (30 - d),
        impressions: Math.round(3000 + Math.random() * 2000),
        reach: Math.round(2200 + Math.random() * 1500),
        engagement_total: Math.round(400 + (30 - d) * 12 + Math.random() * 80),
      });
    }
  }
  await admin.from("account_metric_snapshots").insert(accountSnapshots);

  // ── competitors ──
  console.log("[seed] creating competitors…");
  const competitorSpecs = [
    {
      name: "Island Dreams Travel",
      destinations: ["Boracay", "Palawan", "Siargao"],
      accounts: [
        { platform: "instagram", handle: "islanddreamsph", base: 28000 },
        { platform: "facebook", handle: "IslandDreamsTravel", base: 15000 },
      ],
    },
    {
      name: "Tropic Ventures",
      destinations: ["Bali", "Phuket", "Palawan"],
      accounts: [{ platform: "instagram", handle: "tropicventures", base: 9800 }],
    },
  ];
  for (const spec of competitorSpecs) {
    const { data: competitor } = await admin
      .from("competitors")
      .insert({
        org_id: orgId,
        name: spec.name,
        destinations: spec.destinations,
        niche: ["island hopping"],
      })
      .select("id")
      .single();
    if (!competitor) continue;
    for (const accountSpec of spec.accounts) {
      const { data: compAccount } = await admin
        .from("competitor_accounts")
        .insert({
          org_id: orgId,
          competitor_id: competitor.id,
          platform: accountSpec.platform,
          handle: accountSpec.handle,
          last_polled_at: daysAgo(0, 4),
        })
        .select("id")
        .single();
      if (!compAccount) continue;
      const snaps = [];
      for (let d = 30; d >= 0; d -= 2) {
        snaps.push({
          org_id: orgId,
          competitor_account_id: compAccount.id,
          captured_at: daysAgo(d, 5),
          followers: Math.round(accountSpec.base + (30 - d) * accountSpec.base * 0.003),
          posts_count: 240 + (30 - d),
          avg_engagement: Number((300 + Math.random() * 200).toFixed(1)),
          posting_frequency: Number((4 + Math.random() * 3).toFixed(1)),
          source: "api",
        });
      }
      await admin.from("competitor_snapshots").insert(snaps);
      await admin.from("competitor_posts").insert(
        [
          { content: `Top 10 beaches you must visit — ${spec.destinations[0]} edition`, media_type: "carousel", d: 2 },
          { content: "Early bird promo: 25% off all island tours this month!", media_type: "image", d: 5 },
          { content: "POV: your first sunrise trek", media_type: "reel", d: 9 },
        ].map((p, i) => ({
          org_id: orgId,
          competitor_account_id: compAccount.id,
          external_id: `mock-cp-${compAccount.id.slice(0, 8)}-${i}`,
          posted_at: daysAgo(p.d, 10),
          content: p.content,
          media_type: p.media_type,
          likes: Math.round(200 + Math.random() * 600),
          comments: Math.round(20 + Math.random() * 60),
          shares: Math.round(10 + Math.random() * 40),
          hashtags: ["travel", spec.destinations[0].toLowerCase()],
          destinations: [spec.destinations[0]],
        }))
      );
    }
  }

  // ── keywords + mentions ──
  console.log("[seed] creating keywords + mentions…");
  await admin.from("tracked_keywords").insert(
    [
      { keyword: "palawan", kind: "destination" },
      { keyword: "islandhopping", kind: "hashtag" },
      { keyword: "wanderlust demo tours", kind: "brand" },
    ].map((k) => ({ ...k, org_id: orgId, platforms: [] }))
  );

  const mentionSpecs = [
    { platform: "instagram", kind: "comment", author: "traveler_jen", content: "This tour was AMAZING! Our guide was so helpful 😍", sentiment: "positive", d: 1 },
    { platform: "facebook", kind: "review", author: "Mark Delacruz", content: "Great value for money. The island hopping package exceeded expectations.", sentiment: "positive", d: 2 },
    { platform: "x", kind: "mention", author: "backpack_bob", content: "Anyone tried @wanderlustdemo for El Nido? Thinking of booking", sentiment: "neutral", d: 3 },
    { platform: "instagram", kind: "keyword_match", author: "sunset.seeker", content: "Best palawan itinerary? 5 days in March", sentiment: "neutral", d: 4 },
    { platform: "facebook", kind: "comment", author: "Ana Reyes", content: "Waited 3 days for a reply to my booking inquiry… disappointing", sentiment: "negative", d: 5 },
    { platform: "instagram", kind: "mention", author: "foodie.mia", content: "Shoutout to the team for the surprise anniversary setup!", sentiment: "positive", d: 6 },
  ];
  await admin.from("mentions").insert(
    mentionSpecs.map((m, i) => ({
      org_id: orgId,
      platform: m.platform,
      kind: m.kind,
      external_id: `mock-mention-${i}`,
      author_handle: m.author.toLowerCase().replace(/\s/g, "."),
      author_name: m.author,
      content: m.content,
      external_url: `https://example.com/${m.platform}/mention-${i}`,
      sentiment: m.sentiment,
      occurred_at: daysAgo(m.d, 15),
      is_read: i > 3,
    }))
  );

  console.log(`
[seed] done ✔
  org:      Wanderlust Demo Tours (${orgId})
  login:    ${DEMO_EMAIL} / ${DEMO_PASSWORD}
  accounts: ${accounts.length} mock social accounts (set SOCIAL_MOCK=1 to publish)
`);
}

main().catch((e) => {
  console.error("[seed] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
