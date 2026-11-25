import type { FFmpeg } from "@ffmpeg/ffmpeg";

let instance: Promise<FFmpeg> | undefined;

/** Lazily loads the self-hosted single-threaded FFmpeg (no special headers needed). */
async function ffmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  instance ??= (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const f = new FFmpeg();
    const base = new URL(`${import.meta.env.BASE_URL}ffmpeg/`, location.href).toString();
    await f.load({ coreURL: `${base}ffmpeg-core.js`, wasmURL: `${base}ffmpeg-core.wasm` });
    return f;
  })();
  const f = await instance;
  if (onLog) f.on("log", ({ message }) => onLog(message));
  return f;
}

/** Combines a video-only and an audio-only MP4 into one file without re-encoding. */
export async function mergeAudioVideo(video: Blob, audio: Blob, onProgress?: (p: number) => void): Promise<Blob> {
  const f = await ffmpeg();
  const handler = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
  f.on("progress", handler);
  try {
    await f.writeFile("v.mp4", new Uint8Array(await video.arrayBuffer()));
    await f.writeFile("a.mp4", new Uint8Array(await audio.arrayBuffer()));
    const code = await f.exec(["-y", "-i", "v.mp4", "-i", "a.mp4", "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", "out.mp4"]);
    if (code !== 0) throw new Error("Merging failed.");
    const data = (await f.readFile("out.mp4")) as Uint8Array;
    return new Blob([data.slice().buffer], { type: "video/mp4" });
  } finally {
    f.off("progress", handler);
    await Promise.all(["v.mp4", "a.mp4", "out.mp4"].map((n) => f.deleteFile(n).catch(() => {})));
  }
}

export function ffmpegLoaded() {
  return instance !== undefined;
}
