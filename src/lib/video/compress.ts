"use client";

export interface CompressOptions {
  /**
   * Aim to land the whole output file under this many bytes. This is the
   * primary control — bitrate is computed from it and the video's actual
   * duration, so output size stays predictable regardless of how long or
   * high-motion the source video is (CRF-only encoding doesn't guarantee
   * this: a long/high-motion video can land well above budget even at an
   * aggressive CRF, which is what let a "compressed" file still 413).
   */
  targetSizeBytes?: number;
  /** Cap the longest video dimension at this many pixels. Default 1280 (~720p). */
  maxWidth?: number;
  onProgress?: (pct: number) => void;
}

const AUDIO_BITRATE_KBPS = 96;
const MIN_VIDEO_BITRATE_KBPS = 250; // floor so very long videos don't end up unwatchable
const FALLBACK_VIDEO_BITRATE_KBPS = 1500; // used only if duration can't be read

/** Reads video duration via a throwaway <video> element — reliable in-browser, no ffmpeg needed. */
function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Could not read video duration"));
    };
    video.src = URL.createObjectURL(file);
  });
}

/**
 * Re-encodes a video client-side (H.264/AAC, scaled down, bitrate-targeted)
 * using ffmpeg.wasm, to shrink it before upload — Supabase enforces a hard
 * project-wide upload size cap (50MB on the Free plan, and even Pro
 * defaults to a limit that has to be manually raised) that no amount of
 * server-side code can bypass, so for large videos the only way to make an
 * upload actually succeed is to make the file smaller first.
 *
 * Bitrate is computed from targetSizeBytes and the source video's actual
 * duration (read via a <video> element, not ffprobe) rather than relying on
 * CRF alone, so the output size is predictable up front instead of varying
 * with content complexity.
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
  { targetSizeBytes = 35 * 1024 * 1024, maxWidth = 1280, onProgress }: CompressOptions = {}
): Promise<File> {
  const duration = await getVideoDuration(file).catch(() => null);

  let videoBitrateKbps: number;
  if (duration && duration > 0) {
    const totalKbps = (targetSizeBytes * 8) / duration / 1000;
    videoBitrateKbps = Math.max(
      MIN_VIDEO_BITRATE_KBPS,
      Math.round(totalKbps - AUDIO_BITRATE_KBPS)
    );
  } else {
    videoBitrateKbps = FALLBACK_VIDEO_BITRATE_KBPS;
  }

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { toBlobURL, fetchFile } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
  if (onProgress) {
    ffmpeg.on("progress", ({ progress }) => {
      onProgress(Math.max(0, Math.min(99, Math.round(progress * 100))));
    });
  }

  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
  // @ffmpeg/ffmpeg internally does `new Worker(new URL('./worker.js',
  // import.meta.url))` to spin up its own worker thread when no
  // classWorkerURL is given. Turbopack can't statically analyze that
  // pattern inside the bundled package (a documented incompatibility —
  // see ffmpegwasm/ffmpeg.wasm issues #655/#793) and throws "Cannot find
  // module as expression is too dynamic" instead of ever reaching the
  // actual compression code. Fetching the library's own worker.js from
  // the CDN (matching the exact pinned package version in package.json)
  // and handing it over explicitly sidesteps that code path entirely.
  const ffmpegPkgURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/worker.js";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    classWorkerURL: await toBlobURL(ffmpegPkgURL, "text/javascript"),
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
    "-b:v",
    `${videoBitrateKbps}k`,
    "-maxrate",
    `${Math.round(videoBitrateKbps * 1.5)}k`,
    "-bufsize",
    `${videoBitrateKbps * 2}k`,
    "-preset",
    "veryfast", // browser CPU is precious; favor speed over max compression
    "-c:a",
    "aac",
    "-b:a",
    `${AUDIO_BITRATE_KBPS}k`,
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