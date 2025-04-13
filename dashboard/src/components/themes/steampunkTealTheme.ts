// src/theme/steampunkTealTheme.ts
import { CustomSegmentLabelPosition } from "react-d3-speedometer";
const API_BASE_URL = import.meta.env.VITE_BASE_URL || "https://localhost:5001";

export const steampunkTealTheme = {
  colors: {
    background: "#2F2F2F",
    brass: "#B08D57",
    teal: "#2C7A7B",
    verdigris: "#4ECDC4",
    parchment: "#F4E2D8",
    highlight: "#FFD700",
    red: "#8B0000",
    rusty: "#D2691E",
    yellow: "#C4BE54",
    green: "#0F7729",
  },
  segmentColors: [
    "#8B0000", // Debunked
    "#D2691E", // Sketchy
    "#F4E2D8", // Mixed
    "#4ECDC4", // Truthy
    "#12631f", // Confirmed
  ],
  segmentColors2: [
    "#8B0000", // Debunked
    "#D2691E", // Sketchy
    "#F4E2D8", // Mixed
    "#4ECDC4", // Truthy
    "#12631f", // Confirmed
    "#8B0000", // Debunked
    "#D2691E", // Sketchy
    "#F4E2D8", // Mixed
    "#4ECDC4", // Truthy
    "#12631f", // Confirmed
  ],
  segmentLabels: [
    {
      text: "FALSE",
      position: CustomSegmentLabelPosition.Inside,
      color: "#fff",
      fontSize: "14px",
    },
    {
      text: "Sketchy",
      position: CustomSegmentLabelPosition.Inside,
      color: "#fff",
      fontSize: "11px",
    },
    {
      text: "Mixed",
      position: CustomSegmentLabelPosition.Inside,
      color: "#333",
      fontSize: "11px",
    },
    {
      text: "Truthy",
      position: CustomSegmentLabelPosition.Inside,
      color: "#002",
      fontSize: "11px",
    },
    {
      text: "TRUE",
      position: CustomSegmentLabelPosition.Inside,
      color: "#000",
      fontSize: "14px",
    },
  ],
  segmentLabels2: [
    {
      text: "Debunked",
      position: CustomSegmentLabelPosition.Inside,
      color: "#fff",
      fontSize: "5px",
    },
    {
      text: "Sketchy",
      position: CustomSegmentLabelPosition.Inside,
      color: "#fff",
      fontSize: "5px",
    },
    {
      text: "Mixed",
      position: CustomSegmentLabelPosition.Inside,
      color: "#333",
      fontSize: "5px",
    },
    {
      text: "Truthy",
      position: CustomSegmentLabelPosition.Inside,
      color: "#002",
      fontSize: "5px",
    },
    {
      text: "Confirmed",
      position: CustomSegmentLabelPosition.Inside,
      color: "#000",
      fontSize: "5px",
    },
    {
      text: "Debunked",
      position: CustomSegmentLabelPosition.Inside,
      color: "#fff",
      fontSize: "5px",
    },
    {
      text: "Sketchy",
      position: CustomSegmentLabelPosition.Inside,
      color: "#fff",
      fontSize: "5px",
    },
    {
      text: "Mixed",
      position: CustomSegmentLabelPosition.Inside,
      color: "#333",
      fontSize: "5px",
    },
    {
      text: "Truthy",
      position: CustomSegmentLabelPosition.Inside,
      color: "#002",
      fontSize: "5px",
    },
    {
      text: "Confirmed",
      position: CustomSegmentLabelPosition.Inside,
      color: "#000",
      fontSize: "5px",
    },
  ],
  textures: {
    backgroundImage: `${API_BASE_URL}/assets/images/textures/bronze-plate-texture.png`, // ensure it's in your public folder
    frameOverlay: `${API_BASE_URL}/assets/images/textures/gear-frame2b.png`,
    trollOverlay: `${API_BASE_URL}/assets/images/textures/gear-frame3.png`,
  },
  sharedStyles: {
    panel: {
      border: "4px solid #B08D57",
      borderRadius: "12px",
      backgroundImage: `url('/assets/bronze-plate-texture.jpg')`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      boxShadow: "0 0 12px rgba(0, 0, 0, 0.6)",
      color: "#F4E2D8",
      padding: "16px",
    },
  },
};
