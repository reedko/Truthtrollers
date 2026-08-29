// backend/src/core/evidenceEngine.js

import logger from "../utils/logger.js";
import { searchPubMed } from "./pubmedSearch.js";
import { extractEvidenceBearing } from "./extractEvidenceBearing.js";

function dedupe(arr, keyFn) {
  const s = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (!s.has(k)) {
      s.add(k);
      out.push(x);
    }
  }
  return out;
}

export class EvidenceEngine {
  constructor(
    deps,
    cfg = {
      preferDomains: [],
      avoidDomains: [],
      limits: {
        queriesPerClaim: 6,
        candidates: 12,
        evidencePerDoc: 2,
        concurrency: 4,
      },
    },
  ) {
    this.deps = deps;
    this.cfg = cfg;
  }

  async generateQueries(claim, ctx, n = 6, searchMode = null) {
    const label = `[EV][queries][${claim.id}]`;
    logger.time(label);
    const queryContext = {
      ...(ctx ?? {}),
      originalText: claim.originalText || null,
      searchText: claim.searchText || null,
      objectClaim: claim.objectClaim || null,
      isAttribution: claim.isAttribution || false,
      speakerEntity: claim.speakerEntity || null,
      articleStance: claim.articleStance || null,
      argumentFunction: claim.argumentFunction || null,
      targets: Array.isArray(claim.targets) ? claim.targets : [],
    };
    if (Array.isArray(claim.searchTargets) && claim.searchTargets.length > 0) {
      const directQueries = claim.searchTargets.slice(0, n).map((target) => ({
        claimId: claim.id,
        query: target.query,
        intent: target.intent || "both",
        matchedPart: target.matchedPart || "object_claim",
      }));
      logger.log(
        `🎯 [EV][queries][${claim.id}] Using direct search targets:`,
        directQueries,
      );
      logger.timeEnd(label);
      return dedupe(
        directQueries,
        (q) =>
          `${q.intent}|${q.matchedPart}|${String(q.query || "").toLowerCase()}`,
      );
    }

    // Adjust prompt based on search mode
    let fallbackSystem, fallbackUser;

    if (searchMode?.enableBalancedSearch) {
      logger.log(
        `🎯 [EV][queries][${claim.id}] BALANCED SEARCH MODE ACTIVE - Targeting ${searchMode.supportQueries} support, ${searchMode.refuteQueries} refute, ${searchMode.nuanceQueries} nuance`,
      );
      // Mode 3: Balanced search - explicitly request support/refute/nuance
      fallbackSystem =
        "You generate precise, high-relevance search queries for fact-checking. Return strict JSON only.";

      fallbackUser = `CLAIM TO VERIFY:
{{claimText}}

CONTEXT:
{{context}}

TASK: Generate EXACTLY {{n}} high-precision search queries for this exact claim:

1. SUPPORT — a query designed to retrieve evidence that would support or corroborate the substantive claim.
2. REFUTE — a query designed to retrieve evidence that would contradict, rebut, or provide an alternative explanation for the substantive claim.

QUERY DESIGN RULES:
- Preserve the exact proposition being tested. Do not broaden it into the surrounding topic.
- Keep the query tightly anchored to the specific event, study, dispute, institution, action, population, date, or other identifying details supplied in the claim or context.
- A named person or source may be retained when that identity materially disambiguates the specific event, study, dispute, or evidence at issue.
- If a named person, institution, study, document, event, or other identity in the supplied context materially identifies the specific dispute or evidence at issue, retain that identity in the query.
- Do not drop such an identity merely because the substantive proposition can be expressed without it.
- Omit an identity only when it is merely an attribution wrapper and does not help distinguish the specific dispute, study, event, or evidence being searched.
- Do not include a person's identity merely to verify that the person made the claim.
- For attribution wrappers, target the underlying substantive assertion unless attribution itself is independently material.
- For misconduct allegations, preserve the exact alleged action and object.
- Do not invent names, studies, dates, identifiers, or facts not present in the supplied claim or context.
- Do not generate a separate nuance query. Nuance will be determined from the retrieved evidence.

DIRECTIONALITY RULES:
- SUPPORT and REFUTE must pursue genuinely different evidentiary possibilities, not cosmetic rewrites of the same search.
- For negative, absence, or "no evidence/studies" claims:
  - SUPPORT should seek evidence consistent with the claimed absence, non-association, or lack of credible evidence.
  - REFUTE should seek evidence demonstrating the allegedly absent study, effect, association, event, or evidence.
- Do not create a refute query merely by adding words such as "controversy", "not", "false", "refutation", or "debunked".
- Formulate the substantive alternative that, if supported, would make the claim false.

Return JSON only:
{"queries":[
  {"query":"...","intent":"support"},
  {"query":"...","intent":"refute"}
]}`;
    } else {
      logger.log(`🎯 [EV][queries][${claim.id}] Standard search mode`);

      // Mode 1 & 2: Standard query generation
      fallbackSystem =
        "You generate diverse, high-precision search queries for fact-checking. CRITICAL: You must create queries designed to find sources that SUPPORT, REFUTE, and provide NUANCED perspectives on the claim.";
      fallbackUser = `Claim: {{claimText}}\nContext: {{context}}\n\nTask: Produce {{n}} queries across intents with the following distribution:
- At least 2 queries designed to find sources that SUPPORT the claim (prefer 3)
- At least 2 queries designed to find sources that REFUTE the claim (prefer 3)
- At least 1 query designed to find sources that provide NUANCED perspective on the claim (prefer 3)
- The remaining queries can cover background or factbox information

IMPORTANT: Design your queries to actively seek out sources with different perspectives. For refute queries, look for credible counterarguments, debunking sites, fact-checks, or alternative evidence. For support queries, look for sources that would confirm or provide evidence for the claim. For nuance queries, look for sources that provide context, caveats, or partial support/refutation.`;
    }

    let system = fallbackSystem;
    let user = fallbackUser;

    // Try to load from database if promptManager is available
    if (this.deps.promptManager) {
      try {
        const systemPrompt = await this.deps.promptManager.getPrompt(
          "evidence_query_generation_system",
          { system: fallbackSystem, user: "", parameters: {} },
        );

        // Choose user prompt based on search mode
        const userPromptName = searchMode?.enableBalancedSearch
          ? "evidence_query_generation_user_balanced"
          : "evidence_query_generation_user";

        logger.log(
          `🎯 [EV][queries][${claim.id}] Loading prompt: ${userPromptName}`,
        );

        const userPrompt = await this.deps.promptManager.getPrompt(
          userPromptName,
          { system: "", user: fallbackUser, parameters: { n: n } },
        );

        system = systemPrompt.system;
        user = userPrompt.user
          .replace(/\{\{claimText\}\}/g, claim.promptText || claim.text)
          .replace(/\{\{context\}\}/g, JSON.stringify(queryContext))
          .replace(/\{\{n\}\}/g, n);

        // For balanced mode, also replace query distribution variables
        if (searchMode?.enableBalancedSearch) {
          user = user
            .replace(/\{\{supportQueries\}\}/g, searchMode.supportQueries ?? 3)
            .replace(/\{\{refuteQueries\}\}/g, searchMode.refuteQueries ?? 3)
            .replace(/\{\{nuanceQueries\}\}/g, searchMode.nuanceQueries ?? 3);
        }
        logger.log(
          `🧪 [EV][queries][${claim.id}] Rendered query prompt:\n${user}`,
        );
      } catch (err) {
        logger.warn(
          `⚠️ [EvidenceEngine] Error loading DB prompts, using fallback:`,
          err.message,
        );
        // Use fallback - replace template variables
        user = fallbackUser
          .replace(/\{\{claimText\}\}/g, claim.promptText || claim.text)
          .replace(/\{\{context\}\}/g, JSON.stringify(queryContext))
          .replace(/\{\{n\}\}/g, n);
      }
    } else {
      // No promptManager, use fallback with template replacement
      user = fallbackUser
        .replace(/\{\{claimText\}\}/g, claim.promptText || claim.text)
        .replace(/\{\{context\}\}/g, JSON.stringify(queryContext))
        .replace(/\{\{n\}\}/g, n);
    }

    const schema = '{"queries":[{"query":"...","intent":"support|refute"}]}';
    const out = await this.deps.llm.generate({
      system,
      user,
      schemaHint: schema,
      temperature: 0.2,
    });

    const queriesArray = out && Array.isArray(out.queries) ? out.queries : [];
    const speakerEntity = String(claim?.speakerEntity || "").trim();
    const objectClaimText = String(claim?.objectClaim || "").toLowerCase();

    const identityAnchor =
      claim?.isAttribution === true &&
      speakerEntity &&
      !objectClaimText.includes(speakerEntity.toLowerCase()) &&
      Array.isArray(claim?.targets) &&
      claim.targets.some(
        (t) =>
          t?.targetType === "attribution" &&
          t?.searchEligible === true &&
          String(t?.subjectEntity || "")
            .trim()
            .toLowerCase() === speakerEntity.toLowerCase(),
      )
        ? speakerEntity
        : null;

    const ensureIdentityAnchor = (query, anchor) => {
      const text = String(query || "").trim();
      if (!text || !anchor) return text;

      if (text.toLowerCase().includes(anchor.toLowerCase())) {
        return text;
      }

      return `${anchor} ${text}`;
    };
    const qs = queriesArray.slice(0, n).map((q) => {
      const anchoredQuery = ensureIdentityAnchor(q.query, identityAnchor);

      if (identityAnchor && anchoredQuery !== q.query) {
        logger.log(
          `🧷 [EV][queries][${claim.id}] Added identity anchor "${identityAnchor}": "${anchoredQuery}"`,
        );
      }

      return {
        claimId: claim.id,
        query: anchoredQuery,
        intent: q.intent,
      };
    });

    logger.timeEnd(label);

    logger.log(`🟦 [DEBUG] Queries for ${claim.id}:`, qs);

    return dedupe(
      qs,
      (q) => `${q.intent}|${String(q.query || "").toLowerCase()}`,
    );
  }

