import { bridgeAvailable, bridgeFetch } from "./bridge";
import { mergeAudioVideo } from "./merge";
import { parseDashManifest } from "./reddit";
import { sniffBlob } from "./sniff";
import { UserError, type MediaItem } from "./types";

const ALLOWED = /(^|\.)(cdninstagram\.com|fbcdn\.net|redd\.it|redditmedia\.com)$/i;

function assertAllowed(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED.test(u.hostname)) throw new UserError("Unexpected media host; refusing to fetch.");
}

/** Fetches a media URL: directly if the CDN allows it, otherwise through the bookmarklet tab. */
export async function fetchFile(url: string): Promise<Blob> {
  assertAllowed(url);
  try {
    const res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (res.ok) return await res.blob();
    if (res.status === 403 || res.status === 404 || res.status === 410) {
      throw new UserError("The file link expired or is unavailable. Use the button on the post again to get fresh links.");
    }
  } catch (e) {
    if (e instanceof UserError) throw e;
    // Likely blocked cross-origin read; fall through to the bridge.
  }
  if (bridgeAvailable()) return bridgeFetch(url);
  throw new UserError("Your browser blocked downloading this file directly. Keep the original tab open and use the one-click button, or use “Open file”.");
}

export type Progress = (stage: string, fraction?: number) => void;

/** Downloads one item, merging Reddit's separate audio track when present. */
export async function downloadItem(item: MediaItem, onProgress?: Progress): Promise<{ blob: Blob; mergedAudio: boolean; note?: string }> {
  onProgress?.("Downloading");
  const video = await fetchFile(item.url);
  const sn = await sniffBlob(video);
  if (!sn) throw new UserError("The downloaded file isn't a supported image or video.");
  if (item.kind !== "VIDEO" || !item.dashUrl || item.hasAudio === false) return { blob: new Blob([video], { type: sn.mime }), mergedAudio: false };

  let audio: Blob | null = null;
  try {
    const res = await fetch(item.dashUrl, { credentials: "omit" });
    if (res.ok) {
      const tracks = parseDashManifest(await res.text(), item.dashUrl);
      const a = tracks.audios[0];
      if (a) {
        onProgress?.("Downloading audio");
        audio = await fetchFile(a.url);
      }
    }
  } catch {
    /* no audio available */
  }
  if (!audio) return { blob: new Blob([video], { type: "video/mp4" }), mergedAudio: false, note: "This video has no audio track." };
  onProgress?.("Merging audio and video", 0);
  try {
    const merged = await mergeAudioVideo(video, audio, (p) => onProgress?.("Merging audio and video", p));
    return { blob: merged, mergedAudio: true };
  } catch {
    return { blob: new Blob([video], { type: "video/mp4" }), mergedAudio: false, note: "Couldn't merge the audio; saved the video without sound." };
  }
}
