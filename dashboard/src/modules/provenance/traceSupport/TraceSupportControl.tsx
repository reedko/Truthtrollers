import React from "react";
import { Badge, Box, Button, HStack, Spinner, Text } from "@chakra-ui/react";
import {
  isTraceSupportEnabled,
  loadTraceSupport,
  runTraceSupport,
  type TraceSupportResponse,
} from "./traceSupportClient";
import SupportProvenanceModal from "./SupportProvenanceModal";

interface Props {
  rootContentId?: number;
  parentReferenceContentId?: number;
  evidenceClaimId: number;
}

export default function TraceSupportControl({ rootContentId, parentReferenceContentId, evidenceClaimId }: Props) {
  const [enabled, setEnabled] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [result, setResult] = React.useState<TraceSupportResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let current = true;
    setResult(null);
    setError(null);
    if (!rootContentId || !parentReferenceContentId) return;

    const ids = { rootContentId, parentReferenceContentId, evidenceClaimId };
    isTraceSupportEnabled().then(async (isEnabled) => {
      if (!current || !isEnabled) return;
      setEnabled(true);
      setChecking(true);
      try {
        const saved = await loadTraceSupport(ids);
        if (current && saved.sources.length) setResult(saved);
      } catch (caught: any) {
        if (current) setError(caught?.response?.data?.error || caught?.message || "Saved provenance could not be loaded");
      } finally {
        if (current) setChecking(false);
      }
    });
    return () => { current = false; };
  }, [rootContentId, parentReferenceContentId, evidenceClaimId]);

  if (!enabled || !rootContentId || !parentReferenceContentId) return null;

  const trace = async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    setLoading(true);
    setError(null);
    try {
      const next = await runTraceSupport({ rootContentId, parentReferenceContentId, evidenceClaimId });
      setResult(next);
      setIsOpen(true);
    } catch (caught: any) {
      setError(caught?.response?.data?.error || caught?.message || "Trace Support failed");
    } finally {
      setLoading(false);
    }
  };

  const doubtful = result?.sources.some((source) =>
    source.publicationStatus === "retracted" || source.publicationStatus === "related_work_retracted",
  );
  const unresolved = result?.sources.every((source) =>
    source.resolutionStatus === "cannot_determine" || source.resolutionStatus === "failed" || source.resolutionStatus === "unresolved",
  );
  const titleAgreement = result?.sources
    .map((source) => source.locator?.scholarlyIdentity?.titleAgreement)
    .find((value): value is number => typeof value === "number");

  return (
    <Box mt={2} onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      {result ? (
        <Button size="xs" variant="outline" colorScheme={doubtful ? "orange" : unresolved ? "yellow" : "cyan"} onClick={() => setIsOpen(true)}>
          <HStack spacing={2}>
            <Text>{doubtful ? "⚠ Support Provenance" : "Support Provenance"}</Text>
            <Badge colorScheme={doubtful ? "red" : unresolved ? "yellow" : "cyan"} fontSize="8px">
              {doubtful ? "doubtful" : unresolved ? "unresolved" : "traced"}
            </Badge>
            {typeof titleAgreement === "number" && <Badge colorScheme="orange" variant="outline" fontSize="8px">{Math.round(titleAgreement * 100)}% title match</Badge>}
          </HStack>
        </Button>
      ) : (
        <Button size="xs" variant="outline" colorScheme="cyan" onClick={trace} isDisabled={loading || checking}>
          {loading || checking ? <HStack spacing={2}><Spinner size="xs" /><Text>{loading ? "Tracing support…" : "Checking provenance…"}</Text></HStack> : "Trace Support"}
        </Button>
      )}
      {error && <Text mt={1} fontSize="10px" color="red.300">{error}</Text>}
      {result && <SupportProvenanceModal isOpen={isOpen} onClose={() => setIsOpen(false)} result={result} evidenceClaimId={evidenceClaimId} isRefreshing={loading} onRefresh={() => trace()} />}
    </Box>
  );
}
