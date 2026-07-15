import { STANDARD_SOURCE_FAMILIES } from "./contract.js";
import { assertStructureProfile, createStructureProfile, validateSourceFamily } from "./structureProfile.js";

const RULES = Object.freeze({
  article: [
    { ruleId: "html-heading", signal: "html.heading", action: "boundary.candidate" },
    { ruleId: "html-block", signal: "html.block", action: "atom.preserve" },
  ],
  document: [
    { ruleId: "visual-heading", signal: "layout.display-text", action: "boundary.candidate" },
    { ruleId: "large-gap", signal: "layout.vertical-gap", action: "boundary.candidate",
      parameters: { minimum: 24 } },
    { ruleId: "repeated-edge", signal: "layout.repeated-edge", action: "chrome.candidate" },
  ],
  plain_text: [
    { ruleId: "blank-line", signal: "text.blank-line", action: "boundary.candidate" },
  ],
  transcript: [
    { ruleId: "speaker-turn", signal: "transcript.speaker", action: "atom.speaker-turn" },
    { ruleId: "timestamp", signal: "transcript.timestamp", action: "signal.timestamp" },
  ],
  social_post: [
    { ruleId: "post-body", signal: "social.post", action: "atom.social-post" },
  ],
  social_thread: [
    { ruleId: "thread-post", signal: "social.post", action: "atom.social-post" },
    { ruleId: "thread-reply", signal: "social.reply", action: "atom.social-reply" },
  ],
});

const PROFILES = new Map(STANDARD_SOURCE_FAMILIES.map((sourceFamily) => {
  const slug = sourceFamily.replace(/_/g, "-");
  const profile = createStructureProfile({ profileId: `cf1sp-default-${slug}`,
    profileKey: `default.${sourceFamily}`, version: 1, sourceFamily,
    scope: { kind: "global", value: null }, rules: RULES[sourceFamily] });
  return [sourceFamily, profile];
}));

export function getReviewedDefaultStructureProfile(sourceFamily) {
  const family = validateSourceFamily(sourceFamily);
  const profile = PROFILES.get(family);
  if (!profile) throw new Error(`No reviewed default StructureProfile for ${family}`);
  return structuredClone(profile);
}

export function resolveStructureProfile(sourceFamily, suppliedProfile) {
  const family = validateSourceFamily(sourceFamily);
  return suppliedProfile ? assertStructureProfile(suppliedProfile, family)
    : getReviewedDefaultStructureProfile(family);
}
