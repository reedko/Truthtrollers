import { api } from "../../../services/api";

export interface TraceSupportSource {
  traceId: number;
  traceRunId?: string;
  resolutionStatus: "cannot_determine" | "identified" | "resolved" | "acquired" | "unresolved" | "failed";
  sourceLabel: string | null;
  sourceUrl: string | null;
  doi: string | null;
  pmid: string | null;
  citationText: string | null;
  locator: null | {
    contextSource?: string;
    depth?: number;
    sourceLineage?: {
      lineageType?: string;
      upstreamUrl?: string | null;
      chainDepth?: number;
      confidence?: string;
    } | null;
    originalUrl?: string | null;
    scholarlyIdentity?: {
      matchKind?: "exact" | "related" | "none";
      confidence?: string;
      titleAgreement?: number;
      title?: string | null;
      authors?: string[];
      pmid?: string | null;
      doi?: string | null;
      canonicalUrl?: string | null;
      queryUsed?: string;
      identity?: {
        title?: string | null;
        author?: string | null;
        pageCountInspected?: number;
      };
    } | null;
    publicationNotice?: {
      pmid?: string | null;
      doi?: string | null;
      url?: string | null;
      citation?: string | null;
      reason?: string | null;
    } | null;
  };
  explanation: string | null;
  publicationStatus: string;
  statusSource: string | null;
  child: null | {
    contentId: number;
    title: string;
    url: string;
    publisher: string | null;
    isRetracted: boolean;
  };
  createdAt?: string;
}

export interface TraceSupportResponse {
  status: string;
  sources: TraceSupportSource[];
}

let enabledRequest: Promise<boolean> | null = null;

export function isTraceSupportEnabled() {
  enabledRequest ||= api
    .get<{ enabled: boolean }>("/api/trace-support/status")
    .then((response) => Boolean(response.data.enabled))
    .catch(() => false);
  return enabledRequest;
}

export async function loadTraceSupport(ids: {
  rootContentId: number;
  parentReferenceContentId: number;
  evidenceClaimId: number;
}) {
  const response = await api.get<TraceSupportResponse>(
    `/api/reference-claims/${ids.evidenceClaimId}/trace-support`,
    { params: ids },
  );
  return response.data;
}

export async function runTraceSupport(ids: {
  rootContentId: number;
  parentReferenceContentId: number;
  evidenceClaimId: number;
}) {
  const response = await api.post<TraceSupportResponse>(
    `/api/reference-claims/${ids.evidenceClaimId}/trace-support`,
    { ...ids, force: true },
  );
  return response.data;
}