  /**
   * Generate fringe-seeking queries to find low-quality refutations
   * Used in two-pass search to map source credibility
   */
  generateFringeQueries(claim, claimType = null, n = 3) {
    logger.log(
      `🔍 [EV][fringe-queries][${claim.id}] Generating fringe queries for claim type: ${claimType || "unknown"}`,
    );

    const baseQueries = [
      { query: `${claim.text} hoax`, intent: "refute-fringe" },
      { query: `${claim.text} false flag`, intent: "refute-fringe" },
      { query: `${claim.text} conspiracy theory`, intent: "refute-fringe" },
    ];

    // Claim-type specific fringe sites and keywords
    const typeSpecificQueries = {
      antisemitism: [
        { query: `site:gab.com ${claim.text}`, intent: "refute-fringe" },
        { query: `site:bitchute.com ${claim.text}`, intent: "refute-fringe" },
        { query: `"antisemitism myth" ${claim.text}`, intent: "refute-fringe" },
      ],
      vaccines: [
        {
          query: `site:naturalnews.com ${claim.text}`,
          intent: "refute-fringe",
        },
        {
          query: `site:childrenshealthdefense.org ${claim.text}`,
          intent: "refute-fringe",
        },
        {
          query: `"vaccine dangers coverup" ${claim.text}`,
          intent: "refute-fringe",
        },
      ],
      climate: [
        {
          query: `site:wattsupwiththat.com ${claim.text}`,
          intent: "refute-fringe",
        },
        { query: `"climate hoax" ${claim.text}`, intent: "refute-fringe" },
      ],
      covid: [
        {
          query: `site:naturalnews.com ${claim.text}`,
          intent: "refute-fringe",
        },
        { query: `"covid hoax" ${claim.text}`, intent: "refute-fringe" },
        { query: `"plandemic" ${claim.text}`, intent: "refute-fringe" },
      ],
      pesticides: [
        {
          query: `site:naturalnews.com ${claim.text}`,
          intent: "refute-fringe",
        },
        { query: `"pesticide safety" ${claim.text}`, intent: "refute-fringe" },
      ],
    };

    const specific = typeSpecificQueries[claimType] || [];
    const allQueries = [...baseQueries, ...specific];

    const fringeQueries = allQueries.slice(0, n).map((q) => ({
      claimId: claim.id,
      query: q.query,
      intent: q.intent,
    }));

    logger.log(`🔍 [DEBUG] Fringe queries for ${claim.id}:`, fringeQueries);

    return dedupe(
      fringeQueries,
      (q) => `${q.intent}|${String(q.query || "").toLowerCase()}`,
    );
  }

