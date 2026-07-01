/**
 * URL Cache Service
 * Implements local caching with TTL for URL lookup results
 */

export type LookupStatus = "rated" | "known_unrated" | "unknown" | "processing" | "error";

export interface LookupResult {
  status: LookupStatus;
  contentId?: number;
  score?: number;
  checkedAt: number;
  expiresAt: number;
  taskData?: any; // Full task data if available
}

// TTL values in milliseconds
export const TTL = {
  rated: 24 * 60 * 60 * 1000,           // 24 hours
  known_unrated: 6 * 60 * 60 * 1000,    // 6 hours
  unknown: 1 * 60 * 60 * 1000,          // 1 hour
  processing: 2 * 60 * 1000,            // 2 minutes
  error: 2 * 60 * 1000,                 // 2 minutes
};

// Memory cache (survives during session)
const memoryCache = new Map<string, LookupResult>();

// In-flight requests to prevent duplicate lookups
const inflightRequests = new Map<string, Promise<LookupResult>>();

/**
 * Check if a cache entry is still fresh
 */
export function isFresh(entry?: LookupResult | null): boolean {
  return !!entry && Date.now() < entry.expiresAt;
}

/**
 * Get cached result from memory or storage
 */
export async function getCached(urlHash: string): Promise<LookupResult | null> {
  // Check memory first (fast)
  const memEntry = memoryCache.get(urlHash);
  if (memEntry && isFresh(memEntry)) {
    return memEntry;
  }

  // Check localStorage (slower but persists)
  try {
    const storageKey = `url_cache_${urlHash}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const entry: LookupResult = JSON.parse(stored);
      if (isFresh(entry)) {
        // Warm up memory cache
        memoryCache.set(urlHash, entry);
        return entry;
      } else {
        // Expired - clean up
        localStorage.removeItem(storageKey);
      }
    }
  } catch (err) {
    console.warn('[Cache] Failed to read from localStorage:', err);
  }

  return null;
}

/**
 * Store result in both memory and local storage
 */
export function setCached(urlHash: string, result: LookupResult): void {
  // Store in memory
  memoryCache.set(urlHash, result);

  // Store in localStorage
  try {
    const storageKey = `url_cache_${urlHash}`;
    localStorage.setItem(storageKey, JSON.stringify(result));
  } catch (err) {
    console.warn('[Cache] Failed to write to localStorage:', err);
    // Continue even if localStorage fails - memory cache still works
  }
}

/**
 * Create a cache entry with appropriate TTL
 */
export function createCacheEntry(
  status: LookupStatus,
  contentId?: number,
  score?: number,
  taskData?: any
): LookupResult {
  const now = Date.now();
  const ttl = TTL[status];

  return {
    status,
    contentId,
    score,
    taskData,
    checkedAt: now,
    expiresAt: now + ttl,
  };
}

/**
 * Check if we already have an in-flight request for this URL
 * If yes, return that promise. If no, execute the lookup function.
 */
export async function deduplicateRequest<T>(
  key: string,
  lookupFn: () => Promise<T>
): Promise<T> {
  // Check if already in flight
  const existing = inflightRequests.get(key);
  if (existing) {
    console.log(`[Cache] Deduplicating request for ${key}`);
    return existing as Promise<T>;
  }

  // Start new request
  const promise = lookupFn().finally(() => {
    // Clean up when done
    inflightRequests.delete(key);
  });

  inflightRequests.set(key, promise as any);
  return promise;
}

/**
 * Clear all cached data (for debugging/testing)
 */
export function clearCache(): void {
  memoryCache.clear();
  inflightRequests.clear();

  // Clear localStorage entries
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('url_cache_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (err) {
    console.warn('[Cache] Failed to clear localStorage:', err);
  }
}

/**
 * Clean up expired entries from localStorage
 * Call this periodically to prevent storage bloat
 */
export function cleanupExpired(): void {
  try {
    const keysToRemove: string[] = [];
    const now = Date.now();

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('url_cache_')) {
        try {
          const stored = localStorage.getItem(key);
          if (stored) {
            const entry: LookupResult = JSON.parse(stored);
            if (now >= entry.expiresAt) {
              keysToRemove.push(key);
            }
          }
        } catch {
          // Invalid entry - remove it
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));

    if (keysToRemove.length > 0) {
      console.log(`[Cache] Cleaned up ${keysToRemove.length} expired entries`);
    }
  } catch (err) {
    console.warn('[Cache] Failed to cleanup expired entries:', err);
  }
}

// Run cleanup every 10 minutes
if (typeof window !== 'undefined') {
  setInterval(cleanupExpired, 10 * 60 * 1000);
}
