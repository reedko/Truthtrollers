/**
 * deterministicClaimClustering.js
 *
 * Deterministic, rule-based claim clustering for Phase 2 synthesis.
 * No LLM. No evidence. Article-internal grouping only.
 *
 * Extracts anchors from claim text and groups claims by shared anchors.
 */

export class DeterministicClaimClustering {
  constructor(options = {}) {
    this.minClaimsPerCluster = options.minClaimsPerCluster ?? 2;
    this.overlapThreshold = options.overlapThreshold ?? 0.5; // Merge clusters with 50%+ overlap
    this.maxClusters = options.maxClusters ?? 24;

    // Patterns to avoid - too generic
    this.forbiddenAnchors = new Set([
      "article", "claim", "claims", "health", "children", "parents", "data", "study",
    ]);

    // Anchor extraction patterns
    this.anchorPatterns = {
      // Capitalized multi-word phrases (person, organization, law)
      capitalizedPhrases: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g,
      // Laws ending in "Act"
      acts: /[A-Z][A-Za-z\s]+Act\b/g,
      // Acronyms (2+ caps in a row)
      acronyms: /\b[A-Z]{2,}\b/g,
      // Years
      years: /\b(19|20)\d{2}\b/g,
      // Percentages
      percentages: /\d+\s*%/g,
      // Action words
      actionWords: /\b(manipulat|destroy|destro|omit|omitted|exclud|exclud|conceal|suppress|rework|rework|massage|commission|announc|reveal|allege|depod|shield|mandat)\w*\b/gi,
      // Product or substance names should be captured by capitalized phrases,
      // acronyms, or caller-provided metadata rather than a fixture vocabulary.
    };
  }

  /**
   * Build deterministic clusters from compact claims.
   */
  buildClusters(compactClaims) {
    // Extract anchors from all claims
    const claimAnchors = new Map(); // claimIndex -> Set of anchors

    for (const claim of compactClaims) {
      const anchors = this.extractAnchors(claim.claimText, claim.searchText);
      claimAnchors.set(claim.claimIndex, anchors);
    }

    // Build initial clusters from shared anchors
    const anchorToClaimIndexes = new Map(); // anchor -> Set of claimIndexes

    for (const [claimIndex, anchors] of claimAnchors.entries()) {
      for (const anchor of anchors) {
        if (!anchorToClaimIndexes.has(anchor)) {
          anchorToClaimIndexes.set(anchor, new Set());
        }
        anchorToClaimIndexes.get(anchor).add(claimIndex);
      }
    }

    // Create clusters from anchors with 2+ claims
    const initialClusters = [];
    let clusterId = 0;

    for (const [anchor, claimIndexes] of anchorToClaimIndexes.entries()) {
      if (claimIndexes.size >= this.minClaimsPerCluster && !this.forbiddenAnchors.has(anchor.toLowerCase())) {
        initialClusters.push({
          clusterId: clusterId++,
          anchors: [anchor],  // Store as array for consistency
          claimIndexes: Array.from(claimIndexes),
        });
      }
    }

    // Merge clusters with overlapping claimIndexes
    const mergedClusters = this.mergeClusters(initialClusters);

    // Score and rank clusters
    const scoredClusters = this.scoreAndRankClusters(mergedClusters, compactClaims);

    // Cap at maxClusters
    const finalClusters = scoredClusters.slice(0, this.maxClusters);

    // Find unclustered claims
    const clusteredIndexes = new Set();
    for (const cluster of finalClusters) {
      cluster.claimIndexes.forEach(idx => clusteredIndexes.add(idx));
    }

    const unclusteredClaimIndexes = compactClaims
      .map(c => c.claimIndex)
      .filter(idx => !clusteredIndexes.has(idx));

    // Extract unique anchors
    const allAnchors = new Set();
    for (const cluster of finalClusters) {
      cluster.anchors.forEach(a => allAnchors.add(a));
    }

    const diagnostics = {
      claimCount: compactClaims.length,
      clusterCount: finalClusters.length,
      anchorsExtracted: allAnchors.size,
      topAnchors: finalClusters.slice(0, 12).map(c => c.anchors),
      unclusteredClaimCount: unclusteredClaimIndexes.length,
      unclusteredClaimIndexes,
    };

    return {
      clusters: finalClusters,
      diagnostics,
    };
  }