  /**
   * Detect claim type from text (simple keyword matching)
   */
  detectClaimType(claimText) {
    const text = claimText.toLowerCase();

    if (text.match(/antisemit|jewish|jew|israel|zion/)) return "antisemitism";
    if (text.match(/vaccine|vax|immuniz/)) return "vaccines";
    if (text.match(/climate|global warming|carbon|emissions/)) return "climate";
    if (text.match(/election|vote|ballot|fraud/)) return "election";
    if (text.match(/covid|coronavirus|pandemic/)) return "covid";
    if (text.match(/pesticide|herbicide|glyphosate/)) return "pesticides";

    return null;
  }
  shouldSearchPubMed(claim) {
    const text = [
      claim?.text,
      claim?.originalText,
      claim?.objectClaim,
      claim?.searchText,
    ]
      .filter(Boolean)
      .join(" ");

    const hasResearchSignal =
      /\b(study|studies|paper|research|data|dataset|analysis|trial|results?|findings?|cohort|sample|subgroup|protocol|methodology|manipulat(?:e|ed|ion)|omitt?(?:ed|ing|ion)?|exclud(?:e|ed|ing)|reanalys(?:is|ed)|reanalyz(?:e|ed)|suppress(?:ed|ion)?|retract(?:ed|ion)?)\b/i.test(
        text,
      );

    return hasResearchSignal;
  }

  buildPubMedQuery(claim) {
    const speaker = String(claim?.speakerEntity || "").trim();

    let subject = String(
      claim?.objectClaim || claim?.searchText || claim?.text || "",
    ).trim();

    subject = subject.replace(
      /\b(manipulat(?:e|ed|ion)|destroy(?:ed|ing)?|conceal(?:ed|ment)?|suppress(?:ed|ion)?|omit(?:ted|ting|s)?|exclude(?:d|s|ing)?|fraud(?:ulent)?|cover[- ]?up|whistleblower|revealed?|claimed?|alleged?|agency)\b/gi,
      " ",
    );
    subject = subject.replace(
      /\b(data|linking|linked|link|was|were|is|are|had|has|have|been|the|a|an|to|by|of|that|did|not|cause|caused|declare|released|credible|evidence)\b/gi,
      " ",
    );
    subject = subject
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    const query = [speaker, subject]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return query.split(" ").slice(0, 10).join(" ");
  }

