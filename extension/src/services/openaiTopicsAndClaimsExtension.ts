import browser from "webextension-polyfill";

interface Testimonial {
  text: string;
  name?: string;
  imageUrl?: string | null;
}

interface AnalyzeContentResponse {
  success: boolean;
  data?: {
    generalTopic: string;
    specificTopics: string[];
    claims: string[];
    testimonials: { text: string; name?: string; imageUrl?: string }[];
  };
  error?: string;
}

export async function analyzeContent(
  content: string,
  testimonials?: { text: string; name?: string; imageUrl?: string }[]
): Promise<{
  generalTopic: string;
  specificTopics: string[];
  claims: string[];
  testimonials: { text: string; name?: string; imageUrl?: string }[];
}> {
  try {
    const response = (await browser.runtime.sendMessage({
      action: "analyzeContent",
      content,
      testimonials, // <--- Pass to background
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