  /**
   * Extract anchors from claim text using deterministic patterns.
   */
  extractAnchors(claimText, searchText) {
    const anchors = new Set();

    // Combine claim text and search text
    const fullText = `${claimText} ${searchText}`;

    // Extract capitalized phrases
    const phrases = fullText.match(this.anchorPatterns.capitalizedPhrases) || [];
    phrases.forEach(p => {
      const clean = p.trim();
      if (clean.length > 2 && !this.forbiddenAnchors.has(clean.toLowerCase())) {
        anchors.add(clean);
      }
    });

    // Extract laws (Acts)
    const acts = fullText.match(this.anchorPatterns.acts) || [];
    acts.forEach(a => anchors.add(a.trim()));

    // Extract acronyms
    const acronyms = fullText.match(this.anchorPatterns.acronyms) || [];
    acronyms.forEach(a => {
      const clean = a.trim();
      if (!this.forbiddenAnchors.has(clean.toLowerCase())) {
        anchors.add(clean);
      }
    });

    // Extract years
    const years = fullText.match(this.anchorPatterns.years) || [];
    years.forEach(y => anchors.add(y.trim()));

    // Extract percentages
    const percentages = fullText.match(this.anchorPatterns.percentages) || [];
    percentages.forEach(p => anchors.add(p.trim()));

    // Extract action words
    const actions = fullText.match(this.anchorPatterns.actionWords) || [];
    actions.forEach(a => anchors.add(a.trim().toLowerCase()));

    return Array.from(anchors);
  }

  /**
   * Merge clusters with overlapping claim indexes.
   */
  mergeClusters(clusters) {
    if (clusters.length === 0) return [];

    const merged = [];
    const used = new Set();

    for (let i = 0; i < clusters.length; i++) {
      if (used.has(i)) continue;

      const current = { ...clusters[i] };
      const currentSet = new Set(current.claimIndexes);

      // Find clusters to merge
      for (let j = i + 1; j < clusters.length; j++) {
        if (used.has(j)) continue;

        const other = clusters[j];
        const otherSet = new Set(other.claimIndexes);
        const intersection = new Set([...currentSet].filter(x => otherSet.has(x)));
        const overlap = intersection.size / Math.max(currentSet.size, otherSet.size);

        if (overlap >= this.overlapThreshold) {
          // Merge
          current.claimIndexes = [...new Set([...current.claimIndexes, ...other.claimIndexes])];
          current.anchors = [...new Set([...current.anchors, ...other.anchors])];
          currentSet.clear();
          current.claimIndexes.forEach(idx => currentSet.add(idx));
          used.add(j);
        }
      }

      merged.push(current);
      used.add(i);
    }

    return merged;
  }

  /**
   * Score and rank clusters.
   */
  scoreAndRankClusters(clusters, compactClaims) {
    const scored = clusters.map(cluster => {
      let score = 0;

      // Score: more claims = better
      score += cluster.claimIndexes.length * 2;

      // Score: spread across fewer sections = better
      const sectionIndexes = new Set();
      for (const claimIdx of cluster.claimIndexes) {
        const claim = compactClaims.find(c => c.claimIndex === claimIdx);
        if (claim) sectionIndexes.add(claim.sectionIndex);
      }
      score += Math.max(0, 10 - sectionIndexes.size * 2);

      // Score: specific anchors better than generic
      const anchorScore = cluster.anchors.reduce((sum, anchor) => {
        if (anchor.length > 10) sum += 3; // Long, likely specific
        if (/[A-Z]{2,}/.test(anchor)) sum += 2; // Acronym
        if (/Act\b/.test(anchor)) sum += 3; // Law
        if (/\d{4}/.test(anchor)) sum += 2; // Year
        return sum;
      }, 0);
      score += anchorScore;

      const reason = `${cluster.claimIndexes.length} claims, ${sectionIndexes.size} sections, anchors: ${cluster.anchors.slice(0, 3).join(", ")}`;

      return {
        ...cluster,
        sectionIndexes: Array.from(sectionIndexes),
        clusterScore: score,
        clusterLabel: cluster.anchors.slice(0, 2).join(" + ") || "Generic",
        reason,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.clusterScore - a.clusterScore);

    return scored;
  }
}

export function buildDeterministicClaimClusters(claims, options = {}) {
  const clusterer = new DeterministicClaimClustering(options);
  return clusterer.buildClusters(claims);
}

export default DeterministicClaimClustering;
