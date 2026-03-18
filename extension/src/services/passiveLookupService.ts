/**
 * Passive Lookup Service
 * Handles lightweight URL lookups without triggering analysis
 */

import { canonicalizeUrl, sha256Hex, isSensitiveUrl } from './urlCanonicalizer';
import {
  getCached,
  setCached,
  createCacheEntry,
  deduplicateRequest,
  type LookupResult,
  type LookupStatus
} from './urlCacheService';

const BASE_URL = process.env.REACT_APP_EXTENSION_BASE_URL || "https://localhost:5001";

/**
 * Passive lookup: check if URL is rated, without triggering analysis
 * Returns immediately from cache if available
 */
export async function passiveLookup(rawUrl: string): Promise<LookupResult> {
  // Step 1: Check if sensitive
  if (isSensitiveUrl(rawUrl)) {
    console.log('[PassiveLookup] Skipping sensitive URL');
    return createCacheEntry('unknown');
  }

  // Step 2: Canonicalize
  const canonical = canonicalizeUrl(rawUrl);
  if (!canonical) {
    console.log('[PassiveLookup] URL rejected by canonicalizer');
    return createCacheEntry('unknown');
  }

  // Step 3: Hash
  const urlHash = await sha256Hex(canonical);

  // Step 4: Check cache
  const cached = await getCached(urlHash);
  if (cached) {
    console.log(`[PassiveLookup] Cache hit for ${urlHash.substring(0, 8)}... (${cached.status})`);
    return cached;
  }

  console.log(`[PassiveLookup] Cache miss for ${urlHash.substring(0, 8)}...`);

  // Step 5: Deduplicated backend lookup
  return deduplicateRequest(urlHash, async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/lookup-by-hash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlHash }),
      });

      if (!response.ok) {
        console.error(`[PassiveLookup] Backend error: ${response.status}`);
        const errorResult = createCacheEntry('error');
        setCached(urlHash, errorResult);
        return errorResult;
      }

      const data = await response.json();

      let result: LookupResult;

      if (data.exists && data.contentId) {
        // Content exists and is rated
        result = createCacheEntry(
          'rated',
          data.contentId,
          data.verimeterScore,
          data.task
        );
      } else if (data.exists) {
        // Content exists but not yet rated
        result = createCacheEntry('known_unrated', data.contentId);
      } else {
        // Not in database
        result = createCacheEntry('unknown');
      }

      // Cache the result
      setCached(urlHash, result);

      console.log(`[PassiveLookup] Backend lookup complete: ${result.status}`);
      return result;

    } catch (err) {
      console.error('[PassiveLookup] Network error:', err);
      const errorResult = createCacheEntry('error');
      setCached(urlHash, errorResult);
      return errorResult;
    }
  });
}

/**
 * Debounced passive lookup - waits for user to stop navigating
 * Use this for page load events to avoid spamming the backend
 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function debouncedPassiveLookup(
  rawUrl: string,
  delayMs: number = 500
): Promise<LookupResult> {
  return new Promise((resolve) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      const result = await passiveLookup(rawUrl);
      resolve(result);
    }, delayMs);
  });
}
