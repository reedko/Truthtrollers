import { parseOrRepairJSON, GptJson } from "../utils/repairJson";

const apiKey = process.env.REACT_APP_OPENAI_API_KEY;

async function callOpenAiAnalyze(content: string): Promise<{
  generalTopic: string;
  specificTopics: string[];
  claims: string[];
}> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: "You are a combined topic and claim extraction assistant.",
        },
        {
          role: "user",
          content: `
You are a fact-checking assistant.

First, identify the most general topic (max 2 words) for this text.
Then, list more specific subtopics under that topic (2 to 5).
Next, extract every distinct factual assertion or claim — especially those with numbers, statistics, or timelines. 
Avoid generalizations or summaries. Do not combine multiple claims. 
Each claim must be independently verifiable and phrased as a full sentence.

Return your answer in strict JSON like this:
{
  "generalTopic": "<string>",
  "specificTopics": ["<string>", "<string>"],
  "claims": ["<claim1>", "<claim2>", ...]
}

Text:
${content}
          `,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("No completion returned from OpenAI");
  }

  const rawReply = data.choices[0].message.content.trim();
  console.log(rawReply);
  // Strip GPT's triple backticks if present
  let cleanedReply = rawReply.trim();
  if (cleanedReply.startsWith("```json")) {
    cleanedReply = cleanedReply
      .replace(/^```json/, "")
      .replace(/```$/, "")
      .trim();
  }

  // Attempt to parse the JSON
  let parsed: GptJson;
  try {
    parsed = parseOrRepairJSON(cleanedReply);
  } catch (err) {
    console.error("Invalid JSON from GPT:", cleanedReply);
    throw new Error("GPT returned invalid JSON");
  }

  return {
    generalTopic: parsed.generalTopic || "Unknown",
    specificTopics: Array.isArray(parsed.specificTopics)
      ? parsed.specificTopics
      : [],
    claims: Array.isArray(parsed.claims) ? parsed.claims : [],
  };
}

export async function analyzeContent(content: string): Promise<{
  generalTopic: string;
  specificTopics: string[];
  claims: string[];
}> {
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    // ✅ Inside Extension (Keep old logic for now)
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: "analyzeContent",
          content,
        },
        (response) => {
          if (response && response.success) {
            resolve(response.data);
          } else {
            const errorMsg =
              response?.error || "Failed to analyze content in background";
            reject(new Error(errorMsg));
          }
        }
      );
    });
  } else {
    // ✅ Running outside extension (Use local function)
    console.warn("⚠️ Running outside extension, calling OpenAI API directly.");
    console.log(content);
    return await callOpenAiAnalyze(content);
  }
}
