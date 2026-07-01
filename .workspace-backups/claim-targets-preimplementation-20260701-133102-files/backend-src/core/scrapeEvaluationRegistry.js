const runs = new Map();
const TERMINAL_TTL_MS = 60 * 60 * 1000;

function key(contentId) {
  const value = Number(contentId);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function setScrapeEvaluationStatus(contentId, status, details = {}) {
  const contentKey = key(contentId);
  if (!contentKey) return null;
  const record = {
    contentId: contentKey,
    status,
    updatedAt: new Date().toISOString(),
    ...details,
  };
  runs.set(contentKey, record);
  if (status === "complete" || status === "failed") {
    const timer = setTimeout(() => runs.delete(contentKey), TERMINAL_TTL_MS);
    timer.unref?.();
  }
  return record;
}

export function getScrapeEvaluationStatus(contentId) {
  return runs.get(key(contentId)) || null;
}

