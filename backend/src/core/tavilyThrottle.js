// backend/src/core/tavilyThrottle.js
let lastTavilyCall = 0;

// 150ms = ~7 calls/sec = optimal for free-tier
const TAVILY_MIN_DELAY = 150;

export async function throttledTavilySearch(fn) {
  const now = Date.now();
  const wait = Math.max(0, lastTavilyCall + TAVILY_MIN_DELAY - now);

  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  lastTavilyCall = Date.now();
  return fn();
}
