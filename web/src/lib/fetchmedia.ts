import { RELAY_URL } from "./config";
import { mergeAudioVideo } from "./merge";
import { parseDashManifest } from "./reddit";
import { sniffBlob } from "./sniff";
import { UserError, type MediaItem } from "./types";

const ALLOWED = /(^|\.)(cdninstagram\.com|fbcdn\.net|redd\.it|redditmedia\.com|twimg\.com|redgifs\.com|pximg\.net)$/i;

function assertAllowed(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED.test(u.hostname)) throw new UserError("Unexpected media host; refusing to fetch.");
}

/** Fetch a media URL, falling back in order: directly → media relay → the bookmarklet's tab. */
export async function fetchFile(url: string, fetcher: typeof fetch = fetch): Promise<Blob> {
  assertAllowed(url);
  const expired = () => new UserError("The file link expired or is unavailable. Use the button on the post again to get fresh links.");
  try {
    const res = await fetcher(url, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (res.ok) return await res.blob();
    if (res.status === 404 || res.status === 410) throw expired();
  } catch (e) {
    if (e instanceof UserError) throw e;
    // Cross-origin read blocked; try the relay.
  }
  if (RELAY_URL) {
    try {
      const res = await fetcher(`${RELAY_URL}/media?u=${encodeURIComponent(url)}`, { credentials: "omit" });
      if (res.ok) return await res.blob();
      if (res.status === 404 || res.status === 403 || res.status === 410) {
        throw expired();
      }
    } catch (e) {
      if (e instanceof UserError) throw e;
    }
  }
  throw new UserError("Couldn't download this file right now. Use “Open file” to save it from Instagram directly, or tap the button on the post again.");
}

export type Progress = (stage: string, fraction?: number) => void;

/** Downloads one item, merging Reddit's separate audio track when present. */
export async function downloadItem(item: MediaItem, onProgress?: Progress, url: string = item.url, audioUrl?: string): Promise<{ blob: Blob; mergedAudio: boolean; note?: string }> {
  onProgress?.("Downloading");
  const video = await fetchFile(url);
  const sn = await sniffBlob(video);
  if (!sn) throw new UserError("The downloaded file isn't a supported image or video.");
  // Video-only quality (e.g. Instagram DASH track): fetch its audio and merge.
  if (audioUrl) {
    onProgress?.("Downloading audio");
    let audio: Blob | null = null;
    try {
      audio = await fetchFile(audioUrl);
    } catch {
      /* fall back to video only */
    }
    if (!audio) return { blob: new Blob([video], { type: "video/mp4" }), mergedAudio: false, note: "Couldn't get the audio for this quality; saved without sound. Try the HD option." };
    onProgress?.("Merging audio and video", 0);
    try {
      return { blob: await mergeAudioVideo(video, audio, (p) => onProgress?.("Merging audio and video", p)), mergedAudio: true };
    } catch {
      return { blob: new Blob([video], { type: "video/mp4" }), mergedAudio: false, note: "Couldn't merge the audio; saved the video without sound." };
    }
  }
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
