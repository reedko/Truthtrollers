import { expandOneCallAgentOutput } from "./oneCallAgentOutput.js";

function articleIdentity(article) {
  const doi = String(article?.url ?? "").match(/doi\.org\/(10\.\d{4,9}\/\S+)/i)?.[1] ?? null;
  const author = String(article?.authors?.[0]?.name ?? article?.authors?.[0] ?? "").trim();
  const surname = author.split(/\s+/).at(-1) || null;
  const year = String(article?.publishedAt ?? "").match(/\b(?:19|20)\d{2}\b/)?.[0] ?? null;
  const title = String(article?.title ?? "").trim();
  const publisher = String(article?.publisher ?? "").trim() || null;
  return { doi, surname, year, title, publisher };
}

function articleQuerySeed(article, claim) {
  if (/\b(?:background|context|prior|previous|literature|external)\b/i
    .test(`${claim.articleUse} ${claim.assertionSource}`)) return null;
  const identity = articleIdentity(article);
  const stop = new Set(["about", "after", "among", "article", "before", "between", "children",
    "claim", "control", "found", "study", "their", "there", "these", "those", "which", "with"]);
  const discriminators = (claim.claimText.toLowerCase().match(/\b(?:\d+(?:\.\d+)?%?|[a-z][a-z-]{4,})\b/g) ?? [])
    .filter((term) => !stop.has(term)).slice(0, 8).join(" ");
  const parts = [identity.surname, identity.year,
    identity.title ? `"${identity.title.slice(0, 180)}"` : null,
    identity.doi, discriminators].filter(Boolean);
  if (parts.length <= 1) return null;
  return { laneType: "article-primary", query: [...new Set(parts)].join(" ").slice(0, 1_000),
    purpose: "Find the article's primary record and material bearing on this claim.",
    sourceFieldsUsed: ["article.author", "article.publishedAt", "article.title", "article.url", "claimText"] };
}

function semanticQuerySeed(claim) {
  const source = !/^(?:the )?(?:article|authors?|study)$/i.test(claim.assertionSource)
    ? claim.assertionSource : null;
  const concepts = [...new Set([source, ...(claim.searchConcepts ?? []), ...claim.mustMatch]
    .filter(Boolean).map((value) => String(value).trim()))];
  if (!concepts.length) return null;
  return { laneType: claim.sourceStrategy ?? "evidence", query: concepts.join(" ").slice(0, 320),
    purpose: "Find evidence that directly tests the claim's required distinctions.",
    sourceFieldsUsed: ["assertionSource", "searchConcepts", "mustMatch"] };
}

// The article's own identity (surname/year/title/own DOI) is evidence only when the article
// itself is the disputed authorship — i.e. an attribution-hinge claim whose asserter is the
// article. For any substantive-graded dispute the article cannot be its own evidence, so its
// identity must not seed queries or identifier hints (the Step 2 circularity kill). A cited
// work's identity is unaffected either way. The baseline path (no gradeTarget) is unchanged.
function attachesOwnIdentity(claim) {
  if (claim.gradeTarget == null) return true;
  return claim.gradeTarget === "attribution"
    && /^(?:the )?(?:article|authors?|study)$/i.test(claim.assertionSource ?? "");
}

function mergeSeeds(article, claim) {
  const generated = attachesOwnIdentity(claim) ? articleQuerySeed(article, claim) : null;
  const semantic = semanticQuerySeed(claim);
  const workSeeds = (claim.namedWorkHints ?? []).slice(0, 3).map((work) => ({
    laneType: "named-work",
    query: [work.mentionText, work.citationCallout,
      ...(work.peopleOrOrganizations ?? []), ...(work.identifiers ?? [])].filter(Boolean).join(" ").slice(0, 320),
    purpose: `Resolve host-validated named work ${work.namedWorkId}.`,
    sourceFieldsUsed: ["namedWorkPool"],
  })).filter((seed) => seed.query);
  const seeds = [...(generated ? [generated] : []), ...(semantic ? [semantic] : []), ...workSeeds];
  return [...new Map(seeds.map((seed) => [seed.query.toLowerCase(), seed])).values()];
}

function mergeIdentifiers(article, claim) {
  const result = structuredClone(claim.identifierHints);
  if (!attachesOwnIdentity(claim)) return result;
  const { doi } = articleIdentity(article);
  result.doi = [...new Set([...(result.doi ?? []), ...(doi ? [doi] : [])])];
  return result;
}

export function expandTwoCallAgentOutput(oldShape, { structuralBlocks, article }) {
  const draft = expandOneCallAgentOutput(oldShape, { structuralBlocks, article, skipVerification: true });
  draft.articleMap.contextWorks = structuredClone(oldShape.contextWorks ?? []);
  draft.articleMap.contextHints = structuredClone(oldShape.contextHints ?? []);
  draft.evidenceNeedCards = oldShape.selectedClaims.map((claim, index) => {
    const rejectIfOnly = claim.rejectIfOnly[0] ?? `A source merely repeats: ${claim.claimText}`;
    const roleAliases = { primary: "target-primary", official: "official-response",
      methodology: "methodology-reanalysis", context: "context-background" };
    const roles = [...new Set(claim.requiredEvidenceRoles.map((role) => roleAliases[role] ?? role))];
    const rejectRules = claim.rejectIfOnly.length ? claim.rejectIfOnly : [rejectIfOnly];
    const relatedClaimHints = (oldShape.relatedClaimPairs ?? []).flatMap((pair) => {
      const otherId = pair.resultCandidateId === claim.candidateId ? pair.explanationCandidateId
        : pair.explanationCandidateId === claim.candidateId ? pair.resultCandidateId : null;
      const other = oldShape.selectedClaims.find((item) => item.candidateId === otherId);
      return other ? [{ relationshipType: "observed_result_explanation",
        relatedClaimText: other.claimText }] : [];
    });
    return { targetId: `target-${index}`, evidenceRolesNeeded: roles,
      disputedQuestion: structuredClone(claim.disputedQuestion ?? null),
      gradeTarget: claim.gradeTarget ?? null, origin: claim.origin ?? "model",
      bestSourceTypes: claim.bestSourceTypes,
      bearingCriteria: { mustMatch: claim.mustMatch, shouldMatch: claim.shouldMatch,
        rejectIfOnly: rejectRules, weak: claim.weakBearing },
      queryLaneSeeds: mergeSeeds(article, claim),
      identifierHints: mergeIdentifiers(article, claim),
      falsifiability: { verificationQuestion: claim.verificationQuestion,
        wouldSupportIf: claim.claimTrueIf, wouldRefuteIf: claim.claimFalseIf,
        wouldQualifyIf: claim.claimQualifiedIf, notEnoughIfOnly: rejectIfOnly },
      scope: claim.scope, assertionSource: claim.assertionSource,
      relevantNamedWorkIds: claim.relevantNamedWorkIds,
      namedWorkRelevanceNote: claim.namedWorkRelevanceNote,
      namedWorkHints: claim.namedWorkHints, warnings: claim.warnings,
      relatedClaimHints,
    };
  });
  return draft;
}
