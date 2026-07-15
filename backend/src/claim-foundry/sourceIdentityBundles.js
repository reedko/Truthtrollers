const unique = (values) => [...new Set(values.filter(Boolean))];
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const bundleId = (index) => `IB${String(index + 1).padStart(3, "0")}`;

function identifiers(values = []) {
  const text = values.join(" ");
  const doi = [...text.matchAll(/\b10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+/gi)]
    .map((match) => match[0].replace(/[.,;)]+$/, "").toLowerCase());
  const pmid = [...text.matchAll(/(?:PMID[:\s/]*|pubmed\.ncbi\.nlm\.nih\.gov\/)(\d{1,10})/gi)]
    .map((match) => match[1]);
  const canonicalUrls = values.filter((value) => /^https?:\/\//i.test(value));
  return { doi: unique(doi), pmid: unique(pmid), canonicalUrls: unique(canonicalUrls), other: [] };
}

function publicationYear(article) {
  const match = String(article?.publishedAt ?? "").match(/\b(?:19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function groundedVenue(text, year) {
  if (!year) return null;
  const match = String(text).match(new RegExp(`\\b([A-Z][A-Za-z& -]{2,40})\\s+${year};\\s*\\d+`));
  return clean(match?.[1]) || null;
}

function groundedInstitutions(text) {
  const block = String(text).match(/From the\s+([\s\S]{0,3000}?)(?:Received for publication|Reprint requests|Correspondence)/i)?.[1];
  if (!block) return [];
  return unique(block.split(";").map(clean).filter((item) =>
    /\b(?:University|Institute|Centers?|Department|Program|Agency|Hospital|Foundation|Administration)\b/i.test(item)))
    .slice(0, 12);
}

function labeledPrimaryIdentifiers(text) {
  const header = String(text).slice(0, 4_000);
  return [...header.matchAll(/(?:\bdoi\s*:\s*|https?:\/\/doi\.org\/)(10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+)/gi)]
    .map((match) => match[1]);
}

function resolutionStatus(bundle) {
  if (bundle.identifiers.doi.length || bundle.identifiers.pmid.length) return "resolved_identifier";
  if (bundle.articleLinkIds.length || bundle.articleReferenceIds.length) return "partially_resolved";
  return "mention_only";
}

function baseBundle(values) {
  const bundle = { identityBundleId: "", identityKind: values.identityKind,
    namedWorkId: values.namedWorkId ?? null, assertionSources: [],
    workAuthors: values.workAuthors ?? [], workLabel: clean(values.workLabel),
    publicationVenue: values.publicationVenue ?? null,
    publicationYear: values.publicationYear ?? null, publishers: values.publishers ?? [],
    institutions: values.institutions ?? [], unresolvedContributors: values.unresolvedContributors ?? [],
    identifiers: values.identifiers ?? identifiers([]), sourceUnitIds: unique(values.sourceUnitIds ?? []),
    articleReferenceIds: unique(values.articleReferenceIds ?? []),
    articleLinkIds: unique(values.articleLinkIds ?? []), resolutionStatus: "mention_only" };
  bundle.resolutionStatus = resolutionStatus(bundle);
  return bundle;
}

function referenceBundle(reference, links) {
  const linked = links.filter((link) => reference.linkIds.includes(link.linkId));
  return baseBundle({ identityKind: "article_reference", workLabel: reference.text,
    sourceUnitIds: [reference.sourceUnitId], articleReferenceIds: [reference.referenceId],
    articleLinkIds: reference.linkIds,
    identifiers: identifiers([reference.text, ...linked.flatMap((link) => [link.url, link.anchorText])]),
    publicationYear: Number(reference.text.match(/\b(?:19|20)\d{2}\b/)?.[0]) || null });
}

function addBundle(bundles, bundle) {
  bundle.identityBundleId = bundleId(bundles.length);
  bundles.push(bundle);
  return bundle;
}

export function attachSourceIdentityBundles({ article, articleDocument, articleMap,
  selectedClaims, targets, cards }) {
  const bundles = [];
  const references = articleDocument.references ?? [];
  const links = articleDocument.links ?? [];
  const bibliography = articleDocument.metadata?.bibliographicMetadata ?? {};
  const primaryYear = publicationYear(article) ?? bibliography.publicationYear ?? null;
  const primaryIdentifiers = identifiers([article.url, ...(bibliography.canonicalUrls ?? []),
    ...(bibliography.doi ?? []), ...(bibliography.pmid ?? []).map((value) => `PMID:${value}`),
    ...labeledPrimaryIdentifiers(article.text)].filter(Boolean));
  const primary = addBundle(bundles, baseBundle({ identityKind: "primary_article",
    workLabel: article.title, workAuthors: unique([...article.authors, ...(bibliography.authors ?? [])]),
    publicationVenue: bibliography.publicationVenue ?? groundedVenue(article.text, primaryYear),
    publicationYear: primaryYear,
    publishers: unique([article.publisher, ...(bibliography.publishers ?? [])]),
    institutions: unique([...groundedInstitutions(article.text), ...(bibliography.institutions ?? [])]),
    identifiers: primaryIdentifiers }));
  const bundleByWork = new Map();
  for (const work of articleMap.contextWorks ?? []) {
    const matchedReferences = references.filter((reference) => work.citationCallout
      && reference.label === work.citationCallout);
    const articleLinkIds = unique(matchedReferences.flatMap((reference) => reference.linkIds));
    const linked = links.filter((link) => articleLinkIds.includes(link.linkId));
    const bundle = addBundle(bundles, baseBundle({ identityKind: "named_work",
      namedWorkId: work.namedWorkId, workLabel: work.mentionText,
      sourceUnitIds: work.sourceUnitIds,
      unresolvedContributors: work.peopleOrOrganizations ?? [],
      publicationYear: work.year ?? null,
      articleReferenceIds: matchedReferences.map((reference) => reference.referenceId), articleLinkIds,
      identifiers: identifiers([...(work.identifiers ?? []),
        ...matchedReferences.map((reference) => reference.text), ...linked.map((link) => link.url)]) }));
    bundleByWork.set(work.namedWorkId, bundle);
  }
  const bundleByReference = new Map(bundles.flatMap((bundle) =>
    bundle.articleReferenceIds.map((id) => [id, bundle])));
  const bundleByLink = new Map(bundles.flatMap((bundle) => bundle.articleLinkIds.map((id) => [id, bundle])));
  const bundleByUrl = new Map();
  for (const [linkId, bundle] of bundleByLink) {
    const link = links.find((item) => item.linkId === linkId);
    if (link) bundleByUrl.set(link.normalizedUrl || link.url, bundle);
  }
  const unitMap = new Map(articleDocument.sourceUnits.map((unit) => [unit.unitId, unit]));
  const targetByClaim = new Map(targets.map((target) => [target.selectedClaimId, target]));
  const cardByClaim = new Map(cards.map((card) => [card.selectedClaimId, card]));

  for (const claim of selectedClaims) {
    const target = targetByClaim.get(claim.selectedClaimId);
    const card = cardByClaim.get(claim.selectedClaimId);
    const units = claim.sourceUnitIds.map((id) => unitMap.get(id)).filter(Boolean);
    const markerIds = unique(units.flatMap((unit) => unit.citationMarkerIds ?? []));
    const referenceIds = unique((articleDocument.citationMarkers ?? [])
      .filter((marker) => markerIds.includes(marker.markerId)).map((marker) => marker.resolvedReferenceId));
    const directLinkIds = unique(units.flatMap((unit) => unit.linkIds ?? []).filter((id) =>
      links.find((link) => link.linkId === id)?.classification !== "non_retrieval"));
    for (const referenceId of referenceIds) if (!bundleByReference.has(referenceId)) {
      const reference = references.find((item) => item.referenceId === referenceId);
      if (reference) {
        const linked = links.filter((link) => reference.linkIds.includes(link.linkId));
        const bundle = linked.map((link) => bundleByUrl.get(link.normalizedUrl || link.url))
          .find(Boolean) ?? addBundle(bundles, referenceBundle(reference, links));
        bundle.articleReferenceIds = unique([...bundle.articleReferenceIds, referenceId]);
        bundle.articleLinkIds = unique([...bundle.articleLinkIds, ...reference.linkIds]);
        bundle.sourceUnitIds = unique([...bundle.sourceUnitIds, reference.sourceUnitId]);
        bundleByReference.set(referenceId, bundle);
        for (const id of bundle.articleLinkIds) {
          bundleByLink.set(id, bundle);
          const link = links.find((item) => item.linkId === id);
          if (link) bundleByUrl.set(link.normalizedUrl || link.url, bundle);
        }
      }
    }
    for (const linkId of directLinkIds) if (!bundleByLink.has(linkId)) {
      const link = links.find((item) => item.linkId === linkId);
      if (link) {
        const key = link.normalizedUrl || link.url;
        const bundle = bundleByUrl.get(key) ?? addBundle(bundles, baseBundle({
          identityKind: "article_link", workLabel: link.anchorText || link.url,
          sourceUnitIds: [link.unitId], articleLinkIds: [linkId],
          identifiers: identifiers([link.url, link.anchorText]) }));
        bundle.articleLinkIds = unique([...bundle.articleLinkIds, linkId]);
        bundle.sourceUnitIds = unique([...bundle.sourceUnitIds, link.unitId]);
        bundleByLink.set(linkId, bundle);
        bundleByUrl.set(key, bundle);
      }
    }
    const namedWorkIds = unique([...(card?.relevantNamedWorkIds ?? []),
      ...(card?.namedWorkHints ?? []).map((work) => work.namedWorkId)]);
    const identityBundleIds = unique([primary.identityBundleId,
      ...namedWorkIds.map((id) => bundleByWork.get(id)?.identityBundleId),
      ...referenceIds.map((id) => bundleByReference.get(id)?.identityBundleId),
      ...directLinkIds.map((id) => bundleByLink.get(id)?.identityBundleId)]);
    const articleLinkIds = unique([...directLinkIds, ...referenceIds.flatMap((id) =>
      references.find((reference) => reference.referenceId === id)?.linkIds ?? [])]);
    for (const id of identityBundleIds) {
      const bundle = bundles.find((item) => item.identityBundleId === id);
      if (bundle && card?.assertionSource) bundle.assertionSources = unique([...bundle.assertionSources,
        card.assertionSource]);
    }
    const leads = { namedWorkIds, identityBundleIds, articleReferenceIds: referenceIds, articleLinkIds };
    Object.assign(claim, structuredClone(leads));
    if (target) Object.assign(target, structuredClone(leads));
    if (card) Object.assign(card, structuredClone(leads));
  }
  return bundles;
}
