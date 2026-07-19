/**
 * RLS verification: creates two throwaway users in two orgs and asserts the
 * tenant-isolation and token-custody guarantees hold for the `authenticated`
 * role. Cleans up after itself.
 *
 * Usage: npm run rls:check   (requires SUPABASE_SERVICE_ROLE_KEY)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are required"
  );
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const STAMP = Date.now().toString(36);
const PASSWORD = `rls-check-${STAMP}-Aa1!`;

let passed = 0;
let failed = 0;
function report(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface Tenant {
  userId: string;
  orgId: string;
  campaignId: string;
  accountId: string;
  client: SupabaseClient;
}

async function createTenant(label: string): Promise<Tenant> {
  const email = `rls-${label}-${STAMP}@example.test`;
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userError || !userData.user) throw new Error(`createUser ${label}: ${userError?.message}`);
  const userId = userData.user.id;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `RLS Check ${label}`, slug: `rls-check-${label}-${STAMP}` })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`org ${label}: ${orgError?.message}`);

  await admin.from("org_members").insert({ org_id: org.id, user_id: userId, role: "owner" });

  const { data: campaign } = await admin
    .from("campaigns")
    .insert({ org_id: org.id, name: `Campaign ${label}`, created_by: userId })
    .select("id")
    .single();

  const { data: account } = await admin
    .from("social_accounts")
    .insert({
      org_id: org.id,
      platform: "instagram",
      external_id: `rls-check-${label}-${STAMP}`,
      handle: `rls_${label}`,
      access_token_enc: "c2VjcmV0LXRva2Vu", // opaque blob; never readable by clients
      status: "active",
      connected_by: userId,
    })
    .select("id")
    .single();

  const client = createClient(URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw new Error(`signIn ${label}: ${signInError.message}`);

  return {
    userId,
    orgId: org.id,
    campaignId: campaign?.id ?? "",
    accountId: account?.id ?? "",
    client,
  };
}

async function cleanup(tenants: Tenant[]) {
  for (const t of tenants) {
    await admin.from("organizations").delete().eq("id", t.orgId);
    await admin.auth.admin.deleteUser(t.userId);
  }
}

async function main() {
  console.log("RLS check\n");
  console.log("setting up two tenants…");
  const a = await createTenant("a");
  const b = await createTenant("b");

  try {
    console.log("\ntenant isolation:");

    // A sees own campaign
    const own = await a.client
      .from("campaigns")
      .select("id")
      .eq("org_id", a.orgId);
    report("A can read own campaigns", (own.data ?? []).length === 1, own.error?.message);

    // A cannot see B's campaigns
    const cross = await a.client
      .from("campaigns")
      .select("id")
      .eq("org_id", b.orgId);
    report(
      "A cannot read B's campaigns",
      !cross.error && (cross.data ?? []).length === 0,
      cross.error?.message
    );

    // A cannot see B's org
    const orgCross = await a.client
      .from("organizations")
      .select("id")
      .eq("id", b.orgId);
    report(
      "A cannot read B's organization",
      !orgCross.error && (orgCross.data ?? []).length === 0,
      orgCross.error?.message
    );

    // A cannot insert into B's org (RLS with-check)
    const insertCross = await a.client
      .from("campaigns")
      .insert({ org_id: b.orgId, name: "intrusion" });
    report("A cannot insert campaigns into B's org", !!insertCross.error);

    // A cannot update B's campaign
    const updateCross = await a.client
      .from("campaigns")
      .update({ name: "hijacked" })
      .eq("id", b.campaignId)
      .select("id");
    report(
      "A cannot update B's campaign",
      !updateCross.error && (updateCross.data ?? []).length === 0,
      updateCross.error?.message
    );

    console.log("\ntoken custody:");

    // Token columns are revoked for authenticated — even on your OWN account
    const tokenRead = await a.client
      .from("social_accounts")
      .select("access_token_enc")
      .eq("id", a.accountId);
    report("token column is unreadable (own account)", !!tokenRead.error);

    // select(*) includes token columns → must also fail
    const starRead = await a.client.from("social_accounts").select("*").limit(1);
    report("select * on social_accounts is blocked", !!starRead.error);

    // …but selecting safe columns works
    const safeRead = await a.client
      .from("social_accounts")
      .select("id, platform, handle, status")
      .eq("org_id", a.orgId);
    report(
      "safe columns readable (own account)",
      !safeRead.error && (safeRead.data ?? []).length === 1,
      safeRead.error?.message
    );

    console.log("\nservice-role-only tables:");

    const oauthRead = await a.client.from("oauth_states").select("state").limit(1);
    report(
      "oauth_states inaccessible",
      !!oauthRead.error || (oauthRead.data ?? []).length === 0
    );

    const jobsRead = await a.client.from("job_runs").select("id").limit(1);
    report(
      "job_runs inaccessible",
      !!jobsRead.error || (jobsRead.data ?? []).length === 0
    );

    console.log("\nmonitoring write protection:");
    const snapInsert = await a.client.from("account_metric_snapshots").insert({
      org_id: a.orgId,
      social_account_id: a.accountId,
      followers: 1,
    });
    report("clients cannot insert metric snapshots", !!snapInsert.error);
  } finally {
    console.log("\ncleaning up…");
    await cleanup([a, b]);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("rls-check failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
