import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../config";
import { log } from "../log";

let resolvedBin: string | null | undefined;
let availability: Promise<boolean> | undefined;

/** FFMPEG_PATH → ffmpeg-static (local dev) → `ffmpeg` on PATH. */
export function ffmpegBinary(): string {
  if (resolvedBin) return resolvedBin;
  const configured = getConfig().ffmpegPath;
  if (configured) return (resolvedBin = configured);
  const local = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  resolvedBin = existsSync(local) ? local : "ffmpeg";
  return resolvedBin;
}

type RunResult = { code: number | null; stderr: string };

/** Runs ffmpeg with an argument array (never a shell), bounded time and output. */
export function runFfmpeg(args: string[], timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary(), ["-hide_banner", "-nostdin", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += d.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

export function ffmpegAvailable(): Promise<boolean> {
  availability ??= runFfmpeg(["-version"], 10_000)
    .then((r) => r.code === 0)
    .catch(() => false)
    .then((ok) => {
      if (!ok) log.warn("FFmpeg not found; video thumbnails and metadata are disabled. Set FFMPEG_PATH.");
      return ok;
    });
  return availability;
}

export type VideoInfo = { durationSec: number | null; width: number | null; height: number | null };

export function parseFfmpegInfo(stderr: string): VideoInfo {
  const d = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const v = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  return {
    durationSec: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
    width: v ? Number(v[1]) : null,
    height: v ? Number(v[2]) : null,
  };
}

/** Reads duration and dimensions. ffmpeg exits non-zero without an output; that's expected. */
export async function probeVideo(input: string): Promise<VideoInfo | null> {
  if (!(await ffmpegAvailable())) return null;
  try {
    const r = await runFfmpeg(["-i", input], 20_000);
    return parseFfmpegInfo(r.stderr);
  } catch {
    return null;
  }
}

/** Extracts a JPEG poster frame (max 640px wide). Returns false on failure. */
export async function createVideoThumbnail(input: string, output: string, durationSec?: number | null): Promise<boolean> {
  if (!(await ffmpegAvailable())) return false;
  const seek = durationSec && durationSec > 2 ? "1" : "0";
  const args = ["-y", "-ss", seek, "-i", input, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "4", "-f", "image2", output];
  try {
    const r = await runFfmpeg(args, 30_000);
    if (r.code === 0 && existsSync(output)) return true;
    log.warn("ffmpeg thumbnail failed", { code: r.code });
  } catch (e) {
    log.warn("ffmpeg thumbnail error", { error: e });
  }
  return false;
}
