// backend/src/routes/analyzeContent.js
// Route to extract topics and claims from text (with chunking support)
import { Router } from "express";
import logger from "../utils/logger.js";
import { encoding_for_model } from "tiktoken";
import dotenv from "dotenv";

dotenv.config();

const router = Router();
const MAX_TOKENS = 12000;
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;

/**
 * Parse or repair JSON response from OpenAI
 */
function parseOrRepairJSON2(input) {
  try {
    return JSON.parse(input);
  } catch (err) {
    logger.warn("⚠️ Failed to parse JSON, attempting repair:", err.message);

    // Try to extract JSON from markdown code blocks
    const match = input.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (e) {
        // Continue to fallback
      }
    }

    // Fallback: return empty structure
    return {
      generalTopic: "Unknown",
      specificTopics: [],
      claims: [],
      testimonials: [],
    };
  }
}

/**
 * Analyze a single chunk of content
 */
async function callOpenAiAnalyzeSingleChunk(chunk, testimonials) {
  const testimonialsText =
    testimonials?.length > 0
      ? `
Below is a list of testimonials detected by an extractor. Please consider these, and deduplicate or improve them if they also appear in the main article text.

Extracted testimonials:
${JSON.stringify(testimonials, null, 2)}
`
      : "";

  const messages = [
    {
      role: "system",
      content:
        "You are a combined topic, claim, and testimonial extraction assistant.",
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

Also, extract any testimonials or first-person case studies in the text (phrases such as "I used this and it worked for me," or "Bobby used this method and made $20 billion"), and try to include a name or image URL if present. Testimonials must be objects: { "text": "...", "name": "...", "imageUrl": "..." } (name and imageUrl are optional).

${testimonialsText}

Return your answer in strict JSON like this:
{
  "generalTopic": "<string>",
  "specificTopics": ["<string>", "<string>"],
  "claims": ["<claim1>", "<claim2>", ...],
  "testimonials": [
    { "text": "<testimonial1>", "name": "<optional>", "imageUrl": "<optional>" },
    ...
  ]
}

Text:
${chunk}
`,
    },
  ];

  const body = {
    model: "gpt-4o-mini",
    messages,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();

  if (!response.ok) {
    logger.error("❌ OpenAI API error", response.status, raw.slice(0, 500));
    throw new Error(`OpenAI API error: ${response.status} - ${raw}`);
  }

  try {
    const json = JSON.parse(raw);
    let reply = json.choices?.[0]?.message?.content?.trim() || "";

    // 🧼 Strip markdown code block if present
    if (reply.startsWith("```json")) {
      reply = reply
        .replace(/^```json\s*/, "")
        .replace(/```$/, "")
        .trim();
    }

    const parsed = parseOrRepairJSON2(reply);
    return parsed;
  } catch (e) {
    logger.error("❌ Failed to parse or repair assistant message:", raw);
    throw new Error(
      "Could not parse or repair assistant response: " + e.message
    );
  }
}

/**
 * Analyze content in chunks (split by paragraphs)
 */
async function analyzeInChunks(content, testimonials) {
  const tokenizer = encoding_for_model("gpt-4");
  const paragraphs = content.split(/\n\s*\n/);
  let currentChunk = "";
  let chunkList = [];

  for (let para of paragraphs) {
    const testChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
    const tokens = tokenizer.encode(testChunk);
    if (tokens.length > MAX_TOKENS) {
      if (currentChunk) chunkList.push(currentChunk);
      currentChunk = para;
    } else {
      currentChunk = testChunk;
    }
  }
  if (currentChunk) chunkList.push(currentChunk);

  logger.log(`📦 Sending ${chunkList.length} chunk(s) to GPT-4`);

  let allClaims = [];
  let allTestimonials = [];
  let generalTopicCounts = {};
  let specificTopicsCounts = {};

  for (let i = 0; i < chunkList.length; i++) {
    const chunk = chunkList[i];
    const tokenLength = tokenizer.encode(chunk).length;
    logger.log(
      `🔹 Chunk ${i + 1}/${chunkList.length} (${tokenLength} tokens)`
    );

    try {
      const result = await callOpenAiAnalyzeSingleChunk(chunk, testimonials);

      if (result.claims) allClaims.push(...result.claims);
      if (result.testimonials) allTestimonials.push(...result.testimonials);

      if (result.generalTopic) {
        generalTopicCounts[result.generalTopic] =
          (generalTopicCounts[result.generalTopic] || 0) + 1;
      }

      if (Array.isArray(result.specificTopics)) {
        for (let topic of result.specificTopics) {
          specificTopicsCounts[topic] = (specificTopicsCounts[topic] || 0) + 1;
        }
      }
    } catch (err) {
      logger.warn(`⚠️ Error in chunk ${i + 1}:`, err.message);
    }
  }

  tokenizer.free();

  const generalTopic =
    Object.entries(generalTopicCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    "";
  const specificTopics = Object.entries(specificTopicsCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);

  return {
    generalTopic,
    specificTopics,
    claims: [...new Set(allClaims)],
    testimonials: allTestimonials,
  };
}

/**
 * POST /api/analyze-content
 * Extract topics and claims from content text
 */
router.post("/", async (req, res) => {
  const { content, testimonials } = req.body;

  if (!content) {
    return res.status(400).json({ error: "Missing 'content' in request body" });
  }

  try {
    logger.log(`🔍 [/api/analyze-content] Analyzing ${content.length} chars`);

    const results = await analyzeInChunks(content, testimonials);

    logger.log(`✅ [/api/analyze-content] Extracted ${results.claims.length} claims, ${results.specificTopics.length} topics`);

    res.json(results);
  } catch (err) {
    logger.error("❌ Error during analysis:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
