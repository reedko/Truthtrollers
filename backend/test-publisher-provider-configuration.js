import assert from "node:assert/strict";

import { publisherProviderFlags } from "./services/sourceProviders/providerFeatureFlags.js";
import { allsidesProvider } from "./services/sourceProviders/providers/allsidesProvider.js";
import { adfontesProvider } from "./services/sourceProviders/providers/adfontesProvider.js";
import { openAlexProvider } from "./services/sourceProviders/providers/openAlexProvider.js";
import { crossrefProvider } from "./services/sourceProviders/providers/crossrefProvider.js";
import {
  googleFactCheckProvider,
  normalizeGoogleFactCheckVerdict,
} from "./services/sourceProviders/providers/googleFactCheckProvider.js";
import {
  openCorporatesProvider,
  selectOpenCorporatesCandidate,
} from "./services/sourceProviders/providers/openCorporatesProvider.js";

const ENV_NAMES = [
  "OPENALEX_ENABLED", "OPENALEX_API_KEY",
  "GOOGLE_FACT_CHECK_ENABLED", "GOOGLE_FACT_CHECK_API_KEY",
  "OPENCORPORATES_ENABLED", "OPENCORPORATES_API_KEY",
  "ADFONTES_ENABLED", "ALLSIDES_ENABLED",
  "PUBLISHER_ENRICHMENT_ALLOW_SEARCH_LLM_FALLBACK",
];
const originalEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
const originalFetch = global.fetch;

function resetEnv() {
  for (const name of ENV_NAMES) delete process.env[name];
}
function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

