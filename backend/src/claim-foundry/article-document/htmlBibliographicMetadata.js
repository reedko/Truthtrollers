const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];

function metaValues($, names) {
  const wanted = names.map((name) => name.toLowerCase());
  return $("meta").map((_, element) => {
    const key = clean($(element).attr("name") || $(element).attr("property")).toLowerCase();
    return wanted.includes(key) ? clean($(element).attr("content")) : null;
  }).get().filter(Boolean);
}

function jsonLdNodes($) {
  const nodes = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const value = JSON.parse($(element).text());
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) nodes.push(...(Array.isArray(item?.["@graph"]) ? item["@graph"] : [item]));
    } catch { /* malformed publisher metadata is non-blocking */ }
  });
  return nodes.filter((node) => node && typeof node === "object");
}

function names(values) {
  const array = Array.isArray(values) ? values : values ? [values] : [];
  return array.map((value) => typeof value === "string" ? value : value?.name);
}

function articleNode(nodes) {
  return nodes.find((node) => {
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    return types.some((type) => /(?:article|report|scholarlyarticle|newsarticle)/i.test(type ?? ""));
  }) ?? {};
}

function yearFrom(values) {
  return values.map((value) => clean(value).match(/\b(?:19|20)\d{2}\b/)?.[0]).find(Boolean) ?? null;
}

export function extractHtmlBibliographicMetadata($) {
  const node = articleNode(jsonLdNodes($));
  const identifiers = Array.isArray(node.identifier) ? node.identifier : [node.identifier].filter(Boolean);
  const identifierValues = identifiers.flatMap((value) => typeof value === "string" ? [value]
    : [value?.value, value?.propertyID && value?.value ? `${value.propertyID}:${value.value}` : null]);
  const doiValues = unique([...metaValues($, ["citation_doi", "dc.identifier.doi"]),
    ...identifierValues.filter((value) => /(?:^|doi[:\s])10\.\d{4,9}\//i.test(value ?? ""))])
    .map((value) => value.replace(/^doi[:\s]*/i, ""));
  const pmidValues = unique([...metaValues($, ["citation_pmid"]),
    ...identifierValues.filter((value) => /(?:pmid[:\s]*)?\d{5,10}$/i.test(value ?? ""))])
    .map((value) => value.replace(/^pmid[:\s]*/i, ""));
  const dates = [...metaValues($, ["citation_publication_date", "article:published_time", "dc.date"]),
    node.datePublished];
  return {
    title: metaValues($, ["citation_title", "og:title"])[0] ?? (clean(node.headline || node.name) || null),
    authors: unique([...metaValues($, ["citation_author"]), ...names(node.author)]),
    publicationVenue: metaValues($, ["citation_journal_title", "dc.source"])[0]
      ?? (clean(node.isPartOf?.name) || null),
    publicationYear: Number(yearFrom(dates)) || null,
    doi: doiValues, pmid: pmidValues,
    publishers: unique([...names(node.publisher)]),
    institutions: unique([...names(node.sourceOrganization), ...names(node.affiliation)]),
    canonicalUrls: unique([...metaValues($, ["citation_public_url", "og:url"]),
      ...([node.url, node.mainEntityOfPage?.["@id"], node.mainEntityOfPage].filter((value) =>
        typeof value === "string"))]),
  };
}
