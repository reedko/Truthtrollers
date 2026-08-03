/**
 * Select the tab for one production scrape job.
 *
 * A bound tab ID is authoritative inside its bound extension instance and is
 * intentionally independent of the tab's current URL so redirects do not lose
 * correlation. Legacy jobs retain URL matching through the injected matcher.
 */
export function selectScrapeJobTab({
  tabs,
  targetUrl,
  openedTabId = null,
  extensionInstanceId = null,
  currentInstanceId,
  matchesUrl,
}) {
  if (
    extensionInstanceId &&
    extensionInstanceId !== currentInstanceId
  ) {
    return null;
  }
  const available = Array.isArray(tabs) ? tabs : [];
  if (openedTabId !== null && openedTabId !== undefined) {
    return available.find(
      (tab) => Number(tab?.id) === Number(openedTabId),
    ) || null;
  }
  if (typeof matchesUrl !== "function") return null;
  return available.find((tab) => matchesUrl(tab?.url, targetUrl)) || null;
}
