import "server-only";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Platform } from "@/types/database";

export interface MediaEntry {
  storage_path?: string;
  url?: string;
  type?: "image" | "video";
}

/**
 * Per-platform max photo size, in bytes. This is what was actually missing:
 * the publish pipeline uploaded whatever the user attached, unmodified —
 * fine for platforms with generous limits, but Meta rejects Facebook
 * photos over 10MB outright (confirmed via its own error:
 * error_subcode 1366046, "Photos should be less than 10 MB"). Targets here
 * are set a bit under each platform's real limit for safety margin.
 *
 * Only platforms with a known hard photo-size limit are listed — anything
 * absent from this map is passed through untouched (video is never
 * touched here; that has its own client-side compression pipeline).
 */
const PLATFORM_IMAGE_LIMIT_BYTES: Partial<Record<Platform, number>> = {
  facebook: 8 * 1024 * 1024,
  instagram: 8 * 1024 * 1024,
  x: 5 * 1024 * 1024,
  linkedin: 8 * 1024 * 1024,
};

const MAX_DIMENSION = 2048;
const MIN_DIMENSION = 800;
const MIN_QUALITY = 30;

/** Re-encode a JPEG, stepping down quality then dimensions until it fits `targetBytes`. */
async function compressImageToTarget(
  buffer: Buffer,
  targetBytes: number
): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata();
  let width = Math.min(metadata.width ?? MAX_DIMENSION, MAX_DIMENSION);
  let quality = 85;

  let output = await sharp(buffer)
    .rotate() // apply EXIF orientation before stripping metadata
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();

  while (output.byteLength > targetBytes && quality > MIN_QUALITY) {
    quality -= 15;
    output = await sharp(buffer)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
  }

  while (output.byteLength > targetBytes && width > MIN_DIMENSION) {
    width = Math.round(width * 0.8);
    output = await sharp(buffer)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
  }

  return output;
}

/**
 * Prepares media for a specific platform: reuses an already-generated
 * variant if one exists, otherwise compresses any image over that
 * platform's size limit and persists the result as a new variant (a
 * deterministic path under `variants/{platform}/...`, so concurrent
 * workers racing on the same target converge on the same file via
 * upload's upsert rather than creating duplicates).
 *
 * `onVariantCreated` is how the caller persists the new variant back onto
 * the post_targets row — done here rather than inside publish.ts's retry
 * logic so the SAME compressed file is reused on every retry instead of
 * re-compressing (and re-uploading) from scratch each attempt.
 */
export async function resolvePlatformMedia(
  platform: Platform,
  media: MediaEntry[],
  existingVariant: MediaEntry[] | null,
  onVariantCreated: (variant: MediaEntry[]) => Promise<void>
): Promise<MediaEntry[]> {
  if (existingVariant && existingVariant.length > 0) return existingVariant;

  const limit = PLATFORM_IMAGE_LIMIT_BYTES[platform];
  if (!limit) return media;

  const admin = createAdminClient();
  let changed = false;
  const resolved: MediaEntry[] = [];

  for (const m of media) {
    if (m.type !== "image" || !m.storage_path) {
      resolved.push(m);
      continue;
    }

    const variantPath = `variants/${platform}/${m.storage_path}`;

    // Reuse a previously-generated variant for this exact original+platform
    // pairing if one's already sitting in storage (covers a retry after a
    // crash between "created variant" and "wrote it to variant_media").
    const { data: existingFile } = await admin.storage
      .from("media")
      .download(variantPath);
    if (existingFile) {
      resolved.push({ storage_path: variantPath, type: "image" });
      changed = true;
      continue;
    }

    const { data: original, error: downloadError } = await admin.storage
      .from("media")
      .download(m.storage_path);
    if (downloadError || !original) {
      // Can't read the original at all — not a size problem, let the
      // normal publish flow surface whatever error comes from that.
      resolved.push(m);
      continue;
    }

    const buffer = Buffer.from(await original.arrayBuffer());
    if (buffer.byteLength <= limit) {
      resolved.push(m);
      continue;
    }

    const compressed = await compressImageToTarget(buffer, limit);
    const { error: uploadError } = await admin.storage
      .from("media")
      .upload(variantPath, compressed, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (uploadError) {
      // Compression/upload failed — fall back to the original rather than
      // silently dropping the image; the platform will give its own
      // (now-expected) size error, which is still better than losing media.
      resolved.push(m);
      continue;
    }

    resolved.push({ storage_path: variantPath, type: "image" });
    changed = true;
  }

  if (changed) await onVariantCreated(resolved);
  return resolved;
}