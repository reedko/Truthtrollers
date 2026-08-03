import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createWikipediaPerennialSourcesProvider,
  wikipediaPerennialSourcesProvider,
} from "../../services/sourceProviders/providers/wikipediaPerennialSourcesProvider.js";
import { wikipediaProvider } from "../../services/sourceProviders/providers/wikipediaProvider.js";
import {
  listProviders,
  lookupPublisherAllProviders,
} from "../../services/sourceProviders/sourceProviderRegistry.js";
import {
  mapProviderSignalToAdmiralty,
  summarizeProviderSignals,
} from "../../services/providerSignalMapper.js";
import { persistProviderSignals } from "../../src/services/providerSignalPersistenceService.js";
import { parsePerennialSourcesHtml } from "../../scripts/refreshWikipediaPerennialSources.js";

const backendRoot = path.resolve(".");

function entry(entryId, name, classification, { aliases = [], domains = [] } = {}) {
  return {
    entryId,
    name,
    aliases: [name, ...aliases],
    domains,
    classification,
    rawClassification: classification,
    scopeAndSummary: `${name} test scope`,
    evidenceUrl: `https://en.wikipedia.org/wiki/${entryId}`,
    discussionUrls: [],
    useUrls: [],
  };
}

function dataset(entries, suffix = "one") {
  return {
    revisionId: suffix,
    parserVersion: "test-parser-v1",
    entriesSha256: `hash-${suffix}`,
    entryCount: entries.length,
    entries,
  };
}

test("matches reliable, deprecated, alias, and exact-domain entries from the pinned snapshot", async () => {
  const reuters = await wikipediaPerennialSourcesProvider.lookupPublisher({
    publisherName: "Reuters",
    sourceUrl: "https://www.reuters.com/world/example",
  });
  assert.equal(reuters.status, "matched");
  assert.equal(reuters.normalized.classification, "generally reliable");
  assert.equal(reuters.matchMethod, "name_and_domain_exact");

  const dailyMail = await wikipediaPerennialSourcesProvider.lookupPublisher({ publisherName: "Daily Mail" });
  assert.equal(dailyMail.normalized.classification, "deprecated");
  assert.equal(dailyMail.matchedEntity, "Daily Mail (MailOnline)");

  const apAlias = await wikipediaPerennialSourcesProvider.lookupPublisher({ publisherName: "Associated Press" });
  assert.equal(apAlias.normalized.classification, "generally reliable");
  assert.equal(apAlias.matchedEntity, "Associated Press (AP)");

  const apDomain = await wikipediaPerennialSourcesProvider.lookupPublisher({ sourceUrl: "https://apnews.com/article/example" });
  assert.equal(apDomain.matchMethod, "domain_exact");
  assert.equal(apDomain.matchedEntity, "Associated Press (AP)");
});

test("keeps no-match, ambiguity, parent identity, and provider errors distinct", async () => {
  const noMatch = await wikipediaPerennialSourcesProvider.lookupPublisher({ publisherName: "Unlisted Local Gazette 87421" });
  assert.equal(noMatch.status, "no_match");
  assert.equal(noMatch.matchFound, false);

  const parentOnly = await wikipediaPerennialSourcesProvider.lookupPublisher({
    publisherName: "Unlisted Local Gazette 87421",
    parentPublisherName: "Reuters",
  });
  assert.equal(parentOnly.status, "no_match");
  assert.equal(parentOnly.diagnostics.parentPublisherNotInferred, true);

  const ambiguousProvider = createWikipediaPerennialSourcesProvider(dataset([
    entry("one", "Outlet One", "no consensus", { aliases: ["Shared Name"] }),
    entry("two", "Outlet Two", "generally unreliable", { aliases: ["Shared Name"] }),
  ]));
  const ambiguous = await ambiguousProvider.lookupPublisher({ publisherName: "Shared Name" });
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.diagnostics.candidates.length, 2);

  const broken = await createWikipediaPerennialSourcesProvider({ loadError: "fixture load failure" })
    .lookupPublisher({ publisherName: "Reuters" });
  assert.equal(broken.status, "error");
  assert.match(broken.errorMessage, /fixture load failure/u);
});

test("keeps ordinary Wikipedia lookup and Perennial Sources classification separate", async () => {
  const names = listProviders().map((provider) => provider.name);
  assert(names.includes("wikipedia"));
  assert(names.includes("wikipedia_perennial_sources"));
  assert.notEqual(names.indexOf("wikipedia"), names.indexOf("wikipedia_perennial_sources"));

  const originalFetch = global.fetch;
  try {
    global.fetch = async (url) => String(url).includes("list=search")
      ? { ok: true, json: async () => ({ query: { search: [{ title: "Example Biography Subject", pageid: 91, snippet: "Example Biography Subject" }] } }) }
      : { ok: true, json: async () => ({ title: "Example Biography Subject", extract: "An encyclopedia biography.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Example" } } }) };
    const ordinaryMatch = await wikipediaProvider.lookupPublisher({ publisherName: "Example Biography Subject" });
    const noPerennial = await wikipediaPerennialSourcesProvider.lookupPublisher({ publisherName: "Example Biography Subject" });
    assert.equal(ordinaryMatch.matchFound, true, "ordinary Wikipedia can match an entity absent from the Perennial Sources table");
    assert.equal(noPerennial.status, "no_match");

    global.fetch = async () => ({ ok: true, json: async () => ({ query: { search: [] } }) });
    const ordinaryWikipedia = await wikipediaProvider.lookupPublisher({ publisherName: "Reuters" });
    const perennial = await wikipediaPerennialSourcesProvider.lookupPublisher({ publisherName: "Reuters" });
    assert.equal(ordinaryWikipedia.status, "no_match", "ordinary entity lookup may be absent independently");
    assert.equal(perennial.status, "matched", "the pinned Perennial Sources match remains available");
  } finally {
    global.fetch = originalFetch;
  }
});

