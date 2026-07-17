const issue = (code, path, message, relatedIds = []) => ({ code, path, message,
  relatedIds: relatedIds.filter(Boolean).slice(0, 20) });
const ids = (items, field) => new Set(items.map((item) => item?.[field]).filter(Boolean));
const normalized = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function checkUnique(values, pattern, path, errors) {
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    if (!pattern.test(value ?? "") || seen.has(value)) errors.push(issue("CF1_SOURCE_IDENTITY_ID",
      `${path}/${index}`, "Source-identity IDs must be valid and unique", [value]));
    seen.add(value);
  }
  return seen;
}

function checkRefs(values, allowed, path, errors) {
  if (!Array.isArray(values)) {
    errors.push(issue("CF1_SOURCE_IDENTITY_ARRAY", path, "Source-identity references must be arrays"));
    return;
  }
  for (const [index, value] of values.entries()) if (!allowed.has(value)) {
    errors.push(issue("CF1_SOURCE_IDENTITY_REFERENCE", `${path}/${index}`,
      "Source-identity reference does not resolve", [value]));
  }
}

function verifyLeadCopies(pkg, bundleIds, workIds, referenceIds, linkIds, errors) {
  const selected = new Map(pkg.selectedEvaluationClaims.map((claim) => [claim.selectedClaimId, claim]));
  for (const [kind, items] of [["selectedEvaluationClaims", pkg.selectedEvaluationClaims],
    ["phase3Targets", pkg.phase3Targets], ["evidenceNeedCards", pkg.evidenceNeedCards]]) {
    for (const [index, item] of items.entries()) {
      const path = `/${kind}/${index}`;
      checkRefs(item.identityBundleIds, bundleIds, `${path}/identityBundleIds`, errors);
      checkRefs(item.namedWorkIds, workIds, `${path}/namedWorkIds`, errors);
      checkRefs(item.articleReferenceIds, referenceIds, `${path}/articleReferenceIds`, errors);
      checkRefs(item.articleLinkIds, linkIds, `${path}/articleLinkIds`, errors);
      if (kind !== "selectedEvaluationClaims") {
        const claim = selected.get(item.selectedClaimId);
        for (const field of ["identityBundleIds", "namedWorkIds", "articleReferenceIds", "articleLinkIds"]) {
          if (JSON.stringify(item[field]) !== JSON.stringify(claim?.[field])) {
            errors.push(issue("CF1_SOURCE_IDENTITY_COPY_MISMATCH", `${path}/${field}`,
              "Target/card retrieval leads must match the selected claim"));
          }
        }
      }
    }
  }
}

function groundingCorpus(pkg, bundle) {
  const work = (pkg.articleMap?.contextWorks ?? []).find((item) => item.namedWorkId === bundle.namedWorkId);
  const units = (pkg.sourceUnits ?? []).filter((item) => bundle.sourceUnitIds.includes(item.unitId));
  const references = (pkg.sourceReferences ?? []).filter((item) =>
    bundle.articleReferenceIds.includes(item.referenceId));
  const links = (pkg.sourceLinks ?? []).filter((item) => bundle.articleLinkIds.includes(item.linkId));
  const primary = bundle.identityKind === "primary_article"
    ? [pkg.article, pkg.sourceDocument?.metadata?.bibliographicMetadata] : [];
  const strings = (value) => {
    if (value == null) return [];
    if (typeof value === "string" || typeof value === "number") return [String(value)];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (typeof value === "object") return Object.values(value).flatMap(strings);
    return [];
  };
  return normalized(strings([work, ...units, ...references, ...links, ...primary]).join(" "));
}

function checkGroundedMetadata(pkg, bundle, path, errors) {
  const corpus = groundingCorpus(pkg, bundle);
  const values = [bundle.workLabel, bundle.publicationVenue,
    bundle.publicationYear == null ? null : String(bundle.publicationYear),
    ...bundle.workAuthors, ...bundle.publishers, ...bundle.institutions,
    ...bundle.unresolvedContributors, ...Object.values(bundle.identifiers ?? {}).flat()]
    .filter(Boolean);
  for (const value of values) if (!corpus.includes(normalized(value))) {
    errors.push(issue("CF1_SOURCE_IDENTITY_UNGROUNDED", path,
      "Source-identity metadata is not grounded in its host-owned source record", [String(value)]));
  }
}

