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
    ...(runs.get(contentKey) || {}),
    contentId: contentKey,
    status,
    updatedAt: new Date().toISOString(),
    progressVersion: Number(runs.get(contentKey)?.progressVersion || 0) + 1,
    ...details,
  };
  runs.set(contentKey, record);
  if (status === "complete" || status === "failed") {
    const timer = setTimeout(() => runs.delete(contentKey), TERMINAL_TTL_MS);
    timer.unref?.();
  }
  return record;
}

export function updateScrapeEvaluationProgress(contentId, details = {}) {
  const existing = getScrapeEvaluationStatus(contentId) || {};
  return setScrapeEvaluationStatus(contentId, existing.status || "running", {
    ...details,
    counts: {
      ...(existing.counts || {}),
      ...(details.counts || {}),
    },
  });
}

export function getScrapeEvaluationStatus(contentId) {
  return runs.get(key(contentId)) || null;
}
