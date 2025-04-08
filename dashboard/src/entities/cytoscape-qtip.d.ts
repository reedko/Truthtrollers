declare module "cytoscape-qtip" {
  import cytoscape from "cytoscape";

  const qtip: (cy: typeof cytoscape) => void;
  export default qtip;
}

declare namespace cytoscape {
  interface EdgeSingular {
    qtip(opts: any): void;
  }

  interface NodeSingular {
    qtip(opts: any): void;
  }
}
