import test from "node:test";
import assert from "node:assert/strict";
import { ARTICLE_ATOM_TYPES, ARTICLE_STRUCTURE_SIGNALS, createStructureProfile,
  getReviewedDefaultStructureProfile, resolveStructureProfile,
  structureProfileHash } from "../../src/claim-foundry/article-document/index.js";

test("reviewed defaults have stable immutable identity and independent copies", () => {
  const first = getReviewedDefaultStructureProfile("transcript");
  const second = getReviewedDefaultStructureProfile("transcript");
  assert.equal(first.profileHash, structureProfileHash(first));
  assert.equal(first.profileHash, second.profileHash);
  first.rules.push({ ruleId: "local-change", signal: "local.change", action: "ignore.local" });
  assert.notEqual(first.rules.length, second.rules.length);
});

test("custom provider-neutral families require a matching hashed profile", () => {
  const profile = createStructureProfile({ profileId: "cf1sp-podcast-v1",
    profileKey: "podcast.default", version: 1, sourceFamily: "podcast.transcript",
    scope: { kind: "platform", value: "example" }, rules: [
      { ruleId: "speaker-label", signal: "transcript.speaker", action: "atom.speaker-turn" },
    ] });
  assert.equal(resolveStructureProfile("podcast.transcript", profile).profileHash, profile.profileHash);
  assert.throws(() => resolveStructureProfile("article", profile), /does not match the source family/);
  assert.throws(() => resolveStructureProfile("podcast.transcript", { ...profile,
    profileHash: "0".repeat(64) }), /hash does not match/);
});

test("contract reserves transcript, social-post, and thread structures", () => {
  for (const type of ["speaker_turn", "timestamp", "social_post", "social_reply", "thread_separator"]) {
    assert.ok(ARTICLE_ATOM_TYPES.includes(type));
  }
  for (const signal of ["transcriptSpeaker", "transcriptTimestampMs", "socialPostId",
    "socialReplyTo", "threadPosition", "threadDepth"]) {
    assert.ok(ARTICLE_STRUCTURE_SIGNALS.includes(signal));
  }
});
