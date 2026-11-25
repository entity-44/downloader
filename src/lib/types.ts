export const DOWNLOAD_STATUS = ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "EXPIRED"] as const;
export type DownloadStatus = (typeof DOWNLOAD_STATUS)[number];

/** How the application obtained access to a piece of media. */
export const MEDIA_SOURCE = ["CONNECTED_ACCOUNT", "USER_UPLOAD", "ARCHIVE_IMPORT"] as const;
export type MediaSource = (typeof MEDIA_SOURCE)[number];

export const MEDIA_TYPE = ["IMAGE", "VIDEO", "CAROUSEL", "REEL"] as const;
export type MediaType = (typeof MEDIA_TYPE)[number];

export type FileKind = "IMAGE" | "VIDEO";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const ARCHIVE_CATEGORIES = [
  "post",
  "reel",
  "story",
  "igtv",
  "profile",
  "archived",
  "message",
  "other",
] as const;
export type ArchiveCategory = (typeof ARCHIVE_CATEGORIES)[number];