function verifyClaimTraceability(pkg, bundleIds, errors) {
  const units = new Map((pkg.sourceUnits ?? []).map((unit) => [unit.unitId, unit]));
  const markers = new Map((pkg.sourceCitationMarkers ?? []).map((marker) => [marker.markerId, marker]));
  const references = new Map((pkg.sourceReferences ?? []).map((reference) =>
    [reference.referenceId, reference]));
  const links = new Map((pkg.sourceLinks ?? []).map((link) => [link.linkId, link]));
  const bundles = new Map((pkg.sourceIdentityBundles ?? []).map((bundle) =>
    [bundle.identityBundleId, bundle]));
  for (const [index, claim] of (pkg.selectedEvaluationClaims ?? []).entries()) {
    const path = `/selectedEvaluationClaims/${index}`;
    const claimUnits = (claim.sourceUnitIds ?? []).map((id) => units.get(id)).filter(Boolean);
    const markerIds = new Set(claimUnits.flatMap((unit) => unit.citationMarkerIds ?? []));
    const allowedReferences = new Set([...markerIds].map((id) =>
      markers.get(id)?.resolvedReferenceId).filter(Boolean));
    const allowedLinks = new Set(claimUnits.flatMap((unit) => unit.linkIds ?? []).filter((id) =>
      links.get(id)?.classification !== "non_retrieval"));
    for (const referenceId of allowedReferences) {
      for (const linkId of references.get(referenceId)?.linkIds ?? []) allowedLinks.add(linkId);
    }
    for (const referenceId of claim.articleReferenceIds ?? []) if (!allowedReferences.has(referenceId)) {
      errors.push(issue("CF1_SOURCE_IDENTITY_UNTRACEABLE", `${path}/articleReferenceIds`,
        "Claim reference is not inherited from a citation marker in its source units", [referenceId]));
    }
    for (const linkId of claim.articleLinkIds ?? []) if (!allowedLinks.has(linkId)) {
      errors.push(issue("CF1_SOURCE_IDENTITY_UNTRACEABLE", `${path}/articleLinkIds`,
        "Claim link is not inherited from its source units or resolved references", [linkId]));
    }
    for (const identityBundleId of claim.identityBundleIds ?? []) {
      if (!bundleIds.has(identityBundleId)) continue;
      const bundle = bundles.get(identityBundleId);
      const traceable = bundle.identityKind === "primary_article"
        || (bundle.namedWorkId && (claim.namedWorkIds ?? []).includes(bundle.namedWorkId))
        || bundle.articleReferenceIds.some((id) => allowedReferences.has(id))
        || bundle.articleLinkIds.some((id) => allowedLinks.has(id));
      if (!traceable) errors.push(issue("CF1_SOURCE_IDENTITY_UNTRACEABLE",
        `${path}/identityBundleIds`, "Claim identity bundle has no inherited or explicit source path",
        [identityBundleId]));
    }
  }
}

export function verifySourceIdentity(pkg) {
  const errors = [];
  const links = pkg.sourceLinks ?? [];
  const references = pkg.sourceReferences ?? [];
  const markers = pkg.sourceCitationMarkers ?? [];
  const bundles = pkg.sourceIdentityBundles ?? [];
  const linkIds = checkUnique(links.map((item) => item.linkId), /^L\d{4}$/, "/sourceLinks", errors);
  const referenceIds = checkUnique(references.map((item) => item.referenceId), /^REF\d{3}$/,
    "/sourceReferences", errors);
  checkUnique(markers.map((item) => item.markerId), /^CM\d{3}$/, "/sourceCitationMarkers", errors);
  const bundleIds = checkUnique(bundles.map((item) => item.identityBundleId), /^IB\d{3}$/,
    "/sourceIdentityBundles", errors);
  const workIds = ids(pkg.articleMap?.contextWorks ?? [], "namedWorkId");
  const unitIds = ids(pkg.sourceUnits ?? [], "unitId");
  if (!bundles.length) errors.push(issue("CF1_SOURCE_IDENTITY_REQUIRED", "/sourceIdentityBundles",
    "At least the primary article identity bundle is required"));

  for (const [index, bundle] of bundles.entries()) {
    const path = `/sourceIdentityBundles/${index}`;
    if (!["primary_article", "named_work", "article_reference", "article_link"].includes(bundle.identityKind)) {
      errors.push(issue("CF1_SOURCE_IDENTITY_KIND", `${path}/identityKind`, "Invalid identity-bundle kind"));
    }
    if (bundle.identityKind === "named_work" && !workIds.has(bundle.namedWorkId)) {
      errors.push(issue("CF1_SOURCE_IDENTITY_WORK", `${path}/namedWorkId`,
        "Named-work bundle must resolve to the host pool", [bundle.namedWorkId]));
    }
    if (typeof bundle.workLabel !== "string" || !bundle.workLabel.trim() || bundle.workLabel.length > 1_000) {
      errors.push(issue("CF1_SOURCE_IDENTITY_LABEL", `${path}/workLabel`, "Work label is invalid"));
    }
    checkRefs(bundle.sourceUnitIds, unitIds, `${path}/sourceUnitIds`, errors);
    checkRefs(bundle.articleReferenceIds, referenceIds, `${path}/articleReferenceIds`, errors);
    checkRefs(bundle.articleLinkIds, linkIds, `${path}/articleLinkIds`, errors);
    for (const [field, values] of Object.entries(bundle.identifiers ?? {})) {
      if (!Array.isArray(values) || values.length > 20 || values.some((value) =>
        typeof value !== "string" || !value.trim() || value.length > 1_000)) {
        errors.push(issue("CF1_SOURCE_IDENTITY_IDENTIFIERS", `${path}/identifiers/${field}`,
          "Identity identifiers must be bounded strings"));
      }
    }
    for (const field of ["assertionSources", "workAuthors", "publishers", "institutions",
      "unresolvedContributors"]) {
      if (!Array.isArray(bundle[field]) || bundle[field].length > 20 || bundle[field].some((value) =>
        typeof value !== "string" || !value.trim() || value.length > 500)) {
        errors.push(issue("CF1_SOURCE_IDENTITY_METADATA", `${path}/${field}`,
          "Identity metadata must be bounded strings"));
      }
    }
    checkGroundedMetadata(pkg, bundle, path, errors);
  }
  verifyLeadCopies(pkg, bundleIds, workIds, referenceIds, linkIds, errors);
  verifyClaimTraceability(pkg, bundleIds, errors);
  return errors;
}
