// src/components/overlays/OverlayRouter.tsx
import React from "react";
import ResponsiveOverlay from "./ResponsiveOverlay";
import { useOverlayStore } from "../../store/useOverlayStore";
import ReferenceClaimsPanel from "./panels/ReferenceClaimsPanel";
import LinkClaimsPanel from "./panels/LinkClaimsPanel";
import VerifyClaimPanel from "./panels/VerifyClaimPanel";

// Each panel is just the body content; router adds header/footer.
export default function OverlayRouter() {
  const { name, payload, close } = useOverlayStore();

  if (!name) return null;

  const map: Record<
    string,
    { title: React.ReactNode; body: React.ReactNode; footer?: React.ReactNode }
  > = {
    "ref-claims": {
      title: payload?.reference?.content_name ?? "Reference",
      body: <ReferenceClaimsPanel reference={payload?.reference} />,
    },
    "link-claims": {
      title: "Link Reference Claim → Task Claim",
      body: <LinkClaimsPanel {...payload} />,
    },
    "verify-claim": {
      title: "Verify Claim",
      body: <VerifyClaimPanel claim={payload?.claim} />,
    },
  };

  const entry = map[name] ?? { title: null, body: null };

  return (
    <ResponsiveOverlay
      isOpen={true}
      onClose={close}
      title={entry.title}
      footer={entry.footer}
      size="xl"
    >
      {entry.body}
    </ResponsiveOverlay>
  );
}
