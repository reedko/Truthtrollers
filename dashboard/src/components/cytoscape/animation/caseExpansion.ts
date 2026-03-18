import React from "react";
import cytoscape, { NodeSingular } from "cytoscape";
import { NodeData, LinkData } from "../types";
import { API_BASE_URL } from "../constants";

interface CaseExpansionData {
  caseClaims: Array<{
    id: string;
    claim_id: number;
    label: string;
    type: string;
    content_id: number;
    veracity_score?: number;
    confidence_level?: number;
    linkedSourceCount: number;
  }>;
  sourceToClaimLinks: Array<{
    source: string;
    target: string;
    id: string;
    relation: string;
    value: number;
    notes?: string;
    rationale?: string;
    linkType: "user-approved" | "ai-suggested";
    confidence?: number;
  }>;
  unlinkedSources: Array<{
    reference_content_id: number;
    sourceId: string;
  }>;
  aiSuggestedLinks: Array<{
    source: string;
    target: string;
    id: string;
    relation: string;
    value: number;
    confidence: number;
    linkType: "ai-suggested";
  }>;
}

/**
 * Expand the case node to show case claims as an intermediate layer
 * Sources will connect to their respective case claims instead of directly to the case
 */
export async function expandCaseWithClaims({
  cy,
  caseNode,
  contentId,
  viewerId,
  viewScope = "user",
}: {
  cy: cytoscape.Core;
  caseNode: NodeSingular;
  contentId: number;
  viewerId?: number;
  viewScope?: string;
}): Promise<void> {
  try {
    // Fetch case claim expansion data from API
    const params = new URLSearchParams({
      viewScope: viewScope || "user",
    });
    if (viewerId) {
      params.append("viewerId", viewerId.toString());
    }

    const response = await fetch(
      `${API_BASE_URL}/api/case-claim-expansion/${contentId}?${params}`,
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch case claim expansion data: ${response.statusText}`);
    }

    const data: CaseExpansionData = await response.json();
    console.log("📊 Case Expansion Data:", data);

    const { caseClaims, sourceToClaimLinks, unlinkedSources, aiSuggestedLinks } = data;

    if (caseClaims.length === 0) {
      console.warn("No case claims found for task");
      return;
    }

    // Get case position
    const casePos = caseNode.position();

    // Build connectivity map: which claims share sources
    const claimToSources = new Map<string, Set<string>>();
    [...sourceToClaimLinks, ...aiSuggestedLinks].forEach((link) => {
      if (!claimToSources.has(link.target)) {
        claimToSources.set(link.target, new Set());
      }
      claimToSources.get(link.target)!.add(link.source);
    });

    // Group claims that share sources - simple greedy clustering
    const claimGroups: string[][] = [];
    const assignedClaims = new Set<string>();

    caseClaims.forEach((claim) => {
      if (assignedClaims.has(claim.id)) return;

      const group = [claim.id];
      assignedClaims.add(claim.id);
      const claimSources = claimToSources.get(claim.id) || new Set();

      // Find other claims that share at least one source
      caseClaims.forEach((otherClaim) => {
        if (assignedClaims.has(otherClaim.id)) return;
        const otherSources = claimToSources.get(otherClaim.id) || new Set();

        // Check for shared sources
        const hasSharedSource = Array.from(claimSources).some((s) => otherSources.has(s));
        if (hasSharedSource) {
          group.push(otherClaim.id);
          assignedClaims.add(otherClaim.id);
        }
      });

      claimGroups.push(group);
    });

    console.log(`📊 Grouped ${caseClaims.length} claims into ${claimGroups.length} clusters:`,
      claimGroups.map(g => g.length));

    // Position claims in groups around the case
    const claimRadius = 900; // Even larger radius to prevent overlap
    const totalAngle = Math.PI * 2;

    const claimNodeElements: cytoscape.ElementDefinition[] = [];
    const claimPositions = new Map<string, { x: number; y: number }>();

    let currentAngle = -Math.PI / 2; // Start at top

    claimGroups.forEach((group, groupIndex) => {
      // Allocate angle space for this group PLUS padding between groups
      const groupAngleSpan = (totalAngle / caseClaims.length) * group.length;
      const paddingAngle = 0.3; // ~17 degrees padding between groups
      const groupStartAngle = currentAngle;

      group.forEach((claimId, indexInGroup) => {
        // Spread claims within the group with more space
        const intraGroupSpacing = groupAngleSpan / (group.length + 0.5);
        const angle = groupStartAngle + intraGroupSpacing * (indexInGroup + 0.5);
        const x = casePos.x + claimRadius * Math.cos(angle);
        const y = casePos.y + claimRadius * Math.sin(angle);

        claimPositions.set(claimId, { x, y });

        const claimData = caseClaims.find((c) => c.id === claimId);
        if (claimData) {
          claimNodeElements.push({
            data: {
              ...claimData,
              type: "caseClaim",
            },
            position: { x, y },
          });
        }
      });

      // Move to next group with padding
      currentAngle += groupAngleSpan + paddingAngle;
    });

    // Add case claim nodes to graph
    cy.batch(() => {
      cy.add(claimNodeElements);
    });

    // Create edges from case to each case claim
    const caseToClaimEdges: cytoscape.ElementDefinition[] = caseClaims.map((claim) => ({
      data: {
        id: `edge-case-${caseNode.id()}-claim-${claim.id}`,
        source: caseNode.id(),
        target: claim.id,
        relation: "contains",
        value: 1.0,
      },
    }));

    // Add source-to-claim edges
    const sourceToClaimEdgeElements: cytoscape.ElementDefinition[] = sourceToClaimLinks.map(
      (link) => ({
        data: {
          ...link,
          // Style differently for AI-suggested vs user-approved
          lineStyle: link.linkType === "ai-suggested" ? "dashed" : "solid",
          opacity: link.linkType === "ai-suggested" ? 0.5 : 1.0,
        },
      }),
    );

    // Add dotted edges from unlinked sources to case
    const unlinkedSourceEdges: cytoscape.ElementDefinition[] = unlinkedSources.map(
      (source) => ({
        data: {
          id: `edge-unlinked-${source.sourceId}-case`,
          source: source.sourceId,
          target: caseNode.id(),
          relation: "unlinked",
          lineStyle: "dotted",
          value: 0.3,
          opacity: 0.4,
        },
      }),
    );

    // Add all edges
    cy.batch(() => {
      cy.add([...caseToClaimEdges, ...sourceToClaimEdgeElements, ...unlinkedSourceEdges]);
    });

    // Hide original case-to-source edges
    cy.edges().forEach((edge) => {
      const source = edge.source();
      const target = edge.target();

      // Hide edges that connect case directly to sources
      if (
        (source.id() === caseNode.id() && target.data("type") === "reference") ||
        (target.id() === caseNode.id() && source.data("type") === "reference")
      ) {
        edge.style("display", "none");
      }
    });

    // Reposition sources around their linked claims
    repositionSourcesAroundClaims(cy, sourceToClaimLinks, aiSuggestedLinks, claimPositions);

    console.log("✅ Case expansion complete", {
      caseClaims: caseClaims.length,
      sourceToClaimLinks: sourceToClaimLinks.length,
      unlinkedSources: unlinkedSources.length,
      aiSuggestedLinks: aiSuggestedLinks.length,
    });
  } catch (error) {
    console.error("❌ Error expanding case:", error);
    throw error;
  }
}

/**
 * Reposition sources in circles around their linked case claims
 * Each claim gets its own circle of sources oriented AWAY from the case center
 */
function repositionSourcesAroundClaims(
  cy: cytoscape.Core,
  sourceToClaimLinks: CaseExpansionData["sourceToClaimLinks"],
  aiSuggestedLinks: CaseExpansionData["aiSuggestedLinks"],
  claimPositions: Map<string, { x: number; y: number }>,
): void {
  // Get the case node (center of graph)
  const caseNode = cy.nodes('[type="task"]').first();
  if (!caseNode.length) return;

  const casePos = caseNode.position();

  // Build map of claim -> sources
  const claimToSourcesMap = new Map<string, string[]>();

  // Add user-approved links
  sourceToClaimLinks.forEach((link) => {
    if (!claimToSourcesMap.has(link.target)) {
      claimToSourcesMap.set(link.target, []);
    }
    claimToSourcesMap.get(link.target)!.push(link.source);
  });

  // Add AI-suggested links for sources without user-approved links
  const sourcesWithUserLinks = new Set<string>();
  sourceToClaimLinks.forEach((link) => sourcesWithUserLinks.add(link.source));

  aiSuggestedLinks.forEach((link) => {
    if (!sourcesWithUserLinks.has(link.source)) {
      if (!claimToSourcesMap.has(link.target)) {
        claimToSourcesMap.set(link.target, []);
      }
      claimToSourcesMap.get(link.target)!.push(link.source);
    }
  });

  console.log(`📊 Positioning sources + authors/publishers around ${claimToSourcesMap.size} claims`);

  // Position sources, authors, and publishers around each claim
  claimToSourcesMap.forEach((sourceIds, claimId) => {
    const claimPos = claimPositions.get(claimId);
    if (!claimPos) return;

    // Also find authors and publishers connected to this claim's sources
    const relatedNodes = new Set(sourceIds);

    // For each source, find its connected authors and publishers
    sourceIds.forEach((sourceId) => {
      const sourceNode = cy.getElementById(sourceId);
      if (sourceNode.length) {
        // Find connected authors and publishers
        sourceNode.connectedEdges().forEach((edge) => {
          const connectedNode = edge.source().id() === sourceId ? edge.target() : edge.source();
          const nodeType = connectedNode.data('type');
          if (nodeType === 'author' || nodeType === 'publisher') {
            relatedNodes.add(connectedNode.id());
          }
        });
      }
    });

    const allNodes = Array.from(relatedNodes);
    const numNodes = allNodes.length;

    // Orbit 360° around the claim - FULL CIRCLE
    const sourceRadius = 250; // Smaller, tighter orbit
    const angleStep = (Math.PI * 2) / numNodes; // Divide full circle evenly

    console.log(`  Claim ${claimId}: ${numNodes} nodes in full orbit (sources + authors/publishers)`);

    allNodes.forEach((nodeId, index) => {
      const node = cy.getElementById(nodeId);
      if (!node.length) {
        console.warn(`⚠️ Node not found: ${nodeId}`);
        return;
      }

      // Distribute evenly around the full circle
      const angle = index * angleStep - Math.PI / 2; // Start at top
      const x = claimPos.x + sourceRadius * Math.cos(angle);
      const y = claimPos.y + sourceRadius * Math.sin(angle);

      // Set position directly without animation
      node.position({ x, y });
    });
  });
}

/**
 * Collapse the expanded case view back to the original state
 */
export function collapseCaseClaims(cy: cytoscape.Core, caseNode: NodeSingular): void {
  try {
    console.log("🔄 Starting collapse - current case claim nodes:", cy.nodes('[type = "caseClaim"]').length);

    // Remove all case claim nodes
    cy.batch(() => {
      cy.nodes('[type = "caseClaim"]').remove();
    });

    console.log("🗑️ Removed case claim nodes - remaining nodes:", cy.nodes().length);

    // Show original case-to-source edges
    cy.edges().forEach((edge) => {
      const source = edge.source();
      const target = edge.target();

      if (
        (source.id() === caseNode.id() && target.data("type") === "reference") ||
        (target.id() === caseNode.id() && source.data("type") === "reference")
      ) {
        edge.style("display", "element");
      }
    });

    console.log("✅ Case collapsed successfully");
  } catch (error) {
    console.error("❌ Error collapsing case:", error);
  }
}
