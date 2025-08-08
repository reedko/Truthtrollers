const BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";

export async function analyzeContent(
  content: string,
  testimonials?: { text: string; name?: string; imageUrl?: string }[]
): Promise<{
  generalTopic: string;
  specificTopics: string[];
  claims: string[];
  testimonials: { text: string; name?: string; imageUrl?: string }[];
}> {
  console.log(content, "::::CONTNET");
  const res = await fetch(`${BASE_URL}/api/analyze-content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, testimonials }),
  });
  const data = await res.json();
  return {
    generalTopic: data.generalTopic || "Unknown",
    specificTopics: Array.isArray(data.specificTopics)
      ? data.specificTopics
      : [],
    claims: Array.isArray(data.claims) ? data.claims : [],
    testimonials: Array.isArray(data.testimonials) ? data.testimonials : [],
  };
}
