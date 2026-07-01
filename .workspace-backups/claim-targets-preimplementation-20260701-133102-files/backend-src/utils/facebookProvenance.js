// Normalize Facebook distribution metadata without confusing the platform,
// social container, direct poster, and substantive linked source.

const GENERIC_FACEBOOK_NAMES = /^(facebook|facebook\.com|www\.facebook\.com|fb\.com)$/i;

function cleanLabel(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 255 || GENERIC_FACEBOOK_NAMES.test(text)) return null;
  return text;
}

export function parseFacebookPostUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)facebook\.com$/i.test(parsed.hostname) && !/(^|\.)fb\.com$/i.test(parsed.hostname)) {
      return null;
    }
    const groupPost = parsed.pathname.match(/^\/groups\/([^/]+)\/posts\/(\d+)/i);
    const group = parsed.pathname.match(/^\/groups\/([^/]+)/i);
    const rawContainer = groupPost?.[1] || group?.[1] || null;
    return {
      platform: "Facebook",
      platformDomain: "facebook.com",
      urlType: groupPost ? "facebook_group_post" : group ? "facebook_group" : "facebook_post",
      containerId: rawContainer && /^\d+$/.test(rawContainer) ? rawContainer : null,
      containerSlug: rawContainer && !/^\d+$/.test(rawContainer) ? rawContainer : null,
      postId: groupPost?.[2] || null,
    };
  } catch {
    return null;
  }
}

export function normalizeFacebookProvenance(input, url) {
  const parsed = parseFacebookPostUrl(url);
  if (!parsed && !input) return null;
  const source = input && typeof input === "object" ? input : {};
  const containerName = cleanLabel(source.containerName);
  const directSocialPublisher = cleanLabel(source.directSocialPublisher);
  const associatedEntities = Array.isArray(source.associatedEntities)
    ? source.associatedEntities
        .filter((entity) => entity && cleanLabel(entity.name) && entity.evidence)
        .map((entity) => ({
          name: cleanLabel(entity.name),
          relationship: entity.relationship || "associated_public_figure_or_brand",
          evidence: String(entity.evidence).slice(0, 500),
          confidence: entity.confidence || "visible_dom",
        }))
    : [];

  return {
    platform: "Facebook",
    platformDomain: "facebook.com",
    urlType: source.urlType || parsed?.urlType || "facebook_post",
    containerType: source.containerType || (parsed?.containerId || parsed?.containerSlug ? "facebook_group" : null),
    containerName,
    containerId: source.containerId || parsed?.containerId || null,
    containerSlug: source.containerSlug || parsed?.containerSlug || null,
    postId: source.postId || parsed?.postId || null,
    groupUrl: source.groupUrl || null,
    directSocialPublisher,
    directSocialPublisherUrl: source.directSocialPublisherUrl || null,
    sharedSourceUrl: source.sharedSourceUrl || null,
    sharedSourceTitle: cleanLabel(source.sharedSourceTitle),
    sharedSourceDomain: source.sharedSourceDomain || null,
    substantiveSourceStatus: source.substantiveSourceStatus || null,
    substantiveSourcePublisher: cleanLabel(source.substantiveSourcePublisher),
    ultimatePublisher: cleanLabel(source.ultimatePublisher),
    associatedEntities,
    visibleAttributionText: Array.isArray(source.visibleAttributionText)
      ? source.visibleAttributionText.map((line) => String(line).slice(0, 300)).slice(0, 10)
      : [],
    extractionStatus: source.extractionStatus || (containerName ? "partial_extension_dom" : "extension_dom_required"),
  };
}

export function chooseFacebookPublisher({ provenance, resolvedLinkedPublisher = null }) {
  const linkedName = cleanLabel(resolvedLinkedPublisher);
  if (provenance?.sharedSourceUrl && linkedName) {
    return { name: linkedName, role: "substantive_publisher", confidence: "linked_source" };
  }
  if (provenance?.directSocialPublisher) {
    return {
      name: provenance.directSocialPublisher,
      role: "direct_social_publisher",
      confidence: "visible_dom",
      containerId: provenance.containerId,
      profileUrl: provenance.directSocialPublisherUrl || null,
    };
  }
  // For group posts, the GROUP is the publisher; the poster is the author (saved separately).
  if (provenance?.containerName) {
    return {
      name: provenance.containerName,
      role: "social_container",
      sourceType: "social",
      confidence: "partial_visible_dom",
      containerId: provenance.containerId,
      containerType: provenance.containerType || "facebook_group",
      profileUrl: provenance.groupUrl || null,
      poster: provenance.directSocialPublisher || null,
    };
  }
  if (provenance?.containerId) {
    return {
      name: `Facebook group ${provenance.containerId}`,
      role: "social_container_placeholder",
      sourceType: "social",
      confidence: "url_only",
      containerId: provenance.containerId,
      profileUrl: provenance.groupUrl || null,
    };
  }
  return null;
}

export function isGenericFacebookPublisher(value) {
  return GENERIC_FACEBOOK_NAMES.test(String(value || "").trim());
}
