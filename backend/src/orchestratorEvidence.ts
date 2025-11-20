// TruthTrollers Evidence-Mapping Orchestrator (TypeScript)
// ------------------------------------------------------
// Goal: Map content → claims → queries → candidate sources → extracted evidence →
//        adjudicated verdicts (support / refute / nuanced) with citations + confidence.
// Design: Small, composable stages with strict schemas, retries, and guardrails.
// Notes:
// - Replace placeholder functions (TODOs) with your real implementations (DB, HTTP, LLM SDK).
// - Keep each stage stateless & testable. Return plain JSON that your UI can consume.
// - Use retrieval (your DB + web) instead of giant prompts. Keep prompts short & structured.

// ===== 0) Types & Schemas =====================================================

export type Verdict = "support" | "refute" | "nuance" | "insufficient";

export interface Claim {
  id: string;                 // internal claim_id
  text: string;               // canonicalized claim string
  language?: string;          // e.g., 'en'
  sourceContentId?: string;   // the content/task it came from
}

export interface ClaimContext {
  claimId: string;
  // Minimal-but-sufficient context for disambiguation & query gen.
  // Include nearby sentences, who said it, when, topic, entities, and URL.
  speaker?: string;
  date?: string; // ISO
  url?: string;
  topic?: string;
  entities?: string[];
  nearbySentences?: string[];
}

export interface Query {
  claimId: string;
  query: string;              // one query string
  intent: "support" | "refute" | "background" | "factbox";
}

export interface CandidateDoc {
  id: string;                 // hash/url/doc_id
  url?: string;
  title?: string;
  publishedAt?: string;       // ISO if known
  domain?: string;
  // Lightweight text; full text retrieved lazily by extractor.
  snippet?: string;
  score?: number;             // retrieval score
  source: "internal_db" | "web_search" | "upload" | "archive";
}

export interface EvidenceItem {
  claimId: string;
  candidateId: string;
  url?: string;
  title?: string;
  location?: { page?: number; section?: string; startChar?: number; endChar?: number };
  quote: string;              // VERBATIM span used for grounding
  summary: string;            // model/extractor paraphrase of the quote in relation to claim
  stance: Verdict;            // support / refute / nuance / insufficient
  quality: number;            // 0..1: source quality + match quality
  publishedAt?: string;       // for recency checks
}

export interface Adjudication {
  claimId: string;
  finalVerdict: Verdict;
  confidence: number;         // 0..1 derived from evidence weights & consistency
  rationale: string;          // short, cite-backed explanation (no speculation)
  evidenceIds: string[];      // list of selected EvidenceItem ids
  counters?: string[];        // noteworthy opposing evidence ids
}

export interface ClaimMappingResult {
  claim: Claim;
  context?: ClaimContext;
  queries: Query[];
  candidates: CandidateDoc[];
  evidence: EvidenceItem[];
  adjudication: Adjudication;
}

export interface MapClaimsOptions {
  topKQueries?: number;           // per-claim
  topKCandidates?: number;        // per-claim after retrieval
  maxEvidencePerDoc?: number;     // how many spans to harvest per document
  preferDomains?: string[];       // whitelists
  avoidDomains?: string[];        // blacklists
  minSourceQuality?: number;      // 0..1
  temperature?: number;           // for LLM creativity where helpful
  enableWeb?: boolean;            // allow external search
  enableInternal?: boolean;       // allow internal DB/doc search
}

// ===== 1) Utilities & Guardrails =============================================

// You can replace with Zod/Joi for runtime validation if desired.
function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function dedupe<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

// ===== 2) LLM + Retrieval Adapters (replace with real clients) ===============

// Expose adapters so tests (or your app) can swap implementations without spaghetti.
export let LLM = {
  callJSON: LLM.callJSON,
};

