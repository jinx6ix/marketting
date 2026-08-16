"use client";

export interface CompressOptions {
  /** Cap the longest video dimension at this many pixels. Default 1280 (~720p). */
  maxWidth?: number;
  /** libx264 CRF — higher = smaller file, lower quality. 23 is "visually fine", 28 is aggressive. */
  crf?: number;
  onProgress?: (pct: number) => void;
}

/**
 * Re-encodes a video client-side (H.264/AAC, scaled down) using ffmpeg.wasm,
 * to shrink it before upload — Supabase enforces a hard project-wide upload
 * size cap (50MB on the Free plan, and even Pro defaults to a limit that has
 * to be manually raised) that no amount of server-side code can bypass, so
 * for large videos the only way to make an upload actually succeed is to
 * make the file smaller first.
 *
 * Uses the single-thread ffmpeg.wasm core (@ffmpeg/core, not @ffmpeg/core-mt)
 * deliberately: the multi-thread core needs SharedArrayBuffer, which needs
 * Cross-Origin-Opener/Embedder-Policy headers set app-wide — those headers
 * would also block other cross-origin resources this app already relies on
 * (Supabase Storage images, OAuth redirects, etc.) unless every one of them
 * is individually exempted. Single-thread is slower (one CPU core instead of
 * several) but "no header changes anywhere else in the app" was judged worth
 * more than compression speed for an occasional, deliberate action.
 */
export async function compressVideo(
  file: File,
  { maxWidth = 1280, crf = 28, onProgress }: CompressOptions = {}
): Promise<File> {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { toBlobURL, fetchFile } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
  if (onProgress) {
    ffmpeg.on("progress", ({ progress }) => {
      onProgress(Math.max(0, Math.min(99, Math.round(progress * 100))));
    });
  }

  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  const inputName = "input" + (file.name.match(/\.[^.]+$/)?.[0] ?? ".mp4");
  const outputName = "output.mp4";

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  await ffmpeg.exec([
    "-i",
    inputName,
    "-vf",
    `scale='min(${maxWidth},iw)':-2`, // -2 keeps height even (H.264 requirement)
    "-c:v",
    "libx264",
    "-crf",
    String(crf),
    "-preset",
    "veryfast", // browser CPU is precious; favor speed over max compression
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    outputName,
  ]);

  const data = await ffmpeg.readFile(outputName);
  onProgress?.(100);

  const blob = new Blob([data as unknown as BlobPart], { type: "video/mp4" });
  const newName = file.name.replace(/\.[^.]+$/, "") + "-compressed.mp4";
  return new File([blob], newName, { type: "video/mp4" });
}