  async retrieveCandidates(claim, queries, opt) {
    if (this.shouldSearchPubMed(claim)) {
      logger.log(
        `📚 [PubMed] Query candidate for claim ${claim.id}: "${this.buildPubMedQuery(claim)}"`,
      );
    }
    const topK = opt.topKCandidates ?? 12;
    const limitQueries = queries.slice(0, opt.topKQueries ?? queries.length);

    // Optional throttle (default: unlimited concurrency)
    const maxParallel = opt.maxParallelSearches ?? Infinity;

    const label = `[EV][retrieve][${claim.id}]`;
    logger.time(label);
    const pubMedEligible = this.shouldSearchPubMed(claim);
    const pubMedQuery = pubMedEligible ? this.buildPubMedQuery(claim) : null;
    // Convert list of queries → list of async tasks
    // Tag each result with the intent of the query that produced it
    const tasks = limitQueries.map((q) => async () => {
      const sub = [];

      // Run internal + web in parallel for this query
      await Promise.all(
        [
          opt.enableInternal
            ? (async () => {
                const internal = await this.deps.search.internal({
                  query: q.query,
                  topK,
                });
                if (internal?.length) sub.push(...internal);
              })()
            : null,

          opt.enableWeb
            ? (async () => {
                const web = await this.deps.search.web({
                  query: q.query,
                  topK,
                  prefer: opt.preferDomains,
                  avoid: opt.avoidDomains,
                  searchDepth: "advanced",
                  includeRawContent: false,
                });
                if (web?.length) sub.push(...web);
              })()
            : null,
        ].filter(Boolean),
      );

      // Tag every result with this query's intent so we can bucket later
      const intent = q.intent || "background";
      return sub.map((r) => ({
        ...r,
        searchIntent: intent,
        matchedPart: q.matchedPart || "context",
      }));
    });
    if (pubMedEligible && pubMedQuery) {
      tasks.push(async () => {
        logger.log(`📚 [PubMed] Searching claim ${claim.id}: "${pubMedQuery}"`);

        const results = await searchPubMed({
          query: pubMedQuery,
          topK: 10,
        });

        return (results || []).map((r) => ({
          ...r,
          searchIntent: "background",
          matchedPart: "pubmed_research",
          scholarlyLane: true,
        }));
      });
    }

    //
    // Execute tasks with optional concurrency limit
    //
    const chunks = [];

    if (maxParallel === Infinity) {
      // No throttle → fastest path
      const results = await Promise.all(tasks.map((t) => t()));
      for (const r of results) chunks.push(...r);
    } else {
      // Throttled runner
      let i = 0;
      const workers = new Array(maxParallel).fill(0).map(async () => {
        while (i < tasks.length) {
          const t = tasks[i++];
          const r = await t();
          if (r?.length) chunks.push(...r);
        }
      });
      await Promise.all(workers);
    }

    logger.timeEnd(label);

    // Deduplicate by URL — when same URL appears from multiple queries,
    // keep the highest-scoring copy and preserve its searchIntent
    const best = new Map();
    for (const c of chunks) {
      if (!c) continue;
      const id = c.id || c.url || `${c.source}:${c.title}`;
      const prev = best.get(id);
      if (!prev || (c.score ?? 0) > (prev.score ?? 0)) {
        best.set(id, c);
      }
    }

    // Group deduplicated candidates by intent, take top N per bucket
    // This guarantees stance diversity instead of whatever the global top-12 happen to be
    const topKPerIntent = opt.topKPerIntent ?? 5;
    const INTENT_LIMITS = {
      support: topKPerIntent,
      refute: topKPerIntent,
      nuance: Math.ceil(topKPerIntent / 2),
      background: 2,
      factbox: 2,
    };

    const byIntent = {};
    for (const c of best.values()) {
      const intent = c.searchIntent || "background";
      if (!byIntent[intent]) byIntent[intent] = [];
      byIntent[intent].push(c);
    }

    let finalCandidates = [];
    for (const [intent, bucket] of Object.entries(byIntent)) {
      const limit = INTENT_LIMITS[intent] ?? topKPerIntent;
      const sorted = bucket.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      finalCandidates.push(...sorted.slice(0, limit));
      logger.log(
        `🎯 [EV][intent-bucket][${claim.id}] ${intent}: ${Math.min(sorted.length, limit)}/${sorted.length} selected`,
      );
    }

    // Filter out excluded URL (e.g., task URL to prevent self-referencing)
    if (opt.excludeUrl) {
      const beforeCount = finalCandidates.length;
      finalCandidates = finalCandidates.filter((c) => c.url !== opt.excludeUrl);
      if (beforeCount > finalCandidates.length) {
        logger.log(
          `🚫 [Evidence] Filtered out task URL from candidates: ${opt.excludeUrl}`,
        );
      }
    }
    if (finalCandidates.length > 0) {
      finalCandidates = await this.triageCandidateSnippets(
        claim,
        finalCandidates,
      );
    }
    logger.log(
      `🟩 [DEBUG] Candidates for ${claim.id}: ${finalCandidates.length} total (intent-bucketed), scores: ${finalCandidates.map((c) => `${c.searchIntent}:${c.score?.toFixed(2) || "null"}`).join(", ")}`,
    );

    return finalCandidates;
  }

