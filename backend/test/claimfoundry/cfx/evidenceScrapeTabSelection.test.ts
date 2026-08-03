import assert from "node:assert/strict";
import test from "node:test";
import {
  selectScrapeJobTab,
} from "../../../../extension/src/services/selectScrapeJobTab.mjs";

test("bound browser tab survives a cross-domain redirect", () => {
  const selected = selectScrapeJobTab({
    tabs: [
      { id: 7, url: "https://dashboard.test/" },
      { id: 33, url: "https://archive.example/copy-of-removed-document" },
    ],
    targetUrl: "https://agency.gov/removed-document",
    openedTabId: 33,
    extensionInstanceId: "ext_owner",
    currentInstanceId: "ext_owner",
    matchesUrl: () => false,
  });
  assert.equal(selected?.id, 33);
  assert.equal(
    selected?.url,
    "https://archive.example/copy-of-removed-document",
  );
});

test("another extension instance cannot select a bound tab", () => {
  const selected = selectScrapeJobTab({
    tabs: [{ id: 33, url: "https://archive.example/copy" }],
    targetUrl: "https://agency.gov/removed",
    openedTabId: 33,
    extensionInstanceId: "ext_owner",
    currentInstanceId: "ext_other",
    matchesUrl: () => true,
  });
  assert.equal(selected, null);
});

test("legacy jobs retain URL-based matching", () => {
  const selected = selectScrapeJobTab({
    tabs: [
      { id: 1, url: "https://other.test/" },
      { id: 2, url: "https://source.test/article" },
    ],
    targetUrl: "https://source.test/article",
    currentInstanceId: "ext_any",
    matchesUrl: (left: string, right: string) => left === right,
  });
  assert.equal(selected?.id, 2);
});
