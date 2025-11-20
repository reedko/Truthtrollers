// backend/core/claims.js

export class ClaimExtractor {
  constructor(llm) {
    this.llm = llm; // expects { generate({ system, user, schemaHint, temperature }) }
  }

  async analyzeChunk({
    chunk,
    tokenLength,
    includeTopicsAndTestimonials = false,
    incomingTestimonials,
  }) {
    // modest, dynamic bounds
    let minClaims = 5;
    let maxClaims = 12;

    if (tokenLength > 2500 && tokenLength <= 5000) {
      minClaims = 8;
      maxClaims = 16;
    } else if (tokenLength > 5000 && tokenLength <= 9000) {
      minClaims = 12;
      maxClaims = 24;
    } else if (tokenLength > 9000) {
      minClaims = 16;
      maxClaims = 30;
    }

    const testimonialsText =
      includeTopicsAndTestimonials &&
      incomingTestimonials &&
      incomingTestimonials.length > 0
        ? `Below is a list of testimonials detected elsewhere. Deduplicate or improve them if they also appear in this text.\n\nExtracted testimonials:\n${JSON.stringify(
            incomingTestimonials
          )}\n`
        : "";

    const system =
      "You are a precise claim extraction assistant. You must return strictly valid JSON.";

    const tasks = includeTopicsAndTestimonials
      ? `
TASKS
1) Identify the single most general topic (max 2 words).
2) List 2–5 specific subtopics under that topic.
3) Extract DISTINCT factual claims from the text.
   - Return AT LEAST ${minClaims} and AT MOST ${maxClaims} claims, if available.
   - Each claim must be independently verifiable, one atomic assertion per item.
   - Prefer claims with numbers, dates, named entities, locations, or concrete actions.
   - Avoid duplicates, paraphrases, opinions, or vague summaries.
   - Phrase each claim as a full sentence.
4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").
   - Deduplicate against the main text if overlapping.
`
      : `
TASKS
1) Extract DISTINCT factual claims from the text ONLY.
   - Return AT LEAST ${minClaims} and AT MOST ${maxClaims} claims, if available.
   - Each claim must be independently verifiable, one atomic assertion per item.
   - Prefer claims with numbers, dates, named entities, locations, or concrete actions.
   - Avoid duplicates, paraphrases, opinions, or vague summaries.
   - Phrase each claim as a full sentence.
2) Do NOT invent topics or testimonials in this mode.
`;

    const outputShape = `
OUTPUT (STRICT JSON):
{
  "generalTopic": "<string>",
  "specificTopics": ["<string>", "<string>"],
  "claims": ["<claim1>", "<claim2>", ...],
  "testimonials": [
    { "text": "<testimonial1>", "name": "<optional>", "imageUrl": "<optional>" }
  ]
}
`.trim();

    const user = `
You are a fact-checking assistant.
${tasks}

${includeTopicsAndTestimonials ? outputShape : ""}

${testimonialsText}

TEXT:
${chunk}
`.trim();

    const schemaHint =
      '{"generalTopic":"","specificTopics":[],"claims":[],"testimonials":[{"text":"","name":"","imageUrl":""}]}';

    const out = await this.llm.generate({
      system,
      user,
      schemaHint,
      temperature: 0.2,
    });

    // Post-process: dedupe & clamp
    const rawClaims = Array.isArray(out.claims) ? out.claims : [];
    const seen = new Set();
    const deduped = [];

    for (const c of rawClaims) {
      const norm = String(c || "")
        .trim()
        .replace(/\s+/g, " ");
      if (norm && !seen.has(norm.toLowerCase())) {
        seen.add(norm.toLowerCase());
        deduped.push(norm);
      }
    }

    const finalClaims = deduped.slice(0, maxClaims);

    const finalTestimonials =
      Array.isArray(out.testimonials) && includeTopicsAndTestimonials
        ? out.testimonials.slice(0, 20)
        : [];

    return {
      generalTopic: includeTopicsAndTestimonials ? out.generalTopic || "" : "",
      specificTopics:
        includeTopicsAndTestimonials && Array.isArray(out.specificTopics)
          ? out.specificTopics.slice(0, 5)
          : [],
      claims: finalClaims,
      testimonials: finalTestimonials,
    };
  }

  async analyzeContent({
    chunks,
    existingTestimonials = [],
    maxConcurrency = 3,
  }) {
    if (!chunks || chunks.length === 0) {
      return {
        generalTopic: "",
        specificTopics: [],
        claims: [],
        testimonials: [],
      };
    }

    const allClaims = [];
    let generalTopic = "";
    let specificTopics = [];
    let testimonials = [...existingTestimonials];

    let index = 0;

    const runNext = async () => {
      const i = index++;
      if (i >= chunks.length) return;
      const isFirst = i === 0;
      const chunk = chunks[i];

      const res = await this.analyzeChunk({
        chunk: chunk.text,
        tokenLength: chunk.tokenLength,
        includeTopicsAndTestimonials: isFirst,
        incomingTestimonials: testimonials,
      });

      if (isFirst) {
        generalTopic = res.generalTopic;
        specificTopics = res.specificTopics;
        testimonials = res.testimonials;
      }

      allClaims.push(...res.claims);
    };

    const workers = [];
    const concurrency = Math.min(maxConcurrency, chunks.length);
    for (let i = 0; i < concurrency; i++) {
      workers.push(runNext());
    }

    await Promise.all(workers);

    // Final dedupe across chunks
    const seen = new Set();
    const finalClaims = [];
    for (const c of allClaims) {
      const norm = c.trim().replace(/\s+/g, " ");
      if (norm && !seen.has(norm.toLowerCase())) {
        seen.add(norm.toLowerCase());
        finalClaims.push(norm);
      }
    }

    return {
      generalTopic,
      specificTopics,
      claims: finalClaims,
      testimonials,
    };
  }
}
