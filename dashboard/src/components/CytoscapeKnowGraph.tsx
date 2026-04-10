// CytoscapeKnowGraph.tsx - Knowledge graph visualization with hierarchical left-to-right layout
import React, { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { Box, useColorMode } from "@chakra-ui/react";
import { GraphNode, Link } from "../../../shared/entities/types";

// Register dagre layout
cytoscape.use(dagre);

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface CytoscapeKnowGraphProps {
  nodes: GraphNode[];
  links: Link[];
  onNodeClick?: (node: GraphNode) => void;
  centerNodeId?: string;
  currentUserId?: number | null;
}

const CytoscapeKnowGraph: React.FC<CytoscapeKnowGraphProps> = ({
  nodes,
  links,
  onNodeClick,
  centerNodeId,
  currentUserId,
}) => {
  const { colorMode } = useColorMode();
  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<cytoscape.Core | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  const [authorDropdown, setAuthorDropdown] = useState<{
    authors: GraphNode[];
    position: { x: number; y: number };
    parentLabel: string;
  } | null>(null);

  // Update callback ref without triggering graph rebuild
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  useEffect(() => {
    if (!cyRef.current) {
      return;
    }
    const viewportWidth = cyRef.current.clientWidth;
    const viewportHeight = cyRef.current.clientHeight;

    if (nodes.length === 0) {
      return;
    }

    // Column positions - spread out more at full res to use horizontal space
    const isFullRes = viewportWidth >= 1280;
    const COLUMNS = isFullRes
      ? {
          CASE: 50,
          AUTH_PUB: 650,
          CASE_CLAIMS: 1350,
          SOURCE_CLAIMS: 2700,
          SOURCE_AUTH_PUB: 3350,
          SOURCES: 4000,
        }
      : {
          CASE: 50,
          AUTH_PUB: 550,
          CASE_CLAIMS: 1100,
          SOURCE_CLAIMS: 2200,
          SOURCE_AUTH_PUB: 2700,
          SOURCES: 3200,
        };

    const ROW_HEIGHT = 200; // Spacing between nodes vertically
    const START_Y = 100;

    // Filter to only show nodes connected by human-created claim_link edges
    // First, collect all claim IDs that are part of claim_links
    const claimIdsInLinks = new Set<string>();
    links.forEach((link) => {
      // claim_links have source and target in the format 'claim-{id}'
      if (
        link.source.startsWith("claim-") &&
        link.target.startsWith("claim-")
      ) {
        claimIdsInLinks.add(link.source);
        claimIdsInLinks.add(link.target);
      }
    });

    // Filter nodes by type and whether they're connected via claim_links
    const caseNodes = nodes.filter((n) => n.type === "task");
    const allAuthNodes = nodes.filter((n) => n.type === "author");
    const allPubNodes = nodes.filter((n) => n.type === "publisher");

    // Only include claims that have human-created claim_link connections
    const allCaseClaimNodes = nodes.filter((n) => n.type === "taskClaim");
    const allSourceClaimNodes = nodes.filter((n) => n.type === "refClaim");

    const caseClaimNodes = allCaseClaimNodes.filter((n) =>
      claimIdsInLinks.has(n.id),
    );
    const sourceClaimNodes = allSourceClaimNodes.filter((n) =>
      claimIdsInLinks.has(n.id),
    );

    // Only include sources that have at least one source claim with a claim_link
    const allSourceNodes = nodes.filter((n) => n.type === "reference");
    const linkedSourceContentIds = new Set(
      sourceClaimNodes.map((sc) => sc.content_id).filter(Boolean),
    );
    const sourceNodes = allSourceNodes.filter((n) =>
      linkedSourceContentIds.has(n.content_id),
    );

    // Build set of visible node IDs (case + visible sources)
    const visibleNodeIds = new Set([
      ...caseNodes.map((n) => n.id),
      ...sourceNodes.map((n) => n.id),
    ]);

    // Filter authors/publishers - only keep those that link to visible content
    // Check links to see which authors/publishers connect to visible nodes
    const linkedAuthorIds = new Set<string>();
    const linkedPubIds = new Set<string>();

    links.forEach((link) => {
      const sourceNode = nodes.find((n) => n.id === link.source);
      const targetNode = nodes.find((n) => n.id === link.target);

      // Author links
      if (sourceNode?.type === "author" && visibleNodeIds.has(link.target)) {
        linkedAuthorIds.add(link.source);
      }
      if (targetNode?.type === "author" && visibleNodeIds.has(link.source)) {
        linkedAuthorIds.add(link.target);
      }

      // Publisher links
      if (sourceNode?.type === "publisher" && visibleNodeIds.has(link.target)) {
        linkedPubIds.add(link.source);
      }
      if (targetNode?.type === "publisher" && visibleNodeIds.has(link.source)) {
        linkedPubIds.add(link.target);
      }
    });

    const authNodes = allAuthNodes.filter((n) => linkedAuthorIds.has(n.id));
    const pubNodes = allPubNodes.filter((n) => linkedPubIds.has(n.id));

    // Group authors and publishers by their parent entity (case or source)
    const authorsByParent = new Map<string, GraphNode[]>();
    const publishersByParent = new Map<string, GraphNode[]>();

    // Build set of author/publisher IDs that passed filtering
    const filteredAuthorIds = new Set(authNodes.map((n) => n.id));
    const filteredPubIds = new Set(pubNodes.map((n) => n.id));

    // Find parent for each author/publisher via links
    // ONLY process links where the author/publisher is in the filtered set
    links.forEach((link) => {
      const sourceNode = nodes.find((n) => n.id === link.source);
      const targetNode = nodes.find((n) => n.id === link.target);

      // Author connections - ONLY if author is in filtered list
      if (
        sourceNode?.type === "author" &&
        filteredAuthorIds.has(sourceNode.id) &&
        (targetNode?.type === "task" || targetNode?.type === "reference")
      ) {
        if (!authorsByParent.has(targetNode.id)) {
          authorsByParent.set(targetNode.id, []);
        }
        authorsByParent.get(targetNode.id)!.push(sourceNode);
      } else if (
        (sourceNode?.type === "task" || sourceNode?.type === "reference") &&
        targetNode?.type === "author" &&
        filteredAuthorIds.has(targetNode.id)
      ) {
        if (!authorsByParent.has(sourceNode.id)) {
          authorsByParent.set(sourceNode.id, []);
        }
        authorsByParent.get(sourceNode.id)!.push(targetNode);
      }

      // Publisher connections - ONLY if publisher is in filtered list
      if (
        sourceNode?.type === "publisher" &&
        filteredPubIds.has(sourceNode.id) &&
        (targetNode?.type === "task" || targetNode?.type === "reference")
      ) {
        if (!publishersByParent.has(targetNode.id)) {
          publishersByParent.set(targetNode.id, []);
        }
        publishersByParent.get(targetNode.id)!.push(sourceNode);
      } else if (
        (sourceNode?.type === "task" || sourceNode?.type === "reference") &&
        targetNode?.type === "publisher" &&
        filteredPubIds.has(targetNode.id)
      ) {
        if (!publishersByParent.has(sourceNode.id)) {
          publishersByParent.set(sourceNode.id, []);
        }
        publishersByParent.get(sourceNode.id)!.push(targetNode);
      }
    });

    // Create composite author nodes (one per parent)
    const compositeAuthorNodes: any[] = [];
    authorsByParent.forEach((authors, parentId) => {
      const parent = nodes.find((n) => n.id === parentId);
      compositeAuthorNodes.push({
        id: `authors-${parentId}`,
        label:
          authors.length === 1 ? authors[0].label : `${authors.length} Authors`,
        type: "authorGroup",
        parentId,
        parentLabel: parent?.label || "",
        authors,
      });
    });

    // Create composite publisher nodes (one per parent)
    const compositePubNodes: any[] = [];
    publishersByParent.forEach((publishers, parentId) => {
      const parent = nodes.find((n) => n.id === parentId);
      compositePubNodes.push({
        id: `publishers-${parentId}`,
        label:
          publishers.length === 1
            ? publishers[0].label
            : `${publishers.length} Publishers`,
        type: "publisherGroup",
        parentId,
        parentLabel: parent?.label || "",
        publishers,
      });
    });

    const authPubCompositeNodes = [
      ...compositeAuthorNodes,
      ...compositePubNodes,
    ];

    const maxRows = Math.max(
      caseNodes.length,
      authPubCompositeNodes.length,
      caseClaimNodes.length,
      sourceClaimNodes.length,
      sourceNodes.length,
    );

    // Center the case node vertically
    const centerY = START_Y + (maxRows * ROW_HEIGHT) / 2;

    // Position nodes
    const positionedNodes: any[] = [];

    // Case nodes - centered vertically
    caseNodes.forEach((node, i) => {
      positionedNodes.push({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          content_id: node.content_id,
          claim_id: node.claim_id,
          author_id: node.author_id,
          publisher_id: node.publisher_id,
          url: node.url,
        },
        position: { x: COLUMNS.CASE, y: centerY + i * ROW_HEIGHT },
      });
    });

    // Composite Auth/Pub nodes (grouped by parent) - position based on parent type
    // Initial positioning - will adjust source auth/pub in second pass below
    let caseAuthPubIndex = 0;
    let sourceAuthPubIndex = 0;
    authPubCompositeNodes.forEach((node) => {
      // Find parent node to determine its type
      const parentNode = nodes.find((n) => n.id === node.parentId);
      const isSourceParent = parentNode?.type === "reference";

      // Position source authors/publishers between source claims and sources
      // Position case authors/publishers in the original column
      const xPos = isSourceParent ? COLUMNS.SOURCE_AUTH_PUB : COLUMNS.AUTH_PUB;
      const yIndex = isSourceParent ? sourceAuthPubIndex++ : caseAuthPubIndex++;

      positionedNodes.push({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          parentId: node.parentId,
          parentLabel: node.parentLabel,
          authors: node.authors,
          publishers: node.publishers,
        },
        position: { x: xPos, y: START_Y + yIndex * ROW_HEIGHT },
      });
    });

    // Case claim nodes
    caseClaimNodes.forEach((node, i) => {
      positionedNodes.push({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          content_id: node.content_id,
          claim_id: node.claim_id,
          author_id: node.author_id,
          publisher_id: node.publisher_id,
          url: node.url,
        },
        position: { x: COLUMNS.CASE_CLAIMS, y: START_Y + i * ROW_HEIGHT },
      });
    });

    // Source claim nodes - position them first to establish order
    const sourceClaimPositions = new Map<string, number>();
    sourceClaimNodes.forEach((node, i) => {
      const yPos = START_Y + i * ROW_HEIGHT;
      sourceClaimPositions.set(node.id, yPos);
      positionedNodes.push({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          content_id: node.content_id,
          claim_id: node.claim_id,
          author_id: node.author_id,
          publisher_id: node.publisher_id,
          url: node.url,
        },
        position: { x: COLUMNS.SOURCE_CLAIMS, y: yPos },
      });
    });

    // Build source claim → source mapping to align sources with their claims
    const sourceToSourceClaims = new Map<string, string[]>();
    sourceClaimNodes.forEach((sourceClaim) => {
      const sourceNode = sourceNodes.find(
        (s) => s.content_id === sourceClaim.content_id,
      );
      if (sourceNode) {
        if (!sourceToSourceClaims.has(sourceNode.id)) {
          sourceToSourceClaims.set(sourceNode.id, []);
        }
        sourceToSourceClaims.get(sourceNode.id)!.push(sourceClaim.id);
      }
    });

    // Position sources aligned with their source claims (average Y position if multiple claims)
    const positionedSourceIds = new Set<string>();
    sourceNodes.forEach((node) => {
      const relatedSourceClaims = sourceToSourceClaims.get(node.id) || [];
      let yPos: number;

      if (relatedSourceClaims.length > 0) {
        // Calculate average Y position of related source claims
        const claimYPositions = relatedSourceClaims
          .map((claimId) => sourceClaimPositions.get(claimId))
          .filter(Boolean) as number[];

        if (claimYPositions.length > 0) {
          yPos =
            claimYPositions.reduce((sum, y) => sum + y, 0) /
            claimYPositions.length;
        } else {
          // Fallback if no positions found
          yPos = START_Y + sourceNodes.indexOf(node) * ROW_HEIGHT;
        }
      } else {
        // No related claims, use default positioning
        yPos = START_Y + sourceNodes.indexOf(node) * ROW_HEIGHT;
      }

      positionedSourceIds.add(node.id);
      positionedNodes.push({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          content_id: node.content_id,
          claim_id: node.claim_id,
          author_id: node.author_id,
          publisher_id: node.publisher_id,
          url: node.url,
        },
        position: { x: COLUMNS.SOURCES, y: yPos },
      });
    });

    // Build position lookup for nodes (both x and y)
    const nodePositions = new Map<string, number>();
    const nodeYPositions = new Map<string, number>();
    positionedNodes.forEach((node) => {
      nodePositions.set(node.data.id, node.position.x);
      nodeYPositions.set(node.data.id, node.position.y);
    });

    // Second pass: Reposition source authors/publishers near their parent sources
    authPubCompositeNodes.forEach((compositeNode) => {
      const parentNode = nodes.find((n) => n.id === compositeNode.parentId);
      const isSourceParent = parentNode?.type === "reference";

      if (isSourceParent) {
        // Find this composite node in positionedNodes and update its Y position
        const positionedNode = positionedNodes.find(
          (n) => n.data.id === compositeNode.id,
        );
        if (positionedNode) {
          const parentYPos = nodeYPositions.get(compositeNode.parentId);
          if (parentYPos !== undefined) {
            // Position slightly above the source to avoid edge overlap
            positionedNode.position.y = parentYPos - 80;
            // Update the map too
            nodeYPositions.set(compositeNode.id, parentYPos - 80);
          }
        }
      }
    });

    // Map individual author/publisher IDs to their composite node IDs
    const authorToComposite = new Map<string, string>();
    const publisherToComposite = new Map<string, string>();

    authorsByParent.forEach((authors, parentId) => {
      const compositeId = `authors-${parentId}`;
      authors.forEach((author) => {
        authorToComposite.set(author.id, compositeId);
      });
    });

    publishersByParent.forEach((publishers, parentId) => {
      const compositeId = `publishers-${parentId}`;
      publishers.forEach((pub) => {
        publisherToComposite.set(pub.id, compositeId);
      });
    });

    // Build a set of all valid node IDs after filtering
    const validNodeIds = new Set(positionedNodes.map((n) => n.data.id));

    // Prepare edges for cytoscape - redirect to composite nodes and filter out broken edges
    const cyEdges = links
      .filter((link) => {
        if (link.source === link.target) {
          return false;
        }
        return true;
      })
      .map((link, idx) => {
        let finalSource = link.source;
        let finalTarget = link.target;

        // Redirect author/publisher edges to composite nodes
        if (authorToComposite.has(finalSource)) {
          finalSource = authorToComposite.get(finalSource)!;
        }
        if (authorToComposite.has(finalTarget)) {
          finalTarget = authorToComposite.get(finalTarget)!;
        }
        if (publisherToComposite.has(finalSource)) {
          finalSource = publisherToComposite.get(finalSource)!;
        }
        if (publisherToComposite.has(finalTarget)) {
          finalTarget = publisherToComposite.get(finalTarget)!;
        }

        // Determine edge direction based on X positions
        const sourceX = nodePositions.get(finalSource) || 0;
        const targetX = nodePositions.get(finalTarget) || 0;
        const isLeftToRight = sourceX < targetX;

        return {
          data: {
            id: `edge-${idx}`,
            source: finalSource,
            target: finalTarget,
            relation: link.relation || "meta",
            type: link.type || "",
            notes: link.notes || "",
            isLeftToRight, // Store direction info for styling
          },
        };
      })
      .filter((edge) => {
        // Only include edges where both source and target nodes exist
        const sourceExists = validNodeIds.has(edge.data.source);
        const targetExists = validNodeIds.has(edge.data.target);

        if (!sourceExists || !targetExists) {
          return false;
        }

        // Filter out direct edges from case (task) to source (reference)
        const sourceNode = nodes.find((n) => n.id === edge.data.source);
        const targetNode = nodes.find((n) => n.id === edge.data.target);

        if (
          (sourceNode?.type === "task" && targetNode?.type === "reference") ||
          (sourceNode?.type === "reference" && targetNode?.type === "task")
        ) {
          return false; // Don't show case-to-source edges
        }

        return true;
      });

    // Add edges from Case to all Case Claims
    const caseNode = caseNodes[0];
    if (caseNode) {
      caseClaimNodes.forEach((claimNode, idx) => {
        cyEdges.push({
          data: {
            id: `case-to-claim-${idx}`,
            source: caseNode.id,
            target: claimNode.id,
            relation: "contains",
            type: "contains",
            notes: "",
            isLeftToRight: true, // Case is on left, claims on right
          },
        });
      });
    }

    // Add edges from Source Claims to Sources
    // Each refClaim node has a content_id that tells us which source it belongs to
    let sourceClaimToSourceEdgeCount = 0;
    sourceClaimNodes.forEach((sourceClaimNode) => {
      // Find the source node that matches this claim's content_id
      const sourceNode = sourceNodes.find(
        (n) => n.content_id === sourceClaimNode.content_id,
      );

      if (sourceNode) {
        cyEdges.push({
          data: {
            id: `sourceclaim-to-source-${sourceClaimNode.id}-${sourceNode.id}`,
            source: sourceClaimNode.id,
            target: sourceNode.id,
            relation: "sourceClaim",
            type: "sourceClaim",
            notes: "",
            isLeftToRight: true, // Source claims on left, sources on right
          },
        });
        sourceClaimToSourceEdgeCount++;
      }
    });

    // Initialize cytoscape
    const cy = cytoscape({
      container: cyRef.current,
      elements: {
        nodes: positionedNodes,
        edges: cyEdges,
      },
      style: [
        // Node styles - original sizes
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-wrap": "wrap",
            "text-max-width": "250px",
            "text-valign": "center",
            "text-halign": "center",
            "font-size": "14px",
            "font-weight": 700,
            color: "#eff5ff",
            "text-outline-color": "#1e293b",
            "text-outline-width": 2,
          } as any,
        },
        // Case node - LARGE circle
        {
          selector: 'node[type="task"]',
          style: {
            shape: "ellipse",
            width: 320,
            height: 280,
            "background-color": "#6ea8ff",
            "background-opacity": 0.9,
            "border-width": 3,
            "border-color": "rgba(255, 255, 255, 0.2)",
            "font-size": "30px",
            "text-max-width": "250px",
          } as any,
        },
        // Case claims - large readable rectangles with very soft corners
        {
          selector: 'node[type="taskClaim"]',
          style: {
            shape: "round-rectangle",
            width: 560,
            height: 160,
            "corner-radius": 40,
            "background-color": "#8f7cff",
            "background-opacity": 0.9,
            "border-width": 3,
            "border-color": "rgba(255, 255, 255, 0.2)",
            "font-size": "30px",
            "text-max-width": "500px",
          } as any,
        },
        // Source claims - large readable rectangles with very soft corners
        {
          selector: 'node[type="refClaim"]',
          style: {
            shape: "round-rectangle",
            width: 560,
            height: 160,
            "corner-radius": 40,
            "background-color": "#58d6ff",
            "background-opacity": 0.9,
            "border-width": 3,
            "border-color": "rgba(255, 255, 255, 0.2)",
            "font-size": "30px",
            "text-max-width": "500px",
          } as any,
        },
        // Sources - larger diamonds
        {
          selector: 'node[type="reference"]',
          style: {
            shape: "diamond",
            width: 340,
            height: 200,
            "background-color": "#63f0b0",
            "background-opacity": 0.9,
            "border-width": 3,
            "border-color": "rgba(255, 255, 255, 0.2)",
            "font-size": "30px",
            "text-max-width": "300px",
          } as any,
        },
        // Author groups - composite nodes
        {
          selector: 'node[type="authorGroup"]',
          style: {
            shape: "ellipse",
            width: 130,
            height: 100,
            "background-color": "#ff8fb7",
            "background-opacity": 0.9,
            "border-width": 3,
            "border-color": "rgba(255, 255, 255, 0.2)",
            "font-size": "30px",
            "text-max-width": "90px",
          } as any,
        },
        // Publisher groups - composite nodes
        {
          selector: 'node[type="publisherGroup"]',
          style: {
            shape: "ellipse",
            width: 120,
            height: 100,
            "background-color": "#ffbf69",
            "background-opacity": 0.9,
            "border-width": 3,
            "border-color": "rgba(255, 255, 255, 0.2)",
            "font-size": "16px",
            "text-max-width": "90px",
          } as any,
        },
        // Default edge style - curved lines
        {
          selector: "edge",
          style: {
            width: 9,
            "curve-style": "unbundled-bezier",
            "control-point-distances": [40, -40],
            "control-point-weights": [0.25, 0.75],
            "target-arrow-shape": "triangle",
            "target-arrow-color": "data(color)",
            "line-color": "data(color)",
            opacity: 0.85,
          } as any,
        },
        // Left-to-right edges (source on left, target on right) - exit right, enter left
        {
          selector: "edge[?isLeftToRight]",
          style: {
            "source-endpoint": "90deg", // Right side of source
            "target-endpoint": "270deg", // Left side of target
          } as any,
        },
        // Right-to-left edges (source on right, target on left) - exit left, enter right
        {
          selector: "edge[!isLeftToRight]",
          style: {
            "source-endpoint": "270deg", // Left side of source
            "target-endpoint": "90deg", // Right side of target
          } as any,
        },
        // Case to Case Claim edges - thick blue
        {
          selector: 'edge[relation="contains"]',
          style: {
            "line-color": "#6ea8ff",
            "target-arrow-color": "#6ea8ff",
            width: 12,
            opacity: 0.9,
          } as any,
        },
        // Source Claim to Source edges - solid blue
        {
          selector: 'edge[relation="sourceClaim"]',
          style: {
            "line-color": "#58d6ff",
            "target-arrow-color": "#58d6ff",
            width: 9,
            opacity: 0.85,
          } as any,
        },
        // Support edges - vibrant green
        {
          selector: 'edge[relation="supports"]',
          style: {
            "line-color": "#4ade80",
            "target-arrow-color": "#4ade80",
          } as any,
        },
        // Refute edges - vibrant red
        {
          selector: 'edge[relation="refutes"]',
          style: {
            "line-color": "#f87171",
            "target-arrow-color": "#f87171",
          } as any,
        },
        // Related/nuance edges - vibrant blue
        {
          selector: 'edge[relation="related"]',
          style: {
            "line-color": "#60a5fa",
            "target-arrow-color": "#60a5fa",
          } as any,
        },
        // Metadata edges (author/publisher) - haystack for visible stacking of multiple edges
        {
          selector: 'edge[relation="meta"]',
          style: {
            "curve-style": "haystack",
            "haystack-radius": 0.3, // How much the edges spread out
            "line-color": "rgba(172, 189, 220, 0.7)",
            "target-arrow-shape": "triangle",
            "target-arrow-color": "rgba(172, 189, 220, 0.7)",
            opacity: 0.7,
            width: 6,
          } as any,
        },
      ],
      layout: {
        name: "preset", // Use preset positions
      } as any,
      zoomingEnabled: true,
      userZoomingEnabled: true,
    });

    // Store instance
    cyInstance.current = cy;

    // COMPLETELY disable normal wheel zoom - only shift+wheel
    cy.userZoomingEnabled(false);

    // Enable node dragging
    cy.nodes().forEach((node) => {
      node.grabify();
    });

    // Click handler
    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      const data = node.data();

      // Handle author/publisher group nodes - show dropdown if multiple
      if (
        data.type === "authorGroup" &&
        data.authors &&
        data.authors.length > 1
      ) {
        const renderedPos = node.renderedPosition();
        setAuthorDropdown({
          authors: data.authors,
          position: { x: renderedPos.x, y: renderedPos.y },
          parentLabel: data.parentLabel,
        });
        return;
      }

      if (
        data.type === "publisherGroup" &&
        data.publishers &&
        data.publishers.length > 1
      ) {
        const renderedPos = node.renderedPosition();
        setAuthorDropdown({
          authors: data.publishers,
          position: { x: renderedPos.x, y: renderedPos.y },
          parentLabel: data.parentLabel,
        });
        return;
      }

      if (onNodeClickRef.current) {
        const graphNode = new GraphNode(
          data.id,
          data.label,
          data.type,
          node.position("x"),
          node.position("y"),
          data.url,
          data.content_id,
          data.claim_id,
          data.publisher_id,
          data.author_id,
        );
        onNodeClickRef.current(graphNode);
      }
    });

    // Enable zoom ONLY with shift+wheel - use a toggle approach instead
    let lastScrollDirection = 0;
    const container = cyRef.current;
    if (container) {
      container.addEventListener(
        "wheel",
        (e) => {
          if (e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();

            const currentZoom = cy.zoom();

            // Check if scroll direction changed (helps detect actual scroll intent)
            // Use wheelDelta if available (for better cross-browser support)
            const delta = e.deltaY || -(e as any).wheelDelta;

            // Determine zoom direction - alternate between zoom in and out based on scroll
            // This avoids the -0 issue
            let newZoom;
            if (Math.abs(delta) < 1) {
              // Very small delta, toggle based on last direction
              lastScrollDirection = lastScrollDirection === 1 ? -1 : 1;
            } else {
              lastScrollDirection = delta > 0 ? 1 : -1;
            }

            if (lastScrollDirection < 0) {
              // ZOOM IN
              newZoom = currentZoom * 1.15;
            } else {
              // ZOOM OUT
              newZoom = currentZoom * 0.85;
            }

            // Get center of viewport
            const pan = cy.pan();
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;
            const centerX = containerWidth / 2;
            const centerY = containerHeight / 2;

            // Calculate zoom around center point
            const zoomPoint = {
              x: (centerX - pan.x) / currentZoom,
              y: (centerY - pan.y) / currentZoom,
            };

            cy.zoom({
              level: newZoom,
              position: zoomPoint,
            });
          }
          // If no shift key, do nothing - allows normal page scroll
        },
        { passive: false },
      );
    }

    // Set viewport - fit height, start at left edge
    // STEP 2: Get graph bounding box
    const boundingBox = cy.elements().boundingBox();
    const graphWidth = boundingBox.w;
    const graphHeight = boundingBox.h;
    const graphLeftEdge = boundingBox.x1;
    const graphCenterY = boundingBox.y1 + graphHeight / 2;

    // STEP 3: Calculate zoom - fit both dimensions to ensure graph never extends beyond viewport
    const paddingPercentHeight = viewportWidth < 1280 ? 0.95 : 0.92;
    const paddingPercentWidth = viewportWidth < 1280 ? 0.95 : 0.95;
    const availableHeight = viewportHeight * paddingPercentHeight;
    const availableWidth = viewportWidth * paddingPercentWidth;

    const zoomForHeight = availableHeight / graphHeight;
    const zoomForWidth = availableWidth / graphWidth;

    // Always use min to ensure graph fits in both dimensions
    const optimalZoom = Math.min(zoomForHeight, zoomForWidth);

    // STEP 4: Apply zoom and position at left edge
    // Smaller padding on smaller viewports
    const leftPadding = viewportWidth < 1280 ? 30 : 50;
    cy.zoom(optimalZoom);
    cy.pan({
      x: leftPadding - graphLeftEdge * optimalZoom,
      y: viewportHeight / 2 - graphCenterY * optimalZoom,
    });

    // Add resize observer to refit graph when container size changes
    // Throttle to prevent excessive recalculations
    let resizeTimeout: NodeJS.Timeout | null = null;
    const resizeObserver = new ResizeObserver((entries) => {
      // Clear pending timeout
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      // Debounce resize handling - only run 500ms after resize stops (increased for prod stability)
      resizeTimeout = setTimeout(() => {
        for (const entry of entries) {
          const newWidth = entry.contentRect.width;
          const newHeight = entry.contentRect.height;

          // Guard against invalid measurements and skip if dimensions haven't actually changed
          if (
            newWidth > 0 &&
            newHeight > 0 &&
            (newWidth !== viewportWidth || newHeight !== viewportHeight)
          ) {
            // Recalculate fit based on new container size
            const boundingBox = cy.elements().boundingBox();
            const graphWidth = boundingBox.w;
            const graphHeight = boundingBox.h;
            const graphLeftEdge = boundingBox.x1;
            const graphCenterY = boundingBox.y1 + graphHeight / 2;

            // Fit both dimensions to ensure graph never extends beyond viewport
            const paddingPercentHeight = newWidth < 1280 ? 0.95 : 0.92;
            const paddingPercentWidth = newWidth < 1280 ? 0.95 : 0.95;
            const availableHeight = newHeight * paddingPercentHeight;
            const availableWidth = newWidth * paddingPercentWidth;

            const zoomForHeight = availableHeight / graphHeight;
            const zoomForWidth = availableWidth / graphWidth;
            const optimalZoom = Math.min(zoomForHeight, zoomForWidth);

            // Adaptive left padding
            const leftPadding = newWidth < 1280 ? 30 : 50;
            cy.zoom(optimalZoom);
            cy.pan({
              x: leftPadding - graphLeftEdge * optimalZoom,
              y: newHeight / 2 - graphCenterY * optimalZoom,
            });
          }
        }
      }, 500);
    });

    if (cyRef.current) {
      resizeObserver.observe(cyRef.current);
    }

    // Cleanup
    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeObserver.disconnect();
      cy.destroy();
    };
  }, [nodes, links]);

  return (
    <Box position="relative" width="100%" height="100%">
      <Box
        ref={cyRef}
        width="100%"
        height="100%"
        bg={colorMode === "dark" ? "transparent" : "gray.50"}
        borderRadius="lg"
      />

      {/* Author/Publisher dropdown overlay */}
      {authorDropdown && (
        <>
          {/* Backdrop */}
          <Box
            position="absolute"
            top={0}
            left={0}
            right={0}
            bottom={0}
            onClick={() => setAuthorDropdown(null)}
            zIndex={100}
          />

          {/* Dropdown */}
          <Box
            position="absolute"
            left={`${authorDropdown.position.x + 60}px`}
            top={`${authorDropdown.position.y}px`}
            bg="rgba(8, 14, 24, 0.96)"
            border="1px solid rgba(255, 143, 183, 0.4)"
            borderRadius="12px"
            p={3}
            backdropFilter="blur(12px)"
            boxShadow="0 8px 32px rgba(0, 0, 0, 0.7)"
            zIndex={101}
            minW="220px"
            maxH="400px"
            overflowY="auto"
          >
            <Box fontSize="xs" color="#ff8fb7" fontWeight={700} mb={2}>
              {authorDropdown.authors[0]?.type === "publisher"
                ? "Publishers"
                : "Authors"}{" "}
              for {authorDropdown.parentLabel}
            </Box>
            {authorDropdown.authors.map((author, idx) => (
              <Box
                key={idx}
                p={2}
                mb={1}
                bg="rgba(255, 143, 183, 0.12)"
                borderRadius="md"
                border="1px solid rgba(255, 143, 183, 0.25)"
                _hover={{ bg: "rgba(255, 143, 183, 0.22)", cursor: "pointer" }}
                fontSize="xs"
                color="gray.200"
              >
                {author.label}
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
};

export default CytoscapeKnowGraph;
