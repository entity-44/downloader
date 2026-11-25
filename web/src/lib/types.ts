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
};

/** A downloadable size. audioUrl: separate audio stream to merge (DASH video-only tracks). */
export type Variant = { url: string; width?: number; height?: number; audioUrl?: string };

export type Post = {
  platform: "instagram" | "reddit";
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