export let Retrieval = {
  searchInternal: async function Retrieval.searchInternal(args: { query: string; topK: number }): Promise<CandidateDoc[]> {
    // TODO: call your /api endpoints or DB (BM25/embeddings). Return lightweight CandidateDoc[]
    return [];
  },
  searchWeb: async function Retrieval.searchWeb(args: { query: string; topK: number; prefer?: string[]; avoid?: string[] }): Promise<CandidateDoc[]> {
    // TODO: call your web search service; map into CandidateDoc[]
    return [];
  },
  fetchDocText: async function Retrieval.fetchDocText(candidate: CandidateDoc): Promise<string> {
    // TODO: if internal, get from stored_content; if web, hit your fetch-with-puppeteer/pdf parser.
    return "";
  }
};

// ===== 3) Stage: Query Generation ============================================

export async function generateQueriesForClaim(claim: Claim, ctx?: ClaimContext, n = 6): Promise<Query[]> {
  const system = "You generate diverse, high-precision search queries for fact-checking.";
  const user = `Claim: ${claim.text}\nContext (optional): ${JSON.stringify(ctx ?? {}, null, 2)}\n\nTask: Produce ${n} queries across intents (support, refute, background, factbox). Avoid clickbait; include named entities, dates if present.`;
  const schema = `{"queries":[{"query":"...","intent":"support|refute|background|factbox"}]}`;
  const out = await LLM.callJSON<{ queries: { query: string; intent: Query["intent"] }[] }>({ system, user, schemaHint: schema });
  const queries = out.queries.slice(0, n).map((q) => ({ claimId: claim.id, ...q }));
  // Dedupe by normalized string
  return dedupe(queries, (q) => `${q.intent}|${q.query.toLowerCase()}`);
}

// ===== 4) Stage: Candidate Retrieval =========================================