try {
  resetEnv();
  assert.equal(publisherProviderFlags().openAlex, true);
  assert.equal(publisherProviderFlags().googleFactCheck, true);
  assert.equal(publisherProviderFlags().openCorporates, false);
  assert.equal(publisherProviderFlags().allSides, false);
  assert.equal(publisherProviderFlags().adFontes, false);
  assert.equal(publisherProviderFlags().searchLlmFallback, false);

  let fetchCount = 0;
  global.fetch = async () => { fetchCount += 1; throw new Error("disabled provider fetched"); };
  assert.equal((await allsidesProvider.lookupPublisher({ publisherName: "Example" })).status, "disabled");
  assert.equal((await adfontesProvider.lookupPublisher({ publisherName: "Example" })).status, "disabled");
  assert.equal((await openCorporatesProvider.lookupPublisher({ publisherName: "Example" })).status, "disabled");
  assert.equal(fetchCount, 0);

  process.env.OPENALEX_API_KEY = "test-openalex-token";
  const ordinary = await openAlexProvider.lookupPublisher({ publisherName: "Example News", sourceUrl: "https://example.test/story" });
  assert.equal(ordinary.status, "no_match");
  assert.equal(fetchCount, 0, "ordinary sites must not call OpenAlex");

  let openAlexUrl = null;
  global.fetch = async (url) => {
    fetchCount += 1;
    openAlexUrl = new URL(String(url));
    return response({
      id: "https://openalex.org/W1", title: "Study",
      doi: "https://doi.org/10.1234/example",
      primary_location: { source: { id: "https://openalex.org/S1", display_name: "Example Journal", issn: ["1234-567X"] } },
    });
  };
  const openAlex = await openAlexProvider.lookupPublisher({ sourceUrl: "https://doi.org/10.1234/example" });
  assert.equal(openAlex.status, "ok");
  assert.equal(openAlexUrl.searchParams.has("api_key"), true);
  assert.equal(JSON.stringify(openAlex).includes("test-openalex-token"), false);

  assert.equal(normalizeGoogleFactCheckVerdict("True"), "true");
  assert.equal(normalizeGoogleFactCheckVerdict("False"), "false");
  assert.equal(normalizeGoogleFactCheckVerdict("Partly true"), "mixed");
  assert.equal(normalizeGoogleFactCheckVerdict("Unproven"), "unrated");

  process.env.GOOGLE_FACT_CHECK_ENABLED = "false";
  fetchCount = 0;
  assert.equal((await googleFactCheckProvider.lookupClaim({ claimText: "A claim" })).status, "disabled");
  assert.equal(fetchCount, 0);
  process.env.GOOGLE_FACT_CHECK_ENABLED = "true";
  delete process.env.GOOGLE_FACT_CHECK_API_KEY;
  assert.equal((await googleFactCheckProvider.lookupClaim({ claimText: "A claim" })).status, "missing_config");

  const candidates = [
    { name: "VeriStrata Limited", company_number: "1", jurisdiction_code: "hk", opencorporates_url: "https://opencorporates.com/companies/hk/1" },
    { name: "VeriStrata Limited", company_number: "2", jurisdiction_code: "gb", opencorporates_url: "https://opencorporates.com/companies/gb/2" },
  ];
  assert.equal(selectOpenCorporatesCandidate(candidates, { publisherName: "News" }).status, "insufficient_identity");
  assert.equal(selectOpenCorporatesCandidate(candidates, { publisherName: "VeriStrata" }).status, "ambiguous");
  const selected = selectOpenCorporatesCandidate(candidates, { publisherName: "VeriStrata", jurisdictionCode: "hk" });
  assert.equal(selected.status, "ok");
  assert.equal(selected.candidate.company.company_number, "1");

  process.env.OPENCORPORATES_ENABLED = "true";
  delete process.env.OPENCORPORATES_API_KEY;
  assert.equal((await openCorporatesProvider.lookupPublisher({ publisherName: "VeriStrata" })).status, "missing_config");
  process.env.OPENCORPORATES_API_KEY = "test-opencorporates-token";
  const openCorpRequests = [];
  global.fetch = async (url, options) => {
    openCorpRequests.push({ url: String(url), headerPresent: Boolean(options?.headers?.["X-API-TOKEN"]) });
    if (String(url).includes("/companies/search")) return response({ results: { companies: [{ company: candidates[0] }] } });
    return response({ results: { company: { ...candidates[0], current_status: "Active", company_type: "Private company" } } });
  };
  const openCorp = await openCorporatesProvider.lookupPublisher({ publisherName: "VeriStrata", jurisdictionCode: "hk" });
  assert.equal(openCorp.status, "ok");
  assert.equal(openCorp.normalized.currentStatus, "Active");
  assert.equal(openCorp.normalized.matchConfidence >= 0.95, true);
  assert.equal(openCorp.normalized.matchedDomain, null);
  assert.equal(openCorpRequests.length, 2);
  assert.equal(openCorpRequests.every((item) => item.headerPresent), true);
  assert.equal(openCorpRequests.some((item) => item.url.includes("test-opencorporates-token")), false);
  assert.equal(JSON.stringify(openCorp).includes("test-opencorporates-token"), false);

  let crossrefFetchCount = 0;
  global.fetch = async () => {
    crossrefFetchCount += 1;
    return response({ message: { items: [{
      title: ["Unrelated book chapter"],
      "container-title": ["VS Verlag für Sozialwissenschaften"],
      publisher: "Springer",
      DOI: "10.1007/unrelated",
    }] } });
  };
  const ordinaryCrossref = await crossrefProvider.lookupPublisher({
    domain: "humanforschung-schweiz.ch",
    publisherName: "humanforschung-schweiz.ch",
    sourceUrl: "https://humanforschung-schweiz.ch/",
  });
  assert.equal(ordinaryCrossref.status, "no_match");
  assert.equal(crossrefFetchCount, 0, "ordinary websites must not call Crossref");
  const unrelatedCrossref = await crossrefProvider.lookupPublisher({
    publisherName: "Human Research Journal",
    title: "Human Research Journal",
    articleText: "academic journal",
  });
  assert.equal(unrelatedCrossref.status, "no_match", "Crossref must reject the first unrelated bibliographic result");

  console.log("publisher provider configuration tests passed");
} finally {
  global.fetch = originalFetch;
  for (const name of ENV_NAMES) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
}
