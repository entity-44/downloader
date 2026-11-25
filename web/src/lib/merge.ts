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

/** Pixiv ugoira: turn a ZIP of frames + per-frame delays into an MP4 (variable frame timing kept). */
export async function ugoiraToMp4(zip: Blob, frames: Array<{ file: string; delay: number }>, onProgress?: (p: number) => void): Promise<Blob> {
  const { ZipReader, BlobReader, Uint8ArrayWriter } = await import("@zip.js/zip.js");
  const safe = (n: string) => n.replace(/[^\w.-]/g, "_");
  const f = await ffmpeg();
  const written: string[] = [];
  const reader = new ZipReader(new BlobReader(zip));
  try {
    for (const e of await reader.getEntries()) {
      if (e.directory) continue;
      const data = await (e as unknown as { getData: (w: InstanceType<typeof Uint8ArrayWriter>) => Promise<Uint8Array> }).getData(new Uint8ArrayWriter());
      const name = safe(e.filename);
      await f.writeFile(name, data);
      written.push(name);
    }
  } finally {
    await reader.close();
  }
  if (!frames.length) throw new Error("No frames.");
  // ffmpeg concat list: each frame with its own duration; the last frame is repeated so its duration is honoured.
  let list = "";
  for (const fr of frames) list += `file '${safe(fr.file)}'\nduration ${(Math.max(fr.delay, 10) / 1000).toFixed(3)}\n`;
  list += `file '${safe(frames[frames.length - 1].file)}'\n`;
  await f.writeFile("list.txt", new TextEncoder().encode(list));
  const handler = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
  f.on("progress", handler);
  try {
    const code = await f.exec(["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-vsync", "vfr", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-movflags", "+faststart", "ugoira.mp4"]);
    if (code !== 0) throw new Error("Converting the animation failed.");
    const data = (await f.readFile("ugoira.mp4")) as Uint8Array;
    return new Blob([data.slice().buffer], { type: "video/mp4" });
  } finally {
    f.off("progress", handler);
    await Promise.all([...written, "list.txt", "ugoira.mp4"].map((n) => f.deleteFile(n).catch(() => {})));
  }
}

export function ffmpegLoaded() {
  return instance !== undefined;
}
