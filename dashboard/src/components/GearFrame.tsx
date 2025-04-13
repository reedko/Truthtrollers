// src/components/GearFrame.tsx
import React from "react";
import { CustomSegmentLabelPosition } from "react-d3-speedometer";

const GearFrame = ({ children }: { children: React.ReactNode }) => {
  return (
    <div
      style={{
        backgroundImage: "url('/assets/gear-frame.svg')",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
        padding: "20px",
      }}
    >
      {children}
    </div>
  );
};

export default GearFrame;
