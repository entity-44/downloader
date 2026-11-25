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
};

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
