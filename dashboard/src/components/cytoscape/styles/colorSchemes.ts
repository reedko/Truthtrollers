export interface ColorScheme {
  bg: string;
  border: string;
  text: string;
  glow: string;
  titleBg: string;
  leftEdge: string;
}

export type NodeType =
  | "task"
  | "reference"
  | "unifiedClaim"
  | "refClaim"
  | "taskClaim"
  | "caseClaim"
  | "author"
  | "publisher";

export const colorSchemes: Record<NodeType, ColorScheme> = {
  task: {
    bg: "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.05))",
    border: "rgba(99, 102, 241, 0.25)",
    text: "#a5b4fc",
    glow: "0 0 20px rgba(99, 102, 241, 0.2)",
    titleBg: "rgba(99, 102, 241, 0.15)",
    leftEdge:
      "linear-gradient(90deg, rgba(99, 102, 241, 0.4) 0%, rgba(99, 102, 241, 0) 100%)",
  },
  reference: {
    bg: "linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(5, 150, 105, 0.05))",
    border: "rgba(16, 185, 129, 0.25)",
    text: "#6ee7b7",
    glow: "0 0 20px rgba(16, 185, 129, 0.2)",
    titleBg: "rgba(16, 185, 129, 0.15)",
    leftEdge:
      "linear-gradient(90deg, rgba(16, 185, 129, 0.4) 0%, rgba(16, 185, 129, 0) 100%)",
  },
  unifiedClaim: {
    bg: "linear-gradient(135deg, rgba(249, 115, 22, 0.06), rgba(234, 88, 12, 0.04))",
    border: "rgba(249, 115, 22, 0.2)",
    text: "#fed7aa",
    glow: "0 0 15px rgba(249, 115, 22, 0.15)",
    titleBg: "rgba(249, 115, 22, 0.12)",
    leftEdge:
      "linear-gradient(90deg, rgba(249, 115, 22, 0.3) 0%, rgba(249, 115, 22, 0) 100%)",
  },
  refClaim: {
    bg: "linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(5, 150, 105, 0.05))",
    border: "rgba(16, 185, 129, 0.25)",
    text: "#6ee7b7",
    glow: "0 0 20px rgba(16, 185, 129, 0.2)",
    titleBg: "rgba(16, 185, 129, 0.15)",
    leftEdge:
      "linear-gradient(90deg, rgba(16, 185, 129, 0.4) 0%, rgba(16, 185, 129, 0) 100%)",
  },
  taskClaim: {
    bg: "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.05))",
    border: "rgba(99, 102, 241, 0.25)",
    text: "#a5b4fc",
    glow: "0 0 20px rgba(99, 102, 241, 0.2)",
    titleBg: "rgba(99, 102, 241, 0.15)",
    leftEdge:
      "linear-gradient(90deg, rgba(99, 102, 241, 0.4) 0%, rgba(99, 102, 241, 0) 100%)",
  },
  caseClaim: {
    bg: "linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(124, 58, 237, 0.06))",
    border: "rgba(139, 92, 246, 0.3)",
    text: "#c4b5fd",
    glow: "0 0 25px rgba(139, 92, 246, 0.25)",
    titleBg: "rgba(139, 92, 246, 0.18)",
    leftEdge:
      "linear-gradient(90deg, rgba(139, 92, 246, 0.5) 0%, rgba(139, 92, 246, 0) 100%)",
  },
  author: {
    bg: "linear-gradient(135deg, rgba(251, 177, 160, 0.08), rgba(254, 215, 170, 0.05))",
    border: "rgba(251, 177, 160, 0.25)",
    text: "#fecaca",
    glow: "0 0 20px rgba(251, 177, 160, 0.2)",
    titleBg: "rgba(251, 177, 160, 0.15)",
    leftEdge:
      "linear-gradient(90deg, rgba(251, 177, 160, 0.4) 0%, rgba(251, 177, 160, 0) 100%)",
  },
  publisher: {
    bg: "linear-gradient(135deg, rgba(129, 236, 236, 0.08), rgba(103, 232, 249, 0.05))",
    border: "rgba(129, 236, 236, 0.25)",
    text: "#a5f3fc",
    glow: "0 0 20px rgba(129, 236, 236, 0.2)",
    titleBg: "rgba(129, 236, 236, 0.15)",
    leftEdge:
      "linear-gradient(90deg, rgba(129, 236, 236, 0.4) 0%, rgba(129, 236, 236, 0) 100%)",
  },
};

export const getColorScheme = (type: string): ColorScheme => {
  return colorSchemes[type as NodeType] || colorSchemes.reference;
};
