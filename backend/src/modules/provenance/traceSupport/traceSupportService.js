import { createHash, randomUUID } from "node:crypto";
import { scrapeReference } from "../../../core/scrapeReference.js";
import { fetchExternalPageContent } from "../../../utils/fetchExternalPageContent.js";
import { resolveSourceLineage } from "../../../../services/sourceLineageResolver.js";
import { lookupPubMedPublicationStatus } from "../../../core/pubmedSearch.js";
import { collectRelevantPdfCandidates, loadTraceSupportContext } from "./traceSupportContext.js";
import { identifyTraceSupport } from "./traceSupportModel.js";
import { resolveTraceSource } from "./traceSupportResolver.js";
import { resolvePdfScholarlyIdentity } from "./traceSupportScholarlyResolver.js";
import {
  findContentByUrl,
  insertTraceRows,
  loadLatestTrace,
  loadTraceSubject,
} from "./traceSupportRepository.js";

export function traceSupportEnabled(env = process.env) {
  return String(env.EVIDENCE_ASSERTION_TRACE_SUPPORT || "false").toLowerCase() === "true";
}

function fingerprint(context) {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

async function acquireSource(query, source) {
  const existing = await findContentByUrl(query, source.url);
  if (existing) return existing;

  const fetched = await fetchExternalPageContent(source.url);
  const rawHtml = fetched.$.html();
  const scraped = await scrapeReference(query, {
    url: source.url,
    raw_html: rawHtml,
    title: source.label || fetched.pdfMeta?.title,
    taskContentId: null,
  });
  if (!scraped?.referenceContentId) throw new Error("The identified source could not be acquired");
  await query(`UPDATE content SET content_text = ? WHERE content_id = ?`, [scraped.text, scraped.referenceContentId]);
  return {
    content_id: scraped.referenceContentId,
    content_name: scraped.title,
    url: scraped.url,
    media_source: scraped.publisher?.name || null,
    is_retracted: 0,
  };
}

export function createTraceSupportService(dependencies = {}) {
  const identify = dependencies.identify || identifyTraceSupport;
  const resolve = dependencies.resolve || resolveTraceSource;
  const resolveScholarlyIdentity = dependencies.resolveScholarlyIdentity || resolvePdfScholarlyIdentity;
  const loadContext = dependencies.loadContext || loadTraceSupportContext;
  const acquire = dependencies.acquire || acquireSource;
  const resolveLineage = dependencies.resolveLineage || resolveSourceLineage;
  const lookupPublicationStatus = dependencies.lookupPublicationStatus || lookupPubMedPublicationStatus;

  return {
    async get(query, ids) {
      return loadLatestTrace(query, ids);
    },

    async run(query, { rootContentId, parentReferenceContentId, evidenceClaimId, userId, force = false }) {
      if (!force) {
        const cached = await loadLatestTrace(query, { rootContentId, parentReferenceContentId, evidenceClaimId });
        if (cached?.length) return cached;
      }

      const subject = await loadTraceSubject(query, { rootContentId, parentReferenceContentId, evidenceClaimId });
      if (!subject) {
        const error = new Error("Evidence assertion was not found on this case reference");
        error.statusCode = 404;
        throw error;
      }

      const context = await loadContext({ content: subject, assertion: subject.claim_text });
      const modelResult = await identify({ query, assertion: subject.claim_text, context });
      const deterministicPdfSources = collectRelevantPdfCandidates(context, subject.claim_text)
        .map((candidate) => ({
          label: candidate.label || "Linked PDF evidence",
          url: candidate.url,
          doi: null,
          pmid: null,
          citationText: candidate.citationText || null,
          explanation: "A direct PDF link appears in assertion-relevant document context.",
        }));
      const sourcesByUrl = new Map();
      for (const source of [...(modelResult.sources || []), ...deterministicPdfSources]) {
        const key = String(source.url || source.doi || source.pmid || source.label || "").toLowerCase();
        if (key && !sourcesByUrl.has(key)) sourcesByUrl.set(key, source);
      }
      const identifiedSources = [...sourcesByUrl.values()].slice(0, 6);
      const traceRunId = randomUUID();
      const contextFingerprint = fingerprint(context);

      if (!identifiedSources.length) {
        await insertTraceRows(query, [{
          traceRunId, rootContentId, parentReferenceContentId, evidenceClaimId,
          sourceOrdinal: 0, resolutionStatus: "cannot_determine",
          explanation: modelResult.explanation, contextFingerprint, createdByUserId: userId,
        }]);
        return loadLatestTrace(query, { rootContentId, parentReferenceContentId, evidenceClaimId });
      }

      const stored = [];
      for (const [index, candidate] of identifiedSources.entries()) {
        let source = await resolve({ source: candidate, context });
        let child = null;
        let failure = null;
        let sourceLineage = null;
        let scholarlyIdentity = null;
        let publicationNotice = null;
        if (source.resolutionStatus === "resolved" && source.url) {
          try {
            if (/\.pdf(?:$|[?#])/i.test(source.url)) {
              try {
                scholarlyIdentity = await resolveScholarlyIdentity(source);
              } catch {
                // A bibliographic lookup miss must not prevent the existing
                // full acquisition fallback from tracing the source.
                scholarlyIdentity = null;
              }
            }

            if (scholarlyIdentity?.matchKind === "exact" || scholarlyIdentity?.matchKind === "related") {
              source = {
                ...source,
                doi: scholarlyIdentity.doi || source.doi,
                pmid: scholarlyIdentity.pmid || source.pmid,
                resolutionStatus: "resolved",
              };
            } else {
              child = await acquire(query, source);
              source = { ...source, resolutionStatus: "acquired" };
            }
            sourceLineage = await resolveLineage(source.url, { query });
          } catch (error) {
            failure = error.message;
            source = { ...source, resolutionStatus: "failed" };
          }
        }
        let publicationStatus = child?.is_retracted ? "retracted" : "unknown";
        let statusSource = child?.is_retracted ? "legacy_content_flag" : null;
        if (source.pmid) {
          const pubmedStatus = await lookupPublicationStatus(source.pmid);
          publicationStatus = pubmedStatus.status;
          statusSource = pubmedStatus.source;
          publicationNotice = pubmedStatus.retractionNotice || null;
          if (
            publicationStatus === "retracted" &&
            scholarlyIdentity?.matchKind === "related"
          ) {
            publicationStatus = "related_work_retracted";
          }
        }
        const identityExplanation = scholarlyIdentity?.matchKind === "related"
          ? `PubMed found no exact record for the PDF title "${scholarlyIdentity.identity?.title}". A title-and-author search found the related earlier work "${scholarlyIdentity.title}".`
          : scholarlyIdentity?.matchKind === "exact"
            ? `The PDF title matched the PubMed record "${scholarlyIdentity.title}".`
            : "";
        stored.push({
          traceRunId, rootContentId, parentReferenceContentId, evidenceClaimId,
          supportingReferenceContentId: child?.content_id || null,
          sourceOrdinal: index + 1, resolutionStatus: source.resolutionStatus,
          sourceLabel: source.label, sourceUrl: source.url, doi: source.doi,
          pmid: source.pmid, citationText: source.citationText,
          locator: {
            contextSource: context.contextSource,
            depth: 1,
            sourceLineage,
            originalUrl: source.url,
            scholarlyIdentity,
            publicationNotice,
          },
          explanation: [
            source.explanation,
            identityExplanation,
            failure ? `Acquisition failed: ${failure}` : null,
          ].filter(Boolean).join(" "),
          publicationStatus,
          statusSource,
          contextFingerprint, createdByUserId: userId,
        });
      }
      await insertTraceRows(query, stored);
      return loadLatestTrace(query, { rootContentId, parentReferenceContentId, evidenceClaimId });
    },
  };
}
