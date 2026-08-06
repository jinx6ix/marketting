import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "crypto";
import { decryptToken, encryptToken } from "./crypto";

describe("token crypto (AES-256-GCM)", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips plaintext", () => {
    const secret = "ya29.a0AfB_secret-token-value";
    expect(decryptToken(encryptToken(secret))).toBe(secret);
  });

  it("round-trips unicode and long payloads", () => {
    const secret = "tökén-⚡-".repeat(500);
    expect(decryptToken(encryptToken(secret))).toBe(secret);
  });

  it("produces a different ciphertext per call (random IV)", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });

  it("rejects tampered ciphertext", () => {
    const enc = Buffer.from(encryptToken("secret"), "base64");
    enc[14] ^= 0xff; // flip a ciphertext bit past the 12-byte IV
    expect(() => decryptToken(enc.toString("base64"))).toThrow();
  });

  it("cannot decrypt with a different key", () => {
    const enc = encryptToken("secret");
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptToken(enc)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    expect(() => encryptToken("x")).toThrow(/32 bytes/);
  });

  it("rejects a missing key", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(/not set/);
  });
});
