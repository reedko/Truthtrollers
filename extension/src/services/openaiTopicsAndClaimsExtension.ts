import browser from "webextension-polyfill";
import type {
  Lit_references,
  Testimonial,
  ClaimSourcePick,
  AnalyzeContentOptions,
  AnalyzeContentResponse,
} from "../entities/Task";

export async function analyzeContent(
  content: string,
  testimonials?: { text: string; name?: string; imageUrl?: string }[],
  options: AnalyzeContentOptions = {}
): Promise<{
  generalTopic: string;
  specificTopics: string[];
  claims: string[];
  testimonials: Testimonial[];
  claimSourcePicks: ClaimSourcePick[];
  evidenceRefs: Lit_references[];
}> {
  try {
    const response = (await browser.runtime.sendMessage({
      action: "analyzeContent",
      content,
      testimonials, // <--- Pass to background
      includeEvidence: options.includeEvidence === true,
    })) as AnalyzeContentResponse;

    if (response.success && response.data) {
      return {
        generalTopic: response.data.generalTopic || "Unknown",
        specificTopics: Array.isArray(response.data.specificTopics)
          ? response.data.specificTopics
          : [],
        claims: Array.isArray(response.data.claims) ? response.data.claims : [],
        testimonials: Array.isArray(response.data.testimonials)
          ? response.data.testimonials
          : [],
        claimSourcePicks: Array.isArray(response.data.claimSourcePicks)
          ? response.data.claimSourcePicks
          : [],
        evidenceRefs: Array.isArray(response.data.evidenceRefs)
          ? response.data.evidenceRefs
          : [],
      };
    } else {
      const errorMsg =
        response.error || "Failed to analyze content in background";
      throw new Error(errorMsg);
    }
  } catch (err) {
    console.error("❌ Error in analyzeContent:", err);
    throw err;
  }
}
