# Pre-flight checklist — "Publish now" actually pushes to live socials

Run through this sequentially before trusting "Publish now" with real
content. The first step is automated; the rest are a manual end-to-end
pass you only have to do once per environment.

## 1. Automated preflight

```bash
npm run preflight
```

Verifies, with no side effects:

1. Required env vars are present and `TOKEN_ENCRYPTION_KEY` is 32 bytes.
2. `SOCIAL_MOCK` is off (or you'll publish into a fake adapter and nothing
   goes anywhere).
3. AI provider + at least one key set.
4. DB constraint `marketing_items_status_check` allows `'in_review'` (i.e.
   migration `0009` is applied). If this fails, run:
   ```bash
   npm run fix:approvals-constraint
   ```
   Note: this check needs the read-only `exec` RPC from migration
   `supabase/migrations/0013_exec_rpc.sql`. Until you apply that in the
   Supabase SQL Editor (once), preflight reports the check as a warning
   instead of verifying it.
5. Every connected social account has a stored token and isn't expired.
6. In production, `pg_cron` is reachable (else migrations `0008`/`0010`
   haven't been applied). In dev it just reminds you to run the worker.

Exit code is non-zero if any hard check fails. Warnings (`!`) don't fail
the run but are worth reading.

## 2. Env sanity (manual once)

Confirm `.env.local` has real credential pairs for every platform you
plan to actually publish to:

| Platform | Required env                  |
|----------|--------------------------------|
| FB + IG  | `META_APP_ID`, `META_APP_SECRET` |
| X        | `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_TIER` |
| TikTok   | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_AUDITED` |
| YouTube  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| Pinterest | `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET` |

Notes:
- `X_TIER=free` is write-only — fine for publishing, no metrics/search.
- `TIKTOK_AUDITED=false` (default) restricts posts to `SELF_ONLY`. Real
  public posting needs TikTok's app audit.
- `SOCIAL_MOCK=1` short-circuits everything to a fake adapter.

## 3. Start dev + worker

Two terminals:

```bash
# Terminal 1
npm run dev

# Terminal 2 — drives publish-due + stale-publish locally
npm run worker
```

The worker ticks every minute for `publish` and every 5 for `stale-publish`.
You should see `[worker] publish: ok` lines as it polls.

## 4. Reconnect any account whose row says `EXPIRED` / `revoked`

Topics now auto-refresh on use (see `src/lib/social/accounts.ts`), but a
revoked refresh token can't be brought back by an API call. Go to
`/settings/accounts`, Disconnect, then Connect again to grant a fresh
refresh token.

## 5. One-target live publish test

Create a tiny item, give it ONE platform target, and click **Publish now**:

1. Compose a few words + one image (or video). Save as draft.
2. Open the item detail page.
3. Select one platform target only (e.g. a Facebook Page you own).
4. Leave `scheduled_at` empty.
5. Click **Publish now**. You should see "Queued — publishing on the next
   worker tick (1 target)" within a second or two.
6. Watch the worker terminal — within 1 minute you should see
   `[worker] publish: ok, 1 items`.
7. Open the platform directly and confirm the post appears.
8. Reload `/items/[id]` — the publish-results table should show
   `published` with a working **View** link.

If a target ends up `failed`: click the per-row **Retry** button after
fixing the underlying issue (reconnecting the account, removing an
unsupported media type, etc.). The state guard in `publishNow` only
resets targets in `failed`/`skipped` for partial items — published
targets are never re-sent, so you cannot accidentally double-post by
hitting Retry.

## 6. Stuck-publish recovery (if the worker dies mid-publish)

If a target gets stuck on `publishing` for more than 15 minutes, the
`stale-publish` cron flips it to `failed` automatically. To recover
immediately without waiting for the cron:

```bash
DRY_RUN=1 npm run reset:stale-publishes   # preview
npm run reset:stale-publishes            # apply
```

Then hit **Retry** on those rows.

## 7. Production — apply the cron migration once

```bash
# Replace __APP_URL__ and __CRON_SECRET__ in:
#   supabase/migrations/0008_cron.sql
#   supabase/migrations/0010_stale_publish_cron.sql
# Then run them in Supabase SQL Editor.
npm run fix:approvals-constraint   # also applies 0009 if missing
```

After that you can stop `npm run worker` — `pg_cron` + `pg_net` will
drive everything from the database side.

## 8. Going forward — what to check when publishing breaks

| Symptom | First thing to check |
|---|---|
| "Cannot change item status..." | `npm run fix:approvals-constraint` |
| `http_401 / UNAUTHENTICATED` | Reconnect the account in Settings (`refresh_token` may be revoked) |
| `http_500` from X | Transient; wait, then hit **Retry** on the row |
| Target stuck on `publishing` for >15 min | `npm run reset:stale-publishes` |
| "This item has no publish targets" | Open the item, add a platform target in the composer, save |
| Nothing ever publishes | Confirm `SOCIAL_MOCK` is off and `npm run worker` is running (dev) or `pg_cron` jobs exist (prod) |
