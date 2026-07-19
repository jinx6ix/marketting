import "server-only";
import { createHash, randomBytes } from "crypto";

/** Shared OAuth helpers: state + PKCE. */

export function generateState(): string {
  return randomBytes(24).toString("base64url");
}

export function generatePkcePair(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function appUrl(path = ""): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

export function redirectUri(platform: string): string {
  return appUrl(`/api/social/${platform}/callback`);
}

/** application/x-www-form-urlencoded body helper */
export function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}
