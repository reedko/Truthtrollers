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
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a combined topic and claim extraction assistant.",
        },
        {
          role: "user",
          content: `
Identify the most general topic (at most two words) for this text, then provide a list of more specific topics under that general topic.
Additionally, extract every distinct factual assertion or claim (statements that can be tested or verified for truth).
Return your answer in valid JSON exactly like this:
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
  let parsed;
  try {
    parsed = JSON.parse(cleanedReply);
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
    return await callOpenAiAnalyze(content);
  }
}
