import assert from "node:assert/strict";
import test from "node:test";
import { refreshContentPublisherSourceCrest } from "../../../src/services/refreshContentPublisherSourceCrest.js";

test("rescrape persists identity before rating the original content supplier", async () => {
  const events:string[] = [];
  const roles = [
    { publisher_id: 44, publisher_role: "original_publisher", is_primary: 1, publisher_name: "The Conversation", domain: null },
    { publisher_id: 11, publisher_role: "publication_venue", is_primary: 0, publisher_name: "The Scientist", domain: "the-scientist.com" },
    { publisher_id: 12, publisher_role: "publishing_organization", is_primary: 0, publisher_name: "The Scientist Magazine", domain: null },
    { publisher_id: 13, publisher_role: "parent_organization", is_primary: 0, publisher_name: "LabX Media Group", domain: null },
  ];
  let roleReads = 0;
  const query = async (sql:string, values:any[] = []) => {
    if (sql.includes("FROM content\n")) return [{ content_id: 18099, content_name: "Scientist article", url: "https://the-scientist.com/article" }];
    if (sql.includes("FROM content_publishers cp")) {
      roleReads += 1;
      return roleReads === 1
        ? [{ publisher_id: 11, publisher_role: "publication_venue", is_primary: 1, publisher_name: "The Scientist", domain: "the-scientist.com" }]
        : roles;
    }
    if (sql.includes("FROM publishers")) return [{ publisher_id: 44, publisher_name: "The Conversation", domain: null }];
    if (sql.startsWith("UPDATE content")) { events.push("text-persisted"); return { affectedRows: 1 }; }
    if (sql.includes("UPDATE publishers")) return { affectedRows: 1 };
    if (sql.includes("UPDATE source_identity_cache")) { events.push("identity-cache-invalidated"); return { affectedRows: 1 }; }
    if (sql.startsWith("DELETE FROM publisher_external_signals")) { events.push("signals-invalidated"); return { affectedRows: 2 }; }
    return [];
  };
  const identity = {
    version: "publishing-identity-v1",
    source_url: "https://the-scientist.com/article",
    document: { authors: [{ name: "Jake Scott, MD" }] },
    entities: {
      publication_venue: { name: "The Scientist" },
      publishing_organization: { name: "The Scientist Magazine" },
      parent_organization: { name: "LabX Media Group" },
      original_publisher: { name: "The Conversation" },
    },
    context: {
      publication_relationship: {
        type: "republished",
        license: "Creative Commons",
        originalUrl: "https://theconversation.com/original",
      },
    },
  };
  const result = await refreshContentPublisherSourceCrest({
    query: query as any,
    contentId: 18099,
    requestedPublisherId: 11,
    automaticAcquirer: async () => ({
      acquired: true,
      cleanedText: "Complete extracted article text.",
      method: "wayback",
      resolvedUrl: "https://web.archive.org/scientist",
      attempts: [],
      extractedDocument: { publishingIdentity: identity, authors: [{ name: "Jake Scott, MD" }] },
    }) as any,
    identityProcessor: async (args:any) => {
      events.push("identity-persisted");
      assert.equal(args.identity.entities.publication_venue.name, "The Scientist");
      assert.equal(args.identity.entities.original_publisher.name, "The Conversation");
      assert.deepEqual(args.authors, [{ name: "Jake Scott, MD" }]);
      return { persistence: { publisherId: 44 } };
    },
    cacheInvalidator: () => { events.push("provider-cache-invalidated"); return 1; },
    enricher: async (args:any) => {
      events.push("sourcecrest-enriched");
      assert.equal(args.publisherId, 44);
      assert.equal(args.publisherName, "The Conversation");
      assert.equal(args.domain, "theconversation.com");
      assert.equal(args.sourceUrl, "https://theconversation.com/original");
      assert.equal(args.skipExternalSignals, false);
      return { admiraltyUpdates: { 18099: "BØ" } };
    },
    evaluator: async () => { events.push("sourcecrest-reevaluated"); return { 18099: "BØ" }; },
  } as any);

  assert.deepEqual(events, [
    "text-persisted",
    "identity-persisted",
    "identity-cache-invalidated",
    "signals-invalidated",
    "provider-cache-invalidated",
    "sourcecrest-enriched",
  ]);
  assert.equal(result.publisherName, "The Conversation");
  assert.equal(result.sourceDocument.url, "https://the-scientist.com/article");
  assert.equal(result.ratingUrl, "https://theconversation.com/original");
  assert.equal(result.roles.find((row:any) => row.publisher_role === "publication_venue")?.publisher_name, "The Scientist");
  assert.equal(result.roles.find((row:any) => row.publisher_role === "original_publisher")?.is_primary, 1);
  assert.equal(result.admiraltyCode, "BØ");
});

test("the modal refresh route invokes publishing identity refresh instead of old-identity enrichment", async () => {
  const fs = await import("node:fs");
  const route = fs.readFileSync("src/routes/publishers/publishers.routes.js", "utf8");
  const modal = fs.readFileSync("../dashboard/src/components/modals/SourceDetailModal.tsx", "utf8");
  const refreshRoute = route.slice(route.indexOf('router.post("/api/publishers/:publisherId/enrich"'));
  assert.match(refreshRoute, /refreshPublishingIdentity\s*=\s*false/u);
  assert.match(refreshRoute, /refreshContentPublisherSourceCrest/u);
  assert.match(refreshRoute, /force && contentId && refreshPublishingIdentity/u);
  assert.match(modal, /refreshPublishingIdentity:\s*true/u);
  assert.match(modal, /loadEnrichment\(refreshedPublisherId, true\)/u);
});
