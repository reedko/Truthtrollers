// src/components/CytoscapeMolecule.tsx
import React, { useEffect, useRef, useState } from "react";
import cytoscape, { ElementsDefinition } from "cytoscape";
import { createPortal } from "react-dom";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

interface CytoscapeMoleculeProps {
  nodes: {
    id: string;
    label: string;
    type: string;
    content_id?: number;
  }[];
  links: {
    id: string;
    source: string;
    target: string;
    relation?: string;
  }[];
}

const getUnprefixedId = (id: string) => {
  const parts = id.split("-");
  return parts.length > 1 ? parts[1] : id;
};

const CytoscapeMolecule: React.FC<CytoscapeMoleculeProps> = ({
  nodes,
  links,
}) => {
  const cyRef = useRef<HTMLDivElement>(null);
  const [selectedClaim, setSelectedClaim] = useState<null | {
    id: string;
    label: string;
    relation: string;
  }>(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!cyRef.current) return;

    const cy = cytoscape({
      container: cyRef.current,
      elements: [],
      style: [
        {
          selector: "node",
          style: {
            "background-color": (ele) => {
              const type = ele.data("type");
              if (type === "task") return "#6c5ce7";
              if (type === "reference") return "#00b894";
              if (type === "refClaim") return "#aaa";
              if (type === "taskClaim") return "#ffeaa7";
              if (type === "author") return "#fab1a0";
              if (type === "publisher") return "#81ecec";
              return "#ccc";
            },
            label: "data(label)",
            "text-wrap": "wrap",
            "text-max-width": "60",
            "text-valign": "bottom",
            "text-halign": "center",
            "font-size": "10px",
            "text-margin-y": 4,
            width: "90",
            height: "90",
            "text-outline-width": "0",
            color: "#f2f2f2",
            "text-background-color": "#222",
            "text-background-opacity": 1,
            "text-background-shape": "roundrectangle",
            "border-width": 2,
            "border-color": "#222",
            "z-index": 10,
            "background-fit": "none",
            "background-clip": "none",
            "background-image": (ele) => {
              const id = ele.id();
              const type = ele.data("type");
              const group =
                type === "author"
                  ? 1
                  : type === "task" || type === "reference"
                  ? 2
                  : type === "publisher"
                  ? 3
                  : 0;
              const path =
                {
                  0: `authors/author_id_${getUnprefixedId(id)}.png`,
                  1: `authors/author_id_${getUnprefixedId(id)}.png`,
                  2: `content/content_id_${getUnprefixedId(id)}.png`,
                  3: `publishers/publisher_id_${getUnprefixedId(id)}.png`,
                }[group] || `default.png`;
              return `${API_BASE_URL}/assets/images/${path}`;
            },
            "background-opacity": 0.85,
            "background-width-relative-to": "inner",
            "background-width": "70%",
            "background-height": "70%",
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": (ele) => {
              const rel = ele.data("relation");
              return rel === "supports"
                ? "#00ff99"
                : rel === "refutes"
                ? "#ff3b3b"
                : "#aaa";
            },
            "target-arrow-color": (ele) => ele.data("relation") || "#aaa",
            "target-arrow-shape": "triangle",
            "curve-style": "unbundled-bezier",
            "control-point-step-size": 60,
            "control-point-weight": 0.5,
            opacity: 0.7,
          },
        },
        {
          selector: ".faded",
          style: {
            opacity: 0.05,
            "text-opacity": 0.05,
          },
        },
      ],
      layout: {
        name: "concentric",
        fit: true,
        padding: 50,
        startAngle: (3 / 2) * Math.PI,
        clockwise: true,
        equidistant: true,
        minNodeSpacing: 60,
        avoidOverlap: true,
        concentric: (node) => {
          if (node.data("type") === "task") return 5;
          if (node.data("type") === "reference") return 4;
          if (node.data("type") === "author") return 6.5;
          if (node.data("type") === "publisher") return 6.5;
          return 1;
        },
        levelWidth: () => 1,
      },
    });

    const taskNode = nodes.find((n) => n.type === "task");

    const initialNodeIds = nodes
      .filter((n) =>
        ["task", "reference", "author", "publisher"].includes(n.type)
      )
      .map((n) => n.id);

    const visibleNodeIds = new Set(initialNodeIds);

    const filteredElements: ElementsDefinition = {
      nodes: nodes
        .filter((n) => visibleNodeIds.has(n.id))
        .map((n) => ({ data: { ...n } })),
      edges: links
        .filter(
          (l) => visibleNodeIds.has(l.source) && visibleNodeIds.has(l.target)
        )
        .map((l) => ({ data: { ...l } })),
    };

    cy.add(filteredElements);
    cy.layout({
      name: "concentric",
      fit: true,
      padding: 50,
      startAngle: (3 / 2) * Math.PI,
      clockwise: true,
      equidistant: true,
      minNodeSpacing: 60,
      avoidOverlap: true,
      concentric: (node) => {
        if (node.data("type") === "task") return 5;
        if (node.data("type") === "reference") return 4;
        if (node.data("type") === "author") return 1;
        if (node.data("type") === "publisher") return 1;
        return;
      },
      levelWidth: () => 1,
    }).run();

    cy.on("tap", "node", (event) => {
      const node = event.target;
      const type = node.data("type");

      if (type === "reference") {
        setSelectedReferenceId(node.id());
        // TODO: Animate claim appearance here
      } else {
        setSelectedClaim({
          id: node.id(),
          label: node.data("label"),
          relation: node.data("relation") || "related",
        });
      }
    });

    return () => cy.destroy();
  }, [nodes, links]);

  return (
    <>
      <div
        ref={cyRef}
        style={{
          width: "100vw",
          height: "750px",
          backgroundColor: "#111",
          border: "1px solid #333",
          transition: "filter 0.3s ease",
        }}
      />

      {selectedClaim &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "#222",
              color: "#fff",
              padding: "1.5em",
              borderRadius: 12,
              boxShadow: "0 0 20px rgba(0,0,0,0.6)",
              zIndex: 1000,
            }}
          >
            <h3>
              {selectedClaim.relation === "supports"
                ? "✅ Supports"
                : selectedClaim.relation === "refutes"
                ? "❌ Refutes"
                : "Claim"}
            </h3>
            <p style={{ marginTop: 12 }}>{selectedClaim.label}</p>
            <button
              onClick={() => setSelectedClaim(null)}
              style={{
                marginTop: 20,
                background: "#6c5ce7",
                color: "#fff",
                padding: "0.5em 1em",
                borderRadius: 6,
              }}
            >
              Close
            </button>
          </div>,
          document.body
        )}
    </>
  );
};

export default CytoscapeMolecule;
var compAtrr = cy.$('node[type = "originalnode"]');
compAtrr.on("grabon drag", function (evt) {
  var node = evt.target;
  var idnode = node.data("id");
  var fakenode = cy.$id(idnode + "fake");
  var ix = node.position("x");
  var iy = node.position("y");
  fakenode.position({
    x: ix,
    y: iy,
  });
});

var fakeAtrr = cy.$('node[type = "fakenode"]');
fakeAtrr.on("grabon drag", function (evt) {
  var node = evt.target;
  var idnode = node.data("id");
  var l = idnode.length;
  idnode = idnode.slice(0, l - 4); //remove 'fake' string
  var realnode = cy.$id(idnode);
  var ix = node.position("x");
  var iy = node.position("y");
  realnode.position({
    x: ix,
    y: iy,
  });
});
