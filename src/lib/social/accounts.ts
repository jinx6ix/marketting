import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken, decryptToken } from "./crypto";
import type { TokenSet, ConnectedProfile } from "./types";
import type { Platform, SocialAccount } from "@/types/database";

/** Read + decrypt tokens for an account. Service-role only. */
export async function getAccountTokens(accountId: string): Promise<{
  account: SocialAccount;
  tokens: TokenSet;
}> {
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
  return {
    account: account as SocialAccount,
    tokens: {
      accessToken: decryptToken(account.access_token_enc),
      refreshToken: account.refresh_token_enc
        ? decryptToken(account.refresh_token_enc)
        : undefined,
      expiresAt: account.token_expires_at
        ? new Date(account.token_expires_at)
        : undefined,
    },
  };
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