export async function retrieveCandidates(claim: Claim, queries: Query[], opt: MapClaimsOptions): Promise<CandidateDoc[]> {
  const topK = opt.topKCandidates ?? 12;
  const chunks: CandidateDoc[] = [];
  for (const q of queries.slice(0, opt.topKQueries ?? queries.length)) {
    if (opt.enableInternal) chunks.push(...await Retrieval.searchInternal({ query: q.query, topK }));
    if (opt.enableWeb) chunks.push(...await Retrieval.searchWeb({ query: q.query, topK, prefer: opt.preferDomains, avoid: opt.avoidDomains }));
  }
  // Dedupe by URL/id; keep highest score
  const byId = new Map<string, CandidateDoc>();
  for (const c of chunks) {
    const k = c.id || c.url || `${c.source}:${c.title}`;
    const prev = byId.get(k);
    if (!prev || (c.score ?? 0) > (prev.score ?? 0)) byId.set(k, c);
  }
  return Array.from(byId.values()).sort((a,b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topK);
}

// ===== 5) Stage: Evidence Extraction (span-grounded) ==========================

export async function extractEvidenceFromCandidate(claim: Claim, cand: CandidateDoc, opt: MapClaimsOptions): Promise<EvidenceItem[]> {
  const fullText = await Retrieval.fetchDocText(cand);
  if (!fullText) return [];

  // Chunk the text for span proposals (simple heuristic; replace with your tokenizer)
  const paragraphs = fullText.split(/\n\n+/).slice(0, 120); // cap for speed
  const batch: EvidenceItem[] = [];

  // Prompt once to select top-N spans referencing the claim
  const system = "You extract verbatim quotes that directly bear on a claim; classify stance and avoid speculation.";
  const user = `Claim: ${claim.text}\nSource: ${cand.title || cand.url}\n\nText (truncated):\n${paragraphs.join("\n\n").slice(0, 20000)}\n\nTask: Select up to ${opt.maxEvidencePerDoc ?? 2} short quotes (≤ 40 words) that most directly support, refute, or nuance the claim. For each, return stance, a one-sentence summary, and best-guess location (page/section).`;
  const schema = `{"items":[{"quote":"...","stance":"support|refute|nuance|insufficient","summary":"...","location":{"page":null,"section":"..."}}]}`;
  const out = await LLM.callJSON<{ items: { quote: string; stance: Verdict; summary: string; location?: any }[] }>({ system, user, schemaHint: schema });

  let i = 0;
  for (const it of out.items || []) {
    if (!it.quote) continue;
    const ev: EvidenceItem = {
      claimId: claim.id,
      candidateId: cand.id,
      url: cand.url,
      title: cand.title,
      quote: it.quote.trim(),
      summary: it.summary?.trim() || "",
      stance: it.stance || "insufficient",
      quality: calcQuality(cand),
      publishedAt: cand.publishedAt,
      location: it.location || undefined,
    };
    // Assign a stable id for cross-references (hash claim+cand+i)
    (ev as any).id = `${claim.id}:${cand.id}:${i++}`;
    batch.push(ev);
  }
  return batch;
}

function calcQuality(c: CandidateDoc): number {
  // TODO: incorporate domain reputation, recency, retrieval score, doc type
  const base = (c.score ?? 0) / 100;
  const domainBoost = c.domain?.match(/(reuters|apnews|nature|doi|who|nih|gov|.edu)/i) ? 0.2 : 0;
  return Math.max(0, Math.min(1, base + domainBoost));
}

// ===== 6) Stage: Adjudication & Confidence ===================================

export function adjudicateClaim(claim: Claim, evidence: EvidenceItem[]): Adjudication {
  // Aggregate by stance, weight by quality & recency; penalize conflicts.
  const now = Date.now();
  const w = (e: EvidenceItem) => {
    const rec = e.publishedAt ? Math.max(0.5, 1 - (now - Date.parse(e.publishedAt)) / (1000*60*60*24*365*5)) : 0.8;
    return e.quality * rec;
  };

  const buckets: Record<Verdict, number> = { support: 0, refute: 0, nuance: 0, insufficient: 0 };
  for (const e of evidence) buckets[e.stance] += w(e);

  const ranked = Object.entries(buckets).sort((a,b) => b[1]-a[1]);
  const finalVerdict = ranked[0][1] === 0 ? "insufficient" : (ranked[0][0] as Verdict);

  // Confidence = dominance + total mass, clipped
  const total = Object.values(buckets).reduce((a,b) => a+b, 0) || 0.0001;
  const dominance = ranked[0][1] / total;
  const confidence = Math.max(0.15, Math.min(0.98, 0.4 * dominance + 0.6 * Math.min(1, total)));

  // Select top evidence supporting the verdict; include notable counters
  const sortedEv = [...evidence].sort((a,b) => w(b) - w(a));
  const picks = sortedEv.filter(e => e.stance === finalVerdict).slice(0, 4);
  const counters = sortedEv.filter(e => e.stance !== finalVerdict && e.stance !== "insufficient").slice(0, 3);

  const rationale = buildRationale(claim, picks, counters);
  return {
    claimId: claim.id,
    finalVerdict,
    confidence,
    rationale,
    evidenceIds: picks.map((e:any) => e.id),
    counters: counters.map((e:any) => e.id),
  };
}

function buildRationale(claim: Claim, picks: EvidenceItem[], counters: EvidenceItem[]): string {
  const cite = (e: EvidenceItem) => `${e.title || e.url || e.candidateId}`;
  const main = picks.slice(0,2).map(e => `“${e.quote}” — ${cite(e)}`).join("; ");
  const ctr = counters.slice(0,1).map(e => `Counterpoint: “${e.quote}” — ${cite(e)}`).join("; ");
  return [main, ctr].filter(Boolean).join(". ");
}

// ===== 7) Stage: Red-Team / Self-Check =======================================

export async function redTeam(claim: Claim, adjudication: Adjudication, evidence: EvidenceItem[]): Promise<Adjudication> {
  const system = "You critically audit conclusions. Identify weak assumptions and missing evidence.";
  const user = `Claim: ${claim.text}\nVerdict: ${adjudication.finalVerdict} (confidence ${adjudication.confidence.toFixed(2)})\n\nEvidence (JSON):\n${JSON.stringify(evidence, null, 2)}\n\nTask: In <=120 words, state any blindspots or plausible falsifiers. If issues are material, suggest lowering confidence by up to 0.2. Return JSON: {"blindspots":["..."],"delta_confidence":-0.0}`;
  const schema = `{"blindspots":["..."],"delta_confidence":0}`;
  try {
    const out = await LLM.callJSON<{ blindspots: string[]; delta_confidence: number }>({ system, user, schemaHint: schema });
    const conf = Math.max(0, Math.min(1, adjudication.confidence + (out.delta_confidence || 0)));
    return { ...adjudication, confidence: conf, rationale: adjudication.rationale + (out.blindspots?.length ? `\nBlindspots: ${out.blindspots.join("; ")}` : "") };
  } catch {
    return adjudication; // fail open
  }
}

// ===== 8) Orchestrator ========================================================

export async function mapClaimsToEvidence(
  claims: Claim[],
  contexts: Record<string, ClaimContext | undefined>,
  opt: MapClaimsOptions
): Promise<ClaimMappingResult[]> {
  const results: ClaimMappingResult[] = [];

  for (const claim of claims) {
    const ctx = contexts[claim.id];

    // 1) Queries
    const queries = await generateQueriesForClaim(claim, ctx, opt.topKQueries ?? 6);

    // 2) Candidates
    const candidates = await retrieveCandidates(claim, queries, opt);

    // 3) Evidence extraction (parallel with conservative fan-out)
    const k = Math.min(candidates.length, opt.topKCandidates ?? 10);
    const evidenceChunks = await Promise.all(
      candidates.slice(0, k).map((c) => extractEvidenceFromCandidate(claim, c, opt))
    );
    const evidence = evidenceChunks.flat();

    // 4) Adjudicate
    let adj = adjudicateClaim(claim, evidence);

    // 5) Red-team
    adj = await redTeam(claim, adj, evidence);

    results.push({ claim, context: ctx, queries, candidates, evidence, adjudication: adj });
  }

  return results;
}

// ===== 9) Example usage (wire this into your existing /api/claims/map-claims) ==

async function example() {
  const claims: Claim[] = [
    { id: "c1", text: "Coffee causes dehydration." },
    { id: "c2", text: "COVID-19 originated in a lab." },
  ];
  const contexts: Record<string, ClaimContext> = {
    c1: { claimId: "c1", topic: "nutrition", nearbySentences: ["A health blog said coffee dehydrates you."], date: "2024-10-01" },
    c2: { claimId: "c2", topic: "covid", date: "2021-06-15" },
  };

  const out = await mapClaimsToEvidence(claims, contexts, {
    topKQueries: 6,
    topKCandidates: 8,
    maxEvidencePerDoc: 2,
    preferDomains: ["reuters.com","apnews.com","who.int","cdc.gov","nature.com","nih.gov",".edu"],
    avoidDomains: ["rumor","clickbait","opinion"],
    minSourceQuality: 0.4,
    temperature: 0.2,
    enableWeb: true,
    enableInternal: true,
  });

  console.log(JSON.stringify(out, null, 2));
}

// example(); // Uncomment for local test

// ===== 10) Integration notes ==================================================
// - Replace LLM.callJSON / Retrieval.* with your real services:
//   * LLM.callJSON → your OpenAI/Anthropic client in JSON mode, low temperature
//   * Retrieval.searchInternal → stored_content (BM25 + embeddings), scoped by user/viewer
//   * Retrieval.searchWeb → your existing /api/claims/search-map or Tavily/Bing w/ domain filters
//   * Retrieval.fetchDocText → your /api/fetch-page-content (articles) and PDF parser
// - Persist evidence spans (quote + offsets) so UI can highlight them.
// - Use your existing Verimeter/Trollmeter by feeding adjudication + evidence counts.
// - Add per-claim caching; if inputs unchanged, reuse prior results.
// - Add rate limits / concurrency control when enabling web.
// - For PDFs, include page numbers in EvidenceItem.location for precise citations.
// - For YouTube, store video_id + timestamp; extractor should return t=mm:ss in location.
// - Security: do not trust LLM quotes blindly. Post-validate quotes by substring search
//   against fetched full text; discard if not exact.
// - Optional: add a calibration stage comparing claims vs. known factbox datasets
//   (WHO myth-busters, CDC, FullFact, Snopes) for quick wins and priors.

// ===== 11) Test Harness (Vitest/Jest) ========================================
/*
Example with Vitest. Create tests/orchestrator.spec.ts with:

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mapClaimsToEvidence, generateQueriesForClaim, adjudicateClaim,
  LLM, Retrieval, type Claim, type ClaimContext, type EvidenceItem
} from './orchestrator';

// 1) Swap in deterministic fakes
beforeAll(() => {
  LLM.callJSON = async ({ user }: any) => {
    // route by simple keyword to emulate different stages
    if (user.includes('Produce')) {
      return { queries: [
        { query: 'coffee dehydration randomized trial', intent: 'refute' },
        { query: 'coffee hydration meta-analysis', intent: 'refute' },
        { query: 'caffeine diuresis endurance athletes', intent: 'nuance' },
      ]};
    }
    if (user.includes('Select up to')) {
      return { items: [
        { quote: 'Coffee contributes to daily fluid intake and does not cause chronic dehydration.', stance: 'refute', summary: 'refutes', location: { section: 'Results' } },
        { quote: 'Caffeine has a mild acute diuretic effect in naive users.', stance: 'nuance', summary: 'nuance', location: { section: 'Discussion' } },
      ]};
    }
    if (user.includes('critically audit')) {
      return { blindspots: ['small sample sizes'], delta_confidence: -0.05 };
    }
    return { ok: true };
  };

  Retrieval.searchInternal = async ({ query, topK }) => [
    { id: 'int1', title: 'Hydration meta-analysis', url: 'https://example.edu/hydration', domain: 'example.edu', snippet: '...', score: 95, source: 'internal_db', publishedAt: '2022-01-01' },
  ];
  Retrieval.searchWeb = async ({ query, topK }) => [
    { id: 'w1', title: 'AP: Coffee and hydration', url: 'https://apnews.com/coffee', domain: 'apnews.com', snippet: '...', score: 90, source: 'web_search', publishedAt: '2023-02-01' },
  ];
  Retrieval.fetchDocText = async (cand) => (
    'Coffee contributes to daily fluid intake and does not cause chronic dehydration.

' +
    'Caffeine has a mild acute diuretic effect in naive users.'
  );
});

describe('orchestrator', () => {
  it('generates structured queries', async () => {
    const claim: Claim = { id: 'c1', text: 'Coffee causes dehydration.' };
    const out = await generateQueriesForClaim(claim, undefined, 3);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].intent).toBeDefined();
  });

  it('runs end-to-end and yields a refute verdict with confidence', async () => {
    const claim: Claim = { id: 'c1', text: 'Coffee causes dehydration.' };
    const contexts: Record<string, ClaimContext> = { c1: { claimId: 'c1' } };
    const res = await mapClaimsToEvidence([claim], contexts, {
      topKQueries: 3,
      topKCandidates: 3,
      maxEvidencePerDoc: 2,
      enableWeb: true,
      enableInternal: true,
      preferDomains: ['apnews.com','example.edu']
    });

    expect(res[0].adjudication.finalVerdict).toBe('refute');
    expect(res[0].adjudication.confidence).toBeGreaterThan(0);
    expect(res[0].evidence.length).toBeGreaterThan(0);
  });
});
*/
