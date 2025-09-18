// src/components/overlays/OverlayRouter.tsx
import React from "react";
import ResponsiveOverlay from "./ResponsiveOverlay";
import { useOverlayStore } from "../../store/useOverlayStore";
import { useTaskStore } from "../../store/useTaskStore"; // 👈 add this
import ReferenceClaimsPanel from "./panels/ReferenceClaimsPanel";
import LinkClaimsPanel from "./panels/LinkClaimsPanel";
import VerifyClaimPanel from "./panels/VerifyClaimPanel";

// Each panel is just the body content; router adds header/footer.
export default function OverlayRouter() {
  const { name, payload, close } = useOverlayStore();
  const selectedTask = useTaskStore((s) => s.selectedTask); // 👈 from store
  const viewerIdFromStore = useTaskStore((s) => s.viewingUserId); // 👈 from store

  if (!name) return null;

  // Resolve the two troublemakers with sensible fallbacks
  const contentId =
    payload?.contentId ??
    selectedTask?.content_id ??
    payload?.claim?.content_id ??
    payload?.reference?.reference_content_id; // last-ditch if coming from a reference

  const viewerId = payload?.viewerId ?? viewerIdFromStore ?? null;

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
      body: contentId ? (
        <VerifyClaimPanel
          claim={payload?.claim}
          contentId={contentId}
          viewerId={viewerId}
          defaultVerdict={payload?.defaultVerdict}
          defaultConfidence={payload?.defaultConfidence}
          defaultNotes={payload?.defaultNotes}
        />
      ) : (
        <div style={{ padding: 12 }}>Missing contentId for verification.</div>
      ),
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
