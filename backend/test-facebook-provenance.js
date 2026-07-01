import assert from "node:assert/strict";
import {
  chooseFacebookPublisher,
  normalizeFacebookProvenance,
  parseFacebookPostUrl,
} from "./src/utils/facebookProvenance.js";

const url = "https://www.facebook.com/groups/930540941927100/posts/1282952913352566/";

assert.deepEqual(parseFacebookPostUrl(url), {
  platform: "Facebook",
  platformDomain: "facebook.com",
  urlType: "facebook_group_post",
  containerId: "930540941927100",
  containerSlug: null,
  postId: "1282952913352566",
});

const visibleGroup = normalizeFacebookProvenance({
  containerName: "Fact Frenzy",
  directSocialPublisher: null,
  associatedEntities: [{
    name: "Neil deGrasse Tyson",
    relationship: "associated_public_figure_or_brand",
    evidence: "Visible group header association",
    confidence: "visible_dom",
  }],
}, url);

assert.equal(chooseFacebookPublisher({ provenance: visibleGroup }).name, "Fact Frenzy");
assert.equal(chooseFacebookPublisher({ provenance: visibleGroup }).role, "social_container");
assert.equal(visibleGroup.associatedEntities[0].name, "Neil deGrasse Tyson");
assert.notEqual(chooseFacebookPublisher({ provenance: visibleGroup }).name, "Neil deGrasse Tyson");

const withPoster = { ...visibleGroup, directSocialPublisher: "Visible Poster" };
assert.equal(chooseFacebookPublisher({ provenance: withPoster }).name, "Visible Poster");

const withSharedSource = { ...withPoster, sharedSourceUrl: "https://example.org/story" };
assert.deepEqual(chooseFacebookPublisher({
  provenance: withSharedSource,
  resolvedLinkedPublisher: "Example News",
}), { name: "Example News", role: "substantive_publisher", confidence: "linked_source" });

const unresolvedShared = chooseFacebookPublisher({ provenance: withSharedSource });
assert.equal(unresolvedShared.name, "Visible Poster");
assert.equal(unresolvedShared.role, "direct_social_publisher");

const urlOnly = normalizeFacebookProvenance(null, url);
assert.equal(urlOnly.containerName, null);
assert.equal(urlOnly.extractionStatus, "extension_dom_required");
assert.equal(chooseFacebookPublisher({ provenance: urlOnly }).name, "Facebook group 930540941927100");
assert.equal(chooseFacebookPublisher({ provenance: urlOnly }).role, "social_container_placeholder");

console.log("facebook provenance tests passed");
