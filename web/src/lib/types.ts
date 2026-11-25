export type Kind = "IMAGE" | "VIDEO";

export type MediaItem = {
  kind: Kind;
  url: string;
  width?: number;
  height?: number;
  thumbUrl?: string;
  /** Reddit DASH manifest; audio is a separate stream that must be merged. */
  dashUrl?: string;
  hasAudio?: boolean;
  durationSec?: number;
  /** Other sizes available, largest first (the first equals url). */
  variants?: Variant[];
  /** Cover/thumbnail image sizes for videos, largest first. */
  thumbVariants?: Variant[];
  /** Pixiv ugoira: url points to a ZIP of frames, converted to MP4 on download. */
  ugoira?: { frames: Array<{ file: string; delay: number }> };
  /** Already-downloaded file (e.g. a TikTok video fetched in the TikTok tab). */
  blob?: Blob;
  /** Section heading (e.g. "Stories", "Highlight: Summer") for grouped results. */
  group?: string;
};

/** A downloadable size. audioUrl: separate audio stream to merge (DASH video-only tracks). */
export type Variant = { url: string; width?: number; height?: number; audioUrl?: string; /** Display text (overrides the size). */ label?: string; /** Download the file as-is (e.g. ugoira frames ZIP). */ raw?: boolean };

export type Post = {
  platform: "instagram" | "reddit" | "x" | "redgifs" | "pixiv" | "snapchat" | "tiktok";
  id: string;
  url: string;
  author?: string;
  title?: string;
  caption?: string;
  takenAt?: string;
  items: MediaItem[];
  /** Items that exist but can't be downloaded (e.g. external links). */
  notes?: string[];
};

export class UserError extends Error {}
