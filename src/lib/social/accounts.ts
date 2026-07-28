import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken, decryptToken } from "./crypto";
import { getAdapter } from "./registry";
import type { TokenSet, ConnectedProfile } from "./types";
import type { Platform, SocialAccount } from "@/types/database";

/** Refresh a token when it has expired or will in the next 60s. */
const REFRESH_BUFFER_MS = 60_000;

/**
 * Anything shorter than this at first-issue is treated as "not long-lived
 * enough" — we'll immediately try to exchange it for a longer-lived token
 * via the adapter's refresh path. 60 days matches Meta's long-lived window,
 * and any platform that hands out ≤ 60 days typically has a refresh path
 * that returns a fresh expiry anyway.
 */
const PREFERRED_MIN_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000;

export interface AccountTokens {
  account: SocialAccount;
  tokens: TokenSet;
  /** True if a refresh was attempted and produced a new access token. */
  refreshed: boolean;
}

/** Read + (proactively) refresh tokens for an account. Service-role only. */
export async function getAccountTokens(accountId: string): Promise<AccountTokens> {
  const admin = createAdminClient();
  const { data: account, error } = await admin
    .from("social_accounts")
    .select("*")
    .eq("id", accountId)
    .single();
  if (error || !account) throw new Error(`Social account not found: ${accountId}`);
  if (!account.access_token_enc) {
    throw new Error(`Account ${accountId} has no stored token`);
  }

  let tokens: TokenSet = {
    accessToken: decryptToken(account.access_token_enc),
    refreshToken: account.refresh_token_enc
      ? decryptToken(account.refresh_token_enc)
      : undefined,
    expiresAt: account.token_expires_at
      ? new Date(account.token_expires_at)
      : undefined,
  };

  // Proactive refresh: if the access token is expired (or about to be),
  // call the adapter and persist the result before returning.
  const needsRefresh =
    !!tokens.expiresAt &&
    tokens.expiresAt.getTime() - REFRESH_BUFFER_MS <= Date.now() &&
    !!tokens.refreshToken;
  if (!needsRefresh) {
    return { account: account as SocialAccount, tokens, refreshed: false };
  }

  const platform = account.platform as Platform;
  try {
    const adapter = getAdapter(platform);
    const refreshed = await adapter.refreshToken(tokens);
    await saveAccountTokens(accountId, refreshed);
    tokens = refreshed;
    return { account: account as SocialAccount, tokens, refreshed: true };
  } catch {
    // Refresh failed — return the stale token and let the publish attempt
    // surface a clean 401 instead of pretending the account is healthy.
    return {
      account: account as SocialAccount,
      tokens,
      refreshed: false,
    };
  }
}

/** Persist (encrypted) tokens back to an account row. */
export async function saveAccountTokens(
  accountId: string,
  tokens: TokenSet
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("social_accounts")
    .update({
      access_token_enc: encryptToken(tokens.accessToken),
      refresh_token_enc: tokens.refreshToken
        ? encryptToken(tokens.refreshToken)
        : null,
      token_expires_at: tokens.expiresAt?.toISOString() ?? null,
      status: "active",
    })
    .eq("id", accountId);
  if (error) throw new Error(`Failed to save tokens: ${error.message}`);
}

/**
 * If a freshly exchanged token has a short lifetime AND a refresh token is
 * available, immediately call the adapter's refresh path and return the
 * longer-lived result. Foregrounded in the OAuth callback so the very
 * first persisted token is as durable as the platform allows — preventing
 * the "added an account and it expired in an hour" failure mode.
 *
 * Falls back to the original token on any error so a refresh hiccup never
 * blocks users from completing OAuth. The proactive refresh in
 * `getAccountTokens` (used at publish time) will retry the same call later.
 */
export async function ensureLongLivedTokens(
  platform: Platform,
  tokens: TokenSet
): Promise<TokenSet> {
  const hasShortLifetime =
    !!tokens.expiresAt &&
    tokens.expiresAt.getTime() - Date.now() < PREFERRED_MIN_LIFETIME_MS;
  if (!hasShortLifetime || !tokens.refreshToken) return tokens;

  try {
    const adapter = getAdapter(platform);
    const refreshed = await adapter.refreshToken(tokens);
    return refreshed;
  } catch {
    return tokens;
  }
}

/** Upsert a connected profile as a social_accounts row. */
export async function upsertSocialAccount(params: {
  orgId: string;
  userId: string;
  platform: Platform;
  profile: ConnectedProfile;
  userTokens: TokenSet;
}): Promise<string> {
  const { orgId, userId, platform, profile, userTokens } = params;
  const tokens = profile.tokenOverride ?? userTokens;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("social_accounts")
    .upsert(
      {
        org_id: orgId,
        platform,
        external_id: profile.externalId,
        handle: profile.handle ?? null,
        display_name: profile.displayName ?? null,
        avatar_url: profile.avatarUrl ?? null,
        access_token_enc: encryptToken(tokens.accessToken),
        refresh_token_enc: tokens.refreshToken
          ? encryptToken(tokens.refreshToken)
          : null,
        token_expires_at: tokens.expiresAt?.toISOString() ?? null,
        scopes: userTokens.scopes ?? [],
        status: "active",
        connected_by: userId,
        metadata: (profile.metadata ?? {}) as never,
      },
      { onConflict: "org_id,platform,external_id" }
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert social account: ${error?.message}`);
  }
  return data.id;
}
