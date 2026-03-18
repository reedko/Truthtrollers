import cytoscape, { NodeSingular } from "cytoscape";

export function animateNode(
  node: NodeSingular,
  options: { position: { x: number; y: number } },
  duration = 200,
): Promise<void> {
  return new Promise((resolve) => {
    // Safety timeout in case animation doesn't complete
    const timeout = setTimeout(() => {
      console.warn("Animation timeout for node:", node.id());
      resolve();
    }, duration + 500);

    node.animate(options, {
      duration,
      easing: "ease-out",
      complete: () => {
        clearTimeout(timeout);
        resolve();
      },
    });
  });
}

export function animateNodes(
  nodes: cytoscape.SingularElementArgument[],
  optionsList: { position: { x: number; y: number } }[],
  duration = 250,
): Promise<void> {
  return new Promise((resolve) => {
    if (nodes.length === 0) {
      resolve();
      return;
    }

    // Safety timeout in case animations don't complete
    const timeout = setTimeout(() => {
      console.warn("Animation timeout for", nodes.length, "nodes");
      resolve();
    }, duration + 1000);

    let finished = 0;
    nodes.forEach((node, i) => {
      node.animate(optionsList[i], {
        duration,
        easing: "ease-out",
        complete: () => {
          finished++;
          if (finished === nodes.length) {
            clearTimeout(timeout);
            resolve();
          }
        },
      });
    });
  });
}

export function startThrobbing(node: any) {
  // Clear any existing throb first
  const existingInterval = node.data("throbInterval");
  if (existingInterval) {
    clearInterval(existingInterval);
  }

  let growing = true;
  const minWidth = node.width();
  const minHeight = node.height();
  const maxWidth = minWidth * 1.07;
  const maxHeight = minHeight * 1.07;
  let throbInterval = setInterval(() => {
    // Check if node still exists before animating
    if (!node || node.removed()) {
      clearInterval(throbInterval);
      return;
    }
    node.animate(
      {
        style: {
          width: growing ? maxWidth : minWidth,
          height: growing ? maxHeight : minHeight,
        },
      },
      {
        duration: 380,
        complete: () => {
          growing = !growing;
        },
      },
    );
  }, 420);
  node.data("throbInterval", throbInterval);
  node.addClass("throb");
}

export function restartAllThrobs(cy: cytoscape.Core, activatedNodeIds: Set<string>) {
  cy.nodes().forEach((node) => {
    if (activatedNodeIds.has(node.id()) && !node.data("throbInterval")) {
      startThrobbing(node);
    }
  });
}
