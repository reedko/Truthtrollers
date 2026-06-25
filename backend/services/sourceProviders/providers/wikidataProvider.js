// backend/services/sourceProviders/providers/wikidataProvider.js
// Uses the public Wikidata SPARQL endpoint — no API key required.
// Focused on domain → Wikidata entity lookup for publisher identity.

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const TIMEOUT_MS = 8000;

async function sparqlQuery(sparql) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SPARQL_ENDPOINT}?query=${encodeURIComponent(sparql)}&format=json`, {
      signal: ctrl.signal,
      headers: {
        "Accept": "application/sparql-results+json",
        "User-Agent": "VeraStrata/1.0 (source-evaluation; contact@verastrata.com)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDomain(url) {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, ""); }
  catch { return url?.replace(/^www\./, ""); }
}

function getVal(binding, field) { return binding?.[field]?.value ?? null; }

function escapeSparqlString(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function officialWebsiteUris(domain) {
  const dom = String(domain || "").replace(/^www\./, "");
  if (!dom) return [];
  return [
    `https://${dom}`,
    `http://${dom}`,
    `https://www.${dom}`,
    `http://www.${dom}`,
  ];
}

export const wikidataProvider = {
  providerName: "wikidata",
  description: "Wikidata SPARQL — domain-to-entity publisher lookup",

  async healthCheck() {
    const t0 = Date.now();
    try {
      await sparqlQuery("SELECT ?item WHERE { ?item wdt:P856 <https://www.reuters.com> } LIMIT 1");
      return { providerName: "wikidata", ok: true, status: "ok", message: "Wikidata SPARQL reachable", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { providerName: "wikidata", ok: false, status: err.name === "AbortError" ? "unavailable" : "error", message: err.message, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
  },

  async lookupPublisher({ domain, publisherName, sourceUrl }) {
    const t0 = Date.now();
    const dom = normalizeDomain(domain || sourceUrl || "");
    if (!dom) return { providerName: "wikidata", ok: false, matchFound: false, status: "no_match", errorMessage: "No domain available", latencyMs: 0 };

    try {
      // Try domain-based lookup first
      const websiteValues = officialWebsiteUris(dom).map((uri) => `<${uri}>`).join(" ");
      const sparql = `
        SELECT ?item ?itemLabel ?itemAltLabel ?instanceLabel ?country ?countryLabel
               ?website ?parentLabel ?ownedByLabel ?operatorLabel ?founderLabel
               ?industryLabel ?inception ?dissolved WHERE {
          VALUES ?website { ${websiteValues} }
          ?item wdt:P856 ?website .
          OPTIONAL { ?item wdt:P31 ?instance . }
          OPTIONAL { ?item wdt:P17 ?country . }
          OPTIONAL { ?item wdt:P749 ?parent . }
          OPTIONAL { ?item wdt:P127 ?ownedBy . }
          OPTIONAL { ?item wdt:P137 ?operator . }
          OPTIONAL { ?item wdt:P112 ?founder . }
          OPTIONAL { ?item wdt:P452 ?industry . }
          OPTIONAL { ?item wdt:P571 ?inception . }
          OPTIONAL { ?item wdt:P576 ?dissolved . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
        } LIMIT 3
      `;
      const data = await sparqlQuery(sparql);
      let bindings = data?.results?.bindings ?? [];

      if (!bindings.length) {
        const name = escapeSparqlString(publisherName || "");
        if (!name) return { providerName: "wikidata", ok: true, matchFound: false, status: "no_match", latencyMs: Date.now() - t0 };
        const nameSparql = `
          SELECT ?item ?itemLabel ?itemAltLabel ?instanceLabel ?country ?countryLabel
                 ?website ?parentLabel ?ownedByLabel ?operatorLabel ?founderLabel
                 ?industryLabel ?inception ?dissolved WHERE {
            ?item rdfs:label|skos:altLabel ?label .
            FILTER(LANG(?label) = "en")
            FILTER(LCASE(STR(?label)) = LCASE("${name}"))
            OPTIONAL { ?item wdt:P856 ?website . }
            OPTIONAL { ?item wdt:P31 ?instance . }
            OPTIONAL { ?item wdt:P17 ?country . }
            OPTIONAL { ?item wdt:P749 ?parent . }
            OPTIONAL { ?item wdt:P127 ?ownedBy . }
            OPTIONAL { ?item wdt:P137 ?operator . }
            OPTIONAL { ?item wdt:P112 ?founder . }
            OPTIONAL { ?item wdt:P452 ?industry . }
            OPTIONAL { ?item wdt:P571 ?inception . }
            OPTIONAL { ?item wdt:P576 ?dissolved . }
            SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
          } LIMIT 3
        `;
        const nameData = await sparqlQuery(nameSparql);
        bindings = nameData?.results?.bindings ?? [];
        if (!bindings.length) {
          return { providerName: "wikidata", ok: true, matchFound: false, status: "no_match", latencyMs: Date.now() - t0 };
        }
      }

      const b = bindings[0];
      const relationships = [
        ["parent_org", getVal(b, "parentLabel")],
        ["owned_by", getVal(b, "ownedByLabel")],
        ["operated_by", getVal(b, "operatorLabel")],
        ["founder", getVal(b, "founderLabel")],
      ].filter(([, name]) => name).map(([type, name]) => ({ type, name }));
      const normalized = {
        publisherName: getVal(b, "itemLabel"),
        domain: dom,
        sourceType: classifyFromInstance(getVal(b, "instanceLabel") ?? ""),
        country: getVal(b, "countryLabel"),
        aliases: getVal(b, "itemAltLabel")?.split(", ") ?? [],
        instanceOf: getVal(b, "instanceLabel"),
        officialWebsite: getVal(b, "website"),
        parentOrganization: getVal(b, "parentLabel"),
        ownedBy: getVal(b, "ownedByLabel"),
        operator: getVal(b, "operatorLabel"),
        founder: getVal(b, "founderLabel"),
        industry: getVal(b, "industryLabel"),
        inception: getVal(b, "inception"),
        dissolved: getVal(b, "dissolved"),
        relationships,
        externalId: getVal(b, "item")?.replace("http://www.wikidata.org/entity/", "wikidata:"),
        externalUrl: getVal(b, "item")?.replace("http://www.wikidata.org/entity/", "https://www.wikidata.org/wiki/"),
        description: null,
        reliability: null,
        bias: null,
      };

      return { providerName: "wikidata", ok: true, matchFound: true, confidence: "high", normalized, raw: bindings[0], status: "ok", latencyMs: Date.now() - t0 };
    } catch (err) {
      return { providerName: "wikidata", ok: false, matchFound: false, status: err.name === "AbortError" ? "unavailable" : "error", errorMessage: err.message, latencyMs: Date.now() - t0 };
    }
  },

  async lookupClaim() {
    return { providerName: "wikidata", ok: false, matchFound: false, status: "not_implemented", errorMessage: "Wikidata does not provide claim fact-check lookups", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};

function classifyFromInstance(label = "") {
  const l = label.toLowerCase();
  if (/newspaper|news agency|television|broadcaster|media|magazine/.test(l)) return "journalism";
  if (/university|research institute|laboratory|academic/.test(l)) return "academic";
  if (/government|ministry|department|agency|parliament/.test(l)) return "government";
  if (/think tank|advocacy|nonprofit|ngo/.test(l)) return "advocacy";
  return null;
}
