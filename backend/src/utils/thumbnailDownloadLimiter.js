import { createConcurrencyLimiter } from "./concurrencyLimiter.js";

export const THUMBNAIL_DOWNLOAD_CONCURRENCY = 3;
export const THUMBNAIL_DOWNLOAD_TIMEOUT_MS = 6000;

// One process-wide queue shared by every content thumbnail download.
export const runWithThumbnailDownloadSlot = createConcurrencyLimiter(
  THUMBNAIL_DOWNLOAD_CONCURRENCY,
);
