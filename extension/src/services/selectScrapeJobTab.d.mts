export type BrowserTabLike = {
  id?: number | null;
  url?: string | null;
};

export function selectScrapeJobTab<T extends BrowserTabLike>(input: {
  tabs: T[];
  targetUrl: string;
  openedTabId?: number | null;
  extensionInstanceId?: string | null;
  currentInstanceId: string;
  matchesUrl: (tabUrl: string, targetUrl: string) => boolean;
}): T | null;