test("honors the provider gate without consulting any moving source", async () => {
  const original = process.env.WIKIPEDIA_PERENNIAL_SOURCES_ENABLED;
  process.env.WIKIPEDIA_PERENNIAL_SOURCES_ENABLED = "false";
  try {
    const result = await wikipediaPerennialSourcesProvider.lookupPublisher({ publisherName: "Reuters" });
    assert.equal(result.status, "disabled");
    assert.equal(result.matchFound, false);
  } finally {
    if (original === undefined) delete process.env.WIKIPEDIA_PERENNIAL_SOURCES_ENABLED;
    else process.env.WIKIPEDIA_PERENNIAL_SOURCES_ENABLED = original;
  }
});

test("uses registry caching and versioned provider cache keys", async () => {
  const uniqueName = `No Match Cache Fixture ${process.pid}`;
  const [first] = await lookupPublisherAllProviders(
    { publisherName: uniqueName },
    { providers: ["wikipedia_perennial_sources"] },
  );
  const [second] = await lookupPublisherAllProviders(
    { publisherName: uniqueName },
    { providers: ["wikipedia_perennial_sources"] },
  );
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);

  const source = [entry("fixture", "Fixture Outlet", "no consensus", { domains: ["fixture.test"] })];
  const v1 = createWikipediaPerennialSourcesProvider(dataset(source, "v1"));
  const v2 = createWikipediaPerennialSourcesProvider(dataset(source, "v2"));
  assert.notEqual(v1.cacheKey({ domain: "fixture.test" }), v2.cacheKey({ domain: "fixture.test" }));
  assert.equal(
    v1.cacheKey({ sourceUrl: "https://fixture.test/a" }),
    v1.cacheKey({ sourceUrl: "https://fixture.test/b" }),
  );
});

test("persists through the existing provider-signal contract without changing SourceCrest aggregates", async () => {
  const result = await wikipediaPerennialSourcesProvider.lookupPublisher({ publisherName: "Reuters" });
  const calls = [];
  const signals = await persistProviderSignals(async (sql, values) => {
    calls.push({ sql, values });
    return { insertId: 41 };
  }, {
    publisherId: 17,
    domain: "reuters.com",
    entityName: "Reuters",
    providerResults: [result],
    matchContext: { sourceUrl: "https://reuters.com/example" },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO publisher_external_signals/u);
  assert.equal(calls[0].values[3], "wikipedia_perennial_sources");
  assert.equal(calls[0].values[4], "perennial_sources_classification");
  assert.equal(calls[0].values[5], "contextual");
  assert.equal(calls[0].values[6], null);
  assert.equal(signals[0].reliability_bucket, "generally reliable");

  const directSignal = {
    provider: "baseline_direct",
    signal_type: "direct_reliability_signal",
    admiralty_effect_type: "direct",
    normalized_score: 82,
    reliability_bucket: "high",
    confidence_delta: 0.12,
    reliability_delta: 32,
    cap: null,
    cap_reason: null,
    flags: [],
  };
  const before = summarizeProviderSignals([directSignal]);
  const after = summarizeProviderSignals([
    directSignal,
    mapProviderSignalToAdmiralty("wikipedia_perennial_sources", result),
  ]);
  for (const key of [
    "directReliabilityScore", "reliabilitySignalPresent", "provenanceScore",
    "publicationLegitimacyScore", "identityConfidence", "independentFootprintScore",
    "contextualCredibilityScore", "conflictOfInterestScore", "strongestCap",
  ]) assert.deepEqual(after[key], before[key], `${key} changed`);
  assert.deepEqual(after.reliabilitySignalSources, before.reliabilitySignalSources);
});

test("parses a pinned MediaWiki row deterministically", () => {
  const html = `
    <table><tr id="Fixture_News" class="s-gu">
      <td><a href="https://fixture.test">Fixture News</a></td>
      <td><a title="Generally unreliable">Generally unreliable</a></td>
      <td><a href="/wiki/Wikipedia:Reliable_sources/Noticeboard">1</a></td>
      <td>scope</td><td>Fixture summary.</td><td></td>
    </tr></table>`;
  const first = parsePerennialSourcesHtml(html, { revisionId: 123, revisionTimestamp: "2026-01-01T00:00:00Z", revisionSha1: "abc" });
  const second = parsePerennialSourcesHtml(html, { revisionId: 123, revisionTimestamp: "2026-01-01T00:00:00Z", revisionSha1: "abc" });
  assert.equal(first.entryCount, 1);
  assert.equal(first.entries[0].classification, "generally unreliable");
  assert.deepEqual(first.entries[0].domains, ["fixture.test"]);
  assert.equal(first.entriesSha256, second.entriesSha256);
});

test("projects the provider separately through the existing API and UI contracts", () => {
  const route = fs.readFileSync(path.join(backendRoot, "src/routes/publishers/publishers.routes.js"), "utf8");
  const modal = fs.readFileSync(path.resolve(backendRoot, "../dashboard/src/components/modals/SourceDetailModal.tsx"), "utf8");
  const enrichment = fs.readFileSync(path.join(backendRoot, "src/services/publisherEnrichmentService.js"), "utf8");

  assert.match(route, /FROM publisher_external_signals/u);
  assert.match(route, /externalSignals:\s*externalSignals\.map/u);
  assert.match(modal, /"Wikipedia Perennial Sources": "wikipedia_perennial_sources"/u);
  assert.match(modal, /signal\.provider === "wikipedia_perennial_sources"/u);
  assert.match(enrichment, /runWikipediaPerennialSources/u);
  assert.match(enrichment, /persistAndSummarizeSignals/u);
});