  async triageCandidateSnippets(claim, candidates) {
    const candidatesForModel = candidates.map((candidate, index) => ({
      candidateIndex: index,
      title: candidate.title || "",
      snippet: candidate.snippet || candidate.content || "",
    }));

    const triageable = candidatesForModel.filter(
      (candidate) => candidate.snippet.trim().length > 0,
    );

    if (triageable.length === 0) {
      logger.log(
        `🧪 [SnippetTriage][${claim.id}] No candidates had usable snippets`,
      );

      return candidates.map((candidate) => ({
        ...candidate,
        snippetBearingScore: null,
        snippetRationale: null,
      }));
    }

    const prompt = await this.deps.promptManager.getPrompt(
      "evidence_snippet_bearing_user",
    );

    if (!prompt?.user) {
      throw new Error(
        "evidence_snippet_bearing_user returned no user prompt text",
      );
    }

    const user = prompt.user
      .replace(
        "{{caseAssertion}}",
        JSON.stringify(
          {
            taskClaimId: claim.id,
            assertion: claim.text,
          },
          null,
          2,
        ),
      )
      .replace("{{candidates}}", JSON.stringify(triageable, null, 2));

    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["candidates"],
      properties: {
        candidates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["candidateIndex", "bearingScore", "rationale"],
            properties: {
              candidateIndex: {
                type: "integer",
              },
              bearingScore: {
                anyOf: [
                  {
                    type: "number",
                    minimum: -1,
                    maximum: 1,
                  },
                  {
                    type: "null",
                  },
                ],
              },
              rationale: {
                anyOf: [
                  {
                    type: "string",
                    minLength: 1,
                  },
                  {
                    type: "null",
                  },
                ],
              },
            },
          },
        },
      },
    };

    const result = await this.deps.llm.generate({
      user,
      schemaHint: schema,
      strictJsonSchema: true,
      model: "gpt-5.4-mini",
      reasoning: {
        effort: "low",
      },
      max_output_tokens: 3000,
      api: "responses",
      timeout: 60000,
    });

    const bearingByIndex = new Map();

    for (const item of result?.candidates || []) {
      bearingByIndex.set(item.candidateIndex, {
        bearingScore: item.bearingScore,
        rationale: item.rationale,
      });
    }

    logger.log(
      `🧪 [SnippetTriage][${claim.id}] results:`,
      JSON.stringify(
        candidates.map((candidate, index) => {
          const bearing = bearingByIndex.get(index);

          return {
            candidateIndex: index,
            title: candidate.title || "",
            url: candidate.url || "",
            searchIntent: candidate.searchIntent || null,
            bearingScore: bearing?.bearingScore ?? null,
            rationale: bearing?.rationale ?? null,
            snippet: String(candidate.snippet || candidate.content || "").slice(
              0,
              300,
            ),
          };
        }),
        null,
        2,
      ),
    );

    const annotatedCandidates = candidates.map((candidate, index) => {
      const bearing = bearingByIndex.get(index);

      return {
        ...candidate,
        snippetBearingScore: bearing?.bearingScore ?? null,
        snippetRationale: bearing?.rationale ?? null,
      };
    });

    logger.log(
      `🧪 [SnippetTriage][${claim.id}] Annotated ${annotatedCandidates.length} candidates without filtering`,
    );

    return annotatedCandidates;
  }

  async acquireEvidenceDocument(claim, cand, opt) {
    const url = cand.url || cand.id || "unknown";
    const shortUrl = url.length > 80 ? url.slice(0, 77) + "..." : url;

    const fetchLabel = `[EV][fetch][${claim.id}][${shortUrl}]`;
    logger.time(fetchLabel);
    let acquisitionCandidate = cand;

    if (cand.source === "pubmed" && cand.pmcid) {
      const pmcid = String(cand.pmcid).trim();

      acquisitionCandidate = {
        ...cand,
        url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
      };

      logger.log(
        `📚 [PubMed] PMID ${cand.pmid} has ${pmcid}; acquiring PMC full text`,
      );
    }
    let fetchResult = await this.deps.fetcher.getText(
      acquisitionCandidate,
      claim,
    );
    logger.timeEnd(fetchLabel);

    const pubmedAbstract =
      cand.source === "pubmed" ? String(cand.snippet || "").trim() : "";

    if (!fetchResult && pubmedAbstract) {
      logger.log(
        `📚 [PubMed] Fetch failed for PMID ${cand.pmid}; using abstract (${pubmedAbstract.length} chars)`,
      );

      fetchResult = {
        cleanText: pubmedAbstract,
      };
    }

    if (!fetchResult) {
      logger.log(`🟥 [DEBUG] No text for ${claim.id} from ${shortUrl}`);
      return null;
    }

    let cleanText, citationCount, html, referenceContentId, quality;

    if (typeof fetchResult === "object" && fetchResult.isProcessed) {
      referenceContentId = fetchResult.referenceContentId;
      cleanText = fetchResult.cleanText;
      citationCount = fetchResult.citationCount || 0;
      html = cleanText;
      quality = fetchResult.quality ?? null;

      logger.log(
        `♻️  [Evidence] Using pre-processed text (${citationCount} citations) from ${shortUrl}`,
      );
    } else {
      html =
        typeof fetchResult === "string"
          ? fetchResult
          : fetchResult.cleanText || "";

      cleanText = html;
      citationCount = 0;

      try {
        const cheerio = await import("cheerio");
        const $ = cheerio.load(html);

        const domRefs = $("a[href]").length;

        $("script, style, link, noscript").remove();
        cleanText = $.text().replace(/\s+/g, " ").trim();

        const { extractInlineRefs } =
          await import("../utils/extractInlineRefs.js");

        const inlineRefs = extractInlineRefs(cleanText);
        citationCount = (inlineRefs?.length || 0) + domRefs;

        logger.log(
          `📚 [Evidence] Extracted ${citationCount} citations (${inlineRefs?.length || 0} inline + ${domRefs} DOM) from ${shortUrl}`,
        );
      } catch (err) {
        logger.warn(`⚠️ Failed to parse HTML for ${shortUrl}, using raw text`);
      }
    }
    if (
      cand.source === "pubmed" &&
      pubmedAbstract &&
      (!cleanText || cleanText.trim().length < 500)
    ) {
      logger.log(
        `📚 [PubMed] Replacing short acquisition for PMID ${cand.pmid} with abstract (${pubmedAbstract.length} chars)`,
      );

      cleanText = pubmedAbstract;
      html = pubmedAbstract;
      citationCount = 0;
    }
    return {
      referenceContentId,
      candidateId: cand.id,
      url: cand.url,
      title: cand.title,
      publishedAt: cand.publishedAt,
      searchIntent: cand.searchIntent || "background",
      matchedPart: cand.matchedPart || "context",
      cleanText,
      rawText: html,
      citationCount,
      quality,
      candidate: cand,
    };
  }
  async extractEvidence(claim, cand, opt) {
    const url = cand.url || cand.id || "unknown";
    const shortUrl = url.length > 80 ? url.slice(0, 77) + "..." : url;

    const fetchLabel = `[EV][fetch][${claim.id}][${shortUrl}]`;
    logger.time(fetchLabel);

    const fetchResult = await this.deps.fetcher.getText(cand, claim);
    logger.timeEnd(fetchLabel);

    if (!fetchResult) {
      logger.log(`🟥 [DEBUG] No text for ${claim.id} from ${shortUrl}`);
      return [];
    }

    // Handle both old format (string) and new format (object with cleanText + citationCount)
    let cleanText, citationCount, html;

    if (typeof fetchResult === "object" && fetchResult.isProcessed) {
      // New format: already processed by runEvidenceEngine
      cleanText = fetchResult.cleanText;
      citationCount = fetchResult.citationCount || 0;
      html = cleanText; // Store for raw_text field
      logger.log(
        `♻️  [Evidence] Using pre-processed text (${citationCount} citations) from ${shortUrl}`,
      );
    } else {
      // Old format: raw HTML/text that needs parsing
      html =
        typeof fetchResult === "string"
          ? fetchResult
          : fetchResult.cleanText || "";
      cleanText = html;
      citationCount = 0;

      try {
        const cheerio = await import("cheerio");
        const $ = cheerio.load(html);

        // Extract citation count before removing elements
        const domRefs = $("a[href]").length;

        $("script, style, link, noscript").remove();
        cleanText = $.text().replace(/\s+/g, " ").trim();

        // Extract inline citations from text
        const { extractInlineRefs } =
          await import("../utils/extractInlineRefs.js");
        const inlineRefs = extractInlineRefs(cleanText);
        citationCount = (inlineRefs?.length || 0) + domRefs;

        logger.log(
          `📚 [Evidence] Extracted ${citationCount} citations (${inlineRefs?.length || 0} inline + ${domRefs} DOM) from ${shortUrl}`,
        );
      } catch (err) {
        // If HTML parsing fails, use original text as-is
        logger.warn(`⚠️ Failed to parse HTML for ${shortUrl}, using raw text`);
      }
    }

    const maxChars = opt.maxCharsPerDoc ?? 8000;
  }

  adjudicate(claim, evidence) {
    logger.log(
      `🟫 [DEBUG] Adjudicating ${claim.id} with evidence count:`,
      evidence.length,
    );

    const now = Date.now();

    const w = (e) => {
      const rec = e.publishedAt
        ? Math.max(
            0.5,
            1 -
              (now - Date.parse(e.publishedAt)) /
                (1000 * 60 * 60 * 24 * 365 * 5),
          )
        : 0.8;
      return (e.quality ?? 0) * rec;
    };

    const buckets = { support: 0, refute: 0, nuance: 0, insufficient: 0 };

    for (const e of evidence) {
      const stance = e.stance || "insufficient";
      if (!buckets.hasOwnProperty(stance)) continue;
      buckets[stance] += w(e);
    }

    const ranked = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const finalVerdict = top[1] === 0 ? "insufficient" : top[0];

    const total = Object.values(buckets).reduce((a, b) => a + b, 0) || 0.0001;
    const dominance = ranked[0][1] / total;
    const confidence = Math.max(
      0.15,
      Math.min(0.98, 0.4 * dominance + 0.6 * Math.min(1, total)),
    );

    const sortedEv = [...evidence].sort((a, b) => w(b) - w(a));
    const picks = sortedEv.filter((e) => e.stance === finalVerdict).slice(0, 4);
    const counters = sortedEv
      .filter((e) => e.stance !== finalVerdict && e.stance !== "insufficient")
      .slice(0, 3);

    const cite = (e) => `${e.title || e.url || e.candidateId}`;

    const rationale = [
      picks
        .slice(0, 2)
        .map((e) => `“${e.quote}” — ${cite(e)}`)
        .join("; "),
      counters
        .slice(0, 1)
        .map((e) => `Counterpoint: “${e.quote}” — ${cite(e)}`)
        .join("; "),
    ]
      .filter(Boolean)
      .join(". ");

    logger.log(
      `🟧 [DEBUG] Verdict for ${claim.id}:`,
      finalVerdict,
      "confidence",
      confidence,
    );

    return {
      claimId: claim.id,
      finalVerdict,
      confidence,
      rationale,
      evidenceIds: picks.map((e) => e.id),
      counters: counters.map((e) => e.id),
    };
  }
  /**
   * redTeam(claim, adjudication, evidence)
   * --------------------------------------
   * Second-pass adversarial check.
   * Challenges the initial verdict and may revise it.
   */
  async redTeam(claim, adjudication, evidence) {
    logger.log(`🟥 [REDTEAM] Starting red-team for claim ${claim.id}`);

    const system = `
      You are a second-pass adversarial reviewer.
      Your goal is to critically challenge the initial verdict on a claim.
      If there is strong contradictory evidence or uncertainty, adjust the verdict.
      Output ONLY a JSON object following the schema.
    `;

    const user = `
CLAIM:
${claim.text}

INITIAL VERDICT:
${JSON.stringify(adjudication, null, 2)}

EVIDENCE ITEMS:
${JSON.stringify(evidence.slice(0, 12), null, 2)}

TASK:
1. Challenge the logic of the verdict.
2. Look for bias, missing evidence, or misweighting.
3. If needed, revise:
   - finalVerdict (support|refute|nuance|insufficient)
   - confidence (0–1)
   - rationale (short explanation)
4. If initial verdict is solid, keep it but refine rationale.
    `;

    const schemaHint = `{
      "finalVerdict": "support|refute|nuance|insufficient",
      "confidence": 0.0,
      "rationale": "string"
    }`;

    let out = null;
    try {
      out = await this.deps.llm.generate({
        system,
        user,
        schemaHint,
        temperature: 0.3,
      });
    } catch (err) {
      logger.warn("🟥 [REDTEAM] LLM error:", err);
      return adjudication; // fallback
    }

    if (!out || !out.finalVerdict) {
      logger.warn("🟥 [REDTEAM] Invalid red-team result, keeping original.");
      return adjudication;
    }

    const revised = {
      claimId: claim.id,
      finalVerdict: out.finalVerdict || adjudication.finalVerdict,
      confidence: Math.max(
        0.1,
        Math.min(0.99, out.confidence || adjudication.confidence),
      ),
      rationale: out.rationale || adjudication.rationale,
      evidenceIds: adjudication.evidenceIds,
      counters: adjudication.counters,
    };

    logger.log(`🟥 [REDTEAM] Revised verdict for ${claim.id}:`, revised);
    return revised;
  }

  async run(claims, contexts, opt) {
    const maxParallel = this.cfg.maxParallelClaims ?? 3;
    const results = new Array(claims.length);

    // Create async task for each claim
    const tasks = claims.map((claim, index) => async () => {
      const ctx = contexts ? contexts[claim.id] : undefined;

      logger.log(
        `\n🔵 [DEBUG] Starting claim ${claim.id}: "${claim.text.slice(
          0,
          50,
        )}..."`,
      );

      const claimLabel = `[EV][claim:${claim.id}]`;
      logger.time(`${claimLabel} total`);

      const queries = await this.generateQueries(
        claim,
        ctx,
        opt.topKQueries ?? opt.queriesPerClaim ?? 6,
        opt, // Pass full options for balanced search mode detection
      );

      const candidates = await this.retrieveCandidates(claim, queries, opt);
      results[index] = {
        claim,
        context: ctx,
        meta: undefined,
        queries,
        candidates,
      };

      logger.timeEnd(`${claimLabel} total`);
      // Process all candidates in parallel (parallel is faster than sequential early exit)
    });

    // Execute tasks with concurrency limit
    if (maxParallel === Infinity || maxParallel >= tasks.length) {
      // No throttle → process all claims in parallel
      await Promise.all(tasks.map((t) => t()));
    } else {
      // Throttled runner
      let i = 0;
      const workers = new Array(maxParallel).fill(0).map(async () => {
        while (i < tasks.length) {
          const task = tasks[i++];
          await task();
        }
      });
      await Promise.all(workers);
    }
    function candidateAcquisitionKey(candidate) {
      if (candidate.source === "pubmed" && candidate.pmcid) {
        return normalizeCandidateUrl(
          `https://pmc.ncbi.nlm.nih.gov/articles/${candidate.pmcid}/`,
        );
      }

      return normalizeCandidateUrl(candidate.url || candidate.id);
    }
    function normalizeCandidateUrl(value) {
      try {
        const url = new URL(value);

        url.hash = "";

        for (const key of [...url.searchParams.keys()]) {
          if (
            /^utm_/i.test(key) ||
            ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key)
          ) {
            url.searchParams.delete(key);
          }
        }

        url.hostname = url.hostname.replace(/^www\./i, "");

        if (url.pathname.length > 1) {
          url.pathname = url.pathname.replace(/\/+$/, "");
        }

        return url.toString();
      } catch {
        return String(value || "").trim();
      }
    }

    const candidateMap = new Map();

    for (const row of results) {
      for (const candidate of row?.candidates || []) {
        const key = candidateAcquisitionKey(candidate);
        if (!key) continue;

        const existing = candidateMap.get(key);

        const newBearing = {
          taskClaimId: row.claim.id,
          bearingScore: candidate.snippetBearingScore ?? null,
          rationale: candidate.snippetRationale ?? null,
          snippet: candidate.snippet || candidate.content || null,
        };

        if (!existing) {
          candidateMap.set(key, {
            candidate,
            discoveredForClaimIds: [row.claim.id],
            searchIntents: [candidate.searchIntent || "background"],
            snippetBearings: [newBearing],
          });
        } else {
          if (!existing.discoveredForClaimIds.includes(row.claim.id)) {
            existing.discoveredForClaimIds.push(row.claim.id);
          }

          const intent = candidate.searchIntent || "background";

          if (!existing.searchIntents.includes(intent)) {
            existing.searchIntents.push(intent);
          }

          const existingBearing = existing.snippetBearings.find(
            (bearing) => Number(bearing.taskClaimId) === Number(row.claim.id),
          );

          if (!existingBearing) {
            existing.snippetBearings.push(newBearing);
          } else {
            const newScore = newBearing.bearingScore;
            const oldScore = existingBearing.bearingScore;

            const newStrength =
              newScore === null ? -1 : Math.abs(Number(newScore));

            const oldStrength =
              oldScore === null ? -1 : Math.abs(Number(oldScore));

            if (newStrength > oldStrength) {
              existingBearing.bearingScore = newBearing.bearingScore;
              existingBearing.rationale = newBearing.rationale;
              existingBearing.snippet = newBearing.snippet;
            }
          }

          if ((candidate.score ?? 0) > (existing.candidate.score ?? 0)) {
            existing.candidate = candidate;
          }
        }
      }
    }

    const uniqueCandidates = [...candidateMap.values()];
    const acquiredDocuments = (
      await Promise.all(
        uniqueCandidates.map(async (entry) => {
          const representativeClaimId = entry.discoveredForClaimIds[0];

          const representativeClaim = claims.find(
            (claim) => Number(claim.id) === Number(representativeClaimId),
          );

          if (!representativeClaim) {
            logger.warn(
              `⚠️ [Evidence] No representative claim found for candidate ${entry.candidate.url || entry.candidate.id}`,
            );
            return null;
          }

          const acquisitionUrl =
            entry.candidate.url || entry.candidate.id || "unknown";

          logger.log(`🚦 [AcquireBatch] START ${acquisitionUrl}`);

          const startedAt = Date.now();

          const acquired = await this.acquireEvidenceDocument(
            representativeClaim,
            entry.candidate,
            opt,
          );

          logger.log(
            `🏁 [AcquireBatch] END ${acquisitionUrl} (${Date.now() - startedAt}ms)`,
          );

          if (!acquired) return null;

          return {
            ...acquired,
            discoveredForClaimIds: entry.discoveredForClaimIds,
            searchIntents: entry.searchIntents,
            snippetBearings: entry.snippetBearings,
          };
        }),
      )
    ).filter(Boolean);

    logger.log(
      `📚 [Evidence] Acquired ${acquiredDocuments.length}/${uniqueCandidates.length} unique documents`,
    );

    const bearingResults = acquiredDocuments.map((doc) => ({
      ...doc,
      bearing: {
        assertions: [],
      },
    }));

    const documentIndexById = new Map(
      bearingResults.map((doc, index) => [
        Number(doc.referenceContentId),
        index,
      ]),
    );

    const maxParallelBearing = opt.maxParallelBearing ?? 6;
    let claimIndex = 0;

    const bearingWorkers = new Array(
      Math.min(maxParallelBearing, claims.length),
    )
      .fill(0)
      .map(async () => {
        while (claimIndex < claims.length) {
          const index = claimIndex++;
          const caseAssertion = claims[index];

          const evidenceDocuments = acquiredDocuments
            .filter((doc) =>
              (doc.discoveredForClaimIds || []).some(
                (id) => Number(id) === Number(caseAssertion.id),
              ),
            )
            .map((doc) => ({
              referenceContentId: Number(doc.referenceContentId),
              evidenceText: doc.cleanText,
            }))
            .filter(
              (doc) =>
                Number.isInteger(doc.referenceContentId) &&
                typeof doc.evidenceText === "string" &&
                doc.evidenceText.trim(),
            );

          if (evidenceDocuments.length === 0) {
            continue;
          }

          const extraction = await extractEvidenceBearing({
            caseAssertion,
            evidenceDocuments,
            llm: this.deps.llm,
            promptManager: this.deps.promptManager,
          });

          const seenAssertions = new Set();

          for (const assertion of extraction.assertions || []) {
            const docIndex = documentIndexById.get(
              Number(assertion.referenceContentId),
            );

            if (docIndex === undefined) continue;

            const normalizedText = assertion.evidenceAssertion
              .trim()
              .replace(/\s+/g, " ")
              .toLowerCase();

            const duplicateKey = `${assertion.referenceContentId}|${caseAssertion.id}|${normalizedText}`;

            if (seenAssertions.has(duplicateKey)) {
              continue;
            }

            seenAssertions.add(duplicateKey);

            bearingResults[docIndex].bearing.assertions.push({
              referenceContentId: assertion.referenceContentId,
              evidenceAssertion: assertion.evidenceAssertion.trim(),
              taskClaimId: Number(caseAssertion.id),
            });
          }
        }
      });

    await Promise.all(bearingWorkers);

    logger.log(
      `🧠 [EvidenceExtraction] Extracted assertion-relative evidence for ${claims.length} case assertions across ${acquiredDocuments.length} acquired documents`,
    );

    results.bearingResults = bearingResults;

    logger.log(
      `🧺 [Evidence] ${results.reduce(
        (n, row) => n + (row?.candidates?.length || 0),
        0,
      )} claim-relative candidates → ${uniqueCandidates.length} unique documents`,
    );
    logger.log("🟩 [DEBUG] Final results before persist:", results);

    return results;
  }
}
