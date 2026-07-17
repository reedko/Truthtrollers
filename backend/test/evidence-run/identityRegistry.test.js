import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDoi, normalizePmid, normalizeUrl } from "../../src/evidence-run/identityRegistry.js";

test("offline identity normalization is deterministic and does not resolve anything", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1542/PEDS.113.2.259"), "10.1542/peds.113.2.259");
  assert.equal(normalizePmid("PMID: 12345678"), "12345678");
  assert.equal(normalizeUrl("HTTPS://Example.COM:443/a/?utm_source=x&b=2&a=1#frag"),
    "https://example.com/a?a=1&b=2");
  assert.equal(normalizeUrl("not a url"), null);
});
